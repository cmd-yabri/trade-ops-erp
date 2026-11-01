from django.urls import path

from . import views

urlpatterns = [
    path("po/", views.po_list),
    path("po/<int:pk>/", views.po_detail),
    path("po/<int:po_id>/add-payment/", views.add_payment),
    path("po/<int:pk>/receive/", views.receive_order),
    path("po/<int:pk>/cancel/", views.cancel_order),
    path("po/<int:pk>/transport/", views.transport),
    path("po/<int:pk>/returns/", views.po_return),
    path("po/<int:pk>/returns/<int:return_id>/", views.po_return_delete),
]
