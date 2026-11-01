from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from locations.models import StockMovement
from tradeops.currency import MultiCurrencyMixin
from tradeops.errors import is_admin
from tradeops.fields import QuantityField

from .models import Category, OpeningStock, Product
from .opening import cancel_payment, correct_payment, pay_from_box
from .stock import adjust_stock, default_branch, levels_for


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("اسم الفئة مطلوب.")
        clash = Category.objects.filter(name__iexact=value)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("هذه الفئة موجودة مسبقاً.")
        return value


class OpeningPaymentSerializer(MultiCurrencyMixin, serializers.Serializer):
    """Opening stock paid from a cash box: amount in USD, or SYP handed over plus the rate."""

    currency = serializers.CharField(required=False)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"), required=False)
    paid_amount = serializers.DecimalField(max_digits=16, decimal_places=2, required=False, allow_null=True)
    exchange_rate = serializers.DecimalField(max_digits=14, decimal_places=4, required=False, allow_null=True)
    date = serializers.DateField(required=False)


class OpeningPaymentCorrectionSerializer(serializers.Serializer):
    opening_id = serializers.IntegerField()
    cancel = serializers.BooleanField(required=False, default=False)
    payment = OpeningPaymentSerializer(required=False)

    def validate(self, attrs):
        if attrs.get("cancel", False) == ("payment" in attrs):
            raise serializers.ValidationError("حدد دفعة جديدة أو اختر إلغاء الدفع.")
        return attrs


