"""Practice signing for people who cannot just sign electronically themselves:

* a student under 16 is represented by a legal representative (parent);
* a party without an ЭЦП (e.g. living abroad) signs on paper and uploads a scan, which the
  college must accept before it counts.
"""
from __future__ import annotations

import io
import os
import unittest
from datetime import date

from PIL import Image

from tests.base import AppTestCase
from tests.test_egov_sign import DOCX, PDF, make_cms

TODAY = date.today()
MINOR_BORN = date(TODAY.year - 14, 3, 1)      # 14 — below 16 today
ADULT_BORN = date(TODAY.year - 18, 3, 1)


def scan_pdf() -> bytes:
    """A real one-page PDF (what a printer-scanner produces)."""
    buf = io.BytesIO()
    Image.new("RGB", (300, 400), "white").save(buf, format="PDF")
    return buf.getvalue()


def png_bytes(color="white") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (240, 320), color).save(buf, format="PNG")
    return buf.getvalue()


class PartySigningTests(AppTestCase):
    def setUp(self):
        self.reset_db()
        from app.extensions import db
        from app.models import Partner, SigningRequest, Signature, Student

        with self.app.app_context():
            Signature.query.delete()
            SigningRequest.query.delete()
            self.partner = Partner(organization_name="ТОО Ромашка", bin="123456789012", legal_address="г. Алматы",
                                   director_full_name="Директоров Д.Д.", phone="+7 701 000 00 00")
            db.session.add(self.partner)
            db.session.commit()
            self.pid = self.partner.id

    # ── helpers ────────────────────────────────────────────────────────────
    def make_student(self, born, *, sign_method="ecp", rep=True, iin_serial="0001", **extra):
        from app.extensions import db
        from app.models import Student

        iin = self.make_iin(born.strftime("%Y%m%d"), "5" if born.year >= 2000 else "3", iin_serial)
        fields = dict(full_name="Студент Тестов", iin=iin, group_name="ПО 26-1", birth_date=born,
                      practice_start=date(2027, 3, 1), practice_end=date(2027, 3, 31), sign_method=sign_method)
        if rep:
            rep_iin = self.make_iin("19800101", "3", "0099")
            fields.update(legal_rep_full_name="Тестова Мать Ивановна", legal_rep_iin=rep_iin,
                          legal_rep_phone="+7 777 111 22 33")
        fields.update(extra)
        with self.app.app_context():
            s = Student(**fields)
            db.session.add(s)
            db.session.commit()
            return s.id, iin, fields.get("legal_rep_iin")

    def make_contract(self, sid, with_files=True):
        cid = self.client.post("/api/contracts", json={"student_id": sid, "partner_id": self.pid},
                               headers=self.admin).get_json()["item"]["id"]
        if with_files:
            from app.extensions import db
            from app.models import Contract
            archive = self.app.config["ARCHIVE_FOLDER"]
            os.makedirs(archive, exist_ok=True)
            open(f"{archive}/c{cid}.docx", "wb").write(DOCX)
            open(f"{archive}/c{cid}.pdf", "wb").write(PDF)
            with self.app.app_context():
                c = db.session.get(Contract, cid)
                c.docx_path, c.pdf_path, c.status = f"c{cid}.docx", f"c{cid}.pdf", "generated"
                db.session.commit()
        return cid

    def invite(self, cid, roles=("student",), **extra):
        res = self.client.post("/api/signing/bulk-invite", json={"contract_ids": [cid], "roles": list(roles), **extra},
                               headers=self.admin).get_json()
        return {l["signer_role"]: l for l in res["items"][0]["links"]}

    def pub(self, token):
        return self.client.get(f"/api/signing/public/{token}").get_json()

    def upload(self, token, files, **kw):
        data = {"files": [(io.BytesIO(b), n) for n, b in files]}
        return self.client.post(f"/api/signing/public/{token}/scan", data=data, content_type="multipart/form-data", **kw)

    def contract(self, cid):
        return self.client.get(f"/api/contracts/{cid}", headers=self.admin).get_json()["item"]

    # ── legal representative ───────────────────────────────────────────────
    def test_minor_is_represented_by_the_parent_and_needs_their_data(self):
        sid, _, _ = self.make_student(MINOR_BORN, rep=False)
        cid = self.make_contract(sid)
        item = self.contract(cid)
        self.assertEqual(item["student_signer"], "legal_representative")
        missing = {m["field"]: m["severity"] for m in item["readiness"]["missing"]}
        self.assertEqual((missing["legal_rep_full_name"], missing["legal_rep_iin"]), ("critical", "critical"))
        self.assertFalse(item["readiness"]["ok"])
        gen = self.client.post(f"/api/contracts/{cid}/generate", json={}, headers=self.admin)
        self.assertEqual((gen.status_code, gen.get_json()["code"]), (422, "incomplete"))

        from app.extensions import db
        from app.models import Student
        with self.app.app_context():
            st = db.session.get(Student, sid)
            st.legal_rep_full_name, st.legal_rep_iin = "Тестова Мать", self.make_iin("19800101", "3", "0098")
            db.session.commit()
        self.assertEqual(self.contract(cid)["readiness"]["critical"], 0)

    def test_adult_signs_for_themselves(self):
        sid, _, _ = self.make_student(ADULT_BORN, rep=False)
        item = self.contract(self.make_contract(sid))
        self.assertEqual(item["student_signer"], "self")
        self.assertNotIn("legal_rep_iin", {m["field"] for m in item["readiness"]["missing"]})

    def test_link_goes_to_the_parent_and_only_their_certificate_matches(self):
        sid, student_iin, rep_iin = self.make_student(MINOR_BORN)
        cid = self.make_contract(sid)
        link = self.invite(cid)["student"]
        self.assertEqual(link["recipient_name"], "Тестова Мать Ивановна")
        self.assertEqual(link["recipient_phone"], "+7 777 111 22 33")           # parent's phone, not the child's
        self.assertEqual(link["signer_capacity"], "legal_representative")
        pub = self.pub(link["token"])
        self.assertEqual(pub["request"]["signer_role_label"], "Законный представитель обучающегося")
        self.assertEqual(pub["signing_state"]["student"]["label"], "Законный представитель обучающегося")
        self.assertRegex(pub["request"]["recipient_iin_or_bin_masked"], r"^\d{6}\*{4}\d{2}$")

        r = self.client.post(f"/api/signing/public/{link['token']}/submit", json={"cms": make_cms(DOCX, iin=rep_iin, name="ТЕСТОВА МАТЬ")})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(r.get_json()["warnings"], [])                          # certificate IIN == expected
        sig = self.contract(cid)["signatures"][0]
        self.assertEqual((sig["signer_role"], sig["signer_capacity"], sig["channel"]), ("student", "legal_representative", "ncalayer"))

    def test_wrong_person_signing_for_a_minor_is_flagged(self):
        sid, student_iin, _ = self.make_student(MINOR_BORN)
        link = self.invite(self.make_contract(sid))["student"]
        r = self.client.post(f"/api/signing/public/{link['token']}/submit", json={"cms": make_cms(DOCX, iin=student_iin)})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(any("не совпал" in w for w in r.get_json()["warnings"]))   # the child's own certificate ≠ the parent

    def test_bulk_creation_reports_missing_representative(self):
        sid, _, _ = self.make_student(MINOR_BORN, rep=False)
        res = self.client.post("/api/contracts/bulk", json={"student_ids": [sid], "partner_id": self.pid, "dry_run": True},
                               headers=self.admin).get_json()
        item = res["items"][0]
        self.assertEqual(item["code"], "incomplete")
        self.assertIn("законного представителя", item["reason"])

    # ── signing on paper with a scan ───────────────────────────────────────
    def test_scan_link_refuses_electronic_signing(self):
        sid, _, _ = self.make_student(ADULT_BORN, sign_method="scan", rep=False)
        link = self.invite(self.make_contract(sid))["student"]
        self.assertEqual(link["method"], "scan")
        pub = self.pub(link["token"])
        self.assertEqual((pub["request"]["method"], pub["signing_methods"]["scan"], pub["signing_methods"]["ncalayer"]), ("scan", True, False))
        self.assertEqual(self.contract(self.client.get("/api/contracts", headers=self.admin).get_json()["items"][0]["id"])["paper_roles"], ["student"])
        t = link["token"]
        self.assertEqual(self.client.get(f"/api/signing/public/{t}/payload").get_json()["code"], "scan_only")
        self.assertEqual(self.client.post(f"/api/signing/public/{t}/submit", json={"cms": make_cms(DOCX)}).status_code, 409)
        self.app.config["EGOV_SIGN_ENABLED"] = True
        try:
            self.assertEqual(self.client.post(f"/api/signing/public/{t}/egov/session").get_json()["code"], "scan_only")
        finally:
            self.app.config["EGOV_SIGN_ENABLED"] = False

    def test_ecp_link_does_not_take_a_scan(self):
        sid, _, _ = self.make_student(ADULT_BORN, rep=False)
        link = self.invite(self.make_contract(sid))["student"]
        r = self.upload(link["token"], [("a.pdf", scan_pdf())])
        self.assertEqual((r.status_code, r.get_json()["code"]), (409, "not_scan"))

    def test_scan_review_cycle_reject_then_accept(self):
        sid, iin, _ = self.make_student(ADULT_BORN, sign_method="scan", rep=False)
        cid = self.make_contract(sid)
        link = self.invite(cid)["student"]
        t, rid = link["token"], link["id"]

        # 1) the signer uploads a PDF → waits for the college
        up = self.upload(t, [("договор.pdf", scan_pdf())])
        self.assertEqual(up.status_code, 200, up.get_json())
        self.assertEqual(up.get_json()["scan"]["review"], "pending")
        item = self.contract(cid)
        self.assertEqual((item["next_action"], item["scans_to_review"], item["signatures_count"]), ("review_scan", 1, 0))
        stats = self.client.get("/api/contracts/stats", headers=self.admin).get_json()["attention"]
        self.assertEqual(stats["scan_reviews_total"], 1)
        self.assertEqual(self.client.get(f"/api/signing/public/{t}/scan/file").data[:5], b"%PDF-")
        adm = self.client.get(f"/api/signing/requests/{rid}/scan?inline=1", headers=self.admin)
        self.assertEqual((adm.status_code, adm.data[:5]), (200, b"%PDF-"))

        # 2) the college rejects (a reason is mandatory) — the signer sees why and may re-upload
        rv = lambda body, h=None: self.client.post(f"/api/signing/requests/{rid}/scan/review", json=body, headers=h or self.admin)
        self.assertEqual(rv({"decision": "reject"}).status_code, 400)
        self.assertEqual(rv({"decision": "accept"}, self.viewer).status_code, 403)
        self.assertEqual(rv({"decision": "reject", "note": "Нет подписи на последней странице"}).status_code, 200)
        pub = self.pub(t)
        self.assertEqual((pub["request"]["scan"]["review"], pub["request"]["scan"]["review_note"]),
                         ("rejected", "Нет подписи на последней странице"))
        self.assertEqual(self.contract(cid)["scans_to_review"], 0)

        # 3) photos of two pages are merged into ONE pdf and go back to review
        up = self.upload(t, [("1.png", png_bytes()), ("2.png", png_bytes("gray"))])
        self.assertEqual(up.status_code, 200, up.get_json())
        self.assertEqual(self.pub(t)["request"]["scan"]["review"], "pending")
        data = self.client.get(f"/api/signing/public/{t}/scan/file").data
        from pypdf import PdfReader
        self.assertEqual(len(PdfReader(io.BytesIO(data)).pages), 2)

        # 4) accepted → it is the party's signature
        ok = rv({"decision": "accept"})
        self.assertEqual(ok.status_code, 200, ok.get_json())
        item = self.contract(cid)
        sig = item["signatures"][0]
        self.assertEqual((sig["signer_role"], sig["channel"], sig["payload_format"], sig["verification_level"]),
                         ("student", "scan", "scan", "scan"))
        self.assertEqual(item["signed_roles"], ["student"])
        self.assertEqual(self.pub(t)["request"]["status"], "signed")
        self.assertEqual(rv({"decision": "accept"}).status_code, 409)                    # nothing left to review
        self.assertEqual(self.upload(t, [("x.pdf", scan_pdf())]).status_code, 409)       # and no more uploads

    def test_bad_uploads_are_refused_by_content(self):
        sid, _, _ = self.make_student(ADULT_BORN, sign_method="scan", rep=False)
        t = self.invite(self.make_contract(sid))["student"]["token"]
        for name, blob in (("virus.pdf", b"MZ\x90\x00 not a pdf"), ("notes.txt", b"hello"), ("empty.pdf", b""),
                           ("broken.pdf", b"%PDF-1.4 garbage garbage")):
            r = self.upload(t, [(name, blob)])
            self.assertEqual((r.status_code, r.get_json()["code"]), (400, "bad_scan"), name)
        self.assertEqual(self.upload(t, [(f"{i}.png", png_bytes()) for i in range(11)]).status_code, 400)
        self.assertEqual(self.upload(t, [("a.pdf", scan_pdf()), ("b.png", png_bytes())]).status_code, 400)   # pdf + photo mixed
        self.assertEqual(self.client.post(f"/api/signing/public/{t}/scan").status_code, 400)                 # nothing sent
        self.assertEqual(self.pub(t)["request"]["scan"]["review"], None)

    def test_admin_can_attach_a_scan_received_elsewhere(self):
        sid, _, _ = self.make_student(ADULT_BORN, rep=False)
        cid = self.make_contract(sid)
        link = self.invite(cid)["student"]                                       # an ECP link — admin switches to paper
        url = f"/api/signing/requests/{link['id']}/scan/upload"
        data = {"files": (io.BytesIO(scan_pdf()), "wa.pdf")}
        self.assertEqual(self.client.post(url, data=data, content_type="multipart/form-data", headers=self.viewer).status_code, 403)
        r = self.client.post(url, data={"files": (io.BytesIO(scan_pdf()), "wa.pdf")}, content_type="multipart/form-data", headers=self.admin)
        self.assertEqual(r.status_code, 200, r.get_json())
        item = self.contract(cid)
        self.assertEqual((item["signatures"][0]["channel"], item["signed_roles"]), ("scan", ["student"]))

    def test_switch_method_of_an_open_link(self):
        sid, _, _ = self.make_student(ADULT_BORN, rep=False)
        link = self.invite(self.make_contract(sid))["student"]
        sw = lambda m: self.client.post(f"/api/signing/requests/{link['id']}/method", json={"method": m}, headers=self.admin)
        self.assertEqual(sw("scan").get_json()["item"]["method"], "scan")
        self.assertEqual(sw("pigeon").status_code, 400)
        self.assertEqual(self.pub(link["token"])["signing_methods"]["scan"], True)

    def test_verification_page_checks_the_scan_file_itself(self):
        sid, _, _ = self.make_student(ADULT_BORN, sign_method="scan", rep=False)
        cid = self.make_contract(sid)
        link = self.invite(cid)["student"]
        self.upload(link["token"], [("a.pdf", scan_pdf())])
        self.client.post(f"/api/signing/requests/{link['id']}/scan/review", json={"decision": "accept"}, headers=self.admin)
        from app.models import Contract, SigningRequest
        with self.app.app_context():
            code = Contract.query.get(cid).verification_code
            scan_path = SigningRequest.query.get(link["id"]).scan_path
        v = self.client.get(f"/api/verify/{code}").get_json()
        self.assertTrue(v["integrity"]["match"])
        self.assertEqual([(c["format"], c["match"]) for c in v["integrity"]["by_format"]], [("scan", True)])
        self.assertEqual((v["signatures"][0]["channel"], v["signatures"][0]["verification_level"]), ("scan", "scan"))
        with open(os.path.join(self.app.config["UPLOAD_FOLDER"], scan_path), "ab") as fh:     # someone edits the stored scan
            fh.write(b"\n%tampered")
        self.assertFalse(self.client.get(f"/api/verify/{code}").get_json()["integrity"]["match"])

    def test_mixed_channels_complete_the_contract_and_the_delete_guard_counts_scans(self):
        sid, _, _ = self.make_student(ADULT_BORN, sign_method="scan", rep=False)
        cid = self.make_contract(sid)
        links = self.invite(cid, roles=("college", "partner", "student"))
        for role in ("college", "partner"):
            self.assertEqual(self.client.post(f"/api/signing/public/{links[role]['token']}/submit",
                                              json={"cms": make_cms(DOCX)}).status_code, 200)
        self.upload(links["student"]["token"], [("a.pdf", scan_pdf())])
        self.assertNotEqual(self.contract(cid)["status"], "signed")                    # a scan alone is not enough
        self.client.post(f"/api/signing/requests/{links['student']['id']}/scan/review", json={"decision": "accept"}, headers=self.admin)
        item = self.contract(cid)
        self.assertEqual((item["status"], item["next_action"]), ("signed", "complete"))
        self.assertEqual(item["signed_roles"], ["college", "partner", "student"])
        r = self.client.delete(f"/api/contracts/{cid}", headers=self.admin)
        self.assertEqual((r.status_code, r.get_json()["code"]), (409, "has_signatures"))

    # ── student attribute, bulk and Excel ──────────────────────────────────
    def test_sign_method_on_the_student_card_bulk_and_filters(self):
        sid, _, _ = self.make_student(ADULT_BORN, rep=False)
        put = lambda body: self.client.put(f"/api/students/{sid}", json=body, headers=self.admin)
        self.assertEqual(put({"sign_method": "pigeon"}).status_code, 400)
        self.assertEqual(put({"sign_method": "scan"}).get_json()["item"]["sign_method"], "scan")
        self.assertEqual(len(self.client.get("/api/students?sign_method=scan", headers=self.admin).get_json()["items"]), 1)
        put({"sign_method": "ecp"})
        r = self.client.post("/api/students/bulk-practice", json={"student_ids": [sid], "fields": {"sign_method": "scan"}}, headers=self.admin)
        self.assertEqual((r.status_code, r.get_json()["updated"]), (200, 1))
        self.assertEqual(self.client.get(f"/api/students/{sid}", headers=self.admin).get_json()["item"]["sign_method"], "scan")

    def test_excel_column_marks_who_signs_on_paper(self):
        i1, i2, i3 = (self.make_iin("20080101", "5", f"{n:04d}") for n in (11, 12, 13))
        data = self.xlsx({"ПО 26-1": [["ФИО", "ИИН", "Способ подписания", "Проживает за пределами РК"],
                                      ["Первый Ученик", i1, "Скан", None],
                                      ["Второй Ученик", i2, None, "Да"],
                                      ["Третий Ученик", i3, "ЭЦП", "Нет"]]})
        self.assertEqual(self.upload_xlsx("/api/students/import/commit", data).status_code, 200)
        from app.models import Student
        with self.app.app_context():
            got = {s.full_name: s.sign_method for s in Student.query.filter(Student.group_name == "ПО 26-1")}
        self.assertEqual(got, {"Первый Ученик": "scan", "Второй Ученик": "scan", "Третий Ученик": "ecp"})
        # a second file can raise an existing student to «scan» even in the cautious «fill» mode
        again = self.xlsx({"ПО 26-1": [["ФИО", "ИИН", "Способ подписания"], ["Третий Ученик", i3, "Скан"]]})
        self.assertEqual(self.upload_xlsx("/api/students/import/commit", again).status_code, 200)
        with self.app.app_context():
            self.assertEqual(Student.query.filter_by(iin=i3).one().sign_method, "scan")

    def upload_xlsx(self, path, data):
        return self.upload_file(path, data)

    def upload_file(self, path, data, options=None):
        import json
        form = {"file": (io.BytesIO(data), "k.xlsx"), "options": json.dumps(options or {})}
        return self.client.post(path, data=form, headers=self.admin, content_type="multipart/form-data")

    def test_links_excel_says_how_each_party_signs(self):
        sid, _, _ = self.make_student(ADULT_BORN, sign_method="scan", rep=False)
        cid = self.make_contract(sid)
        self.invite(cid, roles=("partner", "student"))
        x = self.client.post("/api/signing/links-export", json={"contract_ids": [cid]}, headers=self.admin)
        from openpyxl import load_workbook
        rows = list(load_workbook(io.BytesIO(x.data)).active.iter_rows(values_only=True))
        by_role = {r[3]: r for r in rows[1:]}
        self.assertEqual(by_role["Обучающийся"][11], "Скан (бумага)")
        self.assertIn("распечатайте", by_role["Обучающийся"][10])
        self.assertEqual(by_role["Предприятие"][11], "ЭЦП")


if __name__ == "__main__":
    unittest.main()
