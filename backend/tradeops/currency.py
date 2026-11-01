"""Two-currency money (USD and SYP) for payments and expenses.

Accounting always runs in USD: `amount` on a payment/expense is its USD value.
When something is paid in SYP, the cash actually handled is `paid_amount` SYP and the
USD value is paid_amount / exchange_rate (rate = SYP per 1 USD, typed by the user).
"""
from decimal import ROUND_HALF_UP, Decimal

from rest_framework import serializers

from .errors import require_feature

USD, SYP = "USD", "SYP"
CURRENCY_CHOICES = [(USD, "USD"), (SYP, "SYP")]
CENT = Decimal("0.01")
ZERO = Decimal("0")


def to_usd(paid_amount: Decimal, rate: Decimal) -> Decimal:
    return (paid_amount / rate).quantize(CENT, rounding=ROUND_HALF_UP)


class MultiCurrencyMixin:
    """Serializer mixin: adds currency / paid_amount / exchange_rate and derives `amount` (USD).

    Declare `currency`, `paid_amount`, `exchange_rate` in Meta.fields and make `amount` optional.
    """

    def validate(self, attrs):
        attrs = super().validate(attrs)
        money_keys = ("currency", "paid_amount", "exchange_rate", "amount")
        if self.instance is not None and not any(k in attrs for k in money_keys):
            return attrs  # e.g. only the description changed
        currency = attrs.get("currency") or (self.instance.currency if self.instance else USD)
        if currency not in (USD, SYP):  # anything else would count as paid but sit in no cash box
            raise serializers.ValidationError({"currency": "العملة يجب أن تكون USD أو SYP."})
        attrs["currency"] = currency
        if currency == SYP:
            require_feature("money_boxes")
            paid, rate = attrs.get("paid_amount"), attrs.get("exchange_rate")
            if paid is None or rate is None or paid <= ZERO or rate <= ZERO:
                raise serializers.ValidationError("أدخل المبلغ بالليرة وسعر الصرف.")
            attrs["amount"] = to_usd(paid, rate)
            if attrs["amount"] < CENT:
                raise serializers.ValidationError("المبلغ صغير جداً بعد التحويل.")
        else:
            if attrs.get("amount") is None and not self.instance:
                raise serializers.ValidationError({"amount": "المبلغ مطلوب."})
            attrs["paid_amount"] = attrs.get("amount", self.instance.amount if self.instance else None)
            attrs["exchange_rate"] = None
        return attrs
