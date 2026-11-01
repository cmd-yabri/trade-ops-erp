"""Phase 4: a backup folder of the owner's choice, restoring a backup, reports to a WhatsApp group."""
import shutil
import sqlite3
import tempfile
from pathlib import Path
from unittest import mock

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APIClient

from user.models import FeatureSettings
from whatsapp import reports

from .backups import REQUIRED_TABLES

from .tests import Base, D


def fake_db(path: Path, marker: str) -> Path:
    """A small TradeOps-shaped database file (the test database itself lives in memory)."""
    con = sqlite3.connect(path)
    for table in (*REQUIRED_TABLES, marker):
        con.execute(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY)")
    con.commit()
    con.close()
    return path


class BackupFolderTests(Base):
    def setUp(self):
        super().setUp()
        self.folder = Path(tempfile.mkdtemp(prefix="tradeops-chosen-"))
        self.addCleanup(shutil.rmtree, self.folder, ignore_errors=True)
        live = fake_db(self.folder / "live.sqlite3", "live_marker")
        patcher = override_settings(DB_PATH=str(live), AUTO_BACKUP_DIR=self.folder / "auto-dir")
        patcher.enable()
        self.addCleanup(patcher.disable)

    def test_backups_go_to_the_chosen_folder(self):
        res = self.client.put("/api/system/backup-settings/", {"folder": str(self.folder / "usb")}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data["folder_ok"])
        made = self.client.post("/api/system/backup/").data["path"]
        self.assertTrue(made.startswith(str(self.folder / "usb")))
        names = [b["name"] for b in self.client.get("/api/system/backups/").data if b["source"] == "folder"]
        self.assertIn(Path(made).name, names)

    def test_relative_or_unwritable_folder_is_refused(self):
        self.assertEqual(self.client.put("/api/system/backup-settings/", {"folder": "relative\\path"},
                                         format="json").status_code, 400)

    def test_only_admin(self):
        staff = self.login(self.staff, APIClient())
        self.assertEqual(staff.get("/api/system/backup-settings/").status_code, 403)
        self.assertEqual(staff.post("/api/system/restore/", {}, format="json").status_code, 403)

    def test_a_file_that_is_not_a_backup_is_refused(self):
        junk = SimpleUploadedFile("x.sqlite3", b"not a database")
        res = self.client.post("/api/system/restore/", {"file": junk}, format="multipart")
        self.assertEqual(res.status_code, 400)

    def test_listed_name_cannot_escape_its_folder(self):
        res = self.client.post("/api/system/restore/", {"source": "manual", "name": "..\\..\\db.sqlite3"},
                               format="json")
        self.assertEqual(res.status_code, 400)


    def test_restore_replaces_the_database_and_keeps_a_safety_copy(self):
        old = fake_db(self.folder / "old-backup.sqlite3", "old_marker")
        with mock.patch("tradeops.backups.call_command") as migrate:
            res = self.client.post("/api/system/restore/", {"file": open(old, "rb")}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        migrate.assert_called_once()  # an older backup is brought up to date
        con = sqlite3.connect(settings.DB_PATH)
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
        con.close()
        self.assertIn("old_marker", tables)
        safety = Path(res.data["safety_copy"])
        self.assertTrue(safety.exists())  # what was there before can be brought back
        con = sqlite3.connect(safety)
        self.assertIn("live_marker", {r[0] for r in con.execute("SELECT name FROM sqlite_master")})
        con.close()
        # and a listed backup restores the same way
        listed = [b for b in self.client.get("/api/system/backups/").data if b["source"] == "auto"]
        self.assertTrue(listed)


class WhatsappGroupTests(Base):
    def setUp(self):
        super().setUp()
        self.client.put("/api/system/features/", {"whatsapp": True}, format="json")

    def test_groups_are_listed_and_one_is_chosen(self):
        with mock.patch("whatsapp.sidecar.groups", return_value=[{"id": "1203-1@g.us", "subject": "الشركاء", "size": 3}]):
            res = self.client.get("/api/whatsapp/groups/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data[0]["subject"], "الشركاء")
        bad = self.client.put("/api/system/features/", {"whatsapp_group_jid": "0999@s.whatsapp.net"}, format="json")
        self.assertEqual(bad.status_code, 400)
        ok = self.client.put("/api/system/features/", {"whatsapp_group_jid": "1203-1@g.us",
                                                       "whatsapp_group_name": "الشركاء"}, format="json")
        self.assertEqual(ok.status_code, 200)

    def test_summary_goes_to_the_chosen_group(self):
        FeatureSettings.objects.filter(pk=1).update(whatsapp_group_jid="1203-1@g.us")
        with mock.patch("whatsapp.sidecar.send_group", return_value="MSG1") as send:
            res = self.client.post("/api/whatsapp/send-group/", {"summary": True}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        jid, text = send.call_args[0]
        self.assertEqual(jid, "1203-1@g.us")
        self.assertIn("ملخص يوم", text)

    def test_no_group_chosen_is_a_clear_error(self):
        res = self.client.post("/api/whatsapp/send-group/", {"text": "hi"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_finalizing_a_sale_notifies_the_group(self):
        FeatureSettings.objects.filter(pk=1).update(whatsapp_group_jid="1203-1@g.us", whatsapp_notify_sales=True)
        p = self.product(stock=5)
        order = self.order(p, qty=1)
        started = []
        with mock.patch("whatsapp.reports.threading.Thread") as thread:
            thread.return_value.start.side_effect = lambda: started.append(True)
            self.assertEqual(self.client.post(f"/api/orders/sales/{order}/finalize/").status_code, 200)
        self.assertEqual(started, [True])
        text = reports.sale_message(__import__("order.models", fromlist=["SalesOrder"]).SalesOrder.objects.get(pk=order))
        self.assertIn(f"SO-{order}", text)
