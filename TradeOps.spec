# -*- mode: python ; coding: utf-8 -*-
# Build with build_exe.bat / release.bat (they compile the React app and run collectstatic first).
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules
from PyInstaller.utils.win32.versioninfo import (
    FixedFileInfo, StringFileInfo, StringStruct, StringTable, VarFileInfo, VarStruct, VSVersionInfo,
)

ROOT = Path(SPECPATH)
VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
parts = (VERSION.split(".") + ["0", "0", "0"])[:4]
version_tuple = tuple(int("".join(ch for ch in p if ch.isdigit()) or 0) for p in parts)

# Windows "Details" tab of the exe
version_info = VSVersionInfo(
    ffi=FixedFileInfo(filevers=version_tuple, prodvers=version_tuple, mask=0x3F, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0),
    kids=[
        StringFileInfo([StringTable("040904B0", [
            StringStruct("CompanyName", "TradeOps"),
            StringStruct("FileDescription", "TradeOps - business management"),
            StringStruct("FileVersion", VERSION),
            StringStruct("InternalName", "TradeOps"),
            StringStruct("OriginalFilename", "TradeOps.exe"),
            StringStruct("ProductName", "TradeOps"),
            StringStruct("ProductVersion", VERSION),
        ])]),
        VarFileInfo([VarStruct("Translation", [1033, 1200])]),
    ],
)

datas = [("staticfiles", "staticfiles"), ("backend", "backend"), ("VERSION", ".")]
binaries = []
hiddenimports = ["waitress", "webview", "clr"]

for package in ("rest_framework", "rest_framework_simplejwt", "corsheaders", "whitenoise", "cryptography"):
    d, b, h = collect_all(package)
    datas += d
    binaries += b
    hiddenimports += h

for app in ("tradeops", "inventory", "user", "purchase_order", "order", "invoice", "reports",
            "locations", "cashbox", "partners", "accounts", "whatsapp", "offers", "audit"):
    hiddenimports += collect_submodules(app)

a = Analysis(
    ["main.py"],
    pathex=["backend"],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "pytest"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="TradeOps",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ROOT / "assets" / "icon.ico"),
    version=version_info,
)
