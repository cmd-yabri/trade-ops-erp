"""Cash box balances and statements, computed from the source records."""
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction

from invoice.models import Expense
from order.models import ClientPayment
from purchase_order.models import POPayment
from tradeops.currency import to_usd
from tradeops.errors import BusinessRuleError

from .models import BoxEntry, Exchange

ZERO = Decimal("0")
CENT = Decimal("0.01")
CURRENCIES = ("USD", "SYP")
NAMES = {"USD": "صندوق الدولار", "SYP": "صندوق الليرة السورية"}


def _move(when, kind, description, amount, ref, branch_id=None, stamp=None, *, edit_amount=None,
          edit_note="", edit_rate=None):
    return {"date": when, "kind": kind, "description": description, "amount": amount,
            "ref": ref, "branch": branch_id, "editable": edit_amount is not None,
            "edit_amount": edit_amount, "edit_note": edit_note, "edit_rate": edit_rate, "_stamp": stamp}


def movements(currency: str, branch: int | None = None, keep_stamp: bool = False) -> list[dict]:
    """Every movement of one box, oldest first. amount > 0 = money in, < 0 = money out.

    keep_stamp leaves each row's entry time in "_stamp" (to merge the boxes in one list)."""
    rows = []

    # Parts of an account lump sum are listed once, as the lump sum itself (accounts.cash_movements).
    payments = ClientPayment.objects.filter(currency=currency, account_payment__isnull=True).select_related("order")
    if branch:
        payments = payments.filter(order__branch_id=branch)
    for p in payments:
        rows.append(_move(p.date, "sale_payment", f"دفعة من العميل {p.order.client_name} (SO-{p.order_id})",
                          p.cash_amount, f"sale_payment:{p.id}", p.order.branch_id, p.created_at,
                          edit_amount=p.cash_amount, edit_rate=p.exchange_rate))

    paid = POPayment.objects.filter(currency=currency, account_payment__isnull=True).select_related("purchase_order")
    if branch:
        paid = paid.filter(purchase_order__branch_id=branch)
    for p in paid:
        rows.append(_move(p.payment_date, "supplier_payment",
                          f"دفعة للمورد {p.purchase_order.supplier} (PO-{p.purchase_order_id})",
                          -p.cash_amount, f"po_payment:{p.id}", p.purchase_order.branch_id, p.created_at,
                          edit_amount=p.cash_amount, edit_rate=p.exchange_rate))

    expenses = Expense.objects.filter(currency=currency)
    if branch:
        expenses = expenses.filter(branch_id=branch)
    for e in expenses:
        sign = 1 if e.type == "INCOME" else -1
        rows.append(_move(e.date, "income" if sign > 0 else "expense", e.description,
                          sign * e.cash_amount, f"expense:{e.id}", e.branch_id, e.created_at))
        rows[-1]["category"] = e.category
        rows[-1].update(editable=True, edit_amount=e.cash_amount, edit_note=e.description, edit_rate=e.exchange_rate)

    entries = BoxEntry.objects.filter(currency=currency)
    if branch:
        entries = entries.filter(branch_id=branch)
    for en in entries:
        sign = 1 if en.kind == BoxEntry.DEPOSIT else -1
        label = en.note or ("إيداع" if sign > 0 else "سحب")
        rows.append(_move(en.date, "deposit" if sign > 0 else "withdrawal", label,
                          sign * en.amount, f"entry:{en.id}", en.branch_id, en.created_at,
                          edit_amount=en.amount, edit_note=en.note))

    swaps = Exchange.objects.all()
    if branch:
        swaps = swaps.filter(branch_id=branch)
    for ex in swaps:
        label = f"تحويل {ex.from_currency} إلى {ex.to_currency} بسعر {ex.rate.normalize():f}"
        if ex.note:
            label += f" - {ex.note}"
        if ex.from_currency == currency:
            rows.append(_move(ex.date, "exchange_out", label, -ex.from_amount, f"exchange:{ex.id}", ex.branch_id,
                              ex.created_at, edit_amount=ex.from_amount, edit_note=ex.note, edit_rate=ex.rate))
        if ex.to_currency == currency:
            rows.append(_move(ex.date, "exchange_in", label, ex.to_amount, f"exchange:{ex.id}", ex.branch_id,
                              ex.created_at, edit_amount=ex.to_amount, edit_note=ex.note, edit_rate=ex.rate))

    from order.models import SalesReturn  # noqa: PLC0415
    from purchase_order.models import PurchaseReturn  # noqa: PLC0415

    refunds = SalesReturn.objects.filter(currency=currency, refund_to_credit=False,
                                         refund_amount__gt=0).select_related("order")
    if branch:
        refunds = refunds.filter(order__branch_id=branch)
    for r in refunds:
        rows.append(_move(r.date, "sale_refund", f"إعادة مبلغ للعميل {r.order.client_name} (مرتجع SO-{r.order_id})",
                          -r.cash_amount, f"sale_refund:{r.id}", r.order.branch_id, r.created_at,
                          edit_amount=r.cash_amount, edit_note=r.note, edit_rate=r.exchange_rate))
        if r.note:
            rows[-1]["description"] += f" - {r.note}"
    back = PurchaseReturn.objects.filter(currency=currency, refund_to_credit=False,
                                         refund_amount__gt=0).select_related("purchase_order")
    if branch:
        back = back.filter(purchase_order__branch_id=branch)
    for r in back:
        rows.append(_move(r.date, "supplier_refund",
                          f"استرداد من المورد {r.purchase_order.supplier} (مرتجع PO-{r.purchase_order_id})",
                          r.cash_amount, f"supplier_refund:{r.id}", r.purchase_order.branch_id, r.created_at,
                          edit_amount=r.cash_amount, edit_note=r.note, edit_rate=r.exchange_rate))
        if r.note:
            rows[-1]["description"] += f" - {r.note}"

    from accounts.services import cash_movements  # noqa: PLC0415
    from partners.services import withdrawal_movements  # noqa: PLC0415

    rows.extend(withdrawal_movements(currency, branch))
    rows.extend(cash_movements(currency, branch))

    # Same day: in the order things were entered; rows from before entry times were kept
    # come first, money in before money out.
    rows.sort(key=lambda r: (r["date"], r.get("_stamp") or datetime.min, 0 if r["amount"] > 0 else 1, r["ref"]))
    if not keep_stamp:
        for row in rows:
            row.pop("_stamp", None)
    return rows


