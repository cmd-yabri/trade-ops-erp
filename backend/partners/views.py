from datetime import date, timedelta

from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from inventory.stock import default_branch
from tradeops.currency import MultiCurrencyMixin
from tradeops.errors import ConflictError, require_admin, require_feature

from . import services
from .models import Partner, PartnerPriorProfit, PartnerWithdrawal, ProfitOpeningLine, ProfitSettlement, SettlementLine

NOT_FOUND = {"detail": "الشريك غير موجود."}


def _guard(request):
    require_admin(request)
    require_feature("partners")


class PartnerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Partner
        fields = ["id", "name", "phone", "share_percent", "notes", "is_active"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("اسم الشريك مطلوب.")
        return value


class WithdrawalSerializer(MultiCurrencyMixin, serializers.ModelSerializer):
    partner_name = serializers.CharField(source="partner.name", read_only=True)

    class Meta:
        model = PartnerWithdrawal
        fields = ["id", "partner", "partner_name", "amount", "currency", "paid_amount", "exchange_rate",
                  "date", "note"]
        extra_kwargs = {"date": {"required": False}, "amount": {"required": False},
                        "currency": {"required": False}}


class ProfitOpeningLineInputSerializer(serializers.Serializer):
    partner = serializers.IntegerField(min_value=1)
    # the partner's OWN profit before TradeOps (negative = loss) and what they already took
    net_profit = serializers.DecimalField(max_digits=16, decimal_places=2)
    withdrawn_amount = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=0, default=0)


class ProfitOpeningInputSerializer(serializers.Serializer):
    as_of = serializers.DateField()
    note = serializers.CharField(max_length=300, allow_blank=True, required=False, default="")
    lines = ProfitOpeningLineInputSerializer(many=True, allow_empty=False)


class PriorProfitSerializer(serializers.ModelSerializer):
    class Meta:
        model = PartnerPriorProfit
        fields = ["id", "partner", "period_start", "period_end", "amount", "note"]
        extra_kwargs = {"period_start": {"required": False, "allow_null": True},
                        "note": {"required": False}}

    def validate_partner(self, value):
        if self.instance is not None and value.pk != self.instance.partner_id:
            raise serializers.ValidationError("لا يمكن تغيير الشريك. احذف السطر وأضفه من جديد.")
        return value


def _partner_row(partner, preview):
    data = PartnerSerializer(partner).data
    data["balance"] = services.balance(partner)
    data["undistributed"] = services.undistributed_share(partner, preview)
    data["withdrawn_total"] = services.withdrawn_total(partner.pk)
    data["prior_profit_total"] = services.prior_profit_total(partner.pk)
    return data


@api_view(["GET", "POST"])
def partner_list(request):
    _guard(request)
    if request.method == "GET":
        preview = services.current_preview()
        rows = [_partner_row(p, preview) for p in Partner.objects.order_by("-is_active", "id")]
        return Response({
            "partners": rows,
            "period_start": preview["period_start"],
            "total_percent": preview["total_percent"],
            "period_net_profit": preview["net_profit"],
            "opening_configured": services.profit_opening() is not None,
        })
    serializer = PartnerSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "DELETE"])
