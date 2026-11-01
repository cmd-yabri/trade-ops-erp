"""Account ledgers: what each wholesale customer / supplier owes, computed on demand.

Sign convention: balance > 0 = the account owes us (debtor), balance < 0 = we owe the account (creditor).
  + sales orders (grand total, drafts too)          - customer payments (order payments and lump sums)
  - purchase orders from the day they are created   + our payments to the supplier
    (cancelled ones drop out)
  +/- manual entries (opening balance, adjustments)

An order counts as soon as it exists so a payment made on it can never show up alone
(the old rule counted only finalized / received orders, so a deposit read as the wrong side).
"""
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction

from order.models import ClientPayment
from purchase_order.models import POPayment
from tradeops.errors import BusinessRuleError

from .models import Account, AccountEntry, AccountPayment

ZERO = Decimal("0")
CENT = Decimal("0.01")


def _line(when, kind, description, debit, credit, ref, stamp=None):
    return {"date": when, "kind": kind, "description": description, "debit": debit, "credit": credit, "ref": ref,
            "_stamp": stamp}


def _money(amount: Decimal) -> str:
    return f"${amount:,.2f}"


def _cash_note(p) -> str:
    """' (1,300,000 ل.س بسعر 13,000)' for a payment handed over in SYP."""
    if p.currency == "SYP" and p.paid_amount is not None:
        return f" ({p.paid_amount:,.0f} ل.س بسعر {p.exchange_rate.normalize():,f})"
    return ""


def _spread_label(ap: AccountPayment) -> str:
    """What a lump sum paid: 'دفعة مستلمة: SO-1 $100، SO-2 $50، رصيد للحساب $20'."""
    inbound = ap.direction == AccountPayment.IN
    prefix = "SO" if inbound else "PO"
    parts = [f"{prefix}-{c.order_id if inbound else c.purchase_order_id} {_money(c.amount)}"
             for c in _children(ap).order_by("id")]
    rest = leftover(ap)
    if rest > ZERO:
        parts.append(f"رصيد للحساب {_money(rest)}")
    head = "دفعة مستلمة" if inbound else "دفعة مدفوعة"
    if ap.note:
        head += f" - {ap.note}"
    return f"{head}{_cash_note(ap)}: " + "، ".join(parts) if parts else head + _cash_note(ap)


