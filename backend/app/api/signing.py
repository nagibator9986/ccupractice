"""Multi-party signing workflow.

Admin endpoints:
- POST /api/signing/contracts/<id>/invite          create one-time signing links
- GET  /api/signing/contracts/<id>/requests        list signing requests
- POST /api/signing/requests/<id>/revoke           revoke a pending signing link
- POST /api/signing/requests/<id>/resend           reissue a fresh token

Public endpoints (token-based, no JWT required):
- GET  /api/signing/public/<token>                 contract preview + payload metadata
- GET  /api/signing/public/<token>/payload         return base64 DOCX bytes for NCALayer
- POST /api/signing/public/<token>/submit          submit CMS signature
- GET  /api/signing/public/<token>/download/<fmt>  download the contract DOCX/PDF
"""
from __future__ import annotations

import base64
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from sqlalchemy.exc import IntegrityError

from ..extensions import db
from ..models import (
    CollegeSettings,
    Contract,
    ContractStatus,
    Signature,
    SigningRequest,
)
from ..services.signature_service import (
    SignatureError,
    parse_cms_signature,
    payload_sha256,
)
from ..utils.auth import admin_required
from ..utils.serializers import get_json_safe
from ..utils.time import utc_now

bp = Blueprint("signing", __name__)


def _public_base() -> str:
    return request.headers.get("X-Public-Origin") or request.host_url.rstrip("/")


ROLE_LABELS = {
    "college": "Колледж (организация образования)",
    "partner": "Предприятие",
    "student": "Обучающийся",
}
ALLOWED_ROLES = ("college", "partner", "student")


def _normalize_iin(value: str | None) -> str:
    """Strip IIN/BIN prefix + non-digits so we can compare two raw forms."""
    if not value:
        return ""
    s = str(value).replace("IIN", "").replace("BIN", "").strip()
    return "".join(ch for ch in s if ch.isdigit())


# ────────────────────────────────────────────────────────────────
# Admin: invite / list / revoke / resend
# ────────────────────────────────────────────────────────────────

@bp.post("/contracts/<int:cid>/invite")
@admin_required
def invite(cid: int):
    contract = Contract.query.get_or_404(cid)
    if not contract.docx_path:
        return jsonify(error="Сначала сформируйте договор"), 400

    data = get_json_safe()
    # Use `is None` semantics so an explicit empty list doesn't fall back to all roles.
    requested_roles = data.get("roles")
    if requested_roles is None:
        requested_roles = list(ALLOWED_ROLES)
    elif not isinstance(requested_roles, list):
        return jsonify(error="Поле roles должно быть массивом"), 400

    custom: dict = data.get("recipients") or {}
    force = bool(data.get("force"))

    defaults = _default_recipients(contract)

    # Pre-compute which roles already have a completed Signature so we can
    # refuse to issue a new invite for them (otherwise a single role could be
    # signed twice via two consecutive invites).
    signed_roles = {
        s.signer_role for s in contract.signatures or []
    }

    created = []
    for role in requested_roles:
        if role not in ALLOWED_ROLES:
            continue
        if role in signed_roles and not force:
            continue

        active = SigningRequest.query.filter_by(contract_id=cid, signer_role=role).filter(
            SigningRequest.status.in_(("pending", "viewed"))
        ).first()
        if active:
            if not force:
                continue
            # Revoke the previous link so the old token can't be used after we
            # issue a fresh one.
            active.status = "revoked"
            active.revoked_at = utc_now()

        recipient = {**defaults.get(role, {}), **(custom.get(role) or {})}
        sr = SigningRequest.create_for(cid, role, recipient)
        db.session.add(sr)
        created.append(sr)

    if contract.status == ContractStatus.GENERATED and created:
        contract.status = ContractStatus.SENT

    db.session.commit()
    base = _public_base()
    return jsonify(items=[sr.to_dict(include_token=True, public_base_url=base) for sr in created])


@bp.get("/contracts/<int:cid>/requests")
@admin_required
def list_requests(cid: int):
    Contract.query.get_or_404(cid)
    rows = (
        SigningRequest.query.filter_by(contract_id=cid)
        .order_by(SigningRequest.created_at.desc())
        .all()
    )
    base = _public_base()
    return jsonify(items=[r.to_dict(include_token=True, public_base_url=base) for r in rows])


@bp.post("/requests/<int:rid>/revoke")
@admin_required
def revoke(rid: int):
    sr = SigningRequest.query.get_or_404(rid)
    if sr.status == "signed":
        return jsonify(error="Подписанный запрос отозвать нельзя"), 409
    if sr.status == "revoked":
        return jsonify(error="Ссылка уже отозвана"), 409
    sr.status = "revoked"
    sr.revoked_at = utc_now()
    db.session.commit()
    return jsonify(ok=True, item=sr.to_dict(include_token=True, public_base_url=_public_base()))


