from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction

from accounts.services import apply_credit, direct_paid, release_credit, settle_removed_payments
from inventory.models import Product
from inventory.stock import adjust_stock, check_quantity_for_product, fmt_qty
from locations.models import StockMovement
from partners.services import assert_period_open
from tradeops.errors import BusinessRuleError

from .models import POPayment, PurchaseOrder, PurchaseOrderItem

CENT = Decimal("0.01")
UNIT = Decimal("0.0001")
ZERO = Decimal("0")


def landed_costs(po: PurchaseOrder) -> dict[int, Decimal]:
    """Real cost of one unit per order line: the invoice price, minus the line's share of the
    order discount, plus its share of the transport fee (whoever is paid). Shares follow the
    line values; an order with no value at all shares by quantity instead."""
    items = list(po.items.all())
    weights = {i.pk: i.quantity * i.unit_cost for i in items}
    total = sum(weights.values(), ZERO)
    if total <= ZERO:
        weights = {i.pk: i.quantity for i in items}
        total = sum(weights.values(), ZERO)
    extra = po.transport_cost - po.discount
    out = {}
    for item in items:
        share = extra * weights[item.pk] / total if total > ZERO else ZERO
        line = item.quantity * item.unit_cost + share
        out[item.pk] = max(line / item.quantity, ZERO).quantize(UNIT, rounding=ROUND_HALF_UP)
    return out


def _is_latest_receipt(po: PurchaseOrder, product_id: int) -> bool:
    """True when no other order brought this product in later (its price is the current one)."""
    later = PurchaseOrderItem.objects.filter(
        product_id=product_id, received_quantity__gt=0, purchase_order__received_at__gt=po.received_at,
    ).exclude(purchase_order=po)
    return not later.exists()


def refresh_costs(po: PurchaseOrder) -> None:
    """Store each line's landed cost; products whose last purchase is this order take it as their cost."""
    costs = landed_costs(po)
    for item in po.items.all():
        item.landed_unit_cost = costs[item.pk]
        item.save(update_fields=["landed_unit_cost"])
        if item.received_quantity > ZERO and po.received_at and _is_latest_receipt(po, item.product_id):
            Product.objects.filter(pk=item.product_id).update(unit_cost=costs[item.pk])


@transaction.atomic
def receive_purchase_order(po: PurchaseOrder, lines: dict[int, Decimal] | None = None, *,
                           branch_id: int | None = None, car_id: int | None = None) -> PurchaseOrder:
    """Put arrived goods into stock (all that is still due, or `lines` = {item id: quantity}).

    The goods go to the given car / branch (default: the order's branch). Each product's cost
    becomes this order's landed unit cost: the last purchase price.
    """
    po = PurchaseOrder.objects.select_for_update().get(pk=po.pk)
    if po.status == "RECEIVED":
        raise BusinessRuleError("تم استلام أمر الشراء بالكامل مسبقاً.")
    if po.status == "CANCELLED":
        raise BusinessRuleError("لا يمكن استلام أمر شراء ملغى.")
    items = {i.pk: i for i in po.items.select_related("product")}
    if not items:
        raise BusinessRuleError("أمر الشراء لا يحتوي على أي منتجات.")
    if lines is None:
        lines = {pk: i.remaining_quantity for pk, i in items.items()}
    if any(pk not in items for pk in lines):
        raise BusinessRuleError("بند غير موجود في أمر الشراء.")
    lines = {pk: Decimal(q) for pk, q in lines.items() if Decimal(q) > ZERO}
    if not lines:
        raise BusinessRuleError("حدد كمية واحدة على الأقل للاستلام.")

    place = {"car_id": car_id} if car_id else {"branch_id": branch_id or po.branch_id}
    for pk, qty in lines.items():
        item = items[pk]
        if qty > item.remaining_quantity:
            raise BusinessRuleError(
                f"الكمية المستلمة من «{item.product.name}» أكبر من المتبقي ({fmt_qty(item.remaining_quantity)})."
            )
        check_quantity_for_product(item.product, qty)
        adjust_stock(item.product_id, qty, **place, kind=StockMovement.PURCHASE, ref=f"PO-{po.pk}")
        item.received_quantity += qty
        item.save(update_fields=["received_quantity"])

    po.received_at = datetime.now()
    po.status = "RECEIVED" if all(i.remaining_quantity <= ZERO for i in items.values()) else "PARTIAL"
    po.save(update_fields=["status", "received_at", "updated_at"])
    refresh_costs(po)
    return po