def ledger(account: Account) -> list[dict]:
    """Statement lines oldest first, each with the running balance."""
    lines = []

    sales = account.sales_orders.prefetch_related("items", "freelance_jobs")
    for order in sales:
        label = f"فاتورة بيع SO-{order.id}" + ("" if order.is_finalized else " (لم تُنهَ بعد)")
        lines.append(_line((order.finalized_at or order.date).date(), "sale", label,
                           order.grand_total, ZERO, f"so:{order.id}", order.finalized_at or order.date))
    for pay in ClientPayment.objects.filter(order__account=account, account_payment__isnull=True):
        lines.append(_line(pay.date, "payment_in", f"دفعة على SO-{pay.order_id}{_cash_note(pay)}", ZERO, pay.amount,
                           f"cp:{pay.id}", pay.created_at))

    for po in account.purchase_orders.exclude(status="CANCELLED").prefetch_related("items", "payments"):
        label = f"أمر شراء PO-{po.id}" + {"RECEIVED": "", "PARTIAL": " (مستلم جزئياً)"}.get(po.status, " (لم يُستلم بعد)")
        lines.append(_line(po.order_date, "purchase", label, ZERO, po.net_total, f"po:{po.id}", po.created_at))
    for pay in POPayment.objects.filter(purchase_order__account=account, account_payment__isnull=True):
        lines.append(_line(pay.payment_date, "payment_out", f"دفعة على PO-{pay.purchase_order_id}{_cash_note(pay)}",
                           pay.amount, ZERO, f"pp:{pay.id}", pay.created_at))

    from order.models import SalesReturn  # noqa: PLC0415
    from purchase_order.models import PurchaseReturn  # noqa: PLC0415

    for r in SalesReturn.objects.filter(order__account=account).prefetch_related("lines"):
        lines.append(_line(r.date, "return", f"مرتجع من فاتورة SO-{r.order_id}", ZERO, r.value, f"sr:{r.id}", r.created_at))
        if r.refund_amount > ZERO:
            label = (f"نقل المبلغ الزائد إلى رصيد الحساب (مرتجع SO-{r.order_id})" if r.refund_to_credit
                     else f"إعادة مبلغ للعميل (مرتجع SO-{r.order_id}){_cash_note(r)}")
            lines.append(_line(r.date, "refund", label, r.refund_amount, ZERO, f"sf:{r.id}", r.created_at))
    for r in PurchaseReturn.objects.filter(purchase_order__account=account).prefetch_related("lines"):
        lines.append(_line(r.date, "return", f"مرتجع إلى المورد من PO-{r.purchase_order_id}", r.value, ZERO,
                           f"pr:{r.id}", r.created_at))
        if r.refund_amount > ZERO:
            label = (f"نقل المبلغ الزائد إلى رصيد لنا عنده (مرتجع PO-{r.purchase_order_id})" if r.refund_to_credit
                     else f"استرداد مبلغ من المورد (مرتجع PO-{r.purchase_order_id}){_cash_note(r)}")
            lines.append(_line(r.date, "refund", label, ZERO, r.refund_amount, f"pf:{r.id}", r.created_at))

    for ap in account.payments.all():
        if ap.direction == AccountPayment.IN:
            lines.append(_line(ap.date, "payment_in", _spread_label(ap), ZERO, ap.amount, f"ap:{ap.id}", ap.created_at))
        else:
            lines.append(_line(ap.date, "payment_out", _spread_label(ap), ap.amount, ZERO, f"ap:{ap.id}",
                               ap.created_at))

    for en in account.entries.all():
        label = en.note or "قيد يدوي"
        if en.kind == AccountEntry.DEBIT:
            lines.append(_line(en.date, "entry", label, en.amount, ZERO, f"en:{en.id}"))
        else:
            lines.append(_line(en.date, "entry", label, ZERO, en.amount, f"en:{en.id}"))

    # Same day: opening / manual entries first, then everything in the order it was entered
    # (rows from before entry times were kept fall back to invoices before payments).
    rank = {"entry": 0, "sale": 1, "purchase": 1, "payment_in": 2, "payment_out": 2, "return": 3, "refund": 4}
    lines.sort(key=lambda r: (
        r["date"], r["kind"] != "entry", r["_stamp"] or datetime.min, rank.get(r["kind"], 3),
        int(r["ref"].split(":")[1]),
    ))
    running = ZERO
    for line in lines:
        del line["_stamp"]
        line["debit"] = line["debit"].quantize(CENT, rounding=ROUND_HALF_UP)
        line["credit"] = line["credit"].quantize(CENT, rounding=ROUND_HALF_UP)
        running += line["debit"] - line["credit"]
        line["balance"] = running
    return lines


def open_orders(account: Account) -> list[dict]:
    """Every invoice of the account that still has money open, oldest first, for the statement."""
    rows = []
    for o in account.sales_orders.order_by("date", "id").prefetch_related("items", "freelance_jobs", "payments"):
        if o.remaining > ZERO:
            rows.append({"ref": f"SO-{o.id}", "kind": "sale", "date": (o.finalized_at or o.date).date(),
                         "total": o.net_total, "paid": o.total_paid, "remaining": o.remaining,
                         "state": "منتهٍ" if o.is_finalized else "لم يُنهَ"})
    for po in account.purchase_orders.exclude(status="CANCELLED").order_by("order_date", "id") \
            .prefetch_related("items", "payments"):
        if po.remaining > ZERO:
            rows.append({"ref": f"PO-{po.id}", "kind": "purchase", "date": po.order_date,
                         "total": po.due_total, "paid": po.paid_amount, "remaining": po.remaining,
                         "state": {"RECEIVED": "مستلم", "PARTIAL": "مستلم جزئياً"}.get(po.status, "لم يُستلم")})
    for row in rows:
        for key in ("total", "paid", "remaining"):
            row[key] = row[key].quantize(CENT, rounding=ROUND_HALF_UP)
    return rows


def balance(account: Account) -> Decimal:
    lines = ledger(account)
    return lines[-1]["balance"] if lines else ZERO


