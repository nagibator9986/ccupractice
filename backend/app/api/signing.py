"""Multi-party signing workflow.

Admin endpoints:
- POST /api/signing/contracts/<id>/invite          create one-time signing links
- GET  /api/signing/contracts/<id>/requests        list signing requests
- POST /api/signing/requests/<id>/revoke           revoke a pending signing link
- POST /api/signing/requests/<id>/resend           reissue a fresh token
- POST /api/signing/requests/<id>/extend           keep the same link, push its expiry
- POST /api/signing/bulk-invite                    links for many contracts at once
- POST /api/signing/links-export                   live links of many contracts as .xlsx

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

def _recipient_phone(contract: Contract, role: str) -> str:
    """Phone to reach a signer on WhatsApp/SMS. Derived from the registers, never
    stored on the request, so it can't drift from the student/partner card."""
    if role == "student":
        return (contract.student.phone if contract.student else "") or ""
    if role == "partner":
        return (contract.partner.phone if contract.partner else "") or ""
    settings = CollegeSettings.query.first()
    return (settings.phone if settings else "") or ""


def _request_payload(sr: SigningRequest, base: str) -> dict:
    data = sr.to_dict(include_token=True, public_base_url=base)
    data["recipient_phone"] = _recipient_phone(sr.contract, sr.signer_role)
    return data


def _issue_links(contract: Contract, roles: list, custom: dict, force: bool) -> list[SigningRequest]:
    """Create signing links for ``roles`` (idempotent without ``force``).

    Without force a role that is already signed or holds a live link is skipped,
    so a double click never produces two live tokens for one signer.
    """
    cid = contract.id
    defaults = _default_recipients(contract)

    # Pre-compute which roles already have a completed Signature so we can
    # refuse to issue a new invite for them (otherwise a single role could be
    # signed twice via two consecutive invites).
    signed_roles = {s.signer_role for s in contract.signatures or []}

    created = []
    for role in roles:
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
    return created


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

    created = _issue_links(
        contract, requested_roles, data.get("recipients") or {}, bool(data.get("force"))
    )
    db.session.commit()
    base = _public_base()
    return jsonify(items=[_request_payload(sr, base) for sr in created])


_BULK_INVITE_LIMIT = 500


@bp.post("/bulk-invite")
@admin_required
def bulk_invite():
    """Issue signing links for many contracts (default: partner + student).

    The college signs from its own session, so it is not part of the default
    set. Returns, per contract, every LIVE link for the requested roles (new
    ones flagged ``is_new``) so the SPA can show/copy/export them in one go.
    """
    data = get_json_safe()
    ids = [i for i in (data.get("contract_ids") or []) if isinstance(i, int)]
    roles = data.get("roles")
    if roles is None:
        roles = ["partner", "student"]
    if not ids or not isinstance(roles, list):
        return jsonify(error="Не выбраны договоры"), 400
    if len(ids) > _BULK_INVITE_LIMIT:
        return jsonify(error=f"За один раз можно отправить не более {_BULK_INVITE_LIMIT} договоров"), 400

    base = _public_base()
    results, new_links = [], 0
    contracts = {c.id: c for c in Contract.query.filter(Contract.id.in_(ids)).all()}
    for cid in ids:
        c = contracts.get(cid)
        if c is None:
            results.append({"contract_id": cid, "status": "skipped", "reason": "Договор не найден", "links": []})
            continue
        entry = {"contract_id": c.id, "number": c.number,
                 "student_name": c.student.full_name if c.student else "",
                 "group_name": c.student.group_name if c.student else "", "links": []}
        if not c.docx_path:
            entry.update(status="skipped", reason="Договор не сформирован")
            results.append(entry)
            continue
        created = _issue_links(c, roles, {}, False)
        db.session.flush()
        new_ids = {sr.id for sr in created}
        live = SigningRequest.query.filter(
            SigningRequest.contract_id == c.id,
            SigningRequest.signer_role.in_([r for r in roles if r in ALLOWED_ROLES]),
            SigningRequest.status.in_(("pending", "viewed")),
        ).order_by(SigningRequest.id.asc()).all()
        for sr in live:
            payload = _request_payload(sr, base)
            payload["is_new"] = sr.id in new_ids
            entry["links"].append(payload)
        new_links += len(created)
        signed = {s.signer_role for s in c.signatures}
        entry.update(
            status="ok" if entry["links"] else "skipped",
            reason=None if entry["links"] else (
                "Все выбранные стороны уже подписали" if set(roles) <= signed else "Нет активных ссылок"),
        )
        results.append(entry)
    db.session.commit()
    return jsonify(ok=True, new_links=new_links, items=results)


