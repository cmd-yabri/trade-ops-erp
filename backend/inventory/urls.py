from django.urls import path
from . import views

urlpatterns = [
    path('categories/', views.category_list, name='category-list'),
    path('products/', views.product_list, name='product-list'),
    path('products/<int:pk>/', views.product_detail, name='product-detail'),
    path('products/<int:pk>/movements/', views.product_movements),
    path('opening/', views.opening_list),
    path('opening/<int:pk>/link/', views.opening_link),
    path('opening/<int:pk>/pay/', views.opening_pay),
]