def totals(account: Account) -> dict:
    """What we sold them / received from them, what we bought from them / paid them, and the net balance."""
    sales = sum((o.net_total for o in account.sales_orders.prefetch_related("items", "freelance_jobs", "returns__lines")),
                ZERO)
    bought = sum((po.due_total for po in account.purchase_orders.exclude(status="CANCELLED")
                  .prefetch_related("items", "returns__lines")), ZERO)
    cash_lumps = account.payments.filter(sales_return__isnull=True, purchase_return__isnull=True)
    received = (
        sum((p.amount for p in ClientPayment.objects.filter(order__account=account, account_payment__isnull=True)), ZERO)
        + sum((ap.amount for ap in cash_lumps.filter(direction=AccountPayment.IN)), ZERO)
        - sum((r.refund_amount for r in _sales_refunds(account)), ZERO)
    )
    paid = (
        sum((p.amount for p in POPayment.objects.filter(purchase_order__account=account, account_payment__isnull=True)),
            ZERO)
        + sum((ap.amount for ap in cash_lumps.filter(direction=AccountPayment.OUT)), ZERO)
        - sum((r.refund_amount for r in _purchase_refunds(account)), ZERO)
    )
    net = balance(account)
    q = lambda v: v.quantize(CENT, rounding=ROUND_HALF_UP)  # noqa: E731
    return {"total_sales": q(sales), "total_received": q(received),
            "total_purchases": q(bought), "total_paid": q(paid), "balance": net}


def _sales_refunds(account):
    from order.models import SalesReturn  # noqa: PLC0415

    return SalesReturn.objects.filter(order__account=account, refund_to_credit=False, refund_amount__gt=0)


def _purchase_refunds(account):
    from purchase_order.models import PurchaseReturn  # noqa: PLC0415

    return PurchaseReturn.objects.filter(purchase_order__account=account, refund_to_credit=False, refund_amount__gt=0)


def _split_cash(total_usd: Decimal, paid_cash: Decimal, parts: list[Decimal]) -> list[Decimal]:
    """Share the cash handed over between the orders in proportion to the USD parts, never exceeding it."""
    shares, used = [], ZERO
    for part in parts:
        share = (paid_cash * part / total_usd).quantize(CENT, rounding=ROUND_HALF_UP)
        share = min(share, paid_cash - used)
        shares.append(share)
        used += share
    return shares


@transaction.atomic
def record_payment(account: Account, direction: str, amount: Decimal, *, currency="USD", paid_amount=None,
                   exchange_rate=None, when: date | None = None, note: str = "", branch_id=None) -> AccountPayment:
    """Lump-sum payment: spread over the oldest unpaid orders, the rest stays as credit on the account."""
    ap = AccountPayment.objects.create(
        account=account, direction=direction, amount=amount, currency=currency, paid_amount=paid_amount,
        exchange_rate=exchange_rate, date=when or date.today(), note=note, branch_id=branch_id,
    )
    apply_credit(account)
    return ap


def _children(ap: AccountPayment):
    return ap.client_payments.all() if ap.direction == AccountPayment.IN else ap.po_payments.all()


def leftover(ap: AccountPayment) -> Decimal:
    """USD value of a lump sum not yet spread over orders (credit held on the account)."""
    return ap.amount - sum((c.amount for c in _children(ap)), ZERO)


def leftover_cash(ap: AccountPayment) -> Decimal:
    """Cash of a lump sum that was not spread over orders (credit held on the account)."""
    spent = sum((c.cash_amount for c in _children(ap)), ZERO)
    return ap.cash_amount - spent


def _open_orders(account: Account, direction: str) -> list:
    if direction == AccountPayment.IN:
        orders = account.sales_orders.order_by("date", "id").prefetch_related("items", "freelance_jobs", "payments")
    else:
        orders = account.purchase_orders.exclude(status="CANCELLED").order_by("order_date", "id") \
            .prefetch_related("items", "payments")
    return [[o, o.remaining] for o in orders if o.remaining > ZERO]