class ProductSerializer(serializers.ModelSerializer):
    # Accepts a category id, an existing category name, a brand-new name, or
    # empty/null (no category).
    category = serializers.CharField(write_only=True, required=False, allow_null=True, allow_blank=True)
    category_details = CategorySerializer(source="category", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True, default="")
    current_stock = QuantityField(required=False)
    reorder_threshold = QuantityField(required=False)
    # Where starting stock / a stock correction is applied (default branch when empty).
    branch = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    # Why a count was corrected by hand (required when the quantity changes on edit).
    stock_reason = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=300)
    # New product with stock: the cash box it was paid from (admin only). Empty = old goods, not paid now.
    opening_payment = OpeningPaymentSerializer(write_only=True, required=False, allow_null=True)
    # Optional, atomic correction of the payment attached to an opening-stock entry during product edits.
    opening_payment_correction = OpeningPaymentCorrectionSerializer(write_only=True, required=False)
    unit_cost = serializers.DecimalField(max_digits=14, decimal_places=4, min_value=Decimal("0"))
    stock_by_location = serializers.SerializerMethodField()

    def get_stock_by_location(self, product):
        return [
            {**row, "quantity": float(row["quantity"])} for row in levels_for(product)
        ]

    class Meta:
        model = Product
        fields = [
            "id", "name", "category", "category_details", "category_name",
            "unit_cost", "selling_price", "wholesale_price", "current_stock", "reorder_threshold",
            "allow_decimal", "unit", "branch", "stock_reason", "opening_payment",
            "opening_payment_correction", "stock_by_location",
        ]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("اسم المنتج مطلوب.")
        return value

    def _staff(self) -> bool:
        request = self.context.get("request")
        return bool(request) and not is_admin(request.user)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if self._staff():
            data.pop("unit_cost", None)  # cost prices are the owner's
        return data

    def validate(self, attrs):
        # Whole-number products cannot hold fractions (also when the switch is turned off later).
        instance = self.instance
        allow = attrs.get("allow_decimal", instance.allow_decimal if instance else False)
        if not allow:
            for field in ("current_stock", "reorder_threshold"):
                value = attrs.get(field, getattr(instance, field, None) if instance else None)
                if value is not None and value != value.to_integral_value():
                    raise serializers.ValidationError(
                        {field: "هذا المنتج لا يقبل الكسور. فعّل خيار الكسور أولاً."}
                    )
        return attrs

    @staticmethod
    def _resolve_category(raw):
        """Return (found, category). found=False means 'leave unchanged'."""
        if raw is None or str(raw).strip() == "":
            return True, None
        raw = str(raw).strip()
        if raw.isdigit():
            category = Category.objects.filter(pk=int(raw)).first()
            if category:
                return True, category
        category = Category.objects.filter(name__iexact=raw).first()
        if category is None:
            category = Category.objects.create(name=raw)
        return True, category

    @transaction.atomic
    def create(self, validated_data):
        if "category" in validated_data:
            _, validated_data["category"] = self._resolve_category(validated_data["category"])
        branch_id = validated_data.pop("branch", None)
        validated_data.pop("stock_reason", None)
        payment = validated_data.pop("opening_payment", None)
        stock = validated_data.pop("current_stock", Decimal("0"))
        product = super().create(validated_data)
        if stock > 0:
            # Opening stock without a supplier: paid from a cash box now, or old goods not paid now.
            # It can be linked to a supplier later (OpeningStock -> a received purchase order).
            branch_id = branch_id or default_branch().pk
            product = adjust_stock(product.pk, stock, branch_id=branch_id, kind=StockMovement.OPENING)
            opening = OpeningStock.objects.create(product=product, quantity=stock, unit_cost=product.unit_cost,
                                                  branch_id=branch_id)
            if payment:
                if self._staff():
                    raise serializers.ValidationError({"opening_payment": "الدفع من الصندوق للمدير فقط."})
                pay_from_box(opening, payment["amount"], currency=payment["currency"],
                             paid_amount=payment.get("paid_amount"), exchange_rate=payment.get("exchange_rate"),
                             when=payment.get("date"))
        return product

    @transaction.atomic
    def update(self, instance, validated_data):
        if "category" in validated_data:
            _, validated_data["category"] = self._resolve_category(validated_data["category"])
        if self._staff():
            validated_data.pop("unit_cost", None)  # staff cannot see it, so they cannot change it either
        original_stock = instance.current_stock
        branch_id = validated_data.pop("branch", None)
        reason = (validated_data.pop("stock_reason", "") or "").strip()
        new_stock = validated_data.pop("current_stock", None)
        validated_data.pop("opening_payment", None)
        payment_correction = validated_data.pop("opening_payment_correction", None)
        if payment_correction and self._staff():
            raise serializers.ValidationError({"opening_payment_correction": "تصحيح حركة الصندوق للمدير فقط."})
        instance = super().update(instance, validated_data)
        if new_stock is not None and new_stock != instance.current_stock:
            if not reason:
                raise serializers.ValidationError({"stock_reason": "اكتب سبب تعديل الكمية (جرد، تالف، ...)."})
            # A manual count correction at one place; the total follows.
            instance = adjust_stock(instance.pk, new_stock - instance.current_stock, branch_id=branch_id,
                                    kind=StockMovement.CORRECTION, note=reason)
        openings = list(OpeningStock.objects.select_for_update().filter(product=instance).select_related(
            "purchase_order",
        ))
        if len(openings) == 1:
            opening = openings[0]
            quantity_delta = (new_stock - original_stock) if new_stock is not None else Decimal("0")
            opening.quantity = max(opening.quantity + quantity_delta, Decimal("0"))
            opening.unit_cost = instance.unit_cost
            opening.save(update_fields=["quantity", "unit_cost"])

            if opening.purchase_order_id:
                from accounts.services import apply_credit  # noqa: PLC0415
                from purchase_order.models import PurchaseOrderItem  # noqa: PLC0415
                from purchase_order.services import refresh_costs  # noqa: PLC0415

                po = opening.purchase_order
                item = PurchaseOrderItem.objects.select_for_update().filter(
                    purchase_order=po, product=instance,
                ).first()
                if item is None or po.items.count() != 1:
                    raise serializers.ValidationError(
                        {"current_stock": "لا يمكن مزامنة رصيد افتتاحي مرتبط بأمر شراء متعدد البنود."}
                    )
                returned = sum((line.quantity for line in item.returned.all()), Decimal("0"))
                if opening.quantity < returned or opening.quantity < Decimal("0.001"):
                    raise serializers.ValidationError(
                        {"current_stock": "لا يمكن أن تصبح كمية الرصيد الافتتاحي أقل من الكمية المرتجعة أو صفراً."}
                    )
                item.quantity = opening.quantity
                item.received_quantity = opening.quantity
                item.unit_cost = opening.unit_cost
                item.save(update_fields=["quantity", "received_quantity", "unit_cost"])
                refresh_costs(po)
                apply_credit(po.account)

            from invoice.models import Expense  # noqa: PLC0415

            opening_payment = Expense.objects.filter(opening_stock=opening).first()
            if opening_payment:
                opening_payment.description = (
                    f"شراء بضاعة: {instance.name} × {opening.quantity.normalize():f} (رصيد افتتاحي)"
                )
                opening_payment.save(update_fields=["description"])
        if payment_correction:
            opening = OpeningStock.objects.filter(
                pk=payment_correction["opening_id"], product=instance,
            ).first()
            if opening is None:
                raise serializers.ValidationError({"opening_payment_correction": "الرصيد الافتتاحي غير موجود لهذا المنتج."})
            if payment_correction.get("cancel", False):
                cancel_payment(opening)
            else:
                payment = payment_correction["payment"]
                correct_payment(
                    opening, amount=payment["amount"], currency=payment["currency"],
                    paid_amount=payment.get("paid_amount"), exchange_rate=payment.get("exchange_rate"),
                    when=payment.get("date"),
                )
        return instance
