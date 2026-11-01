"""Backups of the SQLite database (offline, no cloud)."""
import logging
import sqlite3
from datetime import datetime
from pathlib import Path

from django.conf import settings
from rest_framework import serializers, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle

from user.models import CompanyProfile, FeatureSettings

from . import licensing
from .backups import copy_auto_backup, manual_folder
from .errors import BusinessRuleError, require_admin

logger = logging.getLogger(__name__)


def backup_database(target_dir: Path, prefix: str, stamp_format: str = "%Y%m%d-%H%M%S") -> Path:
    """Consistent copy of the live database (safe while the app is running)."""
    source_path = Path(settings.DB_PATH)
    if not source_path.exists():
        raise FileNotFoundError(source_path)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{prefix}-{datetime.now().strftime(stamp_format)}.sqlite3"
    source = sqlite3.connect(str(source_path))
    dest = sqlite3.connect(str(target))
    try:
        source.backup(dest)
        tables = dest.execute("SELECT count(*) FROM sqlite_master WHERE type = 'table'").fetchone()[0]
    finally:
        dest.close()
        source.close()
    if not tables:  # an empty file must never pass for a backup
        target.unlink(missing_ok=True)
        raise RuntimeError(f"database at {source_path} is empty; nothing to back up")
    return target


def automatic_backup(keep: int = 14) -> Path | None:
    """Once per day at startup, keep the most recent `keep` copies."""
    try:
        if not Path(settings.DB_PATH).exists() or Path(settings.DB_PATH).stat().st_size == 0:
            return None
        today = settings.AUTO_BACKUP_DIR / f"auto-{datetime.now():%Y%m%d}.sqlite3"
        if today.exists():
            return today
        path = backup_database(settings.AUTO_BACKUP_DIR, "auto", "%Y%m%d")
        old = sorted(settings.AUTO_BACKUP_DIR.glob("auto-*.sqlite3"))[:-keep]
        for stale in old:
            stale.unlink(missing_ok=True)
        copy_auto_backup(path, keep)  # and in the folder the owner chose (another disk / USB)
        return path
    except Exception:  # a failed backup must never stop the app from starting
        logger.exception("Automatic backup failed")
        return None


@api_view(["POST"])
def make_backup(request):
    """Admin-only: write a backup into Documents\\TradeOps Backups and return its path."""
    require_admin(request)
    try:
        path = backup_database(manual_folder(), "tradeops-backup")  # the chosen folder, else Documents
    except (OSError, RuntimeError, sqlite3.Error) as exc:
        logger.exception("Manual backup failed")
        raise BusinessRuleError(f"تعذر إنشاء النسخة الاحتياطية: {exc}")
    return Response({"path": str(path)}, status=status.HTTP_201_CREATED)


class CompanyProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompanyProfile
        fields = ["name", "phone", "phone2", "address"]


@api_view(["GET", "PUT"])
def company_profile(request):
    """The business's own details (printed on invoices). Everyone reads, admin edits."""
    profile, _ = CompanyProfile.objects.get_or_create(pk=1)
    if request.method == "GET":
        return Response(CompanyProfileSerializer(profile).data)
    require_admin(request)
    serializer = CompanyProfileSerializer(profile, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)


class FeatureSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeatureSettings
        fields = [*FeatureSettings.FLAGS, "whatsapp_country_code", "whatsapp_group_jid", "whatsapp_group_name",
                  "whatsapp_notify_sales"]

    def validate_whatsapp_group_jid(self, value):
        value = value.strip()
        if value and not value.endswith("@g.us"):
            raise serializers.ValidationError("معرّف مجموعة غير صالح.")
        return value


@api_view(["GET", "PUT"])
def feature_settings(request):
    """Optional modules (branches, cars, money boxes ...). Everyone reads, admin switches."""
    row = FeatureSettings.current()
    if request.method == "GET":
        return Response(FeatureSettingsSerializer(row).data)
    require_admin(request)
    serializer = FeatureSettingsSerializer(row, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    if row.whatsapp:
        from whatsapp import sidecar  # noqa: PLC0415

        sidecar.ensure_started()  # no-op where Node / the service files are missing
    return Response(serializer.data)


class _LicenseThrottle(SimpleRateThrottle):
    scope = "login"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": "license", "ident": self.get_ident(request)}


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def license_status(request):
    """Public: the License page and the trial banner need it before/without login."""
    return Response(licensing.status())


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([_LicenseThrottle])
def license_activate(request):
    try:
        return Response(licensing.activate(request.data.get("token", "")))
    except ValueError as exc:
        raise BusinessRuleError(str(exc))


@api_view(["GET"])
def system_info(request):
    require_admin(request)
    return Response({
        "version": settings.APP_VERSION,
        "data_dir": str(settings.DATA_DIR),
        "backup_dir": str(manual_folder()),
    })