@bp.post("/links-export")
@admin_required
def links_export():
    """Live links of the given contracts as an .xlsx — one row per link, with a
    ready-to-paste message — for distribution through WhatsApp / e-mail."""
    from openpyxl import Workbook

    from ..services.xlsx_utils import table_sheet, workbook_response

    data = get_json_safe()
    ids = [i for i in (data.get("contract_ids") or []) if isinstance(i, int)]
    roles = [r for r in (data.get("roles") or list(ALLOWED_ROLES)) if r in ALLOWED_ROLES]
    if not ids:
        return jsonify(error="Не выбраны договоры"), 400
    base = _public_base()
    rows = []
    q = (
        SigningRequest.query.join(Contract)
        .filter(SigningRequest.contract_id.in_(ids), SigningRequest.signer_role.in_(roles),
                SigningRequest.status.in_(("pending", "viewed")))
        .order_by(Contract.number.asc(), SigningRequest.signer_role.asc())
    )
    for sr in q.all():
        c = sr.contract
        url = f"{base.rstrip('/')}/sign/{sr.token}"
        name = sr.recipient_name or ""
        message = (
            f"Здравствуйте, {name}! Просим подписать договор практики № {c.number} "
            f"(студент: {c.student.full_name}) электронной подписью (ЭЦП, NCALayer). "
            f"Ссылка: {url} Срок действия — до {sr.expires_at:%d.%m.%Y}."
            if sr.expires_at else
            f"Здравствуйте, {name}! Просим подписать договор практики № {c.number}: {url}"
        )
        rows.append([
            c.number, c.student.full_name, c.student.group_name or "", ROLE_LABELS.get(sr.signer_role, sr.signer_role),
            name, _recipient_phone(c, sr.signer_role), sr.recipient_email or "", url,
            sr.expires_at, "Просмотрено" if sr.status == "viewed" else "Ожидает подписи", message,
        ])
    if not rows:
        return jsonify(error="Нет активных ссылок для выбранных договоров. Сначала отправьте договоры на подпись."), 404
    wb = Workbook()
    ws = wb.active
    ws.title = "Ссылки на подписание"
    table_sheet(
        ws,
        ["№ договора", "Студент", "Группа", "Кто подписывает", "Получатель", "Телефон", "Email",
         "Ссылка на подписание", "Действует до", "Статус", "Текст сообщения"],
        rows, required=[True] * 11, text_columns=(6,),
    )
    for cell in ws["I"][1:]:
        cell.number_format = "DD.MM.YYYY"
    ws.column_dimensions["H"].width = 60
    ws.column_dimensions["K"].width = 70
    return workbook_response(wb, f"Ссылки_на_подписание_{utc_now():%Y-%m-%d}.xlsx")


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
    return jsonify(items=[_request_payload(r, base) for r in rows])


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
    return jsonify(ok=True, item=_request_payload(sr, _public_base()))


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
    return jsonify(item=_request_payload(sr, _public_base()))


@bp.post("/requests/<int:rid>/extend")
@admin_required
def extend(rid: int):
    """Push the expiry of a link that has ALREADY been sent, keeping its token —
    unlike ``resend`` this does not invalidate the URL the signer holds."""
    sr = SigningRequest.query.get_or_404(rid)
    if sr.status in ("signed", "revoked"):
        return jsonify(error="Ссылка уже использована или отозвана"), 409
    days = min(max(int(get_json_safe().get("days") or SigningRequest.DEFAULT_TTL_DAYS), 1), 180)
    sr.expires_at = utc_now() + timedelta(days=days)
    db.session.commit()
    return jsonify(item=_request_payload(sr, _public_base()))


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
            # Public contact line so an expired/revoked link says whom to call.
            "phone": settings.phone if settings else "",
            "email": settings.email if settings else "",
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
            # The raw recipient_iin_or_bin is intentionally NOT returned — public
            # token surfaces land in email/SMS history, Referer headers and
            # access logs. A masked form lets the signer confirm the link is
            # theirs without exposing the identifier.
            "recipient_iin_or_bin_masked": _mask_iin_public(sr.recipient_iin_or_bin),
            "status": sr.status,
            "expires_at": sr.expires_at.isoformat() if sr.expires_at else None,
        },
        contract=_public_contract_payload(contract),
        signing_state=summary,
        signing_methods=_signing_methods(contract),
        download={
            "docx": f"/api/signing/public/{token}/download/docx" if contract.docx_path else None,
            "pdf": f"/api/signing/public/{token}/download/pdf" if contract.pdf_path else None,
            "pdf_preview": f"/api/signing/public/{token}/download/pdf?inline=1" if contract.pdf_path else None,
        },
    )


