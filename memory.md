# TradeOps - project memory

Created 2026-11-01 as a copy of SolarOps (`C:\Users\msi\Desktop\Solar-Ops`, branch offline-exe-rewrite at commit 258d6ac, SolarOps 1.0.6), made generic and re-branded blue. A Nuqta Web Studio product. For the full backend/frontend history read the SolarOps `memory.md`; everything there still applies (same architecture: Django REST + React/Vite/shadcn Arabic RTL in pywebview, waitress on 127.0.0.1, SQLite, release.bat builds exe + Inno Setup installer).

## What differs from SolarOps
* Names: SolarOps -> TradeOps, Arabic «تريد أوبس», Django package `solar_erp` -> `backend/tradeops`, env vars `TRADEOPS_*`, data dir `%LOCALAPPDATA%\TradeOps`, `TradeOps.spec`, `installer/TradeOps.iss`.
* Colour: primary emerald -> royal blue (`frontend/src/index.css` tokens, `brand-*` Tailwind colours, `variant="brand"` buttons). Success/paid amounts stay green on purpose.
* Logo: ring with a dot (the dot = «نقطة»), `frontend/src/components/LogoMark.tsx` + `tools/make_icon.py` (draws `assets/*` and the favicon; needs Pillow, e.g. the SolarOps `.venv`). Nuqta credit/red diamond kept.
* NEW installer AppId and NEW Ed25519 license + recovery keypairs (private keys in `C:\Users\msi\TradeOps-vendor\`, NOT backed up yet; the public keys are in `backend/tradeops/licensing.py` and `backend/user/recovery.py`). Never reuse SolarOps keys.
* Removed: Arabic user guide (`docs/`, was solar + green screenshots) and `tools/seed_demo.py` (solar scenarios). Product-category colours in Inventory are now hashed by name.
* Version restarted at 1.0.0.

## Not done yet
Not built, tested or run: run `release.bat` (tests, tsc, eslint, exe, installer) first. No Git commit beyond the initial one. User guide and demo seeder to rewrite. Some Arabic wording (e.g. contractor jobs) is still equipment-shop flavoured.
Gotchas: see the SolarOps memory (bare `python` hangs, use `C:\Python314\python -I`; kill vite before `npm ci`; run release.bat via `cmd /c "...\release.bat < nul > log 2>&1"`).
