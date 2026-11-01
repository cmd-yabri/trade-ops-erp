"""Try to break it: bad input, edge values, wrong roles, features toggled mid-flight.

Rule for every probe: the API must answer with a clean 4xx (or succeed correctly), never a 500.
"""
from decimal import Decimal

from rest_framework.test import APIClient

from inventory.models import Product
from order.models import SalesOrder

from .tests import Base, D


class Probe(Base):
    def setUp(self):
        super().setUp()
        self.client.put("/api/system/features/", {k: True for k in (
            "branches", "cars", "money_boxes", "accounts", "partners")}, format="json")
        self.fails = []

    def hit(self, method, url, body=None, ok=(200, 201, 204), client=None):
        c = client or self.client
        res = getattr(c, method)(url, body, format="json") if body is not None else getattr(c, method)(url)
        if res.status_code >= 500:
            self.fails.append(f"500 {method.upper()} {url} {body}")
        return res

    def must_reject(self, method, url, body, client=None):
        res = self.hit(method, url, body, client=client)
        if not 400 <= res.status_code < 500:
            self.fails.append(f"accepted bad input ({res.status_code}) {method.upper()} {url} {body}")
        return res

    def finish(self):
        self.assertEqual(self.fails, [], "\n" + "\n".join(self.fails))

    # ---------------------------------------------------------------- numbers
    def test_absurd_numbers_everywhere(self):
        p = self.product(stock=10, price="10")
        oid = self.order(p, qty=1, price="10")
        big = ["1e30", "99999999999999999999", "-5", "abc", "", None, "1.2345678", "NaN", "Infinity"]
        for v in big:
            self.must_reject("post", "/api/inventory/products/", {"name": "X", "unit_cost": v})
            self.must_reject("post", "/api/inventory/products/", {"name": "X", "unit_cost": "1", "current_stock": v})
            self.must_reject("post", "/api/orders/sales/", {"client_name": "A", "items": [{"product": p.id, "quantity": v, "unit_price": "1"}]})
            self.must_reject("post", "/api/orders/sales/", {"client_name": "A", "items": [{"product": p.id, "quantity": "0", "unit_price": "1"}]})
            self.must_reject("post", "/api/orders/sales/", {"client_name": "A", "items": [{"product": p.id, "quantity": 1, "unit_price": v}]})
            self.must_reject("post", "/api/purchases/po/", {"supplier": "S", "items": [{"product": p.id, "quantity": v, "unit_cost": "1"}]})
            self.must_reject("post", f"/api/orders/sales/{oid}/payments/", {"amount": v})
            self.must_reject("post", "/api/invoice/expenses/", {"type": "EXPENSE", "category": "RENT", "description": "x", "amount": v})
            self.must_reject("post", "/api/cashbox/entries/", {"currency": "USD", "kind": "DEPOSIT", "amount": v})
        self.finish()

    def test_syp_rate_extremes(self):
        p = self.product(stock=10)
        oid = self.order(p, qty=1, price="100")
        for rate in ["0", "-1", "0.0000001", "abc", "1e30", None]:
            self.must_reject("post", f"/api/orders/sales/{oid}/payments/", {"currency": "SYP", "paid_amount": "1000", "exchange_rate": rate})
        for paid in ["0", "-5", "abc", "1e30", None]:
            self.must_reject("post", f"/api/orders/sales/{oid}/payments/", {"currency": "SYP", "paid_amount": paid, "exchange_rate": "15000"})
        self.must_reject("post", f"/api/orders/sales/{oid}/payments/", {"currency": "EUR", "paid_amount": "5", "exchange_rate": "2"})
        self.must_reject("post", "/api/cashbox/exchanges/", {"from_currency": "USD", "from_amount": "1", "rate": "99999999999"})
        self.must_reject("post", "/api/cashbox/exchanges/", {"from_currency": "EUR", "from_amount": "1", "rate": "1"})
        self.finish()

    # ------------------------------------------------------------ malformed JSON shapes
    def test_wrong_shapes(self):
        for url in ["/api/inventory/products/", "/api/orders/sales/", "/api/purchases/po/", "/api/invoice/expenses/",
                    "/api/accounts/", "/api/partners/", "/api/locations/branches/", "/api/locations/cars/",
                    "/api/locations/transfers/", "/api/cashbox/entries/", "/api/cashbox/exchanges/",
                    "/api/partners/withdrawals/", "/api/whatsapp/send/", "/api/system/features/"]:
            for body in ([], "text", 5, {"items": "x"}, {"items": [1, 2]}, {"items": [None]}):
                res = self.hit("post", url, body)
                self.assertLess(res.status_code, 500, (url, body))
        self.finish()

    # ---------------------------------------------------------------- stock & locations
    def test_transfer_and_stock_abuse(self):
        p = self.product(stock=10)
        car = self.client.post("/api/locations/cars/", {"name": "C"}, format="json").data["id"]
        main = [b for b in self.client.get("/api/locations/branches/").data if b["is_default"]][0]["id"]
        for body in [
            {"product": p.id, "quantity": 1, "to_car": 99999},
            {"product": p.id, "quantity": 1, "from_car": 99999, "to_branch": main},
            {"product": p.id, "quantity": 1, "to_branch": 99999},
            {"product": 99999, "quantity": 1, "to_car": car},
            {"product": p.id, "quantity": -1, "to_car": car},
            {"product": p.id, "quantity": 0, "to_car": car},
            {"product": p.id, "quantity": 1000, "to_car": car},
            {"product": p.id, "quantity": 1, "from_branch": main, "to_branch": main},
            {"product": p.id, "quantity": 1, "from_car": car, "to_car": car},
            {"product": p.id, "quantity": "1.5", "to_car": car},   # whole-number product
            {"product": p.id, "quantity": 1, "from_branch": main, "from_car": car, "to_car": car},
        ]:
            self.must_reject("post", "/api/locations/transfers/", body)
        # total never changes by failed transfers
        p.refresh_from_db()
        self.assertEqual(p.current_stock, D("10"))
        self.finish()

    def test_stock_is_conserved_through_a_messy_lifecycle(self):
        p = self.product(stock=20, cost="10", price="30")
        car = self.client.post("/api/locations/cars/", {"name": "C"}, format="json").data["id"]
        b2 = self.client.post("/api/locations/branches/", {"name": "B2"}, format="json").data["id"]
        self.client.post("/api/locations/transfers/", {"product": p.id, "quantity": 6, "to_car": car}, format="json")
        self.client.post("/api/locations/transfers/", {"product": p.id, "quantity": 4, "to_branch": b2}, format="json")
        o1 = self.client.post("/api/orders/sales/", {"client_name": "a", "car": car, "items": [{"product": p.id, "quantity": 5, "unit_price": "30"}]}, format="json").data["id"]
        o2 = self.client.post("/api/orders/sales/", {"client_name": "b", "branch": b2, "items": [{"product": p.id, "quantity": 4, "unit_price": "30"}]}, format="json").data["id"]
        for o in (o1, o2):
            self.assertEqual(self.client.post(f"/api/orders/sales/{o}/finalize/").status_code, 200)
        self.assertEqual(self.client.post(f"/api/orders/sales/{o1}/finalize/").status_code, 400)  # twice
        self.assertEqual(self.client.delete(f"/api/orders/sales/{o1}/").status_code, 204)          # restores to the car
        total = sum(Decimal(str(r["quantity"])) for r in self.client.get(f"/api/inventory/products/{p.id}/").data["stock_by_location"])
        p.refresh_from_db()
        self.assertEqual(total, p.current_stock)
        self.assertEqual(p.current_stock, D("16"))  # 20 - 4 (o2 stays sold)
        # only an admin may re-point or edit a finalized order
        staff = self.login(self.staff, APIClient())
        self.assertEqual(staff.put(f"/api/orders/sales/{o2}/", {"car": car}, format="json").status_code, 403)
        self.assertEqual(staff.put(f"/api/orders/sales/{o2}/", {"discount": "1"}, format="json").status_code, 403)
        self.finish()

    def test_deleting_things_that_are_in_use(self):
        p = self.product(stock=5)
        car = self.client.post("/api/locations/cars/", {"name": "C"}, format="json").data["id"]
        b2 = self.client.post("/api/locations/branches/", {"name": "B2"}, format="json").data["id"]
        self.client.post("/api/orders/sales/", {"client_name": "a", "car": car, "branch": b2, "items": [{"product": p.id, "quantity": 1, "unit_price": "1"}]}, format="json")
        for url in (f"/api/locations/cars/{car}/", f"/api/locations/branches/{b2}/"):
            self.must_reject("delete", url, None) if False else None
            res = self.hit("delete", url)
            self.assertIn(res.status_code, (409, 400), url)
        main = [b for b in self.client.get("/api/locations/branches/").data if b["is_default"]][0]["id"]
        self.assertEqual(self.hit("delete", f"/api/locations/branches/{main}/").status_code, 409)
        self.assertEqual(self.hit("delete", "/api/locations/branches/99999/").status_code, 404)
        self.assertEqual(self.hit("get", "/api/locations/cars/99999/").status_code, 404)
        self.finish()

    def test_product_edit_stock_correction_and_toggle(self):
        p = self.product(stock=3)
        self.must_reject("put", f"/api/inventory/products/{p.id}/", {"current_stock": "-1"})
        self.must_reject("put", f"/api/inventory/products/{p.id}/", {"current_stock": "2.5"})
        self.must_reject("put", f"/api/inventory/products/{p.id}/", {"branch": 99999, "current_stock": 5})
        self.must_reject("put", f"/api/inventory/products/{p.id}/", {"allow_decimal": True, "current_stock": "2.5"})  # no reason
        res = self.hit("put", f"/api/inventory/products/{p.id}/", {"allow_decimal": True, "current_stock": "2.5",
                                                                   "stock_reason": "جرد"})
        self.assertEqual(res.status_code, 200, res.content)
        p.refresh_from_db()
        self.assertEqual(p.current_stock, D("2.5"))
        # a very long name / unit
        self.must_reject("post", "/api/inventory/products/", {"name": "x" * 500, "unit_cost": "1"})
        self.must_reject("put", f"/api/inventory/products/{p.id}/", {"unit": "u" * 100})
        self.finish()

    # ---------------------------------------------------------------- accounts
    def test_account_abuse(self):
        for v in ["abc", "1e30", "NaN", "--5"]:
            self.must_reject("post", "/api/accounts/", {"name": f"A{v}", "opening_balance": v})
        acc = self.client.post("/api/accounts/", {"name": "Ok"}, format="json").data["id"]
        self.must_reject("post", f"/api/accounts/{acc}/payments/", {"direction": "SIDEWAYS", "amount": "5"})
        self.must_reject("post", f"/api/accounts/{acc}/payments/", {"direction": "IN", "amount": "-5"})
        self.must_reject("post", f"/api/accounts/{acc}/entries/", {"kind": "DEBIT", "amount": "0"})
        self.must_reject("post", f"/api/accounts/{acc}/entries/", {"kind": "WAT", "amount": "5"})
        self.assertEqual(self.hit("get", "/api/accounts/99999/").status_code, 404)
        self.must_reject("post", "/api/accounts/", {"name": "NoType", "is_customer": False, "is_supplier": False})
        # an order pointing at a non-existent account
        p = self.product(stock=5)
        self.must_reject("post", "/api/orders/sales/", {"client_name": "a", "account": 99999, "items": [{"product": p.id, "quantity": 1, "unit_price": "1"}]})
        self.must_reject("post", "/api/purchases/po/", {"supplier": "s", "account": 99999, "items": [{"product": p.id, "quantity": 1, "unit_cost": "1"}]})
        self.finish()

    def test_payment_to_account_is_conserved_with_many_orders_and_rounding(self):
        acc = self.client.post("/api/accounts/", {"name": "Rnd"}, format="json").data["id"]
        p = self.product(stock=100, cost="1", price="3.33")
        ids = []
        for _ in range(3):
            o = self.client.post("/api/orders/sales/", {"client_name": "Rnd", "account": acc, "items": [{"product": p.id, "quantity": 3, "unit_price": "3.33"}]}, format="json").data["id"]
            self.client.post(f"/api/orders/sales/{o}/finalize/")
            ids.append(o)  # 9.99 each = 29.97
        res = self.client.post(f"/api/accounts/{acc}/payments/", {"direction": "IN", "currency": "SYP", "paid_amount": "100000", "exchange_rate": "7777"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        paid = sum(SalesOrder.objects.get(pk=i).total_paid for i in ids)
        usd = (Decimal("100000") / Decimal("7777")).quantize(Decimal("0.01"))
        self.assertEqual(paid, usd)  # nothing lost or invented while splitting
        boxes = {r["currency"]: D(r["balance"]) for r in self.client.get("/api/cashbox/boxes/").data}
        self.assertEqual(boxes["SYP"], D("100000"))  # the cash shows up exactly once
        self.finish()

    # ---------------------------------------------------------------- partners
    def test_partner_abuse(self):
        for pct in ["101", "-1", "abc", "1e9"]:
            self.must_reject("post", "/api/partners/", {"name": "P", "share_percent": pct})
        self.must_reject("post", "/api/partners/", {"name": "  ", "share_percent": "10"})
        a = self.client.post("/api/partners/", {"name": "A", "share_percent": "100"}, format="json").data["id"]
        self.must_reject("post", "/api/partners/withdrawals/", {"partner": a, "amount": "-1"})
        self.must_reject("post", "/api/partners/withdrawals/", {"partner": 99999, "amount": "1"})
        self.must_reject("post", "/api/partners/withdrawals/", {"partner": a, "amount": "1", "date": "not-a-date"})
        self.must_reject("post", "/api/partners/settlements/", {"end": "nope"})
        self.assertEqual(self.hit("get", "/api/partners/settlement/preview/?end=garbage").status_code, 400)
        # a period with no activity: allowed or refused, but never a crash, and never twice for the same days
        first = self.hit("post", "/api/partners/settlements/", {})
        second = self.hit("post", "/api/partners/settlements/", {})
        self.assertNotEqual(second.status_code, 201, "closing the same empty period twice must not succeed")
        self.assertEqual(self.hit("delete", "/api/partners/99999/").status_code, 404)
        self.finish()

    def test_settlement_with_loss_and_rounding_thirds(self):
        for n in ("A", "B", "C"):
            self.client.post("/api/partners/", {"name": n, "share_percent": "33.33"}, format="json")
        self.client.post("/api/partners/", {"name": "D", "share_percent": "0.01"}, format="json")
        p = self.product(stock=5, cost="100", price="1")
        o = self.order(p, qty=1, price="1")
        self.client.post(f"/api/orders/sales/{o}/finalize/")  # revenue 1, cost 100 -> loss 99
        from .test_features import backdate
        backdate(o)
        res = self.hit("post", "/api/partners/settlements/", {})
        self.assertEqual(res.status_code, 201, res.content)
        s = self.client.get("/api/partners/settlements/").data[0]
        self.assertEqual(D(s["net_profit"]), D("-99"))
        self.assertTrue(all(D(l["share_amount"]) < 0 for l in s["lines"]))
        self.finish()

    # ---------------------------------------------------------------- permissions
    def test_staff_cannot_do_admin_things(self):
        staff = self.login(self.staff, APIClient())
        p = self.product(stock=5)
        oid = self.order(p, qty=1)
        acc = self.client.post("/api/accounts/", {"name": "S"}, format="json").data["id"]
        for method, url, body in [
            ("post", "/api/locations/branches/", {"name": "x"}),
            ("delete", f"/api/orders/sales/{oid}/", None),
            ("delete", f"/api/accounts/{acc}/", None),
            ("post", f"/api/accounts/{acc}/entries/", {"kind": "DEBIT", "amount": "5"}),
            ("get", "/api/cashbox/boxes/", None),
            ("post", "/api/cashbox/entries/", {"currency": "USD", "kind": "DEPOSIT", "amount": "5"}),
            ("get", "/api/partners/", None),
            ("post", "/api/partners/settlements/", {}),
            ("post", "/api/whatsapp/connect/", {}),
            ("put", "/api/system/features/", {"cars": False}),
            ("get", "/api/user/users/", None),
        ]:
            res = self.hit(method, url, body, client=staff)
            self.assertEqual(res.status_code, 403, (method, url, res.status_code))
        # staff sells but never sees profit / cost
        res = staff.get(f"/api/orders/sales/{oid}/").data
        self.assertNotIn("profit", res)
        self.assertNotIn("cost_total", res)
        self.finish()

    def test_anonymous_gets_nothing(self):
        anon = APIClient()
        for url in ["/api/locations/branches/", "/api/locations/cars/", "/api/cashbox/boxes/", "/api/accounts/",
                    "/api/partners/", "/api/whatsapp/status/", "/api/system/features/"]:
            self.assertEqual(anon.get(url).status_code, 401, url)

    # ---------------------------------------------------------------- toggling features mid-flight
    def test_turning_features_off_keeps_data_and_blocks_new_use(self):
        p = self.product(stock=10, price="100")
        car = self.client.post("/api/locations/cars/", {"name": "C"}, format="json").data["id"]
        self.client.post("/api/locations/transfers/", {"product": p.id, "quantity": 5, "to_car": car}, format="json")
        oid = self.client.post("/api/orders/sales/", {"client_name": "a", "car": car, "items": [{"product": p.id, "quantity": 2, "unit_price": "100"}]}, format="json").data["id"]
        self.client.post(f"/api/orders/sales/{oid}/payments/", {"currency": "SYP", "paid_amount": "1500000", "exchange_rate": "15000"}, format="json")
        self.client.put("/api/system/features/", {"cars": False, "money_boxes": False}, format="json")
        # existing order still finalizes from the car, SYP payment history is intact, USD still works
        self.assertEqual(self.client.post(f"/api/orders/sales/{oid}/finalize/").status_code, 200)
        self.assertEqual(SalesOrder.objects.get(pk=oid).total_paid, D("100"))
        self.hit("get", "/api/orders/sales/")
        # but no NEW car / SYP use
        self.must_reject("post", "/api/orders/sales/", {"client_name": "b", "car": car, "items": [{"product": p.id, "quantity": 1, "unit_price": "1"}]})
        self.assertEqual(self.client.post(f"/api/orders/sales/{oid}/payments/", {"currency": "SYP", "paid_amount": "10", "exchange_rate": "1"}, format="json").status_code, 403)
        self.assertEqual(self.client.post(f"/api/orders/sales/{oid}/payments/", {"amount": "50"}, format="json").status_code, 201)
        # flip back on: boxes remember everything
        self.client.put("/api/system/features/", {"money_boxes": True}, format="json")
        boxes = {r["currency"]: D(r["balance"]) for r in self.client.get("/api/cashbox/boxes/").data}
        self.assertEqual(boxes["SYP"], D("1500000"))
        self.assertEqual(boxes["USD"], D("50"))
        self.finish()

    # ---------------------------------------------------------------- purchases
    def test_purchase_edge_cases(self):
        p = self.product(stock=0, cost="10")
        po = self.client.post("/api/purchases/po/", {"supplier": "S", "items": [{"product": p.id, "quantity": 3, "unit_cost": "10"}]}, format="json").data["id"]
        self.must_reject("post", f"/api/purchases/po/{po}/add-payment/", {"amount": "30.01"})
        self.assertEqual(self.client.post(f"/api/purchases/po/{po}/add-payment/", {"amount": "30"}, format="json").status_code, 201)
        self.must_reject("post", f"/api/purchases/po/{po}/add-payment/", {"amount": "0.01"})
        self.client.post(f"/api/purchases/po/{po}/receive/")
        self.must_reject("post", f"/api/purchases/po/{po}/receive/", {})
        self.must_reject("post", f"/api/purchases/po/{po}/cancel/", {})
        staff = self.login(self.staff, APIClient())
        self.assertEqual(staff.put(f"/api/purchases/po/{po}/", {"supplier": "new"}, format="json").status_code, 403)
        self.assertEqual(self.hit("delete", f"/api/purchases/po/{po}/").status_code, 400)
        cancelled = self.client.post("/api/purchases/po/", {"supplier": "S", "items": [{"product": p.id, "quantity": 1, "unit_cost": "1"}]}, format="json").data["id"]
        self.client.post(f"/api/purchases/po/{cancelled}/cancel/")
        self.must_reject("post", f"/api/purchases/po/{cancelled}/add-payment/", {"amount": "1"})
        self.must_reject("post", f"/api/purchases/po/{cancelled}/receive/", {})
        # discount bigger than total, empty items
        self.must_reject("post", "/api/purchases/po/", {"supplier": "S", "discount": "999", "items": [{"product": p.id, "quantity": 1, "unit_cost": "1"}]})
        self.must_reject("post", "/api/purchases/po/", {"supplier": "S", "items": []})
        self.finish()

    # ---------------------------------------------------------------- money consistency
    def test_money_adds_up_after_a_chaotic_day(self):
        p = self.product(stock=50, cost="10", price="25")
        self.client.post("/api/cashbox/entries/", {"currency": "USD", "kind": "DEPOSIT", "amount": "500"}, format="json")
        self.client.post("/api/cashbox/entries/", {"currency": "SYP", "kind": "DEPOSIT", "amount": "2000000"}, format="json")
        o = self.order(p, qty=4, price="25")
        self.client.post(f"/api/orders/sales/{o}/finalize/")
        self.client.post(f"/api/orders/sales/{o}/payments/", {"amount": "40"}, format="json")
        self.client.post(f"/api/orders/sales/{o}/payments/", {"currency": "SYP", "paid_amount": "300000", "exchange_rate": "10000"}, format="json")  # 30 USD
        self.client.post("/api/invoice/expenses/", {"type": "EXPENSE", "category": "RENT", "description": "r", "amount": "20"}, format="json")
        self.client.post("/api/cashbox/exchanges/", {"from_currency": "SYP", "from_amount": "500000", "rate": "10000"}, format="json")  # +50 USD
        self.client.post("/api/cashbox/exchanges/", {"from_currency": "USD", "from_amount": "10", "rate": "10000"}, format="json")    # -10 USD, +100000 SYP
        boxes = {r["currency"]: D(r["balance"]) for r in self.client.get("/api/cashbox/boxes/").data}
        self.assertEqual(boxes["USD"], D("500") + 40 - 20 + 50 - 10 + (D("0")))  # = 560
        self.assertEqual(boxes["SYP"], D("2000000") + 300000 - 500000 + 100000)
        order = SalesOrder.objects.get(pk=o)
        self.assertEqual(order.total_paid, D("70"))
        self.assertEqual(order.remaining, D("30"))
        # statement running balance ends at the box balance
        st = self.client.get("/api/cashbox/statement/?currency=USD").data
        self.assertEqual(D(st[0]["balance"]), boxes["USD"])
        self.finish()

    def test_branch_filter_params_do_not_crash(self):
        for q in ["?branch=abc", "?branch=", "?branch=-1", "?branch=99999", "?branch=1;drop"]:
            for url in ["/api/orders/sales/", "/api/purchases/po/", "/api/invoice/expenses/", "/api/invoice/dashboard/",
                        "/api/invoice/charts/", "/api/invoice/financial_summary/", "/api/reports/financials/",
                        "/api/reports/dashboard/summary/", "/api/cashbox/boxes/", "/api/cashbox/statement/"]:
                self.hit("get", url + q)
        self.finish()

    def test_closed_period_is_locked_against_changes_and_future_close(self):
        from datetime import date, timedelta

        from .test_features import backdate

        self.client.post("/api/partners/", {"name": "A", "share_percent": "100"}, format="json")
        p = self.product(stock=5, cost="10", price="100")
        o = self.order(p, qty=1, price="100")
        self.client.post(f"/api/orders/sales/{o}/finalize/")
        backdate(o, days=10)
        today = date.today()
        # cannot close a period that has not ended
        self.must_reject("post", "/api/partners/settlements/", {"end": today.isoformat()})
        self.must_reject("post", "/api/partners/settlements/", {"end": (today + timedelta(days=3)).isoformat()})
        res = self.hit("post", "/api/partners/settlements/", {"end": (today - timedelta(days=5)).isoformat()})
        self.assertEqual(res.status_code, 201, res.content)
        # nothing may rewrite the closed days
        old = (today - timedelta(days=7)).isoformat()
        self.must_reject("post", "/api/invoice/expenses/", {"type": "EXPENSE", "category": "RENT", "description": "late", "amount": "5", "date": old})
        self.must_reject("delete", f"/api/orders/sales/{o}/", None)
        # but today is open: a sale or expense made now is fine and lands in the next period
        self.assertEqual(self.client.post("/api/invoice/expenses/", {"type": "EXPENSE", "category": "RENT", "description": "now", "amount": "5"}, format="json").status_code, 201)
        # undoing the close unlocks them again
        sid = self.client.get("/api/partners/settlements/").data[0]["id"]
        self.assertEqual(self.client.delete(f"/api/partners/settlements/{sid}/").status_code, 204)
        self.assertEqual(self.client.post("/api/invoice/expenses/", {"type": "EXPENSE", "category": "RENT", "description": "late", "amount": "5", "date": old}, format="json").status_code, 201)
        self.finish()

    # ------------------------------------------------- found in the 2026-10-20 live test
    def test_unknown_currency_is_rejected_everywhere(self):
        p = self.product(stock=10)
        oid = self.order(p, qty=1, price="100")
        self.client.post(f"/api/orders/sales/{oid}/finalize/")
        po = self.client.post("/api/purchases/po/", {"supplier": "S", "items": [{"product": p.id, "quantity": 1, "unit_cost": "5"}]}, format="json").data["id"]
        partner = self.client.post("/api/partners/", {"name": "P", "share_percent": "100"}, format="json").data["id"]
        for cur in ["EUR", "usd", "XXX", ""]:
            self.must_reject("post", f"/api/orders/sales/{oid}/payments/", {"currency": cur, "amount": "10"}) if cur else None
            self.must_reject("post", f"/api/purchases/po/{po}/add-payment/", {"currency": cur, "amount": "1"}) if cur else None
            self.must_reject("post", "/api/invoice/expenses/", {"type": "EXPENSE", "category": "RENT", "description": "x", "amount": "1", "currency": cur}) if cur else None
            self.must_reject("post", "/api/partners/withdrawals/", {"partner": partner, "amount": "1", "currency": cur}) if cur else None
        self.assertEqual(SalesOrder.objects.get(pk=oid).total_paid, 0)
        self.finish()

    def test_account_type_must_match_the_document(self):
        p = self.product(stock=10)
        customer = self.client.post("/api/accounts/", {"name": "Cust", "is_customer": True}, format="json").data["id"]
        supplier = self.client.post("/api/accounts/", {"name": "Sup", "is_customer": False, "is_supplier": True}, format="json").data["id"]
        item = [{"product": p.id, "quantity": 1, "unit_price": "1"}]
        self.must_reject("post", "/api/purchases/po/", {"supplier": "x", "account": customer, "items": [{"product": p.id, "quantity": 1, "unit_cost": "1"}]})
        self.must_reject("post", "/api/orders/sales/", {"client_name": "x", "account": supplier, "items": item})
        self.must_reject("post", "/api/offers/", {"client_name": "x", "account": supplier, "items": item})
        self.assertEqual(self.hit("post", "/api/purchases/po/", {"supplier": "x", "account": supplier, "items": [{"product": p.id, "quantity": 1, "unit_cost": "1"}]}).status_code, 201)
        self.assertEqual(self.hit("post", "/api/orders/sales/", {"client_name": "x", "account": customer, "items": item}).status_code, 201)
        self.finish()

    def test_half_cent_cost_gives_the_same_profit_on_order_and_reports(self):
        # 25.5 m of cable at 1.25 = 31.875: the order card and the reports must agree to the cent
        cable = Product.objects.create(name="Cable", unit_cost=D("1.25"), selling_price=D("2"),
                                       current_stock=D("100"), allow_decimal=True, unit="m")
        oid = self.order(cable, qty="25.5", price="2")
        self.assertEqual(self.client.post(f"/api/orders/sales/{oid}/finalize/").status_code, 200)
        order = self.client.get(f"/api/orders/sales/{oid}/").data
        summary = self.client.get("/api/invoice/financial_summary/").data
        self.assertEqual(Decimal(str(order["profit"])), D("19.12"))  # 51.00 - 31.88
        self.assertEqual(Decimal(str(summary["net_profit"])), D("19.12"))
        self.assertEqual(Decimal(str(summary["total_cogs"])), D("31.88"))

    def test_walk_in_supplier_keeps_a_phone(self):
        p = self.product(stock=0)
        res = self.client.post("/api/purchases/po/", {"supplier": "Abu Ali", "supplier_phone": "0944111222",
                                                       "items": [{"product": p.id, "quantity": 1, "unit_cost": "5"}]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["supplier_phone"], "0944111222")
        self.assertEqual(self.client.get(f"/api/purchases/po/{res.data['id']}/").data["supplier_phone"], "0944111222")
        # optional: older clients that send no phone still work
        res = self.client.post("/api/purchases/po/", {"supplier": "X", "items": [{"product": p.id, "quantity": 1, "unit_cost": "5"}]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["supplier_phone"], "")
