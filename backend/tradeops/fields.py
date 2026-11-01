from rest_framework import serializers


class MoneyField(serializers.DecimalField):
    """Read-only money value rendered as a JSON number (computed totals)."""

    def __init__(self, **kwargs):
        kwargs.setdefault("max_digits", 14)
        kwargs.setdefault("decimal_places", 2)
        kwargs.setdefault("coerce_to_string", False)
        kwargs["read_only"] = True
        super().__init__(**kwargs)


class QuantityField(serializers.DecimalField):
    """Stock / order quantity: up to 3 decimals, rendered as a JSON number (2 or 3.5)."""

    def __init__(self, **kwargs):
        kwargs.setdefault("max_digits", 12)
        kwargs.setdefault("decimal_places", 3)
        kwargs.setdefault("coerce_to_string", False)
        kwargs.setdefault("min_value", 0)
        super().__init__(**kwargs)