def balance(currency: str, branch: int | None = None) -> Decimal:
    return sum((r["amount"] for r in movements(currency, branch)), ZERO)


def summary(branch: int | None = None) -> list[dict]:
    out = []
    for currency in CURRENCIES:
        rows = movements(currency, branch)
        out.append({
            "currency": currency, "name": NAMES[currency],
            "balance": sum((r["amount"] for r in rows), ZERO),
            "total_in": sum((r["amount"] for r in rows if r["amount"] > 0), ZERO),
            "total_out": -sum((r["amount"] for r in rows if r["amount"] < 0), ZERO),
        })
    return out


@transaction.atomic
def add_entry(currency: str, kind: str, amount: Decimal, note: str = "", when: date | None = None,
              branch_id: int | None = None) -> BoxEntry:
    if kind == BoxEntry.WITHDRAWAL and amount > balance(currency):
        raise BusinessRuleError("الرصيد في الصندوق لا يكفي لهذا السحب.")
    return BoxEntry.objects.create(currency=currency, kind=kind, amount=amount, note=note,
                                   date=when or date.today(), branch_id=branch_id)


@transaction.atomic
def edit_movement(ref: str, currency: str, amount: Decimal, when: date, note: str = "",
                  rate: Decimal | None = None) -> None:
    """Edit a cashbox line by updating its source transaction and related accounting."""
    from accounts.models import AccountPayment  # noqa: PLC0415
    from accounts.services import apply_credit  # noqa: PLC0415
    from invoice.models import Expense  # noqa: PLC0415
    from inventory.opening import correct_payment  # noqa: PLC0415
    from order.models import ClientPayment, SalesReturn  # noqa: PLC0415
    from partners.models import PartnerWithdrawal  # noqa: PLC0415
    from partners.services import assert_period_open  # noqa: PLC0415
    from purchase_order.models import POPayment, PurchaseOrder, PurchaseReturn  # noqa: PLC0415

    def usd_value(old_currency: str, old_rate: Decimal | None) -> Decimal:
        if currency == "USD":
            return amount
        conversion_rate = rate or old_rate
        if not conversion_rate or conversion_rate <= ZERO:
            raise BusinessRuleError("أدخل سعر صرف صالحاً لتحرير حركة بالليرة.")
        value = to_usd(amount, conversion_rate)
        if value < CENT:
            raise BusinessRuleError("المبلغ صغير جداً بعد التحويل إلى الدولار.")
        return value

    def check_period(old_date) -> None:
        assert_period_open(old_date, "الحركة الأصلية")
        assert_period_open(when, "تاريخ الحركة الجديد")

    if amount < CENT:
        raise BusinessRuleError("المبلغ يجب أن يكون أكبر من صفر.")

    if ":" not in ref:
        raise BusinessRuleError("الحركة المطلوب تعديلها غير معروفة.")
    kind, raw_id = ref.split(":", 1)
    if not raw_id.isdigit():
        raise BusinessRuleError("الحركة المطلوب تعديلها غير معروفة.")
    pk = int(raw_id)

    if kind == "entry":
        entry = BoxEntry.objects.select_for_update().filter(pk=pk, currency=currency).first()
        if entry is None:
            raise BusinessRuleError("حركة الصندوق غير موجودة.")
        check_period(entry.date)
        if entry.kind == BoxEntry.WITHDRAWAL and amount > balance(currency, entry.branch_id) + entry.amount:
            raise BusinessRuleError("الرصيد في الصندوق لا يكفي لهذا السحب.")
        entry.amount, entry.date, entry.note = amount, when, note
        entry.save(update_fields=["amount", "date", "note"])
        return

    if kind == "expense":
        expense = Expense.objects.select_for_update().filter(pk=pk, currency=currency).first()
        if expense is None:
            raise BusinessRuleError("حركة الصندوق غير موجودة.")
        check_period(expense.date)
        value = usd_value(expense.currency, expense.exchange_rate)
        if expense.purchase_order_id:
            from purchase_order.services import set_transport  # noqa: PLC0415

            po = expense.purchase_order
            set_transport(po, value, PurchaseOrder.CARRIER, currency=currency,
                          paid_amount=amount if currency == "SYP" else None,
                          exchange_rate=rate if currency == "SYP" else None, pay_date=when)
            expense.refresh_from_db()
            expense.description = note[:200]
            expense.save(update_fields=["description"])
            return
        if expense.opening_stock_id:
            correct_payment(expense.opening_stock, amount=value, currency=currency,
                            paid_amount=amount if currency == "SYP" else None,
                            exchange_rate=rate if currency == "SYP" else None, when=when)
            expense.refresh_from_db()
            expense.description = note[:200]
            expense.save(update_fields=["description"])
            return
        expense.amount = value
        expense.paid_amount = amount if currency == "SYP" else value
        expense.exchange_rate = (rate or expense.exchange_rate) if currency == "SYP" else None
        expense.date, expense.description = when, note[:200]
        expense.save(update_fields=["amount", "paid_amount", "exchange_rate", "date", "description"])
        return

    if kind == "sale_payment":
        payment = ClientPayment.objects.select_for_update().select_related("order").filter(
            pk=pk, currency=currency, account_payment__isnull=True,
        ).first()
        if payment is None:
            raise BusinessRuleError("دفعة البيع غير موجودة أو مرتبطة بدفعة حساب.")
        check_period(payment.date)
        value = usd_value(payment.currency, payment.exchange_rate)
        if value > payment.order.remaining + payment.amount:
            raise BusinessRuleError("المبلغ أكبر من المتبقي على طلب البيع.")
        payment.amount, payment.date = value, when
        payment.paid_amount = amount if currency == "SYP" else None
        payment.exchange_rate = (rate or payment.exchange_rate) if currency == "SYP" else None
        payment.save(update_fields=["amount", "date", "paid_amount", "exchange_rate"])
        return

    if kind == "po_payment":
        payment = POPayment.objects.select_for_update().select_related("purchase_order").filter(
            pk=pk, currency=currency, account_payment__isnull=True,
        ).first()
        if payment is None:
            raise BusinessRuleError("دفعة الشراء غير موجودة أو مرتبطة بدفعة حساب.")
        check_period(payment.payment_date)
        if payment.purchase_order.status == "CANCELLED":
            raise BusinessRuleError("لا يمكن تعديل دفعة أمر شراء ملغى.")
        value = usd_value(payment.currency, payment.exchange_rate)
        if value > payment.purchase_order.remaining + payment.amount:
            raise BusinessRuleError("المبلغ أكبر من المتبقي على أمر الشراء.")
        payment.amount, payment.payment_date = value, when
        payment.paid_amount = amount if currency == "SYP" else None
        payment.exchange_rate = (rate or payment.exchange_rate) if currency == "SYP" else None
        payment.save(update_fields=["amount", "payment_date", "paid_amount", "exchange_rate"])
        if payment.purchase_order.account_id:
            apply_credit(payment.purchase_order.account)
        return

    if kind == "exchange":
        swap = Exchange.objects.select_for_update().filter(pk=pk).first()
        if swap is None or currency not in (swap.from_currency, swap.to_currency):
            raise BusinessRuleError("حركة التحويل غير موجودة.")
        check_period(swap.date)
        new_rate = rate or swap.rate
        if new_rate <= ZERO:
            raise BusinessRuleError("سعر الصرف يجب أن يكون أكبر من صفر.")
        if currency == swap.from_currency:
            from_amount = amount
            to_amount = (amount * new_rate if currency == "USD" else amount / new_rate)
        else:
            to_amount = amount
            from_amount = amount / new_rate if swap.from_currency == "USD" else amount * new_rate
        from_amount = from_amount.quantize(CENT, rounding=ROUND_HALF_UP)
        to_amount = to_amount.quantize(CENT, rounding=ROUND_HALF_UP)
        if from_amount < CENT or to_amount < CENT:
            raise BusinessRuleError("المبلغ صغير جداً بعد التحويل.")
        if from_amount > balance(swap.from_currency, swap.branch_id) + swap.from_amount:
            raise BusinessRuleError("الرصيد في صندوق التحويل لا يكفي.")
        swap.from_amount, swap.to_amount, swap.rate = from_amount, to_amount, new_rate
        swap.date, swap.note = when, note[:300]
        swap.save(update_fields=["from_amount", "to_amount", "rate", "date", "note"])
        return

    if kind in ("sale_refund", "supplier_refund"):
        model = SalesReturn if kind == "sale_refund" else PurchaseReturn
        relation = "order" if kind == "sale_refund" else "purchase_order"
        refund = model.objects.select_for_update().select_related(relation).filter(
            pk=pk, currency=currency, refund_to_credit=False,
        ).first()
        if refund is None:
            raise BusinessRuleError("حركة المرتجع غير موجودة أو ليست دفعة نقدية.")
        check_period(refund.date)
        value = usd_value(refund.currency, refund.exchange_rate)
        if kind == "sale_refund":
            from accounts.services import direct_paid  # noqa: PLC0415

            order = refund.order
            previous = sum((r.refund_amount for r in order.returns.exclude(pk=refund.pk)), ZERO)
            max_refund = max(direct_paid(order) - previous - order.net_total, ZERO)
            if value > max_refund.quantize(CENT, rounding=ROUND_HALF_UP):
                raise BusinessRuleError("المبلغ يتجاوز المبلغ المستحق إعادته للعميل.")
        else:
            from accounts.services import direct_paid  # noqa: PLC0415

            po = refund.purchase_order
            previous = sum((r.refund_amount for r in po.returns.exclude(pk=refund.pk)), ZERO)
            max_refund = max(direct_paid(po) - previous - po.due_total, ZERO)
            if value > max_refund.quantize(CENT, rounding=ROUND_HALF_UP):
                raise BusinessRuleError("المبلغ يتجاوز المبلغ المستحق استرداده من المورد.")
        refund.refund_amount, refund.date, refund.note = value, when, note[:300]
        refund.paid_amount = amount if currency == "SYP" else None
        refund.exchange_rate = (rate or refund.exchange_rate) if currency == "SYP" else None
        refund.save(update_fields=["refund_amount", "date", "note", "paid_amount", "exchange_rate"])
        return

    if kind == "withdrawal":
        withdrawal = PartnerWithdrawal.objects.select_for_update().filter(pk=pk, currency=currency).first()
        if withdrawal is None:
            raise BusinessRuleError("حركة سحب الشريك غير موجودة.")
        check_period(withdrawal.date)
        withdrawal.amount = usd_value(withdrawal.currency, withdrawal.exchange_rate)
        withdrawal.paid_amount = amount if currency == "SYP" else None
        withdrawal.exchange_rate = (rate or withdrawal.exchange_rate) if currency == "SYP" else None
        withdrawal.date, withdrawal.note = when, note[:300]
        withdrawal.save(update_fields=["amount", "paid_amount", "exchange_rate", "date", "note"])
        return

    if kind == "account_payment":
        payment = AccountPayment.objects.select_for_update().select_related("account").filter(
            pk=pk, currency=currency, sales_return__isnull=True, purchase_return__isnull=True,
        ).first()
        if payment is None:
            raise BusinessRuleError("دفعة الحساب غير موجودة.")
        check_period(payment.date)
        account = payment.account
        # Rebuild allocations in date order after changing this lump sum.
        for lump in account.payments.filter(sales_return__isnull=True, purchase_return__isnull=True):
            lump.client_payments.all().delete()
            lump.po_payments.all().delete()
        payment.amount = usd_value(payment.currency, payment.exchange_rate)
        payment.paid_amount = amount if currency == "SYP" else None
        payment.exchange_rate = (rate or payment.exchange_rate) if currency == "SYP" else None
        payment.date, payment.note = when, note[:300]
        payment.save(update_fields=["amount", "paid_amount", "exchange_rate", "date", "note"])
        apply_credit(account)
        return

    raise BusinessRuleError("لا يمكن تعديل نوع حركة الصندوق هذا.")


@transaction.atomic
def exchange(from_currency: str, from_amount: Decimal, rate: Decimal, note: str = "",
             when: date | None = None, branch_id: int | None = None) -> Exchange:
    """Move money between the boxes. rate = SYP per 1 USD; works in both directions."""
    if from_currency not in CURRENCIES:
        raise BusinessRuleError("عملة غير معروفة.")
    if from_amount <= ZERO or rate <= ZERO:
        raise BusinessRuleError("أدخل مبلغاً وسعر صرف أكبر من صفر.")
    if from_amount > balance(from_currency):
        raise BusinessRuleError("الرصيد في الصندوق لا يكفي لهذا التحويل.")
    if from_currency == "SYP":
        to_currency, to_amount = "USD", from_amount / rate
    else:
        to_currency, to_amount = "SYP", from_amount * rate
    to_amount = to_amount.quantize(CENT, rounding=ROUND_HALF_UP)
    if to_amount < CENT:
        raise BusinessRuleError("المبلغ صغير جداً بعد التحويل.")
    return Exchange.objects.create(
        from_currency=from_currency, to_currency=to_currency, from_amount=from_amount,
        to_amount=to_amount, rate=rate, note=note, date=when or date.today(), branch_id=branch_id,
    )
