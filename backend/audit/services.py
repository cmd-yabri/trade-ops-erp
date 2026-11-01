from decimal import Decimal

from .models import EditLog


def _plain(value):
    if isinstance(value, Decimal):
        return format(value.normalize(), "f")  # 100, 2.5 (never 1E+2)
    return value


def sales_snapshot(order) -> dict:
    return {
        "date": order.date.date().isoformat() if order.date else None, "client": order.client_name,
        "account": order.account_id, "discount": _plain(order.discount), "total": _plain(order.grand_total),
        "items": [{"product": i.product.name, "quantity": _plain(i.quantity), "price": _plain(i.unit_price),
                   "from": (i.car.name if i.car_id else i.branch.name if i.branch_id else "")}
                  for i in order.items.select_related("product", "branch", "car")],
        "jobs": [{"type": j.job_type, "charge": _plain(j.charge_to_client), "cost": _plain(j.cost_to_company)}
                 for j in order.freelance_jobs.all()],
    }


def purchase_snapshot(po) -> dict:
    return {
        "date": po.order_date.isoformat(), "supplier": po.supplier, "account": po.account_id,
        "discount": _plain(po.discount), "total": _plain(po.net_total),
        "items": [{"product": i.product.name, "quantity": _plain(i.quantity), "received": _plain(i.received_quantity),
                   "price": _plain(i.unit_cost)} for i in po.items.select_related("product")],
    }


def _changes(before: dict, after: dict) -> str:
    labels = {"date": "التاريخ", "client": "العميل", "supplier": "المورد", "account": "الحساب", "discount": "الخصم",
              "total": "الإجمالي", "items": "البنود", "jobs": "الخدمات"}
    changed = [labels.get(k, k) for k in after if before.get(k) != after.get(k)]
    return "تعديل: " + ("، ".join(changed) if changed else "بدون تغيير فعلي")


def log_edit(doc_type: str, doc_id: int, user, before: dict, after: dict) -> EditLog:
    return EditLog.objects.create(doc_type=doc_type, doc_id=doc_id, user=user if getattr(user, "pk", None) else None,
                                  summary=_changes(before, after), before=before, after=after)
