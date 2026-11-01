"""Backup folder choice, the list of backups, and restoring one (admin only, offline)."""
import logging
import shutil
import sqlite3
import tempfile
import uuid
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.db import connections
from rest_framework import serializers, status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from user.models import BackupSettings

from .errors import BusinessRuleError, require_admin

logger = logging.getLogger(__name__)

# Tables every TradeOps database has: a file without them is not one of our backups.
REQUIRED_TABLES = {"django_migrations", "inventory_product", "order_salesorder", "purchase_order_purchaseorder"}


def chosen_folder() -> Path | None:
    """The folder the owner picked, or None (not set, or not reachable right now: a USB stick is out)."""
    try:
        folder = BackupSettings.current().folder.strip()
    except Exception:  # noqa: BLE001 - table missing before the first migrate
        return None
    if not folder:
        return None
    path = Path(folder)
    return path if path.is_dir() else None


def manual_folder() -> Path:
    return chosen_folder() or settings.USER_BACKUP_DIR


def check_writable(folder: Path) -> None:
    """Create the folder if needed and prove a file can be written there."""
    if not folder.is_absolute():
        raise BusinessRuleError("اختر مجلداً كاملاً، مثل D:\\TradeOps Backups.")
    try:
        folder.mkdir(parents=True, exist_ok=True)
        probe = folder / f".tradeops-{uuid.uuid4().hex}.tmp"
        probe.write_bytes(b"ok")
        probe.unlink()
    except OSError as exc:
        raise BusinessRuleError(f"لا يمكن الكتابة في هذا المجلد: {exc}")


def copy_auto_backup(path: Path, keep: int = 14) -> None:
    """Also keep the daily automatic backup in the chosen folder (errors never stop the app)."""
    try:
        row = BackupSettings.current()
    except Exception:  # noqa: BLE001 - first start after an update: the table comes with the migrate that follows
        return
    try:
        folder = chosen_folder()
        if not row.copy_auto or folder is None:
            return
        target = folder / "auto"
        target.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target / path.name)
        for stale in sorted(target.glob("auto-*.sqlite3"))[:-keep]:
            stale.unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        logger.exception("Copying the automatic backup to the chosen folder failed")


def _sources() -> dict[str, Path]:
    places = {"auto": settings.AUTO_BACKUP_DIR, "manual": settings.USER_BACKUP_DIR}
    folder = chosen_folder()
    if folder is not None and folder.resolve() != Path(settings.USER_BACKUP_DIR).resolve():
        places["folder"] = folder
        places["folder_auto"] = folder / "auto"
    return places


def list_backups() -> list[dict]:
    rows = []
    for source, folder in _sources().items():
        if not folder.is_dir():
            continue
        for f in folder.glob("*.sqlite3"):
            stat = f.stat()
            rows.append({"source": source, "name": f.name, "folder": str(folder), "size": stat.st_size,
                         "modified": datetime.fromtimestamp(stat.st_mtime)})
    rows.sort(key=lambda r: r["modified"], reverse=True)
    return rows


def check_backup_file(path: Path) -> None:
    """A real, healthy TradeOps database, or a clear Arabic error."""
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            ok = con.execute("PRAGMA integrity_check").fetchone()[0]
            tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        finally:
            con.close()
    except sqlite3.Error:
        raise BusinessRuleError("الملف ليس نسخة احتياطية صالحة من TradeOps.")
    if ok != "ok":
        raise BusinessRuleError("النسخة الاحتياطية تالفة ولا يمكن استرجاعها.")
    if not REQUIRED_TABLES <= tables:
        raise BusinessRuleError("الملف ليس نسخة احتياطية من TradeOps.")


def restore_from(path: Path) -> Path:
    """Replace the live database with the backup at `path`; a copy of the current data is kept first.

    Returns the safety copy. The backup is upgraded to this version's tables afterwards.
    """
    from .system import backup_database  # noqa: PLC0415

    check_backup_file(path)
    safety = backup_database(settings.AUTO_BACKUP_DIR, "before-restore")
    connections.close_all()
    src = sqlite3.connect(str(path))
    dst = sqlite3.connect(str(settings.DB_PATH))
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    call_command("migrate", verbosity=0)  # an older backup gets the newer tables
    logger.warning("Database restored from %s (previous data saved in %s)", path, safety)
    return safety


class BackupSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = BackupSettings
        fields = ["folder", "copy_auto"]

    def validate_folder(self, value):
        value = value.strip()
        if value:
            check_writable(Path(value))
        return value


@api_view(["GET", "PUT"])
def backup_settings(request):
    require_admin(request)
    row = BackupSettings.current()
    if request.method == "PUT":
        s = BackupSettingsSerializer(row, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
    return Response({
        **BackupSettingsSerializer(row).data,
        "default_folder": str(settings.USER_BACKUP_DIR),
        "auto_folder": str(settings.AUTO_BACKUP_DIR),
        # False when the chosen folder is set but cannot be reached now (USB stick out ...)
        "folder_ok": not row.folder or chosen_folder() is not None,
    })


@api_view(["GET"])
def backups(request):
    require_admin(request)
    return Response(list_backups()[:200])


@api_view(["POST"])
@parser_classes([JSONParser, MultiPartParser, FormParser])
def restore(request):
    """Restore a listed backup ({source, name}) or an uploaded file (field `file`)."""
    require_admin(request)
    upload = request.FILES.get("file")
    if upload is not None:
        tmp = Path(tempfile.mkdtemp(prefix="tradeops-restore-")) / "upload.sqlite3"
        with tmp.open("wb") as out:
            for chunk in upload.chunks():
                out.write(chunk)
        path = tmp
    else:
        source, name = request.data.get("source", ""), request.data.get("name", "")
        folder = _sources().get(source)
        if folder is None or not name or Path(name).name != name or not name.endswith(".sqlite3"):
            raise BusinessRuleError("اختر نسخة احتياطية من القائمة.")
        path = folder / name
        if not path.is_file():
            raise BusinessRuleError("النسخة الاحتياطية غير موجودة.")
    safety = restore_from(path)
    return Response({"restored": path.name, "safety_copy": str(safety)}, status=status.HTTP_200_OK)
