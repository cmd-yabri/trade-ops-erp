from django.contrib.auth import authenticate
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework_simplejwt.tokens import RefreshToken

from tradeops.errors import BusinessRuleError, ConflictError, require_admin

from . import recovery
from .models import Role, User
from .serializers import UserSerializer, public_user, validate_new_password


class LoginThrottle(SimpleRateThrottle):
    """Slows down password guessing (the app only ever sees 127.0.0.1)."""

    scope = "login"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


def _needs_setup() -> bool:
    return not User.objects.exists()


def _tokens_for(user: User) -> dict:
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh), "user": public_user(user)}


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def setup_status(request):
    """Tells the login screen whether the very first account must be created."""
    return Response({"needs_setup": _needs_setup()})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def signup(request):
    """First-run only: creates the owner account (always ADMIN).

    Afterwards new accounts are created by an admin via /api/user/users/.
    """
    if not _needs_setup():
        raise PermissionDenied("تم إعداد النظام مسبقاً. اطلب من المدير إنشاء حساب لك.")
    data = {k: v for k, v in request.data.items() if k not in ("role", "is_active")}
    serializer = UserSerializer(data=data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save(role=Role.ADMIN)
    return Response({"data": public_user(user), "message": "تم إنشاء الحساب بنجاح"}, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle])
def login(request):
    username = (request.data.get("username") or request.data.get("email") or "").strip()
    password = request.data.get("password") or ""
    user = authenticate(username=username, password=password)
    if user is None or not user.is_active:
        return Response({"detail": "اسم المستخدم أو كلمة المرور غير صحيحة."}, status=status.HTTP_401_UNAUTHORIZED)
    return Response(_tokens_for(user))


@api_view(["GET"])
def get_user_info(request):
    return Response({"payload": public_user(request.user)})


@api_view(["POST"])
def change_password(request):
    old, new = request.data.get("old_password", ""), request.data.get("new_password", "")
    if not request.user.check_password(old):
        raise BusinessRuleError("كلمة المرور الحالية غير صحيحة.")
    request.user.set_password(validate_new_password(new))
    request.user.save(update_fields=["password"])
    return Response({"detail": "تم تغيير كلمة المرور."})


# ---- user management (admin only) -------------------------------------------
def _active_admin_count(excluding=None) -> int:
    qs = User.objects.filter(is_active=True).filter(role=Role.ADMIN) | User.objects.filter(
        is_active=True, is_superuser=True
    )
    if excluding is not None:
        qs = qs.exclude(pk=excluding.pk)
    return qs.distinct().count()


@api_view(["GET", "POST"])
def users_list(request):
    require_admin(request)
    if request.method == "GET":
        return Response([public_user(u) for u in User.objects.order_by("username")])
    serializer = UserSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    return Response(public_user(serializer.save()), status=status.HTTP_201_CREATED)


@api_view(["PUT", "DELETE"])
def user_detail(request, pk):
    require_admin(request)
    try:
        target = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({"detail": "المستخدم غير موجود."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "DELETE":
        if target.pk == request.user.pk:
            raise ConflictError("لا يمكنك حذف حسابك الحالي.")
        if target.is_admin_role and _active_admin_count(excluding=target) == 0:
            raise ConflictError("لا يمكن حذف آخر مدير في النظام.")
        target.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = UserSerializer(target, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    new_role = serializer.validated_data.get("role", target.role)
    still_active = serializer.validated_data.get("is_active", target.is_active)
    loses_admin = target.is_admin_role and (new_role != Role.ADMIN and not target.is_superuser or not still_active)
    if loses_admin and _active_admin_count(excluding=target) == 0:
        raise ConflictError("لا يمكن إزالة صلاحيات آخر مدير في النظام.")
    return Response(public_user(serializer.save()))


# ---- offline password recovery ----------------------------------------------
@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def recovery_challenge(request):
    return Response({"request_code": recovery.request_code()})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle])
def recovery_reset(request):
    username = (request.data.get("username") or "").strip()
    code = request.data.get("code") or ""
    new_password = validate_new_password(request.data.get("new_password") or "")
    if not username:
        from django.db.models import Q

        admins = User.objects.filter(Q(role=Role.ADMIN) | Q(is_superuser=True)).distinct().order_by("username")
        if not admins.exists():
            raise BusinessRuleError("لا يوجد حساب مدير نشط لاستعادته.")
        if admins.count() != 1:
            raise BusinessRuleError("يوجد أكثر من حساب مدير. أدخل اسم المستخدم أو تواصل مع الدعم.")
        if not recovery.verify_and_consume(code, recovery.ADMIN_RECOVERY_SCOPE):
            raise BusinessRuleError("رمز الاستعادة غير صحيح أو منتهي.")
        target = admins.first()
        target.set_password(new_password)
        target.is_active = True
        target.save(update_fields=["password", "is_active"])
        return Response({
            "detail": "تمت استعادة حساب المدير وإعادة تعيين كلمة المرور.",
            "username": target.username,
        })

    target = User.objects.filter(username__iexact=username).first()
    # Same message for "no such user" and "bad code" so usernames can't be probed.
    if target is None or not recovery.verify_and_consume(code, target.username):
        raise BusinessRuleError("رمز الاستعادة غير صحيح أو منتهي.")
    target.set_password(new_password)
    target.is_active = True
    target.save(update_fields=["password", "is_active"])
    return Response({"detail": "تمت إعادة تعيين كلمة المرور. يمكنك تسجيل الدخول الآن."})
