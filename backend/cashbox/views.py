from decimal import Decimal

from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from inventory.stock import default_branch
from tradeops.errors import require_admin, require_feature

from . import services
from .models import BoxEntry, Exchange


def _branch(request):
    value = request.query_params.get("branch", "")
    return int(value) if value.isdigit() else None


class EntrySerializer(serializers.Serializer):
    currency = serializers.ChoiceField(choices=services.CURRENCIES)
    kind = serializers.ChoiceField(choices=[BoxEntry.DEPOSIT, BoxEntry.WITHDRAWAL])
    amount = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal("0.01"))
    note = serializers.CharField(required=False, allow_blank=True, max_length=300)
    date = serializers.DateField(required=False)
    branch = serializers.IntegerField(required=False, allow_null=True)


class ExchangeSerializer(serializers.Serializer):
    from_currency = serializers.ChoiceField(choices=services.CURRENCIES)
    from_amount = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal("0.01"))
    rate = serializers.DecimalField(max_digits=14, decimal_places=4, min_value=Decimal("0.0001"))
    note = serializers.CharField(required=False, allow_blank=True, max_length=300)
    date = serializers.DateField(required=False)
    branch = serializers.IntegerField(required=False, allow_null=True)


class MovementEditSerializer(serializers.Serializer):
    ref = serializers.CharField(max_length=80)
    currency = serializers.ChoiceField(choices=services.CURRENCIES)
    amount = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal("0.01"))
    date = serializers.DateField()
    note = serializers.CharField(required=False, allow_blank=True, max_length=300)
    rate = serializers.DecimalField(max_digits=14, decimal_places=4, min_value=Decimal("0.0001"),
                                    required=False, allow_null=True)


@api_view(["GET"])
def boxes(request):
    require_admin(request)
    require_feature("money_boxes")
    return Response(services.summary(_branch(request)))


@api_view(["GET"])
def statement(request):
    require_admin(request)
    require_feature("money_boxes")
    currency = request.query_params.get("currency", "USD")
    if currency not in services.CURRENCIES:
        return Response({"detail": "عملة غير معروفة."}, status=status.HTTP_400_BAD_REQUEST)
    rows = services.movements(currency, _branch(request))
    running = Decimal("0")
    for row in rows:  # running balance, oldest first
        running += row["amount"]
        row["balance"] = running
    return Response(list(reversed(rows))[:500])


@api_view(["POST"])
def add_entry(request):
    require_admin(request)
    require_feature("money_boxes")
    s = EntrySerializer(data=request.data)
    s.is_valid(raise_exception=True)
    d = s.validated_data
    services.add_entry(d["currency"], d["kind"], d["amount"], d.get("note", ""), d.get("date"),
                       d.get("branch") or default_branch().pk)
    return Response(status=status.HTTP_201_CREATED)


@api_view(["PUT"])
def edit_movement(request):
    require_admin(request)
    require_feature("money_boxes")
    serializer = MovementEditSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    services.edit_movement(
        data["ref"], data["currency"], data["amount"], data["date"], data.get("note", ""),
        data.get("rate"),
    )
    return Response(status=status.HTTP_200_OK)


@api_view(["GET", "POST"])
def exchanges(request):
    require_admin(request)
    require_feature("money_boxes")
    if request.method == "GET":
        return Response([
            {"id": e.id, "from_currency": e.from_currency, "to_currency": e.to_currency,
             "from_amount": e.from_amount, "to_amount": e.to_amount, "rate": e.rate, "note": e.note,
             "date": e.date}
            for e in Exchange.objects.order_by("-date", "-id")[:100]
        ])
    s = ExchangeSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    d = s.validated_data
    swap = services.exchange(d["from_currency"], d["from_amount"], d["rate"], d.get("note", ""),
                             d.get("date"), d.get("branch") or default_branch().pk)
    return Response({"to_currency": swap.to_currency, "to_amount": swap.to_amount}, status=status.HTTP_201_CREATED)
