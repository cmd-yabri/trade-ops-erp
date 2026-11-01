from datetime import date, datetime, time
from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from rest_framework.exceptions import PermissionDenied

from accounts.services import apply_credit, direct_paid, release_credit
from audit.models import EditLog
from audit.services import log_edit, sales_snapshot
from inventory.stock import check_quantity_for_product, default_branch
from partners.services import assert_period_open
from tradeops.currency import MultiCurrencyMixin
from tradeops.errors import BusinessRuleError, is_admin, require_feature
from tradeops.fields import MoneyField, QuantityField

from .models import ClientPayment, FreelanceJob, OrderItem, SalesOrder, SalesReturn
from .services import book_stock, unbook_stock


class ClientPaymentSerializer(MultiCurrencyMixin, serializers.ModelSerializer):
    class Meta:
        model = ClientPayment
        fields = ["id", "amount", "date", "currency", "paid_amount", "exchange_rate"]
        extra_kwargs = {"date": {"required": False}, "amount": {"required": False},
                        "currency": {"required": False}}


class FreelanceJobSerializer(serializers.ModelSerializer):
    profit_margin = MoneyField()

    class Meta:
        model = FreelanceJob
        fields = [
            "id", "job_type", "contractor_name", "cost_to_company",
            "charge_to_client", "is_completed", "profit_margin",
        ]


class ReturnLineSerializer(serializers.Serializer):
    product_name = serializers.CharField(source="order_item.product.name")
    quantity = QuantityField()
    value = MoneyField()


class SalesReturnSerializer(serializers.ModelSerializer):
    lines = ReturnLineSerializer(many=True, read_only=True)
    value = MoneyField()
    refund_amount = MoneyField()

    class Meta:
        model = SalesReturn
        fields = ["id", "date", "note", "value", "refund_amount", "refund_to_credit", "currency", "paid_amount",
                  "lines"]


class OrderItemSerializer(serializers.ModelSerializer):
    product_name = serializers.ReadOnlyField(source="product.name")
    total_price = MoneyField()
    quantity = QuantityField()

    branch_name = serializers.CharField(source="branch.name", read_only=True, default="")
    car_name = serializers.CharField(source="car.name", read_only=True, default="")

    class Meta:
        model = OrderItem
        fields = ["id", "product", "product_name", "quantity", "unit_price", "total_price",
                  "branch", "branch_name", "car", "car_name", "returned_quantity"]

    returned_quantity = serializers.SerializerMethodField()

    def get_returned_quantity(self, item):
        return float(sum((line.quantity for line in item.returned.all()), Decimal("0")))

    def validate(self, attrs):
        check_quantity_for_product(attrs["product"], attrs["quantity"])
        if attrs.get("branch") and attrs.get("car"):
            raise BusinessRuleError("حدد للبند مكاناً واحداً: فرعاً أو سيارة.")
        if attrs.get("car"):
            require_feature("cars")
        return attrs


class SalesOrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, required=False)
    freelance_jobs = FreelanceJobSerializer(many=True, required=False)
    payments = ClientPaymentSerializer(many=True, read_only=True)
    returns = SalesReturnSerializer(many=True, read_only=True)
    returned_total = MoneyField()
    net_total = MoneyField()

    product_total = MoneyField()
    service_total = MoneyField()
    subtotal = MoneyField()
    grand_total = MoneyField()
    total_paid = MoneyField()
    remaining = MoneyField()
    payment_status = serializers.CharField(read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True, default="")
    car_name = serializers.CharField(source="car.name", read_only=True, default="")
    account_name = serializers.CharField(source="account.name", read_only=True, default="")
    from_offer = serializers.SerializerMethodField()
    # Admin eyes only: removed from the output for staff in to_representation.
    cost_total = MoneyField()
    profit = MoneyField()

    ADMIN_ONLY = ("cost_total", "profit")
    # What a finalized order may only change through an admin edit (stock / books follow).
    BOOKED_FIELDS = ("items", "freelance_jobs", "discount", "branch", "car", "sale_date", "account")

    def get_from_offer(self, order):
        """Number of the price offer this order was created from (None for ordinary orders)."""
        offer = getattr(order, "offer", None)
        return offer.pk if offer else None

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if not (request and is_admin(request.user)):
            for key in self.ADMIN_ONLY:
                data.pop(key, None)
        return data

    class Meta:
        model = SalesOrder
        fields = [
            "id", "account", "account_name", "branch", "branch_name", "car", "car_name",
            "client_name", "client_phone", "client_address", "date", "sale_date",
            "is_finalized", "finalized_at", "items", "freelance_jobs", "payments",
            "product_total", "service_total", "subtotal", "discount", "grand_total",
            "total_paid", "remaining", "payment_status", "cost_total", "profit", "from_offer",
            "returns", "returned_total", "net_total",
        ]
        read_only_fields = ["is_finalized", "finalized_at", "date"]

    # Write the sale's day (YYYY-MM-DD); it is shown back as `date`.
    sale_date = serializers.DateField(write_only=True, required=False)

    def validate_client_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("اسم العميل مطلوب.")
        return value

    def validate_sale_date(self, value):
        if value > date.today():
            raise serializers.ValidationError("لا يمكن أن يكون تاريخ البيع في المستقبل.")
        assert_period_open(value, "تاريخ البيع")
        return value

    @staticmethod
    def _apply_sale_date(validated_data):
        day = validated_data.pop("sale_date", None)
        if day is not None:
            now = datetime.now()
            validated_data["date"] = now if day == now.date() else datetime.combine(day, time(12, 0))

    def validate_account(self, account):
        if account is not None and not account.is_customer:
            raise serializers.ValidationError("هذا الحساب ليس عميلاً.")
        return account

    def validate(self, attrs):
        instance = self.instance
        if instance is not None and instance.is_finalized and any(k in attrs for k in self.BOOKED_FIELDS):
            # A finalized sale is in the books and moved stock: only an admin may change it.
            request = self.context.get("request")
            if not (request and is_admin(request.user)):
                raise PermissionDenied("تعديل طلب منتهٍ متاح للمدير فقط.")
            assert_period_open(instance.finalized_at.date() if instance.finalized_at else None, "تاريخ البيع")
            if instance.returns.exists():
                raise BusinessRuleError("على الطلب مرتجعات. احذفها أولاً ثم عدّل الطلب.")

        if attrs.get("car"):
            require_feature("cars")
        if attrs.get("account"):
            require_feature("accounts")
        items = attrs.get("items")
        jobs = attrs.get("freelance_jobs")
        if instance is None or items is not None or jobs is not None or "discount" in attrs:
            items_data = items if items is not None else ([] if instance is None else None)
            jobs_data = jobs if jobs is not None else ([] if instance is None else None)
            item_sum = (
                sum((i["quantity"] * i["unit_price"] for i in items_data), Decimal("0"))
                if items_data is not None else instance.product_total
            )
            job_sum = (
                sum((j.get("charge_to_client", Decimal("0")) for j in jobs_data), Decimal("0"))
                if jobs_data is not None else instance.service_total
            )
            has_lines = bool(items_data if items_data is not None else instance.items.exists()) or bool(
                jobs_data if jobs_data is not None else instance.freelance_jobs.exists()
            )
            if not has_lines:
                raise BusinessRuleError("يجب أن يحتوي الطلب على منتج أو خدمة واحدة على الأقل.")
            discount = attrs.get("discount", instance.discount if instance else Decimal("0"))
            if discount > item_sum + job_sum:
                raise BusinessRuleError("قيمة الخصم أكبر من إجمالي الطلب.")
            if instance is not None:
                paid = direct_paid(instance)
                if item_sum + job_sum - discount < paid:
                    raise BusinessRuleError(
                        f"الإجمالي الجديد أقل من المبلغ المدفوع على الطلب ({paid:,.2f}). احذف دفعة أولاً أو ارفع الإجمالي."
                    )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        items_data = validated_data.pop("items", [])
        jobs_data = validated_data.pop("freelance_jobs", [])
        self._apply_sale_date(validated_data)
        if not validated_data.get("branch"):
            validated_data["branch"] = default_branch()
        order = SalesOrder.objects.create(**validated_data)
        for item in items_data:
            OrderItem.objects.create(order=order, **item)
        for job in jobs_data:
            FreelanceJob.objects.create(order=order, **job)
        apply_credit(order.account)  # money the account already has with us pays the new invoice
        return order

    @transaction.atomic
    def update(self, instance, validated_data):
        items_data = validated_data.pop("items", None)
        jobs_data = validated_data.pop("freelance_jobs", None)
        new_day = validated_data.get("sale_date")
        self._apply_sale_date(validated_data)
        old_account = instance.account
        booked = instance.is_finalized
        if booked:
            before = sales_snapshot(instance)
            old_costs = {i.product_id: i.unit_cost_at_sale for i in instance.items.all()}
            unbook_stock(instance, note="تعديل الطلب")  # the old lines come back first
        # Lump-sum parts go back to the account and are spread again after the change
        # (the total or the account may be different now).
        release_credit(instance)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if booked and new_day is not None:
            instance.finalized_at = instance.date  # the sale moves to its new day in the books
        instance.save()
        if items_data is not None:
            instance.items.all().delete()
            for item in items_data:
                OrderItem.objects.create(order=instance, **item)
        if jobs_data is not None:
            instance.freelance_jobs.all().delete()
            for job in jobs_data:
                FreelanceJob.objects.create(order=instance, **job)
        if booked:
            if new_day is not None:
                assert_period_open(instance.finalized_at.date(), "تاريخ البيع الجديد")
            # lines of products already sold keep their cost; new products take today's cost
            book_stock(instance, costs=old_costs, kind="EDIT")
            request = self.context.get("request")
            log_edit(EditLog.SALE, instance.pk, getattr(request, "user", None), before, sales_snapshot(instance))
        apply_credit(old_account)
        if instance.account_id != getattr(old_account, "pk", None):
            apply_credit(instance.account)
        return instance
