"""Offline licensing: 14-day trial, then a vendor-signed, machine-bound activation key.

How it works (no server, no internet):
  * First run starts a trial. The start date is kept in the database AND in the
    current user's registry; the earlier one wins, so deleting only the data
    folder does not restart the trial. The clock cannot be wound back: the last
    time seen is stored and never moves backwards.
  * To activate, the customer sends the vendor their *machine code* (shown on
    the License page). The vendor signs a license with the Ed25519 PRIVATE key
    (tools/license_tool.py). The app only holds the public key, so it can verify
    but never create licenses. A license is bound to one machine code and may
    have an expiry date or be perpetual.
  * When the trial ends without a valid license the API answers HTTP 402 for
    everything except login, backup, recovery and the license endpoints, so the
    customer can always log in, activate and export their data.

Honest limits: this stops casual copying, not a determined cracker who patches
the exe. That is the normal trade-off for offline software.
"""
import base64
import hashlib
import json
import os
from datetime import date, datetime, timedelta

from django.conf import settings

from user.models import LicenseState

# Ed25519 public key (base64). The private key stays with the vendor only.
LICENSE_PUBLIC_KEY_B64 = "OaM2fkLcgc+mZnwapPWF9RB3nr0udAiEDnPDGntOWLE="
TRIAL_DAYS = 14
REGISTRY_PATH = r"Software\TradeOps"
REGISTRY_VALUE = "fr"


def now() -> datetime:
    return datetime.now()


def _use_registry() -> bool:
    return os.name == "nt" and getattr(settings, "LICENSE_USE_REGISTRY", True)


# --- machine identity --------------------------------------------------------
def _machine_guid() -> str:
    if os.name == "nt":
        try:
            import winreg

            with winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\Cryptography",
                0,
                winreg.KEY_READ | winreg.KEY_WOW64_64KEY,
            ) as key:
                return str(winreg.QueryValueEx(key, "MachineGuid")[0])
        except OSError:
            pass
    from user.recovery import _install_id

    return _install_id()


def machine_code() -> str:
    digest = hashlib.sha256(f"tradeops-machine|{_machine_guid()}".encode()).hexdigest()[:16].upper()
    return "-".join(digest[i : i + 4] for i in range(0, 16, 4))


# --- registry mirror of the trial start -------------------------------------
def _registry_first_run():
    if not _use_registry():
        return None
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REGISTRY_PATH) as key:
            return datetime.fromisoformat(winreg.QueryValueEx(key, REGISTRY_VALUE)[0])
    except (OSError, ValueError):
        return None


def _write_registry_first_run(value: datetime) -> None:
    if not _use_registry():
        return
    try:
        import winreg

        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, REGISTRY_PATH) as key:
            winreg.SetValueEx(key, REGISTRY_VALUE, 0, winreg.REG_SZ, value.isoformat())
    except OSError:
        pass


# --- license tokens ------------------------------------------------------------
def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def verify_token(token: str) -> dict:
    """Return the license payload if `token` is genuine, for this machine and not
    expired. Raises ValueError with a customer-readable Arabic reason otherwise."""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    try:
        payload_part, signature_part = "".join(token.split()).split(".")
        payload_bytes, signature = _b64d(payload_part), _b64d(signature_part)
        payload = json.loads(payload_bytes)
    except Exception:
        raise ValueError("مفتاح التفعيل غير صالح.")
    public_key = Ed25519PublicKey.from_public_bytes(base64.b64decode(LICENSE_PUBLIC_KEY_B64))
    try:
        public_key.verify(signature, b"tradeops-license|" + payload_bytes)
    except InvalidSignature:
        raise ValueError("مفتاح التفعيل غير صالح.")
    if payload.get("m") != machine_code():
        raise ValueError("مفتاح التفعيل مخصص لجهاز آخر.")
    expires = payload.get("e")
    if expires and date.fromisoformat(expires) < now().date():
        raise ValueError("انتهت صلاحية مفتاح التفعيل.")
    return payload


# --- status ------------------------------------------------------------------
def status() -> dict:
    """{"status": "active"|"trial"|"expired", ...} - also keeps the trial clock honest."""
    if not settings.FROZEN and os.environ.get("TRADEOPS_LICENSE_BYPASS"):
        return {"status": "active", "customer": "developer", "expires": None, "days_left": None,
                "request_code": machine_code()}

    state, _ = LicenseState.objects.get_or_create(pk=1)
    current = now()
    changed = []

    # Never let the clock run backwards.
    if state.last_seen and current < state.last_seen - timedelta(minutes=5):
        current = state.last_seen
    elif not state.last_seen or current - state.last_seen > timedelta(minutes=1):
        state.last_seen = current
        changed.append("last_seen")

    # Trial start: earliest of database and registry; create if nobody has one.
    registry_first = _registry_first_run()
    candidates = [d for d in (state.first_run_at, registry_first) if d]
    first = min(candidates) if candidates else current
    if state.first_run_at != first:
        state.first_run_at = first
        changed.append("first_run_at")
    if registry_first is None or registry_first > first:
        _write_registry_first_run(first)
    if changed:
        state.save(update_fields=changed)

    result = {"request_code": machine_code(), "customer": "", "expires": None, "days_left": None}
    if state.token:
        try:
            payload = verify_token(state.token)
            result.update(status="active", customer=payload.get("c", ""), expires=payload.get("e"))
            return result
        except ValueError as exc:
            result["license_error"] = str(exc)

    days_left = TRIAL_DAYS - (current - first).days
    result.update(status="trial" if days_left > 0 else "expired", days_left=max(days_left, 0))
    return result


def activate(token: str) -> dict:
    verify_token(token)  # raises ValueError when not acceptable
    state, _ = LicenseState.objects.get_or_create(pk=1)
    state.token = "".join(token.split())
    state.save(update_fields=["token"])
    return status()
