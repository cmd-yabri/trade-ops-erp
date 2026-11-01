"""Vendor-side tool: issue one-time password recovery codes for TradeOps customers.

The customer's app shows a *request code* on the "Forgot password" screen. You
sign it (together with their username) with YOUR private key and send back the
*recovery code*. The key never leaves your machine; the app only contains the
matching public key (backend/user/recovery.py).

Usage
-----
  # once, to create a keypair (then paste the printed public key into
  # backend/user/recovery.py -> RECOVERY_PUBLIC_KEY_B64 and rebuild the exe):
  python tools/recovery_tool.py keygen --out C:\\path\\to\\recovery_private.pem

  # every time a customer forgets a password:
  python tools/recovery_tool.py code --key C:\\path\\to\\recovery_private.pem \\
         --request 1A2B-....-0000 --username ahmad

  # if they forgot the administrator username too (only works when exactly one admin exists):
  python tools/recovery_tool.py admin --key C:\\path\\to\\recovery_private.pem \\
         --request 1A2B-....-0000

Keep the private key backed up and private. Whoever has it can reset the
password on every installation of your product.
"""
import argparse
import base64
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ADMIN_RECOVERY_SCOPE = "__tradeops_admin_recovery__"


def parse_request_code(code: str):
    parts = code.strip().upper().replace(" ", "").split("-")
    if len(parts) != 9 or not parts[-1].isdigit() or any(len(p) != 4 for p in parts):
        raise SystemExit("Invalid request code (expected 9 groups like XXXX-XXXX-...-0000).")
    return "".join(parts[:8]), int(parts[-1])


def signing_message(install: str, counter: int, username: str) -> bytes:
    # Must match backend/user/recovery.py: signing_message()
    return f"tradeops-recovery|{install}|{counter}|{username.strip().lower()}".encode("utf-8")


def cmd_keygen(args):
    out = Path(args.out)
    if out.exists():
        raise SystemExit(f"{out} already exists; refusing to overwrite a private key.")
    key = Ed25519PrivateKey.generate()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    public = base64.b64encode(
        key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    ).decode()
    print(f"Private key written to {out}  (keep it secret and backed up)")
    print(f"Public key (put in backend/user/recovery.py): {public}")


def cmd_code(args):
    key = serialization.load_pem_private_key(Path(args.key).read_bytes(), password=None)
    install, counter = parse_request_code(args.request)
    signature = key.sign(signing_message(install, counter, args.username))
    code = base64.b32encode(signature).decode().rstrip("=")
    print("Recovery code (send this to the customer):")
    print("-".join(code[i : i + 8] for i in range(0, len(code), 8)))


def cmd_admin_code(args):
    key = serialization.load_pem_private_key(Path(args.key).read_bytes(), password=None)
    install, counter = parse_request_code(args.request)
    signature = key.sign(signing_message(install, counter, ADMIN_RECOVERY_SCOPE))
    code = base64.b32encode(signature).decode().rstrip("=")
    print("Administrator recovery code (reveals the username and resets its password):")
    print("-".join(code[i : i + 8] for i in range(0, len(code), 8)))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    kg = sub.add_parser("keygen", help="create a new keypair")
    kg.add_argument("--out", required=True)
    kg.set_defaults(func=cmd_keygen)
    cd = sub.add_parser("code", help="issue a recovery code")
    cd.add_argument("--key", required=True, help="path to your private key (PEM)")
    cd.add_argument("--request", required=True, help="request code shown in the customer's app")
    cd.add_argument("--username", required=True)
    cd.set_defaults(func=cmd_code)
    admin = sub.add_parser("admin", help="recover the administrator username and reset its password")
    admin.add_argument("--key", required=True, help="path to your private key (PEM)")
    admin.add_argument("--request", required=True, help="request code shown by the customer")
    admin.set_defaults(func=cmd_admin_code)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    sys.exit(main())