@transaction.atomic
def set_transport(po: PurchaseOrder, cost: Decimal, payee: str, *, currency: str = "USD", paid_amount=None,
                  exchange_rate=None, pay_date: date | None = None) -> PurchaseOrder:
    """Set (or fill in later) the transport / loading fee of an order.

    It always raises the landed cost of the goods. Paid to the supplier, it is added to his bill;
    paid to a carrier, it leaves a cash box now as a FREIGHT expense tied to the order.
    """
    from invoice.models import Expense  # noqa: PLC0415

    po = PurchaseOrder.objects.select_for_update().get(pk=po.pk)
    if po.status == "CANCELLED":
        raise BusinessRuleError("لا يمكن تعديل أجرة نقل أمر شراء ملغى.")
    if payee not in (PurchaseOrder.SUPPLIER, PurchaseOrder.CARRIER):
        raise BusinessRuleError("حدد لمن تُدفع أجرة النقل: المورد أو ناقل مستقل.")
    if cost < ZERO:
        raise BusinessRuleError("أجرة النقل لا يمكن أن تكون سالبة.")
    if payee == PurchaseOrder.SUPPLIER and direct_paid(po) > po.total_cost - po.discount + cost:
        raise BusinessRuleError("المدفوع للمورد أكبر من إجمالي الفاتورة بعد هذا التعديل.")

    assert_period_open(date.today(), "تعديل أجرة النقل")
    release_credit(po)
    po.transport_cost = cost
    po.transport_payee = payee
    po.save(update_fields=["transport_cost", "transport_payee", "updated_at"])

    freight = Expense.objects.filter(purchase_order=po).first()
    if payee == PurchaseOrder.CARRIER and cost > ZERO:
        values = {
            "type": "EXPENSE", "category": Expense.FREIGHT_CATEGORY, "amount": cost,
            "description": f"أجرة نقل وتحميل PO-{po.pk} ({po.supplier})",
            "currency": currency, "paid_amount": paid_amount if currency != "USD" else cost,
            "exchange_rate": exchange_rate if currency != "USD" else None,
            "branch_id": po.branch_id,
        }
        if freight is None:
            Expense.objects.create(purchase_order=po, date=pay_date or date.today(), **values)
        else:
            for key, value in values.items():
                setattr(freight, key, value)
            if pay_date:
                freight.date = pay_date
            freight.save()
    elif freight is not None:
        freight.delete()  # now owed to the supplier, or no fee any more

    refresh_costs(po)
    apply_credit(po.account)
    return po


def _require_payments_action(po: PurchaseOrder, action: str | None) -> None:
    """Money we paid on the order must not vanish silently when the order goes away."""
    if direct_paid(po) > 0 and action not in ("refund", "credit"):
        raise BusinessRuleError(
            "على أمر الشراء دفعات. اختر: استرداد المبلغ من المورد (يعود للصندوق) أو إبقاؤه رصيداً لنا عند المورد."
        )


def _settle_payments(po: PurchaseOrder, action: str | None) -> None:
    if direct_paid(po) > 0:
        settle_removed_payments(po, po.account, action, inbound=False, branch_id=po.branch_id)
    release_credit(po)


@transaction.atomic
def cancel_purchase_order(po: PurchaseOrder, payments_action: str | None = None) -> PurchaseOrder:
    po = PurchaseOrder.objects.select_related("account").get(pk=po.pk)
    if po.status != "PENDING":
        raise BusinessRuleError("يمكن إلغاء أوامر الشراء قيد الانتظار فقط.")
    _require_payments_action(po, payments_action)
    _settle_payments(po, payments_action)
    po.status = "CANCELLED"
    po.save(update_fields=["status", "updated_at"])
    apply_credit(po.account)
    return po


@transaction.atomic
def delete_purchase_order(po: PurchaseOrder, payments_action: str | None = None) -> None:
    po = PurchaseOrder.objects.select_related("account").get(pk=po.pk)
    if po.status in ("RECEIVED", "PARTIAL"):
        raise BusinessRuleError(
            "لا يمكن حذف أمر شراء تم استلامه لأن المخزون تأثر به. عدّل المخزون يدوياً إن لزم."
        )
    _require_payments_action(po, payments_action)
    _settle_payments(po, payments_action)
    account = po.account
    po.delete()
    apply_credit(account)


@transaction.atomic
def add_po_payment(po: PurchaseOrder, amount: Decimal, pay_date: date | None = None, *,
                   currency="USD", paid_amount=None, exchange_rate=None) -> POPayment:
    po = PurchaseOrder.objects.get(pk=po.pk)
    if po.status == "CANCELLED":
        raise BusinessRuleError("لا يمكن تسجيل دفعة على أمر شراء ملغى.")
    remaining = po.remaining
    if currency != "USD" and remaining < amount <= remaining + CENT:
        amount = remaining  # a rounded SYP amount for "pay everything" may be a cent over
    if amount > remaining:
        raise BusinessRuleError(f"المبلغ أكبر من المتبقي على أمر الشراء ({remaining:,.2f}).")
    return POPayment.objects.create(
        purchase_order=po, amount=amount, payment_date=pay_date or date.today(),
        currency=currency, paid_amount=paid_amount, exchange_rate=exchange_rate,
    )
