"""The only place stock quantities change.

Stock lives in StockLevel rows (one per product per branch/car); Product.current_stock
is their total and is updated in the same step. Done in Python Decimals (not SQL
arithmetic) so fractional quantities such as 0.1 + 0.2 never drift into float noise
that would trip the stock >= 0 checks.
"""
from decimal import Decimal

from django.db import transaction

from locations.models import Branch, Car, StockLevel, StockMovement, StockTransfer
from tradeops.errors import BusinessRuleError

from .models import Product

ZERO = Decimal("0")
MAIN_BRANCH_NAME = "الفرع الرئيسي"


def fmt_qty(value) -> str:
    """3.500 -> '3.5', 10.000 -> '10' for messages."""
    return format(Decimal(value).normalize(), "f")


def default_branch() -> Branch:
    """The branch used whenever a record does not name one (always exists)."""
    branch = Branch.objects.filter(is_default=True).first()
    if branch is None:
        branch = Branch.objects.order_by("id").first()
        if branch is None:
            return Branch.objects.create(name=MAIN_BRANCH_NAME, is_default=True)
        branch.is_default = True
        branch.save(update_fields=["is_default"])
    return branch


def _ensure_levels(product: Product) -> None:
    """Stock that predates locations (or was set directly) is treated as sitting in the default branch."""
    if product.current_stock > ZERO and not StockLevel.objects.filter(product=product).exists():
        StockLevel.objects.create(product=product, branch=default_branch(), quantity=product.current_stock)


def check_quantity_for_product(product: Product, quantity: Decimal) -> None:
    """Whole-number products reject fractions."""
    if quantity <= ZERO:
        raise BusinessRuleError("الكمية يجب أن تكون أكبر من صفر.")
    if not product.allow_decimal and quantity != quantity.to_integral_value():
        raise BusinessRuleError(
            f"المنتج «{product.name}» يُباع بالقطعة الكاملة فقط. فعّل خيار الكسور في بطاقة المنتج لبيعه بالكسور."
        )


def adjust_stock(product_id: int, delta: Decimal, *, branch_id: int | None = None,
                 car_id: int | None = None, kind: str = StockMovement.CORRECTION, ref: str = "",
                 note: str = "") -> Product:
    """Add delta (may be negative) to a product at one place. Must run inside a transaction.

    The place is the given car, else the given branch, else the default branch. Every change is
    written to the product's movement history (kind / ref / note say why).
    """
    delta = Decimal(delta)
    product = Product.objects.select_for_update().filter(pk=product_id).first()
    if product is None:
        raise BusinessRuleError("المنتج غير موجود.")
    _ensure_levels(product)

    if car_id:
        car = Car.objects.filter(pk=car_id).first()
        if car is None:
            raise BusinessRuleError("السيارة غير موجودة.")
        place = {"car_id": car_id, "branch": None}
        place_name = car.name
    else:
        branch = Branch.objects.filter(pk=branch_id).first() if branch_id else default_branch()
        if branch is None:
            raise BusinessRuleError("الفرع غير موجود.")
        place = {"branch": branch, "car": None}
        place_name = branch.name

    level, _ = StockLevel.objects.select_for_update().get_or_create(product=product, **place)
    new_qty = level.quantity + delta
    if new_qty < ZERO:
        raise BusinessRuleError(
            f"المخزون غير كافٍ للمنتج «{product.name}» في «{place_name}»: "
            f"المتوفر {fmt_qty(level.quantity)} والمطلوب {fmt_qty(-delta)}."
        )
    level.quantity = new_qty
    level.save(update_fields=["quantity"])
    StockMovement.objects.create(
        product=product, branch=place["branch"], car_id=place.get("car_id"), delta=delta,
        balance_after=new_qty, kind=kind, ref=ref, note=note,
    )

    product.current_stock = product.current_stock + delta
    product.save(update_fields=["current_stock"])
    return product


@transaction.atomic
def transfer_stock(product_id: int, quantity: Decimal, *, from_branch=None, from_car=None,
                   to_branch=None, to_car=None, note: str = "") -> StockTransfer:
    """Move goods between branches / cars. Total stock is unchanged."""
    quantity = Decimal(quantity)
    if bool(from_branch) == bool(from_car) or bool(to_branch) == bool(to_car):
        raise BusinessRuleError("حدد مصدراً واحداً ووجهة واحدة (فرع أو سيارة).")
    if (from_branch and from_branch == to_branch) or (from_car and from_car == to_car):
        raise BusinessRuleError("المصدر والوجهة متطابقان.")
    product = Product.objects.filter(pk=product_id).first()
    if product is None:
        raise BusinessRuleError("المنتج غير موجود.")
    check_quantity_for_product(product, quantity)

    adjust_stock(product_id, -quantity, branch_id=from_branch, car_id=from_car, kind=StockMovement.TRANSFER, note=note)
    adjust_stock(product_id, quantity, branch_id=to_branch, car_id=to_car, kind=StockMovement.TRANSFER, note=note)
    return StockTransfer.objects.create(
        product=product, quantity=quantity, from_branch_id=from_branch, from_car_id=from_car,
        to_branch_id=to_branch, to_car_id=to_car, note=note,
    )


@transaction.atomic
def transfer_many(lines: list[tuple[int, Decimal]], **places) -> list[StockTransfer]:
    """Move several products in one go: all of them or (if one place is short) none."""
    seen = set()
    for product_id, _ in lines:
        if product_id in seen:
            raise BusinessRuleError("المنتج مكرر في قائمة النقل. اجمع الكمية في سطر واحد.")
        seen.add(product_id)
    return [transfer_stock(product_id, quantity, **places) for product_id, quantity in lines]


def levels_for(product: Product) -> list[dict]:
    """Stock by place for the API (empty places omitted). Use prefetch_related("levels__branch", "levels__car")."""
    levels = list(product.levels.all())
    if not levels and product.current_stock > ZERO:
        _ensure_levels(product)  # legacy stock, see _ensure_levels
        levels = list(product.levels.select_related("branch", "car"))
    return [
        {
            "kind": "car" if level.car_id else "branch",
            "id": level.car_id or level.branch_id,
            "name": level.place_name,
            "quantity": level.quantity,
        }
        for level in levels if level.quantity > ZERO
    ]