def _signing_methods(contract: Contract) -> dict:
    """Which ways this signer may sign. eGov mobile needs the feature switched on
    (EGOV_SIGN_ENABLED — the college's domain must be registered with eGov first)
    and a PDF of the contract, because that is what the phone displays."""
    from ..services.egov_sign import is_enabled

    pdf_ok = bool(contract.pdf_path) and (
        Path(current_app.config["ARCHIVE_FOLDER"]) / contract.pdf_path
    ).is_file()
    enabled = is_enabled()
    return {
        "ncalayer": True,
        "egov_mobile": {
            "enabled": enabled,
            "available": enabled and pdf_ok,
            "reason": None if (not enabled or pdf_ok) else "pdf_missing",
        },
    }


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
    """DOCX / PDF of the contract for the link holder (``?inline=1`` = preview).

    The PDF carries the signature annex once anyone has signed, exactly like the
    college's own download, so a signer keeps a verifiable copy.
    """
    from .contracts import serve_contract_pdf

    sr = _get_request(token)
    if not sr or sr.is_expired or sr.status == "revoked":
        return jsonify(error="Ссылка недействительна"), 404
    contract = sr.contract
    inline = (request.args.get("inline") or "").lower() in ("1", "true", "yes")
    archive = Path(current_app.config["ARCHIVE_FOLDER"])
    if fmt == "docx" and contract.docx_path and (archive / contract.docx_path).is_file():
        return send_from_directory(archive, contract.docx_path, as_attachment=True)
    if fmt == "pdf" and contract.pdf_path and (archive / contract.pdf_path).is_file():
        return serve_contract_pdf(contract, inline=inline, public_base=_public_base())
    return jsonify(error="Файл не найден"), 404


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

    try:
        result = record_public_signature(sr, contract, cms_b64, parsed)
    except SignConflict:
        return jsonify(error="Эта роль уже подписана другим запросом"), 409

    return jsonify(
        ok=True,
        signature=result.signature.to_dict(),
        warnings=result.warnings,
        signing_state={
            "your_status": "signed",
            "all_signed": result.all_signed,
        },
    )


class SignConflict(Exception):
    """Another request signed this role first (unique constraint / DB lock)."""


class SignRecord:
    def __init__(self, signature, all_signed: bool, warnings: list[str]):
        self.signature = signature
        self.all_signed = all_signed
        self.warnings = warnings


def record_public_signature(
    sr: SigningRequest,
    contract: Contract,
    cms_b64: str,
    parsed,
    *,
    payload_format: str = "docx",
    channel: str = "ncalayer",
) -> SignRecord:
    """Persist a VERIFIED signature and advance the signing request / contract.

    Shared by the NCALayer submit and the eGov mobile PUT so both channels go
    through exactly the same bookkeeping. Raises ``SignConflict`` when the role
    was signed concurrently (the caller turns it into a 409).
    """
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
        payload_format=payload_format,
        channel=channel,
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
        raise SignConflict()

    sr.status = "signed"
    sr.signed_at = utc_now()
    sr.signature_id = sig.id
    # The signer keeps the link to download their signed copy. Without this a
    # party who signs near the deadline would find the link "expired" the next day.
    sr.expires_at = max(sr.expires_at or utc_now(), utc_now() + timedelta(days=SigningRequest.DEFAULT_TTL_DAYS))

    try:
        db.session.commit()
    except (IntegrityError, OperationalError):
        db.session.rollback()
        raise SignConflict()

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

    warnings = list(parsed.warnings) + (
        [f"ИИН/БИН подписанта ({actual}) не совпал с ожидаемым ({expected})"]
        if identity_mismatch else []
    )
    return SignRecord(sig, all_signed, warnings)


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
