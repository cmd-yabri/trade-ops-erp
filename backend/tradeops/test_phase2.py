"""Phase 2: last purchase price (landed: discount and transport shared into the cost), transport fee
paid to the supplier or a carrier, partial receipts, receiving into a car, a stock source per sale
line, several products in one transfer, 4-decimal costs."""
from inventory.models import Product
from invoice.models import Expense
from locations.models import Branch, Car, StockLevel
from purchase_order.models import PurchaseOrder

from .tests import Base, D


class Phase2Tests(Base):
    def setUp(self):
        super().setUp()
        self.client.put("/api/system/features/", {"accounts": True, "money_boxes": True, "branches": True,
                                                  "cars": True}, format="json")
        self.client.get("/api/locations/branches/")  # default branch first
        self.main = Branch.objects.get(is_default=True)

    def supplier(self):
        res = self.client.post("/api/accounts/", {"name": "Supplier", "is_customer": False, "is_supplier": True},
                               format="json")
        return res.data["id"]

    def make_po(self, lines, **extra):
        res = self.client.post("/api/purchases/po/", {
            "supplier": "Supplier", "items": [{"product": p.id, "quantity": q, "unit_cost": c} for p, q, c in lines],
            **extra,
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.data

    def cost(self, product):
        product.refresh_from_db()
        return product.unit_cost

    def usd_box(self):
        return {r["currency"]: D(r["balance"]) for r in self.client.get("/api/cashbox/boxes/").data}["USD"]

    # --- landed cost = last purchase price ---

    def test_discount_and_carrier_transport_go_into_the_cost(self):
        a = self.product("Panel", cost="90", stock=0)
        b = self.product("Inverter", cost="150", stock=0)
        sup = self.supplier()
        po = self.make_po([(a, 10, "100"), (b, 5, "200")], account=sup, discount="100",
                          transport_cost="200", transport_payee="CARRIER")
        self.assertEqual(D(po["net_total"]), D("1900"))  # the carrier is not on the supplier's bill
        self.assertEqual(self.usd_box(), D("-200"))  # the carrier was paid now
        self.client.post(f"/api/purchases/po/{po['id']}/receive/")
        # each line takes half of the +100 (equal values): 1050 / 10 and 1050 / 5
        self.assertEqual(self.cost(a), D("105"))
        self.assertEqual(self.cost(b), D("210"))
        self.assertEqual(D(self.client.get(f"/api/accounts/{sup}/").data["balance"]), D("-1900"))
        summary = self.client.get("/api/invoice/financial_summary/").data
        self.assertEqual(D(summary["total_operational_expenses"]), D("0"))  # goods cost, not an expense
        self.assertEqual(D(summary["total_stock_purchases"]), D("200"))

    def test_transport_on_the_supplier_bill(self):
        a = self.product("Panel", cost="0", stock=0)
        sup = self.supplier()
        po = self.make_po([(a, 10, "100")], account=sup, transport_cost="50", transport_payee="SUPPLIER")
        self.assertEqual(D(po["net_total"]), D("1050"))
        self.assertEqual(self.usd_box(), D("0"))
        self.assertEqual(D(self.client.get(f"/api/accounts/{sup}/").data["balance"]), D("-1050"))
        self.client.post(f"/api/purchases/po/{po['id']}/receive/")
        self.assertEqual(self.cost(a), D("105"))

    def test_transport_filled_in_later_updates_the_latest_price_only(self):
        a = self.product("Panel", cost="0", stock=0)
        old = self.make_po([(a, 10, "100")])
        self.client.post(f"/api/purchases/po/{old['id']}/receive/")
        res = self.client.post(f"/api/purchases/po/{old['id']}/transport/", {"payee": "CARRIER", "amount": "30"},
                               format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(self.cost(a), D("103"))
        self.assertEqual(D(res.data["items"][0]["landed_unit_cost"]), D("103"))

        new = self.make_po([(a, 10, "120")])
        self.client.post(f"/api/purchases/po/{new['id']}/receive/")
        self.assertEqual(self.cost(a), D("120"))
        # a fee added to the OLD order changes its own landed cost, not today's price
        self.client.post(f"/api/purchases/po/{old['id']}/transport/", {"payee": "CARRIER", "amount": "60"},
                         format="json")
        self.assertEqual(self.cost(a), D("120"))
        self.assertEqual(Expense.objects.get(purchase_order_id=old["id"]).amount, D("60"))  # one expense, updated

    def test_switching_the_payee_moves_the_fee(self):
        a = self.product("Panel", cost="0", stock=0)
        sup = self.supplier()
        po = self.make_po([(a, 1, "100")], account=sup, transport_cost="20", transport_payee="CARRIER")
        self.assertEqual(self.usd_box(), D("-20"))
        self.client.post(f"/api/purchases/po/{po['id']}/transport/", {"payee": "SUPPLIER", "amount": "20"},
                         format="json")
        self.assertEqual(self.usd_box(), D("0"))
        self.assertFalse(Expense.objects.filter(purchase_order_id=po["id"]).exists())
        self.assertEqual(D(self.client.get(f"/api/accounts/{sup}/").data["balance"]), D("-120"))
        # removing the fee
        self.client.post(f"/api/purchases/po/{po['id']}/transport/", {"payee": "SUPPLIER", "amount": "0"},
                         format="json")
        self.assertEqual(D(self.client.get(f"/api/accounts/{sup}/").data["balance"]), D("-100"))

    def test_carrier_paid_in_syp(self):
        a = self.product("Panel", cost="0", stock=0)
        po = self.make_po([(a, 1, "100")])
        res = self.client.post(f"/api/purchases/po/{po['id']}/transport/", {
            "payee": "CARRIER", "currency": "SYP", "paid_amount": "130000", "exchange_rate": "13000",
        }, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(D(res.data["transport_cost"]), D("10"))
        boxes = {r["currency"]: D(r["balance"]) for r in self.client.get("/api/cashbox/boxes/").data}
        self.assertEqual(boxes["SYP"], D("-130000"))

    def test_freight_expense_is_changed_only_from_its_order(self):
        a = self.product("Panel", cost="0", stock=0)
        po = self.make_po([(a, 1, "100")], transport_cost="20")
        freight = Expense.objects.get(purchase_order_id=po["id"])
        self.assertEqual(self.client.delete(f"/api/invoice/expenses/{freight.id}/").status_code, 400)
        self.assertEqual(self.client.put(f"/api/invoice/expenses/{freight.id}/", {"amount": "1"},
                                         format="json").status_code, 400)

    def test_four_decimal_costs(self):
        cable = self.product("Cable", cost="0", stock=0)
        po = self.make_po([(cable, 300, "0.3333")])
        self.assertEqual(D(po["total_cost"]), D("99.99"))
        self.client.post(f"/api/purchases/po/{po['id']}/receive/")
        self.assertEqual(self.cost(cable), D("0.3333"))

    # --- receiving ---

    def test_partial_receipt_then_the_rest(self):
        a = self.product("Panel", cost="0", stock=0)
        po = self.make_po([(a, 10, "100")])
        item = po["items"][0]["id"]
        res = self.client.post(f"/api/purchases/po/{po['id']}/receive/", {"items": [{"item": item, "quantity": 4}]},
                               format="json")
        self.assertEqual(res.data["status"], "PARTIAL")
        self.assertEqual(self.stock(a), D("4"))
        self.assertEqual(self.client.delete(f"/api/purchases/po/{po['id']}/").status_code, 400)
        over = self.client.post(f"/api/purchases/po/{po['id']}/receive/", {"items": [{"item": item, "quantity": 7}]},
                                format="json")
        self.assertEqual(over.status_code, 400)
        res = self.client.post(f"/api/purchases/po/{po['id']}/receive/")  # the rest
        self.assertEqual(res.data["status"], "RECEIVED")
        self.assertEqual(self.stock(a), D("10"))

    def test_receive_straight_into_a_car(self):
        a = self.product("Panel", cost="0", stock=0)
        car = Car.objects.create(name="Van")
        po = self.make_po([(a, 5, "100")])
        res = self.client.post(f"/api/purchases/po/{po['id']}/receive/", {"car": car.pk}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(StockLevel.objects.get(product=a, car=car).quantity, D("5"))

    # --- sales: each line from its own place ---

    def test_sale_lines_leave_from_their_own_place(self):
        a = self.product("Panel", stock=0)
        b = self.product("Battery", stock=0)
        car = Car.objects.create(name="Van")
        self.client.post(f"/api/purchases/po/{self.make_po([(a, 5, '100'), (b, 5, '100')])['id']}/receive/")
        self.client.post("/api/locations/transfers/", {"lines": [{"product": a.id, "quantity": 3}], "to_car": car.pk},
                         format="json")
        res = self.client.post("/api/orders/sales/", {"client_name": "Mix", "car": car.pk, "items": [
            {"product": a.id, "quantity": 2, "unit_price": "150"},  # from the car (the order's place)
            {"product": b.id, "quantity": 1, "unit_price": "150", "branch": self.main.pk},  # from the shop
        ]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["items"][1]["branch_name"], self.main.name)
        self.assertEqual(self.client.post(f"/api/orders/sales/{res.data['id']}/finalize/").status_code, 200)
        self.assertEqual(StockLevel.objects.get(product=a, car=car).quantity, D("1"))
        self.assertEqual(StockLevel.objects.get(product=b, branch=self.main).quantity, D("4"))
        self.assertEqual(self.client.delete(f"/api/orders/sales/{res.data['id']}/").status_code, 204)
        self.assertEqual(StockLevel.objects.get(product=a, car=car).quantity, D("3"))
        self.assertEqual(StockLevel.objects.get(product=b, branch=self.main).quantity, D("5"))

    # --- transfers ---

    def test_several_products_move_together_or_not_at_all(self):
        a = self.product("Panel", stock=0)
        b = self.product("Battery", stock=0)
        car = Car.objects.create(name="Van")
        self.client.post(f"/api/purchases/po/{self.make_po([(a, 5, '100'), (b, 2, '100')])['id']}/receive/")
        short = self.client.post("/api/locations/transfers/", {"to_car": car.pk, "lines": [
            {"product": a.id, "quantity": 3}, {"product": b.id, "quantity": 9}]}, format="json")
        self.assertEqual(short.status_code, 400)
        self.assertFalse(StockLevel.objects.filter(car=car, quantity__gt=0).exists())  # nothing moved
        ok = self.client.post("/api/locations/transfers/", {"to_car": car.pk, "lines": [
            {"product": a.id, "quantity": 3}, {"product": b.id, "quantity": 2}]}, format="json")
        self.assertEqual(ok.status_code, 201, ok.content)
        self.assertEqual(StockLevel.objects.get(product=a, car=car).quantity, D("3"))
        self.assertEqual(StockLevel.objects.get(product=b, car=car).quantity, D("2"))

    def test_partly_received_order_shows_in_the_account(self):
        a = self.product("Panel", cost="0", stock=0)
        sup = self.supplier()
        po = self.make_po([(a, 10, "100")], account=sup)
        self.client.post(f"/api/purchases/po/{po['id']}/receive/",
                         {"items": [{"item": po["items"][0]["id"], "quantity": 1}]}, format="json")
        row = self.client.get(f"/api/accounts/{sup}/").data
        self.assertEqual(row["open_orders"][0]["state"], "مستلم جزئياً")
        self.assertEqual(PurchaseOrder.objects.get(pk=po["id"]).status, "PARTIAL")

    def test_cash_box_lines_follow_entry_order(self):
        a = self.product("Panel", cost="0", stock=0)
        po = self.make_po([(a, 1, "100")])
        self.client.post(f"/api/purchases/po/{po['id']}/add-payment/", {"amount": "60"}, format="json")  # out first
        self.client.post("/api/invoice/expenses/", {"type": "INCOME", "category": "OTHER_INCOME",
                                                    "description": "in", "amount": "10"}, format="json")
        rows = self.client.get("/api/cashbox/statement/?currency=USD").data  # newest first
        self.assertEqual([D(r["amount"]) for r in rows], [D("10"), D("-60")])

    def test_owner_example_transport_shared_by_value(self):
        """10 panels at $100 + 100 m of cable at $1, $110 transport: panel $110, cable $1.10 per metre."""
        panel = self.product("Panel", cost="0", stock=0)
        cable = Product.objects.create(name="Cable", unit_cost=D("0"), selling_price=D("2"), allow_decimal=True)
        po = self.make_po([(panel, 10, "100"), (cable, 100, "1")], transport_cost="110", transport_payee="CARRIER")
        self.client.post(f"/api/purchases/po/{po['id']}/receive/")
        self.assertEqual(self.cost(panel), D("110"))
        self.assertEqual(self.cost(cable), D("1.10"))
