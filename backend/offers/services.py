from datetime import datetime

from django.db import transaction

from accounts.services import apply_credit
from inventory.stock import default_branch
from order.models import FreelanceJob, OrderItem, SalesOrder
from tradeops.errors import BusinessRuleError

from .models import Offer


def _locked(offer: Offer) -> Offer:
    return Offer.objects.select_for_update().get(pk=offer.pk)


@transaction.atomic
def accept_offer(offer: Offer) -> SalesOrder:
    """The client said yes: create a NEW sales order (not finalized, no stock touched yet).

    Stock is only checked and deducted when that sales order is finalized, exactly as for any
    other sales order; accepting an offer changes nothing in inventory or in the books.
    """
    offer = _locked(offer)
    if offer.status == Offer.ACCEPTED:
        raise BusinessRuleError("تم قبول هذا العرض مسبقاً وتحويله إلى أمر بيع.")
    if offer.status == Offer.REJECTED:
        raise BusinessRuleError("هذا العرض مرفوض. أعد فتحه أولاً إن وافق العميل.")
    if offer.is_expired:
        raise BusinessRuleError(
            f"انتهت صلاحية العرض بتاريخ {offer.valid_until}. عدّل تاريخ الصلاحية ثم اقبله."
        )
    if not offer.items.exists() and not offer.jobs.exists():
        raise BusinessRuleError("العرض فارغ.")

    order = SalesOrder.objects.create(
        client_name=offer.client_name, client_phone=offer.client_phone, client_address=offer.client_address,
        discount=offer.discount, account=offer.account, branch=offer.branch or default_branch(), car=offer.car,
    )
    for item in offer.items.all():
        OrderItem.objects.create(order=order, product=item.product, quantity=item.quantity, unit_price=item.unit_price)
    for job in offer.jobs.all():
        FreelanceJob.objects.create(
            order=order, job_type=job.job_type, contractor_name=job.contractor_name,
            cost_to_company=job.cost_to_company, charge_to_client=job.charge_to_client,
        )
    offer.status = Offer.ACCEPTED
    offer.decided_at = datetime.now()
    offer.sales_order = order
    offer.save(update_fields=["status", "decided_at", "sales_order"])
    apply_credit(order.account)
    return order


@transaction.atomic
def reject_offer(offer: Offer) -> Offer:
    offer = _locked(offer)
    if offer.status == Offer.ACCEPTED:
        raise BusinessRuleError("العرض مقبول وتحوّل إلى أمر بيع؛ لا يمكن رفضه.")
    offer.status = Offer.REJECTED
    offer.decided_at = datetime.now()
    offer.save(update_fields=["status", "decided_at"])
    return offer


@transaction.atomic
def reopen_offer(offer: Offer) -> Offer:
    offer = _locked(offer)
    if offer.status != Offer.REJECTED:
        raise BusinessRuleError("يمكن إعادة فتح العروض المرفوضة فقط.")
    offer.status = Offer.PENDING
    offer.decided_at = None
    offer.save(update_fields=["status", "decided_at"])
    return offer
