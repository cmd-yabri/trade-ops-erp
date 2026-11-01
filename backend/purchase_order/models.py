from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.core.validators import MinValueValidator
from django.db import models

from inventory.models import Product

ZERO = Decimal("0")
CENT = Decimal("0.01")
QTY = Decimal("0.001")


class PurchaseOrder(models.Model):
    STATUS_CHOICES = [
        ("PENDING", "Pending"),
        ("PARTIAL", "Partly received"),
        ("RECEIVED", "Received"),  # receiving adds stock (see services.receive_purchase_order)
        ("CANCELLED", "Cancelled"),
    ]
    supplier = models.CharField(max_length=255)
    # Phone of a walk-in supplier (one without an account); account suppliers keep theirs on the account.
    supplier_phone = models.CharField(max_length=50, blank=True, default="")
    order_date = models.DateField(default=date.today)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="PENDING")
    account = models.ForeignKey("accounts.Account", null=True, blank=True, on_delete=models.PROTECT,
                                related_name="purchase_orders")
    # Receiving puts the goods into this branch's stock (default branch when empty).
    branch = models.ForeignKey("locations.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    discount = models.DecimalField(
        max_digits=10, decimal_places=2, default=ZERO, validators=[MinValueValidator(ZERO)],
        help_text="Fixed discount amount (not percentage)",
    )
    # Transport / loading fee (اجرة النقل والتحميل), USD. It always raises the goods' cost; who is
    # paid is chosen per order: the supplier (added to his bill) or a separate carrier (paid from a box).
    SUPPLIER, CARRIER = "SUPPLIER", "CARRIER"
    transport_cost = models.DecimalField(max_digits=10, decimal_places=2, default=ZERO,
                                         validators=[MinValueValidator(ZERO)])
    transport_payee = models.CharField(max_length=10, default=CARRIER,
                                       choices=[(SUPPLIER, "Supplier"), (CARRIER, "Carrier")])
    received_at = models.DateTimeField(null=True, blank=True, help_text="Last time goods of this order arrived")

    @property
    def total_cost(self):
        return sum((item.total_cost for item in self.items.all()), ZERO)

    @property
    def supplier_transport(self):
        """The part of the transport fee owed to the supplier."""
        return self.transport_cost if self.transport_payee == self.SUPPLIER else ZERO

    @property
    def net_total(self):
        """What the supplier is owed: items - discount (+ transport when he carries it)."""
        return self.total_cost - self.discount + self.supplier_transport

    @property
    def returned_total(self):
        """Value of goods sent back to the supplier (his credit notes)."""
        return sum((r.value for r in self.returns.all()), ZERO)

    @property
    def due_total(self):
        """What we owe for this order after returns."""
        return self.net_total - self.returned_total

    @property
    def paid_amount(self):
        """Our payments minus money the supplier gave back on returns."""
        paid = sum((p.amount for p in self.payments.all()), ZERO)
        return paid - sum((r.refund_amount for r in self.returns.all()), ZERO)

    @property
    def remaining(self):
        return max(self.due_total - self.paid_amount, ZERO)

    @property
    def payment_status(self):
        paid = self.paid_amount
        if paid <= 0:
            return "unpaid" if self.due_total > 0 else "paid"
        if paid >= self.due_total:
            return "paid"
        return "partial"

    def __str__(self):
        return f"PO #{self.id} - {self.supplier}"


class PurchaseOrderItem(models.Model):
    purchase_order = models.ForeignKey(PurchaseOrder, related_name="items", on_delete=models.CASCADE)
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    quantity = models.DecimalField(max_digits=12, decimal_places=3, validators=[MinValueValidator(QTY)])
    unit_cost = models.DecimalField(
        max_digits=14, decimal_places=4, validators=[MinValueValidator(ZERO)],
        help_text="Price on the supplier's invoice",
    )
    # How much of the line has arrived (orders can be received in parts).
    received_quantity = models.DecimalField(max_digits=12, decimal_places=3, default=ZERO)
    # What one unit really cost: price minus its share of the discount plus its share of the
    # transport fee. Becomes the product's cost when received (last purchase price).
    landed_unit_cost = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)

    @property
    def total_cost(self):
        return (self.quantity * self.unit_cost).quantize(CENT, rounding=ROUND_HALF_UP)

    @property
    def remaining_quantity(self):
        return max(self.quantity - self.received_quantity, ZERO)


class POPayment(models.Model):
    purchase_order = models.ForeignKey(PurchaseOrder, related_name="payments", on_delete=models.CASCADE)
    opening_stock = models.OneToOneField(
        "inventory.OpeningStock", null=True, blank=True, on_delete=models.SET_NULL, related_name="supplier_payment"
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(CENT)])
    payment_date = models.DateField(default=date.today)
    # Accounting uses `amount` (USD). A payment made in SYP keeps what was handed over
    # (`paid_amount`, SYP) and the rate typed by the user (SYP per 1 USD).
    account_payment = models.ForeignKey("accounts.AccountPayment", null=True, blank=True, on_delete=models.CASCADE,
                                         related_name="po_payments")
    currency = models.CharField(max_length=3, default="USD")
    paid_amount = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)
    exchange_rate = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    # When it was entered: orders same-day lines in statements (older rows have none).
    created_at = models.DateTimeField(auto_now_add=True, null=True)

    @property
    def cash_amount(self):
        """What actually moved in/out of the cash box, in `currency`."""
        return self.paid_amount if self.paid_amount is not None else self.amount



class PurchaseReturn(models.Model):
    """Goods sent back to the supplier from a received order (his credit note).

    The goods leave a place; what we had overpaid comes back as cash (into a box) or stays as
    credit with the supplier's account (refund_to_credit: moved to an account lump sum, no cash).
    """

    purchase_order = models.ForeignKey(PurchaseOrder, related_name="returns", on_delete=models.CASCADE)
    date = models.DateField(default=date.today)
    note = models.CharField(max_length=300, blank=True)
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
    def cash_amount(self):
        if self.refund_to_credit:
            return ZERO
        return self.paid_amount if self.paid_amount is not None else self.refund_amount


class PurchaseReturnLine(models.Model):
    purchase_return = models.ForeignKey(PurchaseReturn, related_name="lines", on_delete=models.CASCADE)
    item = models.ForeignKey(PurchaseOrderItem, related_name="returned", on_delete=models.CASCADE)
    quantity = models.DecimalField(max_digits=12, decimal_places=3, validators=[MinValueValidator(QTY)])
    unit_value = models.DecimalField(max_digits=14, decimal_places=4, help_text="Invoice price after discount share")
    branch = models.ForeignKey("locations.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    car = models.ForeignKey("locations.Car", null=True, blank=True, on_delete=models.PROTECT, related_name="+")

    @property
    def value(self):
        return (self.quantity * self.unit_value).quantize(CENT, rounding=ROUND_HALF_UP)
