"""Financial figures, computed on demand from the source records.

Nothing is accumulated in a side table, so edits and deletes can never leave
the totals out of sync (the old signal-based approach double counted).

Accrual basis, per day:
  revenue   = grand total of sales orders finalized that day + manual "other income"
  cogs      = quantity x product cost (snapshot taken when the order was finalized)
  freelance = contractor cost of the jobs on those finalized orders
  opex      = manual expenses (rent, electricity, ...)
  profit    = revenue - cogs - freelance - opex

Cash movements (customer payments received, supplier payments made) are
reported separately so the owner can see receivables / payables.
"""
from collections import defaultdict
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from order.models import ClientPayment, SalesOrder
from purchase_order.models import POPayment, PurchaseOrder

from .models import Expense

ZERO = Decimal("0")
CENT = Decimal("0.01")
FIELDS = (
    "total_revenue", "total_cogs", "total_freelance_costs", "total_operational_expenses",
    "total_stock_purchases",
)


def _blank():
    return {f: ZERO for f in FIELDS}


def _in_range(qs, field, start, end):
    if start:
        qs = qs.filter(**{f"{field}__gte": start})
    if end:
        qs = qs.filter(**{f"{field}__lte": end})
    return qs


def daily_records(start: date | None = None, end: date | None = None, branch: int | None = None) -> list[dict]:
    """One dict per day that has any activity, oldest first."""
    days = defaultdict(_blank)

    orders = SalesOrder.objects.filter(is_finalized=True, finalized_at__isnull=False)
    orders = _in_range(orders, "finalized_at__date", start, end)
    if branch:
        orders = orders.filter(branch_id=branch)
    for order in orders.prefetch_related("items", "freelance_jobs"):
        day = days[order.finalized_at.date()]
        day["total_revenue"] += order.grand_total
        day["total_cogs"] += order.goods_cost  # finalized orders always carry the cost snapshot
        for job in order.freelance_jobs.all():
            day["total_freelance_costs"] += job.cost_to_company

    # Returns lower the revenue and the cost of goods on the day they happen.
    from order.models import SalesReturn  # noqa: PLC0415

    returns = _in_range(SalesReturn.objects.all(), "date", start, end)
    if branch:
        returns = returns.filter(order__branch_id=branch)
    for r in returns.prefetch_related("lines"):
        day = days[r.date]
        day["total_revenue"] -= r.value
        day["total_cogs"] -= r.cost

    expenses = Expense.objects.all()
    if branch:
        expenses = expenses.filter(branch_id=branch)
    for expense in _in_range(expenses, "date", start, end):
        day = days[expense.date]
        if expense.type == "INCOME":
            day["total_revenue"] += expense.amount
        elif expense.category in Expense.GOODS_CATEGORIES:
            day["total_stock_purchases"] += expense.amount
        else:
            day["total_operational_expenses"] += expense.amount

    records = []
    for day_date in sorted(days):
        rec = days[day_date]
        rec["date"] = day_date
        rec["net_profit"] = (
            rec["total_revenue"] - rec["total_cogs"]
            - rec["total_freelance_costs"] - rec["total_operational_expenses"]
        )
        records.append(rec)
    return records


def first_activity_date() -> date | None:
    """Earliest day with a finalized sale or an expense/income entry (two cheap MIN queries)."""
    from django.db.models import Min  # noqa: PLC0415

    sale = SalesOrder.objects.filter(is_finalized=True, finalized_at__isnull=False).aggregate(m=Min("finalized_at"))["m"]
    entry = Expense.objects.aggregate(m=Min("date"))["m"]
    days = [d for d in (sale.date() if sale else None, entry) if d]
    return min(days) if days else None