def partner_detail(request, pk):
    _guard(request)
    try:
        partner = Partner.objects.get(pk=pk)
    except Partner.DoesNotExist:
        return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
    if request.method == "PUT":
        serializer = PartnerSerializer(partner, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
    if request.method == "DELETE":
        if (partner.withdrawals.exists() or partner.settlement_lines.exists() or partner.opening_lines.exists()
                or partner.prior_profits.exists()):
            raise ConflictError("للشريك سجلات سحب أو أرباح. عطّله بدلاً من حذفه.")
        partner.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    preview = services.current_preview()
    opening_line = ProfitOpeningLine.objects.filter(
        partner=partner, opening_id=1,
    ).select_related("opening").first()
    return Response({
        **_partner_row(partner, preview),
        "withdrawals": WithdrawalSerializer(partner.withdrawals.order_by("-date", "-id")[:200], many=True).data,
        "opening": ({
            "as_of": opening_line.opening.as_of,
            "net_profit": opening_line.share_amount,
            "withdrawn_amount": opening_line.withdrawn_amount,
        } if opening_line else None),
        "prior_profits": PriorProfitSerializer(
            partner.prior_profits.order_by("-period_end", "-id"), many=True,
        ).data,
        "history": [
            {"settlement": line.settlement_id, "period_start": line.settlement.period_start,
             "period_end": line.settlement.period_end, "net_profit": line.settlement.net_profit,
             "share_percent": line.share_percent, "share_amount": line.share_amount,
             "withdrawn_in_period": line.withdrawn_in_period}
            for line in SettlementLine.objects.filter(partner=partner).select_related("settlement")
            .order_by("-settlement__period_end")
        ],
    })


@api_view(["GET", "POST", "PUT"])
def profit_opening(request):
    _guard(request)
    if request.method == "GET":
        return Response(services.serialize_opening(services.profit_opening()))
    serializer = ProfitOpeningInputSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    opening = services.save_opening(serializer.validated_data, update=request.method == "PUT")
    return Response(services.serialize_opening(opening), status=(
        status.HTTP_200_OK if request.method == "PUT" else status.HTTP_201_CREATED
    ))


@api_view(["POST"])
def prior_profit_create(request):
    _guard(request)
    serializer = PriorProfitSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    entry = services.save_prior_profit(serializer.validated_data)
    return Response(PriorProfitSerializer(entry).data, status=status.HTTP_201_CREATED)


@api_view(["PUT", "DELETE"])
def prior_profit_detail(request, pk):
    _guard(request)
    entry = PartnerPriorProfit.objects.filter(pk=pk).first()
    if entry is None:
        return Response({"detail": "السطر غير موجود."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "DELETE":
        entry.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    serializer = PriorProfitSerializer(entry, data=request.data)
    serializer.is_valid(raise_exception=True)
    entry = services.save_prior_profit(serializer.validated_data, entry)
    return Response(PriorProfitSerializer(entry).data)


@api_view(["POST"])
def withdrawal_create(request):
    _guard(request)
    serializer = WithdrawalSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save(branch=default_branch())
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
def withdrawal_delete(request, pk):
    _guard(request)
    deleted, _ = PartnerWithdrawal.objects.filter(pk=pk).delete()
    return Response(status=status.HTTP_204_NO_CONTENT if deleted else status.HTTP_404_NOT_FOUND)


def _end_date(request):
    raw = request.query_params.get("end") or request.data.get("end")
    if not raw:
        return date.today() - timedelta(days=1)
    try:
        return date.fromisoformat(str(raw))
    except ValueError:
        raise serializers.ValidationError({"end": "تاريخ غير صالح."})


@api_view(["GET"])
def settlement_preview(request):
    _guard(request)
    data = services.preview_settlement(_end_date(request))
    return Response(data)


@api_view(["GET", "POST"])
def settlement_list(request):
    _guard(request)
    if request.method == "POST":
        settlement = services.settle(_end_date(request), request.data.get("note", ""))
        return Response({"id": settlement.pk}, status=status.HTTP_201_CREATED)
    rows = ProfitSettlement.objects.prefetch_related("lines__partner").order_by("-period_end", "-id")
    return Response([
        {"id": s.id, "period_start": s.period_start, "period_end": s.period_end, "net_profit": s.net_profit,
         "note": s.note,
         "lines": [{"partner": line.partner_id, "partner_name": line.partner.name,
                    "share_percent": line.share_percent, "share_amount": line.share_amount,
                    "withdrawn_in_period": line.withdrawn_in_period} for line in s.lines.all()]}
        for s in rows
    ])


@api_view(["DELETE"])
def settlement_detail(request, pk):
    _guard(request)
    try:
        settlement = ProfitSettlement.objects.get(pk=pk)
    except ProfitSettlement.DoesNotExist:
        return Response({"detail": "الإقفال غير موجود."}, status=status.HTTP_404_NOT_FOUND)
    services.undo_settlement(settlement)
    return Response(status=status.HTTP_204_NO_CONTENT)
