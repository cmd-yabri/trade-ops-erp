"""WhatsApp: optional feature, phone clean-up, send with click-to-chat fallback (the Node service is mocked)."""
import os
from unittest import mock

from rest_framework.test import APIClient

from whatsapp import sidecar
from whatsapp.phone import InvalidPhoneNumber, normalise, wa_me_url

from .tests import Base

os.environ["TRADEOPS_NO_SIDECAR"] = "1"


class PhoneTests(Base):
    def test_normalise_shapes(self):
        for raw in ("+963 980 549 953", "0980549953", "00963980549953", "963980549953", "980549953"):
            self.assertEqual(normalise(raw), "963980549953", raw)
        self.assertEqual(normalise("0911111111", "971"), "971911111111")
        for bad in ("", "abc", "12", None):
            with self.assertRaises(InvalidPhoneNumber):
                normalise(bad)

    def test_click_to_chat_url_encodes_arabic_text(self):
        url = wa_me_url("0980549953", "مرحبا 5$")
        self.assertTrue(url.startswith("https://wa.me/963980549953?text="))
        self.assertNotIn(" ", url)


class WhatsappApiTests(Base):
    def enable(self):
        with mock.patch.object(sidecar, "ensure_started", return_value=True):
            self.assertEqual(self.client.put("/api/system/features/", {"whatsapp": True}, format="json").status_code, 200)

    def test_blocked_while_the_feature_is_off(self):
        self.assertEqual(self.client.get("/api/whatsapp/status/").status_code, 403)
        self.assertEqual(self.client.post("/api/whatsapp/send/", {"phone": "0980549953", "text": "hi"}, format="json").status_code, 403)

    def test_send_ok_and_failure_falls_back_to_a_chat_link(self):
        self.enable()
        with mock.patch.object(sidecar, "send_text", return_value="MSG1") as send:
            res = self.client.post("/api/whatsapp/send/", {"phone": "0980 549 953", "text": "فاتورتك"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        send.assert_called_once_with("963980549953", "فاتورتك")
        with mock.patch.object(sidecar, "send_text", side_effect=sidecar.SidecarError("offline", code="offline")):
            res = self.client.post("/api/whatsapp/send/", {"phone": "0980549953", "text": "x"}, format="json")
        self.assertEqual(res.status_code, 502)
        self.assertTrue(res.data["fallback_url"].startswith("https://wa.me/963980549953"))

    def test_bad_phone_and_empty_text_are_rejected(self):
        self.enable()
        self.assertEqual(self.client.post("/api/whatsapp/send/", {"phone": "abc", "text": "x"}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/whatsapp/send/", {"phone": "0980549953", "text": " "}, format="json").status_code, 400)

    def test_linking_is_admin_only(self):
        self.enable()
        staff = self.login(self.staff, APIClient())
        self.assertEqual(staff.post("/api/whatsapp/connect/", {}, format="json").status_code, 403)
        self.assertEqual(staff.post("/api/whatsapp/disconnect/", {}, format="json").status_code, 403)

    def test_country_code_setting_is_used(self):
        self.enable()
        self.client.put("/api/system/features/", {"whatsapp_country_code": "971"}, format="json")
        with mock.patch.object(sidecar, "send_text", return_value="M") as send:
            self.client.post("/api/whatsapp/send/", {"phone": "0501234567", "text": "hi"}, format="json")
        send.assert_called_once_with("971501234567", "hi")
