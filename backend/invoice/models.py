from datetime import date
from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models

CENT = Decimal("0.01")


class Expense(models.Model):
    """Manual ledger entries: operating expenses and miscellaneous income.

    Sales revenue, cost of goods and contractor costs are NOT stored here; they
    are derived from finalized sales orders (see invoice.services). Customer and
    supplier payments live on their own orders.
    """

    TYPE_CHOICES = [
        ("INCOME", "Income"),
        ("EXPENSE", "Expense"),
    ]
    INCOME_CATEGORY_CHOICES = [
        ("OTHER_INCOME", "Other Income"),
    ]
    EXPENSE_CATEGORY_CHOICES = [
        ("RENT", "Rent"),
        ("ELECTRICITY", "Electricity"),
        ("WATER", "Water"),
        ("UTILITIES", "Utilities"),
        ("SALARY", "Salary"),
        ("MARKETING", "Marketing"),
        ("OTHER", "Other"),
        ("STOCK", "Stock purchase"),
        ("FUEL", "Fuel"),
        ("MAINTENANCE", "Maintenance"),
        ("FREIGHT", "Purchase transport"),
    ]
    # Money spent buying stock. Shown with the expenses and counted as cash out, but NOT a
    # profit deduction: the same goods reach profit as cost of goods when they are sold.
    STOCK_CATEGORY = "STOCK"
    # Transport of purchased goods paid to a carrier: also part of the goods' cost, not a profit deduction.
    FREIGHT_CATEGORY = "FREIGHT"
    GOODS_CATEGORIES = (STOCK_CATEGORY, FREIGHT_CATEGORY)

    type = models.CharField(max_length=10, choices=TYPE_CHOICES, default="EXPENSE")
    description = models.CharField(max_length=200)
    category = models.CharField(max_length=30)
    amount = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(CENT)])
    date = models.DateField(default=date.today)
    branch = models.ForeignKey("locations.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    currency = models.CharField(max_length=3, default="USD")
    paid_amount = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)
    exchange_rate = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    # Expenses of a vehicle (fuel, maintenance ...) show on that car's page.
    car = models.ForeignKey("locations.Car", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    # When it was entered: orders same-day lines in statements (older rows have none).
    created_at = models.DateTimeField(auto_now_add=True, null=True)
    # Transport paid to a carrier for a purchase order (category FREIGHT): money out, part of the goods' cost.
    purchase_order = models.OneToOneField("purchase_order.PurchaseOrder", null=True, blank=True,
                                          on_delete=models.SET_NULL, related_name="freight_expense")
    # Opening stock paid from a cash box (category STOCK): money out for goods entered with a new product.
    opening_stock = models.OneToOneField("inventory.OpeningStock", null=True, blank=True,
                                         on_delete=models.SET_NULL, related_name="payment")

    @property
    def cash_amount(self):
        return self.paid_amount if self.paid_amount is not None else self.amount

    @classmethod
    def valid_categories(cls, type_):
        choices = cls.INCOME_CATEGORY_CHOICES if type_ == "INCOME" else cls.EXPENSE_CATEGORY_CHOICES
        return [c[0] for c in choices]

    def __str__(self):
        return f"{self.date} - {self.type} - {self.category}: {self.amount}"
