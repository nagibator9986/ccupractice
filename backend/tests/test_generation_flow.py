"""End-to-end: real DOCX/PDF generation → signing link → public preview.

PDF assertions are skipped when LibreOffice is not installed (DOCX still works).
"""
from __future__ import annotations

import shutil
import unittest
from datetime import date

from tests.base import AppTestCase

HAS_SOFFICE = bool(shutil.which("soffice") or shutil.which("libreoffice"))


class GenerationFlowTests(AppTestCase):
    def setUp(self):
        self.reset_db()
        from app.extensions import db
        from app.models import Partner, SigningRequest, Student

        with self.app.app_context():
            SigningRequest.query.delete()
            p = Partner(organization_name="ТОО Ромашка", bin="123456789012", legal_address="г. Алматы, ул. Абая 1",
                        director_full_name="Директоров Д.Д.", director_position="Директор")
            s = Student(full_name="Иванов Иван Иванович", iin=self.make_iin(), group_name="ПО 25-1",
                        specialty="Программное обеспечение", practice_start=date(2026, 6, 1),
                        practice_end=date(2026, 6, 30))
            db.session.add_all([p, s])
            db.session.commit()
            self.pid, self.sid = p.id, s.id

    def test_generate_invite_and_public_preview(self):
        cid = self.client.post("/api/contracts", json={"student_id": self.sid, "partner_id": self.pid},
                               headers=self.admin).get_json()["item"]["id"]
        gen = self.client.post(f"/api/contracts/{cid}/generate", json={}, headers=self.admin)
        self.assertEqual(gen.status_code, 200, gen.get_json())
        item = gen.get_json()["item"]
        self.assertTrue(item["docx_path"])
        self.assertEqual((item["status"], item["next_action"]), ("generated", "invite"))

        res = self.client.post("/api/signing/bulk-invite", json={"contract_ids": [cid]}, headers=self.admin).get_json()
        self.assertEqual(res["new_links"], 2)
        token = [l for l in res["items"][0]["links"] if l["signer_role"] == "student"][0]["token"]

        pub = self.client.get(f"/api/signing/public/{token}").get_json()
        self.assertEqual(pub["contract"]["student"]["full_name"], "Иванов Иван Иванович")
        self.assertRegex(pub["contract"]["partner"]["bin_masked"], r"^123456\*{4}12$")

        docx = self.client.get(f"/api/signing/public/{token}/download/docx")
        self.assertEqual(docx.status_code, 200)
        self.assertEqual(docx.data[:2], b"PK")

        if HAS_SOFFICE:
            self.assertTrue(item["pdf_path"])
            self.assertTrue(pub["download"]["pdf_preview"])
            pdf = self.client.get(f"/api/signing/public/{token}/download/pdf?inline=1")
            self.assertEqual(pdf.status_code, 200)
            self.assertTrue(pdf.data.startswith(b"%PDF"))
            self.assertIn("inline", pdf.headers.get("Content-Disposition", "inline"))
            adm = self.client.get(f"/api/contracts/{cid}/download/pdf?inline=1", headers=self.admin)
            self.assertEqual((adm.status_code, adm.data[:4]), (200, b"%PDF"))
        else:
            self.assertEqual(self.client.get(f"/api/signing/public/{token}/download/pdf").status_code, 404)

        self.assertEqual(self.client.get("/api/signing/public/nope").status_code, 404)


if __name__ == "__main__":
    unittest.main()
