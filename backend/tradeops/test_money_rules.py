"""Money rules: account balances count orders from creation, paid money never vanishes,
account credit settles new orders, calendar report periods."""
from datetime import date

from invoice.services import period_range
from locations.models import Branch
from order.models import SalesOrder
from purchase_order.models import PurchaseOrder

from .tests import Base, D


class MoneyRuleTests(Base):
    def setUp(self):
        super().setUp()
        self.client.put("/api/system/features/", {"accounts": True, "money_boxes": True, "branches": True},
                        format="json")
        self.p = self.product(stock=100, cost="10", price="100")

    def account(self, name, supplier=False):
        res = self.client.post("/api/accounts/", {"name": name, "is_customer": not supplier, "is_supplier": supplier},
                               format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.data["id"]

    def po(self, account, qty, cost="100", **extra):
        res = self.client.post("/api/purchases/po/", {
            "supplier": "S", "account": account, "items": [{"product": self.p.id, "quantity": qty, "unit_cost": cost}],
            **extra,
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.data["id"]

    def sale(self, account, qty, price="100", finalize=False):
        res = self.client.post("/api/orders/sales/", {
            "client_name": "C", "account": account,
            "items": [{"product": self.p.id, "quantity": qty, "unit_price": price}],
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        if finalize:
            self.assertEqual(self.client.post(f"/api/orders/sales/{res.data['id']}/finalize/").status_code, 200)
        return res.data["id"]

    def balance(self, account):
        return D(self.client.get(f"/api/accounts/{account}/").data["balance"])

    def usd_box(self):
        return {r["currency"]: D(r["balance"]) for r in self.client.get("/api/cashbox/boxes/").data}["USD"]

    # --- balances count orders from the day they are created ---

    def test_pending_purchase_orders_are_owed_from_creation(self):
        sup = self.account("Supplier", supplier=True)
        first = self.po(sup, 4)
        self.po(sup, 3)
        self.po(sup, 3)
        self.client.post(f"/api/purchases/po/{first}/add-payment/", {"amount": "100"}, format="json")
        self.assertEqual(self.balance(sup), D("-900"))  # we owe 900, not "he owes us 100"
        row = self.client.get(f"/api/accounts/{sup}/").data
        self.assertEqual(D(row["total_purchases"]), D("1000"))
        self.assertTrue(any("لم يُستلم" in line["description"] for line in row["statement"]))
        self.assertEqual([o["ref"] for o in row["open_orders"]], [f"PO-{first}", f"PO-{first + 1}", f"PO-{first + 2}"])
        self.client.post(f"/api/purchases/po/{first}/receive/")
        self.assertEqual(self.balance(sup), D("-900"))  # receiving changes nothing in the balance

    def test_draft_sales_are_owed_from_creation(self):
        cus = self.account("Customer")
        first = self.sale(cus, 4)
        self.sale(cus, 3)
        self.sale(cus, 3)
        self.client.post(f"/api/orders/sales/{first}/payments/", {"amount": "100"}, format="json")
        self.assertEqual(self.balance(cus), D("900"))
        self.client.post(f"/api/orders/sales/{first}/finalize/")
        self.assertEqual(self.balance(cus), D("900"))

    def test_cancelled_purchase_order_drops_out(self):
        sup = self.account("Supplier", supplier=True)
        po = self.po(sup, 2)
        self.assertEqual(self.balance(sup), D("-200"))
        self.assertEqual(self.client.post(f"/api/purchases/po/{po}/cancel/").status_code, 200)
        self.assertEqual(self.balance(sup), D("0"))

    # --- editing below what was paid ---

    def test_sale_cannot_drop_below_what_was_paid_on_it(self):
        order = self.sale(None, 3)
        self.client.post(f"/api/orders/sales/{order}/payments/", {"amount": "300"}, format="json")
        res = self.client.put(f"/api/orders/sales/{order}/", {
            "items": [{"product": self.p.id, "quantity": 1, "unit_price": "10"}],
        }, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(SalesOrder.objects.get(pk=order).total_paid, D("300"))
        res = self.client.put(f"/api/orders/sales/{order}/", {"discount": "1"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_lump_sum_parts_move_when_an_order_shrinks(self):
        cus = self.account("Customer")
        first = self.sale(cus, 3)  # 300
        second = self.sale(cus, 2)  # 200
        self.client.post(f"/api/accounts/{cus}/payments/", {"direction": "IN", "amount": "400"}, format="json")
        self.assertEqual(SalesOrder.objects.get(pk=first).payment_status, "paid")
        # shrink the first order to 100: its lump-sum part goes back and pays the second order instead
        res = self.client.put(f"/api/orders/sales/{first}/", {
            "items": [{"product": self.p.id, "quantity": 1, "unit_price": "100"}],
        }, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(SalesOrder.objects.get(pk=first).payment_status, "paid")
        self.assertEqual(SalesOrder.objects.get(pk=second).payment_status, "paid")
        self.assertEqual(self.balance(cus), D("-100"))  # 100 credit left
        self.assertEqual(self.usd_box(), D("400"))

    # --- paid money never vanishes ---

    def test_deleting_a_paid_purchase_order_asks_what_happens_to_the_money(self):
        sup = self.account("Supplier", supplier=True)
        po = self.po(sup, 1)
        self.client.post(f"/api/purchases/po/{po}/add-payment/", {"amount": "60"}, format="json")
        self.assertEqual(self.usd_box(), D("-60"))
        res = self.client.delete(f"/api/purchases/po/{po}/")
        self.assertEqual(res.status_code, 400)
        self.assertTrue(PurchaseOrder.objects.filter(pk=po).exists())

        self.assertEqual(self.client.delete(f"/api/purchases/po/{po}/?payments=credit").status_code, 204)
        self.assertEqual(self.usd_box(), D("-60"))  # the money is still out of the box ...
        self.assertEqual(self.balance(sup), D("60"))  # ... as credit we hold with the supplier

        # the next order from that supplier is paid from the credit
        nxt = self.po(sup, 1)
        self.assertEqual(PurchaseOrder.objects.get(pk=nxt).paid_amount, D("60"))
        self.assertEqual(self.balance(sup), D("-40"))
        self.assertEqual(self.usd_box(), D("-60"))

    def test_refund_on_delete_puts_the_money_back(self):
        po = self.client.post("/api/purchases/po/", {
            "supplier": "Walk-in", "items": [{"product": self.p.id, "quantity": 1, "unit_cost": "100"}],
        }, format="json").data["id"]
        self.client.post(f"/api/purchases/po/{po}/add-payment/", {"amount": "60"}, format="json")
        # no account: keeping it as credit is impossible
        self.assertEqual(self.client.delete(f"/api/purchases/po/{po}/?payments=credit").status_code, 400)
        self.assertEqual(self.client.delete(f"/api/purchases/po/{po}/?payments=refund").status_code, 204)
        self.assertEqual(self.usd_box(), D("0"))

    def test_cancel_with_payments_keeps_them_as_credit(self):
        sup = self.account("Supplier", supplier=True)
        po = self.po(sup, 5)
        self.client.post(f"/api/purchases/po/{po}/add-payment/", {"amount": "200"}, format="json")
        self.assertEqual(self.client.post(f"/api/purchases/po/{po}/cancel/").status_code, 400)
        res = self.client.post(f"/api/purchases/po/{po}/cancel/", {"payments": "credit"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(PurchaseOrder.objects.get(pk=po).paid_amount, D("0"))
        self.assertEqual(self.balance(sup), D("200"))

    def test_deleting_a_paid_sale_keeps_the_money_as_customer_credit(self):
        cus = self.account("Customer")
        old = self.sale(cus, 2, finalize=True)
        other = self.sale(cus, 3)
        self.client.post(f"/api/orders/sales/{old}/payments/", {"amount": "200"}, format="json")
        self.assertEqual(self.client.delete(f"/api/orders/sales/{old}/").status_code, 400)
        self.assertEqual(self.client.delete(f"/api/orders/sales/{old}/?payments=credit").status_code, 204)
        self.assertEqual(self.usd_box(), D("200"))  # still in the box
        self.assertEqual(SalesOrder.objects.get(pk=other).total_paid, D("200"))  # now pays the other order
        self.assertEqual(self.balance(cus), D("100"))
        self.assertEqual(self.stock(self.p), D("100"))  # goods of the finalized order came back

    def test_deleting_an_unpaid_order_needs_no_choice(self):
        order = self.sale(None, 1)
        self.assertEqual(self.client.delete(f"/api/orders/sales/{order}/").status_code, 204)

    # --- credit settles new orders ---

    def test_account_credit_pays_new_orders(self):
        cus = self.account("Customer")
        self.client.post(f"/api/accounts/{cus}/payments/", {"direction": "IN", "amount": "500"}, format="json")
        order = self.sale(cus, 3, finalize=True)
        so = SalesOrder.objects.get(pk=order)
        self.assertEqual(so.payment_status, "paid")
        self.assertEqual(self.balance(cus), D("-200"))
        self.assertEqual(self.usd_box(), D("500"))  # counted once, never twice

    def test_syp_credit_is_split_to_the_last_lira(self):
        cus = self.account("Customer")
        self.client.post(f"/api/accounts/{cus}/payments/", {
            "direction": "IN", "currency": "SYP", "paid_amount": "1000000", "exchange_rate": "13000",
        }, format="json")  # = 76.92 USD
        self.sale(cus, 1, price="30")
        self.sale(cus, 1, price="30")
        self.sale(cus, 1, price="30")
        boxes = {r["currency"]: D(r["balance"]) for r in self.client.get("/api/cashbox/boxes/").data}
        self.assertEqual(boxes["SYP"], D("1000000"))
        self.assertEqual(self.balance(cus), D("90") - D("76.92"))

    def test_account_payment_goes_to_the_chosen_branch_box(self):
        self.client.get("/api/locations/branches/")  # creates the default branch first
        other = Branch.objects.create(name="Aleppo")
        cus = self.account("Customer")
        self.client.post(f"/api/accounts/{cus}/payments/", {"direction": "IN", "amount": "50", "branch": other.pk},
                         format="json")
        boxes = {r["currency"]: D(r["balance"]) for r in self.client.get(f"/api/cashbox/boxes/?branch={other.pk}").data}
        self.assertEqual(boxes["USD"], D("50"))

    # --- reports ---

    def test_periods_are_calendar_periods(self):
        today = date(2026, 10, 21)  # a Wednesday
        self.assertEqual(period_range("daily", today), (today, today))
        self.assertEqual(period_range("weekly", today)[0], date(2026, 10, 17))  # Saturday
        self.assertEqual(period_range("monthly", today)[0], date(2026, 10, 1))
        self.assertEqual(period_range("quarterly", today)[0], date(2026, 10, 1))
        self.assertEqual(period_range("quarterly", date(2026, 8, 5))[0], date(2026, 7, 1))
        self.assertEqual(period_range("yearly", today)[0], date(2026, 1, 1))
        saturday = date(2026, 10, 17)
        self.assertEqual(period_range("weekly", saturday)[0], saturday)

    def test_dashboard_counts_follow_the_branch(self):
        self.sale(None, 1)  # creates the default branch first
        other = Branch.objects.create(name="Aleppo")
        data = self.client.get(f"/api/reports/dashboard/summary/?branch={other.pk}").data
        self.assertEqual(data["open_orders"], 0)
        self.assertEqual(data["low_stock_items"], 1)  # the panel has nothing in Aleppo
        data = self.client.get("/api/reports/dashboard/summary/").data
        self.assertEqual(data["open_orders"], 1)
        self.assertEqual(data["low_stock_items"], 0)

    # --- statement, cash box and summary read the way the money moved ---

    def test_statement_is_in_entry_order_and_lump_sum_says_what_it_paid(self):
        sup = self.account("Supplier", supplier=True)
        first = self.po(sup, 3)  # 300
        second = self.po(sup, 2)  # 200
        self.client.post(f"/api/purchases/po/{second}/add-payment/", {"amount": "50"}, format="json")
        self.client.post(f"/api/accounts/{sup}/payments/", {"direction": "OUT", "amount": "400"}, format="json")
        row = self.client.get(f"/api/accounts/{sup}/").data
        kinds = [line["kind"] for line in row["statement"]]
        self.assertEqual(kinds, ["purchase", "purchase", "payment_out", "payment_out"])  # oldest first
        self.assertIn(f"PO-{second}", row["statement"][2]["description"])  # the 50 came before the lump sum
        lump = row["statement"][3]["description"]
        self.assertIn(f"PO-{first} $300.00", lump)
        self.assertIn(f"PO-{second} $100.00", lump)
        self.assertEqual(D(row["statement"][3]["balance"]), D("-50"))
        self.assertEqual(D(row["total_purchases"]), D("500"))
        self.assertEqual(D(row["total_paid"]), D("450"))
        self.assertEqual([o["ref"] for o in row["open_orders"]], [f"PO-{second}"])
        self.assertEqual(D(row["open_orders"][0]["remaining"]), D("50"))

    def test_cash_box_shows_a_lump_sum_once_for_the_whole_amount(self):
        cus = self.account("Customer")
        self.sale(cus, 3)
        self.sale(cus, 2)
        self.client.post(f"/api/accounts/{cus}/payments/", {"direction": "IN", "amount": "450"}, format="json")
        rows = self.client.get("/api/cashbox/statement/?currency=USD").data
        self.assertEqual(len(rows), 1)
        self.assertEqual(D(rows[0]["amount"]), D("450"))
        self.assertEqual(D(rows[0]["balance"]), D("450"))
        row = self.client.get(f"/api/accounts/{cus}/").data
        self.assertEqual(D(row["total_received"]), D("450"))

    def test_summary_shows_what_is_still_open(self):
        sup = self.account("Supplier", supplier=True)
        po = self.po(sup, 3)
        self.client.post(f"/api/purchases/po/{po}/add-payment/", {"amount": "100"}, format="json")
        order = self.sale(None, 2)
        self.client.post(f"/api/orders/sales/{order}/payments/", {"amount": "50"}, format="json")
        data = self.client.get("/api/reports/financials/?period=monthly").data
        self.assertEqual(D(data["payables"]), D("200"))
        self.assertEqual(D(data["receivables"]), D("150"))
        self.assertEqual(D(data["cash_received"]), D("50"))
        self.assertEqual(D(data["supplier_payments"]), D("100"))
