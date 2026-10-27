"""Signing through the eGov mobile app (QR code / dynamic link).

Browser side (the signer's page, token = the signing link):
    POST /api/signing/public/<token>/egov/session           start a session → QR + deep links
    GET  /api/signing/public/<token>/egov/session/<id>      poll its status

Phone side (eGov mobile calls these; the spec's «API №1» / «API №2»):
    GET  /api/egov/<secret>                                 API №1 — what is being signed
    GET  /api/egov/<secret>/documents                       API №2 — download the PDF (Bearer)
    PUT  /api/egov/<secret>/documents                       API №2 — upload the signature (Bearer)

The whole feature is OFF unless ``EGOV_SIGN_ENABLED=1``: eGov only lets a
registered (whitelisted) domain start QR signing, so enabling it before that
would just show signers a QR that fails. See docs/EGOV_MOBILE_SETUP.md.
"""
from __future__ import annotations

import base64
import hmac
import hashlib
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy.exc import IntegrityError, OperationalError

from ..extensions import db
from ..models import CollegeSettings, EgovSignSession, SigningRequest
from ..services import egov_sign as egov
from ..services.qr import generate_qr_png
from ..services.signature_service import SignatureError
from ..services.signature_verification import verify_cms_signature
from ..utils.serializers import get_json_safe
from ..utils.time import utc_now
from .signing import ROLE_LABELS, SignConflict, record_public_signature

bp = Blueprint("egov_sign", __name__)


def _public_base() -> str:
    return request.headers.get("X-Public-Origin") or request.host_url.rstrip("/")


def _lang() -> str:
    return egov.pick_lang(request.headers.get("Accept-Language"))


def _phone_error(key: str, status: int, **fmt):
    """eGov mobile shows ``{"message": ...}`` from the server verbatim."""
    return jsonify(message=egov.message(key, _lang(), **fmt)), status


def _pdf_bytes(contract) -> bytes | None:
    if not contract.pdf_path:
        return None
    path = Path(current_app.config["ARCHIVE_FOLDER"]) / contract.pdf_path
    return path.read_bytes() if path.is_file() else None


# ─────────────────────────────────────────────────────────────────────────────
# Browser side
# ─────────────────────────────────────────────────────────────────────────────

def _live_request(token: str):
    """(SigningRequest, error response) for a link that may still be signed."""
    sr = SigningRequest.query.filter_by(token=token).first()
    if not sr:
        return None, (jsonify(error="Ссылка недействительна"), 404)
    if sr.is_expired:
        return None, (jsonify(error="Срок ссылки истёк", code="expired"), 410)
    if sr.status == "revoked":
        return None, (jsonify(error="Ссылка отозвана", code="revoked"), 410)
    if sr.status == "signed":
        return None, (jsonify(error="Документ уже подписан по этой ссылке", code="signed"), 409)
    return sr, None


@bp.post("/signing/public/<string:token>/egov/session")
def start_session(token: str):
    if not egov.is_enabled():
        return jsonify(error="Подписание через eGov mobile не включено", code="egov_disabled"), 404
    sr, err = _live_request(token)
    if err:
        return err
    pdf = _pdf_bytes(sr.contract)
    if pdf is None:
        return jsonify(
            error="Для подписи через eGov mobile нужен PDF-файл договора. Обратитесь в колледж.",
            code="pdf_missing",
        ), 409

    # One live QR per signer: starting a new one retires the previous.
    EgovSignSession.query.filter(
        EgovSignSession.signing_request_id == sr.id,
        EgovSignSession.status.in_(("pending", "opened")),
    ).update({"status": "cancelled"}, synchronize_session=False)

    base = _public_base().rstrip("/")
    session = EgovSignSession(
        signing_request_id=sr.id,
        payload_sha256=hashlib.sha256(pdf).hexdigest(),
        base_url=base[:300],
        expires_at=EgovSignSession.new_expiry(egov.session_ttl_minutes()),
    )
    db.session.add(session)
    db.session.commit()

    api1 = egov.api1_url(base, session.secret)
    content = egov.qr_content(api1)
    png = generate_qr_png(content, box_size=7, border=2)
    return jsonify(
        session=session.to_public_dict(),
        qr_content=content,
        qr_png=f"data:image/png;base64,{base64.b64encode(png).decode('ascii')}",
        deep_links=egov.deep_links(api1),
        https=base.lower().startswith("https://"),
        ttl_minutes=egov.session_ttl_minutes(),
    ), 201


@bp.get("/signing/public/<string:token>/egov/session/<int:sid>")
def session_status(token: str, sid: int):
    sr = SigningRequest.query.filter_by(token=token).first()
    session = db.session.get(EgovSignSession, sid)
    if not sr or not session or session.signing_request_id != sr.id:
        return jsonify(error="Сессия не найдена"), 404
    return jsonify(session=session.to_public_dict(), request_status=sr.status)


