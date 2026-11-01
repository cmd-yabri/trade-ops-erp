from django.urls import path

from . import views

urlpatterns = [
    path("", views.offer_list),
    path("<int:pk>/", views.offer_detail),
    path("<int:pk>/accept/", views.accept),
    path("<int:pk>/reject/", views.reject),
    path("<int:pk>/reopen/", views.reopen),
]
