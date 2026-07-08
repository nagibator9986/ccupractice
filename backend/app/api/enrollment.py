"""Enrollment (educational-services) contracts: CRUD, generation and the
age-aware, token-based ЭЦП signing of two documents (contract + consent).

Public (token) endpoints require no JWT — they are the applicant/parent signing
flow. Each signing link belongs to ONE party (student/parent) and lets that
party sign every document assigned to them by the age matrix.
"""
from __future__ import annotations

import base64
import re
from datetime import timedelta
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from flask_jwt_extended import jwt_required
from sqlalchemy.exc import IntegrityError, OperationalError

from ..extensions import db
from ..models import (
    CollegeSettings,
    EnrollmentContract,
    EnrollmentSignature,
    EnrollmentSigningRequest,
    EnrollmentStatus,
    DOCUMENTS,
    DOCUMENT_LABELS,
    PARTY_LABELS,
    PARTY_PARENT,
    PARTY_COLLEGE,
)
from ..services.enrollment_documents import generate_enrollment_files
from ..services.signature_service import SignatureError, payload_sha256
from ..services.signature_verification import verify_cms_signature
from ..utils.auth import admin_required
from ..utils.serializers import clean_str, get_json_safe, parse_date, parse_int
from ..utils.time import utc_now, utc_today

bp = Blueprint("enrollment", __name__)

ENROLLMENT_PREFIX = "ОУ"  # «Образовательные услуги»

_TEXT_FIELDS = {
    "applicant_full_name": 200, "applicant_iin": 20, "applicant_gender": 10,
    "applicant_id_doc_type": 60, "applicant_id_doc_number": 60, "applicant_id_doc_issued_by": 200,
    "applicant_address_city": 120, "applicant_address_district": 120,
    "applicant_address_street": 200, "applicant_address_house": 60,
    "applicant_phone": 60, "applicant_home_phone": 60, "applicant_email": 160,
    "parent_full_name": 200, "parent_relation": 60, "parent_iin": 20,
    "parent_id_doc_number": 60, "parent_id_doc_issued_by": 200, "parent_address": 400,
    "parent_phone": 60, "parent_email": 160,
    "specialty": 200, "specialty_code": 60, "qualification": 200,
    "education_base": 10, "study_form": 60, "number": 60,
}
_DATE_FIELDS = ("contract_date", "applicant_birth_date", "applicant_id_doc_issued_date")
_INT_FIELDS = ("course", "tuition_year_amount")


def _public_base() -> str:
    return request.headers.get("X-Public-Origin") or request.host_url.rstrip("/")


_NUM_SEQ_RE = re.compile(r"-(\d+)\s*$")


def suggest_number(year: int) -> str:
    # Max existing sequence + 1 (not count+1) so deletions don't make the
    # suggestion collide with a kept number. Numbers are manual/editable, so this
    # is only a convenience default — the admin can always override it.
    max_seq = 0
    for (num,) in EnrollmentContract.query.with_entities(EnrollmentContract.number).filter_by(year=year):
        if num:
            m = _NUM_SEQ_RE.search(num)
            if m:
                max_seq = max(max_seq, int(m.group(1)))
    return f"{ENROLLMENT_PREFIX}-{year}-{max_seq + 1:03d}"


def _normalize_iin(value) -> str:
    """Strip IIN/BIN prefix + non-digits so two raw forms can be compared."""
    if not value:
        return ""
    s = str(value).replace("IIN", "").replace("BIN", "").strip()
    return "".join(ch for ch in s if ch.isdigit())


def _apply(e: EnrollmentContract, data: dict) -> None:
    for field, max_len in _TEXT_FIELDS.items():
        if field in data:
            setattr(e, field, clean_str(data.get(field), max_len=max_len))
    for field in _DATE_FIELDS:
        if field in data:
            setattr(e, field, parse_date(data.get(field)))
    for field in _INT_FIELDS:
        if field in data:
            setattr(e, field, parse_int(data.get(field)))
    if "notes" in data:
        e.notes = clean_str(data.get("notes"))
    # Keep the year in sync with the (manual) contract date.
    if e.contract_date:
        e.year = e.contract_date.year


# ─────────────────────────────────────────────────────────────────────────────
# Admin: CRUD
# ─────────────────────────────────────────────────────────────────────────────

