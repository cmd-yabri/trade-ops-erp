"""Wholesale accounts: a customer and/or supplier with a running balance.

Individual (retail) customers stay as plain names on sales orders - no account.
"""
from datetime import date
from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models

CENT = Decimal("0.01")


class Account(models.Model):
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=50, blank=True)
    address = models.CharField(max_length=300, blank=True)
    # A wholesale buyer (debtor when they owe us), a supplier (creditor when we owe them), or both.
    is_customer = models.BooleanField(default=True)
    is_supplier = models.BooleanField(default=False)
    notes = models.CharField(max_length=500, blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class AccountEntry(models.Model):
    """Manual ledger line: opening balance or an adjustment.

    DEBIT = they owe us more; CREDIT = we owe them more (or they paid something outside the system).
    """

    DEBIT, CREDIT = "DEBIT", "CREDIT"
    account = models.ForeignKey(Account, related_name="entries", on_delete=models.CASCADE)
    kind = models.CharField(max_length=6, choices=[(DEBIT, "Debit"), (CREDIT, "Credit")])
    amount = models.DecimalField(max_digits=16, decimal_places=2, validators=[MinValueValidator(CENT)])
    note = models.CharField(max_length=300, blank=True)
    date = models.DateField(default=date.today)


class AccountPayment(models.Model):
    """A lump-sum payment from (IN) or to (OUT) an account.

    It is spread over the account's oldest unpaid orders (creating normal order payments, so
    every order's paid/partial/unpaid status stays right); anything left over simply stays as
    credit on the account.
    """

    IN, OUT = "IN", "OUT"
    account = models.ForeignKey(Account, related_name="payments", on_delete=models.CASCADE)
    direction = models.CharField(max_length=3, choices=[(IN, "Received"), (OUT, "Paid")])
    amount = models.DecimalField(max_digits=16, decimal_places=2, validators=[MinValueValidator(CENT)])
    currency = models.CharField(max_length=3, default="USD")
    paid_amount = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)
    exchange_rate = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    # When it was entered: orders same-day lines in statements (older rows have none).
    created_at = models.DateTimeField(auto_now_add=True, null=True)
    date = models.DateField(default=date.today)
    note = models.CharField(max_length=300, blank=True)
    branch = models.ForeignKey("locations.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    # Credit left by a return (the overpaid part moved here instead of being handed back): no cash moved.
    sales_return = models.OneToOneField("order.SalesReturn", null=True, blank=True, on_delete=models.CASCADE,
                                        related_name="credit")
    purchase_return = models.OneToOneField("purchase_order.PurchaseReturn", null=True, blank=True,
                                           on_delete=models.CASCADE, related_name="credit")

    @property
    def is_cash(self) -> bool:
        return self.sales_return_id is None and self.purchase_return_id is None

    @property
    def cash_amount(self):
        if not self.is_cash:
            return 0
        return self.paid_amount if self.paid_amount is not None else self.amount
