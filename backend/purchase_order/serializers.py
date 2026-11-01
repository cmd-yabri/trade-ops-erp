from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from rest_framework.exceptions import PermissionDenied

from accounts.services import apply_credit, direct_paid, release_credit
from audit.models import EditLog
from audit.services import log_edit, purchase_snapshot
from inventory.stock import check_quantity_for_product, default_branch
from tradeops.currency import MultiCurrencyMixin
from tradeops.errors import BusinessRuleError, is_admin, require_feature
from tradeops.fields import MoneyField, QuantityField

from .models import POPayment, PurchaseOrder, PurchaseOrderItem, PurchaseReturn
from .services import refresh_costs, set_transport


class POPaymentSerializer(MultiCurrencyMixin, serializers.ModelSerializer):
    class Meta:
        model = POPayment
        fields = ["id", "amount", "payment_date", "currency", "paid_amount", "exchange_rate"]
        extra_kwargs = {"payment_date": {"required": False}, "amount": {"required": False},
                        "currency": {"required": False}}


class POItemSerializer(serializers.ModelSerializer):
    product_name = serializers.ReadOnlyField(source="product.name")
    total_cost = MoneyField()
    quantity = QuantityField()
    received_quantity = QuantityField(read_only=True)
    returned_quantity = serializers.SerializerMethodField()

    def get_returned_quantity(self, item):
        return float(sum((line.quantity for line in item.returned.all()), Decimal("0")))
    # Sent back on an edit of a received order so each line keeps its received quantity.
    id = serializers.IntegerField(required=False)
    unit_cost = serializers.DecimalField(max_digits=14, decimal_places=4, min_value=Decimal("0"))

    class Meta:
        model = PurchaseOrderItem
        fields = ["id", "product", "product_name", "quantity", "received_quantity", "unit_cost",
                  "landed_unit_cost", "total_cost", "returned_quantity"]
        read_only_fields = ["landed_unit_cost"]

    def validate(self, attrs):
        check_quantity_for_product(attrs["product"], attrs["quantity"])
        return attrs


class PurchaseReturnLineOut(serializers.Serializer):
    product_name = serializers.CharField(source="item.product.name")
    quantity = QuantityField()
    value = MoneyField()


class PurchaseReturnSerializer(serializers.ModelSerializer):
    lines = PurchaseReturnLineOut(many=True, read_only=True)
    value = MoneyField()
    refund_amount = MoneyField()

    class Meta:
        model = PurchaseReturn
        fields = ["id", "date", "note", "value", "refund_amount", "refund_to_credit", "currency", "paid_amount",
                  "lines"]


