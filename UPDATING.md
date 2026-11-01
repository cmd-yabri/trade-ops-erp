# How to change and update TradeOps

## The mental model (read this once)
Three separate things exist. Updating only ever replaces the first one:

| What | Where | Touched by an update? |
|---|---|---|
| **The program** | `C:\Users\<user>\AppData\Local\Programs\TradeOps\TradeOps.exe` | **Yes** - the installer replaces it |
| **Customer data** (database, backups, logs, secret key) | `%LOCALAPPDATA%\TradeOps\` | **Never** by install/upgrade |
| **License** (trial start, activation key) | inside that database + `HKCU\Software\TradeOps` | **No** - customers stay activated |

So shipping a new version = give the customer a new `TradeOps-Setup-X.Y.Z.exe`. They run it on top of the old
version (it recognises it by its fixed `AppId`, closes the running app, replaces the exe). Their data, users and
license are exactly as they were. The database upgrades itself on first start, after an automatic backup.

## Your normal workflow
```
1. Create a branch                 git checkout -b feature/short-name
2. Run the app in dev mode         (see below) and make the change
3. Test                            cd backend && ..\.venv\Scripts\python manage.py test tradeops
4. Bump the version                edit VERSION  (1.0.1 = fix, 1.1.0 = new feature, 2.0.0 = big change)
5. Write it in CHANGELOG.md        one or two lines per change
6. Commit, merge to main, tag      git tag v1.0.1
7. Build the release               release.bat      ->  dist\TradeOps-Setup-1.0.1.exe  (+ .sha256.txt)
8. Test the installer yourself     install it OVER the previous version on a PC that has data (see checklist)
9. Send it to customers
```
`release.bat` refuses to build if any backend test, the TypeScript check or the lint fails.

### Dev mode (two terminals)
```
:: terminal 1 - API (data goes to ./data, not to your real %LOCALAPPDATA%)
set TRADEOPS_DATA_DIR=C:\Users\msi\Desktop\Solar-Ops\data
set TRADEOPS_LICENSE_BYPASS=1
cd backend
..\.venv\Scripts\python manage.py migrate
..\.venv\Scripts\python manage.py runserver 8000

:: terminal 2 - UI with hot reload
cd frontend
npm run dev            ->  http://localhost:8080
```

## Where to make which kind of change
| I want to... | Edit |
|---|---|
| Change a screen / label / layout | `frontend/src/pages/*.tsx` (texts are inline Arabic) |
| Add a form field | model in `backend/<app>/models.py` -> migration -> serializer -> `frontend/src/types/api.ts` -> the page |
| Add or change an optional module | its Django app (`locations`, `cashbox`, `partners`, `accounts`, `whatsapp`), its page in `frontend/src/pages`, and the switch in `user.models.FeatureSettings` + `components/settings/FeaturesPanel.tsx` |
| Change business rules (stock, payments, profit) | `backend/order/services.py`, `backend/purchase_order/services.py`, `backend/invoice/services.py` |
| Change what prints on invoices | the `generatePrintHTML` / `generatePOPrintHTML` functions in `SalesOrders.tsx` / `PurchaseOrders.tsx` |
| Change the app icon / installer art | edit colours in `tools/make_icon.py`, run it, rebuild |
| Change the trial length | `TRIAL_DAYS` in `backend/tradeops/licensing.py` |
| Change who may do what | `require_admin(request)` calls in the views |

## Changing the database (the one thing to be careful with)
```
cd backend
..\.venv\Scripts\python manage.py makemigrations     # creates NNNN_*.py in the app's migrations folder
..\.venv\Scripts\python manage.py migrate            # try it on your dev data
```
Rules that keep customers' data safe:
1. **Commit the migration file.** It is what upgrades their database. A model change without a migration breaks the app.
2. **Never edit or delete a migration that was already shipped.** Add a new one instead.
3. **Prefer additive changes** (new field with a default, new table). Renaming/removing fields needs a careful migration.
4. **Test the upgrade path**: install the previous release, create some data, install the new one over it, check the data.
5. A safety net exists: on every start the app copies the database to `%LOCALAPPDATA%\TradeOps\backups\auto-YYYYMMDD.sqlite3`
   (kept 14 days) *before* migrating.

## Checklist before sending any release
- [ ] `release.bat` finished with **DONE** (tests + lint + build + installer)
- [ ] Installed over the previous version on a PC with data: data, users, license all still there
- [ ] Opened Sales / Purchases / Inventory / Financials, made one sale and printed it
- [ ] Settings shows the new version number
- [ ] `CHANGELOG.md` updated and `git tag` created
- [ ] Kept a copy of the installer and its `.sha256.txt` (so you can resend or roll back)

## If something goes wrong at a customer
- **Bug in the new version:** fix it, bump the patch number (for example, 1.0.5 after 1.0.4), release again. Customers install over it.
- **Roll back:** reinstall the previous installer. If the new version had already upgraded their database and the old one
  misbehaves, restore `%LOCALAPPDATA%\TradeOps\backups\auto-<day before>.sqlite3` over `db.sqlite3` (app closed).
- **Logs:** `%LOCALAPPDATA%\TradeOps\logs\tradeops.log` - ask the customer to send it.
- **Forgot username and password:** leave the username blank in Forgot Password and issue a one-time administrator recovery code with `tools/recovery_tool.py admin` (only when exactly one admin exists). For a known username, use the `code` command. **Activation / renewal:** `tools/license_tool.py`.

## Good habits
- One codebase for everyone. Don't fork per customer: use the **Company profile** (Settings) for their name/phones on invoices
  and licenses for who may run it.
- Keep the source in a **private** repository (the licensing check is in it).
- Keep `C:\Users\msi\TradeOps-vendor\` and its backup on `D:` safe: they hold the license and recovery private keys.
- Don't change `AppId` in `installer/TradeOps.iss`, the mutex name `TradeOpsDesktopApp` in `main.py`, or the public keys
  in `licensing.py` / `recovery.py` unless you really mean to (changing keys invalidates all existing licenses/recovery codes).
