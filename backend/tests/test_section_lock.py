"""Password lock of «Договоры со студентами» / «LMS-договоры» (SECTIONS_LOCK_PASSWORD).

Enforced on the server: a signed-in account without the section password gets 423 on every route of
the two sections, while token-scoped public signing links and the practice process stay open.
"""
from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest import mock

from tests.base import AppTestCase

PASSWORD = "test-section-password"
SECTIONS = ("/api/enrollments", "/api/lms-contracts")


class SectionLockTests(AppTestCase):
    def setUp(self):
        from app.utils import section_lock

        section_lock._failures.clear()
        patcher = mock.patch.dict(os.environ, {"SECTIONS_LOCK_PASSWORD": PASSWORD})
        patcher.start()
        self.addCleanup(patcher.stop)

    # ── helpers ────────────────────────────────────────────────────────────
    def _unlock(self, headers=None, password=PASSWORD):
        return self.client.post("/api/sections-lock/unlock", json={"password": password},
                                headers=headers or self.admin)

    def _with_token(self, headers=None):
        res = self._unlock(headers)
        self.assertEqual(res.status_code, 200, res.get_json())
        return {**(headers or self.admin), "X-Section-Unlock": res.get_json()["token"]}

    # ── the lock ───────────────────────────────────────────────────────────
    def test_both_sections_answer_423_without_the_password(self):
        routes = [
            ("get", "/api/enrollments"), ("get", "/api/enrollments/1"), ("post", "/api/enrollments"),
            ("delete", "/api/enrollments/1"), ("get", "/api/enrollments/1/download/contract/pdf"),
            ("get", "/api/enrollments/1/certificate"), ("post", "/api/enrollments/1/invite"),
            ("get", "/api/lms-contracts"), ("get", "/api/lms-contracts/1"), ("post", "/api/lms-contracts"),
            ("delete", "/api/lms-contracts/1"), ("get", "/api/lms-contracts/1/download/pdf"),
            ("get", "/api/lms-contracts/grant-students"), ("post", "/api/lms-contracts/1/invite"),
        ]
        for method, path in routes:
            res = getattr(self.client, method)(path, headers=self.admin)
            self.assertEqual(res.status_code, 423, (method, path, res.data[:120]))
            self.assertEqual(res.get_json()["code"], "section_locked")

    def test_viewer_is_locked_too_and_anonymous_still_gets_401(self):
        self.assertEqual(self.client.get("/api/enrollments", headers=self.viewer).status_code, 423)
        self.assertEqual(self.client.get("/api/enrollments").status_code, 401)
        self.assertEqual(self.client.get("/api/lms-contracts").status_code, 401)

    def test_unlock_opens_both_sections(self):
        headers = self._with_token()
        for base in SECTIONS:
            res = self.client.get(base, headers=headers)
            self.assertEqual(res.status_code, 200, (base, res.get_json()))

    def test_status_endpoint_reports_state(self):
        before = self.client.get("/api/sections-lock", headers=self.admin).get_json()
        self.assertEqual((before["enabled"], before["unlocked"]), (True, False))
        after = self.client.get("/api/sections-lock", headers=self._with_token()).get_json()
        self.assertEqual((after["enabled"], after["unlocked"]), (True, True))

    def test_wrong_password_is_refused_and_missing_body_too(self):
        res = self._unlock(password="nope")
        self.assertEqual((res.status_code, res.get_json()["code"]), (403, "bad_password"))
        self.assertEqual(self.client.post("/api/sections-lock/unlock", json={}, headers=self.admin).status_code, 403)
        self.assertEqual(self.client.post("/api/sections-lock/unlock", json={"password": 123456},
                                          headers=self.admin).status_code, 403)

    def test_token_is_bound_to_the_user(self):
        admin_token = self._with_token()["X-Section-Unlock"]
        res = self.client.get("/api/enrollments", headers={**self.viewer, "X-Section-Unlock": admin_token})
        self.assertEqual(res.status_code, 423)

    def test_garbage_token_is_refused(self):
        res = self.client.get("/api/enrollments", headers={**self.admin, "X-Section-Unlock": "x.y.z"})
        self.assertEqual(res.status_code, 423)

    def test_changing_the_password_logs_everyone_out(self):
        headers = self._with_token()
        self.assertEqual(self.client.get("/api/enrollments", headers=headers).status_code, 200)
        with mock.patch.dict(os.environ, {"SECTIONS_LOCK_PASSWORD": PASSWORD + "-new"}):
            self.assertEqual(self.client.get("/api/enrollments", headers=headers).status_code, 423)

    def test_brute_force_is_throttled(self):
        for _ in range(5):
            self.assertEqual(self._unlock(password="guess").status_code, 403)
        res = self._unlock()                       # even the right password waits
        self.assertEqual(res.status_code, 429)
        self.assertGreater(int(res.headers["Retry-After"]), 0)
        # another account is not affected by this one's failures
        self.assertEqual(self._unlock(headers=self.viewer).status_code, 200)

    # ── what must stay open ────────────────────────────────────────────────
    def test_public_signing_links_stay_open(self):
        for path in ("/api/enrollments/public/nope", "/api/lms-contracts/public/nope"):
            self.assertEqual(self.client.get(path).status_code, 404, path)       # not 423, not 401
        self.assertEqual(self.client.post("/api/enrollments/public/nope/view").status_code, 404)

    def test_practice_process_is_not_locked(self):
        for path in ("/api/contracts", "/api/students", "/api/partners", "/api/archive"):
            self.assertEqual(self.client.get(path, headers=self.admin).status_code, 200, path)

    def test_lock_is_off_when_no_password_is_configured(self):
        with mock.patch.dict(os.environ, {"SECTIONS_LOCK_PASSWORD": ""}):
            self.assertEqual(self.client.get("/api/enrollments", headers=self.admin).status_code, 200)
            self.assertEqual(self.client.get("/api/sections-lock", headers=self.admin).get_json()["enabled"], False)
            self.assertEqual(self._unlock().get_json()["enabled"], False)

    # ── the side door ──────────────────────────────────────────────────────
    def test_archive_file_route_keeps_section_files_behind_the_password(self):
        root = Path(self.app.config["ARCHIVE_FOLDER"])
        edu = root / "Образовательные услуги" / "2026" / "Иванов" / "Договор.txt"
        practice = root / "Профессиональная практика" / "2026" / "ТОО" / "Договор.txt"
        for f in (edu, practice):
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text("x", encoding="utf-8")

        get = lambda rel, h=None: self.client.get(f"/api/files/archive/{rel}", headers=h or self.admin).status_code
        self.assertEqual(get("Профессиональная практика/2026/ТОО/Договор.txt"), 200)
        self.assertEqual(get("Образовательные услуги/2026/Иванов/Договор.txt"), 423)
        self.assertEqual(get("Образовательные услуги/2026/Иванов/Договор.txt", self._with_token()), 200)
        # starts in the open folder, resolves into a locked one
        self.assertEqual(get("Профессиональная практика/../Образовательные услуги/2026/Иванов/Договор.txt"), 423)
        self.assertEqual(get("Сертификаты_подписания/x.pdf"), 423)


if __name__ == "__main__":
    unittest.main()
