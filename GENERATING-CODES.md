# Generating codes for customers

Two different codes, two different keys. Run everything from `C:\Users\msi\Desktop\Solar-Ops`.
The private keys live in `C:\Users\msi\TradeOps-vendor\` (backup: `D:\TradeOps-vendor-backup\`). Never send, commit or share them.

---

## 1. Activation key (license) - customer wants to activate or renew

1. The customer opens the **License** page (amber bar -> "تفعيل البرنامج", or Settings -> الترخيص) and reads you the
   **machine code**, e.g. `09D6-3F0F-35C9-B5C5`.
2. You run (one line):

```
.venv\Scripts\python tools\license_tool.py issue --key C:\Users\msi\TradeOps-vendor\license_private.pem --machine 09D6-3F0F-35C9-B5C5 --customer "Customer name" --expires 2027-12-31
```

3. Send the customer the long line it prints (`xxxxx.yyyyy`). They paste it into the box and press **تفعيل**.

- **Perpetual license:** leave out `--expires`.
- **Renewal:** issue a new key with a later `--expires`; they paste it over the old one.
- The key only works on that one PC (it contains the machine code) and needs no internet.
- A customer who reinstalls Windows gets a new machine code -> issue a new key.
- Keep a record per customer: name, machine code, key, expiry, date issued.

---

## 2. Recovery code - customer forgot their password

1. On the login screen the customer clicks **نسيت كلمة المرور؟**. The page shows a **request code**
   (nine groups, e.g. `0DC4-205D-44F1-CA3B-193F-B3DF-EB3D-CC8F-0000`). They read it to you with their **username**.
2. You run (one line):

```
.venv\Scripts\python tools\recovery_tool.py code --key C:\Users\msi\TradeOps-vendor\recovery_private.pem --request 0DC4-205D-44F1-CA3B-193F-B3DF-EB3D-CC8F-0000 --username owner
```

3. Send them the code it prints. They paste it into the page, choose a new password and press the button.

- Each code works **once**, for that username, on that installation. If they need another, they reopen the forgot-password
  page and read you the **new** request code (the number at the end changes after each reset).
- Any other admin can also reset a password in Settings -> Users without a code.

---

## Quick reference
| Need | Tool | Key file |
|---|---|---|
| Activate / renew | `tools\license_tool.py issue` | `license_private.pem` |
| Forgotten password | `tools\recovery_tool.py code` | `recovery_private.pem` |

Developing and want to skip the trial lock? Set `TRADEOPS_LICENSE_BYPASS=1` (ignored in the real exe).
More detail: `README.md` (licensing section) and `UPDATING.md`.