@bp.get("")
@jwt_required()
def list_enrollments():
    q = (request.args.get("q") or "").strip()
    status = (request.args.get("status") or "").strip()
    year = request.args.get("year")
    query = EnrollmentContract.query
    if q:
        like = f"%{q}%"
        query = query.filter(
            db.or_(
                EnrollmentContract.number.ilike(like),
                EnrollmentContract.applicant_full_name.ilike(like),
                EnrollmentContract.applicant_iin.ilike(like),
                EnrollmentContract.specialty.ilike(like),
            )
        )
    if status:
        query = query.filter(EnrollmentContract.status == status)
    if year:
        try:
            query = query.filter(EnrollmentContract.year == int(year))
        except (TypeError, ValueError):
            return jsonify(error="Параметр «year» должен быть числом"), 400
    items = query.order_by(EnrollmentContract.created_at.desc()).all()
    return jsonify(items=[e.to_dict() for e in items], total=len(items))


@bp.get("/suggest-number")
@jwt_required()
def suggest():
    year = parse_int(request.args.get("year")) or utc_today().year
    return jsonify(number=suggest_number(year), year=year)


@bp.get("/<int:eid>")
@jwt_required()
def get_enrollment(eid):
    e = EnrollmentContract.query.get_or_404(eid)
    return jsonify(item=e.to_dict(include_relations=True))


@bp.post("")
@admin_required
def create_enrollment():
    data = get_json_safe()
    full_name = clean_str(data.get("applicant_full_name"), max_len=200)
    if not full_name:
        return jsonify(error="Укажите ФИО абитуриента"), 400

    e = EnrollmentContract(applicant_full_name=full_name, status=EnrollmentStatus.DRAFT)
    _apply(e, {k: v for k, v in data.items() if k != "applicant_full_name"})

    if not e.contract_date:
        e.contract_date = utc_today()
        e.year = e.contract_date.year
    if not e.number:
        e.number = suggest_number(e.year or e.contract_date.year)

    if e.applicant_birth_date and e.contract_date and e.applicant_birth_date > e.contract_date:
        return jsonify(error="Дата рождения не может быть позже даты договора"), 400

    db.session.add(e)
    db.session.commit()
    return jsonify(item=e.to_dict(include_relations=True)), 201


@bp.put("/<int:eid>")
@admin_required
def update_enrollment(eid):
    e = EnrollmentContract.query.get_or_404(eid)
    data = get_json_safe()
    if "applicant_full_name" in data:
        name = clean_str(data.get("applicant_full_name"), max_len=200)
        if not name:
            return jsonify(error="ФИО абитуриента не может быть пустым"), 400

    # The legal signer (and thus the whole signing matrix / is_fully_signed) is
    # derived live from applicant_birth_date and contract_date. Once parties have
    # signed or are signing, mutating these silently invalidates already-collected
    # signatures and can lock signers out. Block such edits — re-generate (force)
    # to reset signatures first, mirroring the /generate guard.
    matrix_fields = ("applicant_birth_date", "contract_date")
    changes_matrix_field = any(
        f in data and parse_date(data.get(f)) != getattr(e, f) for f in matrix_fields
    )
    if changes_matrix_field:
        has_active = bool(e.signatures) or (
            EnrollmentSigningRequest.query.filter_by(enrollment_id=eid)
            .filter(EnrollmentSigningRequest.status.in_(("pending", "viewed", "signed")))
            .first()
            is not None
        )
        if has_active:
            return jsonify(
                error="Дата рождения и дата договора определяют подписанта и не могут "
                "быть изменены, пока есть активные ссылки на подпись или подписи. "
                "Перевыпустите документы (с подтверждением сброса подписей), затем измените дату.",
                code="locked_by_signatures",
            ), 409

    if "status" in data:
        new_status = data["status"]
        if new_status not in EnrollmentStatus.ALL:
            return jsonify(error=f"Неизвестный статус: {new_status}"), 400
        current = e.status
        if new_status != current:
            # SIGNED is owned by the signing flow — never a manual target.
            if new_status == EnrollmentStatus.SIGNED:
                return jsonify(error="Статус «Подписан» выставляется автоматически при подписании"), 409
            # Don't let a signed/completed contract be demoted to an earlier stage
            # while real signatures still exist — that desyncs status from the
            # collected signatures. Reset via /generate (force) instead.
            demote = {EnrollmentStatus.DRAFT, EnrollmentStatus.GENERATED, EnrollmentStatus.SENT}
            if current in (EnrollmentStatus.SIGNED, EnrollmentStatus.COMPLETED) and new_status in demote and e.signatures:
                return jsonify(
                    error="Нельзя понизить статус подписанного договора, пока есть подписи. "
                    "Перевыпустите документы (со сбросом подписей).",
                    code="locked_by_signatures",
                ), 409
            e.status = new_status
    _apply(e, data)
    if e.applicant_birth_date and e.contract_date and e.applicant_birth_date > e.contract_date:
        return jsonify(error="Дата рождения не может быть позже даты договора"), 400
    db.session.commit()
    return jsonify(item=e.to_dict(include_relations=True))


