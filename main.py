"""TradeOps desktop launcher: Django API + React UI inside a native window.

Everything runs locally and offline: waitress serves Django on 127.0.0.1, and a
pywebview (Edge WebView2) window shows the UI. Data lives in
%LOCALAPPDATA%\\TradeOps (see backend/tradeops/settings.py).

    python main.py             # window (default)
    python main.py --headless  # server only, prints the URL (used by tests)
"""
import ctypes
import logging
import os
import socket
import sys
import threading
from pathlib import Path

FROZEN = getattr(sys, "frozen", False)
BUNDLE_DIR = Path(sys._MEIPASS).resolve() if FROZEN else Path(__file__).resolve().parent
sys.path.insert(0, str(BUNDLE_DIR / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "tradeops.settings")

# A windowed exe has no console: make print()/library output harmless.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

APP_TITLE = "TradeOps"
PREFERRED_PORTS = list(range(8000, 8011))
log = logging.getLogger("tradeops.launcher")


def message_box(text: str, title: str = APP_TITLE, error: bool = True) -> None:
    try:
        flags = 0x10 if error else 0x40  # MB_ICONERROR / MB_ICONINFORMATION
        ctypes.windll.user32.MessageBoxW(0, text, title, flags)
    except Exception:
        print(f"{title}: {text}", file=sys.stderr)


def acquire_single_instance():
    """Return a handle that must stay alive, or None if another copy is running."""
    if os.name != "nt":
        return object()
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    handle = kernel32.CreateMutexW(None, False, "Local\\TradeOpsDesktopApp")
    if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
        return None
    return handle


WEBVIEW2_CLIENT_ID = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"


def webview2_available() -> bool:
    """True if the Microsoft Edge WebView2 runtime is installed (built into Windows 11)."""
    if os.name != "nt":
        return True
    override = os.environ.get("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER")
    if override:
        return (Path(override) / "msedgewebview2.exe").exists()
    import winreg

    locations = [
        (winreg.HKEY_LOCAL_MACHINE, rf"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_CLIENT_ID}"),
        (winreg.HKEY_LOCAL_MACHINE, rf"SOFTWARE\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_CLIENT_ID}"),
        (winreg.HKEY_CURRENT_USER, rf"Software\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_CLIENT_ID}"),
    ]
    for hive, path in locations:
        try:
            with winreg.OpenKey(hive, path) as key:
                version, _ = winreg.QueryValueEx(key, "pv")
                if version and version != "0.0.0.0":
                    return True
        except OSError:
            continue
    return False


def port_is_taken(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.3)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def start_server(application):
    """Bind the first free local port and serve in a background thread."""
    from waitress import create_server

    for port in PREFERRED_PORTS + [0]:
        if port and port_is_taken(port):
            continue
        try:
            server = create_server(application, host="127.0.0.1", port=port, threads=8, channel_timeout=120)
        except OSError:
            continue
        threading.Thread(target=server.run, daemon=True, name="waitress").start()
        return server.effective_port
    raise RuntimeError("no free local port")


class Api:
    """Methods callable from the web UI as window.pywebview.api.*"""

    def open_url(self, url: str) -> None:
        """Open a click-to-chat link in the user's default browser (WhatsApp fallback)."""
        import webbrowser

        if url.startswith("https://wa.me/"):  # nothing else may be opened from the page
            webbrowser.open(url)

    def choose_folder(self) -> str:
        """Windows' own folder picker (backup folder in Settings); "" when cancelled."""
        import webview

        picked = webview.windows[0].create_file_dialog(webview.FOLDER_DIALOG)
        return picked[0] if picked else ""

    def open_print_window(self, html_content: str) -> None:
        import webview

        api = PrintApi()
        api._window = webview.create_window("Print Document", html=html_content, width=1000, height=800, js_api=api)


class PrintApi:
    """window.pywebview.api.* inside a print window: the page's own window.close()
    cannot close a window that Python opened, so its Close button calls this."""

    _window = None  # underscore: pywebview does not expose it to the page

    def close(self) -> None:
        if self._window is not None:
            self._window.destroy()


def main() -> int:
    headless = "--headless" in sys.argv

    instance = acquire_single_instance()
    if instance is None and not headless:
        message_box("برنامج TradeOps يعمل بالفعل.\nTradeOps is already running.", error=False)
        return 0

    import django

    django.setup()
    logging.getLogger().setLevel(logging.INFO)

    from django.core.management import call_command
    from django.core.wsgi import get_wsgi_application

    from tradeops.system import automatic_backup

    automatic_backup()  # daily copy of the database before anything touches it
    call_command("migrate", interactive=False, verbosity=0)

    from whatsapp.sidecar import start_if_enabled

    start_if_enabled()  # the WhatsApp service only runs when the feature is switched on
    port = start_server(get_wsgi_application())
    url = f"http://127.0.0.1:{port}/"
    log.info("TradeOps %s serving on %s", os.environ.get("TRADEOPS_VERSION", ""), url)

    if headless:
        print(url, flush=True)
        threading.Event().wait()
        return 0

    if not webview2_available():
        # Without WebView2 pywebview would show a blank window. The app is a
        # local web server, so fall back to the user's browser (still offline).
        log.warning("WebView2 runtime not found; opening %s in the default browser", url)
        if not os.environ.get("TRADEOPS_NO_BROWSER"):
            import webbrowser

            webbrowser.open(url)
        message_box(
            "لم يتم العثور على Microsoft Edge WebView2 Runtime، لذلك فُتح البرنامج في المتصفح.\n"
            "اترك هذه النافذة مفتوحة أثناء العمل، واضغط «موافق» لإغلاق البرنامج.\n\n"
            "WebView2 was not found, so TradeOps opened in your browser.\n"
            "Keep this box open while you work; click OK to quit TradeOps.",
            error=False,
        )
        return 0

    import webview

    webview.create_window(
        APP_TITLE, url, js_api=Api(), width=1366, height=820, min_size=(1000, 650)
    )
    try:
        # Not private: the login, the chosen branch and the last SYP rate are remembered between launches
        # (kept in the app's own data folder).
        from django.conf import settings as dj_settings

        webview.start(gui="edgechromium" if os.name == "nt" else None, private_mode=False,
                      storage_path=str(dj_settings.DATA_DIR / "webview"))
    except Exception:
        log.exception("Could not open the application window")
        message_box(
            "تعذر فتح نافذة البرنامج. تأكد من تثبيت Microsoft Edge WebView2 Runtime.\n\n"
            "Could not open the window. Please install the Microsoft Edge WebView2 Runtime."
        )
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        logging.getLogger("tradeops.launcher").exception("Fatal error")
        message_box("حدث خطأ أثناء تشغيل البرنامج. راجع ملف السجل في:\n%LOCALAPPDATA%\\TradeOps\\logs")
        sys.exit(1)
