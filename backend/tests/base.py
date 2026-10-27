"""Shared fixture: a throw-away app on a temp SQLite DB with admin/viewer tokens.

Run:  cd backend && .venv/bin/python -m unittest discover -s tests -v
"""
from __future__ import annotations

import io
import os
import shutil
import tempfile
import unittest

from openpyxl import Workbook


class AppTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.mkdtemp(prefix="ccu_test_")
        os.environ.update(
            DATABASE_URL=f"sqlite:///{cls._tmp}/test.db",
            UPLOAD_FOLDER=f"{cls._tmp}/uploads",
            ARCHIVE_FOLDER=f"{cls._tmp}/archive",
            FLASK_DEBUG="1",
            SECRET_KEY="test-secret",
            JWT_SECRET_KEY="test-jwt-secret-test-jwt-secret-1234",
        )
        from app import create_app

        cls.app = create_app()
        cls.client = cls.app.test_client()
        cls.admin = cls._login("admin@ccu.kz", "admin123")
        cls.viewer = cls._login("viewer@ccu.kz", "viewer123")

    @classmethod
    def tearDownClass(cls):
        with cls.app.app_context():
            from app.extensions import db

            db.session.remove()
            db.engine.dispose()
        shutil.rmtree(cls._tmp, ignore_errors=True)

    @classmethod
    def _login(cls, email, password):
        r = cls.client.post("/api/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, r.get_json()
        return {"Authorization": f"Bearer {r.get_json()['token']}"}

    # ── helpers ────────────────────────────────────────────────────────────
    def reset_db(self):
        from app.extensions import db
        from app.models import Contract, Partner, Student

        with self.app.app_context():
            for model in (Contract, Student, Partner):
                model.query.delete()
            db.session.commit()

    @staticmethod
    def xlsx(sheets: dict[str, list[list]]) -> bytes:
        wb = Workbook()
        wb.remove(wb.active)
        for name, rows in sheets.items():
            ws = wb.create_sheet(name)
            for r in rows:
                ws.append(r)
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    def upload(self, path, data: bytes, options: dict | None = None, filename="list.xlsx", headers=None, **extra):
        import json

        form = {"file": (io.BytesIO(data), filename), "options": json.dumps(options or {})}
        form.update({k: str(v) for k, v in extra.items()})
        return self.client.post(path, data=form, headers=headers or self.admin,
                                content_type="multipart/form-data")

    @staticmethod
    def make_iin(birth="20080512", century_digit="5", serial="0001"):
        """Valid ИИН: YYMMDD + century digit + 4 serial digits + control digit."""
        from app.utils.iin import iin_checksum_ok

        base = birth[2:] + century_digit + serial
        for extra in range(10):
            candidate = base + str(extra)
            if iin_checksum_ok(candidate):
                return candidate
        # control digit is derived from the first 11 digits; try other serials
        for n in range(1, 9999):
            base = birth[2:] + century_digit + f"{n:04d}"
            for extra in range(10):
                if iin_checksum_ok(base + str(extra)):
                    return base + str(extra)
        raise AssertionError("no valid ИИН")
