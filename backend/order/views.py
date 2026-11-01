from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from tradeops.errors import require_admin, require_feature
from tradeops.fields import QuantityField
from whatsapp.reports import notify_sale_later

from .models import SalesOrder, SalesReturn
from .returns import create_sales_return, delete_sales_return
from .serializers import ClientPaymentSerializer, SalesOrderSerializer
from .services import add_client_payment, delete_sales_order, finalize_sales_order


def _ser(request, instance=None, **kwargs):
    """Serializer with the request in context (hides admin-only figures from staff)."""
    return SalesOrderSerializer(instance, context={"request": request}, **kwargs)


def _orders():
    return SalesOrder.objects.prefetch_related("items__product", "items__branch", "items__car", "items__returned",
                                               "freelance_jobs", "payments", "returns__lines__order_item__product")


@api_view(["GET", "POST"])
def sales_order_list(request):
    if request.method == "GET":
        orders = _orders()
        branch = request.query_params.get("branch", "")
        if branch.isdigit():
            orders = orders.filter(branch_id=int(branch))
        return Response(_ser(request, orders.order_by("-date", "-id"), many=True).data)

    serializer = _ser(request, data=request.data)
    serializer.is_valid(raise_exception=True)
    order = serializer.save()
    return Response(_ser(request, _orders().get(pk=order.pk)).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "DELETE"])
def sales_order_detail(request, pk):
    try:
        order = _orders().get(pk=pk)
    except SalesOrder.DoesNotExist:
        return Response({"detail": "الطلب غير موجود."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        return Response(_ser(request, order).data)

    if request.method == "PUT":
        serializer = _ser(request, order, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(_ser(request, _orders().get(pk=pk)).data)

    require_admin(request)
    delete_sales_order(order, request.query_params.get("payments"))
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
def add_order_payment(request, order_id):
    try:
        order = SalesOrder.objects.get(pk=order_id)
    except SalesOrder.DoesNotExist:
        return Response({"detail": "الطلب غير موجود."}, status=status.HTTP_404_NOT_FOUND)

    serializer = ClientPaymentSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    d = serializer.validated_data
    add_client_payment(order, d["amount"], d.get("date"), currency=d["currency"],
                       paid_amount=d.get("paid_amount"), exchange_rate=d.get("exchange_rate"))
    return Response(_ser(request, _orders().get(pk=order_id)).data, status=status.HTTP_201_CREATED)


class ReturnLineInput(serializers.Serializer):
    item = serializers.IntegerField()
    quantity = QuantityField()
    branch = serializers.IntegerField(required=False, allow_null=True)
    car = serializers.IntegerField(required=False, allow_null=True)


class ReturnInput(serializers.Serializer):
    """money_action: what happens to money paid beyond the new total ("refund" / "credit")."""
    lines = ReturnLineInput(many=True)
    date = serializers.DateField(required=False)
    note = serializers.CharField(required=False, allow_blank=True, max_length=300)
    money_action = serializers.ChoiceField(choices=["refund", "credit"], required=False, allow_null=True)
    currency = serializers.ChoiceField(choices=["USD", "SYP"], required=False)
    exchange_rate = serializers.DecimalField(max_digits=14, decimal_places=4, required=False, allow_null=True)


@api_view(["POST"])
def order_return(request, pk):
    """A customer brought goods back from a finalized order."""
    try:
        order = SalesOrder.objects.get(pk=pk)
    except SalesOrder.DoesNotExist:
        return Response({"detail": "الطلب غير موجود."}, status=status.HTTP_404_NOT_FOUND)
    s = ReturnInput(data=request.data)
    s.is_valid(raise_exception=True)
    d = s.validated_data
    if d.get("currency") == "SYP":
        require_feature("money_boxes")
    create_sales_return(order, d["lines"], when=d.get("date"), note=d.get("note", ""),
                        money_action=d.get("money_action"), currency=d.get("currency", "USD"),
                        exchange_rate=d.get("exchange_rate"))
    return Response(_ser(request, _orders().get(pk=pk)).data, status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
def order_return_delete(request, pk, return_id):
    require_admin(request)
    ret = SalesReturn.objects.filter(pk=return_id, order_id=pk).first()
    if ret is None:
        return Response({"detail": "المرتجع غير موجود."}, status=status.HTTP_404_NOT_FOUND)
    delete_sales_return(ret)
    return Response(_ser(request, _orders().get(pk=pk)).data)


@api_view(["POST"])
def finalize_order(request, pk):
    try:
        order = SalesOrder.objects.get(pk=pk)
    except SalesOrder.DoesNotExist:
        return Response({"detail": "الطلب غير موجود."}, status=status.HTTP_404_NOT_FOUND)
    finalize_sales_order(order)
    notify_sale_later(order.pk)  # the WhatsApp group hears about it (if switched on)
    return Response(_ser(request, _orders().get(pk=pk)).data)