@bp.post("/<int:eid>/generate")
@admin_required
def generate(eid):
    e = EnrollmentContract.query.get_or_404(eid)
    data = get_json_safe()
    force = bool(data.get("force"))

    has_sigs = bool(e.signatures)
    active_reqs = (
        EnrollmentSigningRequest.query.filter_by(enrollment_id=eid)
        .filter(EnrollmentSigningRequest.status.in_(("pending", "viewed", "signed")))
        .all()
    )
    if (has_sigs or active_reqs) and not force:
        return jsonify(
            error="Документы уже подписываются или подписаны — перегенерация сделает "
            "существующие подписи недействительными. Повторите с подтверждением, чтобы сбросить.",
            code="has_signatures",
        ), 409
    if force and (has_sigs or active_reqs):
        for s in list(e.signatures):
            db.session.delete(s)
        for r in active_reqs:
            r.status = "revoked"
            r.revoked_at = utc_now()
        # Reset to DRAFT regardless of prior state (incl. COMPLETED) — a forced
        # regeneration wipes signatures, so the contract must not keep a
        # signed/completed status with zero signatures. /generate re-promotes it
        # to GENERATED below.
        e.status = EnrollmentStatus.DRAFT

    try:
        import os
        public_base = (
            request.headers.get("X-Public-Origin")
            or os.getenv("PUBLIC_BASE_URL")
            or None
        )
        generate_enrollment_files(e, public_base=public_base)
    except Exception as exc:  # noqa: BLE001
        current_app.logger.exception("Enrollment generation failed: %s", exc)
        db.session.rollback()
        return jsonify(error=f"Не удалось сформировать документы: {exc}"), 500
    if e.status == EnrollmentStatus.DRAFT:
        e.status = EnrollmentStatus.GENERATED
    db.session.commit()
    return jsonify(item=e.to_dict(include_relations=True))


@bp.get("/<int:eid>/download/<string:document>/<string:fmt>")
@jwt_required()
def download(eid, document, fmt):
    """Download contract/consent files.

    For PDF downloads on enrollments that already carry at least one signature
    we APPEND a "Сертификат подписания" annex (signers, masked IIN, time,
    verification level, QR + verify URL) so the downloaded file VISUALLY
    shows the signatures even when the underlying signed DOCX bytes (which
    must stay untouched for cryptographic verification) do not.

    DOCX downloads are always served as-is — that file is the legal signed
    payload and altering its bytes would invalidate every CMS row.
    """
    e = EnrollmentContract.query.get_or_404(eid)
    if document not in DOCUMENTS or fmt not in ("docx", "pdf"):
        return jsonify(error="Файл не найден"), 404
    rel = e.doc_path(document, fmt)
    if not rel:
        return jsonify(error="Файл не найден"), 404

    archive_root = current_app.config["ARCHIVE_FOLDER"]

    # PDF + has signatures → serve a merged (visual) copy
    if fmt == "pdf" and (e.signatures or []):
        from ..services.pdf_visualization import merge_enrollment_pdf
        from flask import send_file
        base_pdf = Path(archive_root) / rel
        public_base = request.headers.get("X-Public-Origin") or None
        try:
            merged = merge_enrollment_pdf(e, base_pdf, public_base=public_base)
        except Exception as exc:  # noqa: BLE001
            current_app.logger.exception("PDF merge failed: %s", exc)
            merged = base_pdf
        if merged and Path(merged).is_file():
            return send_file(
                str(merged),
                as_attachment=True,
                download_name=Path(rel).name,
                mimetype="application/pdf",
            )

    return send_from_directory(archive_root, rel, as_attachment=True)


