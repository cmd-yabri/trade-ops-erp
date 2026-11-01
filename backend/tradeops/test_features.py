"""Tests for the optional modules: money boxes (USD/SYP), partners, wholesale accounts."""
from rest_framework.test import APIClient

from invoice import services as finance
from order.models import SalesOrder

from datetime import date, datetime, timedelta

from .tests import Base, D


def backdate(order_id, days=2):
    """A sale made `days` ago, so a period can be closed over it (periods must end before today)."""
    from order.models import SalesOrder

    SalesOrder.objects.filter(pk=order_id).update(finalized_at=datetime.now() - timedelta(days=days))


class MoneyBoxTests(Base):
    def enable(self, **flags):
        self.assertEqual(self.client.put("/api/system/features/", flags, format="json").status_code, 200)

    def box(self, currency):
        rows = self.client.get("/api/cashbox/boxes/").data
        return D([r for r in rows if r["currency"] == currency][0]["balance"])

    def test_syp_payment_needs_the_feature_and_a_rate(self):
        p = self.product(stock=10, price="150")
        oid = self.order(p, qty=2, price="150")  # 300 USD
        body = {"currency": "SYP", "paid_amount": "1500000", "exchange_rate": "15000"}
        self.assertEqual(self.client.post(f"/api/orders/sales/{oid}/payments/", body, format="json").status_code, 403)
        self.enable(money_boxes=True)
        no_rate = self.client.post(f"/api/orders/sales/{oid}/payments/", {"currency": "SYP", "paid_amount": "100"}, format="json")
        self.assertEqual(no_rate.status_code, 400)
        ok = self.client.post(f"/api/orders/sales/{oid}/payments/", body, format="json")
        self.assertEqual(ok.status_code, 201, ok.content)
        order = SalesOrder.objects.get(pk=oid)
        self.assertEqual(order.total_paid, D("100"))  # 1,500,000 / 15,000 USD
        self.assertEqual(order.remaining, D("200"))
        self.assertEqual(self.box("SYP"), D("1500000"))
        self.assertEqual(self.box("USD"), D("0"))

    def test_usd_payment_and_expenses_move_the_usd_box(self):
        self.enable(money_boxes=True)
        p = self.product(stock=10)
        oid = self.order(p, qty=1, price="150")
        self.client.post(f"/api/orders/sales/{oid}/payments/", {"amount": "150"}, format="json")
        self.client.post("/api/invoice/expenses/", {"type": "EXPENSE", "category": "RENT", "description": "Rent", "amount": "40"}, format="json")
        self.client.post("/api/invoice/expenses/", {"type": "EXPENSE", "category": "FUEL", "description": "Fuel",
                                                    "currency": "SYP", "paid_amount": "300000", "exchange_rate": "15000"}, format="json")
        self.assertEqual(self.box("USD"), D("110"))
        self.assertEqual(self.box("SYP"), D("-300000"))
        # the SYP fuel counts as 20 USD in the accounting
        self.assertEqual(finance.totals()["total_operational_expenses"], D("60"))

    def test_pay_everything_in_syp_is_allowed_despite_rounding(self):
        self.enable(money_boxes=True)
        p = self.product(stock=10)
        oid = self.order(p, qty=1, price="100")
        res = self.client.post(f"/api/orders/sales/{oid}/payments/",
                               {"currency": "SYP", "paid_amount": "1500000", "exchange_rate": "15000"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(SalesOrder.objects.get(pk=oid).payment_status, "paid")

    def test_exchange_both_directions_and_insufficient_funds(self):
        self.enable(money_boxes=True)

        def deposit(cur, amt):
            return self.client.post("/api/cashbox/entries/", {"currency": cur, "kind": "DEPOSIT", "amount": amt}, format="json")

        self.assertEqual(deposit("SYP", "3000000").status_code, 201)
        too_much = self.client.post("/api/cashbox/exchanges/", {"from_currency": "SYP", "from_amount": "9000000", "rate": "15000"}, format="json")
        self.assertEqual(too_much.status_code, 400)
        ok = self.client.post("/api/cashbox/exchanges/", {"from_currency": "SYP", "from_amount": "1500000", "rate": "15000"}, format="json")
        self.assertEqual(ok.status_code, 201, ok.content)
        self.assertEqual(self.box("SYP"), D("1500000"))
        self.assertEqual(self.box("USD"), D("100"))
        back = self.client.post("/api/cashbox/exchanges/", {"from_currency": "USD", "from_amount": "40", "rate": "16000"}, format="json")
        self.assertEqual(back.status_code, 201)
        self.assertEqual(self.box("USD"), D("60"))
        self.assertEqual(self.box("SYP"), D("2140000"))
        statement = self.client.get("/api/cashbox/statement/?currency=SYP").data
        self.assertEqual(D(statement[0]["balance"]), D("2140000"))
        withdraw = self.client.post("/api/cashbox/entries/", {"currency": "USD", "kind": "WITHDRAWAL", "amount": "1000"}, format="json")
        self.assertEqual(withdraw.status_code, 400)

    def test_editing_a_manual_movement_updates_its_statement_and_balance(self):
        self.enable(money_boxes=True)
        created = self.client.post("/api/cashbox/entries/", {
            "currency": "USD", "kind": "DEPOSIT", "amount": "100", "note": "قديم",
        }, format="json")
        self.assertEqual(created.status_code, 201)
        movement = self.client.get("/api/cashbox/statement/?currency=USD").data[0]
        changed = self.client.put("/api/cashbox/movements/", {
            "ref": movement["ref"], "currency": "USD", "amount": "125",
            "date": "2026-10-25", "note": "رصيد افتتاحي صحيح",
        }, format="json")
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertEqual(self.box("USD"), D("125"))
        row = self.client.get("/api/cashbox/statement/?currency=USD").data[0]
        self.assertEqual(row["description"], "رصيد افتتاحي صحيح")
        self.assertEqual(D(row["amount"]), D("125"))
        self.assertEqual(row["date"].isoformat(), "2026-10-25")

    def test_editing_a_sale_payment_updates_the_order_and_cashbox(self):
        self.enable(money_boxes=True)
        product = self.product(stock=10)
        order_id = self.order(product, qty=1, price="150")
        self.assertEqual(self.client.post(f"/api/orders/sales/{order_id}/payments/",
                                          {"amount": "50"}, format="json").status_code, 201)
        movement = self.client.get("/api/cashbox/statement/?currency=USD").data[0]
        changed = self.client.put("/api/cashbox/movements/", {
            "ref": movement["ref"], "currency": "USD", "amount": "70", "date": str(date.today()),
        }, format="json")
        self.assertEqual(changed.status_code, 200, changed.content)
        order = SalesOrder.objects.get(pk=order_id)
        self.assertEqual(order.total_paid, D("70"))
        self.assertEqual(self.box("USD"), D("70"))

    def test_editing_a_supplier_payment_updates_the_purchase_balance(self):
        self.enable(money_boxes=True)
        product = self.product(stock=0)
        po = self.client.post("/api/purchases/po/", {
            "supplier": "Supplier",
            "items": [{"product": product.pk, "quantity": "1", "unit_cost": "100"}],
        }, format="json")
        self.assertEqual(po.status_code, 201, po.content)
        self.assertEqual(self.client.post(f"/api/purchases/po/{po.data['id']}/add-payment/",
                                          {"amount": "20"}, format="json").status_code, 201)
        movement = self.client.get("/api/cashbox/statement/?currency=USD").data[0]
        changed = self.client.put("/api/cashbox/movements/", {
            "ref": movement["ref"], "currency": "USD", "amount": "30", "date": str(date.today()),
        }, format="json")
        self.assertEqual(changed.status_code, 200, changed.content)
        from purchase_order.models import POPayment

        self.assertEqual(POPayment.objects.get(purchase_order_id=po.data["id"]).amount, D("30"))
        self.assertEqual(self.box("USD"), D("-30"))

    def test_editing_a_partner_withdrawal_updates_partner_and_box(self):
        self.enable(partners=True, money_boxes=True)
        partner = self.client.post("/api/partners/", {
            "name": "Partner", "share_percent": "100",
        }, format="json")
        self.assertEqual(partner.status_code, 201, partner.content)
        self.assertEqual(self.client.post("/api/partners/withdrawals/", {
            "partner": partner.data["id"], "amount": "20", "note": "سحب",
        }, format="json").status_code, 201)
        movement = self.client.get("/api/cashbox/statement/?currency=USD").data[0]
        changed = self.client.put("/api/cashbox/movements/", {
            "ref": movement["ref"], "currency": "USD", "amount": "30", "date": str(date.today()),
            "note": "سحب معدل",
        }, format="json")
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertEqual(self.box("USD"), D("-30"))
        detail = self.client.get(f"/api/partners/{partner.data['id']}/").data
        self.assertEqual(D(detail["withdrawn_total"]), D("30"))

    def test_editing_a_sale_refund_updates_the_refund_source_and_cash(self):
        self.enable(money_boxes=True)
        product = self.product(stock=10)
        order_id = self.order(product, qty=2, price="150")
        self.client.post(f"/api/orders/sales/{order_id}/finalize/")
        self.assertEqual(self.client.post(f"/api/orders/sales/{order_id}/payments/",
                                          {"amount": "300"}, format="json").status_code, 201)
        order = self.client.get(f"/api/orders/sales/{order_id}/").data
        returned = self.client.post(f"/api/orders/sales/{order_id}/returns/", {
            "lines": [{"item": order["items"][0]["id"], "quantity": "1"}],
            "money_action": "refund",
        }, format="json")
        self.assertEqual(returned.status_code, 201, returned.content)
        movement = next(row for row in self.client.get("/api/cashbox/statement/?currency=USD").data
                        if row["kind"] == "sale_refund")
        changed = self.client.put("/api/cashbox/movements/", {
            "ref": movement["ref"], "currency": "USD", "amount": "100",
            "date": str(date.today()), "note": "استرداد معدل",
        }, format="json")
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertEqual(self.box("USD"), D("200"))
        self.assertEqual(D(self.client.get(f"/api/orders/sales/{order_id}/").data["returns"][0]["refund_amount"]),
                         D("100"))

    def test_editing_an_expense_updates_the_cashbox_and_financials(self):
        self.enable(money_boxes=True)
        created = self.client.post("/api/invoice/expenses/", {
            "type": "EXPENSE", "category": "RENT", "description": "إيجار قديم", "amount": "40",
        }, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        movement = self.client.get("/api/cashbox/statement/?currency=USD").data[0]
        changed = self.client.put("/api/cashbox/movements/", {
            "ref": movement["ref"], "currency": "USD", "amount": "65",
            "date": str(date.today()), "note": "إيجار جديد",
        }, format="json")
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertEqual(self.box("USD"), D("-65"))
        self.assertEqual(D(self.client.get("/api/invoice/financial_summary/").data["total_operational_expenses"]),
                         D("65"))
        self.assertEqual(self.client.get("/api/cashbox/statement/?currency=USD").data[0]["description"], "إيجار جديد")

    def test_editing_carrier_freight_updates_the_purchase_cost_source(self):
        self.enable(money_boxes=True)
        from invoice.models import Expense

        product = self.product(stock=0)
        po = self.client.post("/api/purchases/po/", {
            "supplier": "Walk-in supplier",
            "items": [{"product": product.pk, "quantity": "1", "unit_cost": "100"}],
            "transport_cost": "20",
            "transport_payee": "CARRIER",
        }, format="json")
        self.assertEqual(po.status_code, 201, po.content)
        expense = Expense.objects.get(purchase_order_id=po.data["id"])
        movement = self.client.get("/api/cashbox/statement/?currency=USD").data[0]
        changed = self.client.put("/api/cashbox/movements/", {
            "ref": movement["ref"], "currency": "USD", "amount": "25",
            "date": str(date.today()), "note": "نقل معدل",
        }, format="json")
        self.assertEqual(changed.status_code, 200, changed.content)
        expense.refresh_from_db()
        self.assertEqual(expense.amount, D("25"))
        self.assertEqual(expense.description, "نقل معدل")
        self.assertEqual(self.box("USD"), D("-25"))
        self.assertEqual(D(self.client.get(f"/api/purchases/po/{po.data['id']}/").data["transport_cost"]), D("25"))

    def test_editing_an_exchange_keeps_both_box_sides_consistent(self):
        self.enable(money_boxes=True)
        self.client.post("/api/cashbox/entries/", {
            "currency": "SYP", "kind": "DEPOSIT", "amount": "2000000",
        }, format="json")
        self.assertEqual(self.client.post("/api/cashbox/exchanges/", {
            "from_currency": "SYP", "from_amount": "1500000", "rate": "15000",
        }, format="json").status_code, 201)
        movement = self.client.get("/api/cashbox/statement/?currency=USD").data[0]
        changed = self.client.put("/api/cashbox/movements/", {
            "ref": movement["ref"], "currency": "USD", "amount": "120", "rate": "15000",
            "date": str(date.today()), "note": "تصحيح التحويل",
        }, format="json")
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertEqual(self.box("USD"), D("120"))
        self.assertEqual(self.box("SYP"), D("200000"))

    def test_editing_an_account_payment_rebuilds_its_allocations(self):
        self.enable(accounts=True, money_boxes=True)
        from accounts.models import Account, AccountPayment

        account_id = Account.objects.create(name="Customer", is_customer=True).pk
        product = self.product(stock=10)
        order_id = self.order(product, qty=1, price="150")
        SalesOrder.objects.filter(pk=order_id).update(account_id=account_id)
        created = self.client.post(f"/api/accounts/{account_id}/payments/", {
            "direction": "IN", "amount": "40",
        }, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        movement = self.client.get("/api/cashbox/statement/?currency=USD").data[0]
        changed = self.client.put("/api/cashbox/movements/", {
            "ref": movement["ref"], "currency": "USD", "amount": "70", "date": str(date.today()),
            "note": "دفعة معدلة",
        }, format="json")
        self.assertEqual(changed.status_code, 200, changed.content)

        payment = AccountPayment.objects.get(account_id=account_id)
        self.assertEqual(payment.amount, D("70"))
        self.assertEqual(payment.client_payments.get().amount, D("70"))
        self.assertEqual(self.box("USD"), D("70"))

    def test_cashbox_is_admin_only(self):
        self.enable(money_boxes=True)
        staff = self.login(self.staff, APIClient())
        self.assertEqual(staff.get("/api/cashbox/boxes/").status_code, 403)
        self.assertEqual(staff.post("/api/cashbox/exchanges/", {}, format="json").status_code, 403)
        self.assertEqual(staff.put("/api/cashbox/movements/", {}, format="json").status_code, 403)


class PartnerTests(Base):
    def setUp(self):
        super().setUp()
        self.client.put("/api/system/features/", {"partners": True, "money_boxes": True}, format="json")

    def partner(self, name, pct):
        res = self.client.post("/api/partners/", {"name": name, "share_percent": pct}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.data["id"]

    def make_profit(self):
        p = self.product(stock=10, cost="100", price="300")
        oid = self.order(p, qty=2, price="300")  # revenue 600, cost 200 -> profit 400
        self.client.post(f"/api/orders/sales/{oid}/finalize/")
        backdate(oid)

    def rows(self):
        return {r["name"]: r for r in self.client.get("/api/partners/").data["partners"]}

    def box(self, currency):
        rows = self.client.get("/api/cashbox/boxes/").data
        return D([row for row in rows if row["currency"] == currency][0]["balance"])

    def test_settlement_splits_profit_and_resets_the_period(self):
        a, b, c = self.partner("A", "50"), self.partner("B", "30"), self.partner("C", "20")
        self.make_profit()
        # first of the month: A and C take money; one of them in SYP
        self.client.post("/api/partners/withdrawals/", {"partner": a, "amount": "100"}, format="json")
        self.client.post("/api/partners/withdrawals/", {"partner": c, "currency": "SYP", "paid_amount": "150000", "exchange_rate": "15000"}, format="json")
        rows = self.rows()
        self.assertEqual(D(rows["A"]["undistributed"]), D("200"))
        self.assertEqual(D(rows["A"]["balance"]), D("-100"))  # an advance, not yet settled

        preview = self.client.get("/api/partners/settlement/preview/").data
        self.assertEqual(D(preview["net_profit"]), D("400"))
        res = self.client.post("/api/partners/settlements/", {"note": "Oct"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)

        rows = self.rows()
        self.assertEqual(D(rows["A"]["undistributed"]), D("0"))  # profit is back to zero for the new period
        self.assertEqual(D(rows["A"]["balance"]), D("100"))  # 200 share - 100 taken
        self.assertEqual(D(rows["B"]["balance"]), D("120"))
        self.assertEqual(D(rows["C"]["balance"]), D("70"))  # 80 share - 10 USD (150,000 SYP)
        # The withdrawal paid in SYP left the SYP box
        boxes = {r["currency"]: D(r["balance"]) for r in self.client.get("/api/cashbox/boxes/").data}
        self.assertEqual(boxes["SYP"], D("-150000"))
        self.assertEqual(boxes["USD"], D("-100"))
        # nothing new to close the same day; undoing the close restores the period
        self.assertEqual(self.client.post("/api/partners/settlements/", {}, format="json").status_code, 400)
        sid = self.client.get("/api/partners/settlements/").data[0]["id"]
        self.assertEqual(self.client.delete(f"/api/partners/settlements/{sid}/").status_code, 204)
        self.assertEqual(D(self.rows()["A"]["undistributed"]), D("200"))

    def test_percentages_must_total_100(self):
        self.partner("A", "60")
        self.partner("B", "30")
        self.make_profit()
        self.assertEqual(self.client.post("/api/partners/settlements/", {}, format="json").status_code, 400)

    def opening_data(self, lines, **extra):
        return {"as_of": (date.today() - timedelta(days=1)).isoformat(), "lines": lines, **extra}

    def test_opening_gives_each_partner_their_own_profit_without_cash_or_current_profit(self):
        a, b = self.partner("A", "60"), self.partner("B", "40")
        self.make_profit()
        data = self.opening_data([
            {"partner": a, "net_profit": "700.00", "withdrawn_amount": "200.00"},
            {"partner": b, "net_profit": "-50.00", "withdrawn_amount": "500.00"},
        ])

        response = self.client.post("/api/partners/opening/", data, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        rows = self.rows()
        self.assertEqual(D(rows["A"]["balance"]), D("500"))
        self.assertEqual(D(rows["B"]["balance"]), D("-550"))
        self.assertEqual(D(rows["A"]["withdrawn_total"]), D("200"))
        self.assertEqual(D(rows["B"]["withdrawn_total"]), D("500"))

        overview = self.client.get("/api/partners/").data
        self.assertTrue(overview["opening_configured"])
        self.assertEqual(overview["period_start"], date.today())
        self.assertEqual(D(overview["period_net_profit"]), D("0"))
        self.assertEqual(self.box("USD"), D("0"))
        self.assertEqual(self.box("SYP"), D("0"))

        detail = self.client.get(f"/api/partners/{a}/").data
        self.assertEqual(D(detail["opening"]["net_profit"]), D("700"))
        self.assertEqual(D(detail["opening"]["withdrawn_amount"]), D("200"))

    def test_opening_ignores_percentages_and_accepts_any_partners(self):
        a, b = self.partner("A", "60"), self.partner("B", "10")  # percentages do not total 100
        c = self.partner("C", "0")
        created = self.client.post("/api/partners/opening/", self.opening_data([
            {"partner": a, "net_profit": "300"},
            {"partner": c, "net_profit": "120", "withdrawn_amount": "20"},
        ]), format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(D(created.data["opening"]["net_profit"]), D("420"))
        rows = self.rows()
        self.assertEqual(D(rows["A"]["balance"]), D("300"))
        self.assertEqual(D(rows["B"]["balance"]), D("0"))
        self.assertEqual(D(rows["C"]["balance"]), D("100"))

        # B was left out; add B and change A later, whatever the percentages are
        edited = self.client.put("/api/partners/opening/", self.opening_data([
            {"partner": a, "net_profit": "350"},
            {"partner": b, "net_profit": "80"},
            {"partner": c, "net_profit": "120", "withdrawn_amount": "20"},
        ]), format="json")
        self.assertEqual(edited.status_code, 200, edited.content)
        rows = self.rows()
        self.assertEqual(D(rows["A"]["balance"]), D("350"))
        self.assertEqual(D(rows["B"]["balance"]), D("80"))

    def test_opening_can_be_corrected_before_but_not_after_a_settlement(self):
        a, b = self.partner("A", "60"), self.partner("B", "40")
        two_days_ago = (date.today() - timedelta(days=2)).isoformat()
        data = self.opening_data([{"partner": a, "net_profit": "600"}, {"partner": b, "net_profit": "400"}], as_of=two_days_ago)
        self.assertEqual(self.client.post("/api/partners/opening/", data, format="json").status_code, 201)
        edited = self.opening_data([{"partner": a, "net_profit": "720"}, {"partner": b, "net_profit": "480"}], as_of=two_days_ago)
        updated = self.client.put("/api/partners/opening/", edited, format="json")
        self.assertEqual(updated.status_code, 200, updated.content)
        self.assertEqual(D(self.rows()["A"]["balance"]), D("720"))

        settled = self.client.post("/api/partners/settlements/", {}, format="json")
        self.assertEqual(settled.status_code, 201, settled.content)
        self.assertEqual(self.client.put("/api/partners/opening/", data, format="json").status_code, 400)

    def test_prior_profit_lines_per_partner_and_period(self):
        a, b = self.partner("A", "60"), self.partner("B", "40")
        yesterday = date.today() - timedelta(days=1)
        january = {"partner": a, "period_start": "2026-01-01", "period_end": "2026-01-31", "amount": "300.00"}
        created = self.client.post("/api/partners/prior-profits/", january, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.client.post("/api/partners/prior-profits/", {
            "partner": a, "period_end": yesterday.isoformat(), "amount": "-50", "note": "خسارة",
        }, format="json")
        self.client.post("/api/partners/prior-profits/", {
            "partner": b, "period_end": "2026-01-31", "amount": "120",
        }, format="json")

        rows = self.rows()
        self.assertEqual(D(rows["A"]["balance"]), D("250"))
        self.assertEqual(D(rows["A"]["prior_profit_total"]), D("250"))
        self.assertEqual(D(rows["B"]["balance"]), D("120"))
        # it is not cash and not current profit
        self.assertEqual(self.box("USD"), D("0"))
        self.assertEqual(D(self.client.get("/api/partners/").data["period_net_profit"]), D("0"))

        detail = self.client.get(f"/api/partners/{a}/").data
        self.assertEqual([D(line["amount"]) for line in detail["prior_profits"]], [D("-50"), D("300")])

        edited = self.client.put(f"/api/partners/prior-profits/{created.data['id']}/", {**january, "amount": "400"}, format="json")
        self.assertEqual(edited.status_code, 200, edited.content)
        self.assertEqual(D(self.rows()["A"]["balance"]), D("350"))
        self.assertEqual(self.client.delete(f"/api/partners/prior-profits/{created.data['id']}/").status_code, 204)
        self.assertEqual(D(self.rows()["A"]["balance"]), D("-50"))

    def test_prior_profit_validation(self):
        a = self.partner("A", "100")
        url = "/api/partners/prior-profits/"
        today = date.today().isoformat()
        self.assertEqual(self.client.post(url, {"partner": a, "period_end": today, "amount": "10"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {"partner": a, "period_end": "2026-01-31", "amount": "0"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {
            "partner": a, "period_start": "2026-02-01", "period_end": "2026-01-31", "amount": "10",
        }, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {"partner": a, "period_end": "2026-01-31", "amount": "10"}, format="json").status_code, 201)
        self.assertEqual(self.client.delete(f"/api/partners/{a}/").status_code, 409)

    def test_opening_validation_and_one_time(self):
        a = self.partner("A", "100")
        base = self.opening_data([{"partner": a, "net_profit": "1000"}])
        self.assertEqual(self.client.post("/api/partners/opening/", {**base, "lines": []}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/partners/opening/", {
            **base, "lines": [{"partner": a, "net_profit": "1"}, {"partner": a, "net_profit": "2"}],
        }, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/partners/opening/", {
            **base, "lines": [{"partner": 999, "net_profit": "1"}],
        }, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/partners/opening/", {
            **base, "as_of": date.today().isoformat(),
        }, format="json").status_code, 400)

        created = self.client.post("/api/partners/opening/", base, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        duplicate = self.client.post("/api/partners/opening/", base, format="json")
        self.assertEqual(duplicate.status_code, 409, duplicate.content)

    def test_partners_are_admin_only_and_feature_gated(self):
        staff = self.login(self.staff, APIClient())
        self.assertEqual(staff.get("/api/partners/").status_code, 403)
        self.client.put("/api/system/features/", {"partners": False}, format="json")
        self.assertEqual(self.client.get("/api/partners/").status_code, 403)


class SypDecimalTests(Base):
    """SYP amounts keep their cents everywhere (deposit, payment, exchange, withdrawal, statement)."""

    def test_syp_cents_survive_every_path(self):
        self.client.put("/api/system/features/", {"money_boxes": True, "partners": True}, format="json")
        post = lambda url, body: self.client.post(url, body, format="json")
        self.assertEqual(post("/api/cashbox/entries/", {"currency": "SYP", "kind": "DEPOSIT", "amount": "1000000.55"}).status_code, 201)
        p = self.product(stock=5, price="100")
        oid = self.order(p, qty=1, price="100")
        res = post(f"/api/orders/sales/{oid}/payments/", {"currency": "SYP", "paid_amount": "745000.25", "exchange_rate": "14900.5"})
        self.assertEqual(res.status_code, 201, res.content)
        pid = post("/api/partners/", {"name": "A", "share_percent": "100"}).data["id"]
        self.assertEqual(post("/api/partners/withdrawals/", {"partner": pid, "currency": "SYP", "paid_amount": "100.10", "exchange_rate": "15000"}).status_code, 201)
        swap = post("/api/cashbox/exchanges/", {"from_currency": "SYP", "from_amount": "29801.01", "rate": "14900.5"})
        self.assertEqual(swap.status_code, 201, swap.content)
        boxes = {r["currency"]: D(r["balance"]) for r in self.client.get("/api/cashbox/boxes/").data}
        # 1,000,000.55 + 745,000.25 - 100.10 - 29,801.01 = 1,715,099.69
        self.assertEqual(boxes["SYP"], D("1715099.69"))
        stmt = self.client.get("/api/cashbox/statement/?currency=SYP").data
        self.assertEqual(D(stmt[0]["balance"]), D("1715099.69"))
        self.assertTrue(any(D(r["amount"]) == D("745000.25") for r in stmt))
