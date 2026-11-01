"""Partner accounts and the month-end profit split (computed, never stored twice)."""
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db import IntegrityError, transaction
from django.db.models import Sum

from invoice import services as finance
from tradeops.errors import BusinessRuleError, ConflictError

from .models import (
    Partner, PartnerPriorProfit, PartnerWithdrawal, ProfitOpening, ProfitOpeningLine, ProfitSettlement, SettlementLine,
)

ZERO = Decimal("0")
CENT = Decimal("0.01")
HUNDRED = Decimal("100")


def withdrawal_movements(currency: str, branch: int | None = None) -> list[dict]:
    """Partner withdrawals as cash-box movements (money out)."""
    rows = PartnerWithdrawal.objects.filter(currency=currency).select_related("partner")
    if branch:
        rows = rows.filter(branch_id=branch)
    return [
        {"date": w.date, "kind": "partner_withdrawal",
         "description": f"سحب الشريك {w.partner.name}" + (f" - {w.note}" if w.note else ""),
         "amount": -w.cash_amount, "ref": f"withdrawal:{w.id}", "branch": w.branch_id,
         "editable": True, "edit_amount": w.cash_amount, "edit_note": w.note, "edit_rate": w.exchange_rate,
         "_stamp": w.created_at}
        for w in rows
    ]


def assert_period_open(day, what: str = "هذا التاريخ") -> None:
    """Profit of a closed period has already been split between the partners, so nothing that
    changes it (back-dated expenses, deleting old sales ...) is allowed while the module is on.
    The owner can undo the last close first."""
    from user.models import FeatureSettings  # noqa: PLC0415

    if day is None or not FeatureSettings.current().partners:
        return
    last = last_settlement()
    if last is not None and day <= last.period_end:
        raise BusinessRuleError(
            f"{what} ({day}) يقع ضمن فترة مقفلة حتى {last.period_end} وُزّعت أرباحها على الشركاء. "
            "تراجع عن آخر إقفال في صفحة الشركاء إن أردت تعديلها."
        )


def last_settlement() -> ProfitSettlement | None:
    return ProfitSettlement.objects.order_by("-period_end", "-id").first()


def profit_opening() -> ProfitOpening | None:
    return ProfitOpening.objects.prefetch_related("lines__partner").filter(pk=1).first()


def current_period_start() -> date:
    """The day after the last close/opening, or the first day with financial activity."""
    last = last_settlement()
    if last:
        return last.period_end + timedelta(days=1)
    opening = profit_opening()
    if opening:
        return opening.as_of + timedelta(days=1)
    return finance.first_activity_date() or date.today()


def _share(net_profit: Decimal, percent: Decimal) -> Decimal:
    return (net_profit * percent / HUNDRED).quantize(CENT, rounding=ROUND_HALF_UP)


def _withdrawn(partner_id: int, start: date | None = None, end: date | None = None) -> Decimal:
    qs = PartnerWithdrawal.objects.filter(partner_id=partner_id)
    if start:
        qs = qs.filter(date__gte=start)
    if end:
        qs = qs.filter(date__lte=end)
    return qs.aggregate(total=Sum("amount"))["total"] or ZERO


def balance(partner: Partner) -> Decimal:
    """Opening and settled shares minus everything the partner ever took."""
    earned = SettlementLine.objects.filter(partner=partner).aggregate(t=Sum("share_amount"))["t"] or ZERO
    opening = ProfitOpeningLine.objects.filter(opening_id=1, partner=partner).aggregate(t=Sum("share_amount"))["t"] or ZERO
    opening_withdrawn = ProfitOpeningLine.objects.filter(
        opening_id=1, partner=partner,
    ).aggregate(t=Sum("withdrawn_amount"))["t"] or ZERO
    return (
        earned + opening + prior_profit_total(partner.pk)
        - _withdrawn(partner.pk) - opening_withdrawn
    )


def prior_profit_total(partner_id: int) -> Decimal:
    return PartnerPriorProfit.objects.filter(partner_id=partner_id).aggregate(t=Sum("amount"))["t"] or ZERO


def save_prior_profit(data: dict, entry: PartnerPriorProfit | None = None) -> PartnerPriorProfit:
    """Add or correct one pre-TradeOps profit line of a partner."""
    if data["period_end"] >= date.today():
        raise BusinessRuleError("يجب أن تنتهي فترة الأرباح السابقة قبل اليوم.")
    start = data.get("period_start")
    if start and start > data["period_end"]:
        raise BusinessRuleError("بداية الفترة يجب أن تسبق نهايتها.")
    if data["amount"] == ZERO:
        raise BusinessRuleError("أدخل مبلغاً غير صفر (الخسارة بإشارة سالبة).")
    entry = entry or PartnerPriorProfit(partner=data["partner"])
    entry.period_start = start
    entry.period_end = data["period_end"]
    entry.amount = data["amount"]
    entry.note = data.get("note", "")
    entry.save()
    return entry


def withdrawn_total(partner_id: int) -> Decimal:
    """All normal and pre-TradeOps withdrawals, expressed in USD."""
    regular = _withdrawn(partner_id)
    opening = ProfitOpeningLine.objects.filter(opening_id=1, partner_id=partner_id).aggregate(
        t=Sum("withdrawn_amount"),
    )["t"] or ZERO
    return regular + opening


