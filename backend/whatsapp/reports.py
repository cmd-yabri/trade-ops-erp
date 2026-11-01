"""Messages for the owner's WhatsApp group: a note per finalized sale and a daily summary."""
import logging
import threading
from datetime import date
from decimal import Decimal

from user.models import FeatureSettings

from . import sidecar

logger = logging.getLogger(__name__)


def _money(value) -> str:
    return f"${Decimal(value):,.2f}"


def sale_message(order) -> str:
    lines = [f"🧾 بيع جديد SO-{order.pk}: {order.client_name}"]
    for item in order.items.select_related("product"):
        lines.append(f"• {item.product.name} × {item.quantity.normalize():f}")
    lines.append(f"الإجمالي: {_money(order.grand_total)} · المدفوع: {_money(order.total_paid)}")
    return "\n".join(lines)


def daily_summary(day: date | None = None) -> str:
    """Today in numbers, for the group (sales, money in / out, what is owed, low stock)."""
    from django.db.models import F  # noqa: PLC0415

    from inventory.models import Product  # noqa: PLC0415
    from invoice import services as finance  # noqa: PLC0415
    from order.models import SalesOrder  # noqa: PLC0415

    day = day or date.today()
    t = finance.totals(day, day)
    sales = SalesOrder.objects.filter(is_finalized=True, finalized_at__date=day).count()
    low = list(Product.objects.filter(current_stock__lte=F("reorder_threshold")).values_list("name", flat=True)[:10])
    lines = [
        f"📊 ملخص يوم {day:%d/%m/%Y}",
        f"المبيعات: {sales} طلب بقيمة {_money(t['total_revenue'])}",
        f"صافي الربح: {_money(t['net_profit'])}",
        f"قبضنا: {_money(t['cash_received'])} · دفعنا للموردين: {_money(t['supplier_payments'])}",
        f"ديون لنا: {_money(t['receivables'])} · ديون علينا: {_money(t['payables'])}",
    ]
    if low:
        lines.append("⚠️ مخزون منخفض: " + "، ".join(low))
    return "\n".join(lines)


def send_to_group(text: str) -> str:
    settings = FeatureSettings.current()
    if not settings.whatsapp_group_jid:
        raise sidecar.SidecarError("اختر مجموعة واتساب أولاً من الإعدادات.", code="no_group", retryable=False)
    return sidecar.send_group(settings.whatsapp_group_jid, text)


def notify_sale_later(order_id: int) -> None:
    """After a sale is finalized: tell the group in the background (never slows or breaks the sale)."""
    settings = FeatureSettings.current()
    if not (settings.whatsapp and settings.whatsapp_notify_sales and settings.whatsapp_group_jid):
        return

    def run():
        from django.db import close_old_connections  # noqa: PLC0415

        from order.models import SalesOrder  # noqa: PLC0415

        try:
            order = SalesOrder.objects.prefetch_related("items__product", "payments", "returns").get(pk=order_id)
            send_to_group(sale_message(order))
        except Exception:  # noqa: BLE001 - the sale is done; a failed note only goes to the log
            logger.warning("WhatsApp group note for SO-%s was not sent", order_id, exc_info=True)
        finally:
            close_old_connections()

    threading.Thread(target=run, daemon=True).start()
