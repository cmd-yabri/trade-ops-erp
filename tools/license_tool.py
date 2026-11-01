"""Vendor-side tool: issue TradeOps activation keys.

The customer opens "License" in the app, reads you their MACHINE CODE and you
send back an activation key. The key only works on that one PC. The app holds
only the public key; the PRIVATE key (license_private.pem) never leaves you.

  python tools/license_tool.py issue --key C:\\Users\\msi\\TradeOps-vendor\\license_private.pem ^
         --machine ABCD-1234-EF56-7890 --customer "Al-Noor Trading" [--expires 2027-12-31]

  (no --expires = perpetual license)

First-time setup only (already done; the public key is in backend/tradeops/licensing.py):
  python tools/license_tool.py keygen --out C:\\path\\license_private.pem

Back up the private key. If you lose it you can no longer license new customers
and would have to ship a new exe with a new public key.
"""
import argparse
import base64
import json
import re
import sys
from datetime import date
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def cmd_keygen(args):
    out = Path(args.out)
    if out.exists():
        raise SystemExit(f"{out} exists; refusing to overwrite a private key.")
    key = Ed25519PrivateKey.generate()
    out.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    pub = base64.b64encode(key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    print(f"Private key: {out}\nPublic key for backend/tradeops/licensing.py: {pub}")


def cmd_issue(args):
    machine = args.machine.strip().upper()
    if not re.fullmatch(r"[0-9A-F]{4}(-[0-9A-F]{4}){3}", machine):
        raise SystemExit("Machine code must look like ABCD-1234-EF56-7890")
    if args.expires:
        date.fromisoformat(args.expires)  # validates YYYY-MM-DD
    key = serialization.load_pem_private_key(Path(args.key).read_bytes(), password=None)
    payload = json.dumps(
        {"v": 1, "m": machine, "c": args.customer, "e": args.expires or None},
        ensure_ascii=False, separators=(",", ":"),
    ).encode("utf-8")
    signature = key.sign(b"tradeops-license|" + payload)
    print("Activation key (send this to the customer):")
    print(f"{b64u(payload)}.{b64u(signature)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    kg = sub.add_parser("keygen")
    kg.add_argument("--out", required=True)
    kg.set_defaults(func=cmd_keygen)
    iss = sub.add_parser("issue")
    iss.add_argument("--key", required=True)
    iss.add_argument("--machine", required=True)
    iss.add_argument("--customer", required=True)
    iss.add_argument("--expires", help="YYYY-MM-DD; omit for a perpetual license")
    iss.set_defaults(func=cmd_issue)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    sys.exit(main())
