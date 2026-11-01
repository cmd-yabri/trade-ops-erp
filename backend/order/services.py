from collections import defaultdict
from datetime import datetime
from decimal import Decimal

from django.db import transaction

from accounts.services import apply_credit, direct_paid, release_credit, settle_removed_payments
from inventory.stock import adjust_stock
from locations.models import StockMovement
from partners.services import assert_period_open
from tradeops.errors import BusinessRuleError

from .models import ClientPayment, SalesOrder


def _quantities_by_place(order):
    """{(product id, branch id, car id): quantity}: each line leaves from its own place."""
    totals = defaultdict(Decimal)
    for item in order.items.select_related("order"):
        place = item.place
        totals[(item.product_id, place["branch_id"], place["car_id"])] += item.quantity
    return totals


def book_stock(order, *, costs: dict | None = None, kind: str = StockMovement.SALE) -> None:
    """Take the order's goods out of their places and snapshot each line's cost.

    `costs` ({product id: cost}) keeps the cost of products the order already sold (an admin edit);
    other lines take the product's current cost. Raises, rolling everything back, if a place is short.
    """
    for (product_id, branch_id, car_id), quantity in _quantities_by_place(order).items():
        adjust_stock(product_id, -quantity, branch_id=branch_id, car_id=car_id, kind=kind, ref=f"SO-{order.pk}")
    for item in order.items.select_related("product"):
        known = (costs or {}).get(item.product_id)
        item.unit_cost_at_sale = known if known is not None else item.product.unit_cost
        item.save(update_fields=["unit_cost_at_sale"])


def unbook_stock(order, *, note: str = "") -> None:
    """Put a finalized order's goods back where each line came from."""
    for (product_id, branch_id, car_id), quantity in _quantities_by_place(order).items():
        adjust_stock(product_id, quantity, branch_id=branch_id, car_id=car_id, kind=StockMovement.SALE_UNDO,
                     ref=f"SO-{order.pk}", note=note)


@transaction.atomic
def finalize_sales_order(order: SalesOrder) -> SalesOrder:
    """Deduct stock, snapshot product cost and book the sale.

    Fails (and changes nothing) if any product does not have enough stock.
    """
    order = SalesOrder.objects.get(pk=order.pk)
    if order.is_finalized:
        raise BusinessRuleError("تم إنهاء هذا الطلب مسبقاً.")
    if not order.items.exists() and not order.freelance_jobs.exists():
        raise BusinessRuleError("لا يمكن إنهاء طلب فارغ.")

    book_stock(order)

    order.is_finalized = True
    now = datetime.now()
    # An order dated in the past (entered late) is booked on its own day.
    order.finalized_at = order.date if order.date.date() < now.date() else now
    order.save(update_fields=["is_finalized", "finalized_at"])
    return order


PAYMENT_ACTIONS = ("refund", "credit")


def require_payments_action(order, action: str | None) -> None:
    """Money paid directly on an order must not vanish silently when the order goes away."""
    if direct_paid(order) > 0 and action not in PAYMENT_ACTIONS:
        raise BusinessRuleError(
            "على هذا الطلب دفعات. اختر: إعادة المبلغ (يخرج من الصندوق) أو إبقاؤه رصيداً في حساب العميل."
        )


@transaction.atomic
def delete_sales_order(order: SalesOrder, payments_action: str | None = None) -> None:
    """Delete an order; a finalized order puts its goods back into stock.

    Payments made on the order itself are refunded or kept as credit on its account
    (payments_action); parts of account lump sums simply go back to the account.
    """
    order = SalesOrder.objects.select_related("account").get(pk=order.pk)
    if order.returns.exists():
        raise BusinessRuleError("على الطلب مرتجعات. احذف المرتجعات أولاً ثم احذف الطلب.")
    require_payments_action(order, payments_action)
    if order.is_finalized:
        assert_period_open(order.finalized_at.date() if order.finalized_at else None, "تاريخ البيع")
        unbook_stock(order, note="حذف الطلب")
    account = order.account
    if direct_paid(order) > 0:
        settle_removed_payments(order, account, payments_action, inbound=True, branch_id=order.branch_id)
    release_credit(order)
    order.delete()
    apply_credit(account)  # credit freed by this order settles the account's other orders


@transaction.atomic
def add_client_payment(order: SalesOrder, amount: Decimal, pay_date=None, *, currency="USD",
                       paid_amount=None, exchange_rate=None) -> ClientPayment:
    order = SalesOrder.objects.get(pk=order.pk)
    remaining = order.remaining
    if currency != "USD" and remaining < amount <= remaining + Decimal("0.01"):
        amount = remaining  # a rounded SYP amount for "pay everything" may be a cent over
    if amount > remaining:
        raise BusinessRuleError(f"المبلغ أكبر من المتبقي على الطلب ({remaining:,.2f}).")
    kwargs = {"order": order, "amount": amount, "currency": currency,
              "paid_amount": paid_amount, "exchange_rate": exchange_rate}
    if pay_date:
        kwargs["date"] = pay_date
    return ClientPayment.objects.create(**kwargs)