def totals(start: date | None = None, end: date | None = None, branch: int | None = None) -> dict:
    result = _blank()
    for rec in daily_records(start, end, branch):
        for f in FIELDS:
            result[f] += rec[f]
    result["net_profit"] = (
        result["total_revenue"] - result["total_cogs"]
        - result["total_freelance_costs"] - result["total_operational_expenses"]
    )
    result["total_expenses"] = (
        result["total_cogs"] + result["total_freelance_costs"] + result["total_operational_expenses"]
    )
    # Cash view for the same window: money paid on orders plus account lump sums (whose order parts
    # are not counted again).
    from accounts.models import AccountPayment  # noqa: PLC0415

    from order.models import SalesReturn  # noqa: PLC0415
    from purchase_order.models import PurchaseReturn  # noqa: PLC0415

    received = ClientPayment.objects.filter(account_payment__isnull=True)
    paid = POPayment.objects.filter(account_payment__isnull=True)
    lumps = AccountPayment.objects.filter(sales_return__isnull=True, purchase_return__isnull=True)
    sale_refunds = SalesReturn.objects.filter(refund_to_credit=False, refund_amount__gt=0)
    supplier_refunds = PurchaseReturn.objects.filter(refund_to_credit=False, refund_amount__gt=0)
    if branch:
        received = received.filter(order__branch_id=branch)
        paid = paid.filter(purchase_order__branch_id=branch)
        lumps = lumps.filter(branch_id=branch)
        sale_refunds = sale_refunds.filter(order__branch_id=branch)
        supplier_refunds = supplier_refunds.filter(purchase_order__branch_id=branch)
    sale_refunds = _in_range(sale_refunds, "date", start, end)
    supplier_refunds = _in_range(supplier_refunds, "date", start, end)
    received = _in_range(received, "date", start, end)
    paid = _in_range(paid, "payment_date", start, end)
    lumps = _in_range(lumps, "date", start, end)
    result["cash_received"] = sum((p.amount for p in received), ZERO) + sum(
        (a.amount for a in lumps if a.direction == AccountPayment.IN), ZERO) - sum(
        (r.refund_amount for r in sale_refunds), ZERO)
    result["supplier_payments"] = sum((p.amount for p in paid), ZERO) + sum(
        (a.amount for a in lumps if a.direction == AccountPayment.OUT), ZERO) - sum(
        (r.refund_amount for r in supplier_refunds), ZERO)
    result.update(open_balances(branch))
    return result


# Groups of the cash flow cards: which movement kinds land in which line.
CASH_IN_PARTS = {
    "sale_payment": "customers", "account_in": "customers",
    "income": "other_income",
    "deposit": "other", "supplier_refund": "other",
}
CASH_OUT_PARTS = {
    "supplier_payment": "suppliers", "account_out": "suppliers",
    "withdrawal": "other", "partner_withdrawal": "other", "sale_refund": "other",
}


def cash_flow(start: date | None = None, end: date | None = None, branch: int | None = None) -> dict:
    """All money that came in and went out in the window, per cash box currency (USD, SYP).

    Every movement of the boxes counts (payments, expenses, income, stock bought, transport, refunds,
    deposits, withdrawals) except currency exchanges, which only move money between the boxes.
    """
    from cashbox.services import CURRENCIES, movements  # noqa: PLC0415

    out = {}
    for currency in CURRENCIES:
        flow = {"in": ZERO, "out": ZERO, "in_parts": {}, "out_parts": {}}
        for row in movements(currency, branch):
            if row["kind"].startswith("exchange") or (start and row["date"] < start) or (end and row["date"] > end):
                continue
            amount = row["amount"]
            if amount > 0:
                part = CASH_IN_PARTS.get(row["kind"], "other")
                flow["in"] += amount
                flow["in_parts"][part] = flow["in_parts"].get(part, ZERO) + amount
            else:
                if row["kind"] == "expense":
                    part = "goods" if row.get("category") in Expense.GOODS_CATEGORIES else "expenses"
                else:
                    part = CASH_OUT_PARTS.get(row["kind"], "other")
                flow["out"] -= amount
                flow["out_parts"][part] = flow["out_parts"].get(part, ZERO) - amount
        out[currency] = flow
    return out


def open_balances(branch: int | None = None) -> dict:
    """Money still open today, whatever the period: what customers owe us on their orders and
    what we owe suppliers on purchase orders that were not cancelled."""
    sales = SalesOrder.objects.prefetch_related("items", "freelance_jobs", "payments", "returns__lines")
    pos = PurchaseOrder.objects.exclude(status="CANCELLED").prefetch_related("items", "payments", "returns__lines")
    if branch:
        sales = sales.filter(branch_id=branch)
        pos = pos.filter(branch_id=branch)
    return {
        "receivables": sum((o.remaining for o in sales), ZERO).quantize(CENT, rounding=ROUND_HALF_UP),
        "payables": sum((po.remaining for po in pos), ZERO).quantize(CENT, rounding=ROUND_HALF_UP),
    }


SATURDAY = 5  # date.weekday(); the working week here starts on Saturday


def period_range(period: str, today: date | None = None):
    """Calendar period up to today: this day, week (from Saturday), month, quarter or year."""
    today = today or date.today()
    if period == "daily":
        start = today
    elif period == "weekly":
        start = today - timedelta(days=(today.weekday() - SATURDAY) % 7)
    elif period == "quarterly":
        start = date(today.year, (today.month - 1) // 3 * 3 + 1, 1)
    elif period == "yearly":
        start = date(today.year, 1, 1)
    else:  # monthly
        start = today.replace(day=1)
    return start, today