@bp.get("/<int:eid>/certificate")
@jwt_required()
def download_signature_certificate(eid):
    """Generate + return the "Сертификат подписания" PDF for this enrollment.

    SAFETY: This endpoint does NOT modify the enrollment row, the signed DOCX
    bytes, or any EnrollmentSignature row. It produces a SIDE-CHANNEL PDF that
    lists who signed (party, masked IIN, time, verification level) and embeds
    the same QR code that links to the public /verify/<code> page. Regenerating
    is idempotent and safe for already-signed enrollments — the original
    signatures stay intact because nothing they were bound to has changed.
    """
    from ..services.enrollment_certificate import generate_signature_certificate
    e = EnrollmentContract.query.get_or_404(eid)
    public_base = request.headers.get("X-Public-Origin") or None
    try:
        docx_path, pdf_path = generate_signature_certificate(e, public_base=public_base)
    except Exception as exc:  # noqa: BLE001
        current_app.logger.exception("Certificate generation failed: %s", exc)
        return jsonify(error=f"Не удалось сформировать сертификат: {exc}"), 500
    # Prefer PDF if LibreOffice produced one; fall back to DOCX otherwise.
    final = pdf_path or docx_path
    archive_root = current_app.config["ARCHIVE_FOLDER"]
    rel = str(final.relative_to(archive_root))
    return send_from_directory(archive_root, rel, as_attachment=True)


@bp.delete("/<int:eid>")
@admin_required
def delete_enrollment(eid):
    e = EnrollmentContract.query.get_or_404(eid)
    archive_base = Path(current_app.config["ARCHIVE_FOLDER"])
    files = [archive_base / rel for rel in (
        e.contract_docx_path, e.contract_pdf_path,
        e.consent_docx_path, e.consent_pdf_path,
    ) if rel]

    db.session.delete(e)
    db.session.commit()

    for p in files:
        try:
            if p.is_file():
                p.unlink()
        except OSError as exc:
            current_app.logger.warning("Failed to remove %s: %s", p, exc)
    return jsonify(ok=True)


# ─────────────────────────────────────────────────────────────────────────────
# Admin: signing links
# ─────────────────────────────────────────────────────────────────────────────

def _recipient_for(e: EnrollmentContract, party: str) -> dict:
    if party == PARTY_PARENT:
        return {"name": e.parent_full_name, "iin": e.parent_iin}
    if party == PARTY_COLLEGE:
        # Auto-pull the director's data from CollegeSettings — admin never
        # types it in. `bin` is used as identity because the college signs
        # AS an organisation.
        s = CollegeSettings.query.first()
        return {
            "name": (s.director_full_name if s else "") or "",
            "iin": (s.bin if s else "") or "",
        }
    return {"name": e.applicant_full_name, "iin": e.applicant_iin}


