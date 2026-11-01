from django.urls import path

from . import views

urlpatterns = [
    path("boxes/", views.boxes),
    path("statement/", views.statement),
    path("entries/", views.add_entry),
    path("movements/", views.edit_movement),
    path("exchanges/", views.exchanges),
]
