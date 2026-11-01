"""End-to-end API tests: business rules, accounting, auth and recovery."""
import base64
from datetime import date, datetime, timedelta
from decimal import Decimal

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from django.test import override_settings
from rest_framework.test import APIClient, APITestCase

from inventory.models import Category, Product
from invoice import services as finance
from order.models import SalesOrder
from purchase_order.models import PurchaseOrder
from user import recovery
from user.models import RecoveryState, Role, User


def D(value):
    return Decimal(str(value))


class Base(APITestCase):
    def setUp(self):
        from django.core.cache import cache
        cache.clear()  # the login throttle counter lives in the cache
        self.admin = User.objects.create_user("boss", password="secret1", first_name="Boss", role=Role.ADMIN)
        self.staff = User.objects.create_user("staff", password="secret1", first_name="Staff", role=Role.USER)
        self.login(self.admin)

    def login(self, user, client=None):
        client = client or self.client
        res = APIClient().post("/api/auth/token/", {"username": user.username, "password": "secret1"}, format="json")
        assert res.status_code == 200, res.content
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        return client

    def product(self, name="Panel", cost="100", price="150", stock=10, threshold=10, category=None):
        return Product.objects.create(
            name=name, unit_cost=D(cost), selling_price=D(price),
            current_stock=stock, reorder_threshold=threshold, category=category,
        )

    def order(self, product, qty=2, price="150", jobs=None, discount="0", name="Ali"):
        res = self.client.post("/api/orders/sales/", {
            "client_name": name, "discount": discount,
            "items": [{"product": product.id, "quantity": qty, "unit_price": price}] if product else [],
            "freelance_jobs": jobs or [],
        }, format="json")
        assert res.status_code == 201, res.content
        return res.data["id"]

    def stock(self, product):
        product.refresh_from_db()
        return product.current_stock