@bp.post("/<int:eid>/invite")
@admin_required
def invite(eid):
    e = EnrollmentContract.query.get_or_404(eid)
    if not (e.contract_docx_path and e.consent_docx_path):
        return jsonify(error="Сначала сформируйте документы"), 400

    matrix = e.required_matrix
    if not matrix:
        return jsonify(error="Укажите дату рождения абитуриента — от неё зависит, кто подписывает"), 400
    if PARTY_PARENT in matrix and not e.parent_full_name:
        return jsonify(error="Укажите ФИО законного представителя (родителя)"), 400

    data = get_json_safe()
    force = bool(data.get("force"))
    requested = data.get("parties")
    if requested is None:
        # The college signs admin-side (no token), so it is never invited via
        # this endpoint even though ``required_matrix`` includes it.
        requested = [p for p in matrix.keys() if p != PARTY_COLLEGE]
    elif not isinstance(requested, list):
        return jsonify(error="Поле parties должно быть массивом"), 400

    created = []
    cleared_any = False
    for party in requested:
        if party not in matrix or party == PARTY_COLLEGE:
            continue
        active = EnrollmentSigningRequest.query.filter_by(enrollment_id=eid, signer_party=party).filter(
            EnrollmentSigningRequest.status.in_(("pending", "viewed"))
        ).first()
        if active and not force:
            continue
        # Already fully signed → never mint a new link (applies to BOTH paths).
        # A fresh request would be dead on arrival: every assigned document hits
        # the `existing` signature guard in public_submit and returns 409. Re-
        # issuing here would also only invalidate a valid ЭЦП. To truly re-sign,
        # regenerate the bytes via /generate (force) first.
        required = set(matrix[party])
        signed_docs = {s.document for s in (e.signatures or []) if s.signer_party == party}
        if required.issubset(signed_docs):
            continue
        if force:
            # Revoke prior links AND drop this party's partial signatures so the
            # fresh link is not dead on arrival (public_view/submit recompute
            # signed-state from EnrollmentSignature, so leftover rows would make
            # the new link report "already signed" and refuse the re-sign).
            EnrollmentSigningRequest.query.filter_by(enrollment_id=eid, signer_party=party).filter(
                EnrollmentSigningRequest.status.in_(("pending", "viewed", "signed"))
            ).update({"status": "revoked", "revoked_at": utc_now()}, synchronize_session=False)
            if signed_docs:
                EnrollmentSignature.query.filter_by(
                    enrollment_id=eid, signer_party=party
                ).delete(synchronize_session=False)
                cleared_any = True
        sr = EnrollmentSigningRequest.create_for(eid, party, _recipient_for(e, party))
        db.session.add(sr)
        created.append(sr)

    # If we wiped signatures, the contract is no longer fully signed.
    if cleared_any and e.status in (EnrollmentStatus.SIGNED, EnrollmentStatus.COMPLETED):
        e.status = EnrollmentStatus.SENT
    if e.status == EnrollmentStatus.GENERATED and created:
        e.status = EnrollmentStatus.SENT

    db.session.commit()
    base = _public_base()
    return jsonify(items=[sr.to_dict(include_token=True, public_base_url=base) for sr in created])


@bp.get("/<int:eid>/requests")
@admin_required
def list_requests(eid):
    EnrollmentContract.query.get_or_404(eid)
    rows = (
        EnrollmentSigningRequest.query.filter_by(enrollment_id=eid)
        .order_by(EnrollmentSigningRequest.created_at.desc())
        .all()
    )
    base = _public_base()
    return jsonify(items=[r.to_dict(include_token=True, public_base_url=base) for r in rows])


@bp.post("/requests/<int:rid>/revoke")
@admin_required
def revoke(rid):
    sr = EnrollmentSigningRequest.query.get_or_404(rid)
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
def resend(rid):
    sr = EnrollmentSigningRequest.query.get_or_404(rid)
    if sr.status == "signed":
        return jsonify(error="Запрос уже подписан"), 409
    sr.token = EnrollmentSigningRequest.generate_token()
    sr.status = "pending"
    sr.viewed_at = None
    sr.revoked_at = None
    sr.expires_at = utc_now() + timedelta(days=EnrollmentSigningRequest.DEFAULT_TTL_DAYS)
    db.session.commit()
    return jsonify(item=sr.to_dict(include_token=True, public_base_url=_public_base()))


# ─────────────────────────────────────────────────────────────────────────────
# Admin: sign as College (no public token — the admin's own NCALayer session
# signs on behalf of the college; the director's identity is auto-pulled from
# CollegeSettings, so the admin never types anything).
# ─────────────────────────────────────────────────────────────────────────────

@bp.get("/<int:eid>/college-info")
@admin_required
def college_info(eid):
    """Return the director's ЭЦП-signable identity for the college side.

    Consumed by the "Подпись колледжа" card on the enrollment detail page so
    the admin sees exactly what will be recorded before they press "Подписать".
    """
    EnrollmentContract.query.get_or_404(eid)
    s = CollegeSettings.query.first()
    return jsonify(
        director_full_name=(s.director_full_name if s else "") or "",
        director_basis=(s.director_basis if s else "") or "",
        college_name=(s.name_ru if s else "") or "",
        college_bin=(s.bin if s else "") or "",
        college_address=(s.address if s else "") or "",
    )


