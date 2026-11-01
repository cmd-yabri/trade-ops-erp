"""Shared API error types, permission helpers and the DRF exception handler."""
import logging

from django.db import IntegrityError
from django.db.models import ProtectedError
from rest_framework import status
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


class BusinessRuleError(APIException):
    """A request that is well-formed but breaks a business rule (HTTP 400)."""

    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "تعذر تنفيذ العملية."
    default_code = "business_rule"


class ConflictError(BusinessRuleError):
    status_code = status.HTTP_409_CONFLICT


def is_admin(user) -> bool:
    return bool(
        user
        and user.is_authenticated
        and (user.is_superuser or getattr(user, "role", "") == "ADMIN")
    )


# Profit and cost figures: the owner's eyes only (staff still see sales, expenses and what is owed).
STAFF_HIDDEN = ("net_profit", "total_profit", "total_cogs", "total_expenses", "total_freelance_costs")


def hide_from_staff(request, data: dict) -> dict:
    if not is_admin(request.user):
        for key in STAFF_HIDDEN:
            data.pop(key, None)
    return data


def require_admin(request):
    if not is_admin(request.user):
        raise PermissionDenied("هذه العملية متاحة للمدير فقط.")


def require_feature(name: str):
    """Reject the request when an optional module is switched off in Settings."""
    from user.models import FeatureSettings

    if not getattr(FeatureSettings.current(), name):
        raise PermissionDenied("هذه الميزة غير مفعّلة. فعّلها من الإعدادات.")


def api_exception_handler(exc, context):
    if isinstance(exc, ProtectedError):
        return Response(
            {"detail": "لا يمكن حذف هذا العنصر لأنه مرتبط ببيانات أخرى (طلبات بيع أو شراء)."},
            status=status.HTTP_409_CONFLICT,
        )
    if isinstance(exc, IntegrityError):
        logger.warning("IntegrityError: %s", exc)
        return Response(
            {"detail": "البيانات المدخلة تخالف قواعد قاعدة البيانات (قيمة مكررة أو غير صالحة)."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    response = exception_handler(exc, context)
    if response is None:
        logger.exception("Unhandled API error", exc_info=exc)
        return Response(
            {"detail": "حدث خطأ غير متوقع في الخادم. تم تسجيله في ملف السجل."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    return response
