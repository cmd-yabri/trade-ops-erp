# TradeOps

Offline business-management app for trading and retail shops: inventory, purchase
orders, sales orders (with optional service jobs), payments and
financial reports. Shipped as a single Windows `.exe` (Django + React in a
native Edge-WebView2 window). Works 100% offline, USD, Arabic (RTL) UI.

## For customers
* Double-click `TradeOps.exe`. On the first start the **owner (admin) account** is created.
* Data lives in `%LOCALAPPDATA%\TradeOps` (database, logs, automatic daily backups).
  Manual backups: *Settings -> Backup* writes to `Documents\TradeOps Backups`.
* Windows 10 PCs may need the Microsoft Edge WebView2 Runtime (built into Windows 11).
* Forgot the password? *Login -> Forgot password* shows a request code. Send it to
  support, paste the recovery code you get back, choose a new password. Any other admin
  can also reset passwords in *Settings -> Users*.

## For the vendor (you)
### Password recovery (no default password on purpose)
A shared default admin password would be a master key to every customer's data once it
leaks. Instead recovery uses one-time signed codes (`backend/user/recovery.py`):

```
python tools/recovery_tool.py code --key C:\Users\msi\TradeOps-vendor\recovery_private.pem ^
       --request <request code from the customer> --username <their username>
```

* The private key is **not** in the repository. Back up `C:\Users\msi\TradeOps-vendor\`.
* The app only holds the public key; each code works once, for one username, on one install.

### Optional modules (per customer)
*Settings -> Optional features* (admin) switches modules on or off. Everything is off by default and independent; turning one off hides it, never deletes data.

| Module | What it adds |
|---|---|
| Price offers | (always on) Quotations that become a sales order when accepted; no inventory effect until the order is finalized |
| Branches | Own stock per branch, branch picker in the sidebar, per-branch lists and reports, stock transfers |
| Cars | Stock on each car, sell from a car (deducts the car's stock), car page with stock / expenses / sales |
| Money boxes | USD box and SYP box (kept separate), pay/receive in either currency at a typed rate, exchange popup, cash statement |
| Wholesale accounts | Ledger per wholesale customer / supplier: sales, purchases, payments, debtor / creditor balance, statements |
| Partners | Percent share per partner, prior-profit opening balance and withdrawals, **Close month** button (preview, then one click; the last close can be undone) |
| WhatsApp | Send sales / purchase orders and account statements to phone numbers |

How the money works with the modules:
* Accounting always runs in **USD**. A payment or expense made in SYP stores the SYP cash and the typed rate (SYP per 1 USD); its USD value is `SYP / rate`.
* Box balances are computed from payments, expenses, partner withdrawals, exchanges and manual deposits/withdrawals: nothing is stored twice. Enter an opening balance with *Deposit*.
* Stock typed in when a product is created is booked as a **stock purchase** expense (cash out, shown in Financials but not subtracted from profit, because the cost reaches profit as cost of goods when it is sold).
* Partners: *profit since the last close* is split by percentage when you press **Close**; withdrawals are advances against a partner's share and never change the business profit.
* When first setting up Partners, enter the historical profit and each partner's prior withdrawals to establish opening balances. This one-time baseline does not change current cash boxes or current-period profit; it can be corrected until the first profit close.
* Wholesale accounts: a lump-sum payment is spread over the account's oldest unpaid orders (so every order keeps a correct paid/partial/unpaid status); the rest stays as credit.

WhatsApp: the app starts a small Node service (Baileys, ported from the clinic ERP) only while the module is on. Link the shop's number in *Settings -> WhatsApp* (pairing code or QR). The installer has an optional "WhatsApp support" component (Node + Baileys, ~60 MB); without it the buttons open a ready-to-send click-to-chat link. WhatsApp is an unofficial gateway: keep volumes human-sized.

### Licensing / activation (offline)
* Every install gets a **14-day trial** (`TRIAL_DAYS` in `backend/tradeops/licensing.py`). The start date is stored in the
  database and mirrored in the current user's registry (`HKCU\Software\TradeOps`), the clock can't be wound back.
* After the trial the app locks: everything except login, backup, password recovery and the License page answers HTTP 402 and the UI
  redirects to **License**. Data is never deleted; the customer can still log in, export a backup and activate.
* To activate: the customer reads you their **machine code** (License page), you issue a key, they paste it. Works offline, one PC only:
```
python tools/license_tool.py issue --key C:\Users\msi\TradeOps-vendor\license_private.pem ^
       --machine ABCD-1234-EF56-7890 --customer "Customer name" [--expires 2027-12-31]
```
  No `--expires` = perpetual license. The private key `license_private.pem` (separate from the recovery key; both are backed up in
  `D:\TradeOps-vendor-backup\`) never goes in the repo or the exe, which only holds the public key.
* Honest limit: this stops casual copying and trial resets, not someone who patches the exe.
* Dev from source: set `TRADEOPS_LICENSE_BYPASS=1` (ignored in the packaged exe).


### Build and ship
```
release.bat            # tests + lint + exe + installer + checksum
```
Result: `dist\TradeOps-Setup-<version>.exe` (send this to customers) and `dist\TradeOps-Setup-<version>.sha256.txt`.
* The installer is per-user (no admin rights): installs to `%LOCALAPPDATA%\Programs\TradeOps`, adds Start-menu and desktop shortcuts,
  closes a running copy during upgrades, and its uninstaller asks before touching customer data.
* The version comes from the `VERSION` file. The app icon comes from `assets/icon.ico` (regenerate with `tools/make_icon.py`).
* Needs Inno Setup 6 once: `winget install JRSoftware.InnoSetup`.
* **How to change and update the app later: see `UPDATING.md`.**
* `build_exe.bat` alone builds only `dist\TradeOps.exe` (no installer).

### Develop
```
python -m venv .venv && .venv\Scripts\pip install -r requirements-build.txt
cd backend && ..\.venv\Scripts\python manage.py migrate
..\.venv\Scripts\python manage.py runserver 8000      # API   (data in ./data)
cd ..\frontend && npm install && npm run dev            # UI    http://localhost:8080
..\.venv\Scripts\python manage.py test tradeops        # tests (from backend/)
```

## How the numbers work
* **Revenue** = grand total of sales orders when they are *finalized* (+ manual "other income").
* **Cost of goods** = quantity x the product's cost at the moment of finalizing.
* **Contractor cost** = `cost_to_company` of the jobs on finalized orders.
* **Operating expenses** = manual expenses (rent, electricity, ...).
* **Profit** = revenue - cost of goods - contractor cost - operating expenses.
* Customer payments and supplier payments are tracked per order (paid / partial / unpaid)
  and shown as cash received / supplier payments; they never change profit twice.
* Finalizing an order deducts stock and fails if stock is insufficient. Receiving a
  purchase order adds stock and recalculates the product's weighted-average cost.
* Finalized orders are locked; deleting one (admin) puts the goods back in stock.
