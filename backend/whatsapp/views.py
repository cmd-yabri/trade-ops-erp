from rest_framework import status as http
from rest_framework.decorators import api_view
from rest_framework.response import Response

from tradeops.errors import BusinessRuleError, require_admin, require_feature
from user.models import FeatureSettings

from . import reports, sidecar
from .phone import InvalidPhoneNumber, normalise, wa_me_url


def _country() -> str:
    return FeatureSettings.current().whatsapp_country_code


@api_view(["GET"])
def status(request):
    """Link state of the shop's WhatsApp (also what the QR / pairing code is, while linking)."""
    require_feature("whatsapp")
    sidecar.ensure_started()
    return Response(sidecar.status())


@api_view(["POST"])
def connect(request):
    """Start linking. With a phone number -> an 8-character pairing code; without -> a QR code."""
    require_admin(request)
    require_feature("whatsapp")
    if not sidecar.ensure_started():
        raise BusinessRuleError(sidecar.available()[1])
    phone = str(request.data.get("phone", "")).strip()
    try:
        digits = normalise(phone, _country()) if phone else ""
        return Response(sidecar.start_link(digits))
    except InvalidPhoneNumber as exc:
        raise BusinessRuleError(str(exc))
    except sidecar.SidecarError as exc:
        raise BusinessRuleError(str(exc))


@api_view(["POST"])
def disconnect(request):
    require_admin(request)
    require_feature("whatsapp")
    try:
        sidecar.logout()
    except sidecar.SidecarError as exc:
        raise BusinessRuleError(str(exc))
    return Response({"detail": "تم فصل الربط."})


@api_view(["POST"])
def chat_url(request):
    """Click-to-chat link that opens WhatsApp with the text filled in (works without linking)."""
    require_feature("whatsapp")
    try:
        return Response({"url": wa_me_url(request.data.get("phone", ""), str(request.data.get("text", "")), _country())})
    except InvalidPhoneNumber as exc:
        raise BusinessRuleError(str(exc))


@api_view(["POST"])
def send(request):
    """Send one message through the linked WhatsApp. On failure the reply carries a click-to-chat fallback."""
    require_feature("whatsapp")
    text = str(request.data.get("text", "")).strip()
    if not text:
        raise BusinessRuleError("نص الرسالة فارغ.")
    try:
        digits = normalise(request.data.get("phone", ""), _country())
    except InvalidPhoneNumber as exc:
        raise BusinessRuleError(str(exc))
    try:
        message_id = sidecar.send_text(digits, text)
    except sidecar.SidecarError as exc:
        return Response(
            {"detail": str(exc), "retryable": exc.retryable, "fallback_url": wa_me_url(digits, text, _country())},
            status=http.HTTP_502_BAD_GATEWAY,
        )
    return Response({"id": message_id, "detail": "تم الإرسال."})


@api_view(["GET"])
def groups(request):
    """Groups the linked phone is a member of (to choose where reports go)."""
    require_admin(request)
    require_feature("whatsapp")
    try:
        return Response(sidecar.groups())
    except sidecar.SidecarError as exc:
        raise BusinessRuleError(str(exc))


@api_view(["POST"])
def send_group(request):
    """Send a text (or today's summary: {"summary": true}) to the chosen group."""
    require_admin(request)
    require_feature("whatsapp")
    text = reports.daily_summary() if request.data.get("summary") else str(request.data.get("text", "")).strip()
    if not text:
        raise BusinessRuleError("نص الرسالة فارغ.")
    try:
        message_id = reports.send_to_group(text)
    except sidecar.SidecarError as exc:
        raise BusinessRuleError(str(exc))
    return Response({"id": message_id, "detail": "تم الإرسال إلى المجموعة.", "text": text})


@api_view(["GET"])
def summary_preview(request):
    require_admin(request)
    require_feature("whatsapp")
    return Response({"text": reports.daily_summary()})
