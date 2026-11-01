from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal

from django.core.validators import MinValueValidator
from django.db import models

from inventory.models import Product

ZERO = Decimal("0")
CENT = Decimal("0.01")
QTY = Decimal("0.001")


class SalesOrder(models.Model):
    client_name = models.CharField(max_length=200)
    client_phone = models.CharField(max_length=50, blank=True)
    client_address = models.CharField(max_length=500, blank=True)
    # The sale's date (can be set back for an invoice entered late); finalizing books it on this day.
    date = models.DateTimeField(default=datetime.now)
    discount = models.DecimalField(
        max_digits=10, decimal_places=2, default=ZERO, validators=[MinValueValidator(ZERO)],
        help_text="Fixed discount amount (not percentage)",
    )

    # Wholesale account this sale is booked to (empty = individual customer, no account).
    account = models.ForeignKey("accounts.Account", null=True, blank=True, on_delete=models.PROTECT,
                                related_name="sales_orders")
    # Where the goods leave from: a car if set, otherwise the branch (default branch when empty).
    branch = models.ForeignKey("locations.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    car = models.ForeignKey("locations.Car", null=True, blank=True, on_delete=models.PROTECT, related_name="+")

    # Set only by services.finalize_sales_order: stock is deducted and revenue booked.
    is_finalized = models.BooleanField(default=False)
    finalized_at = models.DateTimeField(null=True, blank=True)

    @property
    def product_total(self):
        return sum((item.total_price for item in self.items.all()), ZERO)

    @property
    def service_total(self):
        return sum((job.charge_to_client for job in self.freelance_jobs.all()), ZERO)

    @property
    def subtotal(self):
        """Subtotal before discount."""
        return self.product_total + self.service_total

    @property
    def grand_total(self):
        """Total after discount."""
        return self.subtotal - self.discount

    @property
    def goods_cost(self):
        """Cost of the goods, rounded to the cent once per order (25.5 m x 1.25 = 31.875 -> 31.88)
        so the order card, the reports and the dashboard all add up to the same cents."""
        goods = ZERO
        for item in self.items.all():
            cost = item.unit_cost_at_sale if item.unit_cost_at_sale is not None else item.product.unit_cost
            goods += item.quantity * cost
        return goods.quantize(CENT, rounding=ROUND_HALF_UP)

    @property
    def cost_total(self):
        """What the goods and contractors cost us: the snapshot taken at finalize,
        or today's average cost as an estimate while the order is still open."""
        return self.goods_cost + sum((job.cost_to_company for job in self.freelance_jobs.all()), ZERO)

    @property
    def returned_total(self):
        """Value of goods the customer brought back (credit notes)."""
        return sum((r.value for r in self.returns.all()), ZERO)

    @property
    def returned_cost(self):
        return sum((r.cost for r in self.returns.all()), ZERO)

    @property
    def net_total(self):
        """What the customer owes for this order after returns."""
        return self.grand_total - self.returned_total

    @property
    def profit(self):
        return self.net_total - (self.cost_total - self.returned_cost)

    @property
    def total_paid(self):
        """Payments minus money handed back on returns."""
        paid = sum((p.amount for p in self.payments.all()), ZERO)
        return paid - sum((r.refund_amount for r in self.returns.all()), ZERO)

    @property
    def remaining(self):
        return max(self.net_total - self.total_paid, ZERO)

    @property
    def payment_status(self):
        paid = self.total_paid
        if paid <= 0:
            return "unpaid" if self.net_total > 0 else "paid"
        if paid >= self.net_total:
            return "paid"
        return "partial"

    def __str__(self):
        return f"Order #{self.id} - {self.client_name}"


class ClientPayment(models.Model):
    order = models.ForeignKey(SalesOrder, related_name="payments", on_delete=models.CASCADE)
    amount = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(CENT)])
    date = models.DateField(default=date.today)
    # Accounting uses `amount` (USD). A payment made in SYP keeps what was handed over
    # (`paid_amount`, SYP) and the rate typed by the user (SYP per 1 USD).
    # Set when this payment came from spreading an account's lump-sum payment over its orders.
    account_payment = models.ForeignKey("accounts.AccountPayment", null=True, blank=True, on_delete=models.CASCADE,
                                        related_name="client_payments")
    currency = models.CharField(max_length=3, default="USD")
    paid_amount = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)
    exchange_rate = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    # When it was entered: orders same-day lines in statements (older rows have none).
    created_at = models.DateTimeField(auto_now_add=True, null=True)

    @property
    def cash_amount(self):
        """What actually moved in/out of the cash box, in `currency`."""
        return self.paid_amount if self.paid_amount is not None else self.amount

    def __str__(self):
        return f"{self.order_id} - {self.amount}"


