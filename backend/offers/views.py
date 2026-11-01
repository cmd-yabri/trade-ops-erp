from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from order.serializers import SalesOrderSerializer
from tradeops.errors import ConflictError, require_admin

from .models import Offer
from .serializers import OfferSerializer
from .services import accept_offer, reject_offer, reopen_offer

NOT_FOUND = {"detail": "العرض غير موجود."}


def _offers():
    return Offer.objects.select_related("account", "branch", "car").prefetch_related("items__product", "jobs")


def _ser(request, instance=None, **kwargs):
    return OfferSerializer(instance, context={"request": request}, **kwargs)


@api_view(["GET", "POST"])
def offer_list(request):
    if request.method == "GET":
        offers = _offers()
        branch = request.query_params.get("branch", "")
        if branch.isdigit():
            offers = offers.filter(branch_id=int(branch))
        return Response(_ser(request, offers.order_by("-created_at", "-id"), many=True).data)
    serializer = _ser(request, data=request.data)
    serializer.is_valid(raise_exception=True)
    offer = serializer.save()
    return Response(_ser(request, _offers().get(pk=offer.pk)).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "DELETE"])
def offer_detail(request, pk):
    offer = _offers().filter(pk=pk).first()
    if offer is None:
        return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        return Response(_ser(request, offer).data)
    if request.method == "PUT":
        serializer = _ser(request, offer, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(_ser(request, _offers().get(pk=pk)).data)
    require_admin(request)
    if offer.status == Offer.ACCEPTED:
        raise ConflictError("العرض المقبول مرتبط بأمر بيع ولا يمكن حذفه.")
    offer.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


def _action(request, pk, fn):
    offer = _offers().filter(pk=pk).first()
    if offer is None:
        return None, Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
    return fn(offer), None


@api_view(["POST"])
def accept(request, pk):
    """The client accepted: creates a new sales order from the offer."""
    order, error = _action(request, pk, accept_offer)
    if error:
        return error
    return Response({
        "offer": _ser(request, _offers().get(pk=pk)).data,
        "sales_order": SalesOrderSerializer(order, context={"request": request}).data,
    }, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def reject(request, pk):
    _, error = _action(request, pk, reject_offer)
    return error or Response(_ser(request, _offers().get(pk=pk)).data)


@api_view(["POST"])
def reopen(request, pk):
    _, error = _action(request, pk, reopen_offer)
    return error or Response(_ser(request, _offers().get(pk=pk)).data)
