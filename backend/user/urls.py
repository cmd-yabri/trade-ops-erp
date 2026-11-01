from django.urls import path

from . import views

urlpatterns = [
    path("", views.login, name="login"),
    path("setup-status/", views.setup_status),
    path("signup/", views.signup, name="signup"),
    path("me/", views.get_user_info),
    path("getuserinfo/", views.get_user_info, name="getinfo"),
    path("change-password/", views.change_password),
    path("users/", views.users_list),
    path("users/<uuid:pk>/", views.user_detail),
    path("recovery/challenge/", views.recovery_challenge),
    path("recovery/reset/", views.recovery_reset),
]
