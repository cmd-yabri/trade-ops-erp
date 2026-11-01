"""Price offers: no inventory effect; accepting creates a new sales order; strict state rules."""
from datetime import date, timedelta

from rest_framework.test import APIClient

from invoice import services as finance
from order.models import SalesOrder

from .tests import Base, D


class OfferTests(Base):
    def offer(self, product, qty=2, price="150", **extra):
        body = {"client_name": "Ali", "client_phone": "0944", "discount": "10",
                "items": [{"product": product.id, "quantity": qty, "unit_price": price}],
                "jobs": [{"job_type": "INSTALL", "contractor_name": "Fani", "cost_to_company": "20", "charge_to_client": "50"}],
                **extra}
        res = self.client.post("/api/offers/", body, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.data

    def test_offer_never_touches_stock_or_books(self):
        p = self.product(stock=10, cost="100", price="150")
        o = self.offer(p, qty=3)
        self.assertEqual(self.stock(p), D("10"))
        self.assertEqual(D(o["grand_total"]), D("490"))  # 450 + 50 - 10
        self.assertEqual(D(o["profit"]), D("490") - D("300") - D("20"))
        self.assertEqual(finance.totals()["total_revenue"], D("0"))
        self.assertEqual(self.client.put(f"/api/offers/{o['id']}/", {"notes": "x"}, format="json").status_code, 200)
        self.assertEqual(self.stock(p), D("10"))

    def test_accept_creates_a_new_unfinalized_sales_order(self):
        p = self.product(stock=10, cost="100", price="150")
        o = self.offer(p, qty=3)
        res = self.client.post(f"/api/offers/{o['id']}/accept/")
        self.assertEqual(res.status_code, 201, res.content)
        so = SalesOrder.objects.get(pk=res.data["sales_order"]["id"])
        self.assertFalse(so.is_finalized)
        self.assertEqual(so.grand_total, D("490"))
        self.assertEqual(so.client_name, "Ali")
        self.assertEqual([(i.product_id, i.quantity, i.unit_price) for i in so.items.all()], [(p.id, D("3"), D("150"))])
        self.assertEqual(so.freelance_jobs.count(), 1)
        self.assertEqual(res.data["sales_order"]["from_offer"], o["id"])
        self.assertEqual(self.stock(p), D("10"))  # still nothing deducted
        self.assertEqual(self.client.post(f"/api/orders/sales/{so.id}/finalize/").status_code, 200)
        self.assertEqual(self.stock(p), D("7"))   # only the normal finalize moves stock
        got = self.client.get(f"/api/offers/{o['id']}/").data
        self.assertEqual((got["status"], got["sales_order"]), ("ACCEPTED", so.id))

    def test_accept_only_once_and_accepted_is_frozen(self):
        p = self.product(stock=10)
        o = self.offer(p)
        self.assertEqual(self.client.post(f"/api/offers/{o['id']}/accept/").status_code, 201)
        for url in (f"/api/offers/{o['id']}/accept/", f"/api/offers/{o['id']}/reject/"):
            self.assertEqual(self.client.post(url).status_code, 400, url)
        self.assertEqual(self.client.put(f"/api/offers/{o['id']}/", {"client_name": "Z"}, format="json").status_code, 400)
        self.assertEqual(self.client.delete(f"/api/offers/{o['id']}/").status_code, 409)
        self.assertEqual(SalesOrder.objects.count(), 1)

    def test_reject_reopen_and_delete(self):
        p = self.product(stock=10)
        o = self.offer(p)
        self.assertEqual(self.client.post(f"/api/offers/{o['id']}/reject/").status_code, 200)
        self.assertEqual(self.client.post(f"/api/offers/{o['id']}/accept/").status_code, 400)
        self.assertEqual(self.client.put(f"/api/offers/{o['id']}/", {"notes": "n"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(f"/api/offers/{o['id']}/reopen/").status_code, 200)
        self.assertEqual(self.client.post(f"/api/offers/{o['id']}/reopen/").status_code, 400)
        self.assertEqual(self.client.post(f"/api/offers/{o['id']}/accept/").status_code, 201)
        o2 = self.offer(p)
        self.assertEqual(self.client.delete(f"/api/offers/{o2['id']}/").status_code, 204)

    def test_expired_offer_cannot_be_accepted_until_extended(self):
        p = self.product(stock=10)
        o = self.offer(p, valid_until=(date.today() - timedelta(days=1)).isoformat())
        self.assertTrue(self.client.get(f"/api/offers/{o['id']}/").data["is_expired"])
        self.assertEqual(self.client.post(f"/api/offers/{o['id']}/accept/").status_code, 400)
        self.client.put(f"/api/offers/{o['id']}/", {"valid_until": (date.today() + timedelta(days=5)).isoformat()}, format="json")
        self.assertEqual(self.client.post(f"/api/offers/{o['id']}/accept/").status_code, 201)

    def test_offer_can_exceed_stock_but_the_order_cannot_be_finalized(self):
        p = self.product(stock=2)
        o = self.offer(p, qty=5)  # quoting more than we have is fine
        so = self.client.post(f"/api/offers/{o['id']}/accept/").data["sales_order"]["id"]
        self.assertEqual(self.client.post(f"/api/orders/sales/{so}/finalize/").status_code, 400)
        self.assertEqual(self.stock(p), D("2"))

    def test_validation(self):
        p = self.product(stock=10)
        base = {"client_name": "A", "items": [{"product": p.id, "quantity": 1, "unit_price": "10"}]}
        bad = [
            {**base, "client_name": " "},
            {**base, "items": []},
            {"client_name": "A"},
            {**base, "discount": "999"},
            {**base, "items": [{"product": p.id, "quantity": "1.5", "unit_price": "10"}]},  # whole-number product
            {**base, "items": [{"product": p.id, "quantity": 0, "unit_price": "10"}]},
            {**base, "items": [{"product": p.id, "quantity": 1, "unit_price": "-1"}]},
            {**base, "items": [{"product": 99999, "quantity": 1, "unit_price": "1"}]},
            {**base, "jobs": [{"job_type": "", "charge_to_client": "5"}]},
            {**base, "account": 99999},
            {**base, "car": 1},
            {**base, "valid_until": "nope"},
        ]
        for body in bad:
            res = self.client.post("/api/offers/", body, format="json")
            self.assertIn(res.status_code, (400, 403), (res.status_code, body))
        for body in ([], "x", 5, {"items": [None]}):
            self.assertLess(self.client.post("/api/offers/", body, format="json").status_code, 500)

    def test_decimal_product_and_staff_rules(self):
        cable = self.product("Cable", stock=0, cost="2")
        cable.allow_decimal = True
        cable.save()
        o = self.offer(cable, qty="3.5", price="5")
        self.assertEqual(self.client.post(f"/api/offers/{o['id']}/accept/").status_code, 201)
        staff = self.login(self.staff, APIClient())
        row = staff.get("/api/offers/").data[0]
        self.assertNotIn("profit", row)
        self.assertNotIn("cost_total", row)
        o2 = self.offer(self.product(stock=3))
        self.assertEqual(staff.post(f"/api/offers/{o2['id']}/accept/").status_code, 201)  # staff may sell
        o3 = self.offer(self.product("P3", stock=3))
        self.assertEqual(staff.delete(f"/api/offers/{o3['id']}/").status_code, 403)  # but not delete
        self.assertEqual(APIClient().get("/api/offers/").status_code, 401)

    def test_account_branch_and_car_carry_over(self):
        self.client.put("/api/system/features/", {"accounts": True, "branches": True, "cars": True}, format="json")
        acc = self.client.post("/api/accounts/", {"name": "W"}, format="json").data["id"]
        b2 = self.client.post("/api/locations/branches/", {"name": "B2"}, format="json").data["id"]
        car = self.client.post("/api/locations/cars/", {"name": "C"}, format="json").data["id"]
        p = self.product(stock=5)
        o = self.offer(p, account=acc, branch=b2, car=car)
        so = SalesOrder.objects.get(pk=self.client.post(f"/api/offers/{o['id']}/accept/").data["sales_order"]["id"])
        self.assertEqual((so.account_id, so.branch_id, so.car_id), (acc, b2, car))
        self.assertEqual(len(self.client.get(f"/api/offers/?branch={b2}").data), 1)
        self.assertEqual(len(self.client.get("/api/offers/?branch=abc").data), 1)

    def test_second_accept_is_refused(self):
        p = self.product(stock=5)
        o = self.offer(p)
        first = self.client.post(f"/api/offers/{o['id']}/accept/")
        second = self.client.post(f"/api/offers/{o['id']}/accept/")
        self.assertEqual((first.status_code, second.status_code), (201, 400))
        self.assertEqual(SalesOrder.objects.count(), 1)
