from decimal import Decimal

from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from tradeops.currency import MultiCurrencyMixin
from tradeops.errors import require_admin, require_feature
from tradeops.fields import QuantityField

from .models import PurchaseOrder, PurchaseReturn
from .returns import create_purchase_return, delete_purchase_return
from .serializers import POPaymentSerializer, PurchaseOrderSerializer
from .services import (
    add_po_payment,
    cancel_purchase_order,
    delete_purchase_order,
    receive_purchase_order,
    set_transport,
)

NOT_FOUND = {"detail": "أمر الشراء غير موجود."}


def _orders():
    return PurchaseOrder.objects.prefetch_related("items__product", "items__returned", "payments",
                                                  "returns__lines__item__product")


@api_view(["GET", "POST"])
def po_list(request):
    if request.method == "GET":
        orders = _orders()
        branch = request.query_params.get("branch", "")
        if branch.isdigit():
            orders = orders.filter(branch_id=int(branch))
        return Response(PurchaseOrderSerializer(orders.order_by("-created_at", "-id"), many=True).data)

    serializer = PurchaseOrderSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    po = serializer.save()
    return Response(PurchaseOrderSerializer(_orders().get(pk=po.pk)).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "DELETE"])
def po_detail(request, pk):
    try:
        po = _orders().get(pk=pk)
    except PurchaseOrder.DoesNotExist:
        return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        return Response(PurchaseOrderSerializer(po).data)

    if request.method == "PUT":
        serializer = PurchaseOrderSerializer(po, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(PurchaseOrderSerializer(_orders().get(pk=pk)).data)

    require_admin(request)
    delete_purchase_order(po, request.query_params.get("payments"))
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
def add_payment(request, po_id):
    try:
        po = PurchaseOrder.objects.get(pk=po_id)
    except PurchaseOrder.DoesNotExist:
        return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)

    serializer = POPaymentSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    d = serializer.validated_data
    add_po_payment(po, d["amount"], d.get("payment_date"), currency=d["currency"],
                   paid_amount=d.get("paid_amount"), exchange_rate=d.get("exchange_rate"))
    return Response(PurchaseOrderSerializer(_orders().get(pk=po_id)).data, status=status.HTTP_201_CREATED)


class ReceiveLineSerializer(serializers.Serializer):
    item = serializers.IntegerField()
    quantity = QuantityField()


class ReceiveSerializer(serializers.Serializer):
    """Empty body = everything still due, into the order's branch."""
    items = ReceiveLineSerializer(many=True, required=False)
    branch = serializers.IntegerField(required=False, allow_null=True)
    car = serializers.IntegerField(required=False, allow_null=True)


class TransportSerializer(MultiCurrencyMixin, serializers.Serializer):
    """amount = the fee in USD (or paid_amount + exchange_rate when a carrier is paid in SYP)."""
    payee = serializers.ChoiceField(choices=[PurchaseOrder.SUPPLIER, PurchaseOrder.CARRIER])
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"), required=False)
    currency = serializers.CharField(required=False)
    paid_amount = serializers.DecimalField(max_digits=16, decimal_places=2, required=False, allow_null=True)
    exchange_rate = serializers.DecimalField(max_digits=14, decimal_places=4, required=False, allow_null=True)
    date = serializers.DateField(required=False)

    def validate(self, attrs):
        if attrs.get("amount") == 0 and attrs.get("currency", "USD") == "USD":
            attrs["currency"] = "USD"
            attrs["paid_amount"] = None
            return attrs  # removing the fee
        return super().validate(attrs)


@api_view(["POST"])
def receive_order(request, pk):
    try:
        po = PurchaseOrder.objects.get(pk=pk)
    except PurchaseOrder.DoesNotExist:
        return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
    s = ReceiveSerializer(data=request.data or {})
    s.is_valid(raise_exception=True)
    d = s.validated_data
    if d.get("car"):
        require_feature("cars")
    lines = {line["item"]: line["quantity"] for line in d["items"]} if d.get("items") else None
    receive_purchase_order(po, lines, branch_id=d.get("branch"), car_id=d.get("car"))
    return Response(PurchaseOrderSerializer(_orders().get(pk=pk)).data)


@api_view(["POST"])
def transport(request, pk):
    """Set or fill in later the transport / loading fee and who is paid."""
    try:
        po = PurchaseOrder.objects.get(pk=pk)
    except PurchaseOrder.DoesNotExist:
        return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
    s = TransportSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    d = s.validated_data
    set_transport(po, d.get("amount") or Decimal("0"), d["payee"], currency=d.get("currency", "USD"),
                  paid_amount=d.get("paid_amount"), exchange_rate=d.get("exchange_rate"), pay_date=d.get("date"))
    return Response(PurchaseOrderSerializer(_orders().get(pk=pk)).data)


class ReturnLineInput(serializers.Serializer):
    item = serializers.IntegerField()
    quantity = QuantityField()
    branch = serializers.IntegerField(required=False, allow_null=True)
    car = serializers.IntegerField(required=False, allow_null=True)


class ReturnInput(serializers.Serializer):
    """money_action: what happens to money we paid beyond the new value ("refund" / "credit")."""
    lines = ReturnLineInput(many=True)
    date = serializers.DateField(required=False)
    note = serializers.CharField(required=False, allow_blank=True, max_length=300)
    money_action = serializers.ChoiceField(choices=["refund", "credit"], required=False, allow_null=True)
    currency = serializers.ChoiceField(choices=["USD", "SYP"], required=False)
    exchange_rate = serializers.DecimalField(max_digits=14, decimal_places=4, required=False, allow_null=True)


@api_view(["POST"])
def po_return(request, pk):
    """Send received goods back to the supplier."""
    try:
        po = PurchaseOrder.objects.get(pk=pk)
    except PurchaseOrder.DoesNotExist:
        return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
    s = ReturnInput(data=request.data)
    s.is_valid(raise_exception=True)
    d = s.validated_data
    if d.get("currency") == "SYP":
        require_feature("money_boxes")
    create_purchase_return(po, d["lines"], when=d.get("date"), note=d.get("note", ""),
                           money_action=d.get("money_action"), currency=d.get("currency", "USD"),
                           exchange_rate=d.get("exchange_rate"))
    return Response(PurchaseOrderSerializer(_orders().get(pk=pk)).data, status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
def po_return_delete(request, pk, return_id):
    require_admin(request)
    ret = PurchaseReturn.objects.filter(pk=return_id, purchase_order_id=pk).first()
    if ret is None:
        return Response({"detail": "المرتجع غير موجود."}, status=status.HTTP_404_NOT_FOUND)
    delete_purchase_return(ret)
    return Response(PurchaseOrderSerializer(_orders().get(pk=pk)).data)


@api_view(["POST"])
def cancel_order(request, pk):
    try:
        po = PurchaseOrder.objects.get(pk=pk)
    except PurchaseOrder.DoesNotExist:
        return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
    cancel_purchase_order(po, request.data.get("payments") or request.query_params.get("payments"))
    return Response(PurchaseOrderSerializer(_orders().get(pk=pk)).data)
