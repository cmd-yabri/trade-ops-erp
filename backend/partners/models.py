"""Business partners: a percentage share of the profit, money taken during the month,
and the month-end settlement that splits the profit between them."""
from datetime import date
from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

ZERO = Decimal("0")
CENT = Decimal("0.01")


class Partner(models.Model):
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=50, blank=True)
    share_percent = models.DecimalField(
        max_digits=5, decimal_places=2, default=ZERO,
        validators=[MinValueValidator(ZERO), MaxValueValidator(Decimal("100"))],
    )
    notes = models.CharField(max_length=500, blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class PartnerWithdrawal(models.Model):
    """Money a partner took out (usually at the start of the month), an advance on their share.

    Not an expense: it never changes the business profit. `amount` is the USD value;
    when taken in SYP, `paid_amount` is the SYP cash and `exchange_rate` the typed rate.
    """

    partner = models.ForeignKey(Partner, related_name="withdrawals", on_delete=models.PROTECT)
    amount = models.DecimalField(max_digits=16, decimal_places=2, validators=[MinValueValidator(CENT)])
    currency = models.CharField(max_length=3, default="USD")
    paid_amount = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)
    exchange_rate = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    date = models.DateField(default=date.today)
    note = models.CharField(max_length=300, blank=True)
    branch = models.ForeignKey("locations.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    # When it was entered: orders same-day lines in statements (older rows have none).
    created_at = models.DateTimeField(auto_now_add=True, null=True)

    @property
    def cash_amount(self):
        return self.paid_amount if self.paid_amount is not None else self.amount


class PartnerPriorProfit(models.Model):
    """Profit a partner earned before TradeOps, entered as that partner's own amount for a period
    (a month, a year ...). Negative = a loss. Counts in the balance, never in cash or current profit."""

    partner = models.ForeignKey(Partner, related_name="prior_profits", on_delete=models.PROTECT)
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField()
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    note = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class ProfitSettlement(models.Model):
    """One closed period: the net profit and how it was split."""

    period_start = models.DateField()
    period_end = models.DateField()
    net_profit = models.DecimalField(max_digits=16, decimal_places=2)
    note = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class ProfitOpening(models.Model):
    """The partners' balances when the business was first entered into TradeOps."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    as_of = models.DateField()
    net_profit = models.DecimalField(max_digits=16, decimal_places=2)
    note = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class ProfitOpeningLine(models.Model):
    opening = models.ForeignKey(ProfitOpening, related_name="lines", on_delete=models.CASCADE)
    partner = models.ForeignKey(Partner, related_name="opening_lines", on_delete=models.PROTECT)
    share_percent = models.DecimalField(max_digits=5, decimal_places=2)
    share_amount = models.DecimalField(max_digits=16, decimal_places=2)
    withdrawn_amount = models.DecimalField(max_digits=16, decimal_places=2, default=ZERO)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["opening", "partner"], name="unique_partner_profit_opening"),
        ]


class SettlementLine(models.Model):
    settlement = models.ForeignKey(ProfitSettlement, related_name="lines", on_delete=models.CASCADE)
    partner = models.ForeignKey(Partner, related_name="settlement_lines", on_delete=models.PROTECT)
    share_percent = models.DecimalField(max_digits=5, decimal_places=2)
    share_amount = models.DecimalField(max_digits=16, decimal_places=2)
    # What the partner took during this period (information; their balance is shares minus all withdrawals).
    withdrawn_in_period = models.DecimalField(max_digits=16, decimal_places=2, default=ZERO)
