"""Edits of finalized sales and received purchase orders (admin only): who, when, before and after."""
from django.conf import settings
from django.db import models


class EditLog(models.Model):
    SALE, PURCHASE = "SO", "PO"

    doc_type = models.CharField(max_length=2, choices=[(SALE, "Sales order"), (PURCHASE, "Purchase order")])
    doc_id = models.PositiveIntegerField()
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                             related_name="+")
    summary = models.CharField(max_length=500)
    before = models.JSONField(default=dict)
    after = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["doc_type", "doc_id"])]
