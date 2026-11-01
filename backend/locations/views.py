from decimal import Decimal

from django.db.models import Q, Sum
from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from inventory.stock import default_branch, transfer_many
from invoice.models import Expense
from order.models import OrderItem
from tradeops.errors import BusinessRuleError, ConflictError, is_admin, require_admin, require_feature
from tradeops.fields import QuantityField

from .models import Branch, Car, StockTransfer

ZERO = Decimal("0")


class BranchSerializer(serializers.ModelSerializer):
    class Meta:
        model = Branch
        fields = ["id", "name", "address", "phone", "is_default", "is_active"]
        read_only_fields = ["is_default"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("اسم الفرع مطلوب.")
        return value


class CarSerializer(serializers.ModelSerializer):
    class Meta:
        model = Car
        fields = ["id", "name", "plate", "driver_name", "phone", "notes", "is_active"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("اسم السيارة مطلوب.")
        return value


class TransferLineSerializer(serializers.Serializer):
    product = serializers.IntegerField()
    quantity = QuantityField(min_value=Decimal("0.001"))


class TransferSerializer(serializers.Serializer):
    """Several products in one move (`lines`), or the older single product + quantity."""
    lines = TransferLineSerializer(many=True, required=False)
    product = serializers.IntegerField(required=False)
    quantity = QuantityField(min_value=Decimal("0.001"), required=False)
    from_branch = serializers.IntegerField(required=False, allow_null=True)
    from_car = serializers.IntegerField(required=False, allow_null=True)
    to_branch = serializers.IntegerField(required=False, allow_null=True)
    to_car = serializers.IntegerField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, max_length=300)


def _place(branch, car):
    return car.name if car else branch.name


@api_view(["GET", "POST"])
def branch_list(request):
    default_branch()  # make sure the default branch exists
    if request.method == "GET":
        return Response(BranchSerializer(Branch.objects.order_by("-is_default", "name"), many=True).data)
    require_admin(request)
    require_feature("branches")
    serializer = BranchSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["PUT", "DELETE"])
def branch_detail(request, pk):
    require_admin(request)
    try:
        branch = Branch.objects.get(pk=pk)
    except Branch.DoesNotExist:
        return Response({"detail": "الفرع غير موجود."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "PUT":
        serializer = BranchSerializer(branch, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
    if branch.is_default:
        raise ConflictError("لا يمكن حذف الفرع الرئيسي.")
    if branch.levels.filter(quantity__gt=0).exists():
        raise ConflictError("لا يمكن حذف فرع يحتوي على مخزون. انقل البضاعة أولاً.")
    branch.delete()  # ProtectedError (orders / history) becomes a clear 409 in the error handler
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET", "POST"])
def car_list(request):
    require_feature("cars")
    if request.method == "GET":
        return Response(CarSerializer(Car.objects.order_by("name"), many=True).data)
    serializer = CarSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "DELETE"])
def car_detail(request, pk):
    require_feature("cars")
    try:
        car = Car.objects.get(pk=pk)
    except Car.DoesNotExist:
        return Response({"detail": "السيارة غير موجودة."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "PUT":
        serializer = CarSerializer(car, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    if request.method == "DELETE":
        require_admin(request)
        if car.levels.filter(quantity__gt=0).exists():
            raise ConflictError("لا يمكن حذف سيارة تحتوي على مخزون. أعد البضاعة للفرع أولاً.")
        car.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # The car's page: what it carries, what it cost, what it sold.
    stock = [
        {"product": level.product_id, "product_name": level.product.name, "unit": level.product.unit,
         "quantity": level.quantity, "value": level.quantity * level.product.unit_cost}
        for level in car.levels.select_related("product").filter(quantity__gt=0).order_by("product__name")
    ]
    expenses = Expense.objects.filter(car=car, type="EXPENSE").order_by("-date", "-id")
    # Goods that left this car: lines sold from it (their own place, or the order's when the line has
    # none), what the customer kept, at the line's price after the order's discount share.
    lines = OrderItem.objects.filter(order__is_finalized=True).filter(
        Q(car=car) | Q(car__isnull=True, branch__isnull=True, order__car=car)
    ).select_related("order").prefetch_related("returned", "order__items", "order__freelance_jobs")
    revenue, order_ids = ZERO, set()
    for line in lines:
        order = line.order
        factor = order.grand_total / order.subtotal if order.subtotal > ZERO else Decimal("1")
        kept = line.quantity - sum((r.quantity for r in line.returned.all()), ZERO)
        revenue += kept * line.unit_price * factor
        order_ids.add(order.pk)
    revenue = revenue.quantize(Decimal("0.01"))
    stock_value = sum((row["value"] for row in stock), ZERO)
    if not is_admin(request.user):  # values come from cost prices: the owner's eyes only
        for row in stock:
            row.pop("value")
        stock_value = None
    return Response({
        **CarSerializer(car).data,
        "stock": stock,
        "stock_value": stock_value,
        "expenses": [
            {"id": e.id, "category": e.category, "description": e.description, "amount": e.amount, "date": e.date}
            for e in expenses[:200]
        ],
        "expenses_total": expenses.aggregate(total=Sum("amount"))["total"] or ZERO,
        "sales_count": len(order_ids),
        "sales_total": revenue,
    })


@api_view(["GET", "POST"])
def transfer_list(request):
    if request.method == "GET":
        rows = StockTransfer.objects.select_related(
            "product", "from_branch", "from_car", "to_branch", "to_car"
        ).order_by("-id")[:200]
        return Response([
            {"id": t.id, "product": t.product_id, "product_name": t.product.name, "quantity": t.quantity,
             "from": _place(t.from_branch, t.from_car), "to": _place(t.to_branch, t.to_car),
             "note": t.note, "created_at": t.created_at}
            for t in rows
        ])
    serializer = TransferSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    if data.get("from_car") or data.get("to_car"):
        require_feature("cars")
    else:
        require_feature("branches")
    from_branch, from_car = data.get("from_branch"), data.get("from_car")
    to_branch, to_car = data.get("to_branch"), data.get("to_car")
    # An unnamed end of the transfer is the default branch ("move 4 to the car").
    if not from_branch and not from_car:
        from_branch = default_branch().pk
    if not to_branch and not to_car:
        to_branch = default_branch().pk
    lines = data.get("lines") or (
        [{"product": data["product"], "quantity": data["quantity"]}] if data.get("product") and data.get("quantity") else []
    )
    if not lines:
        raise BusinessRuleError("أضف منتجاً واحداً على الأقل للنقل.")
    transfer_many(
        [(line["product"], line["quantity"]) for line in lines],
        from_branch=from_branch, from_car=from_car, to_branch=to_branch, to_car=to_car,
        note=data.get("note", ""),
    )
    return Response(status=status.HTTP_201_CREATED)