@bp.post("/requests/<int:rid>/resend")
@admin_required
def resend(rid: int):
    sr = SigningRequest.query.get_or_404(rid)
    if sr.status == "signed":
        return jsonify(error="Запрос уже подписан"), 409
    sr.token = SigningRequest.generate_token()
    sr.status = "pending"
    sr.viewed_at = None
    sr.revoked_at = None
    # Reset expiration so the resent link has a full TTL window.
    from datetime import timedelta
    sr.expires_at = utc_now() + timedelta(days=30)
    db.session.commit()
    return jsonify(item=sr.to_dict(include_token=True, public_base_url=_public_base()))


# ────────────────────────────────────────────────────────────────
# Public (token-based)
# ────────────────────────────────────────────────────────────────

def _get_request(token: str) -> SigningRequest | None:
    return SigningRequest.query.filter_by(token=token).first()


def _public_contract_payload(contract: Contract) -> dict:
    settings = CollegeSettings.query.first()
    partner = contract.partner
    student = contract.student
    return {
        "number": contract.number,
        "date": contract.contract_date.isoformat() if contract.contract_date else None,
        "year": contract.year,
        "status": contract.status,
        "college": {
            "name_ru": settings.name_ru if settings else "",
            "city": settings.city if settings else "",
            "director_full_name": settings.director_full_name if settings else "",
        },
        "partner": {
            "name": partner.organization_name if partner else "",
            "bin": partner.bin if partner else "",
            "director_full_name": partner.director_full_name if partner else "",
            "director_position": partner.director_position if partner else "",
            "legal_address": partner.legal_address if partner else "",
        },
        "student": {
            "full_name": student.full_name if student else "",
            "iin": student.iin if student else "",
            "group_name": student.group_name if student else "",
            "specialty": student.specialty if student else "",
            "practice_start": student.practice_start.isoformat() if student and student.practice_start else None,
            "practice_end": student.practice_end.isoformat() if student and student.practice_end else None,
        },
    }


@bp.get("/public/<string:token>")
def public_view(token: str):
    sr = _get_request(token)
    if not sr:
        return jsonify(error="Ссылка недействительна"), 404
    if sr.is_expired:
        return jsonify(error="Срок ссылки истёк", code="expired"), 410
    if sr.status == "revoked":
        return jsonify(error="Ссылка отозвана", code="revoked"), 410

    contract = sr.contract
    if sr.status == "pending":
        sr.status = "viewed"
        sr.viewed_at = utc_now()
        db.session.commit()

    all_requests = SigningRequest.query.filter_by(contract_id=contract.id).all()
    summary = {
        r.signer_role: {
            "status": r.status,
            "signed_at": r.signed_at.isoformat() if r.signed_at else None,
            "recipient_name": r.recipient_name,
        }
        for r in all_requests
    }

    return jsonify(
        request={
            "id": sr.id,
            "signer_role": sr.signer_role,
            "signer_role_label": ROLE_LABELS[sr.signer_role],
            "recipient_name": sr.recipient_name,
            "recipient_iin_or_bin": sr.recipient_iin_or_bin,
            "status": sr.status,
            "expires_at": sr.expires_at.isoformat() if sr.expires_at else None,
        },
        contract=_public_contract_payload(contract),
        signing_state=summary,
        download={
            "docx": f"/api/signing/public/{token}/download/docx" if contract.docx_path else None,
            "pdf": f"/api/signing/public/{token}/download/pdf" if contract.pdf_path else None,
        },
    )


@bp.get("/public/<string:token>/payload")
def public_payload(token: str):
    sr = _get_request(token)
    if not sr or sr.is_expired or sr.status in ("revoked", "signed"):
        return jsonify(error="Ссылка недействительна"), 404
    contract = sr.contract
    if not contract.docx_path:
        return jsonify(error="Файл договора отсутствует"), 404
    payload_path = Path(current_app.config["ARCHIVE_FOLDER"]) / contract.docx_path
    if not payload_path.is_file():
        current_app.logger.error("Contract file missing on disk: %s", payload_path)
        return jsonify(error="Файл договора недоступен на сервере"), 500
    data = payload_path.read_bytes()
    return jsonify(
        sha256=payload_sha256(data),
        payload_base64=base64.b64encode(data).decode("ascii"),
        size=len(data),
        filename=Path(contract.docx_path).name,
    )


