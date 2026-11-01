"""The owner's choices of 2026-10-22: a cash box may go negative but the app warns; staff do not see
cost prices or profit."""
from urllib.parse import unquote

from rest_framework.test import APIClient

from .tests import Base, D


class OwnerChoiceTests(Base):
    def setUp(self):
        super().setUp()
        self.client.put("/api/system/features/", {"money_boxes": True}, format="json")
        self.staff_client = self.login(self.staff, APIClient())

    def test_money_out_of_an_empty_box_is_allowed_with_a_warning(self):
        res = self.client.post("/api/invoice/expenses/", {"type": "EXPENSE", "category": "RENT",
                                                          "description": "rent", "amount": "50"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertIn("صندوق الدولار", unquote(res["X-Box-Warning"]))
        # money coming in never warns
        res = self.client.post("/api/invoice/expenses/", {"type": "INCOME", "category": "OTHER_INCOME",
                                                          "description": "in", "amount": "10"}, format="json")
        self.assertFalse(res.has_header("X-Box-Warning"))

    def test_staff_do_not_see_cost_or_profit(self):
        p = self.product(cost="100", price="150", stock=5)
        self.assertNotIn("unit_cost", self.staff_client.get(f"/api/inventory/products/{p.id}/").data)
        self.assertIn("unit_cost", self.client.get(f"/api/inventory/products/{p.id}/").data)
        # staff edits cannot change the cost they cannot see
        self.staff_client.put(f"/api/inventory/products/{p.id}/", {"unit_cost": "1", "name": "Panel 2"}, format="json")
        p.refresh_from_db()
        self.assertEqual(p.unit_cost, D("100"))
        self.assertEqual(p.name, "Panel 2")
        summary = self.staff_client.get("/api/reports/financials/?period=monthly").data
        self.assertNotIn("net_profit", summary)
        self.assertIn("total_revenue", summary)
        self.assertNotIn("total_profit", self.staff_client.get("/api/reports/dashboard/summary/").data)
        self.assertEqual(self.staff_client.get("/api/invoice/charts/").status_code, 403)
        self.assertIn("net_profit", self.client.get("/api/reports/financials/?period=monthly").data)
