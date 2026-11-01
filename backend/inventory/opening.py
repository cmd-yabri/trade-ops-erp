"""Opening stock: goods entered with a new product, paid from a cash box or not, linkable to a supplier later."""
from datetime import date, datetime, time

from django.db import transaction

from tradeops.errors import BusinessRuleError

from .models import OpeningStock


@transaction.atomic
def link_to_supplier(opening: OpeningStock, *, account=None, supplier: str = "", phone: str = ""):
    """Turn opening stock into a received purchase order of that supplier.

    The goods are already in stock, so nothing is added again: the order only puts the debt on the
    supplier's balance (where it can be paid). Payments go through the order as usual.
    """
    from accounts.services import apply_credit  # noqa: PLC0415
    from purchase_order.models import POPayment, PurchaseOrder, PurchaseOrderItem  # noqa: PLC0415

    opening = OpeningStock.objects.select_for_update().select_related("product").get(pk=opening.pk)
    if opening.purchase_order_id:
        raise BusinessRuleError(f"هذا الرصيد مرتبط مسبقاً بأمر الشراء PO-{opening.purchase_order_id}.")
    if account is not None and not account.is_supplier:
        raise BusinessRuleError("هذا الحساب ليس مورداً.")
    name = (account.name if account is not None else supplier).strip()
    if not name:
        raise BusinessRuleError("اختر حساب المورد أو اكتب اسمه.")

    po = PurchaseOrder.objects.create(
        supplier=name, supplier_phone="" if account is not None else phone.strip(), account=account,
        branch=opening.branch, order_date=opening.date, status="RECEIVED",
        received_at=datetime.combine(opening.date, time.min),
    )
    PurchaseOrderItem.objects.create(
        purchase_order=po, product=opening.product, quantity=opening.quantity, unit_cost=opening.unit_cost,
        received_quantity=opening.quantity, landed_unit_cost=opening.unit_cost,
    )
    opening.purchase_order = po
    opening.save(update_fields=["purchase_order"])
    paid = _payment(opening)
    if paid is not None:
        # what was paid from the box becomes a payment to that supplier (the same cash, counted once)
        POPayment.objects.create(purchase_order=po, amount=paid.amount, payment_date=paid.date,
                                 currency=paid.currency, paid_amount=paid.paid_amount,
                                 exchange_rate=paid.exchange_rate, opening_stock=opening)
        paid.delete()
    apply_credit(account)
    return po


@transaction.atomic
def unlink(opening: OpeningStock) -> None:
    """Undo a link (the goods stay in stock): only while nothing was paid on that order."""
    opening = OpeningStock.objects.select_for_update().get(pk=opening.pk)
    po = opening.purchase_order
    if po is None:
        return
    if po.payments.exists():
        raise BusinessRuleError("على أمر الشراء المرتبط دفعات. احذف الدفعات أولاً.")
    account = po.account
    opening.purchase_order = None
    opening.save(update_fields=["purchase_order"])
    po.delete()
    if account is not None:
        from accounts.services import apply_credit  # noqa: PLC0415

        apply_credit(account)


def _payment(opening: OpeningStock):
    from invoice.models import Expense  # noqa: PLC0415

    return Expense.objects.filter(opening_stock=opening).first()


def _record_payment(opening, amount, *, currency, paid_amount, exchange_rate, when):
    from invoice.models import Expense  # noqa: PLC0415

    return Expense.objects.create(
        type="EXPENSE", category=Expense.STOCK_CATEGORY, amount=amount,
        description=f"شراء بضاعة: {opening.product.name} × {opening.quantity.normalize():f} (رصيد افتتاحي)",
        currency=currency, paid_amount=paid_amount if currency != "USD" else amount,
        exchange_rate=exchange_rate if currency != "USD" else None,
        date=when or date.today(), branch_id=opening.branch_id, opening_stock=opening,
    )


@transaction.atomic
def pay_from_box(opening: OpeningStock, amount, *, currency: str = "USD", paid_amount=None, exchange_rate=None,
                 when: date | None = None):
    """Record that the opening stock was paid from a cash box: a STOCK expense (cash out, not a
    profit deduction: the goods reach profit as cost of goods when sold)."""
    from partners.services import assert_period_open  # noqa: PLC0415

    opening = OpeningStock.objects.select_for_update().select_related("product").get(pk=opening.pk)
    if opening.purchase_order_id:
        raise BusinessRuleError(f"هذا الرصيد مرتبط بالمورد في PO-{opening.purchase_order_id}. ادفع من أمر الشراء.")
    if _payment(opening) is not None:
        raise BusinessRuleError("تم تسجيل دفع هذا الرصيد مسبقاً.")
    assert_period_open(when or date.today(), "دفع الرصيد الافتتاحي")
    return _record_payment(opening, amount, currency=currency, paid_amount=paid_amount,
                           exchange_rate=exchange_rate, when=when)


@transaction.atomic
def cancel_payment(opening: OpeningStock) -> None:
    from partners.services import assert_period_open  # noqa: PLC0415
    from purchase_order.models import POPayment  # noqa: PLC0415

    paid = _payment(opening)
    if paid is not None:
        assert_period_open(paid.date, "دفع الرصيد الافتتاحي")
        paid.delete()
        return
    supplier_payment = POPayment.objects.select_for_update().filter(opening_stock=opening).first()
    if supplier_payment is not None:
        assert_period_open(supplier_payment.payment_date, "دفع الرصيد الافتتاحي")
        account = supplier_payment.purchase_order.account
        supplier_payment.delete()
        if account is not None:
            from accounts.services import apply_credit  # noqa: PLC0415

            apply_credit(account)


@transaction.atomic
def correct_payment(opening: OpeningStock, *, amount, currency: str, paid_amount=None, exchange_rate=None,
                    when: date | None = None):
    """Correct an explicitly identified opening-stock payment without changing stock."""
    from partners.services import assert_period_open  # noqa: PLC0415
    from purchase_order.models import POPayment  # noqa: PLC0415

    opening = OpeningStock.objects.select_for_update().get(pk=opening.pk)
    expense = _payment(opening)
    supplier_payment = POPayment.objects.select_for_update().filter(opening_stock=opening).first()
    payment = expense or supplier_payment
    if payment is None:
        raise BusinessRuleError("لا توجد دفعة مرتبطة بهذا الرصيد لتعديلها.")
    old_date = expense.date if expense else supplier_payment.payment_date
    payment_date = when or old_date
    if supplier_payment:
        po = supplier_payment.purchase_order
        if amount > po.remaining + supplier_payment.amount:
            raise BusinessRuleError(f"المبلغ أكبر من المتبقي على أمر الشراء ({po.remaining + supplier_payment.amount:,.2f}).")
    assert_period_open(old_date, "الدفع السابق")
    assert_period_open(payment_date, "الدفع الجديد")

    payment.amount = amount
    payment.currency = currency
    payment.paid_amount = paid_amount if currency != "USD" else amount
    payment.exchange_rate = exchange_rate if currency != "USD" else None
    if expense:
        payment.date = payment_date
        payment.save(update_fields=["amount", "currency", "paid_amount", "exchange_rate", "date"])
    else:
        payment.payment_date = payment_date
        payment.save(update_fields=["amount", "currency", "paid_amount", "exchange_rate", "payment_date"])
        if payment.purchase_order.account_id:
            from accounts.services import apply_credit  # noqa: PLC0415

            apply_credit(payment.purchase_order.account)
    return payment