@bp.get("/public/<string:token>/download/<string:fmt>")
def public_download(token: str, fmt: str):
    sr = _get_request(token)
    if not sr or sr.is_expired or sr.status == "revoked":
        return jsonify(error="Ссылка недействительна"), 404
    contract = sr.contract
    rel = None
    if fmt == "docx":
        rel = contract.docx_path
    elif fmt == "pdf":
        rel = contract.pdf_path
    if not rel:
        return jsonify(error="Файл не найден"), 404
    return send_from_directory(current_app.config["ARCHIVE_FOLDER"], rel, as_attachment=True)


@bp.post("/public/<string:token>/submit")
def public_submit(token: str):
    # Re-fetch with SELECT FOR UPDATE so two parallel POSTs to the same token
    # serialise — only one signature gets persisted, the other 409s.
    sr = (
        SigningRequest.query.filter_by(token=token)
        .with_for_update()
        .first()
    )
    if not sr:
        return jsonify(error="Ссылка недействительна"), 404
    if sr.is_expired:
        return jsonify(error="Срок ссылки истёк", code="expired"), 410
    if sr.status == "revoked":
        return jsonify(error="Ссылка отозвана", code="revoked"), 410
    if sr.status == "signed":
        return jsonify(error="Документ уже подписан по этой ссылке"), 409

    data = get_json_safe()
    cms_b64 = (data.get("cms") or "").strip()
    if not cms_b64:
        return jsonify(error="Подпись не передана"), 400

    contract = sr.contract
    if not contract.docx_path:
        return jsonify(error="Файл договора отсутствует"), 404
    payload_path = Path(current_app.config["ARCHIVE_FOLDER"]) / contract.docx_path
    if not payload_path.is_file():
        current_app.logger.error("Contract file missing on disk: %s", payload_path)
        return jsonify(error="Файл договора недоступен на сервере"), 500
    payload_bytes = payload_path.read_bytes()

    try:
        parsed = parse_cms_signature(cms_b64, payload_bytes)
    except SignatureError as exc:
        return jsonify(error=str(exc)), 400

    # Soft IIN/BIN match: warn (and log) if signer identity doesn't match the
    # expected recipient. We don't reject — for the college role the director
    # signs with their personal IIN which can't match the BIN of the college.
    expected = _normalize_iin(sr.recipient_iin_or_bin)
    actual = _normalize_iin(parsed.signer_iin_or_bin)
    identity_mismatch = bool(expected and actual and expected != actual)
    if identity_mismatch:
        current_app.logger.warning(
            "Signature ID mismatch on contract %s role=%s: expected=%s signer=%s",
            contract.id, sr.signer_role, expected, actual,
        )

    sig = Signature(
        contract_id=contract.id,
        signer_role=sr.signer_role,
        signer_full_name=parsed.signer_full_name,
        signer_iin_or_bin=parsed.signer_iin_or_bin,
        signer_serial=parsed.signer_serial,
        signer_certificate_pem=parsed.certificate_pem,
        cms_signature=cms_b64,
        signed_payload_sha256=parsed.payload_sha256,
    )
    db.session.add(sig)
    try:
        db.session.flush()
    except IntegrityError:
        # Collides with the (contract_id, signer_role) unique constraint —
        # another request signed this role between our checks and the insert.
        db.session.rollback()
        return jsonify(error="Эта роль уже подписана другим запросом"), 409

    sr.status = "signed"
    sr.signed_at = utc_now()
    sr.signature_id = sig.id

    # Auto-update contract status when all three roles signed
    roles_signed = {
        r.signer_role
        for r in SigningRequest.query.filter_by(contract_id=contract.id, status="signed").all()
    } | {sr.signer_role}
    all_signed = {"college", "partner", "student"}.issubset(roles_signed)
    if all_signed:
        contract.status = ContractStatus.SIGNED

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(error="Эта роль уже подписана другим запросом"), 409
    return jsonify(
        ok=True,
        signature=sig.to_dict(),
        warnings=parsed.warnings + (
            [f"ИИН/БИН подписанта ({actual}) не совпал с ожидаемым ({expected})"]
            if identity_mismatch else []
        ),
        signing_state={
            "your_status": "signed",
            "all_signed": all_signed,
        },
    )


def _default_recipients(contract: Contract) -> dict:
    settings = CollegeSettings.query.first()
    partner = contract.partner
    student = contract.student
    return {
        "college": {
            "name": (settings.director_full_name if settings else "") or "Директор",
            "email": (settings.email if settings else "") or "",
            "iin_or_bin": (settings.bin if settings else "") or "",
        },
        "partner": {
            "name": (partner.director_full_name if partner else "") or (partner.organization_name if partner else ""),
            "email": (partner.email if partner else "") or "",
            "iin_or_bin": (partner.bin if partner else "") or "",
        },
        "student": {
            "name": student.full_name if student else "",
            "email": "",
            "iin_or_bin": (student.iin if student else "") or "",
        },
    }
