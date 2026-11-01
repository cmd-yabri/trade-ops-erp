"""The bundled Node/Baileys WhatsApp service: starting it, supervising it and talking to it.

Only runs while the WhatsApp feature is switched on. Everything is best effort: if Node or the
service files are missing the rest of TradeOps keeps working and the "send via WhatsApp"
buttons fall back to a click-to-chat link.
"""
import json
import logging
import os
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)

_BACKOFF = [2, 5, 15, 30, 60]
PREFERRED_PORTS = list(range(8090, 8100))

_process: subprocess.Popen | None = None
_supervisor: threading.Thread | None = None
_lock = threading.Lock()
_port: int | None = None
_stopping = False


NOT_LINKED = "واتساب غير مربوط حالياً. اربطه من الإعدادات، أو أرسل الرسالة يدوياً."


class SidecarError(Exception):
    """The WhatsApp service could not do what was asked (message is Arabic, safe to show)."""

    def __init__(self, message: str, *, code: str = "", retryable: bool = True):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


# --- locating things --------------------------------------------------------
def service_dir() -> Path:
    """Dev: <repo>/whatsapp-service. Installed app: the folder next to TradeOps.exe (an optional
    installer component, kept outside the one-file exe so Node is not unpacked on every start)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "whatsapp-service"
    return Path(settings.BASE_DIR) / "whatsapp-service"


def node_binary() -> str | None:
    """A Node shipped with the app wins over the system one."""
    bundled = service_dir() / ("node.exe" if os.name == "nt" else "node")
    return str(bundled) if bundled.exists() else shutil.which("node")


def available() -> tuple[bool, str]:
    """Can the service run on this PC? (False, reason) when not."""
    if not (service_dir() / "server.js").exists():
        return False, "ملفات خدمة واتساب غير موجودة في هذا الإصدار."
    if not (service_dir() / "node_modules").exists():
        return False, "حزم خدمة واتساب غير مثبتة."
    if not node_binary():
        return False, "Node.js غير مثبت على هذا الجهاز."
    return True, ""


def _token() -> str:
    """Shared secret between the backend and the service; one per installation."""
    token_file = Path(settings.DATA_DIR) / "whatsapp.token"
    try:
        if token_file.exists():
            value = token_file.read_text(encoding="utf-8").strip()
            if len(value) >= 24:
                return value
        value = secrets.token_urlsafe(32)
        token_file.write_text(value, encoding="utf-8")
        return value
    except OSError:
        return secrets.token_urlsafe(32)


_TOKEN = None


def token() -> str:
    global _TOKEN
    if _TOKEN is None:
        _TOKEN = _token()
    return _TOKEN


def session_dir() -> Path:
    return Path(settings.DATA_DIR) / "whatsapp-session"


def _free_port() -> int:
    for port in PREFERRED_PORTS + [0]:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                continue
            return probe.getsockname()[1]
    raise OSError("no free port")


def port() -> int:
    global _port
    if _port is None:
        _port = int(os.environ.get("TRADEOPS_WA_PORT") or _free_port())
    return _port


# --- process control --------------------------------------------------------
_job_handle = None  # kept for the life of the app; closing it (app exit or kill) ends the child


def _die_with_parent(process: subprocess.Popen) -> None:
    """Windows: put the child in a job object that kills it when TradeOps goes away.

    Without this, force-closing TradeOps (task manager, the installer's taskkill) leaves node.exe
    running, and Windows then refuses to replace its file during an upgrade.
    """
    global _job_handle
    if os.name != "nt":
        return
    try:
        import ctypes
        from ctypes import wintypes

        class IoCounters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in (
                "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

        class BasicLimits(ctypes.Structure):
            _fields_ = [
                ("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD),
            ]

        class ExtendedLimits(ctypes.Structure):
            _fields_ = [
                ("BasicLimitInformation", BasicLimits), ("IoInfo", IoCounters),
                ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t),
            ]

        kernel32 = ctypes.windll.kernel32
        kernel32.CreateJobObjectW.restype = wintypes.HANDLE
        job = kernel32.CreateJobObjectW(None, None)
        info = ExtendedLimits()
        info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        kernel32.SetInformationJobObject(wintypes.HANDLE(job), 9, ctypes.byref(info), ctypes.sizeof(info))
        kernel32.AssignProcessToJobObject(wintypes.HANDLE(job), wintypes.HANDLE(int(process._handle)))  # noqa: SLF001
        _job_handle = job
    except Exception:  # best effort: the installer also stops the process by itself
        logger.exception("Could not tie the WhatsApp service to the app's lifetime")


def _start_process() -> subprocess.Popen | None:
    global _process
    ok, reason = available()
    if not ok:
        logger.warning("WhatsApp service not started: %s", reason)
        return None
    session_dir().mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.update({"WA_PORT": str(port()), "WA_TOKEN": token(), "WA_SESSION_DIR": str(session_dir()),
                "WA_WEBHOOK_URL": ""})
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    with _lock:
        _process = subprocess.Popen(
            [node_binary(), str(service_dir() / "server.js")], cwd=str(service_dir()), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=flags, text=True,
            encoding="utf-8", errors="replace",
        )
    _die_with_parent(_process)
    logger.info("WhatsApp service started (pid %s) on port %s.", _process.pid, port())
    threading.Thread(target=_pump_output, args=(_process,), daemon=True).start()
    return _process


def _pump_output(process: subprocess.Popen) -> None:
    """Forward the service's output to our log (and keep the pipe drained)."""
    if process.stdout is None:
        return
    failure_words = ("error", "exception", "unhandled", "uncaught", "failed", "traceback")
    for line in process.stdout:
        line = line.rstrip()
        if not line:
            continue
        level = logging.WARNING if any(w in line.lower() for w in failure_words) else logging.INFO
        logger.log(level, "[whatsapp-service] %s", line)


def _supervise() -> None:
    failures = 0
    while not _stopping:
        process = _start_process()
        if process is None:
            time.sleep(_BACKOFF[-1])
            continue
        code = process.wait()
        if _stopping:
            return
        failures += 1
        delay = _BACKOFF[min(failures - 1, len(_BACKOFF) - 1)]
        logger.warning("WhatsApp service exited with code %s; restarting in %ss.", code, delay)
        time.sleep(delay)


def ensure_started() -> bool:
    """Start the supervisor once (idempotent). False when the service cannot run here."""
    global _supervisor, _stopping
    if os.environ.get("TRADEOPS_NO_SIDECAR"):  # tests / headless runs: never spawn Node
        return False
    ok, _ = available()
    if not ok:
        return False
    with _lock:
        if _supervisor is not None and _supervisor.is_alive():
            return True
        _stopping = False
        _supervisor = threading.Thread(target=_supervise, name="whatsapp-sidecar", daemon=True)
        _supervisor.start()
    return True


def stop() -> None:
    global _process, _stopping
    _stopping = True
    with _lock:
        process, _process = _process, None
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


def start_if_enabled() -> None:
    """Called at app start: only brings the service up when the feature is on."""
    from user.models import FeatureSettings

    try:
        if FeatureSettings.current().whatsapp:
            ensure_started()
    except Exception:  # the database may not be migrated yet; never block startup
        logger.exception("Could not check the WhatsApp feature flag")


# --- talking to it ----------------------------------------------------------
def _call(method: str, path: str, payload: dict | None = None, timeout: float = 20.0) -> dict:
    url = f"http://127.0.0.1:{port()}{path}"
    data = json.dumps(payload or {}).encode("utf-8") if method == "POST" else None
    request = urllib.request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json; charset=utf-8", "X-Auth-Token": token()},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read().decode("utf-8"))
        except (ValueError, OSError):
            body = {}
        code = body.get("error", "")
        if code == "not_connected":  # the service's own text is technical English ("Disconnected (408)...")
            body["detail"] = NOT_LINKED
        raise SidecarError(body.get("detail") or body.get("error") or f"HTTP {exc.code}", code=code,
                           retryable=code not in ("not_on_whatsapp", "invalid_number", "bad_request"))
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        logger.warning("WhatsApp service unreachable on %s: %s", path, exc)  # the details go to the log, not the screen
        raise SidecarError("خدمة واتساب لا تستجيب. أعد تشغيل البرنامج، وإن تكرر ذلك فأعد تثبيته مع مكوّن «دعم واتساب».",
                           code="offline")


def status() -> dict:
    """{state: open|connecting|close|offline|unavailable, qr, pairingCode, detail}"""
    ok, reason = available()
    if not ok:
        return {"state": "unavailable", "detail": reason, "qr": "", "pairingCode": ""}
    try:
        data = _call("GET", "/status", timeout=8.0)
    except SidecarError as exc:
        return {"state": "offline", "detail": str(exc), "qr": "", "pairingCode": ""}
    qr, pairing = data.get("qr", "") or "", data.get("pairingCode", "") or ""
    state, detail = data.get("state", "unknown"), data.get("detail", "")
    if state != "open" and (qr or pairing):
        # Waiting for the phone: the link is gone, it will not come back by itself.
        state, detail = "unlinked", "واتساب غير مربوط. امسح الرمز من واتساب ← الأجهزة المرتبطة، أو استخدم رمز الاقتران."
    return {"state": state, "detail": detail, "qr": qr, "pairingCode": pairing}


def start_link(phone: str = "") -> dict:
    data = _call("POST", "/link", {"phone": phone} if phone else {}, timeout=45.0)
    return {"state": data.get("state", "connecting"), "detail": data.get("detail", ""),
            "qr": data.get("qr", "") or "", "pairingCode": data.get("pairingCode", "") or ""}


def logout() -> None:
    _call("POST", "/logout", {})


def groups() -> list[dict]:
    """[{id, subject, size}] of the groups the linked phone belongs to."""
    return _call("GET", "/groups", timeout=20.0).get("groups", [])


def send_group(jid: str, text: str) -> str:
    return _call("POST", "/send-group", {"jid": jid, "text": text}, timeout=30.0).get("id", "")


def send_text(phone_digits: str, text: str) -> str:
    """Send one message; returns the WhatsApp message id."""
    return _call("POST", "/send", {"phone": phone_digits, "text": text}, timeout=30.0).get("id", "")
