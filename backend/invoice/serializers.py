from datetime import date

from rest_framework import serializers

from inventory.stock import default_branch
from partners.services import assert_period_open
from tradeops.currency import MultiCurrencyMixin

from .models import Expense


class ExpenseSerializer(MultiCurrencyMixin, serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True, default="")
    car_name = serializers.CharField(source="car.name", read_only=True, default="")

    class Meta:
        model = Expense
        fields = ["id", "type", "category", "description", "amount", "date", "branch", "branch_name", "car", "car_name",
                  "currency", "paid_amount", "exchange_rate", "purchase_order", "opening_stock"]
        # set by the purchase order (transport) / the opening stock (its payment), not by hand
        read_only_fields = ["purchase_order", "opening_stock"]
        extra_kwargs = {"date": {"required": False}, "amount": {"required": False},
                        "currency": {"required": False}}

    def validate_description(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("الوصف مطلوب.")
        return value

    def create(self, validated_data):
        if not validated_data.get("branch"):
            validated_data["branch"] = default_branch()
        return super().create(validated_data)

    def validate(self, attrs):
        attrs = super().validate(attrs)  # currency handling (MultiCurrencyMixin)
        if "date" in attrs or self.instance is None:
            assert_period_open(attrs.get("date") or date.today(), "تاريخ المصروف")
        if self.instance is not None:
            assert_period_open(self.instance.date, "المصروف الأصلي")
        # Type and category must be checked together, also on partial updates.
        type_ = attrs.get("type", self.instance.type if self.instance else "EXPENSE")
        category = attrs.get("category", self.instance.category if self.instance else None)
        if category is not None and category not in Expense.valid_categories(type_):
            raise serializers.ValidationError(
                {"category": f"فئة غير صالحة. الفئات المسموحة: {', '.join(Expense.valid_categories(type_))}"}
            )
        return attrs
