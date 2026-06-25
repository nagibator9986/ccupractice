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
from datetime import timedelta
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from sqlalchemy.exc import IntegrityError, OperationalError

from ..extensions import db
from ..models import (
    CollegeSettings,
    Contract,
    ContractStatus,
    Signature,
    SigningRequest,
)
from ..services.signature_service import SignatureError, payload_sha256
from ..services.signature_verification import verify_cms_signature
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

        active = SigningRequest.query.filter_by(contract_id=cid, signer_role=role).filter(
            SigningRequest.status.in_(("pending", "viewed"))
        ).first()

        # Without force: never re-issue for a role that is already signed or that
        # has a live (pending/viewed) link.
        if not force and (role in signed_roles or active):
            continue

        if force:
            # Force re-sign: revoke EVERY prior non-revoked link for this role —
            # pending, viewed AND signed — so no stale token keeps leaking the
            # document, and no duplicate same-role row makes the public
            # signing_state non-deterministic. Then drop the existing Signature
            # so the fresh submit can insert without colliding with the
            # (contract_id, signer_role) unique constraint.
            SigningRequest.query.filter_by(contract_id=cid, signer_role=role).filter(
                SigningRequest.status.in_(("pending", "viewed", "signed"))
            ).update(
                {"status": "revoked", "revoked_at": utc_now(), "signature_id": None},
                synchronize_session=False,
            )
            old_sig = Signature.query.filter_by(contract_id=cid, signer_role=role).first()
            if old_sig:
                db.session.delete(old_sig)
                if contract.status == ContractStatus.SIGNED:
                    contract.status = ContractStatus.SENT

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
    # Reset expiration so the resent link has a full TTL window (single source
    # of truth: SigningRequest.DEFAULT_TTL_DAYS).
    sr.expires_at = utc_now() + timedelta(days=SigningRequest.DEFAULT_TTL_DAYS)
    db.session.commit()
    return jsonify(item=sr.to_dict(include_token=True, public_base_url=_public_base()))


# ────────────────────────────────────────────────────────────────
# Public (token-based)
# ────────────────────────────────────────────────────────────────

def _get_request(token: str) -> SigningRequest | None:
    return SigningRequest.query.filter_by(token=token).first()


def _mask_iin_public(value: str | None) -> str:
    """Mask middle digits of an IIN/BIN — public token surfaces hide the full
    identifier (the QR + signer cert already carry the real value where needed).
    Mirrors the helper in lms_contracts.py / enrollment.py."""
    if not value:
        return ""
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    if len(digits) < 8:
        return digits
    return f"{digits[:6]}****{digits[-2:]}"