@transaction.atomic
def apply_credit(account: Account | None) -> None:
    """Spread every lump sum's unused part over the account's unpaid orders, oldest first on both sides.

    Called after a payment and whenever an order of the account is created, changed or removed, so
    money the account already has with us settles new invoices on its own (no "unpaid" order while the
    account sits in credit).
    """
    if account is None:
        return
    for direction in (AccountPayment.IN, AccountPayment.OUT):
        credits = [(ap, leftover(ap)) for ap in account.payments.filter(direction=direction).order_by("date", "id")]
        credits = [(ap, rest) for ap, rest in credits if rest > ZERO]
        if not credits:
            continue
        open_items = _open_orders(account, direction)
        for ap, available in credits:
            available_cash = leftover_cash(ap)
            rest, picks = available, []
            for item in open_items:
                if rest <= ZERO:
                    break
                part = min(rest, item[1])
                if part <= ZERO:
                    continue
                picks.append((item[0], part))
                item[1] -= part
                rest -= part
            if not picks:
                break  # nothing left to pay on this side
            # cash handed over in proportion; a fully used lump sum gives its last cent to the last order
            cash_parts = _split_cash(available, available_cash, [part for _, part in picks])
            if rest <= ZERO:
                cash_parts[-1] = available_cash - sum(cash_parts[:-1], ZERO)
            for (order, part), cash_part in zip(picks, cash_parts):
                common = {"amount": part, "currency": ap.currency, "account_payment": ap,
                          "paid_amount": cash_part if ap.currency != "USD" else None,
                          "exchange_rate": ap.exchange_rate}
                if direction == AccountPayment.IN:
                    ClientPayment.objects.create(order=order, date=ap.date, **common)
                else:
                    POPayment.objects.create(purchase_order=order, payment_date=ap.date, **common)


def release_credit(order) -> None:
    """Hand the lump-sum parts paid on this order back to the account (before an edit or removal)."""
    order.payments.filter(account_payment__isnull=False).delete()


def direct_paid(order) -> Decimal:
    """What was paid on this order itself (not spread from an account lump sum)."""
    return sum((p.amount for p in order.payments.all() if p.account_payment_id is None), ZERO)


@transaction.atomic
def settle_removed_payments(order, account: Account | None, action: str, *, inbound: bool, branch_id=None) -> None:
    """Money paid directly on an order that is being deleted / cancelled.

    action "refund": the money went back (the payments are removed, the box follows).
    action "credit": it stays with us as a lump sum on the order's account, ready for its other orders.
    """
    direct = [p for p in order.payments.all() if p.account_payment_id is None]
    if action == "credit":
        if account is None:
            raise BusinessRuleError("لا يمكن حفظ المبلغ رصيداً لأن الطلب غير مرتبط بحساب.")
        prefix = "SO" if inbound else "PO"
        for p in direct:
            AccountPayment.objects.create(
                account=account, direction=AccountPayment.IN if inbound else AccountPayment.OUT,
                amount=p.amount, currency=p.currency, paid_amount=p.paid_amount, exchange_rate=p.exchange_rate,
                date=p.date if inbound else p.payment_date, branch_id=branch_id,
                note=f"رصيد من دفعات {prefix}-{order.pk}",
            )
    for p in direct:
        p.delete()


def cash_movements(currency: str, branch: int | None = None) -> list[dict]:
    """Lump-sum payments for the cash box statement: one line for the whole amount handed over,
    saying which orders it paid (its order parts are not listed again)."""
    # lump sums that are credit moved from a return carry no cash
    rows = AccountPayment.objects.filter(currency=currency, sales_return__isnull=True,
                                         purchase_return__isnull=True).select_related("account")
    if branch:
        rows = rows.filter(branch_id=branch)
    out = []
    for ap in rows:
        inbound = ap.direction == AccountPayment.IN
        cash = ap.cash_amount
        out.append({
            "date": ap.date, "kind": "account_in" if inbound else "account_out",
            "description": f"{'من' if inbound else 'إلى'} {ap.account.name} - {_spread_label(ap)}",
            "amount": cash if inbound else -cash, "ref": f"account_payment:{ap.id}", "branch": ap.branch_id,
            "editable": True, "edit_amount": ap.cash_amount, "edit_note": ap.note,
            "edit_rate": ap.exchange_rate, "_stamp": ap.created_at,
        })
    return out
