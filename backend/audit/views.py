from rest_framework.decorators import api_view
from rest_framework.response import Response

from tradeops.errors import require_admin

from .models import EditLog


@api_view(["GET"])
def edit_log(request):
    """?type=SO|PO&id=12: the edits of one document, newest first."""
    require_admin(request)
    rows = EditLog.objects.select_related("user")
    if request.query_params.get("type") in (EditLog.SALE, EditLog.PURCHASE):
        rows = rows.filter(doc_type=request.query_params["type"])
    if request.query_params.get("id", "").isdigit():
        rows = rows.filter(doc_id=int(request.query_params["id"]))
    return Response([
        {"id": r.id, "doc_type": r.doc_type, "doc_id": r.doc_id, "summary": r.summary,
         "user": (r.user.first_name or r.user.username) if r.user else "", "before": r.before, "after": r.after,
         "created_at": r.created_at}
        for r in rows[:200]
    ])
