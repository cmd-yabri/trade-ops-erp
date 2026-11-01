"""Returns to the supplier (his credit notes) on received purchase orders."""
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction

from accounts.models import AccountPayment
from accounts.services import apply_credit, direct_paid, release_credit
from inventory.stock import adjust_stock, check_quantity_for_product, fmt_qty
from locations.models import StockMovement
from partners.services import assert_period_open
from tradeops.errors import BusinessRuleError

from .models import PurchaseOrder, PurchaseReturn, PurchaseReturnLine

ZERO = Decimal("0")
CENT = Decimal("0.01")
UNIT = Decimal("0.0001")


def returned_quantity(item) -> Decimal:
    return sum((line.quantity for line in item.returned.all()), ZERO)


@transaction.atomic
def create_purchase_return(po: PurchaseOrder, lines: list[dict], *, when: date | None = None, note: str = "",
                           money_action: str | None = None, currency: str = "USD",
                           exchange_rate=None) -> PurchaseReturn:
    """lines: [{"item": id, "quantity": q, "branch": id|None, "car": id|None}] (place the goods leave from).

    What we paid beyond the order's new value comes back: "refund" (cash into the box) or "credit"
    (stays with the supplier's account for our next orders).
    """
    po = PurchaseOrder.objects.select_for_update().get(pk=po.pk)
    if po.status not in ("RECEIVED", "PARTIAL"):
        raise BusinessRuleError("المرتجع يكون على بضاعة مستلمة فقط.")
    when = when or date.today()
    if when > date.today():
        raise BusinessRuleError("لا يمكن أن يكون تاريخ المرتجع في المستقبل.")
    assert_period_open(when, "تاريخ المرتجع")
    items = {i.pk: i for i in po.items.select_related("product")}
    lines = [line for line in lines if Decimal(line["quantity"]) > ZERO]
    if not lines:
        raise BusinessRuleError("حدد كمية واحدة على الأقل للإرجاع.")

    total = po.total_cost
    factor = (total - po.discount) / total if total > ZERO else Decimal("1")
    prepared = []
    for line in lines:
        item = items.get(line["item"])
        if item is None:
            raise BusinessRuleError("بند غير موجود في أمر الشراء.")
        qty = Decimal(line["quantity"])
        check_quantity_for_product(item.product, qty)
        left = item.received_quantity - returned_quantity(item)
        if qty > left:
            raise BusinessRuleError(f"الكمية المرتجعة من «{item.product.name}» أكبر من المستلمة ({fmt_qty(left)} متبقية).")
        place = {"branch_id": po.branch_id, "car_id": None}
        if line.get("car"):
            place = {"branch_id": None, "car_id": line["car"]}
        elif line.get("branch"):
            place = {"branch_id": line["branch"], "car_id": None}
        prepared.append((item, qty, place, (item.unit_cost * factor).quantize(UNIT, rounding=ROUND_HALF_UP)))

    value = sum(((qty * unit).quantize(CENT, rounding=ROUND_HALF_UP) for _, qty, _, unit in prepared), ZERO)
    release_credit(po)
    refunded = sum((r.refund_amount for r in po.returns.all()), ZERO)
    excess = max(direct_paid(po) - refunded - (po.due_total - value), ZERO).quantize(CENT, rounding=ROUND_HALF_UP)
    if excess > ZERO and money_action not in ("refund", "credit"):
        raise BusinessRuleError(
            f"دفعنا للمورد أكثر من قيمة الأمر بعد المرتجع بمبلغ {excess:,.2f}. اختر: استرداده نقداً أو إبقاؤه رصيداً لنا عنده."
        )
    if excess > ZERO and money_action == "credit" and po.account_id is None:
        raise BusinessRuleError("لا يمكن إبقاء المبلغ رصيداً لأن أمر الشراء غير مرتبط بحساب.")

    ret = PurchaseReturn.objects.create(purchase_order=po, date=when, note=note)
    for item, qty, place, unit in prepared:
        PurchaseReturnLine.objects.create(purchase_return=ret, item=item, quantity=qty, unit_value=unit,
                                          branch_id=place["branch_id"], car_id=place["car_id"])
        # raises (rolling back) when the goods are no longer at that place
        adjust_stock(item.product_id, -qty, branch_id=place["branch_id"], car_id=place["car_id"],
                     kind=StockMovement.RETURN_OUT, ref=f"PO-{po.pk}", note=note)

    if excess > ZERO:
        ret.refund_amount = excess
        if money_action == "credit":
            ret.refund_to_credit = True
            ret.save(update_fields=["refund_amount", "refund_to_credit"])
            AccountPayment.objects.create(
                account=po.account, direction=AccountPayment.OUT, amount=excess, date=when,
                note=f"رصيد من مرتجع PO-{po.pk}", branch_id=po.branch_id, purchase_return=ret,
            )
        else:
            ret.currency = currency
            if currency == "SYP":
                if not exchange_rate or Decimal(exchange_rate) <= ZERO:
                    raise BusinessRuleError("أدخل سعر الصرف لاسترداد المبلغ بالليرة.")
                ret.exchange_rate = Decimal(exchange_rate)
                ret.paid_amount = (excess * ret.exchange_rate).quantize(CENT, rounding=ROUND_HALF_UP)
            ret.save(update_fields=["refund_amount", "currency", "exchange_rate", "paid_amount"])
    apply_credit(po.account)
    return ret


@transaction.atomic
def delete_purchase_return(ret: PurchaseReturn) -> None:
    """Undo a return to the supplier: the goods come back where they left from."""
    ret = PurchaseReturn.objects.select_related("purchase_order").get(pk=ret.pk)
    assert_period_open(ret.date, "تاريخ المرتجع")
    po = ret.purchase_order
    for line in ret.lines.select_related("item"):
        adjust_stock(line.item.product_id, line.quantity, branch_id=line.branch_id, car_id=line.car_id,
                     kind=StockMovement.PURCHASE, ref=f"PO-{po.pk}", note="إلغاء مرتجع")
    release_credit(po)
    ret.delete()
    apply_credit(po.account)
