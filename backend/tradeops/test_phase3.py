"""Phase 3: stock history, opening stock linked to a supplier later, sale date, admin edits of booked
documents with an edit log, customer returns and returns to the supplier."""
from datetime import date, timedelta

from rest_framework.test import APIClient

from audit.models import EditLog
from inventory.models import OpeningStock
from locations.models import Branch, StockLevel, StockMovement
from order.models import SalesOrder

from .tests import Base, D


class Phase3Tests(Base):
    def setUp(self):
        super().setUp()
        self.client.put("/api/system/features/", {"accounts": True, "money_boxes": True, "branches": True,
                                                  "cars": True}, format="json")
        self.client.get("/api/locations/branches/")
        self.main = Branch.objects.get(is_default=True)

    def account(self, name, supplier=False):
        return self.client.post("/api/accounts/", {"name": name, "is_customer": not supplier,
                                                   "is_supplier": supplier}, format="json").data["id"]

    def new_product(self, stock=10, cost="100", price="150"):
        res = self.client.post("/api/inventory/products/", {"name": "Panel", "unit_cost": cost, "selling_price": price,
                                                            "current_stock": stock}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.data["id"]

    def sale(self, product, qty, price="150", account=None, finalize=True, **extra):
        res = self.client.post("/api/orders/sales/", {"client_name": "C", "account": account,
                                                      "items": [{"product": product, "quantity": qty,
                                                                 "unit_price": price}], **extra}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        if finalize:
            self.assertEqual(self.client.post(f"/api/orders/sales/{res.data['id']}/finalize/").status_code, 200)
        return res.data["id"]

    def balance(self, account):
        return D(self.client.get(f"/api/accounts/{account}/").data["balance"])

    def usd_box(self):
        return {r["currency"]: D(r["balance"]) for r in self.client.get("/api/cashbox/boxes/").data}["USD"]

    def qty(self, product):
        return StockLevel.objects.get(product_id=product, branch=self.main).quantity

    # --- stock history ---

    def test_every_stock_change_is_in_the_history(self):
        p = self.new_product(stock=10)
        self.sale(p, 3)
        bad = self.client.put(f"/api/inventory/products/{p}/", {"current_stock": 5}, format="json")
        self.assertEqual(bad.status_code, 400)  # a correction needs a reason
        self.client.put(f"/api/inventory/products/{p}/", {"current_stock": 5, "stock_reason": "تالف"}, format="json")
        rows = self.client.get(f"/api/inventory/products/{p}/movements/").data
        self.assertEqual([r["kind"] for r in rows], ["CORRECTION", "SALE", "OPENING"])
        self.assertEqual([D(str(r["delta"])) for r in rows], [D("-2"), D("-3"), D("10")])
        self.assertEqual(D(str(rows[0]["balance_after"])), D("5"))
        self.assertEqual(rows[0]["note"], "تالف")

    # --- opening stock ---

    def test_opening_stock_links_to_a_supplier_later(self):
        p = self.new_product(stock=10, cost="100")
        self.assertEqual(self.usd_box(), D("0"))  # no cash for goods already owned
        opening = OpeningStock.objects.get(product_id=p)
        sup = self.account("Supplier", supplier=True)
        res = self.client.post(f"/api/inventory/opening/{opening.pk}/link/", {"account": sup}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        po = res.data["purchase_order"]
        self.assertEqual(self.balance(sup), D("-1000"))  # now owed to the supplier
        self.assertEqual(self.qty(p), D("10"))  # the goods did not enter twice
        self.client.post(f"/api/purchases/po/{po}/add-payment/", {"amount": "400"}, format="json")
        self.assertEqual(self.balance(sup), D("-600"))
        self.assertEqual(self.client.post(f"/api/inventory/opening/{opening.pk}/link/", {"account": sup},
                                          format="json").status_code, 400)  # linked once only
        # undoing needs the payments gone first
        self.assertEqual(self.client.delete(f"/api/inventory/opening/{opening.pk}/link/").status_code, 400)

    def test_opening_stock_with_a_walk_in_supplier_name(self):
        p = self.new_product(stock=2, cost="50")
        opening = OpeningStock.objects.get(product_id=p)
        res = self.client.post(f"/api/inventory/opening/{opening.pk}/link/", {"supplier": "Abu Ali"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["supplier"], "Abu Ali")
        self.assertEqual(self.client.delete(f"/api/inventory/opening/{opening.pk}/link/").status_code, 200)
        opening.refresh_from_db()
        self.assertIsNone(opening.purchase_order_id)
        self.assertEqual(self.qty(p), D("2"))

    # --- sale date ---

    def test_a_late_invoice_is_booked_on_its_own_day(self):
        p = self.new_product(stock=5)
        yesterday = date.today() - timedelta(days=1)
        order = self.sale(p, 1, sale_date=yesterday.isoformat())
        so = SalesOrder.objects.get(pk=order)
        self.assertEqual(so.finalized_at.date(), yesterday)
        future = self.client.post("/api/orders/sales/", {"client_name": "C", "sale_date": (date.today() + timedelta(days=2)).isoformat(),
                                                         "items": [{"product": p, "quantity": 1, "unit_price": "1"}]},
                                  format="json")
        self.assertEqual(future.status_code, 400)

    # --- admin edits ---

    def test_admin_edits_a_finalized_sale_and_stock_follows(self):
        p = self.new_product(stock=10, cost="100")
        cus = self.account("Customer")
        order = self.sale(p, 3, account=cus)  # 450
        self.client.put(f"/api/inventory/products/{p}/", {"unit_cost": "120"}, format="json")  # newer price
        res = self.client.put(f"/api/orders/sales/{order}/", {
            "items": [{"product": p, "quantity": 5, "unit_price": "150"}]}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(self.qty(p), D("5"))
        self.assertEqual(D(res.data["cost_total"]), D("500"))  # the sold product keeps its cost of 100
        self.assertEqual(self.balance(cus), D("750"))
        log = EditLog.objects.get(doc_type="SO", doc_id=order)
        self.assertIn("البنود", log.summary)
        self.assertEqual(log.before["items"][0]["quantity"], "3")
        self.assertEqual(self.client.get(f"/api/audit/?type=SO&id={order}").data[0]["user"], "Boss")
        # more than in stock is refused and changes nothing
        short = self.client.put(f"/api/orders/sales/{order}/", {
            "items": [{"product": p, "quantity": 50, "unit_price": "150"}]}, format="json")
        self.assertEqual(short.status_code, 400)
        self.assertEqual(self.qty(p), D("5"))

    def test_staff_cannot_edit_booked_documents(self):
        p = self.new_product(stock=10)
        order = self.sale(p, 1)
        staff = self.login(self.staff, APIClient())
        self.assertEqual(staff.put(f"/api/orders/sales/{order}/", {"discount": "1"}, format="json").status_code, 403)
        self.assertEqual(staff.put(f"/api/orders/sales/{order}/", {"client_phone": "0999"}, format="json").status_code,
                         200)

    def test_admin_edits_a_received_purchase_order_price(self):
        p = self.new_product(stock=0, cost="0")
        sup = self.account("Supplier", supplier=True)
        po = self.client.post("/api/purchases/po/", {"supplier": "S", "account": sup, "items": [
            {"product": p, "quantity": 10, "unit_cost": "100"}]}, format="json").data
        self.client.post(f"/api/purchases/po/{po['id']}/receive/")
        item = po["items"][0]["id"]
        res = self.client.put(f"/api/purchases/po/{po['id']}/", {"items": [
            {"id": item, "product": p, "quantity": 10, "unit_cost": "90"}]}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(D(self.client.get(f"/api/inventory/products/{p}/").data["unit_cost"]), D("90"))
        self.assertEqual(self.balance(sup), D("-900"))
        below = self.client.put(f"/api/purchases/po/{po['id']}/", {"items": [
            {"id": item, "product": p, "quantity": 4, "unit_cost": "90"}]}, format="json")
        self.assertEqual(below.status_code, 400)  # fewer than arrived: that is a return
        self.assertEqual(EditLog.objects.filter(doc_type="PO", doc_id=po["id"]).count(), 1)

    # --- customer returns ---

    def test_customer_return_lowers_revenue_stock_and_debt(self):
        p = self.new_product(stock=10, cost="100")
        cus = self.account("Customer")
        order = self.sale(p, 4, account=cus)  # 600, cost 400
        so = self.client.get(f"/api/orders/sales/{order}/").data
        res = self.client.post(f"/api/orders/sales/{order}/returns/", {
            "lines": [{"item": so["items"][0]["id"], "quantity": 1}]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(D(res.data["net_total"]), D("450"))
        self.assertEqual(self.qty(p), D("7"))
        self.assertEqual(self.balance(cus), D("450"))
        t = self.client.get("/api/invoice/financial_summary/").data
        self.assertEqual(D(t["total_revenue"]), D("450"))
        self.assertEqual(D(t["total_cogs"]), D("300"))
        over = self.client.post(f"/api/orders/sales/{order}/returns/", {
            "lines": [{"item": so["items"][0]["id"], "quantity": 4}]}, format="json")
        self.assertEqual(over.status_code, 400)  # only 3 left to return

    def test_return_on_a_paid_order_refunds_or_keeps_credit(self):
        p = self.new_product(stock=10, cost="100")
        cus = self.account("Customer")
        order = self.sale(p, 2, account=cus)  # 300
        self.client.post(f"/api/orders/sales/{order}/payments/", {"amount": "300"}, format="json")
        item = self.client.get(f"/api/orders/sales/{order}/").data["items"][0]["id"]
        ask = self.client.post(f"/api/orders/sales/{order}/returns/", {"lines": [{"item": item, "quantity": 1}]},
                               format="json")
        self.assertEqual(ask.status_code, 400)  # 150 was overpaid: refund or credit?
        res = self.client.post(f"/api/orders/sales/{order}/returns/", {
            "lines": [{"item": item, "quantity": 1}], "money_action": "credit"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["payment_status"], "paid")
        self.assertEqual(self.balance(cus), D("-150"))  # credit with us
        self.assertEqual(self.usd_box(), D("300"))  # no cash moved
        nxt = self.sale(p, 1, account=cus)  # 150, paid from the credit
        self.assertEqual(SalesOrder.objects.get(pk=nxt).payment_status, "paid")
        self.assertEqual(self.balance(cus), D("0"))

    def test_cash_refund_leaves_the_box(self):
        p = self.new_product(stock=10)
        order = self.sale(p, 2)  # 300, walk-in
        self.client.post(f"/api/orders/sales/{order}/payments/", {"amount": "300"}, format="json")
        item = self.client.get(f"/api/orders/sales/{order}/").data["items"][0]["id"]
        res = self.client.post(f"/api/orders/sales/{order}/returns/", {
            "lines": [{"item": item, "quantity": 2}], "money_action": "refund"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(self.usd_box(), D("0"))
        self.assertEqual(D(self.client.get("/api/invoice/financial_summary/").data["cash_received"]), D("0"))
        # undo the return: goods leave again, the refund disappears
        rid = res.data["returns"][0]["id"]
        self.assertEqual(self.client.delete(f"/api/orders/sales/{order}/returns/{rid}/").status_code, 200)
        self.assertEqual(self.usd_box(), D("300"))
        self.assertEqual(self.qty(p), D("8"))
        self.assertEqual(self.client.delete(f"/api/orders/sales/{order}/?payments=refund").status_code, 204)

    # --- returns to the supplier ---

    def test_return_to_supplier(self):
        p = self.new_product(stock=0, cost="0")
        sup = self.account("Supplier", supplier=True)
        po = self.client.post("/api/purchases/po/", {"supplier": "S", "account": sup, "discount": "100", "items": [
            {"product": p, "quantity": 10, "unit_cost": "100"}]}, format="json").data  # 900 due
        self.client.post(f"/api/purchases/po/{po['id']}/receive/")
        self.client.post(f"/api/purchases/po/{po['id']}/add-payment/", {"amount": "900"}, format="json")
        item = po["items"][0]["id"]
        res = self.client.post(f"/api/purchases/po/{po['id']}/returns/", {
            "lines": [{"item": item, "quantity": 2}], "money_action": "refund"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(D(res.data["returned_total"]), D("180"))  # 2 x 100 less the 10% discount share
        self.assertEqual(self.qty(p), D("8"))
        self.assertEqual(self.usd_box(), D("-720"))  # 900 out, 180 back
        self.assertEqual(self.balance(sup), D("0"))
        self.assertEqual(StockMovement.objects.filter(product_id=p, kind="RETURN_OUT").count(), 1)
        # cannot send back goods that are no longer there
        self.sale(p, 8)
        none_left = self.client.post(f"/api/purchases/po/{po['id']}/returns/", {
            "lines": [{"item": item, "quantity": 1}], "money_action": "refund"}, format="json")
        self.assertEqual(none_left.status_code, 400)
