import uuid

from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin, UserManager
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.db import models


class Role(models.TextChoices):
    USER = "USER", "User"
    ADMIN = "ADMIN", "Admin"


class User(AbstractBaseUser, PermissionsMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    first_name = models.CharField(max_length=50)
    last_name = models.CharField(max_length=50, blank=True)
    username = models.CharField(
        validators=[UnicodeUsernameValidator()], max_length=150, unique=True
    )
    email = models.EmailField(max_length=250, blank=True, default="")
    role = models.CharField(max_length=5, choices=Role.choices, default=Role.USER)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)

    objects = UserManager()

    USERNAME_FIELD = "username"
    REQUIRED_FIELDS = ["email"]

    class Meta:
        db_table = "users"

    def __str__(self) -> str:
        return self.username

    @property
    def is_admin_role(self) -> bool:
        return self.is_superuser or self.role == Role.ADMIN


class CompanyProfile(models.Model):
    """Single row (pk=1): the customer's own business details, shown on printed documents."""

    name = models.CharField(max_length=200, blank=True)
    phone = models.CharField(max_length=100, blank=True)
    phone2 = models.CharField(max_length=100, blank=True)
    address = models.CharField(max_length=300, blank=True)

    class Meta:
        db_table = "company_profile"


class LicenseState(models.Model):
    """Single row (pk=1): trial start, last time seen (anti clock-rollback) and the license key."""

    first_run_at = models.DateTimeField(null=True, blank=True)
    last_seen = models.DateTimeField(null=True, blank=True)
    token = models.TextField(blank=True)

    class Meta:
        db_table = "license_state"


class RecoveryState(models.Model):
    """Single row: counter that makes every password-recovery code one-time."""

    counter = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "recovery_state"


class FeatureSettings(models.Model):
    """Single row (pk=1): optional modules the owner can switch on or off in Settings.

    Everything is off by default; each module is independent of the others.
    """

    branches = models.BooleanField(default=False)
    cars = models.BooleanField(default=False)
    money_boxes = models.BooleanField(default=False)
    accounts = models.BooleanField(default=False)
    partners = models.BooleanField(default=False)
    whatsapp = models.BooleanField(default=False)

    # Country code used to complete local phone numbers (0980... -> 963980...).
    whatsapp_country_code = models.CharField(max_length=5, default="963")
    # A WhatsApp group (the owner's / partners') that gets reports: id like 1203...@g.us and its name.
    whatsapp_group_jid = models.CharField(max_length=60, blank=True, default="")
    whatsapp_group_name = models.CharField(max_length=200, blank=True, default="")
    # Tell the group about every sale as it is finalized.
    whatsapp_notify_sales = models.BooleanField(default=False)

    FLAGS = ("branches", "cars", "money_boxes", "accounts", "partners", "whatsapp")

    class Meta:
        db_table = "feature_settings"

    @classmethod
    def current(cls) -> "FeatureSettings":
        row, _ = cls.objects.get_or_create(pk=1)
        return row


class BackupSettings(models.Model):
    """Single row (pk=1): where backups go besides the app's own folder.

    `folder` empty = Documents\TradeOps Backups. A folder on another disk or a USB stick keeps a copy
    safe if this PC's disk fails; daily automatic backups are copied there too (`copy_auto`).
    """

    folder = models.CharField(max_length=500, blank=True, default="")
    copy_auto = models.BooleanField(default=True)

    class Meta:
        db_table = "backup_settings"

    @classmethod
    def current(cls) -> "BackupSettings":
        row, _ = cls.objects.get_or_create(pk=1)
        return row