class PurchaseOrderSerializer(serializers.ModelSerializer):
    items = POItemSerializer(many=True, required=False)
    payments = POPaymentSerializer(many=True, read_only=True)
    returns = PurchaseReturnSerializer(many=True, read_only=True)
    returned_total = MoneyField()
    due_total = MoneyField()

    total_cost = MoneyField()
    net_total = MoneyField()
    paid_amount = MoneyField()
    remaining = MoneyField()
    paymentStatus = serializers.CharField(source="payment_status", read_only=True)
    payment_status = serializers.CharField(read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True, default="")
    account_name = serializers.CharField(source="account.name", read_only=True, default="")
    # Set with the order (USD, paid from the USD box when a carrier gets it); changed later through
    # the transport endpoint, which also takes SYP.
    transport_cost = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"),
                                              required=False)
    transport_payee = serializers.ChoiceField(choices=[PurchaseOrder.SUPPLIER, PurchaseOrder.CARRIER], required=False)

    class Meta:
        model = PurchaseOrder
        fields = [
            "id", "account", "account_name", "branch", "branch_name", "supplier", "supplier_phone", "order_date", "status", "items", "payments",
            "total_cost", "discount", "transport_cost", "transport_payee", "net_total", "paid_amount", "remaining",
            "paymentStatus", "payment_status", "created_at", "received_at", "returns", "returned_total", "due_total",
        ]
        read_only_fields = ["status", "created_at", "received_at"]
        extra_kwargs = {"order_date": {"required": False}}

    def validate_supplier(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("اسم المورد مطلوب.")
        return value

    def validate_account(self, account):
        if account is not None and not account.is_supplier:
            raise serializers.ValidationError("هذا الحساب ليس مورداً.")
        return account

    def validate(self, attrs):
        instance = self.instance
        if attrs.get("account"):
            require_feature("accounts")
        if instance is not None and instance.status == "CANCELLED":
            raise BusinessRuleError("لا يمكن تعديل أمر شراء ملغى.")
        if instance is not None and instance.status != "PENDING":
            # Goods have arrived: only an admin may change it, and never below what arrived.
            request = self.context.get("request")
            if not (request and is_admin(request.user)):
                raise PermissionDenied("تعديل أمر شراء مستلم متاح للمدير فقط.")
            if attrs.get("items") is not None:
                self._check_received_lines(instance, attrs["items"])
        items = attrs.get("items")
        if instance is None and not items:
            raise BusinessRuleError("يجب أن يحتوي أمر الشراء على منتج واحد على الأقل.")
        if items is not None and not items:
            raise BusinessRuleError("يجب أن يحتوي أمر الشراء على منتج واحد على الأقل.")
        if items is not None or "discount" in attrs:
            total = (
                sum((i["quantity"] * i["unit_cost"] for i in items), Decimal("0"))
                if items is not None else instance.total_cost
            )
            if attrs.get("discount", instance.discount if instance else Decimal("0")) > total:
                raise BusinessRuleError("قيمة الخصم أكبر من إجمالي أمر الشراء.")
        if instance is not None and (items is not None or "discount" in attrs):
            if direct_paid(instance) > total - attrs.get("discount", instance.discount) + instance.supplier_transport:
                raise BusinessRuleError("الإجمالي الجديد أقل من المبلغ المدفوع مسبقاً.")
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        items_data = validated_data.pop("items")
        transport = self._pop_transport(validated_data, None)
        if not validated_data.get("branch"):
            validated_data["branch"] = default_branch()
        po = PurchaseOrder.objects.create(**validated_data)
        for item in items_data:
            PurchaseOrderItem.objects.create(purchase_order=po, **item)
        if transport:
            set_transport(po, *transport)  # also spreads account credit
        else:
            apply_credit(po.account)  # money already paid to this supplier settles the new order
        return po

    @staticmethod
    def _check_received_lines(po, items):
        existing = {i.pk: i for i in po.items.all()}
        kept = set()
        for line in items:
            old = existing.get(line.get("id"))
            if old is None:
                continue  # a new line: still to be received
            kept.add(old.pk)
            if line["product"].pk != old.product_id and old.received_quantity > 0:
                raise BusinessRuleError(f"لا يمكن تغيير منتج بند تم استلامه ({old.product.name}).")
            if line["quantity"] < old.received_quantity:
                raise BusinessRuleError(
                    f"الكمية الجديدة من «{old.product.name}» أقل مما وصل ({old.received_quantity.normalize():f}). "
                    "لإعادة بضاعة للمورد استخدم المرتجع."
                )
        for pk, old in existing.items():
            if pk not in kept and old.received_quantity > 0:
                raise BusinessRuleError(f"لا يمكن حذف بند تم استلامه ({old.product.name}). استخدم المرتجع.")

    @staticmethod
    def _pop_transport(data, instance):
        """(cost, payee) when the request changes the transport fee, else None."""
        cost = data.pop("transport_cost", None)
        payee = data.pop("transport_payee", None)
        if cost is None and payee is None:
            return None
        cost = cost if cost is not None else (instance.transport_cost if instance else Decimal("0"))
        payee = payee or (instance.transport_payee if instance else PurchaseOrder.CARRIER)
        return cost, payee

    @transaction.atomic
    def update(self, instance, validated_data):
        items_data = validated_data.pop("items", None)
        transport = self._pop_transport(validated_data, instance)
        old_account = instance.account
        received = instance.status != "PENDING"
        before = purchase_snapshot(instance) if received else None
        release_credit(instance)  # spread again below: the total or the supplier may have changed
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items_data is not None and not received:
            instance.items.all().delete()
            for item in items_data:
                item.pop("id", None)
                PurchaseOrderItem.objects.create(purchase_order=instance, **item)
        elif items_data is not None:
            # keep each line (and what arrived of it); update, add, drop lines nothing arrived of
            existing = {i.pk: i for i in instance.items.all()}
            kept = set()
            for item in items_data:
                old = existing.get(item.pop("id", None))
                if old is None:
                    PurchaseOrderItem.objects.create(purchase_order=instance, **item)
                    continue
                kept.add(old.pk)
                for key, value in item.items():
                    setattr(old, key, value)
                old.save()
            for pk, old in existing.items():
                if pk not in kept:
                    old.delete()
            instance.status = "RECEIVED" if all(i.remaining_quantity <= 0 for i in instance.items.all()) else "PARTIAL"
            instance.save(update_fields=["status"])
        if transport:
            set_transport(instance, *transport)
        elif received:
            refresh_costs(instance)  # new prices / discount reach the products bought last here
        if received:
            request = self.context.get("request")
            log_edit(EditLog.PURCHASE, instance.pk, getattr(request, "user", None), before,
                     purchase_snapshot(PurchaseOrder.objects.get(pk=instance.pk)))
        apply_credit(old_account)
        if instance.account_id != getattr(old_account, "pk", None):
            apply_credit(instance.account)
        return instance
