from django.urls import path

from .views import (
    dashboard_summary,
    financial_reports,
    monthly_financial_report,
    quarterly_financial_report,
    weekly_financial_report,
    yearly_financial_report,
)

urlpatterns = [
    path("dashboard/summary/", dashboard_summary),
    path("financials/weekly/", weekly_financial_report),
    path("financials/monthly/", monthly_financial_report),
    path("financials/quarterly/", quarterly_financial_report),
    path("financials/yearly/", yearly_financial_report),
    path("financials/", financial_reports),
]
