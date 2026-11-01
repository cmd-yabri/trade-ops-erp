from collections import defaultdict
from decimal import Decimal

from django.db.models import F
from rest_framework.decorators import api_view
from rest_framework.response import Response

from inventory.models import Product
from invoice import services
from locations.models import StockLevel
from order.models import SalesOrder
from tradeops.errors import hide_from_staff, require_admin

ZERO = Decimal("0")


def _branch(request):
    value = request.query_params.get("branch", "")
    return int(value) if value.isdigit() else None


@api_view(["GET"])
def dashboard_summary(request):
    branch = _branch(request)
    t = services.totals(branch=branch)
    open_orders = SalesOrder.objects.filter(is_finalized=False)
    if branch:
        open_orders = open_orders.filter(branch_id=branch)
        # low stock counted on what this branch itself holds
        here = dict(StockLevel.objects.filter(branch_id=branch).values_list("product_id", "quantity"))
        low = sum(1 for pid, threshold in Product.objects.values_list("id", "reorder_threshold")
                  if here.get(pid, ZERO) <= threshold)
    else:
        low = Product.objects.filter(current_stock__lte=F("reorder_threshold")).count()
    return Response(hide_from_staff(request, {
        "total_revenue": t["total_revenue"],
        "total_profit": t["net_profit"],
        "open_orders": open_orders.count(),
        "low_stock_items": low,
    }))


@api_view(["GET"])
def financial_reports(request):
    """Totals for a rolling window: ?period=daily|weekly|monthly|quarterly|yearly."""
    start, end = services.period_range(request.query_params.get("period", "monthly"))
    data = services.totals(start, end, _branch(request))
    data["cash_flow"] = services.cash_flow(start, end, _branch(request))  # every money in / out of the boxes
    return Response(hide_from_staff(request, data))


def _grouped(key_fn, key_names, branch=None, request=None):
    if request is not None:
        require_admin(request)  # the grouped reports carry profit
    groups = defaultdict(lambda: {"revenue": ZERO, "profit": ZERO})
    for rec in services.daily_records(branch=branch):
        key = key_fn(rec["date"])
        groups[key]["revenue"] += rec["total_revenue"]
        groups[key]["profit"] += rec["net_profit"]
    return [
        {**dict(zip(key_names, key if isinstance(key, tuple) else (key,))), **values}
        for key, values in sorted(groups.items())
    ]


@api_view(["GET"])
def weekly_financial_report(request):
    return Response(_grouped(lambda d: (d.isocalendar()[0], d.isocalendar()[1]), ("year", "week"), _branch(request), request))


@api_view(["GET"])
def monthly_financial_report(request):
    return Response(_grouped(lambda d: (d.year, d.month), ("year", "month"), _branch(request), request))


@api_view(["GET"])
def quarterly_financial_report(request):
    return Response(_grouped(lambda d: (d.year, (d.month - 1) // 3 + 1), ("year", "quarter"), _branch(request), request))


@api_view(["GET"])
def yearly_financial_report(request):
    return Response(_grouped(lambda d: d.year, ("year",), _branch(request), request))
