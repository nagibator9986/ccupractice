"""Password lock for the «Договоры со студентами» and «LMS-договоры» sections.

The sections hold personal data of applicants and parents, so a signed-in college account is not
enough: the person must also know the section password. The lock is enforced HERE, on the server —
hiding the menu items in the SPA would leave every `/api/enrollments` and `/api/lms-contracts`
call open to anyone with a login.

* Configure with ``SECTIONS_LOCK_PASSWORD`` (an environment variable — never commit the password).
  Unset/empty = the lock is off (local development and tests).
* ``POST /api/sections-lock/unlock`` checks the password and returns a signed token bound to the
  signed-in user (and to the current password, so changing it logs everyone out). The SPA keeps the
  token in ``sessionStorage`` and sends it as ``X-Section-Unlock``.
* ``protect_blueprint`` answers 423 ``section_locked`` for every route of a section except the
  token-scoped ``/public/<token>/…`` signing routes, which parents and students use without a login.
* Archived files of these sections are also reachable through ``/api/files/archive/<path>``;
  ``archive_path_needs_unlock`` closes that side door (only the practice folder stays open).
"""
from __future__ import annotations

import hashlib
import hmac
import os
import posixpath
import time
import unicodedata
from pathlib import PurePosixPath

from flask import current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

HEADER = "X-Section-Unlock"
TOKEN_TTL_SECONDS = 8 * 3600
PRACTICE_ARCHIVE_ROOT = "Профессиональная практика"

MAX_FAILURES = 5
FAILURE_WINDOW_SECONDS = 10 * 60
_failures: dict[str, list[float]] = {}


def configured_password() -> str:
    return os.getenv("SECTIONS_LOCK_PASSWORD", "")


def lock_enabled() -> bool:
    return bool(configured_password())


def check_password(candidate: str) -> bool:
    return hmac.compare_digest((candidate or "").encode("utf-8"), configured_password().encode("utf-8"))


def _fingerprint() -> str:
    return hashlib.sha256(("sections-lock:" + configured_password()).encode("utf-8")).hexdigest()[:16]


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="sections-lock-v1")


def issue_token(user_id) -> str:
    return _serializer().dumps({"uid": str(user_id), "fp": _fingerprint()})


def _signed_in_user():
    verify_jwt_in_request(optional=True)
    return get_jwt_identity()


def is_unlocked() -> bool:
    """True when the lock is off, or the request carries a valid unlock token of this very user."""
    if not lock_enabled():
        return True
    token = request.headers.get(HEADER, "")
    if not token:
        return False
    try:
        data = _serializer().loads(token, max_age=TOKEN_TTL_SECONDS)
    except (BadSignature, SignatureExpired):
        return False
    uid = _signed_in_user()
    return (
        uid is not None
        and isinstance(data, dict)
        and data.get("uid") == str(uid)
        and hmac.compare_digest(str(data.get("fp", "")), _fingerprint())
    )


def locked_response():
    return jsonify(error="Раздел закрыт паролем", code="section_locked"), 423


def protect_blueprint(bp) -> None:
    """Lock every route of ``bp`` except the public token-scoped signing routes."""

    @bp.before_request
    def _section_lock():
        if request.method == "OPTIONS" or not lock_enabled():
            return None
        rule = request.url_rule.rule if request.url_rule else ""
        if "/public/" in rule:                  # a pattern, so a caller cannot spoof it through the URL
            return None
        if _signed_in_user() is None:           # let the route's own @jwt_required answer 401
            return None
        return None if is_unlocked() else locked_response()


def archive_path_needs_unlock(filename: str) -> bool:
    """True for an archive file outside the (open) practice folder.

    The path is normalised first: ``Профессиональная практика/../Образовательные услуги/x`` starts
    with the open folder but resolves into a locked one. Anything unclear counts as locked.
    """
    clean = posixpath.normpath(unicodedata.normalize("NFC", filename or ""))
    parts = PurePosixPath(clean).parts
    return not (len(parts) > 1 and parts[0] == PRACTICE_ARCHIVE_ROOT and ".." not in parts)


# ── brute-force throttle (per signed-in user + address, in memory) ───────────────

def _throttle_key(user_id) -> str:
    return f"{user_id}|{request.headers.get('X-Forwarded-For', request.remote_addr or '').split(',')[0].strip()}"


def retry_after_seconds(user_id) -> int:
    """0 when another attempt is allowed, else seconds until the oldest failure leaves the window."""
    now = time.time()
    recent = [t for t in _failures.get(_throttle_key(user_id), []) if now - t < FAILURE_WINDOW_SECONDS]
    _failures[_throttle_key(user_id)] = recent
    if len(recent) < MAX_FAILURES:
        return 0
    return int(FAILURE_WINDOW_SECONDS - (now - recent[0])) + 1


def record_failure(user_id) -> None:
    _failures.setdefault(_throttle_key(user_id), []).append(time.time())


def clear_failures(user_id) -> None:
    _failures.pop(_throttle_key(user_id), None)
