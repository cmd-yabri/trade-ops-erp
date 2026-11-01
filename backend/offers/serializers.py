from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from inventory.stock import check_quantity_for_product, default_branch
from order.models import FreelanceJob
from tradeops.errors import BusinessRuleError, is_admin, require_feature
from tradeops.fields import MoneyField, QuantityField

from .models import Offer, OfferItem, OfferJob

JOB_TYPES = [code for code, _ in FreelanceJob.JOB_TYPES]


class OfferItemSerializer(serializers.ModelSerializer):
    product_name = serializers.ReadOnlyField(source="product.name")
    quantity = QuantityField()
    total_price = MoneyField()

    class Meta:
        model = OfferItem
        fields = ["id", "product", "product_name", "quantity", "unit_price", "total_price"]

    def validate(self, attrs):
        check_quantity_for_product(attrs["product"], attrs["quantity"])
        return attrs


class OfferJobSerializer(serializers.ModelSerializer):
    job_type = serializers.ChoiceField(choices=JOB_TYPES)

    class Meta:
        model = OfferJob
        fields = ["id", "job_type", "contractor_name", "cost_to_company", "charge_to_client"]


class OfferSerializer(serializers.ModelSerializer):
    items = OfferItemSerializer(many=True, required=False)
    jobs = OfferJobSerializer(many=True, required=False)
    product_total = MoneyField()
    service_total = MoneyField()
    grand_total = MoneyField()
    cost_total = MoneyField()
    profit = MoneyField()
    is_expired = serializers.BooleanField(read_only=True)
    account_name = serializers.CharField(source="account.name", read_only=True, default="")
    branch_name = serializers.CharField(source="branch.name", read_only=True, default="")
    car_name = serializers.CharField(source="car.name", read_only=True, default="")

    ADMIN_ONLY = ("cost_total", "profit")

    class Meta:
        model = Offer
        fields = [
            "id", "client_name", "client_phone", "client_address", "account", "account_name", "branch", "branch_name",
            "car", "car_name", "discount", "valid_until", "notes", "status", "is_expired", "created_at", "decided_at",
            "sales_order", "items", "jobs", "product_total", "service_total", "grand_total", "cost_total", "profit",
        ]
        read_only_fields = ["status", "created_at", "decided_at", "sales_order"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if not (request and is_admin(request.user)):
            for key in self.ADMIN_ONLY:
                data.pop(key, None)
        return data

    def validate_client_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("اسم العميل مطلوب.")
        return value

    def validate_account(self, account):
        if account is not None and not account.is_customer:
            raise serializers.ValidationError("هذا الحساب ليس عميلاً.")
        return account

    def validate(self, attrs):
        instance = self.instance
        if instance is not None and instance.status != Offer.PENDING:
            raise BusinessRuleError("لا يمكن تعديل عرض مقبول أو مرفوض.")
        if attrs.get("car"):
            require_feature("cars")
        if attrs.get("account"):
            require_feature("accounts")
        items, jobs = attrs.get("items"), attrs.get("jobs")
        if instance is None or items is not None or jobs is not None or "discount" in attrs:
            item_sum = (
                sum((i["quantity"] * i["unit_price"] for i in items), Decimal("0"))
                if items is not None else (Decimal("0") if instance is None else instance.product_total)
            )
            job_sum = (
                sum((j.get("charge_to_client", Decimal("0")) for j in jobs), Decimal("0"))
                if jobs is not None else (Decimal("0") if instance is None else instance.service_total)
            )
            has_lines = bool(items if items is not None else (instance and instance.items.exists())) or bool(
                jobs if jobs is not None else (instance and instance.jobs.exists())
            )
            if not has_lines:
                raise BusinessRuleError("يجب أن يحتوي العرض على منتج أو خدمة واحدة على الأقل.")
            discount = attrs.get("discount", instance.discount if instance else Decimal("0"))
            if discount > item_sum + job_sum:
                raise BusinessRuleError("قيمة الخصم أكبر من إجمالي العرض.")
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop("items", [])
        jobs = validated_data.pop("jobs", [])
        if not validated_data.get("branch"):
            validated_data["branch"] = default_branch()
        offer = Offer.objects.create(**validated_data)
        for item in items:
            OfferItem.objects.create(offer=offer, **item)
        for job in jobs:
            OfferJob.objects.create(offer=offer, **job)
        return offer

    @transaction.atomic
    def update(self, instance, validated_data):
        items = validated_data.pop("items", None)
        jobs = validated_data.pop("jobs", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items is not None:
            instance.items.all().delete()
            for item in items:
                OfferItem.objects.create(offer=instance, **item)
        if jobs is not None:
            instance.jobs.all().delete()
            for job in jobs:
                OfferJob.objects.create(offer=instance, **job)
        return instance
