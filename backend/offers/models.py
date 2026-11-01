"""Price offers (quotations): like a sales order, but they never touch stock or the books.

An accepted offer is turned into a brand-new (not yet finalized) sales order.
"""
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.core.validators import MinValueValidator
from django.db import models

from inventory.models import Product

ZERO = Decimal("0")
QTY = Decimal("0.001")


class Offer(models.Model):
    PENDING, ACCEPTED, REJECTED = "PENDING", "ACCEPTED", "REJECTED"
    STATUS_CHOICES = [(PENDING, "Pending"), (ACCEPTED, "Accepted"), (REJECTED, "Rejected")]

    client_name = models.CharField(max_length=200)
    client_phone = models.CharField(max_length=50, blank=True)
    client_address = models.CharField(max_length=500, blank=True)
    account = models.ForeignKey("accounts.Account", null=True, blank=True, on_delete=models.PROTECT, related_name="offers")
    branch = models.ForeignKey("locations.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    car = models.ForeignKey("locations.Car", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    discount = models.DecimalField(max_digits=10, decimal_places=2, default=ZERO, validators=[MinValueValidator(ZERO)])
    valid_until = models.DateField(null=True, blank=True, help_text="Offer expires after this day (empty = no expiry)")
    notes = models.CharField(max_length=1000, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    # The sales order created when the client accepted.
    sales_order = models.OneToOneField("order.SalesOrder", null=True, blank=True, on_delete=models.SET_NULL, related_name="offer")

    @property
    def is_expired(self) -> bool:
        return self.status == self.PENDING and self.valid_until is not None and self.valid_until < date.today()

    @property
    def product_total(self):
        return sum((i.total_price for i in self.items.all()), ZERO)

    @property
    def service_total(self):
        return sum((j.charge_to_client for j in self.jobs.all()), ZERO)

    @property
    def grand_total(self):
        return self.product_total + self.service_total - self.discount

    @property
    def cost_total(self):
        """Estimated cost at today's product cost + contractor cost (admin only)."""
        goods = sum((i.quantity * i.product.unit_cost for i in self.items.all()), ZERO)
        goods = goods.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)  # same cents as the sales order
        return goods + sum((j.cost_to_company for j in self.jobs.all()), ZERO)

    @property
    def profit(self):
        return self.grand_total - self.cost_total


class OfferItem(models.Model):
    offer = models.ForeignKey(Offer, related_name="items", on_delete=models.CASCADE)
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    quantity = models.DecimalField(max_digits=12, decimal_places=3, validators=[MinValueValidator(QTY)])
    unit_price = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(ZERO)])

    @property
    def total_price(self):
        return self.quantity * self.unit_price


class OfferJob(models.Model):
    """External work (installation, electrician ...) included in the offer."""

    offer = models.ForeignKey(Offer, related_name="jobs", on_delete=models.CASCADE)
    job_type = models.CharField(max_length=20)
    contractor_name = models.CharField(max_length=200, blank=True)
    cost_to_company = models.DecimalField(max_digits=10, decimal_places=2, default=ZERO, validators=[MinValueValidator(ZERO)])
    charge_to_client = models.DecimalField(max_digits=10, decimal_places=2, default=ZERO, validators=[MinValueValidator(ZERO)])
