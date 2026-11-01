"""Cash boxes: one per currency (USD, SYP). Balances are computed on demand from the
payments, expenses and the entries below, never stored (same idea as the accounting)."""
from datetime import date
from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models

CENT = Decimal("0.01")


class BoxEntry(models.Model):
    """Money put into or taken out of a box by hand (opening balance, owner withdrawal ...)."""

    DEPOSIT, WITHDRAWAL = "DEPOSIT", "WITHDRAWAL"
    KINDS = [(DEPOSIT, "Deposit"), (WITHDRAWAL, "Withdrawal")]

    currency = models.CharField(max_length=3)
    kind = models.CharField(max_length=12, choices=KINDS)
    amount = models.DecimalField(max_digits=16, decimal_places=2, validators=[MinValueValidator(CENT)])
    note = models.CharField(max_length=300, blank=True)
    date = models.DateField(default=date.today)
    branch = models.ForeignKey("locations.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)


class Exchange(models.Model):
    """Money moved from one box to the other at a typed rate (rate = SYP per 1 USD)."""

    from_currency = models.CharField(max_length=3)
    to_currency = models.CharField(max_length=3)
    from_amount = models.DecimalField(max_digits=16, decimal_places=2)
    to_amount = models.DecimalField(max_digits=16, decimal_places=2)
    rate = models.DecimalField(max_digits=14, decimal_places=4)
    note = models.CharField(max_length=300, blank=True)
    date = models.DateField(default=date.today)
    branch = models.ForeignKey("locations.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
