from django.urls import include, path, re_path

from user.views import login

from . import backups, system, views

urlpatterns = [
    path("api/health/", views.health),
    path("api/auth/token/", login, name="token_obtain_pair"),
    path("api/user/", include("user.urls")),
    path("api/reports/", include("reports.urls")),
    path("api/inventory/", include("inventory.urls")),
    path("api/purchases/", include("purchase_order.urls")),
    path("api/orders/", include("order.urls")),
    path("api/invoice/", include("invoice.urls")),
    path("api/system/backup/", system.make_backup),
    path("api/system/backup-settings/", backups.backup_settings),
    path("api/system/backups/", backups.backups),
    path("api/system/restore/", backups.restore),
    path("api/system/info/", system.system_info),
    path("api/system/company/", system.company_profile),
    path("api/system/features/", system.feature_settings),
    path("api/locations/", include("locations.urls")),
    path("api/cashbox/", include("cashbox.urls")),
    path("api/partners/", include("partners.urls")),
    path("api/accounts/", include("accounts.urls")),
    path("api/whatsapp/", include("whatsapp.urls")),
    path("api/offers/", include("offers.urls")),
    path("api/audit/", include("audit.urls")),
    path("api/license/", system.license_status),
    path("api/license/activate/", system.license_activate),
    # Anything else under /api/ is a JSON 404, never the web page.
    re_path(r"^api/.*$", views.api_not_found),
    # Every other URL belongs to the single-page React app.
    re_path(r"^(?!static/).*$", views.index),
]
