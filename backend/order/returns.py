"""Customer returns (credit notes) on finalized sales orders."""
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction

from accounts.models import AccountPayment
from accounts.services import apply_credit, direct_paid, release_credit
from inventory.stock import adjust_stock, check_quantity_for_product, fmt_qty
from locations.models import StockMovement
from partners.services import assert_period_open
from tradeops.errors import BusinessRuleError

from .models import SalesOrder, SalesReturn, SalesReturnLine

ZERO = Decimal("0")
CENT = Decimal("0.01")
UNIT = Decimal("0.0001")


def returned_quantity(item) -> Decimal:
    return sum((line.quantity for line in item.returned.all()), ZERO)


def _excess_after(order: SalesOrder, value: Decimal) -> Decimal:
    """Money paid directly on the order beyond what it will be worth after this return."""
    refunded = sum((r.refund_amount for r in order.returns.all()), ZERO)
    return direct_paid(order) - refunded - (order.net_total - value)


@transaction.atomic
def create_sales_return(order: SalesOrder, lines: list[dict], *, when: date | None = None, note: str = "",
                        money_action: str | None = None, currency: str = "USD", exchange_rate=None) -> SalesReturn:
    """lines: [{"item": id, "quantity": q, "branch": id|None, "car": id|None}] (place: where it goes back).

    money_action decides what happens to money the customer paid beyond the new total:
    "refund" (handed back from the box, in `currency`) or "credit" (kept on the order's account).
    """
    order = SalesOrder.objects.select_for_update().get(pk=order.pk)
    if not order.is_finalized:
        raise BusinessRuleError("المرتجع يكون على طلب منتهٍ فقط. عدّل الطلب بدلاً من ذلك.")
    when = when or date.today()
    if when > date.today():
        raise BusinessRuleError("لا يمكن أن يكون تاريخ المرتجع في المستقبل.")
    if order.finalized_at and when < order.finalized_at.date():
        raise BusinessRuleError("تاريخ المرتجع قبل تاريخ البيع.")
    assert_period_open(when, "تاريخ المرتجع")
    items = {i.pk: i for i in order.items.select_related("product")}
    lines = [line for line in lines if Decimal(line["quantity"]) > ZERO]
    if not lines:
        raise BusinessRuleError("حدد كمية واحدة على الأقل للإرجاع.")

    factor = order.grand_total / order.subtotal if order.subtotal > ZERO else Decimal("1")
    prepared = []
    for line in lines:
        item = items.get(line["item"])
        if item is None:
            raise BusinessRuleError("بند غير موجود في الطلب.")
        qty = Decimal(line["quantity"])
        check_quantity_for_product(item.product, qty)
        left = item.quantity - returned_quantity(item)
        if qty > left:
            raise BusinessRuleError(f"الكمية المرتجعة من «{item.product.name}» أكبر من المباعة ({fmt_qty(left)} متبقية).")
        place = item.place
        if line.get("car"):
            place = {"branch_id": None, "car_id": line["car"]}
        elif line.get("branch"):
            place = {"branch_id": line["branch"], "car_id": None}
        prepared.append((item, qty, place))

    value = sum(((qty * (item.unit_price * factor).quantize(UNIT, rounding=ROUND_HALF_UP)).quantize(
        CENT, rounding=ROUND_HALF_UP) for item, qty, _ in prepared), ZERO)
    release_credit(order)  # account lump-sum parts go back to the account first
    excess = max(_excess_after(order, value), ZERO).quantize(CENT, rounding=ROUND_HALF_UP)
    if excess > ZERO and money_action not in ("refund", "credit"):
        raise BusinessRuleError(
            f"دفع العميل أكثر من قيمة الطلب بعد المرتجع بمبلغ {excess:,.2f}. اختر: إعادة المبلغ له أو إبقاؤه رصيداً في حسابه."
        )
    if excess > ZERO and money_action == "credit" and order.account_id is None:
        raise BusinessRuleError("لا يمكن إبقاء المبلغ رصيداً لأن الطلب غير مرتبط بحساب.")

    ret = SalesReturn.objects.create(order=order, date=when, note=note)
    for item, qty, place in prepared:
        SalesReturnLine.objects.create(
            sales_return=ret, order_item=item, quantity=qty,
            unit_value=(item.unit_price * factor).quantize(UNIT, rounding=ROUND_HALF_UP),
            unit_cost=item.unit_cost_at_sale if item.unit_cost_at_sale is not None else item.product.unit_cost,
            branch_id=place["branch_id"], car_id=place["car_id"],
        )
        adjust_stock(item.product_id, qty, branch_id=place["branch_id"], car_id=place["car_id"],
                     kind=StockMovement.RETURN_IN, ref=f"SO-{order.pk}", note=note)

    if excess > ZERO:
        ret.refund_amount = excess
        if money_action == "credit":
            ret.refund_to_credit = True
            ret.save(update_fields=["refund_amount", "refund_to_credit"])
            AccountPayment.objects.create(
                account=order.account, direction=AccountPayment.IN, amount=excess, date=when,
                note=f"رصيد من مرتجع SO-{order.pk}", branch_id=order.branch_id, sales_return=ret,
            )
        else:
            ret.currency = currency
            if currency == "SYP":
                if not exchange_rate or Decimal(exchange_rate) <= ZERO:
                    raise BusinessRuleError("أدخل سعر الصرف لإعادة المبلغ بالليرة.")
                ret.exchange_rate = Decimal(exchange_rate)
                ret.paid_amount = (excess * ret.exchange_rate).quantize(CENT, rounding=ROUND_HALF_UP)
            ret.save(update_fields=["refund_amount", "currency", "exchange_rate", "paid_amount"])
    apply_credit(order.account)
    return ret


@transaction.atomic
def delete_sales_return(ret: SalesReturn) -> None:
    """Undo a return: the goods leave again (if still there) and its money effect goes away."""
    ret = SalesReturn.objects.select_related("order").get(pk=ret.pk)
    assert_period_open(ret.date, "تاريخ المرتجع")
    order = ret.order
    for line in ret.lines.select_related("order_item"):
        adjust_stock(line.order_item.product_id, -line.quantity, branch_id=line.branch_id, car_id=line.car_id,
                     kind=StockMovement.SALE, ref=f"SO-{order.pk}", note="إلغاء مرتجع")
    release_credit(order)
    ret.delete()  # its account credit (if any) goes with it
    apply_credit(order.account)
