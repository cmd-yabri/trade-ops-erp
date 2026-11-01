from django.urls import path

from . import views

urlpatterns = [
    path("branches/", views.branch_list),
    path("branches/<int:pk>/", views.branch_detail),
    path("cars/", views.car_list),
    path("cars/<int:pk>/", views.car_detail),
    path("transfers/", views.transfer_list),
]
