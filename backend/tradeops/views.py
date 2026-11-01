from pathlib import Path

from django.conf import settings
from django.http import HttpResponse, JsonResponse


def index(request, *args, **kwargs):
    """Serve the compiled React app (single-page application)."""
    index_file = Path(settings.STATIC_ROOT) / "index.html"
    if not index_file.exists():
        return HttpResponse(
            "واجهة المستخدم غير مبنية بعد. شغّل build_exe.bat أو npm run build.",
            status=503,
            content_type="text/plain; charset=utf-8",
        )
    return HttpResponse(index_file.read_text(encoding="utf-8"), content_type="text/html; charset=utf-8")


def api_not_found(request, *args, **kwargs):
    """Unknown /api/ URLs must be a JSON 404, never the SPA page."""
    return JsonResponse({"detail": "المسار غير موجود."}, status=404)


def health(request):
    return JsonResponse({"status": "ok", "version": settings.APP_VERSION})
