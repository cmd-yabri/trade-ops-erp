from django.urls import path

from . import views

urlpatterns = [
    path("", views.account_list),
    path("<int:pk>/", views.account_detail),
    path("<int:pk>/payments/", views.account_payment),
    path("<int:pk>/payments/<int:payment_id>/", views.account_payment_delete),
    path("<int:pk>/entries/", views.account_entry),
    path("<int:pk>/entries/<int:entry_id>/", views.account_entry_delete),
]
