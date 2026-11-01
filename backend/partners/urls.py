from django.urls import path

from . import views

urlpatterns = [
    path("", views.partner_list),
    path("opening/", views.profit_opening),
    path("prior-profits/", views.prior_profit_create),
    path("prior-profits/<int:pk>/", views.prior_profit_detail),
    path("<int:pk>/", views.partner_detail),
    path("withdrawals/", views.withdrawal_create),
    path("withdrawals/<int:pk>/", views.withdrawal_delete),
    path("settlement/preview/", views.settlement_preview),
    path("settlements/", views.settlement_list),
    path("settlements/<int:pk>/", views.settlement_detail),
]
