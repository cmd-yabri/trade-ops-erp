"""Offline password recovery with signed one-time codes.

Why not a default admin account? A password that is identical on every
customer's machine is a master key: once it leaks, every installation is open.
Instead the vendor holds an Ed25519 *private* key; the app only contains the
matching *public* key, so it can verify codes but never create them.

Flow (works fully offline, over the phone or a chat):
  1. The customer opens "Forgot password" and reads out the request code shown
     there (install id + a counter).
  2. The vendor runs tools/recovery_tool.py with that request code and the
     customer's username and sends back the recovery code.
  3. The customer enters the code and a new password.
Each code is valid for exactly one reset on exactly one installation: the
counter inside the request code increases after every successful reset.
"""
import base64
import secrets

from django.conf import settings
from django.db import transaction

from .models import RecoveryState

# Ed25519 public key (base64, raw 32 bytes). The matching private key is kept
# by the vendor only, never in this repository.
RECOVERY_PUBLIC_KEY_B64 = "j87WE4bbo3vlaBVHyZHoZrSn25nsFhWJZis9HXCKhH8="
ADMIN_RECOVERY_SCOPE = "__tradeops_admin_recovery__"


def _install_id() -> str:
    path = settings.DATA_DIR / "install.id"
    try:
        value = path.read_text(encoding="utf-8").strip()
        if len(value) == 32:
            return value
    except OSError:
        pass
    value = secrets.token_hex(16).upper()
    try:
        path.write_text(value, encoding="utf-8")
    except OSError:
        pass
    return value


def _counter() -> int:
    state, _ = RecoveryState.objects.get_or_create(pk=1)
    return state.counter


def request_code() -> str:
    install = _install_id()
    groups = "-".join(install[i : i + 4] for i in range(0, 32, 4))
    return f"{groups}-{_counter():04d}"


def _parse_request_code(code: str):
    parts = code.strip().upper().replace(" ", "").split("-")
    if len(parts) != 9 or not parts[-1].isdigit():
        return None
    return "".join(parts[:8]), int(parts[-1])


def signing_message(install: str, counter: int, username: str) -> bytes:
    return f"tradeops-recovery|{install}|{counter}|{username.strip().lower()}".encode("utf-8")


def verify_and_consume(code: str, username: str) -> bool:
    """True (and the code is burned) if `code` is a valid signature for this
    installation's current request code and the given username."""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    cleaned = "".join(ch for ch in code.upper() if ch.isalnum())
    try:
        signature = base64.b32decode(cleaned + "=" * (-len(cleaned) % 8))
    except Exception:
        return False
    if len(signature) != 64:
        return False

    public_key = Ed25519PublicKey.from_public_bytes(base64.b64decode(RECOVERY_PUBLIC_KEY_B64))
    with transaction.atomic():
        state, _ = RecoveryState.objects.select_for_update().get_or_create(pk=1)
        message = signing_message(_install_id(), state.counter, username)
        try:
            public_key.verify(signature, message)
        except InvalidSignature:
            return False
        state.counter += 1
        state.save(update_fields=["counter"])
    return True
