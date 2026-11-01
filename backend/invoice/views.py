from datetime import date, datetime, timedelta

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from partners.services import assert_period_open
from tradeops.errors import BusinessRuleError, hide_from_staff, require_admin

from . import services
from .models import Expense
from .serializers import ExpenseSerializer


def _branch(request):
    """Optional ?branch=<id> filter for the reports."""
    value = request.query_params.get("branch", "")
    return int(value) if value.isdigit() else None


def _record_json(rec):
    return {
        "date": rec["date"].isoformat(),
        "total_revenue": rec["total_revenue"],
        "total_cogs": rec["total_cogs"],
        "total_freelance_costs": rec["total_freelance_costs"],
        "total_operational_expenses": rec["total_operational_expenses"],
        "net_profit": rec["net_profit"],
    }


@api_view(["GET"])
def dashboard_summary(request):
    """High-level all-time totals for the dashboard cards."""
    t = services.totals(branch=_branch(request))
    return Response(hide_from_staff(request, {
        "total_revenue": t["total_revenue"],
        "net_profit": t["net_profit"],
        "total_expenses": t["total_expenses"],
        "total_cogs": t["total_cogs"],
        "total_freelance_costs": t["total_freelance_costs"],
        "total_operational_expenses": t["total_operational_expenses"],
    }))


@api_view(["GET"])
def chart_data(request):
    """Daily figures for the charts: the most recent 30 days that had activity (admin: they show profit)."""
    require_admin(request)
    since = date.today() - timedelta(days=365)
    records = services.daily_records(start=since, branch=_branch(request))[-30:]
    return Response([_record_json(r) for r in records])


@api_view(["GET"])
def financial_summary(request):
    return Response(hide_from_staff(request, services.totals(branch=_branch(request))))


@api_view(["GET", "POST"])
def expense_list(request):
    if request.method == "GET":
        expense_type = request.query_params.get("type")
        expenses = Expense.objects.all()
        branch = request.query_params.get("branch", "")
        if branch.isdigit():
            expenses = expenses.filter(branch_id=int(branch))
        if expense_type in ("INCOME", "EXPENSE"):
            expenses = expenses.filter(type=expense_type)
        return Response(ExpenseSerializer(expenses.order_by("-date", "-id"), many=True).data)

    serializer = ExpenseSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["PUT", "DELETE"])
def expense_detail(request, expense_id):
    try:
        expense = Expense.objects.get(id=expense_id)
    except Expense.DoesNotExist:
        return Response({"detail": "المصروف غير موجود."}, status=status.HTTP_404_NOT_FOUND)

    if expense.purchase_order_id:
        raise BusinessRuleError(
            f"هذه أجرة نقل أمر الشراء PO-{expense.purchase_order_id}. عدّلها أو احذفها من أمر الشراء."
        )
    if expense.opening_stock_id:
        raise BusinessRuleError("هذا دفع ثمن رصيد افتتاحي. عدّله أو ألغه من «الرصيد الافتتاحي» في المخزون.")
    if request.method == "PUT":
        serializer = ExpenseSerializer(expense, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    require_admin(request)
    assert_period_open(expense.date, "المصروف")
    expense.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def journal(request):
    """Every money movement, newest first: customer and supplier payments, expenses, income, refunds,
    deposits, withdrawals, exchanges ... from both cash boxes (the SYP box when it is switched on)."""
    require_admin(request)
    from cashbox.services import CURRENCIES, movements  # noqa: PLC0415
    from user.models import FeatureSettings  # noqa: PLC0415

    currencies = CURRENCIES if FeatureSettings.current().money_boxes else ("USD",)
    rows = []
    for currency in currencies:
        for row in movements(currency, _branch(request), keep_stamp=True):
            rows.append({**row, "currency": currency})
    # same day: in the order things were entered (rows from before entry times were kept come first)
    rows.sort(key=lambda r: (r["date"], r.pop("_stamp", None) or datetime.min))
    return Response(list(reversed(rows))[:3000])