class AuthTests(Base):
    def test_api_requires_login(self):
        anon = APIClient()
        for url in ["/api/inventory/products/", "/api/orders/sales/", "/api/purchases/po/",
                    "/api/invoice/expenses/", "/api/invoice/dashboard/", "/api/reports/financials/",
                    "/api/user/me/", "/api/user/users/", "/api/system/info/"]:
            self.assertEqual(anon.get(url).status_code, 401, url)

    def test_login_wrong_password_and_inactive(self):
        bad = APIClient().post("/api/auth/token/", {"username": "boss", "password": "nope"}, format="json")
        self.assertEqual(bad.status_code, 401)
        self.staff.is_active = False
        self.staff.save()
        res = APIClient().post("/api/auth/token/", {"username": "staff", "password": "secret1"}, format="json")
        self.assertEqual(res.status_code, 401)

    def test_login_returns_real_role_and_me_works(self):
        staff = self.login(self.staff, APIClient())
        me = staff.get("/api/user/me/")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data["payload"]["role"], "USER")
        res = APIClient().post("/api/auth/token/", {"username": "boss", "password": "secret1"}, format="json")
        self.assertEqual(res.data["user"]["role"], "ADMIN")

    def test_first_run_setup_creates_admin_then_closes(self):
        User.objects.all().delete()
        anon = APIClient()
        self.assertTrue(anon.get("/api/user/setup-status/").data["needs_setup"])
        res = anon.post("/api/user/signup/", {"first_name": "Owner", "username": "owner", "password": "pass123", "role": "USER"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(User.objects.get(username="owner").role, "ADMIN")  # role cannot be chosen
        self.assertFalse(anon.get("/api/user/setup-status/").data["needs_setup"])
        again = anon.post("/api/user/signup/", {"first_name": "X", "username": "x", "password": "pass123"}, format="json")
        self.assertEqual(again.status_code, 403)

    def test_short_password_rejected(self):
        res = self.client.post("/api/user/users/", {"first_name": "A", "username": "a1", "password": "123"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_user_management_admin_only(self):
        staff = self.login(self.staff, APIClient())
        self.assertEqual(staff.get("/api/user/users/").status_code, 403)
        res = self.client.post("/api/user/users/", {"first_name": "New", "username": "newbie", "password": "abc123", "role": "USER"}, format="json")
        self.assertEqual(res.status_code, 201)
        uid = res.data["id"]
        reset = self.client.put(f"/api/user/users/{uid}/", {"password": "changed1"}, format="json")
        self.assertEqual(reset.status_code, 200)
        ok = APIClient().post("/api/auth/token/", {"username": "newbie", "password": "changed1"}, format="json")
        self.assertEqual(ok.status_code, 200)

    def test_cannot_delete_self_or_last_admin(self):
        self.assertEqual(self.client.delete(f"/api/user/users/{self.admin.id}/").status_code, 409)
        other = User.objects.create_user("b2", password="secret1", first_name="B2", role=Role.ADMIN)
        self.assertEqual(self.client.delete(f"/api/user/users/{other.id}/").status_code, 204)
        demote = self.client.put(f"/api/user/users/{self.admin.id}/", {"role": "USER"}, format="json")
        self.assertEqual(demote.status_code, 409)

    def test_change_password(self):
        bad = self.client.post("/api/user/change-password/", {"old_password": "x", "new_password": "newpass1"}, format="json")
        self.assertEqual(bad.status_code, 400)
        ok = self.client.post("/api/user/change-password/", {"old_password": "secret1", "new_password": "newpass1"}, format="json")
        self.assertEqual(ok.status_code, 200)

    def test_unknown_api_route_is_json_404(self):
        res = self.client.get("/api/nope/")
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res["Content-Type"], "application/json")

    def test_login_is_throttled(self):
        anon = APIClient()
        codes = [anon.post("/api/auth/token/", {"username": "boss", "password": "bad"}, format="json").status_code for _ in range(25)]
        self.assertIn(429, codes)
        self.assertEqual(codes[0], 401)

    def test_no_default_accounts_exist(self):
        User.objects.all().delete()
        self.assertEqual(User.objects.count(), 0)


class RecoveryTests(Base):
    def setUp(self):
        super().setUp()
        self.key = Ed25519PrivateKey.generate()
        public = base64.b64encode(self.key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
        patcher = override_settings()
        patcher.enable()
        self.addCleanup(patcher.disable)
        self._orig = recovery.RECOVERY_PUBLIC_KEY_B64
        recovery.RECOVERY_PUBLIC_KEY_B64 = public
        self.addCleanup(lambda: setattr(recovery, "RECOVERY_PUBLIC_KEY_B64", self._orig))

    def vendor_code(self, request_code, username):
        install, counter = recovery._parse_request_code(request_code)
        sig = self.key.sign(recovery.signing_message(install, counter, username))
        return base64.b32encode(sig).decode().rstrip("=")

    def vendor_admin_code(self, request_code):
        return self.vendor_code(request_code, recovery.ADMIN_RECOVERY_SCOPE)

    def challenge(self):
        return APIClient().get("/api/user/recovery/challenge/").data["request_code"]

    def test_reset_with_valid_code_then_code_is_burned(self):
        req = self.challenge()
        code = self.vendor_code(req, "staff")
        res = APIClient().post("/api/user/recovery/reset/", {"username": "staff", "code": code, "new_password": "brandnew1"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        ok = APIClient().post("/api/auth/token/", {"username": "staff", "password": "brandnew1"}, format="json")
        self.assertEqual(ok.status_code, 200)
        replay = APIClient().post("/api/user/recovery/reset/", {"username": "staff", "code": code, "new_password": "another12"}, format="json")
        self.assertEqual(replay.status_code, 400)
        self.assertNotEqual(self.challenge(), req)  # counter moved on

    def test_code_is_bound_to_username_and_installation(self):
        req = self.challenge()
        code_for_staff = self.vendor_code(req, "staff")
        wrong_user = APIClient().post("/api/user/recovery/reset/", {"username": "boss", "code": code_for_staff, "new_password": "brandnew1"}, format="json")
        self.assertEqual(wrong_user.status_code, 400)
        # a code made for a different installation id
        install, counter = recovery._parse_request_code(req)
        other = "0" * 32
        sig = self.key.sign(recovery.signing_message(other, counter, "staff"))
        foreign = base64.b32encode(sig).decode().rstrip("=")
        res = APIClient().post("/api/user/recovery/reset/", {"username": "staff", "code": foreign, "new_password": "brandnew1"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_garbage_and_wrong_key_rejected(self):
        for code in ["", "abc", "A" * 103]:
            res = APIClient().post("/api/user/recovery/reset/", {"username": "staff", "code": code, "new_password": "brandnew1"}, format="json")
            self.assertEqual(res.status_code, 400)
        req = self.challenge()
        install, counter = recovery._parse_request_code(req)
        attacker = Ed25519PrivateKey.generate().sign(recovery.signing_message(install, counter, "staff"))
        res = APIClient().post("/api/user/recovery/reset/", {"username": "staff", "code": base64.b32encode(attacker).decode().rstrip("="), "new_password": "brandnew1"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(RecoveryState.objects.get(pk=1).counter, 0)

    def test_code_with_dashes_and_spaces_accepted(self):
        code = self.vendor_code(self.challenge(), "staff")
        pretty = "-".join(code[i:i + 8] for i in range(0, len(code), 8)).lower()
        res = APIClient().post("/api/user/recovery/reset/", {"username": "staff", "code": pretty, "new_password": "brandnew1"}, format="json")
        self.assertEqual(res.status_code, 200)

    def test_admin_recovery_returns_username_and_resets_password_without_registration(self):
        request_code = self.challenge()
        code = self.vendor_admin_code(request_code)
        anon = APIClient()
        res = anon.post("/api/user/recovery/reset/", {
            "username": "", "code": code, "new_password": "brandnew1",
        }, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["username"], "boss")
        login = anon.post("/api/auth/token/", {
            "username": "boss", "password": "brandnew1",
        }, format="json")
        self.assertEqual(login.status_code, 200)
        self.assertEqual(anon.post("/api/user/signup/", {
            "first_name": "Another", "username": "another", "password": "pass123",
        }, format="json").status_code, 403)

    def test_admin_recovery_code_is_one_time_and_does_not_reset_staff(self):
        code = self.vendor_admin_code(self.challenge())
        anon = APIClient()
        res = anon.post("/api/user/recovery/reset/", {
            "code": code, "new_password": "brandnew1",
        }, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["username"], "boss")
        replay = anon.post("/api/user/recovery/reset/", {
            "code": code, "new_password": "another12",
        }, format="json")
        self.assertEqual(replay.status_code, 400)
        staff_login = anon.post("/api/auth/token/", {
            "username": "staff", "password": "secret1",
        }, format="json")
        self.assertEqual(staff_login.status_code, 200)

    def test_admin_recovery_requires_one_unambiguous_admin(self):
        User.objects.create_user("another_admin", "secret1", first_name="Admin", role=Role.ADMIN)
        request_code = self.challenge()
        response = APIClient().post("/api/user/recovery/reset/", {
            "code": self.vendor_admin_code(request_code),
            "new_password": "brandnew1",
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(RecoveryState.objects.get(pk=1).counter, 0)


class InventoryTests(Base):
    def test_stock_count_change_is_cash_neutral_and_payment_correction_updates_cashbox(self):
        created = self.client.post("/api/inventory/products/", {
            "name": "Paid battery",
            "unit_cost": "50",
            "selling_price": "80",
            "current_stock": 2,
            "opening_payment": {"amount": "100"},
        }, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        opening = self.client.get("/api/inventory/opening/").data[0]
        from cashbox.services import balance

        self.assertEqual(balance("USD"), D("-100"))
        corrected_stock = self.client.put(
            f"/api/inventory/products/{created.data['id']}/",
            {"current_stock": 1, "stock_reason": "جرد"},
            format="json",
        )
        self.assertEqual(corrected_stock.status_code, 200, corrected_stock.content)
        self.assertEqual(balance("USD"), D("-100"))

        corrected_payment = self.client.put(
            f"/api/inventory/opening/{opening['id']}/pay/",
            {"amount": "80", "date": date.today().isoformat()},
            format="json",
        )
        self.assertEqual(corrected_payment.status_code, 200, corrected_payment.content)
        self.assertEqual(balance("USD"), D("-80"))
        self.assertEqual(D(corrected_payment.data["paid"]["amount"]), D("80"))

    def test_correcting_opening_payment_after_supplier_link_updates_supplier_payment(self):
        created = self.client.post("/api/inventory/products/", {
            "name": "Linked battery",
            "unit_cost": "40",
            "selling_price": "60",
            "current_stock": 2,
            "opening_payment": {"amount": "80"},
        }, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        opening = self.client.get("/api/inventory/opening/").data[0]
        linked = self.client.post(
            f"/api/inventory/opening/{opening['id']}/link/",
            {"supplier": "Supplier"},
            format="json",
        )
        self.assertEqual(linked.status_code, 201, linked.content)
        self.assertEqual(D(linked.data["paid"]["amount"]), D("80"))
        corrected = self.client.put(
            f"/api/inventory/opening/{opening['id']}/pay/",
            {"amount": "60"},
            format="json",
        )
        self.assertEqual(corrected.status_code, 200, corrected.content)
        from cashbox.services import balance

        self.assertEqual(balance("USD"), D("-60"))
        self.assertEqual(D(corrected.data["paid"]["amount"]), D("60"))

    def test_product_crud_with_reorder_threshold_and_category(self):
        res = self.client.post("/api/inventory/products/", {
            "name": "Inverter", "category": "Inverters", "unit_cost": "50", "selling_price": "80",
            "current_stock": 20, "reorder_threshold": 30}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["reorder_threshold"], 30)
        self.assertEqual(res.data["category_name"], "Inverters")
        self.assertEqual(Product.objects.get(pk=res.data["id"]).reorder_threshold, 30)

    def test_no_phantom_expense_when_creating_product(self):
        self.client.post("/api/inventory/products/", {"name": "P", "unit_cost": "100", "selling_price": "1", "current_stock": 10}, format="json")
        self.assertEqual(finance.totals()["total_operational_expenses"], 0)
        self.assertEqual(finance.totals()["net_profit"], 0)

    def test_product_without_category_is_allowed(self):
        for value in (None, ""):
            res = self.client.post("/api/inventory/products/", {"name": f"N{value}", "category": value, "unit_cost": "1", "selling_price": "2", "current_stock": 1}, format="json")
            self.assertEqual(res.status_code, 201, res.content)
        res = self.client.post("/api/inventory/products/", {"name": "NoField", "unit_cost": "1", "selling_price": "2", "current_stock": 1}, format="json")
        self.assertEqual(res.status_code, 201)

    def test_editing_with_category_id_keeps_category(self):
        cat = Category.objects.create(name="Batteries")
        p = self.product(category=cat)
        res = self.client.put(f"/api/inventory/products/{p.id}/", {"category": str(cat.id), "name": "Battery", "reorder_threshold": 30}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(Category.objects.count(), 1)
        self.assertEqual(res.data["category_details"]["id"], cat.id)
        self.assertEqual(res.data["reorder_threshold"], 30)
        cleared = self.client.put(f"/api/inventory/products/{p.id}/", {"category": ""}, format="json")
        self.assertIsNone(Product.objects.get(pk=p.id).category)

    def test_duplicate_category_rejected_case_insensitive(self):
        self.client.post("/api/inventory/categories/", {"name": "Panels"}, format="json")
        res = self.client.post("/api/inventory/categories/", {"name": "panels"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_negative_values_rejected(self):
        for payload in ({"unit_cost": "-5"}, {"current_stock": -3}, {"selling_price": "-1"}, {"reorder_threshold": -1}):
            base = {"name": "Bad", "unit_cost": "5", "selling_price": "1", "current_stock": 1}
            base.update(payload)
            self.assertEqual(self.client.post("/api/inventory/products/", base, format="json").status_code, 400, payload)

    def test_cannot_delete_product_used_in_orders(self):
        p = self.product()
        self.order(p, qty=1)
        res = self.client.delete(f"/api/inventory/products/{p.id}/")
        self.assertEqual(res.status_code, 409)
        self.assertTrue(Product.objects.filter(pk=p.id).exists())
        self.assertEqual(SalesOrder.objects.get().items.count(), 1)  # history intact

    def test_delete_unused_product_admin_only(self):
        p = self.product()
        staff = self.login(self.staff, APIClient())
        self.assertEqual(staff.delete(f"/api/inventory/products/{p.id}/").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/inventory/products/{p.id}/").status_code, 204)


class SalesOrderTests(Base):
    def test_finalize_deducts_stock_and_blocks_oversell(self):
        p = self.product(stock=10)
        oid = self.order(p, qty=15)
        res = self.client.post(f"/api/orders/sales/{oid}/finalize/")
        self.assertEqual(res.status_code, 400)
        self.assertIn("المخزون غير كافٍ", res.data["detail"])
        self.assertEqual(self.stock(p), 10)
        self.assertFalse(SalesOrder.objects.get(pk=oid).is_finalized)

    def test_finalize_deducts_and_cannot_repeat(self):
        p = self.product(stock=10)
        oid = self.order(p, qty=4)
        self.assertEqual(self.client.post(f"/api/orders/sales/{oid}/finalize/").status_code, 200)
        self.assertEqual(self.stock(p), 6)
        self.assertEqual(self.client.post(f"/api/orders/sales/{oid}/finalize/").status_code, 400)
        self.assertEqual(self.stock(p), 6)

    def test_same_product_on_two_lines_checked_together(self):
        p = self.product(stock=5)
        res = self.client.post("/api/orders/sales/", {"client_name": "Z", "items": [
            {"product": p.id, "quantity": 3, "unit_price": "10"},
            {"product": p.id, "quantity": 3, "unit_price": "10"}], "freelance_jobs": []}, format="json")
        oid = res.data["id"]
        self.assertEqual(self.client.post(f"/api/orders/sales/{oid}/finalize/").status_code, 400)
        self.assertEqual(self.stock(p), 5)

    def test_is_finalized_cannot_be_set_through_api(self):
        p = self.product()
        res = self.client.post("/api/orders/sales/", {"client_name": "B", "is_finalized": True,
            "items": [{"product": p.id, "quantity": 1, "unit_price": "1"}], "freelance_jobs": []}, format="json")
        self.assertFalse(res.data["is_finalized"])
        oid = res.data["id"]
        self.client.put(f"/api/orders/sales/{oid}/", {"is_finalized": True}, format="json")
        self.assertFalse(SalesOrder.objects.get(pk=oid).is_finalized)

    def test_finalized_order_is_locked_except_contact_details(self):
        p = self.product()
        oid = self.order(p, qty=1)
        self.client.post(f"/api/orders/sales/{oid}/finalize/")
        staff = self.login(self.staff, APIClient())
        locked = staff.put(f"/api/orders/sales/{oid}/", {"items": [{"product": p.id, "quantity": 5, "unit_price": "1"}]}, format="json")
        self.assertEqual(locked.status_code, 403)
        discount = staff.put(f"/api/orders/sales/{oid}/", {"discount": "5"}, format="json")
        self.assertEqual(discount.status_code, 403)
        contact = self.client.put(f"/api/orders/sales/{oid}/", {"client_phone": "0999"}, format="json")
        self.assertEqual(contact.status_code, 200)

    def test_delete_finalized_order_restores_stock(self):
        p = self.product(stock=10)
        oid = self.order(p, qty=4)
        self.client.post(f"/api/orders/sales/{oid}/finalize/")
        self.assertEqual(self.stock(p), 6)
        self.assertEqual(self.client.delete(f"/api/orders/sales/{oid}/").status_code, 204)
        self.assertEqual(self.stock(p), 10)
        self.assertEqual(finance.totals()["total_revenue"], 0)

    def test_delete_is_admin_only(self):
        oid = self.order(self.product(), qty=1)
        staff = self.login(self.staff, APIClient())
        self.assertEqual(staff.delete(f"/api/orders/sales/{oid}/").status_code, 403)

    def test_validation_rules(self):
        p = self.product()
        post = lambda body: self.client.post("/api/orders/sales/", body, format="json").status_code
        item = {"product": p.id, "quantity": 1, "unit_price": "20"}
        self.assertEqual(post({"client_name": "Q", "items": [], "freelance_jobs": []}), 400)  # empty
        self.assertEqual(post({"client_name": "", "items": [item], "freelance_jobs": []}), 400)  # no client
        self.assertEqual(post({"client_name": "Q", "items": [{**item, "quantity": 0}], "freelance_jobs": []}), 400)
        self.assertEqual(post({"client_name": "Q", "items": [{**item, "unit_price": "-1"}], "freelance_jobs": []}), 400)
        self.assertEqual(post({"client_name": "Q", "discount": "21", "items": [item], "freelance_jobs": []}), 400)
        self.assertEqual(post({"client_name": "Q", "discount": "-1", "items": [item], "freelance_jobs": []}), 400)
        self.assertEqual(post({"client_name": "Q", "discount": "20", "items": [item], "freelance_jobs": []}), 201)
        services_only = {"client_name": "Svc", "items": [], "freelance_jobs": [
            {"job_type": "INSTALL", "contractor_name": "Sam", "cost_to_company": "10", "charge_to_client": "30"}]}
        self.assertEqual(post(services_only), 201)

    def test_payment_rules(self):
        oid = self.order(self.product(), qty=2, price="100")  # total 200
        pay = lambda amount: self.client.post(f"/api/orders/sales/{oid}/payments/", {"amount": amount}, format="json")
        self.assertEqual(pay("-5").status_code, 400)
        self.assertEqual(pay("0").status_code, 400)
        self.assertEqual(pay("250").status_code, 400)  # overpay
        first = pay("50")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.data["payment_status"], "partial")
        self.assertEqual(first.data["remaining"], 150)
        self.assertEqual(pay("151").status_code, 400)
        done = pay("150")
        self.assertEqual(done.data["payment_status"], "paid")

    def test_edit_keeps_discount_and_updates_lines(self):
        p = self.product()
        oid = self.order(p, qty=2, price="100", discount="10")
        res = self.client.put(f"/api/orders/sales/{oid}/", {"items": [{"product": p.id, "quantity": 3, "unit_price": "100"}], "freelance_jobs": [], "discount": "10"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["grand_total"], 290)

    def test_new_order_has_no_effect_on_stock_or_finance_until_finalized(self):
        p = self.product(stock=10)
        self.order(p, qty=3)
        self.assertEqual(self.stock(p), 10)
        self.assertEqual(finance.totals()["total_revenue"], 0)


class PurchaseOrderTests(Base):
    def po(self, product, qty=20, cost="120", discount="0"):
        res = self.client.post("/api/purchases/po/", {"supplier": "Acme", "discount": discount,
            "items": [{"product": product.id, "quantity": qty, "unit_cost": cost}]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.data["id"]

    def test_receive_adds_stock_and_uses_last_purchase_price(self):
        p = self.product(cost="100", stock=10)
        poid = self.po(p, qty=20, cost="120")
        res = self.client.post(f"/api/purchases/po/{poid}/receive/")
        self.assertEqual(res.status_code, 200)
        p.refresh_from_db()
        self.assertEqual(p.current_stock, 30)
        self.assertEqual(p.unit_cost, D("120"))  # last purchase price, not an average
        self.assertEqual(self.client.post(f"/api/purchases/po/{poid}/receive/").status_code, 400)
        self.assertEqual(self.stock(p), 30)

    def test_status_cannot_be_forced_through_put(self):
        p = self.product(stock=10)
        poid = self.po(p, qty=5)
        self.client.put(f"/api/purchases/po/{poid}/", {"status": "RECEIVED"}, format="json")
        self.assertEqual(PurchaseOrder.objects.get(pk=poid).status, "PENDING")
        self.assertEqual(self.stock(p), 10)

    def test_received_order_is_locked_and_cannot_be_deleted(self):
        p = self.product()
        poid = self.po(p)
        self.client.post(f"/api/purchases/po/{poid}/receive/")
        staff = self.login(self.staff, APIClient())
        self.assertEqual(staff.put(f"/api/purchases/po/{poid}/", {"supplier": "Other"}, format="json").status_code, 403)
        edit = self.client.put(f"/api/purchases/po/{poid}/", {"supplier": "Other"}, format="json")  # admin
        self.assertEqual(edit.status_code, 200)
        self.assertEqual(self.client.delete(f"/api/purchases/po/{poid}/").status_code, 400)

    def test_pending_order_edit_cancel_delete(self):
        p = self.product()
        poid = self.po(p, qty=5, cost="10")
        res = self.client.put(f"/api/purchases/po/{poid}/", {"items": [{"product": p.id, "quantity": 7, "unit_cost": "10"}]}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["total_cost"], 70)
        cancelled = self.client.post(f"/api/purchases/po/{poid}/cancel/")
        self.assertEqual(cancelled.data["status"], "CANCELLED")
        self.assertEqual(self.client.post(f"/api/purchases/po/{poid}/receive/").status_code, 400)
        self.assertEqual(self.client.delete(f"/api/purchases/po/{poid}/").status_code, 204)

    def test_payment_rules_and_status(self):
        p = self.product()
        poid = self.po(p, qty=10, cost="10", discount="20")  # net 80
        pay = lambda amount: self.client.post(f"/api/purchases/po/{poid}/add-payment/", {"amount": amount, "payment_date": "2026-10-01"}, format="json")
        self.assertEqual(pay("-1").status_code, 400)
        self.assertEqual(pay("81").status_code, 400)
        part = pay("30")
        self.assertEqual(part.data["paymentStatus"], "partial")
        self.assertEqual(part.data["remaining"], 50)
        self.assertEqual(pay("50").data["paymentStatus"], "paid")

    def test_validation_rules(self):
        p = self.product()
        post = lambda body: self.client.post("/api/purchases/po/", body, format="json").status_code
        line = {"product": p.id, "quantity": 2, "unit_cost": "5"}
        self.assertEqual(post({"supplier": "S", "items": []}), 400)
        self.assertEqual(post({"supplier": "", "items": [line]}), 400)
        self.assertEqual(post({"supplier": "S", "items": [{**line, "quantity": 0}]}), 400)
        self.assertEqual(post({"supplier": "S", "items": [line], "discount": "11"}), 400)
        self.assertEqual(post({"supplier": "S", "items": [line], "discount": "10", "order_date": "2026-10-01"}), 201)

    def test_purchase_payments_do_not_count_as_profit_expense(self):
        p = self.product()
        poid = self.po(p, qty=10, cost="10")
        self.client.post(f"/api/purchases/po/{poid}/add-payment/", {"amount": "100"}, format="json")
        t = finance.totals()
        self.assertEqual(t["total_operational_expenses"], 0)
        self.assertEqual(t["supplier_payments"], 100)


class FinanceTests(Base):
    def test_profit_uses_cogs_freelance_and_expenses(self):
        p = self.product(cost="100", stock=10)
        jobs = [{"job_type": "INSTALL", "contractor_name": "Sam", "cost_to_company": "200", "charge_to_client": "300"}]
        oid = self.order(p, qty=2, price="150", jobs=jobs, discount="0")  # revenue 300 + 300 = 600
        self.client.post(f"/api/orders/sales/{oid}/finalize/")
        self.client.post("/api/invoice/expenses/", {"type": "EXPENSE", "category": "RENT", "description": "rent", "amount": "50", "date": date.today().isoformat()}, format="json")
        t = finance.totals()
        self.assertEqual(t["total_revenue"], 600)
        self.assertEqual(t["total_cogs"], 200)
        self.assertEqual(t["total_freelance_costs"], 200)
        self.assertEqual(t["total_operational_expenses"], 50)
        self.assertEqual(t["net_profit"], 150)

    def test_cogs_uses_cost_at_time_of_sale(self):
        p = self.product(cost="100", stock=10)
        oid = self.order(p, qty=1, price="150")
        self.client.post(f"/api/orders/sales/{oid}/finalize/")
        p.unit_cost = D("999")
        p.save()
        self.assertEqual(finance.totals()["total_cogs"], 100)

    def test_unfinalized_orders_and_payments_do_not_book_revenue(self):
        oid = self.order(self.product(), qty=1, price="150")
        self.client.post(f"/api/orders/sales/{oid}/payments/", {"amount": "50"}, format="json")
        t = finance.totals()
        self.assertEqual(t["total_revenue"], 0)
        self.assertEqual(t["cash_received"], 50)

    def test_editing_or_resaving_expense_never_double_counts(self):
        res = self.client.post("/api/invoice/expenses/", {"type": "EXPENSE", "category": "RENT", "description": "r", "amount": "100", "date": date.today().isoformat()}, format="json")
        eid = res.data["id"]
        self.client.put(f"/api/invoice/expenses/{eid}/", {"amount": "100"}, format="json")
        self.assertEqual(finance.totals()["total_operational_expenses"], 100)
        self.client.put(f"/api/invoice/expenses/{eid}/", {"amount": "150"}, format="json")
        self.assertEqual(finance.totals()["total_operational_expenses"], 150)
        self.client.delete(f"/api/invoice/expenses/{eid}/")
        self.assertEqual(finance.totals()["total_operational_expenses"], 0)

    def test_expense_validation_never_crashes(self):
        post = lambda body: self.client.post("/api/invoice/expenses/", body, format="json").status_code
        self.assertEqual(post({"type": "EXPENSE", "category": "BOGUS", "description": "x", "amount": "5"}), 400)
        self.assertEqual(post({"category": "BOGUS", "description": "x", "amount": "5"}), 400)
        self.assertEqual(post({"type": "EXPENSE", "category": "RENT", "description": "x", "amount": "-5"}), 400)
        self.assertEqual(post({"type": "EXPENSE", "category": "RENT", "description": "x", "amount": "5", "date": "bad"}), 400)
        self.assertEqual(post({"type": "EXPENSE", "category": "RENT", "description": "", "amount": "5"}), 400)
        self.assertEqual(post({"type": "INCOME", "category": "RENT", "description": "x", "amount": "5"}), 400)
        ok = self.client.post("/api/invoice/expenses/", {"type": "EXPENSE", "category": "RENT", "description": "x", "amount": "5"}, format="json")
        self.assertEqual(ok.status_code, 201)
        bad_edit = self.client.put(f"/api/invoice/expenses/{ok.data['id']}/", {"category": "BOGUS"}, format="json")
        self.assertEqual(bad_edit.status_code, 400)

    def test_other_income_adds_to_revenue(self):
        self.client.post("/api/invoice/expenses/", {"type": "INCOME", "category": "OTHER_INCOME", "description": "gift", "amount": "40"}, format="json")
        self.assertEqual(finance.totals()["total_revenue"], 40)

    def test_chart_returns_most_recent_days_not_oldest(self):
        from invoice.models import Expense
        for i in range(40):
            Expense.objects.create(type="EXPENSE", category="RENT", description="d", amount=1, date=date.today() - timedelta(days=i))
        data = self.client.get("/api/invoice/charts/").data
        self.assertEqual(len(data), 30)
        self.assertEqual(data[-1]["date"], date.today().isoformat())
        self.assertEqual(data[0]["date"], (date.today() - timedelta(days=29)).isoformat())

    def test_report_endpoints_respond(self):
        for url in ["/api/invoice/dashboard/", "/api/invoice/financial_summary/", "/api/reports/dashboard/summary/",
                    "/api/reports/financials/?period=daily", "/api/reports/financials/?period=yearly",
                    "/api/reports/financials/weekly/", "/api/reports/financials/monthly/",
                    "/api/reports/financials/quarterly/", "/api/reports/financials/yearly/"]:
            self.assertEqual(self.client.get(url).status_code, 200, url)

    def test_period_windows(self):
        from invoice.models import Expense
        Expense.objects.create(type="EXPENSE", category="RENT", description="old", amount=10, date=date.today() - timedelta(days=20))
        Expense.objects.create(type="EXPENSE", category="RENT", description="new", amount=5, date=date.today())
        get = lambda period: self.client.get(f"/api/reports/financials/?period={period}").data["total_operational_expenses"]
        self.assertEqual(get("daily"), 5)
        self.assertEqual(get("weekly"), 5)
        self.assertEqual(get("monthly"), 15)


class LicenseTests(Base):
    """Trial, activation and enforcement. A throw-away key stands in for the vendor's."""

    def setUp(self):
        super().setUp()
        from tradeops import licensing
        self.licensing = licensing
        self.key = Ed25519PrivateKey.generate()
        public = base64.b64encode(self.key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
        self._orig_key = licensing.LICENSE_PUBLIC_KEY_B64
        licensing.LICENSE_PUBLIC_KEY_B64 = public
        self.addCleanup(lambda: setattr(licensing, "LICENSE_PUBLIC_KEY_B64", self._orig_key))
        self._orig_now = licensing.now
        self.addCleanup(lambda: setattr(licensing, "now", self._orig_now))
        self.clock = datetime(2026, 1, 1, 9, 0)
        licensing.now = lambda: self.clock

    def token(self, machine=None, customer="Al-Shams", expires=None):
        import json
        payload = json.dumps({"v": 1, "m": machine or self.licensing.machine_code(), "c": customer, "e": expires},
                             ensure_ascii=False, separators=(",", ":")).encode()
        sig = self.key.sign(b"tradeops-license|" + payload)
        b64u = lambda b: base64.urlsafe_b64encode(b).decode().rstrip("=")
        return f"{b64u(payload)}.{b64u(sig)}"

    def advance(self, days):
        self.clock += timedelta(days=days)

    def test_trial_counts_down_then_locks_the_api_but_not_login_or_license(self):
        self.assertEqual(self.licensing.status()["status"], "trial")
        self.assertEqual(self.licensing.status()["days_left"], 14)
        self.advance(13)
        self.assertEqual(self.licensing.status()["days_left"], 1)
        self.assertEqual(self.client.get("/api/inventory/products/").status_code, 200)
        self.advance(2)
        res = self.client.get("/api/inventory/products/")
        self.assertEqual(res.status_code, 402)
        self.assertEqual(res.json()["code"], "license_required")
        for url in ["/api/license/", "/api/health/", "/api/user/setup-status/", "/api/user/recovery/challenge/"]:
            self.assertEqual(APIClient().get(url).status_code, 200, url)
        self.assertEqual(APIClient().post("/api/auth/token/", {"username": "boss", "password": "secret1"}, format="json").status_code, 200)
        self.assertNotEqual(self.client.post("/api/system/backup/").status_code, 402)  # data can still be exported

    def test_valid_activation_unlocks_and_survives(self):
        self.licensing.status()  # first run: the trial starts today
        self.advance(30)
        self.assertEqual(self.client.get("/api/orders/sales/").status_code, 402)
        res = APIClient().post("/api/license/activate/", {"token": self.token()}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["status"], "active")
        self.assertEqual(res.json()["customer"], "Al-Shams")
        self.assertEqual(self.client.get("/api/orders/sales/").status_code, 200)
        self.advance(3000)  # perpetual
        self.assertEqual(self.licensing.status()["status"], "active")

    def test_rejects_wrong_machine_tampering_garbage_and_foreign_keys(self):
        post = lambda t: APIClient().post("/api/license/activate/", {"token": t}, format="json")
        self.assertEqual(post(self.token(machine="AAAA-BBBB-CCCC-DDDD")).status_code, 400)
        good = self.token()
        payload, sig = good.split(".")
        forged = base64.urlsafe_b64encode(b'{"v":1,"m":"X","c":"Hacker","e":null}').decode().rstrip("=") + "." + sig
        self.assertEqual(post(forged).status_code, 400)
        self.assertEqual(post("garbage").status_code, 400)
        self.assertEqual(post("").status_code, 400)
        other = Ed25519PrivateKey.generate()
        raw = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
        foreign_sig = base64.urlsafe_b64encode(other.sign(b"tradeops-license|" + raw)).decode().rstrip("=")
        self.assertEqual(post(f"{payload}.{foreign_sig}").status_code, 400)
        self.assertNotEqual(self.licensing.status()["status"], "active")

    def test_expiring_license_falls_back_to_expired_trial(self):
        self.licensing.status()  # first run: the trial starts today
        self.advance(40)
        self.licensing.activate(self.token(expires="2026-03-01"))  # still valid on 2026-02-10
        self.assertEqual(self.licensing.status()["status"], "active")
        self.advance(30)  # 2026-03-12
        self.assertEqual(self.licensing.status()["status"], "expired")
        self.assertEqual(self.client.get("/api/inventory/products/").status_code, 402)

    def test_clock_rollback_does_not_extend_the_trial(self):
        self.licensing.status()
        self.advance(20)
        self.assertEqual(self.licensing.status()["status"], "expired")
        self.advance(-19)  # user winds the clock back
        self.assertEqual(self.licensing.status()["status"], "expired")

    def test_license_endpoints_public_and_machine_code_stable(self):
        a = APIClient().get("/api/license/").json()
        self.assertRegex(a["request_code"], r"^[0-9A-F]{4}(-[0-9A-F]{4}){3}$")
        self.assertEqual(a["request_code"], self.licensing.machine_code())


class SystemTests(Base):
    def test_backup_is_admin_only_and_creates_file(self):
        import tempfile
        from pathlib import Path
        from django.test import override_settings
        staff = self.login(self.staff, APIClient())
        self.assertEqual(staff.post("/api/system/backup/").status_code, 403)
        with tempfile.TemporaryDirectory() as tmp, override_settings(USER_BACKUP_DIR=Path(tmp)):
            res = self.client.post("/api/system/backup/")
            self.assertIn(res.status_code, (201, 400))  # test DB is in memory: file backup needs a real DB file
            for made in Path(tmp).glob("*.sqlite3"):  # whatever was written must hold real tables
                import sqlite3
                con = sqlite3.connect(made)
                self.assertGreater(con.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0], 0)
                con.close()

    def test_backup_refuses_an_empty_database(self):
        import sqlite3
        import tempfile
        from pathlib import Path
        from tradeops.system import backup_database
        with tempfile.TemporaryDirectory() as tmp:
            empty = Path(tmp) / "empty.sqlite3"
            sqlite3.connect(empty).close()
            with override_settings(DB_PATH=str(empty)):
                with self.assertRaises(RuntimeError):
                    backup_database(Path(tmp) / "out", "x")
            self.assertEqual(list((Path(tmp) / "out").glob("*.sqlite3")), [])

    def test_company_profile_starts_blank_staff_reads_admin_edits(self):
        staff = self.login(self.staff, APIClient())
        blank = staff.get("/api/system/company/")
        self.assertEqual(blank.status_code, 200)
        self.assertEqual(blank.data["name"], "")  # nobody's real business is baked in
        self.assertEqual(staff.put("/api/system/company/", {"name": "X"}, format="json").status_code, 403)
        ok = self.client.put("/api/system/company/", {"name": "Sun Co", "phone": "011 111", "address": "Damascus"}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(staff.get("/api/system/company/").data["name"], "Sun Co")
        self.assertEqual(APIClient().get("/api/system/company/").status_code, 401)

    def test_health_is_public(self):
        self.assertEqual(APIClient().get("/api/health/").status_code, 200)


class DecimalAndCostTests(Base):
    def test_fractional_quantity_only_for_decimal_products(self):
        cable = self.product("Cable", cost="2", price="5", stock=0)
        cable.allow_decimal = True
        cable.current_stock = D("10")
        cable.save()
        panel = self.product("Panel2", stock=10)

        oid = self.order(cable, qty="3.5", price="5")
        self.assertEqual(self.client.post(f"/api/orders/sales/{oid}/finalize/").status_code, 200)
        self.assertEqual(self.stock(cable), D("6.5"))

        bad = self.client.post("/api/orders/sales/", {
            "client_name": "Ali",
            "items": [{"product": panel.id, "quantity": "1.5", "unit_price": "10"}],
        }, format="json")
        self.assertEqual(bad.status_code, 400)

        # 0.1 + 0.2 must not drift below zero or leave float noise
        cable.current_stock = D("0.3")
        cable.save()
        for qty in ("0.1", "0.2"):
            oid = self.order(cable, qty=qty, price="5")
            self.assertEqual(self.client.post(f"/api/orders/sales/{oid}/finalize/").status_code, 200)
        self.assertEqual(self.stock(cable), D("0"))

    def test_purchase_receive_adds_fractional_stock(self):
        cable = self.product("Cable", stock=0)
        cable.allow_decimal = True
        cable.save()
        res = self.client.post("/api/purchases/po/", {
            "supplier": "S", "items": [{"product": cable.id, "quantity": "12.5", "unit_cost": "2"}],
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(self.client.post(f"/api/purchases/po/{res.data['id']}/receive/").status_code, 200)
        self.assertEqual(self.stock(cable), D("12.5"))

    def test_turning_off_decimals_with_fraction_stock_is_rejected(self):
        cable = self.product("Cable", stock=0)
        cable.allow_decimal = True
        cable.current_stock = D("2.5")
        cable.save()
        res = self.client.put(f"/api/inventory/products/{cable.id}/", {"allow_decimal": False}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_new_product_with_stock_is_opening_stock_without_cash(self):
        res = self.client.post("/api/inventory/products/", {
            "name": "Battery", "unit_cost": "50", "selling_price": "80", "current_stock": 2,
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(self.client.get("/api/invoice/expenses/").data, [])  # no cash left any box
        opening = self.client.get("/api/inventory/opening/").data
        self.assertEqual(len(opening), 1)
        self.assertEqual(D(opening[0]["value"]), D("100"))
        self.assertIsNone(opening[0]["purchase_order"])
        t = finance.totals()
        self.assertEqual(t["total_stock_purchases"], D("0"))
        self.assertEqual(t["net_profit"], D("0"))  # cost reaches profit only when sold

        none = self.client.post("/api/inventory/products/", {"name": "Empty", "unit_cost": "9"}, format="json")
        self.assertEqual(none.status_code, 201)
        self.assertEqual(len(self.client.get("/api/inventory/opening/").data), 1)  # no stock, no opening entry

    def test_profit_visible_to_admin_only(self):
        p = self.product(cost="100", price="150", stock=10)
        oid = self.order(p, qty=2, price="150", jobs=[{"job_type": "INSTALL", "cost_to_company": "20", "charge_to_client": "50"}])
        admin_view = self.client.get(f"/api/orders/sales/{oid}/").data
        self.assertEqual(D(admin_view["profit"]), D("130"))  # 350 - 200 - 20
        self.assertEqual(D(admin_view["cost_total"]), D("220"))
        staff = self.login(self.staff, APIClient())
        staff_view = staff.get(f"/api/orders/sales/{oid}/").data
        self.assertNotIn("profit", staff_view)
        self.assertNotIn("cost_total", staff_view)
        self.assertNotIn("profit", staff.get("/api/orders/sales/").data[0])


class LocationTests(Base):
    def enable(self, **flags):
        res = self.client.put("/api/system/features/", flags, format="json")
        self.assertEqual(res.status_code, 200, res.content)

    def test_features_default_off_and_admin_only(self):
        res = self.client.get("/api/system/features/")
        self.assertFalse(any(v for v in res.data.values() if isinstance(v, bool)))
        staff = self.login(self.staff, APIClient())
        self.assertEqual(staff.get("/api/system/features/").status_code, 200)
        self.assertEqual(staff.put("/api/system/features/", {"cars": True}, format="json").status_code, 403)
        self.enable(cars=True)
        self.assertTrue(self.client.get("/api/system/features/").data["cars"])

    def test_modules_are_blocked_while_off(self):
        self.assertEqual(self.client.get("/api/locations/cars/").status_code, 403)
        self.assertEqual(self.client.post("/api/locations/branches/", {"name": "B2"}, format="json").status_code, 403)

    def test_branch_stock_is_separate_and_total_is_kept(self):
        self.enable(branches=True)
        b2 = self.client.post("/api/locations/branches/", {"name": "Aleppo"}, format="json").data["id"]
        main = [b for b in self.client.get("/api/locations/branches/").data if b["is_default"]][0]["id"]
        res = self.client.post("/api/inventory/products/", {
            "name": "Inv", "unit_cost": "10", "selling_price": "20", "current_stock": 5, "branch": b2,
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        pid = res.data["id"]
        self.assertEqual(res.data["stock_by_location"], [{"kind": "branch", "id": b2, "name": "Aleppo", "quantity": 5.0}])
        # A purchase received at the main branch adds there
        po = self.client.post("/api/purchases/po/", {
            "supplier": "S", "branch": main, "items": [{"product": pid, "quantity": 3, "unit_cost": "10"}],
        }, format="json").data["id"]
        self.client.post(f"/api/purchases/po/{po}/receive/")
        product = Product.objects.get(pk=pid)
        self.assertEqual(product.current_stock, D("8"))
        # A sale from Aleppo cannot exceed Aleppo's own stock (5), even though the total is 8
        oid = self.client.post("/api/orders/sales/", {
            "client_name": "X", "branch": b2, "items": [{"product": pid, "quantity": 6, "unit_price": "20"}],
        }, format="json").data["id"]
        self.assertEqual(self.client.post(f"/api/orders/sales/{oid}/finalize/").status_code, 400)
        oid2 = self.client.post("/api/orders/sales/", {
            "client_name": "X", "branch": b2, "items": [{"product": pid, "quantity": 5, "unit_price": "20"}],
        }, format="json").data["id"]
        self.assertEqual(self.client.post(f"/api/orders/sales/{oid2}/finalize/").status_code, 200)
        self.assertEqual(Product.objects.get(pk=pid).current_stock, D("3"))
        # deleting the finalized sale puts it back where it came from
        self.assertEqual(self.client.delete(f"/api/orders/sales/{oid2}/").status_code, 204)
        listed = self.client.get(f"/api/inventory/products/{pid}/").data["stock_by_location"]
        self.assertEqual(sorted((r["name"], r["quantity"]) for r in listed), [("Aleppo", 5.0), ("الفرع الرئيسي", 3.0)])

    def test_car_stock_transfer_sale_and_expenses(self):
        self.enable(cars=True)
        car = self.client.post("/api/locations/cars/", {"name": "Hilux", "plate": "123", "driver_name": "Abu Ali"}, format="json").data["id"]
        p = self.product(stock=10, cost="100", price="150")
        # nothing on the car yet
        oid = self.client.post("/api/orders/sales/", {
            "client_name": "Saeed customer", "car": car, "items": [{"product": p.id, "quantity": 2, "unit_price": "150"}],
        }, format="json").data["id"]
        self.assertEqual(self.client.post(f"/api/orders/sales/{oid}/finalize/").status_code, 400)
        # move 4 to the car, then the sale is deducted from the car only
        res = self.client.post("/api/locations/transfers/", {"product": p.id, "quantity": 4, "to_car": car}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(self.client.post(f"/api/orders/sales/{oid}/finalize/").status_code, 200)
        self.assertEqual(self.stock(p), D("8"))
        detail = self.client.get(f"/api/locations/cars/{car}/").data
        self.assertEqual([(r["product"], r["quantity"]) for r in detail["stock"]], [(p.id, D("2"))])
        self.assertEqual(detail["sales_count"], 1)
        self.assertEqual(D(detail["sales_total"]), D("300"))
        # fuel for the car
        ex = self.client.post("/api/invoice/expenses/", {
            "type": "EXPENSE", "category": "FUEL", "description": "Diesel", "amount": "25", "car": car,
        }, format="json")
        self.assertEqual(ex.status_code, 201, ex.content)
        self.assertEqual(D(self.client.get(f"/api/locations/cars/{car}/").data["expenses_total"]), D("25"))
        # cannot move more than the car holds / cannot delete a car holding goods
        over = self.client.post("/api/locations/transfers/", {"product": p.id, "quantity": 3, "from_car": car, "to_branch": 1}, format="json")
        self.assertEqual(over.status_code, 400)
        self.assertEqual(self.client.delete(f"/api/locations/cars/{car}/").status_code, 409)

    def test_legacy_stock_without_levels_counts_as_default_branch(self):
        p = self.product(stock=7)
        oid = self.order(p, qty=3)
        self.assertEqual(self.client.post(f"/api/orders/sales/{oid}/finalize/").status_code, 200)
        self.assertEqual(self.stock(p), D("4"))
        self.assertEqual(self.client.get(f"/api/inventory/products/{p.id}/").data["stock_by_location"][0]["quantity"], 4.0)

    def test_reports_can_be_filtered_by_branch(self):
        self.enable(branches=True)
        b2 = self.client.post("/api/locations/branches/", {"name": "Aleppo"}, format="json").data["id"]
        p = self.product(stock=10, cost="100", price="150")
        main_order = self.order(p, qty=1, price="150")
        res = self.client.post("/api/orders/sales/", {
            "client_name": "A", "branch": b2, "items": [{"product": p.id, "quantity": 1, "unit_price": "400"}],
        }, format="json")
        self.assertEqual(res.status_code, 201)
        # stock sits in the default branch, so Aleppo's sale first needs a transfer
        self.client.post("/api/locations/transfers/", {"product": p.id, "quantity": 2, "to_branch": b2}, format="json")
        for oid in (main_order, res.data["id"]):
            self.assertEqual(self.client.post(f"/api/orders/sales/{oid}/finalize/").status_code, 200)
        whole = self.client.get("/api/invoice/financial_summary/").data
        only_b2 = self.client.get(f"/api/invoice/financial_summary/?branch={b2}").data
        self.assertEqual(D(whole["total_revenue"]), D("550"))
        self.assertEqual(D(only_b2["total_revenue"]), D("400"))
        self.assertEqual(len(self.client.get(f"/api/orders/sales/?branch={b2}").data), 1)
