"""Wholesale accounts: ledger, debtor / creditor, lump-sum payments spread over orders."""
from rest_framework.test import APIClient

from order.models import SalesOrder
from purchase_order.models import PurchaseOrder

from .tests import Base, D


class AccountTests(Base):
    def setUp(self):
        super().setUp()
        self.client.put("/api/system/features/", {"accounts": True, "money_boxes": True}, format="json")

    def account(self, name="Ahmad Wholesale", **extra):
        res = self.client.post("/api/accounts/", {"name": name, **extra}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.data["id"]

    def sale(self, account, product, qty, price, finalize=True):
        res = self.client.post("/api/orders/sales/", {
            "client_name": "Ahmad Wholesale", "account": account,
            "items": [{"product": product.id, "quantity": qty, "unit_price": price}],
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        if finalize:
            self.assertEqual(self.client.post(f"/api/orders/sales/{res.data['id']}/finalize/").status_code, 200)
        return res.data["id"]

    def test_feature_gate(self):
        self.client.put("/api/system/features/", {"accounts": False}, format="json")
        self.assertEqual(self.client.get("/api/accounts/").status_code, 403)

    def test_debtor_balance_and_lump_sum_payment_spreads_over_oldest_orders(self):
        acc = self.account(opening_balance="50")
        p = self.product(stock=50, cost="10", price="20")
        first = self.sale(acc, p, 5, "20")    # 100
        second = self.sale(acc, p, 10, "20")  # 200
        row = self.client.get(f"/api/accounts/{acc}/").data
        self.assertEqual(D(row["balance"]), D("350"))  # 50 opening + 100 + 200

        res = self.client.post(f"/api/accounts/{acc}/payments/", {"direction": "IN", "amount": "130"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(D(res.data["balance"]), D("220"))
        # oldest order is paid in full, the next one partially
        self.assertEqual(SalesOrder.objects.get(pk=first).payment_status, "paid")
        so2 = SalesOrder.objects.get(pk=second)
        self.assertEqual(so2.total_paid, D("30"))
        self.assertEqual(so2.payment_status, "partial")
        # the cash arrived in the USD box exactly once
        boxes = {r["currency"]: D(r["balance"]) for r in self.client.get("/api/cashbox/boxes/").data}
        self.assertEqual(boxes["USD"], D("130"))

        # paying more than the orders need keeps the rest as credit on the account (and in the box)
        res = self.client.post(f"/api/accounts/{acc}/payments/", {"direction": "IN", "amount": "300"}, format="json")
        self.assertEqual(D(res.data["balance"]), D("-80"))  # the account is now in credit
        self.assertEqual(SalesOrder.objects.get(pk=second).payment_status, "paid")
        boxes = {r["currency"]: D(r["balance"]) for r in self.client.get("/api/cashbox/boxes/").data}
        self.assertEqual(boxes["USD"], D("430"))

    def test_deleting_a_lump_sum_undoes_its_order_payments(self):
        acc = self.account()
        p = self.product(stock=10, price="20")
        order = self.sale(acc, p, 5, "20")
        pay = self.client.post(f"/api/accounts/{acc}/payments/", {"direction": "IN", "amount": "100"}, format="json")
        payment_id = [r for r in pay.data["statement"] if r["kind"] == "payment_in"][0]["ref"].split(":")[1]
        self.assertEqual(SalesOrder.objects.get(pk=order).payment_status, "paid")
        self.assertEqual(self.client.delete(f"/api/accounts/{acc}/payments/{payment_id}/").status_code, 204)
        self.assertEqual(SalesOrder.objects.get(pk=order).payment_status, "unpaid")
        self.assertEqual(D(self.client.get(f"/api/accounts/{acc}/").data["balance"]), D("100"))

    def test_supplier_is_a_creditor_and_payments_go_out(self):
        acc = self.account("Solar Supplier", is_customer=False, is_supplier=True)
        p = self.product(stock=0, cost="10")
        po = self.client.post("/api/purchases/po/", {
            "supplier": "Solar Supplier", "account": acc,
            "items": [{"product": p.id, "quantity": 10, "unit_cost": "10"}],
        }, format="json").data["id"]
        self.client.post(f"/api/purchases/po/{po}/receive/")
        self.assertEqual(D(self.client.get(f"/api/accounts/{acc}/").data["balance"]), D("-100"))  # we owe 100
        res = self.client.post(f"/api/accounts/{acc}/payments/", {"direction": "OUT", "amount": "60"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(D(res.data["balance"]), D("-40"))
        self.assertEqual(PurchaseOrder.objects.get(pk=po).paid_amount, D("60"))
        boxes = {r["currency"]: D(r["balance"]) for r in self.client.get("/api/cashbox/boxes/").data}
        self.assertEqual(boxes["USD"], D("-60"))
        # a supplier cannot be asked for money, a customer cannot be paid
        wrong = self.client.post(f"/api/accounts/{acc}/payments/", {"direction": "IN", "amount": "5"}, format="json")
        self.assertEqual(wrong.status_code, 400)

    def test_lump_sum_in_syp_splits_the_cash_over_orders(self):
        acc = self.account()
        p = self.product(stock=10, price="20")
        o1 = self.sale(acc, p, 2, "20")  # 40
        o2 = self.sale(acc, p, 3, "20")  # 60
        res = self.client.post(f"/api/accounts/{acc}/payments/", {
            "direction": "IN", "currency": "SYP", "paid_amount": "1500000", "exchange_rate": "15000"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)  # 100 USD
        self.assertEqual(SalesOrder.objects.get(pk=o1).payment_status, "paid")
        self.assertEqual(SalesOrder.objects.get(pk=o2).payment_status, "paid")
        boxes = {r["currency"]: D(r["balance"]) for r in self.client.get("/api/cashbox/boxes/").data}
        self.assertEqual(boxes["SYP"], D("1500000"))  # not double counted

    def test_account_with_history_cannot_be_deleted_and_names_are_unique(self):
        acc = self.account()
        p = self.product(stock=5, price="20")
        self.sale(acc, p, 1, "20")
        self.assertEqual(self.client.delete(f"/api/accounts/{acc}/").status_code, 409)
        dup = self.client.post("/api/accounts/", {"name": "ahmad wholesale"}, format="json")
        self.assertEqual(dup.status_code, 400)

    def test_manual_entry_and_staff_rules(self):
        acc = self.account()
        res = self.client.post(f"/api/accounts/{acc}/entries/", {"kind": "CREDIT", "amount": "25", "note": "advance"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(D(res.data["balance"]), D("-25"))
        staff = self.login(self.staff, APIClient())
        self.assertEqual(staff.get("/api/accounts/").status_code, 200)
        self.assertEqual(staff.post(f"/api/accounts/{acc}/entries/", {"kind": "DEBIT", "amount": "1"}, format="json").status_code, 403)
