from django.urls import path

from . import views

urlpatterns = [
    path("status/", views.status),
    path("connect/", views.connect),
    path("disconnect/", views.disconnect),
    path("send/", views.send),
    path("chat-url/", views.chat_url),
    path("groups/", views.groups),
    path("send-group/", views.send_group),
    path("summary/", views.summary_preview),
]
