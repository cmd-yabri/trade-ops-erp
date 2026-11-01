"""Where stock physically sits: branches and cars (vehicles that carry stock)."""
from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models

from inventory.models import Product

ZERO = Decimal("0")
QTY = Decimal("0.001")


class Branch(models.Model):
    """A shop / warehouse. One default branch always exists so every record has a home."""

    name = models.CharField(max_length=200)
    address = models.CharField(max_length=300, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name_plural = "Branches"

    def __str__(self):
        return self.name


class Car(models.Model):
    """A vehicle that carries its own stock (sold straight from the car)."""

    name = models.CharField(max_length=200)
    plate = models.CharField(max_length=50, blank=True)
    driver_name = models.CharField(max_length=200, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    notes = models.CharField(max_length=500, blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class StockLevel(models.Model):
    """Quantity of one product in one place (a branch or a car).

    Product.current_stock is the total of all its levels; both are only ever
    changed together by inventory.stock.adjust_stock.
    """

    product = models.ForeignKey(Product, related_name="levels", on_delete=models.CASCADE)
    branch = models.ForeignKey(Branch, null=True, blank=True, related_name="levels", on_delete=models.PROTECT)
    car = models.ForeignKey(Car, null=True, blank=True, related_name="levels", on_delete=models.PROTECT)
    quantity = models.DecimalField(
        max_digits=12, decimal_places=3, default=ZERO, validators=[MinValueValidator(ZERO)],
    )

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=(models.Q(branch__isnull=False, car__isnull=True)
                           | models.Q(branch__isnull=True, car__isnull=False)),
                name="stocklevel_one_place",
            ),
            models.CheckConstraint(condition=models.Q(quantity__gte=0), name="stocklevel_not_negative"),
            models.UniqueConstraint(fields=["product", "branch"], condition=models.Q(branch__isnull=False),
                                    name="stocklevel_unique_branch"),
            models.UniqueConstraint(fields=["product", "car"], condition=models.Q(car__isnull=False),
                                    name="stocklevel_unique_car"),
        ]

    @property
    def place_name(self):
        return self.car.name if self.car_id else self.branch.name


class StockTransfer(models.Model):
    """History of goods moved between branches / cars."""

    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    quantity = models.DecimalField(max_digits=12, decimal_places=3, validators=[MinValueValidator(QTY)])
    from_branch = models.ForeignKey(Branch, null=True, blank=True, related_name="+", on_delete=models.PROTECT)
    from_car = models.ForeignKey(Car, null=True, blank=True, related_name="+", on_delete=models.PROTECT)
    to_branch = models.ForeignKey(Branch, null=True, blank=True, related_name="+", on_delete=models.PROTECT)
    to_car = models.ForeignKey(Car, null=True, blank=True, related_name="+", on_delete=models.PROTECT)
    note = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class StockMovement(models.Model):
    """Every change of a product's quantity at one place, written by inventory.stock.adjust_stock.

    The product's history: what came in or went out, where, why, and what was left there after.
    """

    OPENING, PURCHASE, SALE, SALE_UNDO, TRANSFER, CORRECTION, RETURN_IN, RETURN_OUT, EDIT = (
        "OPENING", "PURCHASE", "SALE", "SALE_UNDO", "TRANSFER", "CORRECTION", "RETURN_IN", "RETURN_OUT", "EDIT",
    )
    KINDS = [
        (OPENING, "رصيد افتتاحي"), (PURCHASE, "استلام شراء"), (SALE, "بيع"), (SALE_UNDO, "إلغاء بيع"),
        (TRANSFER, "نقل"), (CORRECTION, "تصحيح جرد"), (RETURN_IN, "مرتجع من عميل"),
        (RETURN_OUT, "مرتجع إلى مورد"), (EDIT, "تعديل فاتورة"),
    ]

    product = models.ForeignKey(Product, related_name="movements", on_delete=models.CASCADE)
    branch = models.ForeignKey(Branch, null=True, blank=True, related_name="+", on_delete=models.PROTECT)
    car = models.ForeignKey(Car, null=True, blank=True, related_name="+", on_delete=models.PROTECT)
    delta = models.DecimalField(max_digits=12, decimal_places=3)
    balance_after = models.DecimalField(max_digits=12, decimal_places=3, help_text="Quantity left at that place")
    kind = models.CharField(max_length=12, choices=KINDS)
    ref = models.CharField(max_length=40, blank=True, help_text="SO-12, PO-3 ...")
    note = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
