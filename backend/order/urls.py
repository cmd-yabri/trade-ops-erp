from django.urls import path

from . import views

urlpatterns = [
    path("sales/", views.sales_order_list, name="sales-order-list"),
    path("sales/<int:pk>/", views.sales_order_detail, name="sales-order-detail"),
    path("sales/<int:pk>/finalize/", views.finalize_order, name="finalize-order"),
    path("sales/<int:pk>/returns/", views.order_return),
    path("sales/<int:pk>/returns/<int:return_id>/", views.order_return_delete),
    path("sales/<int:order_id>/payments/", views.add_order_payment, name="add-order-payment"),
]