class OrderItem(models.Model):
    order = models.ForeignKey(SalesOrder, related_name="items", on_delete=models.CASCADE)
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    quantity = models.DecimalField(max_digits=12, decimal_places=3, validators=[MinValueValidator(QTY)])
    unit_price = models.DecimalField(
        max_digits=10, decimal_places=2, validators=[MinValueValidator(ZERO)],
        help_text="Price sold to client",
    )
    # Product cost at the moment the order was finalized (for cost of goods sold).
    unit_cost_at_sale = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    # Where this line's goods leave from; empty = the order's car / branch.
    branch = models.ForeignKey("locations.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    car = models.ForeignKey("locations.Car", null=True, blank=True, on_delete=models.PROTECT, related_name="+")

    @property
    def place(self) -> dict:
        """{'branch_id', 'car_id'} the goods of this line come from."""
        if self.car_id or self.branch_id:
            return {"branch_id": None if self.car_id else self.branch_id, "car_id": self.car_id}
        order = self.order
        return {"branch_id": None if order.car_id else order.branch_id, "car_id": order.car_id}

    @property
    def total_price(self):
        return self.quantity * self.unit_price


class FreelanceJob(models.Model):
    """External work (steel / electric / ...) attached to a sales order."""

    JOB_TYPES = [
        ("STEEL", "Steel Work"),
        ("ELECTRIC", "Electrician"),
        ("INSTALL", "General Installation"),
        ("MOVING", "نقل و تحميل"),
    ]

    order = models.ForeignKey(SalesOrder, related_name="freelance_jobs", on_delete=models.CASCADE)
    job_type = models.CharField(max_length=20, choices=JOB_TYPES)
    contractor_name = models.CharField(max_length=200, blank=True, help_text="Who is doing the work?")

    cost_to_company = models.DecimalField(
        max_digits=10, decimal_places=2, default=ZERO, validators=[MinValueValidator(ZERO)],
        help_text="What we pay the contractor",
    )
    charge_to_client = models.DecimalField(
        max_digits=10, decimal_places=2, default=ZERO, validators=[MinValueValidator(ZERO)],
        help_text="What we bill the client",
    )
    is_completed = models.BooleanField(default=False)

    @property
    def profit_margin(self):
        return self.charge_to_client - self.cost_to_company


class SalesReturn(models.Model):
    """Goods a customer brought back from a finalized order (a credit note).

    The goods go back into a place, the day's revenue and cost of goods go down by their value, and
    money the customer overpaid is either handed back (refund, out of a box) or kept as credit on
    the order's account (refund_to_credit: the amount moves to an account lump sum, no cash).
    """

    order = models.ForeignKey(SalesOrder, related_name="returns", on_delete=models.CASCADE)
    date = models.DateField(default=date.today)
    note = models.CharField(max_length=300, blank=True)
    # money given back, USD value (0 when the customer had not paid more than the new total)
    refund_amount = models.DecimalField(max_digits=12, decimal_places=2, default=ZERO)
    refund_to_credit = models.BooleanField(default=False)
    currency = models.CharField(max_length=3, default="USD")
    paid_amount = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)
    exchange_rate = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def value(self):
        return sum((line.value for line in self.lines.all()), ZERO)

    @property
    def cost(self):
        return sum((line.cost for line in self.lines.all()), ZERO)

    @property
    def cash_amount(self):
        """Cash that left the box (none when the refund became account credit)."""
        if self.refund_to_credit:
            return ZERO
        return self.paid_amount if self.paid_amount is not None else self.refund_amount


class SalesReturnLine(models.Model):
    sales_return = models.ForeignKey(SalesReturn, related_name="lines", on_delete=models.CASCADE)
    order_item = models.ForeignKey(OrderItem, related_name="returned", on_delete=models.CASCADE)
    quantity = models.DecimalField(max_digits=12, decimal_places=3, validators=[MinValueValidator(QTY)])
    # money value of one returned unit (sale price after the order's discount share) and its cost
    unit_value = models.DecimalField(max_digits=14, decimal_places=4)
    unit_cost = models.DecimalField(max_digits=14, decimal_places=4)
    branch = models.ForeignKey("locations.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    car = models.ForeignKey("locations.Car", null=True, blank=True, on_delete=models.PROTECT, related_name="+")

    @property
    def value(self):
        return (self.quantity * self.unit_value).quantize(CENT, rounding=ROUND_HALF_UP)

    @property
    def cost(self):
        return (self.quantity * self.unit_cost).quantize(CENT, rounding=ROUND_HALF_UP)