def _opening_payload(opening: ProfitOpening | None) -> dict | None:
    if opening is None:
        return None
    return {
        "as_of": opening.as_of,
        "net_profit": opening.net_profit,
        "note": opening.note,
        "lines": [
            {
                "partner": line.partner_id,
                "partner_name": line.partner.name,
                "net_profit": line.share_amount,
                "withdrawn_amount": line.withdrawn_amount,
            }
            for line in opening.lines.select_related("partner").order_by("partner_id")
        ],
    }


def serialize_opening(opening: ProfitOpening | None) -> dict:
    return {
        "opening": _opening_payload(opening),
        "editable": not ProfitSettlement.objects.exists(),
    }


@transaction.atomic
def save_opening(data: dict, *, update: bool = False) -> ProfitOpening:
    """Create or correct the partners' starting point: each partner's OWN profit and withdrawals
    before TradeOps (no general total, no percentages). Only before any profit period is closed."""
    if data["as_of"] >= date.today():
        raise BusinessRuleError("يجب أن يكون تاريخ الأرباح السابقة قبل اليوم.")
    if ProfitSettlement.objects.exists():
        raise BusinessRuleError("لا يمكن تعديل رصيد البداية بعد إقفال فترة أرباح.")

    opening = profit_opening()
    if update and opening is None:
        raise BusinessRuleError("لم يتم تسجيل رصيد بداية لتعديله.")
    if not update and opening is not None:
        raise ConflictError("تم تسجيل رصيد البداية مسبقاً.")

    submitted = {line["partner"]: line for line in data["lines"]}
    if len(submitted) != len(data["lines"]):
        raise BusinessRuleError("بيانات الشركاء مكررة في رصيد البداية.")
    partners = {partner.pk: partner for partner in Partner.objects.select_for_update().filter(pk__in=submitted)}
    if set(partners) != set(submitted):
        raise BusinessRuleError("يوجد شريك غير موجود في رصيد البداية.")
    total = sum((line["net_profit"] for line in submitted.values()), ZERO)

    if opening is None:
        try:
            opening = ProfitOpening.objects.create(pk=1, as_of=data["as_of"], net_profit=total, note=data["note"])
        except IntegrityError as exc:
            raise ConflictError("تم تسجيل رصيد البداية مسبقاً. حدّث الصفحة وحاول مرة أخرى.") from exc
    opening.as_of = data["as_of"]
    opening.net_profit = total
    opening.note = data["note"]
    opening.save(update_fields=["as_of", "net_profit", "note"])
    opening.lines.all().delete()
    for partner_id, line in submitted.items():
        ProfitOpeningLine.objects.create(
            opening=opening,
            partner=partners[partner_id],
            share_percent=partners[partner_id].share_percent,  # information only; the amount is typed per partner
            share_amount=line["net_profit"],
            withdrawn_amount=line["withdrawn_amount"],
        )
    return opening


def undistributed_share(partner: Partner, preview: dict | None = None) -> Decimal:
    """The partner's share of the profit made since the last settlement (zero right after closing)."""
    preview = preview or current_preview()
    for line in preview["lines"]:
        if line["partner"] == partner.pk:
            return line["share_amount"]
    return ZERO


def current_preview() -> dict:
    """The running period up to today (or its first day, right after a close). No share-total check."""
    return preview_settlement(max(date.today(), current_period_start()), check_shares=False)


def preview_settlement(end: date, *, check_shares: bool = True) -> dict:
    start = current_period_start()
    if end < start:
        raise BusinessRuleError(f"الفترة تبدأ من {start}. اختر تاريخ نهاية بعد هذا التاريخ.")
    net = finance.totals(start, end)["net_profit"]
    partners = list(Partner.objects.filter(is_active=True).order_by("id"))
    total_percent = sum((p.share_percent for p in partners), ZERO)
    if check_shares and abs(total_percent - HUNDRED) > CENT:
        raise BusinessRuleError(
            f"مجموع نسب الشركاء {total_percent.normalize():f}% ويجب أن يساوي 100%. عدّل النسب أولاً."
        )
    return {
        "period_start": start, "period_end": end, "net_profit": net, "total_percent": total_percent,
        "lines": [
            {"partner": p.pk, "partner_name": p.name, "share_percent": p.share_percent,
             "share_amount": _share(net, p.share_percent),
             "withdrawn_in_period": _withdrawn(p.pk, start, end)}
            for p in partners
        ],
    }


@transaction.atomic
def settle(end: date, note: str = "") -> ProfitSettlement:
    """Close the period: split the profit between the active partners. One click, never automatic."""
    if end >= date.today():
        # Today is still open: entries made later today must land in the NEXT period.
        raise BusinessRuleError("يجب أن تنتهي الفترة قبل اليوم (اختر تاريخ أمس أو أقدم).")
    data = preview_settlement(end)
    if not data["lines"]:
        raise BusinessRuleError("لا يوجد شركاء فعّالون.")
    settlement = ProfitSettlement.objects.create(
        period_start=data["period_start"], period_end=data["period_end"],
        net_profit=data["net_profit"], note=note,
    )
    for line in data["lines"]:
        SettlementLine.objects.create(
            settlement=settlement, partner_id=line["partner"], share_percent=line["share_percent"],
            share_amount=line["share_amount"], withdrawn_in_period=line["withdrawn_in_period"],
        )
    return settlement


@transaction.atomic
def undo_settlement(settlement: ProfitSettlement) -> None:
    latest = last_settlement()
    if latest is None or latest.pk != settlement.pk:
        raise BusinessRuleError("يمكن التراجع عن آخر إقفال فقط.")
    settlement.delete()
