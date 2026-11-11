"""Changing the place of practice on an existing contract (PUT /contracts/<id> {partner_id}).

The student sent other requisites first, the contract was created, then they moved to another
organisation: the contract keeps its number but must carry the new organisation, and the old
document / links must not survive.
"""
from __future__ import annotations

import unittest
from datetime import date
from pathlib import Path

from tests.base import AppTestCase


class ContractPartnerChangeTests(AppTestCase):
    def setUp(self):
        self.reset_db()
        from app.extensions import db
        from app.models import Partner, SigningRequest, Student

        with self.app.app_context():
            SigningRequest.query.delete()
            old = self._partner("ТОО Старое", "111111111111")
            new = self._partner("ТОО Новое", "222222222222")
            other = self._partner("ТОО Третье", "333333333333")
            s = Student(full_name="Иванов Иван Иванович", iin=self.make_iin(), group_name="ПО 25-1",
                        specialty="Программное обеспечение", practice_start=date(2026, 6, 1),
                        practice_end=date(2026, 6, 30))
            db.session.add_all([old, new, other, s])
            db.session.flush()
            s.partner_id = old.id
            db.session.commit()
            self.old, self.new, self.other, self.sid = old.id, new.id, other.id, s.id

    @staticmethod
    def _partner(name, bin_):
        from app.models import Partner

        return Partner(organization_name=name, bin=bin_, legal_address="г. Алматы, ул. Абая 1",
                       director_full_name="Директоров Д.Д.", director_position="Директор")

    def _create(self, partner_id=None):
        r = self.client.post("/api/contracts", json={"student_id": self.sid, "partner_id": partner_id or self.old},
                             headers=self.admin)
        self.assertEqual(r.status_code, 201, r.get_json())
        return r.get_json()["item"]["id"]

    def _put(self, cid, **body):
        return self.client.put(f"/api/contracts/{cid}", json=body, headers=self.admin)

    def _student_partner(self):
        from app.models import Student
        from app.extensions import db

        with self.app.app_context():
            return db.session.get(Student, self.sid).partner_id

    def test_draft_contract_moves_to_new_partner_and_keeps_number(self):
        cid = self._create()
        before = self.client.get(f"/api/contracts/{cid}", headers=self.admin).get_json()["item"]
        res = self._put(cid, partner_id=self.new)
        self.assertEqual(res.status_code, 200, res.get_json())
        item = res.get_json()["item"]
        self.assertEqual((item["partner_id"], item["partner_name"]), (self.new, "ТОО Новое"))
        self.assertEqual(item["number"], before["number"])
        self.assertEqual(item["status"], "draft")
        self.assertIn("ТОО Новое", res.get_json()["warning"])
        self.assertEqual(self._student_partner(), self.new)          # the student card follows

    def test_generated_contract_loses_old_document_and_regenerates_with_new_partner(self):
        cid = self._create()
        gen = self.client.post(f"/api/contracts/{cid}/generate", json={}, headers=self.admin)
        self.assertEqual(gen.status_code, 200, gen.get_json())
        old_docx = Path(self.app.config["ARCHIVE_FOLDER"]) / gen.get_json()["item"]["docx_path"]
        self.assertTrue(old_docx.is_file())

        res = self._put(cid, partner_id=self.new)
        self.assertEqual(res.status_code, 200, res.get_json())
        item = res.get_json()["item"]
        self.assertEqual((item["status"], item["next_action"]), ("draft", "generate"))
        self.assertFalse(item["docx_path"])
        self.assertFalse(old_docx.exists())                           # the old requisites are gone from disk

        again = self.client.post(f"/api/contracts/{cid}/generate", json={}, headers=self.admin)
        self.assertEqual(again.status_code, 200, again.get_json())
        new_item = again.get_json()["item"]
        self.assertEqual(new_item["status"], "generated")
        self.assertIn("ТОО_Новое", new_item["docx_path"])
        self.assertNotIn("ТОО_Старое", new_item["docx_path"])

    def test_issued_links_need_confirmation_then_are_revoked(self):
        cid = self._create()
        self.client.post(f"/api/contracts/{cid}/generate", json={}, headers=self.admin)
        links = self.client.post("/api/signing/bulk-invite", json={"contract_ids": [cid]}, headers=self.admin).get_json()
        self.assertEqual(links["new_links"], 2)

        refused = self._put(cid, partner_id=self.new)
        self.assertEqual(refused.status_code, 409)
        body = refused.get_json()
        self.assertEqual((body["code"], body["links_count"]), ("has_signatures", 2))
        self.assertEqual(self.client.get(f"/api/contracts/{cid}", headers=self.admin).get_json()["item"]["partner_id"],
                         self.old)                                    # nothing changed

        ok = self._put(cid, partner_id=self.new, force=True)
        self.assertEqual(ok.status_code, 200, ok.get_json())
        from app.models import SigningRequest

        with self.app.app_context():
            states = {r.status for r in SigningRequest.query.filter_by(contract_id=cid)}
        self.assertEqual(states, {"revoked"})
        self.assertEqual(ok.get_json()["item"]["status"], "draft")

    def test_same_partner_is_a_no_op_without_warning(self):
        cid = self._create()
        res = self._put(cid, partner_id=self.old)
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.get_json()["warning"])

    def test_unknown_partner_is_refused(self):
        cid = self._create()
        self.assertEqual(self._put(cid, partner_id=999999).status_code, 404)
        self.assertEqual(self._put(cid, partner_id="").status_code, 404)

    def test_existing_contract_with_target_partner_is_flagged(self):
        first = self._create(self.old)
        second = self._create(self.new)         # a second contract of the same student, other partner
        res = self._put(first, partner_id=self.new)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.get_json()["code"], "duplicate_contract")
        self.assertEqual(res.get_json()["existing_contract_id"], second)
        self.assertEqual(self._put(first, partner_id=self.new, allow_duplicate=True).status_code, 200)

    def test_student_card_is_left_alone_when_it_points_elsewhere(self):
        from app.extensions import db
        from app.models import Student

        cid = self._create()
        with self.app.app_context():
            db.session.get(Student, self.sid).partner_id = self.other
            db.session.commit()
        self.assertEqual(self._put(cid, partner_id=self.new).status_code, 200)
        self.assertEqual(self._student_partner(), self.other)

    def test_viewer_cannot_change_partner(self):
        cid = self._create()
        res = self.client.put(f"/api/contracts/{cid}", json={"partner_id": self.new}, headers=self.viewer)
        self.assertEqual(res.status_code, 403)


if __name__ == "__main__":
    unittest.main()
