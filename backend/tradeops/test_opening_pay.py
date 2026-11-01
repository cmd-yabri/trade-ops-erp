"""Opening stock paid from a cash box (supplier optional, linkable later) and the money journal in Financials."""
from rest_framework.test import APIClient

from inventory.models import OpeningStock, Product
from invoice.models import Expense

from . import test_phase3
from .tests import Base, D


class OpeningPayTests(Base):
    # the Phase 3 helpers, without running its tests again
    _p3 = test_phase3.Phase3Tests
    account, new_product, sale = _p3.account, _p3.new_product, _p3.sale
    balance, usd_box = _p3.balance, _p3.usd_box

    def setUp(self):
        super().setUp()
        self.client.put("/api/system/features/", {"accounts": True, "money_boxes": True}, format="json")

    def paid_product(self, stock=10, cost="100", **payment):
        res = self.client.post("/api/inventory/products/", {
            "name": "Panel", "unit_cost": cost, "selling_price": "150", "current_stock": stock,
            "opening_payment": payment or {"currency": "USD", "amount": str(D(cost) * stock)},
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.data["id"]

    def test_new_stock_paid_from_the_box(self):
        p = self.paid_product()
        self.assertEqual(self.usd_box(), D("-1000"))
        opening = OpeningStock.objects.get(product_id=p)
        row = self.client.get("/api/inventory/opening/").data[0]
        self.assertEqual(D(str(row["paid"]["amount"])), D("1000"))
        self.assertEqual(row["supplier"], "")
        # a goods purchase: cash out but no profit deduction
        self.assertEqual(Expense.objects.get(opening_stock=opening).category, Expense.STOCK_CATEGORY)
        summary = self.client.get("/api/invoice/financial_summary/").data
        self.assertEqual(D(str(summary["net_profit"])), D("0"))
        # it is changed from the opening stock, not from the expenses list
        exp = Expense.objects.get(opening_stock=opening)
        self.assertEqual(self.client.delete(f"/api/invoice/expenses/{exp.pk}/").status_code, 400)

    def test_old_stock_is_not_paid_and_can_be_paid_later(self):
        p = self.new_product(stock=4, cost="50")
        opening = OpeningStock.objects.get(product_id=p)
        self.assertIsNone(self.client.get("/api/inventory/opening/").data[0]["paid"])
        self.assertEqual(self.usd_box(), D("0"))
        res = self.client.post(f"/api/inventory/opening/{opening.pk}/pay/", {"amount": "200"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(self.usd_box(), D("-200"))
        self.assertEqual(self.client.post(f"/api/inventory/opening/{opening.pk}/pay/", {"amount": "200"},
                                          format="json").status_code, 400)  # paid once
        self.assertEqual(self.client.delete(f"/api/inventory/opening/{opening.pk}/pay/").status_code, 200)
        self.assertEqual(self.usd_box(), D("0"))

    def test_paid_in_syp(self):
        p = self.paid_product(stock=2, cost="100", currency="SYP", paid_amount="3000000", exchange_rate="15000")
        opening = OpeningStock.objects.get(product_id=p)
        exp = Expense.objects.get(opening_stock=opening)
        self.assertEqual((exp.amount, exp.cash_amount), (D("200"), D("3000000")))
        syp = {r["currency"]: D(r["balance"]) for r in self.client.get("/api/cashbox/boxes/").data}["SYP"]
        self.assertEqual(syp, D("-3000000"))

    def test_correcting_opening_payment_in_syp_updates_the_syp_box(self):
        product_id = self.paid_product(
            stock=2, cost="100", currency="SYP", paid_amount="3000000", exchange_rate="15000",
        )
        opening = OpeningStock.objects.get(product_id=product_id)
        corrected = self.client.put(
            f"/api/inventory/opening/{opening.pk}/pay/",
            {"currency": "SYP", "paid_amount": "1500000", "exchange_rate": "15000"},
            format="json",
        )
        self.assertEqual(corrected.status_code, 200, corrected.content)
        syp = {r["currency"]: D(r["balance"]) for r in self.client.get("/api/cashbox/boxes/").data}["SYP"]
        self.assertEqual(syp, D("-1500000"))
        self.assertEqual(D(corrected.data["paid"]["amount"]), D("100"))

    def test_product_edit_can_atomically_correct_its_opening_payment(self):
        product_id = self.paid_product(stock=10, cost="100")
        opening = OpeningStock.objects.get(product_id=product_id)

        corrected = self.client.put(
            f"/api/inventory/products/{product_id}/",
            {
                "current_stock": 5,
                "unit_cost": "80",
                "stock_reason": "تصحيح الكمية والتكلفة",
                "opening_payment_correction": {
                    "opening_id": opening.pk,
                    "payment": {"currency": "USD", "amount": "400"},
                },
            },
            format="json",
        )

        self.assertEqual(corrected.status_code, 200, corrected.content)
        self.assertEqual(D(corrected.data["current_stock"]), D("5"))
        self.assertEqual(Expense.objects.get(opening_stock=opening).amount, D("400"))
        opening.refresh_from_db()
        self.assertEqual(opening.quantity, D("5"))
        self.assertEqual(opening.unit_cost, D("80"))
        self.assertEqual(opening.value, D("400"))
        self.assertEqual(self.usd_box(), D("-400"))

    def test_product_edit_without_cashbox_choice_keeps_payment_unchanged(self):
        product_id = self.paid_product(stock=10, cost="100")
        opening = OpeningStock.objects.get(product_id=product_id)

        edited = self.client.put(
            f"/api/inventory/products/{product_id}/",
            {"current_stock": 5, "unit_cost": "80", "stock_reason": "تصحيح الكمية والتكلفة"},
            format="json",
        )

        self.assertEqual(edited.status_code, 200, edited.content)
        self.assertEqual(self.usd_box(), D("-1000"))
        opening.refresh_from_db()
        self.assertEqual(opening.quantity, D("5"))
        self.assertEqual(opening.unit_cost, D("80"))
        self.assertEqual(opening.value, D("400"))

    def test_invalid_cashbox_correction_rolls_back_product_edit(self):
        product_id = self.paid_product(stock=10, cost="100")
        opening = OpeningStock.objects.get(product_id=product_id)

        rejected = self.client.put(
            f"/api/inventory/products/{product_id}/",
            {
                "current_stock": 5,
                "unit_cost": "80",
                "stock_reason": "تصحيح الكمية والتكلفة",
                "opening_payment_correction": {
                    "opening_id": opening.pk + 1,
                    "payment": {"currency": "USD", "amount": "400"},
                },
            },
            format="json",
        )

        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(self.stock(Product.objects.get(pk=product_id)), D("10"))
        self.assertEqual(Product.objects.get(pk=product_id).unit_cost, D("100"))
        self.assertEqual(self.usd_box(), D("-1000"))

    def test_linking_a_paid_stock_moves_the_payment_to_the_supplier(self):
        p = self.paid_product(stock=10, cost="100")
        opening = OpeningStock.objects.get(product_id=p)
        sup = self.account("Supplier", supplier=True)
        res = self.client.post(f"/api/inventory/opening/{opening.pk}/link/", {"account": sup}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(self.balance(sup), D("0"))  # owed 1000, paid 1000
        self.assertEqual(self.usd_box(), D("-1000"))  # the same cash, counted once
        self.assertFalse(Expense.objects.filter(opening_stock=opening).exists())
        self.assertEqual(D(res.data["paid"]["amount"]), D("1000"))
        self.assertEqual(res.data["paid"]["currency"], "USD")
        # undoing needs the payment gone first, like any linked order
        self.assertEqual(self.client.delete(f"/api/inventory/opening/{opening.pk}/link/").status_code, 400)

    def test_correcting_linked_opening_payment_updates_supplier_balance(self):
        product_id = self.paid_product(stock=2, cost="40")
        opening = OpeningStock.objects.get(product_id=product_id)
        supplier = self.account("Supplier", supplier=True)
        linked = self.client.post(f"/api/inventory/opening/{opening.pk}/link/", {"account": supplier}, format="json")
        self.assertEqual(linked.status_code, 201, linked.content)
        corrected = self.client.put(
            f"/api/inventory/opening/{opening.pk}/pay/",
            {"amount": "60"},
            format="json",
        )
        self.assertEqual(corrected.status_code, 200, corrected.content)
        self.assertEqual(self.balance(supplier), D("-20"))
        self.assertEqual(self.usd_box(), D("-60"))
        too_large = self.client.put(
            f"/api/inventory/opening/{opening.pk}/pay/",
            {"amount": "81"},
            format="json",
        )
        self.assertEqual(too_large.status_code, 400)

    def test_inventory_edit_syncs_linked_opening_stock_and_supplier_order(self):
        product_id = self.paid_product(stock=10, cost="100")
        opening = OpeningStock.objects.get(product_id=product_id)
        supplier_id = self.account("Opening supplier", supplier=True)
        linked = self.client.post(
            f"/api/inventory/opening/{opening.pk}/link/",
            {"account": supplier_id},
            format="json",
        )
        self.assertEqual(linked.status_code, 201, linked.content)

        edited = self.client.put(
            f"/api/inventory/products/{product_id}/",
            {
                "current_stock": 5,
                "unit_cost": "80",
                "stock_reason": "تصحيح الجرد",
                "opening_payment_correction": {
                    "opening_id": opening.pk,
                    "payment": {"currency": "USD", "amount": "400"},
                },
            },
            format="json",
        )
        self.assertEqual(edited.status_code, 200, edited.content)
        opening.refresh_from_db()
        self.assertEqual((opening.quantity, opening.unit_cost, opening.value), (D("5"), D("80"), D("400")))
        self.assertEqual(self.balance(supplier_id), D("0"))
        self.assertEqual(self.usd_box(), D("-400"))

    def test_staff_cannot_pay_from_a_box(self):
        staff = self.login(self.staff, APIClient())
        res = staff.post("/api/inventory/products/", {"name": "X", "unit_cost": "1", "selling_price": "2",
                                                      "current_stock": 1,
                                                      "opening_payment": {"amount": "1"}}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_period_cash_flow_counts_every_money_movement(self):
        self.paid_product(stock=2, cost="100")  # 200 out: goods
        p = self.new_product(stock=5)
        order = self.sale(p, 2)
        self.client.post(f"/api/orders/sales/{order}/payments/", {"amount": "300"}, format="json")
        self.client.post("/api/invoice/expenses/", {"type": "EXPENSE", "category": "RENT", "description": "rent",
                                                    "amount": "50"}, format="json")
        self.client.post("/api/invoice/expenses/", {"type": "INCOME", "category": "OTHER_INCOME",
                                                    "description": "scrap", "amount": "20"}, format="json")
        self.client.post("/api/cashbox/entries/", {"currency": "USD", "kind": "DEPOSIT", "amount": "1000"},
                         format="json")
        self.client.post("/api/cashbox/exchanges/", {"from_currency": "USD", "from_amount": "100", "rate": "15000"},
                         format="json")  # between the boxes: not income, not expense
        usd = self.client.get("/api/reports/financials/?period=daily").data["cash_flow"]["USD"]
        self.assertEqual(D(str(usd["in"])), D("1320"))
        self.assertEqual(D(str(usd["out"])), D("250"))
        self.assertEqual({k: D(str(v)) for k, v in usd["out_parts"].items()}, {"goods": D("200"), "expenses": D("50")})
        self.assertEqual(D(str(usd["in_parts"]["customers"])), D("300"))

    def test_journal_lists_every_money_movement(self):
        self.paid_product(stock=1, cost="100")
        p = self.new_product(stock=5)
        order = self.sale(p, 2)
        self.client.post(f"/api/orders/sales/{order}/payments/", {"amount": "300"}, format="json")
        self.client.post("/api/invoice/expenses/", {"type": "EXPENSE", "category": "RENT", "description": "rent",
                                                    "amount": "50"}, format="json")
        self.client.post("/api/invoice/expenses/", {"type": "INCOME", "category": "OTHER_INCOME",
                                                    "description": "scrap", "amount": "20"}, format="json")
        self.client.post("/api/cashbox/entries/", {"currency": "SYP", "kind": "DEPOSIT", "amount": "100000"},
                         format="json")
        rows = self.client.get("/api/invoice/journal/").data
        kinds = sorted(r["kind"] for r in rows)
        self.assertEqual(kinds, ["deposit", "expense", "expense", "income", "sale_payment"])
        self.assertIn("STOCK", [r.get("category") for r in rows])
        self.assertEqual({r["currency"] for r in rows}, {"USD", "SYP"})
        staff = self.login(self.staff, APIClient())
        self.assertEqual(staff.get("/api/invoice/journal/").status_code, 403)
