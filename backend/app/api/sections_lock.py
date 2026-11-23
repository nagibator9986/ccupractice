"""Unlock endpoints for the password-protected sections (see ``utils/section_lock.py``).

    GET  /api/sections-lock          {enabled, unlocked, ttl_seconds}
    POST /api/sections-lock/unlock   {password} → {token, expires_in}   (403 wrong, 429 too many tries)
"""
from __future__ import annotations

from flask import Blueprint, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..utils.section_lock import (
    TOKEN_TTL_SECONDS,
    check_password,
    clear_failures,
    is_unlocked,
    issue_token,
    lock_enabled,
    record_failure,
    retry_after_seconds,
)
from ..utils.serializers import get_json_safe

bp = Blueprint("sections_lock", __name__)


@bp.get("")
@jwt_required()
def status():
    return jsonify(enabled=lock_enabled(), unlocked=is_unlocked(), ttl_seconds=TOKEN_TTL_SECONDS)


@bp.post("/unlock")
@jwt_required()
def unlock():
    if not lock_enabled():
        return jsonify(ok=True, enabled=False)
    uid = get_jwt_identity()
    wait = retry_after_seconds(uid)
    if wait:
        resp = jsonify(
            error=f"Слишком много неверных попыток. Повторите через {max(1, wait // 60)} мин.",
            code="too_many_attempts", retry_after=wait,
        )
        resp.status_code = 429
        resp.headers["Retry-After"] = str(wait)
        return resp
    password = get_json_safe().get("password")
    if not isinstance(password, str) or not check_password(password):
        record_failure(uid)
        return jsonify(error="Неверный пароль", code="bad_password"), 403
    clear_failures(uid)
    return jsonify(ok=True, enabled=True, token=issue_token(uid), expires_in=TOKEN_TTL_SECONDS)
