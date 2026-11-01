from urllib.parse import quote

from django.http import JsonResponse

from . import licensing

# Still reachable after the trial: log in, activate, export data, recover password.
ALWAYS_ALLOWED = (
    "/api/license/",
    "/api/health/",
    "/api/auth/",
    "/api/user/setup-status/",
    "/api/user/recovery/",
    "/api/system/backup/",
)


class LicenseMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path
        if path.startswith("/api/") and not path.startswith(ALWAYS_ALLOWED):
            if licensing.status()["status"] == "expired":
                return JsonResponse(
                    {
                        "detail": "انتهت الفترة التجريبية. يرجى تفعيل البرنامج للمتابعة (بياناتك محفوظة).",
                        "code": "license_required",
                    },
                    status=402,
                )
        return self.get_response(request)


class BoxWarningMiddleware:
    """Money may leave a cash box even when it does not hold that much (the owner's choice: warn, not block).

    For requests that can move money, the box balances are compared before and after; when one ends below
    zero and went down, the response carries an Arabic `X-Box-Warning` header the app shows as a toast.
    """

    MUTATING = ("POST", "PUT", "PATCH", "DELETE")
    SKIP = ("/api/auth/", "/api/user/", "/api/system/", "/api/license/", "/api/whatsapp/", "/api/audit/")

    def __init__(self, get_response):
        self.get_response = get_response

    def _balances(self):
        from cashbox.services import summary  # noqa: PLC0415

        return {row["currency"]: row["balance"] for row in summary()}

    def __call__(self, request):
        path = request.path
        watch = (
            request.method in self.MUTATING and path.startswith("/api/") and not path.startswith(self.SKIP)
            and request.headers.get("Authorization")
        )
        before = None
        if watch:
            try:
                from user.models import FeatureSettings  # noqa: PLC0415

                before = self._balances() if FeatureSettings.current().money_boxes else None
            except Exception:  # noqa: BLE001 - a warning must never break the request
                before = None
        response = self.get_response(request)
        if before is not None and 200 <= response.status_code < 300:
            try:
                after = self._balances()
                names = {"USD": "صندوق الدولار", "SYP": "صندوق الليرة"}
                notes = [
                    f"{names.get(cur, cur)} أصبح سالباً ({value:,.2f})"
                    for cur, value in after.items() if value < 0 and value < before.get(cur, 0)
                ]
                if notes:
                    text = "تنبيه: " + "، ".join(notes) + ". تأكد من الرصيد الفعلي."
                    response["X-Box-Warning"] = quote(text)
            except Exception:  # noqa: BLE001
                pass
        return response
