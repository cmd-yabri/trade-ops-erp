from datetime import date
from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models
from django.db.models.functions import Lower

ZERO = Decimal("0")


class Category(models.Model):
    name = models.CharField(max_length=200)

    class Meta:
        verbose_name_plural = "Categories"
        constraints = [
            models.UniqueConstraint(Lower("name"), name="unique_category_name_ci"),
        ]

    def __str__(self):
        return self.name


class Product(models.Model):
    name = models.CharField(max_length=200)
    category = models.ForeignKey(Category, on_delete=models.SET_NULL, null=True, blank=True)

    # Financials
    # 4 decimals so a metre of cable can cost 0.3333
    unit_cost = models.DecimalField(
        max_digits=14, decimal_places=4, validators=[MinValueValidator(ZERO)],
        help_text="Last purchase price (landed: after the order's discount, plus its transport share)",
    )
    selling_price = models.DecimalField(
        max_digits=10, decimal_places=2, default=ZERO, validators=[MinValueValidator(ZERO)],
        help_text="Standard selling price",
    )

    wholesale_price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(ZERO)],
        help_text="Price for wholesale accounts (falls back to the selling price when empty)",
    )

    # Stock levels
    # Quantities allow 3 decimals so cable can be sold by the metre (3.5 m);
    # products with allow_decimal=False only ever hold whole numbers.
    current_stock = models.DecimalField(
        max_digits=12, decimal_places=3, default=ZERO, validators=[MinValueValidator(ZERO)],
        help_text="Total across every location",
    )
    reorder_threshold = models.DecimalField(
        max_digits=12, decimal_places=3, default=Decimal("10"), validators=[MinValueValidator(ZERO)],
        help_text="Alert when stock drops to or below this",
    )
    allow_decimal = models.BooleanField(default=False, help_text="Sold by fractions (metres, kg ...)")
    unit = models.CharField(max_length=30, blank=True, help_text="Unit label, e.g. متر / قطعة")

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(current_stock__gte=0), name="product_stock_not_negative"),
        ]

    @property
    def is_low_stock(self) -> bool:
        return self.current_stock <= self.reorder_threshold

    def __str__(self):
        return self.name


class OpeningStock(models.Model):
    """Stock entered with a new product: goods already owned, no supplier and no cash.

    It can be linked later to a supplier: that turns it into a received purchase order, so the
    supplier's balance shows it (and it can be paid) without the goods entering stock twice.
    """

    product = models.ForeignKey(Product, related_name="openings", on_delete=models.CASCADE)
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    unit_cost = models.DecimalField(max_digits=14, decimal_places=4)
    branch = models.ForeignKey("locations.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    date = models.DateField(default=date.today)
    created_at = models.DateTimeField(auto_now_add=True)
    purchase_order = models.OneToOneField("purchase_order.PurchaseOrder", null=True, blank=True,
                                          on_delete=models.SET_NULL, related_name="opening_stock")

    @property
    def value(self) -> Decimal:
        return (self.quantity * self.unit_cost).quantize(Decimal("0.01"))