# ─────────────────────────────────────────────────────────────────────────────
# Phone side
# ─────────────────────────────────────────────────────────────────────────────

def _session_by_secret(secret: str):
    return EgovSignSession.query.filter_by(secret=secret).first()


def _check_usable(session):
    """Error response when the session can no longer be used, else None."""
    if session is None or not egov.is_enabled():
        return _phone_error("invalid", 404)
    if session.status in ("signed", "cancelled", "failed"):
        return _phone_error("used", 410)
    if session.is_expired:
        if session.status in ("pending", "opened"):
            session.status = "expired"
            db.session.commit()
        return _phone_error("expired", 410)
    sr = session.signing_request
    if sr.status in ("signed", "revoked") or sr.is_expired:
        return _phone_error("used", 410)
    return None


def _check_bearer(session) -> bool:
    header = request.headers.get("Authorization", "")
    if not header.lower().startswith("bearer "):
        return False
    return hmac.compare_digest(header[7:].strip(), session.auth_token)


@bp.get("/egov/<string:secret>")
def api1(secret: str):
    """API №1 — scanned QR / opened link. Read-only apart from marking the session opened."""
    session = _session_by_secret(secret)
    err = _check_usable(session)
    if err:
        return err
    if session.status == "pending":
        session.status = "opened"
        session.opened_at = utc_now()
        db.session.commit()
    return jsonify(egov.build_api1(
        contract=session.signing_request.contract,
        settings=CollegeSettings.query.first(),
        session=session,
        api2=egov.api2_url(session.base_url, secret),
    ))


@bp.get("/egov/<string:secret>/documents")
def api2_get(secret: str):
    """API №2 (GET) — the PDF the signer will read and sign."""
    session = _session_by_secret(secret)
    err = _check_usable(session)
    if err:
        return err
    if not _check_bearer(session):
        return _phone_error("unauthorized", 401)
    sr = session.signing_request
    contract = sr.contract
    pdf = _pdf_bytes(contract)
    if pdf is None or hashlib.sha256(pdf).hexdigest() != session.payload_sha256:
        return _phone_error("doc_changed", 409)
    return jsonify(egov.build_documents(
        contract=contract, role_label=ROLE_LABELS.get(sr.signer_role, sr.signer_role), pdf_bytes=pdf,
    ))


def _fail(session, key: str, status: int, **fmt):
    """Remember WHY the phone's signature was refused so the signer's page can show it."""
    session.status = "failed"
    session.error = egov.message(key, "ru", **fmt)
    db.session.commit()
    return _phone_error(key, status, **fmt)


@bp.put("/egov/<string:secret>/documents")
def api2_put(secret: str):
    """API №2 (PUT) — the signed result. 200 «success» only if the signature is
    cryptographically valid, covers exactly OUR PDF and the role is still open;
    403 otherwise (the app shows our message to the signer)."""
    session = (
        EgovSignSession.query.filter_by(secret=secret).with_for_update().first()
    )
    err = _check_usable(session)
    if err:
        return err
    if not _check_bearer(session):
        return _phone_error("unauthorized", 401)

    sr = session.signing_request
    contract = sr.contract
    pdf = _pdf_bytes(contract)
    if pdf is None or hashlib.sha256(pdf).hexdigest() != session.payload_sha256:
        return _fail(session, "doc_changed", 409)

    body = get_json_safe()
    cms_b64 = egov.extract_signed(body, contract.id)
    if not cms_b64:
        return _phone_error("bad_request", 400)

    # The CMS must carry OUR bytes. This binds the signature to the document by
    # content for every algorithm (a GOST digest cannot be recomputed here) and
    # rejects a CMS made over something else, e.g. the base64 text.
    embedded = egov.embedded_content(cms_b64)
    if embedded is None or embedded != pdf:
        return _fail(session, "wrong_document", 403)

    try:
        parsed = verify_cms_signature(cms_b64, pdf)
    except SignatureError as exc:
        return _fail(session, "rejected", 403, reason=str(exc))

    try:
        record_public_signature(
            sr, contract, cms_b64, parsed, payload_format="pdf", channel="egov_mobile"
        )
    except SignConflict:
        return _fail(session, "already_signed", 409)

    session = db.session.get(EgovSignSession, session.id)
    session.status = "signed"
    session.signed_at = utc_now()
    session.signature_id = sr.signature_id
    try:
        db.session.commit()
    except (IntegrityError, OperationalError):
        db.session.rollback()
    return jsonify(message=egov.message("success", _lang())), 200
