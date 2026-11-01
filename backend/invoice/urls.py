from django.urls import path

from . import views

urlpatterns = [
    path("dashboard/", views.dashboard_summary, name="dashboard-summary"),
    path("charts/", views.chart_data, name="chart-data"),
    path("expenses/", views.expense_list, name="expense-list"),
    path("expenses/<int:expense_id>/", views.expense_detail, name="expense-detail"),
    path("journal/", views.journal, name="journal"),
    path("financial_summary/", views.financial_summary, name="financial-summary"),
]