def _public_contract_payload(contract: Contract) -> dict:
    """Token-public payload. The student IIN and partner BIN are masked here
    because the public token surface lands in email/SMS history, browser
    Referer headers, and access logs — anyone with the link otherwise gets a
    raw national identifier in cleartext. The signer can still see their own
    identity through the cert returned by NCALayer."""
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
            "bin_masked": _mask_iin_public(partner.bin) if partner else "",
            "director_full_name": partner.director_full_name if partner else "",
            "director_position": partner.director_position if partner else "",
            "legal_address": partner.legal_address if partner else "",
        },
        "student": {
            "full_name": student.full_name if student else "",
            "iin_masked": _mask_iin_public(student.iin) if student else "",
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
    # NB: this GET is read-only on purpose. The pending->viewed transition is an
    # explicit POST (/public/<token>/view) so that link-preview bots, URL
    # scanners and browser prefetch can't silently corrupt the audit timeline,
    # and the handler stays safe/idempotent (and not CSRF-triggerable via <img>).

    # Build a DETERMINISTIC per-role summary. After a revoke->re-invite or a
    # `force` re-invite there are legitimately several SigningRequest rows for
    # one role (an old `revoked` row plus a fresh live one), so a plain
    # dict-comprehension keyed by role would let whichever row the DB happened
    # to return last win — on Postgres a SELECT without ORDER BY has no defined
    # order, so the stale `revoked` row could clobber the live `signed`/`pending`
    # row and the signer would see the wrong status (e.g. an already-signed
    # party shown the "Подписать ЭЦП" button). Order oldest->newest and prefer
    # the live row: a `revoked` row only sets a role if no other row for that
    # role has been seen yet, so any non-revoked row always wins.
    all_requests = (
        SigningRequest.query.filter_by(contract_id=contract.id)
        .order_by(SigningRequest.created_at.asc(), SigningRequest.id.asc())
        .all()
    )
    summary: dict = {}
    for r in all_requests:
        existing = summary.get(r.signer_role)
        # Keep the first non-revoked row we encounter for a role; never let a
        # later/revoked row overwrite an already-chosen live row.
        if existing is not None and existing["status"] != "revoked":
            continue
        summary[r.signer_role] = {
            "status": r.status,
            "signed_at": r.signed_at.isoformat() if r.signed_at else None,
            "recipient_name": r.recipient_name,
        }

    return jsonify(
        request={
            "id": sr.id,
            "signer_role": sr.signer_role,
            "signer_role_label": ROLE_LABELS[sr.signer_role],
            "recipient_name": sr.recipient_name,
            # recipient_iin_or_bin intentionally NOT returned — public token
            # surfaces land in email/SMS history, Referer headers and access
            # logs; the enrollment + LMS public flows already withhold it.
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


@bp.post("/public/<string:token>/view")
def public_mark_viewed(token: str):
    """Explicit, non-idempotent pending->viewed transition (called by the SPA
    after a human opens the signing page). Kept out of the GET handler so the
    audit timeline can't be corrupted by prefetch / bots / URL scanners."""
    sr = _get_request(token)
    if not sr:
        return jsonify(error="Ссылка недействительна"), 404
    if sr.is_expired:
        return jsonify(error="Срок ссылки истёк", code="expired"), 410
    if sr.status == "revoked":
        return jsonify(error="Ссылка отозвана", code="revoked"), 410
    if sr.status == "pending":
        sr.status = "viewed"
        sr.viewed_at = utc_now()
        db.session.commit()
    return jsonify(ok=True, status=sr.status)


@bp.get("/public/<string:token>/payload")
def public_payload(token: str):
    sr = _get_request(token)
    if not sr:
        return jsonify(error="Ссылка недействительна"), 404
    if sr.is_expired:
        return jsonify(error="Срок ссылки истёк", code="expired"), 410
    if sr.status == "revoked":
        return jsonify(error="Ссылка отозвана", code="revoked"), 410
    if sr.status == "signed":
        return jsonify(error="Документ уже подписан", code="signed"), 409
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
    # Re-fetch the request. On Postgres SELECT ... FOR UPDATE row-locks it so
    # two parallel POSTs to the same token serialise; on SQLite FOR UPDATE is a
    # silent no-op, so the real "one signature per role" guarantee comes from
    # the (contract_id, signer_role) UNIQUE constraint, whose IntegrityError we
    # catch below and turn into a 409.
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
        parsed = verify_cms_signature(cms_b64, payload_bytes)
    except SignatureError as exc:
        return jsonify(error=str(exc)), 400

    # Soft IIN/BIN match: warn (and log) if signer identity doesn't match the
    # expected recipient. We don't reject. Skip the college role entirely — the
    # director signs with their personal IIN, but the college recipient is
    # seeded with the college BIN, so a mismatch there is expected and carries
    # no signal (it would otherwise warn on every legitimate college signature).
    expected = _normalize_iin(sr.recipient_iin_or_bin)
    actual = _normalize_iin(parsed.signer_iin_or_bin)
    identity_mismatch = bool(
        expected and actual and expected != actual and sr.signer_role != "college"
    )
    if identity_mismatch:
        # Mask PII in logs (KZ Закон 152-V "О персональных данных"): retain only
        # the last 4 digits so a mismatch can still be triaged without writing
        # full national IDs into log aggregators / Railway logs panel.
        current_app.logger.warning(
            "Signature ID mismatch on contract %s role=%s: expected=*****%s signer=*****%s",
            contract.id, sr.signer_role, expected[-4:], actual[-4:],
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
        verification_level=parsed.verification_level,
    )
    db.session.add(sig)
    try:
        db.session.flush()
    except (IntegrityError, OperationalError):
        # IntegrityError: collides with the (contract_id, signer_role) unique
        # constraint — another request signed this role between our checks and
        # the insert. OperationalError: transient SQLite "database is locked"
        # under concurrent writers. Both are safely retryable for the caller.
        db.session.rollback()
        return jsonify(error="Эта роль уже подписана другим запросом"), 409

    sr.status = "signed"
    sr.signed_at = utc_now()
    sr.signature_id = sig.id

    try:
        db.session.commit()
    except (IntegrityError, OperationalError):
        db.session.rollback()
        return jsonify(error="Эта роль уже подписана другим запросом"), 409

    # Auto-update contract status once all three roles are signed. Recompute from
    # the COMMITTED Signature rows in a fresh read AFTER the commit above: under
    # READ COMMITTED two simultaneous final submits for different roles would
    # each see only their own (still-uncommitted) signature plus the
    # already-committed ones — so each sees 2 of 3 and neither flips the status,
    # leaving a fully-signed contract stuck at SENT. Computing after commit means
    # whichever request commits last observes all rows and flips it (idempotent).
    # Counting from the Signature table (the unique-constrained source of truth)
    # also covers the mixed admin-attach + public-submit workflow.
    signed_roles = {
        s.signer_role
        for s in Signature.query.filter_by(contract_id=contract.id).all()
    }
    all_signed = {"college", "partner", "student"}.issubset(signed_roles)
    if all_signed and contract.status != ContractStatus.SIGNED:
        contract.status = ContractStatus.SIGNED
        try:
            db.session.commit()
        except (IntegrityError, OperationalError):
            db.session.rollback()

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
