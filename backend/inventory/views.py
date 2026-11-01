from django.db.models import ProtectedError
from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from locations.models import StockMovement
from tradeops.errors import ConflictError, require_admin, require_feature

from .models import Category, OpeningStock, Product
from .opening import _payment, cancel_payment, correct_payment, link_to_supplier, pay_from_box, unlink
from .serializers import CategorySerializer, OpeningPaymentSerializer, ProductSerializer


@api_view(["GET", "POST"])
def category_list(request):
    """List all categories or create a new one."""
    if request.method == "GET":
        return Response(CategorySerializer(Category.objects.order_by("name"), many=True).data)

    serializer = CategorySerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["GET", "POST"])
def product_list(request):
    """List all products or create a new one."""
    if request.method == "GET":
        products = Product.objects.select_related("category").prefetch_related(
            "levels__branch", "levels__car"
        ).order_by("name")
        return Response(ProductSerializer(products, many=True, context={"request": request}).data)

    serializer = ProductSerializer(data=request.data, context={"request": request})
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "DELETE"])
def product_detail(request, pk):
    """Retrieve, update or delete a product."""
    try:
        product = Product.objects.select_related("category").get(pk=pk)
    except Product.DoesNotExist:
        return Response({"detail": "المنتج غير موجود."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        return Response(ProductSerializer(product, context={"request": request}).data)

    if request.method == "PUT":
        serializer = ProductSerializer(product, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    require_admin(request)
    try:
        product.delete()
    except ProtectedError:
        raise ConflictError("لا يمكن حذف المنتج لأنه مستخدم في طلبات بيع أو شراء.")
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def product_movements(request, pk):
    """The product's stock history, newest first."""
    rows = StockMovement.objects.filter(product_id=pk).select_related("branch", "car")[:300]
    return Response([
        {"id": m.id, "kind": m.kind, "kind_label": m.get_kind_display(), "delta": m.delta,
         "balance_after": m.balance_after, "place": m.car.name if m.car_id else (m.branch.name if m.branch_id else ""),
         "ref": m.ref, "note": m.note, "created_at": m.created_at}
        for m in rows
    ])


def _opening_row(o):
    po = o.purchase_order
    return {
        "id": o.id, "product": o.product_id, "product_name": o.product.name, "quantity": o.quantity,
        "unit_cost": o.unit_cost, "value": o.value, "date": o.date,
        "branch_name": o.branch.name if o.branch_id else "",
        "purchase_order": po.pk if po else None, "supplier": po.supplier if po else "",
        "paid": _paid_json(o),
    }


def _paid_json(o):
    """The cash box payment of opening stock, including a payment transferred to its supplier order."""
    paid = _payment(o)
    if paid is None:
        paid = o.supplier_payment if o.purchase_order_id and hasattr(o, "supplier_payment") else None
    if paid is None:
        return None
    return {
        "amount": paid.amount,
        "currency": paid.currency,
        "cash_amount": paid.cash_amount,
        "paid_amount": paid.paid_amount,
        "exchange_rate": paid.exchange_rate,
        "date": paid.date if hasattr(paid, "date") else paid.payment_date,
    }


@api_view(["GET"])
def opening_list(request):
    """Opening stock entries, the ones without a supplier first."""
    rows = OpeningStock.objects.select_related("product", "branch", "purchase_order").order_by(
        "purchase_order", "-date", "-id")
    return Response([_opening_row(o) for o in rows])


class LinkSerializer(serializers.Serializer):
    account = serializers.IntegerField(required=False, allow_null=True)
    supplier = serializers.CharField(required=False, allow_blank=True, max_length=255)
    supplier_phone = serializers.CharField(required=False, allow_blank=True, max_length=50)


@api_view(["POST", "DELETE"])
def opening_link(request, pk):
    """POST: link opening stock to a supplier (account or a name). DELETE: undo the link."""
    opening = OpeningStock.objects.filter(pk=pk).first()
    if opening is None:
        return Response({"detail": "الرصيد الافتتاحي غير موجود."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "DELETE":
        require_admin(request)
        unlink(opening)
        return Response(_opening_row(OpeningStock.objects.get(pk=pk)))
    s = LinkSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    d = s.validated_data
    account = None
    if d.get("account"):
        require_feature("accounts")
        from accounts.models import Account  # noqa: PLC0415

        account = Account.objects.filter(pk=d["account"]).first()
        if account is None:
            return Response({"detail": "الحساب غير موجود."}, status=status.HTTP_404_NOT_FOUND)
    link_to_supplier(opening, account=account, supplier=d.get("supplier", ""), phone=d.get("supplier_phone", ""))
    return Response(_opening_row(OpeningStock.objects.get(pk=pk)), status=status.HTTP_201_CREATED)


@api_view(["POST", "PUT", "DELETE"])
def opening_pay(request, pk):
    """POST records payment, PUT corrects it, DELETE cancels it."""
    require_admin(request)
    opening = OpeningStock.objects.filter(pk=pk).first()
    if opening is None:
        return Response({"detail": "الرصيد الافتتاحي غير موجود."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "DELETE":
        cancel_payment(opening)
        return Response(_opening_row(OpeningStock.objects.get(pk=pk)))
    s = OpeningPaymentSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    d = s.validated_data
    if request.method == "PUT":
        correct_payment(
            opening, amount=d["amount"], currency=d["currency"], paid_amount=d.get("paid_amount"),
            exchange_rate=d.get("exchange_rate"), when=d.get("date"),
        )
        return Response(_opening_row(OpeningStock.objects.get(pk=pk)))
    pay_from_box(opening, d["amount"], currency=d["currency"], paid_amount=d.get("paid_amount"),
                 exchange_rate=d.get("exchange_rate"), when=d.get("date"))
    return Response(_opening_row(OpeningStock.objects.get(pk=pk)), status=status.HTTP_201_CREATED)
