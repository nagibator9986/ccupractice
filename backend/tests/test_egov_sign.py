"""eGov mobile (QR / deep link) signing — the phone is simulated with a real RSA
certificate and `cryptography`'s PKCS#7 builder, so the server-side verification
runs exactly as it would for a genuine signature."""
from __future__ import annotations

import base64
import datetime as dt
import os
import re
import unittest
from datetime import date
from urllib.parse import parse_qs, unquote, urlparse

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs7
from cryptography.x509.oid import NameOID

from tests.base import AppTestCase

PDF = b"%PDF-1.4\n% fake contract pdf for tests\n" + os.urandom(64)
DOCX = b"PK\x03\x04 fake docx " + os.urandom(64)


def make_cms(payload: bytes, *, iin: str = "080515512345", name: str = "ТЕСТОВ ТЕСТ") -> str:
    """Attached CMS (CMS_WITH_DATA) signed with a throw-away RSA certificate."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "KZ"),
        x509.NameAttribute(NameOID.COMMON_NAME, name),
        x509.NameAttribute(NameOID.SERIAL_NUMBER, f"IIN{iin}"),
    ])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
        .public_key(key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1)).not_valid_after(now + dt.timedelta(days=365))
        .sign(key, hashes.SHA256())
    )
    der = (
        pkcs7.PKCS7SignatureBuilder().set_data(payload).add_signer(cert, key, hashes.SHA256())
        .sign(serialization.Encoding.DER, [pkcs7.PKCS7Options.Binary])
    )
    return base64.b64encode(der).decode("ascii")


class EgovSignTests(AppTestCase):
    def setUp(self):
        self.reset_db()
        from app.extensions import db
        from app.models import EgovSignSession, Partner, SigningRequest, Signature, Student

        self.app.config["EGOV_SIGN_ENABLED"] = True
        with self.app.app_context():
            EgovSignSession.query.delete()
            Signature.query.delete()
            SigningRequest.query.delete()
            p = Partner(organization_name="ТОО Ромашка", bin="123456789012", legal_address="г. Алматы",
                        director_full_name="Директоров Д.Д.")
            s = Student(full_name="Иванов Иван", iin="080515512345", group_name="ПО 25-1",
                        practice_start=date(2026, 6, 1), practice_end=date(2026, 6, 30))
            db.session.add_all([p, s])
            db.session.commit()
            pid, sid = p.id, s.id
        self.cid = self.client.post("/api/contracts", json={"student_id": sid, "partner_id": pid},
                                    headers=self.admin).get_json()["item"]["id"]
        self._write_files(PDF)
        res = self.client.post("/api/signing/bulk-invite", json={"contract_ids": [self.cid], "roles": ["student"]},
                               headers=self.admin).get_json()
        self.token = res["items"][0]["links"][0]["token"]

    def tearDown(self):
        self.app.config["EGOV_SIGN_ENABLED"] = False

    def _write_files(self, pdf: bytes):
        from app.extensions import db
        from app.models import Contract

        archive = self.app.config["ARCHIVE_FOLDER"]
        os.makedirs(archive, exist_ok=True)
        with open(f"{archive}/c{self.cid}.docx", "wb") as fh:
            fh.write(DOCX)
        with open(f"{archive}/c{self.cid}.pdf", "wb") as fh:
            fh.write(pdf)
        with self.app.app_context():
            c = db.session.get(Contract, self.cid)
            c.docx_path, c.pdf_path, c.status = f"c{self.cid}.docx", f"c{self.cid}.pdf", "sent"
            db.session.commit()

    def start(self, **kw):
        return self.client.post(f"/api/signing/public/{self.token}/egov/session",
                                headers={"X-Public-Origin": "https://practice.example.kz"}, **kw)

    @staticmethod
    def secret_of(qr_content: str) -> str:
        return qr_content.rsplit("/", 1)[-1]

    def put(self, secret, auth, cms, **kw):
        return self.client.put(f"/api/egov/{secret}/documents", headers={"Authorization": f"Bearer {auth}", **kw.pop("headers", {})},
                               json={"signMethod": "CMS_WITH_DATA", "version": 1,
                                     "documentsToSign": [{"id": self.cid, "document": {"file": {"mime": "application/pdf", "data": cms}}}]})

    # ── switch ─────────────────────────────────────────────────────────────
    def test_off_by_default_and_reported_to_the_signer_page(self):
        self.app.config["EGOV_SIGN_ENABLED"] = False
        r = self.start()
        self.assertEqual((r.status_code, r.get_json()["code"]), (404, "egov_disabled"))
        pub = self.client.get(f"/api/signing/public/{self.token}").get_json()
        self.assertFalse(pub["signing_methods"]["egov_mobile"]["enabled"])
        self.assertTrue(pub["signing_methods"]["ncalayer"])
        self.app.config["EGOV_SIGN_ENABLED"] = True
        pub = self.client.get(f"/api/signing/public/{self.token}").get_json()
        self.assertTrue(pub["signing_methods"]["egov_mobile"]["available"])

    # ── the happy path, exactly as the phone does it ───────────────────────
    def test_full_qr_flow(self):
        r = self.start()
        self.assertEqual(r.status_code, 201, r.get_json())
        body = r.get_json()
        self.assertTrue(body["qr_content"].startswith("mobileSign:https://practice.example.kz/api/egov/"))
        self.assertTrue(body["qr_png"].startswith("data:image/png;base64,"))
        self.assertTrue(body["https"])
        secret = self.secret_of(body["qr_content"])

        # deep links follow the spec: fixed prefix, the API №1 URL in ?link=, per-OS app ids
        api1_url = body["qr_content"][len("mobileSign:"):]
        ios, android = body["deep_links"]["ios"], body["deep_links"]["android"]
        self.assertTrue(ios.startswith("https://mgovsign.page.link/?link="))
        self.assertEqual(unquote(parse_qs(urlparse(ios).query)["link"][0]), api1_url)
        self.assertIn("isi=1476128386", ios)
        self.assertIn("ibi=kz.egov.mobile", ios)
        self.assertIn("apn=kz.mobile.mgov", android)

        # API №1 — public, tells the app what/who/where
        a1 = self.client.get(f"/api/egov/{secret}").get_json()
        self.assertRegex(a1["expiry_date"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
        self.assertEqual(a1["document"]["auth_type"], "Token")
        self.assertEqual(a1["document"]["uri"], f"https://practice.example.kz/api/egov/{secret}/documents")
        self.assertIn("ПП-", a1["description"])
        self.assertTrue(a1["organisation"]["nameRu"])
        auth = a1["document"]["auth_token"]
        sid = body["session"]["id"]
        poll = self.client.get(f"/api/signing/public/{self.token}/egov/session/{sid}").get_json()
        self.assertEqual(poll["session"]["status"], "opened")

        # API №2 GET — needs the Bearer token, hands over the PDF
        url = f"/api/egov/{secret}/documents"
        self.assertEqual(self.client.get(url).status_code, 401)
        self.assertEqual(self.client.get(url, headers={"Authorization": "Bearer nope"}).status_code, 401)
        docs = self.client.get(url, headers={"Authorization": f"Bearer {auth}"}).get_json()
        self.assertEqual((docs["signMethod"], docs["version"]), ("CMS_WITH_DATA", 1))
        item = docs["documentsToSign"][0]
        self.assertEqual(item["document"]["file"]["mime"], "application/pdf")
        self.assertEqual(base64.b64decode(item["document"]["file"]["data"]), PDF)
        self.assertTrue(any(m["name"] == "Студент" and m["value"] == "Иванов Иван" for m in item["meta"]))

        # API №2 PUT — the signed result
        cms = make_cms(PDF)
        done = self.put(secret, auth, cms)
        self.assertEqual((done.status_code, done.get_json()["message"]), (200, "success"))

        from app.models import Contract, Signature, SigningRequest
        with self.app.app_context():
            sig = Signature.query.filter_by(contract_id=self.cid).one()
            self.assertEqual((sig.signer_role, sig.channel, sig.payload_format), ("student", "egov_mobile", "pdf"))
            self.assertEqual(sig.verification_level, "full")
            self.assertEqual(SigningRequest.query.filter_by(token=self.token).one().status, "signed")
        poll = self.client.get(f"/api/signing/public/{self.token}/egov/session/{sid}").get_json()
        self.assertEqual((poll["session"]["status"], poll["request_status"]), ("signed", "signed"))

        # the session is spent
        self.assertEqual(self.put(secret, auth, cms).status_code, 410)
        self.assertEqual(self.client.get(f"/api/egov/{secret}").status_code, 410)

        # admin sees how it was signed; public verification checks the PDF hash
        item = self.client.get(f"/api/contracts/{self.cid}", headers=self.admin).get_json()["item"]
        self.assertEqual([(s["channel"], s["payload_format"]) for s in item["signatures"]], [("egov_mobile", "pdf")])
        with self.app.app_context():
            code = Contract.query.get(self.cid).verification_code
        v = self.client.get(f"/api/verify/{code}").get_json()
        self.assertTrue(v["integrity"]["match"])
        self.assertEqual([(c["format"], c["match"]) for c in v["integrity"]["by_format"]], [("pdf", True)])
        self._write_files(PDF + b"tampered")                 # someone swaps the archived PDF
        v = self.client.get(f"/api/verify/{code}").get_json()
        self.assertFalse(v["integrity"]["match"])

    # ── things that must be refused ────────────────────────────────────────
    def _opened(self):
        body = self.start().get_json()
        secret = self.secret_of(body["qr_content"])
        auth = self.client.get(f"/api/egov/{secret}").get_json()["document"]["auth_token"]
        return body["session"]["id"], secret, auth

    def test_signature_over_a_different_document_is_rejected(self):
        sid, secret, auth = self._opened()
        r = self.put(secret, auth, make_cms(b"some other document"))
        self.assertEqual(r.status_code, 403)
        self.assertIn("не тот документ", r.get_json()["message"])
        poll = self.client.get(f"/api/signing/public/{self.token}/egov/session/{sid}").get_json()
        self.assertEqual(poll["session"]["status"], "failed")
        self.assertIn("не тот документ", poll["session"]["error"])
        from app.models import Signature
        with self.app.app_context():
            self.assertEqual(Signature.query.count(), 0)

    def test_cms_over_the_base64_text_is_rejected(self):
        """Regression guard for the Android build that signed the base64 string."""
        sid, secret, auth = self._opened()
        r = self.put(secret, auth, make_cms(base64.b64encode(PDF)))
        self.assertEqual(r.status_code, 403)

    def test_garbage_and_wrong_shape(self):
        sid, secret, auth = self._opened()
        bad = self.client.put(f"/api/egov/{secret}/documents", headers={"Authorization": f"Bearer {auth}"}, json={"x": 1})
        self.assertEqual(bad.status_code, 400)                  # wrong shape does not burn the session
        self.assertEqual(self.put(secret, auth, "!!!not-a-cms!!!").status_code, 403)
        self.assertEqual(self.put(secret, auth, make_cms(PDF)).status_code, 410)   # …a refused signature does

    def test_expired_session(self):
        from app.extensions import db
        from app.models import EgovSignSession
        sid, secret, auth = self._opened()
        with self.app.app_context():
            s = db.session.get(EgovSignSession, sid)
            s.expires_at = s.created_at - dt.timedelta(minutes=1)
            db.session.commit()
        self.assertEqual(self.client.get(f"/api/egov/{secret}").status_code, 410)
        poll = self.client.get(f"/api/signing/public/{self.token}/egov/session/{sid}").get_json()
        self.assertEqual(poll["session"]["status"], "expired")

    def test_pdf_regenerated_between_scan_and_confirm(self):
        sid, secret, auth = self._opened()
        self._write_files(PDF + b"regenerated")
        r = self.put(secret, auth, make_cms(PDF))
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.client.get(f"/api/egov/{secret}/documents", headers={"Authorization": f"Bearer {auth}"}).status_code, 410)

    def test_new_qr_retires_the_old_one_and_messages_follow_accept_language(self):
        first = self.start().get_json()
        second = self.start().get_json()
        old_secret = self.secret_of(first["qr_content"])
        r = self.client.get(f"/api/egov/{old_secret}", headers={"Accept-Language": "kk"})
        self.assertEqual(r.status_code, 410)
        self.assertIn("жабылған", r.get_json()["message"])
        self.assertEqual(self.client.get(f"/api/egov/{self.secret_of(second['qr_content'])}").status_code, 200)
        self.assertEqual(self.client.get("/api/egov/unknown", headers={"Accept-Language": "en"}).get_json()["message"],
                         "The signing session is invalid.")

    def test_needs_a_pdf(self):
        from app.extensions import db
        from app.models import Contract
        with self.app.app_context():
            db.session.get(Contract, self.cid).pdf_path = None
            db.session.commit()
        self.assertEqual(self.start().get_json()["code"], "pdf_missing")

    # ── regression: the refactored NCALayer path ───────────────────────────
    def test_ncalayer_submit_still_signs_the_docx(self):
        r = self.client.post(f"/api/signing/public/{self.token}/submit", json={"cms": make_cms(DOCX)})
        self.assertEqual(r.status_code, 200, r.get_json())
        from app.models import Signature
        with self.app.app_context():
            sig = Signature.query.filter_by(contract_id=self.cid).one()
            self.assertEqual((sig.channel, sig.payload_format), ("ncalayer", "docx"))
        again = self.client.post(f"/api/signing/public/{self.token}/submit", json={"cms": make_cms(DOCX)})
        self.assertEqual(again.status_code, 409)

    def test_ncalayer_submit_rejects_a_wrong_document(self):
        r = self.client.post(f"/api/signing/public/{self.token}/submit", json={"cms": make_cms(b"other")})
        self.assertEqual(r.status_code, 400)


if __name__ == "__main__":
    unittest.main()
