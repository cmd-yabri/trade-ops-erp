"""
Django settings for TradeOps.

The app is shipped as an offline Windows .exe (PyInstaller + pywebview), but the
same settings are used when running from source for development.

Where data lives:
  * packaged exe : %LOCALAPPDATA%\\TradeOps          (always writable)
  * from source  : <repo>/data                      (git-ignored)
  * override     : TRADEOPS_DATA_DIR / DATABASE_PATH environment variables
"""
import os
import secrets
import sys
from pathlib import Path

FROZEN = getattr(sys, "frozen", False)

# Folder that holds the code/static files (PyInstaller unpacks into _MEIPASS).
if FROZEN:
    BASE_DIR = Path(sys._MEIPASS)
else:
    BASE_DIR = Path(__file__).resolve().parent.parent.parent

def _read_version() -> str:
    """Single source of truth: the VERSION file at the repository root (bundled into the exe)."""
    try:
        return (BASE_DIR / "VERSION").read_text(encoding="utf-8").strip() or "0.0.0"
    except OSError:
        return "0.0.0"


APP_VERSION = _read_version()


# --- Data directory (database, secret key, logs, automatic backups) ---------
def _default_data_dir() -> Path:
    if os.environ.get("TRADEOPS_DATA_DIR"):
        return Path(os.environ["TRADEOPS_DATA_DIR"])
    if FROZEN:
        root = os.environ.get("LOCALAPPDATA") or str(Path.home())
        return Path(root) / "TradeOps"
    return BASE_DIR / "data"


DATA_DIR = _default_data_dir()
DATA_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR = DATA_DIR / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
AUTO_BACKUP_DIR = DATA_DIR / "backups"
# Manual backups made from the Settings page go somewhere the user can find.
def _default_user_backup_dir() -> Path:
    if os.environ.get("TRADEOPS_USER_BACKUP_DIR"):
        return Path(os.environ["TRADEOPS_USER_BACKUP_DIR"])
    try:
        return Path.home() / "Documents" / "TradeOps Backups"
    except RuntimeError:  # no home folder known: keep backups next to the data
        return DATA_DIR / "manual-backups"


USER_BACKUP_DIR = _default_user_backup_dir()
if "test" in sys.argv:  # tests must never write into the real Documents or data folders
    import tempfile  # noqa: E402
    _TEST_BACKUPS = Path(tempfile.mkdtemp(prefix="tradeops-test-backups-"))
    USER_BACKUP_DIR = _TEST_BACKUPS / "manual"
    AUTO_BACKUP_DIR = _TEST_BACKUPS / "auto"

DB_PATH = os.environ.get("DATABASE_PATH", str(DATA_DIR / "db.sqlite3"))


# --- Secret key: generated once per installation ----------------------------
def _load_secret_key() -> str:
    key_file = DATA_DIR / "secret.key"
    try:
        if key_file.exists():
            key = key_file.read_text(encoding="utf-8").strip()
            if len(key) >= 32:
                return key
        key = secrets.token_urlsafe(64)
        key_file.write_text(key, encoding="utf-8")
        return key
    except OSError:
        # Read-only location: fall back to an ephemeral key (sessions are not
        # used, tokens simply stop working after a restart).
        return secrets.token_urlsafe(64)


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY") or _load_secret_key()

DEBUG = bool(os.environ.get("TRADEOPS_DEBUG")) and not FROZEN

# The server only listens on 127.0.0.1; rejecting other Host headers also
# blocks DNS-rebinding attacks from web pages.
ALLOWED_HOSTS = ["127.0.0.1", "localhost", "[::1]"]


# --- Applications -----------------------------------------------------------
INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "inventory",
    "locations",
    "cashbox",
    "partners",
    "accounts",
    "whatsapp",
    "offers",
    "user",
    "purchase_order",
    "order",
    "invoice",
    "reports",
    "audit",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "tradeops.middleware.LicenseMiddleware",
    "tradeops.middleware.BoxWarningMiddleware",
]

# The trial start is mirrored in the Windows registry (not while running tests).
LICENSE_USE_REGISTRY = "test" not in sys.argv

ROOT_URLCONF = "tradeops.urls"
WSGI_APPLICATION = "tradeops.wsgi.application"
AUTH_USER_MODEL = "user.User"

# CORS is only needed when the Vite dev server (port 8080) talks to the API.
# The packaged app is same-origin, so nothing is allowed there.
CORS_ALLOWED_ORIGINS = (
    []
    if FROZEN
    else ["http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080"]
)
CSRF_TRUSTED_ORIGINS = ["http://127.0.0.1:8000", "http://localhost:8000"]
# The dev page (another origin) must be allowed to read the negative-box warning.
CORS_EXPOSE_HEADERS = ["X-Box-Warning"]


# --- Templates / static files ----------------------------------------------
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
            ],
        },
    },
]

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
# At build time collectstatic copies the compiled React app (frontend/dist)
# into STATIC_ROOT; the .exe then serves STATIC_ROOT through WhiteNoise.
STATICFILES_DIRS = [BASE_DIR / "frontend" / "dist"] if not FROZEN and (BASE_DIR / "frontend" / "dist").exists() else []
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
WHITENOISE_AUTOREFRESH = DEBUG
WHITENOISE_USE_FINDERS = DEBUG


# --- Database ---------------------------------------------------------------
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": DB_PATH,
        "OPTIONS": {
            "timeout": 20,
            # Writers queue up instead of failing with "database is locked" when two requests race
            # (a double click, two users on the LAN); WAL lets readers continue meanwhile.
            "transaction_mode": "IMMEDIATE",
            "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
        },
    }
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# --- Auth / API -------------------------------------------------------------
AUTH_PASSWORD_VALIDATORS = []  # handled by user.serializers.validate_new_password

if "test" in sys.argv:  # keep the test suite fast; production keeps Django's strong default
    PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_RATES": {"login": "20/min"},
    "EXCEPTION_HANDLER": "tradeops.errors.api_exception_handler",
}

from datetime import timedelta  # noqa: E402

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=12),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "UPDATE_LAST_LOGIN": True,
}

# Password recovery for customers who forgot their password is handled by
# signed one-time recovery codes (see user/recovery.py), not by a shared
# default account.


# --- Locale -----------------------------------------------------------------
# Single-machine desktop app: store and show naive local time so "today" is the
# customer's today (no timezone database needed on a clean Windows install).
LANGUAGE_CODE = "ar"
USE_I18N = True
USE_TZ = False
TIME_ZONE = "UTC"  # only used when USE_TZ=True; kept valid for Django


# --- Logging ----------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"std": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"}},
    "handlers": {
        "file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": str(LOG_DIR / "tradeops.log"),
            "maxBytes": 1_000_000,
            "backupCount": 3,
            "encoding": "utf-8",
            "formatter": "std",
        },
    },
    "root": {"handlers": ["file"], "level": "INFO"},
    "loggers": {"django.request": {"handlers": ["file"], "level": "WARNING", "propagate": False}},
}
