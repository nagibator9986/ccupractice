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

    def test_long_organisation_and_person_names_do_not_overflow_file_name(self):
        """Regression: «[Errno 36] File name too long» — a long association name plus a long ФИО (2 bytes
        per Cyrillic letter) pushed the generated file name past the 255-byte limit of one path component."""
        from pathlib import Path

        from app.extensions import db
        from app.models import Contract, Partner, Student

        org = 'Объединение юридических лиц «Региональная ассоциация "Бизнес-клуб 26" в городе Алматы»'
        person = "Эйбова Лианашахриназ Наримановна-Кызы Абдулрахманова"
        with self.app.app_context():
            p = Partner(organization_name=org, bin="210987654321", legal_address="г. Алматы, ул. Абая 1",
                        director_full_name="Директоров Д.Д.", director_position="Директор")
            s = Student(full_name=person, iin=self.make_iin(serial="0042"), group_name="ПО 25-1",
                        specialty="Программное обеспечение", practice_start=date(2026, 6, 1),
                        practice_end=date(2026, 6, 30))
            db.session.add_all([p, s])
            db.session.commit()
            pid, sid = p.id, s.id

        cid = self.client.post("/api/contracts", json={"student_id": sid, "partner_id": pid},
                               headers=self.admin).get_json()["item"]["id"]
        gen = self.client.post(f"/api/contracts/{cid}/generate", json={}, headers=self.admin)
        self.assertEqual(gen.status_code, 200, gen.get_json())

        with self.app.app_context():
            contract = db.session.get(Contract, cid)
            for rel in filter(None, (contract.docx_path, contract.pdf_path)):
                for part in Path(rel).parts:
                    self.assertLessEqual(len(part.encode("utf-8")), 255, part)
            self.assertTrue(contract.docx_path)

            from app.services.signature_report import build_signature_report

            report = build_signature_report(contract)
            self.assertTrue(report.is_file())
            for part in report.parts[-4:]:
                self.assertLessEqual(len(part.encode("utf-8")), 255, part)


if __name__ == "__main__":
    unittest.main()
