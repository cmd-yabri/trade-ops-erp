# TradeOps - project memory

Created 2026-11-01 as a copy of SolarOps (`C:\Users\msi\Desktop\Solar-Ops`, branch offline-exe-rewrite at commit 258d6ac, SolarOps 1.0.6), made generic and re-branded blue. A Nuqta Web Studio product. For the full backend/frontend history read the SolarOps `memory.md`; everything there still applies (same architecture: Django REST + React/Vite/shadcn Arabic RTL in pywebview, waitress on 127.0.0.1, SQLite, release.bat builds exe + Inno Setup installer).

## What differs from SolarOps
* Names: SolarOps -> TradeOps, Arabic «تريد أوبس», Django package `solar_erp` -> `backend/tradeops`, env vars `TRADEOPS_*`, data dir `%LOCALAPPDATA%\TradeOps`, `TradeOps.spec`, `installer/TradeOps.iss`.
* Colour: primary emerald -> royal blue (`frontend/src/index.css` tokens, `brand-*` Tailwind colours, `variant="brand"` buttons). Success/paid amounts stay green on purpose.
* Logo: ring with a dot (the dot = «نقطة»), `frontend/src/components/LogoMark.tsx` + `tools/make_icon.py` (draws `assets/*` and the favicon; needs Pillow, e.g. the SolarOps `.venv`). Nuqta credit/red diamond kept.
* NEW installer AppId and NEW Ed25519 license + recovery keypairs (private keys in `C:\Users\msi\TradeOps-vendor\`, NOT backed up yet; the public keys are in `backend/tradeops/licensing.py` and `backend/user/recovery.py`). Never reuse SolarOps keys.
* Removed: Arabic user guide (`docs/`, was solar + green screenshots) and `tools/seed_demo.py` (solar scenarios). Product-category colours in Inventory are now hashed by name.
* Version restarted at 1.0.0.

## State (2026-11-01)
* Services on sales orders/offers are FREE TEXT (`FreelanceJob.job_type` / `OfferJob.job_type`, max 100, migrations order 0010 + offers); UI field + suggestions from used names (`frontend/src/lib/services.ts`); old codes STEEL/ELECTRIC/INSTALL/MOVING still display with Arabic names. Financials label "تكلفة الخدمات".
* Built with `release.bat` (venv `.venv` created from C:\Python314; 214 tests OK): `dist\TradeOps-Setup-1.0.0.exe` + sha256 file. Installer NOT installed or launch-tested; `dist\TradeOps.exe` was launched headless on an empty data dir and served the app.
* User guide (Arabic): `docs/user-guide-ar.html` -> `docs/TradeOps-User-Guide-AR.pdf` (render with playwright `page.pdf({preferCSSPageSize:true,printBackground:true})` while serving docs/ over `python -m http.server`). Screenshots in `docs/guide-assets` come from the built exe + a demo dataset; the PDF pages were checked only partly (cover, section 5).
* Test fix: `test_period_windows` was date dependent (failed on the 1st of a month); now month-aware.
* Gotchas: the `Documents\T...` style backslash in a non-raw docstring gives a SyntaxWarning (fixed once); dev servers (vite/esbuild) must be stopped before `release.bat`.
* Still not done: backup of vendor keys is on `D:\TradeOps-vendor-backup\`; push to GitHub never done; WhatsApp sidecar and real printing untested; some copy (e.g. "cars") remains shop-flavoured.