@bp.get("/<int:eid>/college-payload/<string:document>")
@admin_required
def college_payload(eid, document):
    """Return the DOCX bytes for the college to sign — the admin's browser
    hands these to NCALayer, gets a CMS back, then POSTs it to
    /college-sign/<document>. Existing student/parent signatures on the
    document must NOT block this — the college side is a separate slot in
    the ``EnrollmentSignature`` unique constraint (enrollment_id, document,
    signer_party) so all three parties can coexist.
    """
    e = EnrollmentContract.query.get_or_404(eid)
    if document not in DOCUMENTS:
        return jsonify(error="Неизвестный документ"), 400
    rel = e.doc_path(document, "docx")
    if not rel:
        return jsonify(error="Сначала сформируйте документы"), 400
    path = Path(current_app.config["ARCHIVE_FOLDER"]) / rel
    if not path.is_file():
        return jsonify(error="Файл документа недоступен на сервере"), 500
    data = path.read_bytes()
    return jsonify(
        sha256=payload_sha256(data),
        payload_base64=base64.b64encode(data).decode("ascii"),
        size=len(data),
        filename=path.name,
        document=document,
        document_label=DOCUMENT_LABELS[document],
    )


@bp.post("/<int:eid>/college-sign/<string:document>")
@admin_required
def college_sign(eid, document):
    """Attach a college-side ЭЦП to `document` on this enrollment.

    SAFETY: This adds a NEW EnrollmentSignature row with
    signer_party="college". The existing (enrollment_id, document, signer_party)
    unique constraint guarantees at most one college signature per
    (enrollment, document) — student and parent signatures on the same
    document row stay untouched.
    """
    e = EnrollmentContract.query.get_or_404(eid)
    if document not in DOCUMENTS:
        return jsonify(error="Неизвестный документ"), 400

    existing = EnrollmentSignature.query.filter_by(
        enrollment_id=e.id, document=document, signer_party=PARTY_COLLEGE,
    ).first()
    if existing:
        return jsonify(error="Колледж уже подписал этот документ", code="signed"), 409

    data = get_json_safe()
    cms_b64 = (data.get("cms") or "").strip()
    if not cms_b64:
        return jsonify(error="Подпись не передана"), 400

    rel = e.doc_path(document, "docx")
    if not rel:
        return jsonify(error="Сначала сформируйте документы"), 400
    path = Path(current_app.config["ARCHIVE_FOLDER"]) / rel
    if not path.is_file():
        return jsonify(error="Файл документа недоступен на сервере"), 500
    payload_bytes = path.read_bytes()

    try:
        parsed = verify_cms_signature(cms_b64, payload_bytes)
    except SignatureError as exc:
        return jsonify(error=str(exc)), 400

    # Soft identity check against the director's BIN in CollegeSettings.
    settings = CollegeSettings.query.first()
    expected_bin = _normalize_iin((settings.bin if settings else "") or "")
    actual_id = _normalize_iin(parsed.signer_iin_or_bin)
    identity_mismatch = bool(expected_bin and actual_id and expected_bin != actual_id)
    if identity_mismatch:
        current_app.logger.warning(
            "College signature ID mismatch e=%s doc=%s expected_bin=%s signer=%s",
            e.id, document, expected_bin, actual_id,
        )

    sig = EnrollmentSignature(
        enrollment_id=e.id,
        document=document,
        signer_party=PARTY_COLLEGE,
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
        db.session.commit()
    except (IntegrityError, OperationalError):
        db.session.rollback()
        return jsonify(error="Колледж уже подписал этот документ", code="signed"), 409

    if e.is_fully_signed and e.status != EnrollmentStatus.SIGNED:
        e.status = EnrollmentStatus.SIGNED
        try:
            db.session.commit()
        except (IntegrityError, OperationalError):
            db.session.rollback()

    return jsonify(
        ok=True,
        signature=sig.to_dict(),
        warnings=parsed.warnings + (
            [f"БИН подписанта ({actual_id}) не совпал с ожидаемым ({expected_bin})"]
            if identity_mismatch else []
        ),
        document=document,
        all_signed=e.is_fully_signed,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Public (token-based)
# ─────────────────────────────────────────────────────────────────────────────

def _get_request(token: str) -> EnrollmentSigningRequest | None:
    return EnrollmentSigningRequest.query.filter_by(token=token).first()


def _doc_path(e: EnrollmentContract, document: str) -> Path | None:
    rel = e.doc_path(document, "docx")
    if not rel:
        return None
    return Path(current_app.config["ARCHIVE_FOLDER"]) / rel


def _party_documents(e: EnrollmentContract, party: str) -> list[str]:
    return e.required_matrix.get(party, [])


def _mask_iin_public(value: str | None) -> str:
    """Mask middle digits of an IIN/BIN — public token surfaces intentionally
    hide the full identifier (the QR + signer cert already carry the real value
    where needed). Mirrors the same helper in lms_contracts.py so the public
    enrollment payload follows the project's documented masking convention."""
    if not value:
        return ""
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    if len(digits) < 8:
        return digits
    return f"{digits[:6]}****{digits[-2:]}"


def _public_summary(e: EnrollmentContract) -> dict:
    """Token-public summary. The IIN is intentionally masked — the same field
    on /verify is masked and the parallel LMS public summary masks it; the
    parent signer legitimately does not need the applicant's full IIN."""
    settings = CollegeSettings.query.first()
    return {
        "number": e.number,
        "date": e.contract_date.isoformat() if e.contract_date else None,
        "applicant_full_name": e.applicant_full_name,
        "applicant_iin_masked": _mask_iin_public(e.applicant_iin),
        "specialty": e.specialty,
        "qualification": e.qualification,
        "tuition_year_amount": e.tuition_year_amount,
        "college_name": settings.name_ru if settings else "",
    }


@bp.get("/public/<string:token>")
def public_view(token):
    sr = _get_request(token)
    if not sr:
        return jsonify(error="Ссылка недействительна"), 404
    if sr.is_expired:
        return jsonify(error="Срок ссылки истёк", code="expired"), 410
    if sr.status == "revoked":
        return jsonify(error="Ссылка отозвана", code="revoked"), 410

    e = sr.enrollment
    my_docs = _party_documents(e, sr.signer_party)
    signed_by_me = {
        s.document for s in e.signatures if s.signer_party == sr.signer_party
    }
    documents = [
        {
            "key": doc,
            "label": DOCUMENT_LABELS[doc],
            "signed": doc in signed_by_me,
            "docx": bool(e.doc_path(doc, "docx")),
            "pdf": bool(e.doc_path(doc, "pdf")),
        }
        for doc in my_docs
    ]
    # Cross-party progress (who has signed what).
    all_sigs = [
        {"document": s.document, "signer_party": s.signer_party,
         "signer_full_name": s.signer_full_name,
         "created_at": s.created_at.isoformat() if s.created_at else None}
        for s in e.signatures
    ]
    return jsonify(
        request={
            "id": sr.id,
            "signer_party": sr.signer_party,
            "signer_party_label": PARTY_LABELS[sr.signer_party],
            "recipient_name": sr.recipient_name,
            "status": sr.status,
            "expires_at": sr.expires_at.isoformat() if sr.expires_at else None,
        },
        enrollment=_public_summary(e),
        documents=documents,
        signatures=all_sigs,
        applicant_age=e.applicant_age,
    )


@bp.post("/public/<string:token>/view")
def public_mark_viewed(token):
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


@bp.get("/public/<string:token>/payload/<string:document>")
def public_payload(token, document):
    sr = _get_request(token)
    if not sr:
        return jsonify(error="Ссылка недействительна"), 404
    if sr.is_expired:
        return jsonify(error="Срок ссылки истёк", code="expired"), 410
    if sr.status == "revoked":
        return jsonify(error="Ссылка отозвана", code="revoked"), 410
    e = sr.enrollment
    if document not in _party_documents(e, sr.signer_party):
        return jsonify(error="Этот документ не относится к вашей подписи"), 403
    path = _doc_path(e, document)
    if not path or not path.is_file():
        current_app.logger.error("Enrollment file missing on disk: %s", path)
        return jsonify(error="Файл документа недоступен на сервере"), 500
    data = path.read_bytes()
    return jsonify(
        sha256=payload_sha256(data),
        payload_base64=base64.b64encode(data).decode("ascii"),
        size=len(data),
        filename=path.name,
        document=document,
        document_label=DOCUMENT_LABELS[document],
    )


@bp.post("/public/<string:token>/submit/<string:document>")
def public_submit(token, document):
    sr = (
        EnrollmentSigningRequest.query.filter_by(token=token).with_for_update().first()
    )
    if not sr:
        return jsonify(error="Ссылка недействительна"), 404
    if sr.is_expired:
        return jsonify(error="Срок ссылки истёк", code="expired"), 410
    if sr.status == "revoked":
        return jsonify(error="Ссылка отозвана", code="revoked"), 410

    e = sr.enrollment
    party = sr.signer_party
    if document not in _party_documents(e, party):
        return jsonify(error="Этот документ не относится к вашей подписи"), 403

    existing = EnrollmentSignature.query.filter_by(
        enrollment_id=e.id, document=document, signer_party=party
    ).first()
    if existing:
        return jsonify(error="Этот документ уже подписан по этой ссылке", code="signed"), 409

    data = get_json_safe()
    cms_b64 = (data.get("cms") or "").strip()
    if not cms_b64:
        return jsonify(error="Подпись не передана"), 400

    path = _doc_path(e, document)
    if not path or not path.is_file():
        current_app.logger.error("Enrollment file missing on disk: %s", path)
        return jsonify(error="Файл документа недоступен на сервере"), 500
    payload_bytes = path.read_bytes()

    try:
        parsed = verify_cms_signature(cms_b64, payload_bytes)
    except SignatureError as exc:
        return jsonify(error=str(exc)), 400

    # Bind the certificate identity to the expected signer. Soft check (warn, not
    # reject) — consistent with the internship flow — since the expected IIN is
    # optional data and a hard reject would block a legitimate signer when it is
    # simply absent.
    expected_iin = _normalize_iin(
        sr.recipient_iin or (e.parent_iin if party == PARTY_PARENT else e.applicant_iin)
    )
    actual_iin = _normalize_iin(parsed.signer_iin_or_bin)
    identity_mismatch = bool(expected_iin and actual_iin and expected_iin != actual_iin)
    if identity_mismatch:
        # Mask PII in logs (KZ Закон 152-V): last 4 digits only.
        current_app.logger.warning(
            "Enrollment signature ID mismatch e=%s doc=%s party=%s expected=*****%s signer=*****%s",
            e.id, document, party, expected_iin[-4:], actual_iin[-4:],
        )

    sig = EnrollmentSignature(
        enrollment_id=e.id,
        document=document,
        signer_party=party,
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
        db.session.commit()
    except (IntegrityError, OperationalError):
        db.session.rollback()
        return jsonify(error="Этот документ уже подписан", code="signed"), 409

    # Mark the request signed once every document assigned to this party is done;
    # flip the enrollment to SIGNED once the whole matrix is satisfied. Recompute
    # from committed rows so concurrent submits converge (idempotent).
    signed_docs = {
        s.document for s in EnrollmentSignature.query.filter_by(
            enrollment_id=e.id, signer_party=party
        ).all()
    }
    if set(_party_documents(e, party)).issubset(signed_docs) and sr.status != "signed":
        sr.status = "signed"
        sr.signed_at = utc_now()

    if e.is_fully_signed and e.status != EnrollmentStatus.SIGNED:
        e.status = EnrollmentStatus.SIGNED
    try:
        db.session.commit()
    except (IntegrityError, OperationalError):
        db.session.rollback()

    return jsonify(
        ok=True,
        signature=sig.to_dict(),
        warnings=parsed.warnings + (
            [f"ИИН подписанта ({actual_iin}) не совпал с ожидаемым ({expected_iin})"]
            if identity_mismatch else []
        ),
        document=document,
        remaining=[d for d in _party_documents(e, party) if d not in signed_docs],
        all_signed=e.is_fully_signed,
    )


@bp.get("/public/<string:token>/download/<string:document>/<string:fmt>")
def public_download(token, document, fmt):
    sr = _get_request(token)
    if not sr or sr.is_expired or sr.status == "revoked":
        return jsonify(error="Ссылка недействительна"), 404
    e = sr.enrollment
    if fmt not in ("docx", "pdf"):
        return jsonify(error="Файл не найден"), 404
    # Scope downloads to the documents this party actually signs (mirrors
    # payload/submit) so e.g. a parent token (consent only) can't pull the full
    # contract PDF with the applicant's PII via a hand-edited URL.
    if document not in _party_documents(e, sr.signer_party):
        return jsonify(error="Этот документ не относится к вашей подписи"), 403
    rel = e.doc_path(document, fmt)
    if not rel:
        return jsonify(error="Файл не найден"), 404
    # `?inline=1` serves the file for in-browser preview (the signer sees the full
    # bilingual document before signing) instead of forcing a download.
    inline = request.args.get("inline") in ("1", "true", "yes")
    return send_from_directory(
        current_app.config["ARCHIVE_FOLDER"], rel, as_attachment=not inline
    )
