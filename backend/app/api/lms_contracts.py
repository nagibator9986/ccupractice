"""Standalone LMS-contract (Caspian Digital) API — grant-only seats.

Mirrors `api/enrollment.py` but for the single-document, single-signer
LmsContract aggregate. Admin endpoints (CRUD + generate + invite + revoke +
resend) require `@admin_required`. Public endpoints (preview / payload /
submit / download) are token-gated; the URL prefix is `/api/lms-contracts`,
the public SPA URL is `/lms-sign/<token>` (single document — no `/<document>`
path segment, unlike enrollment).
"""
from __future__ import annotations

import base64
import os
from datetime import timedelta
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from flask_jwt_extended import jwt_required
from sqlalchemy.exc import IntegrityError, OperationalError

from ..extensions import db
from ..models import (
    CollegeSettings,
    DOC_LMS,
    DOCUMENT_LABELS,
    LmsContract,
    LmsSignature,
    LmsSigningRequest,
    LmsStatus,
    PARTY_LABELS,
    PARTY_PARENT,
    Student,
    suggest_lms_number,
)
from ..services.lms_documents import generate_lms_files
from ..services.signature_service import SignatureError, payload_sha256
from ..services.signature_verification import verify_cms_signature
from ..utils.auth import admin_required
from ..utils.serializers import clean_str, get_json_safe, parse_date, parse_int
from ..utils.time import utc_now, utc_today

bp = Blueprint("lms_contracts", __name__)


# Editable snapshot fields. The applicant/parent identity blocks duplicate the
# enrollment fields so an admin can correct typos without touching the linked
# Student row (which is reused across other aggregates).
_TEXT_FIELDS = {
    "number": 60,
    "applicant_full_name": 200, "applicant_iin": 20,
    "applicant_id_doc_number": 60, "applicant_id_doc_issued_by": 200,
    "applicant_address_city": 120, "applicant_address_district": 120,
    "applicant_address_street": 200, "applicant_address_house": 60,
    "applicant_phone": 60, "applicant_home_phone": 60, "applicant_email": 160,
    "parent_full_name": 200, "parent_iin": 20, "parent_relation": 60,
    "parent_address": 400, "parent_phone": 60, "parent_email": 160,
    "specialty": 200, "specialty_code": 60, "qualification": 200,
    "education_base": 10, "study_form": 60,
    "grant_order_number": 60, "funding_source": 40,
}
_DATE_FIELDS = (
    "contract_date", "applicant_birth_date", "applicant_id_doc_issued_date",
    "grant_order_date",
)
_INT_FIELDS = ("course",)


def _public_base() -> str:
    return request.headers.get("X-Public-Origin") or request.host_url.rstrip("/")


def _normalize_iin(value) -> str:
    if not value:
        return ""
    s = str(value).replace("IIN", "").replace("BIN", "").strip()
    return "".join(ch for ch in s if ch.isdigit())


def _apply(lms: LmsContract, data: dict) -> None:
    for field, max_len in _TEXT_FIELDS.items():
        if field in data:
            setattr(lms, field, clean_str(data.get(field), max_len=max_len))
    for field in _DATE_FIELDS:
        if field in data:
            setattr(lms, field, parse_date(data.get(field)))
    for field in _INT_FIELDS:
        if field in data:
            setattr(lms, field, parse_int(data.get(field)))
    if "notes" in data:
        lms.notes = clean_str(data.get("notes"))
    if lms.contract_date:
        lms.year = lms.contract_date.year


def _snapshot_from_student(lms: LmsContract, student: Student) -> None:
    """Copy applicant snapshot fields from a Student row (called on create)."""
    lms.applicant_full_name = student.full_name or lms.applicant_full_name
    lms.applicant_iin = student.iin or lms.applicant_iin
    lms.applicant_birth_date = student.birth_date or lms.applicant_birth_date
    lms.applicant_id_doc_number = student.id_card_number or lms.applicant_id_doc_number
    lms.applicant_id_doc_issued_by = student.id_card_issued_by or lms.applicant_id_doc_issued_by
    if student.home_address and not (
        lms.applicant_address_city or lms.applicant_address_street
    ):
        # Best-effort: store the whole free-form address into "street" so the
        # contract still renders something usable; the admin can split later.
        lms.applicant_address_street = student.home_address
    lms.applicant_phone = student.phone or lms.applicant_phone
    lms.specialty = student.specialty or lms.specialty
    lms.specialty_code = student.specialty_code or lms.specialty_code
    if student.course:
        lms.course = student.course
    if student.form_of_study:
        lms.study_form = student.form_of_study
    # Parent legal-rep snapshot when relevant.
    if student.legal_rep_full_name and not lms.parent_full_name:
        lms.parent_full_name = student.legal_rep_full_name
    if student.legal_rep_iin and not lms.parent_iin:
        lms.parent_iin = student.legal_rep_iin
    if student.legal_rep_phone and not lms.parent_phone:
        lms.parent_phone = student.legal_rep_phone


# ─────────────────────────────────────────────────────────────────────────────
# Admin: CRUD
# ─────────────────────────────────────────────────────────────────────────────

@bp.get("")
@jwt_required()
def list_lms():
    q = (request.args.get("q") or "").strip()
    status = (request.args.get("status") or "").strip()
    year = request.args.get("year")
    has_enrollment = (request.args.get("has_enrollment") or "").strip().lower()
    query = LmsContract.query
    if q:
        like = f"%{q}%"
        query = query.filter(
            db.or_(
                LmsContract.applicant_full_name.ilike(like),
                LmsContract.applicant_iin.ilike(like),
                LmsContract.number.ilike(like),
                LmsContract.specialty.ilike(like),
            )
        )
    if status:
        query = query.filter(LmsContract.status == status)
    if year:
        try:
            query = query.filter(LmsContract.year == int(year))
        except (TypeError, ValueError):
            pass
    # Optional filter: rows that are linked to an enrollment vs. standalone.
    if has_enrollment in ("1", "true", "yes"):
        query = query.filter(LmsContract.source_enrollment_id.isnot(None))
    elif has_enrollment in ("0", "false", "no"):
        query = query.filter(LmsContract.source_enrollment_id.is_(None))
    items = query.order_by(LmsContract.created_at.desc()).all()
    return jsonify(items=[lms.to_dict() for lms in items], total=len(items))


@bp.get("/suggest-number")
@jwt_required()
def suggest_number_endpoint():
    year = parse_int(request.args.get("year")) or utc_today().year
    return jsonify(number=suggest_lms_number(year), year=year)


@bp.get("/grant-students")
@jwt_required()
def grant_students():
    """Students eligible for a new LMS contract: grant-flagged AND not already
    holding a non-completed LmsContract. Used by the create-modal picker."""
    # Subquery: student IDs that currently hold an LMS contract whose status is
    # NOT in the "final" set — we treat 'completed' as released so a student
    # whose previous LMS finished can be issued a new one.
    active_lms_student_ids = db.session.query(LmsContract.student_id).filter(
        LmsContract.status != LmsStatus.COMPLETED,
        LmsContract.student_id.isnot(None),
    )
    query = Student.query.filter_by(is_grant_student=True).filter(
        ~Student.id.in_(active_lms_student_ids)
    )
    items = query.order_by(Student.full_name.asc()).all()
    return jsonify(items=[s.to_dict() for s in items], total=len(items))


@bp.get("/<int:lid>")
@jwt_required()
def get_lms(lid):
    lms = LmsContract.query.get_or_404(lid)
    return jsonify(item=lms.to_dict(include_relations=True))


def _snapshot_from_enrollment(lms: LmsContract, enrollment) -> None:
    """Copy any missing snapshot fields from a linked EnrollmentContract.

    Called when the create payload includes ``source_enrollment_id`` (or one is
    inferred from the Student's most-recent enrollment). Never overwrites
    fields that were already supplied by the payload or by the Student
    snapshot — enrollment is the lowest-priority source.
    """
    if enrollment is None:
        return
    # Applicant identity / address
    for field in (
        "applicant_full_name", "applicant_iin", "applicant_birth_date",
        "applicant_id_doc_number", "applicant_id_doc_issued_by", "applicant_id_doc_issued_date",
        "applicant_address_city", "applicant_address_district",
        "applicant_address_street", "applicant_address_house",
        "applicant_phone", "applicant_home_phone", "applicant_email",
        "parent_full_name", "parent_iin", "parent_relation", "parent_address",
        "parent_phone", "parent_email",
        "specialty", "specialty_code", "qualification",
        "education_base", "study_form", "course",
    ):
        if not getattr(lms, field, None):
            val = getattr(enrollment, field, None)
            if val:
                setattr(lms, field, val)


@bp.post("")
@admin_required
def create_lms():
    data = get_json_safe()
    student_id = parse_int(data.get("student_id"))
    if not student_id:
        return jsonify(error="Не указан студент"), 400
    student = Student.query.get(student_id)
    if not student:
        return jsonify(error="Студент не найден"), 404
    if not student.is_grant_student:
        # 422: grant-only invariant. The Student row exists and the request is
        # well-formed, but the business rule rejects it (a CHECK constraint at
        # the DB layer would also reject the insert; we surface the friendlier
        # error first).
        return jsonify(
            error="LMS-договор может быть оформлен только для студента-грантника. "
                  "Включите 'Грантник (госзаказ)' на карточке студента.",
            code="not_grant_student",
        ), 422

    contract_date = parse_date(data.get("contract_date")) or utc_today()
    year = parse_int(data.get("year")) or contract_date.year

    # Try to find a current EnrollmentContract for the student (most recent by
    # contract_date) so we can copy any missing snapshot fields from it. The
    # client may pass `source_enrollment_id` explicitly to override.
    source_enrollment_id = parse_int(data.get("source_enrollment_id"))
    source_enrollment = None
    if source_enrollment_id:
        from ..models import EnrollmentContract  # local import to avoid cycle
        source_enrollment = EnrollmentContract.query.get(source_enrollment_id)
    else:
        from ..models import EnrollmentContract  # local import to avoid cycle
        # Best-effort: pick the most recent enrollment whose applicant_iin
        # matches the student's IIN. Fall back to None when no match.
        if student.iin:
            source_enrollment = (
                EnrollmentContract.query
                .filter(EnrollmentContract.applicant_iin == student.iin)
                .order_by(EnrollmentContract.contract_date.desc().nullslast())
                .first()
            )
            if source_enrollment is not None:
                source_enrollment_id = source_enrollment.id

    lms = LmsContract(
        student_id=student.id,
        source_enrollment_id=source_enrollment_id,
        contract_date=contract_date,
        year=year,
        applicant_full_name=clean_str(
            data.get("applicant_full_name") or student.full_name, max_len=200
        ) or "—",
        is_grant_at_signing=True,
        funding_source=clean_str(data.get("funding_source"), max_len=40) or "госзаказ",
        status=LmsStatus.DRAFT,
    )
    _snapshot_from_student(lms, student)
    _snapshot_from_enrollment(lms, source_enrollment)
    _apply(lms, data)
    if not lms.number:
        lms.number = suggest_lms_number(lms.year or contract_date.year)

    db.session.add(lms)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(error="Договор с таким номером уже существует"), 409
    return jsonify(item=lms.to_dict(include_relations=True)), 201


@bp.put("/<int:lid>")
@admin_required
def update_lms(lid):
    lms = LmsContract.query.get_or_404(lid)
    data = get_json_safe()

    # The signer party (and the whole signing matrix / is_fully_signed) is
    # derived live from applicant_birth_date and contract_date. Once a party
    # has signed or is signing, mutating these silently invalidates the
    # signature and can lock the signer out — block such edits while there are
    # active signatures/requests (mirror EnrollmentContract guard).
    matrix_fields = ("applicant_birth_date", "contract_date")
    changes_matrix_field = any(
        f in data and parse_date(data.get(f)) != getattr(lms, f) for f in matrix_fields
    )
    if changes_matrix_field:
        has_active = bool(lms.signatures) or (
            LmsSigningRequest.query.filter_by(lms_contract_id=lid)
            .filter(LmsSigningRequest.status.in_(("pending", "viewed", "signed")))
            .first()
            is not None
        )
        if has_active:
            return jsonify(
                error="Дата рождения и дата договора определяют подписанта и не могут "
                "быть изменены, пока есть активные ссылки на подпись или подписи. "
                "Перевыпустите договор (с подтверждением сброса подписей), затем измените дату.",
                code="locked_by_signatures",
            ), 409

    # Status guard: SIGNED is owned by the signing flow; demotion from
    # SIGNED/COMPLETED while signatures still exist would desync the row.
    if "status" in data:
        new_status = data["status"]
        if new_status not in LmsStatus.ALL:
            return jsonify(error=f"Неизвестный статус: {new_status}"), 400
        current = lms.status
        if new_status != current:
            if new_status == LmsStatus.SIGNED:
                return jsonify(
                    error="Статус «Подписан» выставляется автоматически при подписании",
                ), 409
            demote = {LmsStatus.DRAFT, LmsStatus.GENERATED, LmsStatus.SENT}
            if (
                current in (LmsStatus.SIGNED, LmsStatus.COMPLETED)
                and new_status in demote
                and lms.signatures
            ):
                return jsonify(
                    error="Нельзя понизить статус подписанного договора, пока есть подписи. "
                    "Перевыпустите документ (со сбросом подписей).",
                    code="locked_by_signatures",
                ), 409
            lms.status = new_status

    _apply(lms, data)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(error="Договор с таким номером уже существует"), 409
    return jsonify(item=lms.to_dict(include_relations=True))


@bp.post("/<int:lid>/generate")
@admin_required
def generate(lid):
    lms = LmsContract.query.get_or_404(lid)
    data = get_json_safe()
    force = bool(data.get("force"))

    has_sigs = bool(lms.signatures)
    active_reqs = (
        LmsSigningRequest.query.filter_by(lms_contract_id=lid)
        .filter(LmsSigningRequest.status.in_(("pending", "viewed", "signed")))
        .all()
    )
    if (has_sigs or active_reqs) and not force:
        return jsonify(
            error="Договор уже подписывается или подписан — перегенерация сделает "
            "существующие подписи недействительными. Повторите с подтверждением, чтобы сбросить.",
            code="has_signatures",
        ), 409
    if force and (has_sigs or active_reqs):
        for s in list(lms.signatures):
            db.session.delete(s)
        for r in active_reqs:
            r.status = "revoked"
            r.revoked_at = utc_now()
        lms.status = LmsStatus.DRAFT

    public_base = (
        request.headers.get("X-Public-Origin")
        or os.getenv("PUBLIC_BASE_URL")
        or None
    )
    try:
        generate_lms_files(lms, public_base=public_base)
    except Exception as exc:  # noqa: BLE001
        current_app.logger.exception("LMS generation failed: %s", exc)
        db.session.rollback()
        return jsonify(error=f"Не удалось сформировать договор: {exc}"), 500
    if lms.status == LmsStatus.DRAFT:
        lms.status = LmsStatus.GENERATED
    db.session.commit()
    return jsonify(item=lms.to_dict(include_relations=True))


@bp.get("/<int:lid>/download/<string:fmt>")
@jwt_required()
def download(lid, fmt):
    lms = LmsContract.query.get_or_404(lid)
    if fmt not in ("docx", "pdf"):
        return jsonify(error="Файл не найден"), 404
    rel = lms.doc_path(fmt)
    if not rel:
        return jsonify(error="Файл не найден"), 404
    inline = request.args.get("inline") in ("1", "true", "yes")
    return send_from_directory(
        current_app.config["ARCHIVE_FOLDER"], rel, as_attachment=not inline
    )


@bp.delete("/<int:lid>")
@admin_required
def delete_lms(lid):
    lms = LmsContract.query.get_or_404(lid)
    archive_base = Path(current_app.config["ARCHIVE_FOLDER"])
    files = [archive_base / rel for rel in (lms.docx_path, lms.pdf_path) if rel]

    db.session.delete(lms)
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

def _recipient_for(lms: LmsContract) -> dict:
    party = lms.signer_party
    if party == PARTY_PARENT:
        return {"name": lms.parent_full_name, "iin": lms.parent_iin}
    return {"name": lms.applicant_full_name, "iin": lms.applicant_iin}


@bp.post("/<int:lid>/invite")
@admin_required
def invite(lid):
    lms = LmsContract.query.get_or_404(lid)
    if not lms.docx_path:
        return jsonify(
            error="Сначала сформируйте договор",
            code="not_generated",
        ), 409

    matrix = lms.required_matrix
    if not matrix:
        return jsonify(
            error="Укажите дату рождения студента — от неё зависит, кто подписывает",
            code="missing_birth_date",
        ), 400

    party = lms.signer_party
    if party == PARTY_PARENT and not lms.parent_full_name:
        return jsonify(error="Укажите ФИО законного представителя (родителя)"), 400

    data = get_json_safe()
    force = bool(data.get("force"))

    active = LmsSigningRequest.query.filter_by(
        lms_contract_id=lid, signer_party=party
    ).filter(LmsSigningRequest.status.in_(("pending", "viewed"))).first()
    if active and not force:
        return jsonify(items=[], note="active link exists"), 200

    if lms.is_fully_signed and not force:
        return jsonify(items=[], note="already fully signed"), 200

    if force:
        # Revoke prior pending|viewed|signed requests for this party AND delete
        # any existing signature so the new link isn't immediately rejected as
        # "already signed" by the public submit guard.
        LmsSigningRequest.query.filter_by(
            lms_contract_id=lid, signer_party=party
        ).filter(LmsSigningRequest.status.in_(("pending", "viewed", "signed"))).update(
            {"status": "revoked", "revoked_at": utc_now()}, synchronize_session=False,
        )
        for s in list(lms.signatures):
            if s.signer_party == party:
                db.session.delete(s)
        if lms.status in (LmsStatus.SIGNED, LmsStatus.COMPLETED):
            lms.status = LmsStatus.SENT

    sr = LmsSigningRequest.create_for(lid, party, _recipient_for(lms))
    db.session.add(sr)

    if lms.status == LmsStatus.GENERATED:
        lms.status = LmsStatus.SENT
    elif lms.status == LmsStatus.DRAFT:
        # Edge case: generation happened but status never promoted.
        lms.status = LmsStatus.SENT

    db.session.commit()
    base = _public_base()
    payload = sr.to_dict(include_token=True, public_base_url=base)
    # Task spec calls for {request, sign_url}; keep `items` too for the
    # existing admin UI that lists requests after invite.
    return jsonify(
        request=payload,
        sign_url=payload.get("sign_url"),
        items=[payload],
    )


@bp.get("/<int:lid>/requests")
@admin_required
def list_requests(lid):
    LmsContract.query.get_or_404(lid)
    rows = (
        LmsSigningRequest.query.filter_by(lms_contract_id=lid)
        .order_by(LmsSigningRequest.created_at.desc())
        .all()
    )
    base = _public_base()
    return jsonify(items=[r.to_dict(include_token=True, public_base_url=base) for r in rows])


@bp.post("/requests/<int:rid>/revoke")
@admin_required
def revoke(rid):
    sr = LmsSigningRequest.query.get_or_404(rid)
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
    sr = LmsSigningRequest.query.get_or_404(rid)
    if sr.status == "signed":
        return jsonify(error="Запрос уже подписан"), 409
    sr.token = LmsSigningRequest.generate_token()
    sr.status = "pending"
    sr.viewed_at = None
    sr.revoked_at = None
    sr.expires_at = utc_now() + timedelta(days=LmsSigningRequest.DEFAULT_TTL_DAYS)
    db.session.commit()
    return jsonify(item=sr.to_dict(include_token=True, public_base_url=_public_base()))


# ─────────────────────────────────────────────────────────────────────────────
# Public (token-based)
# ─────────────────────────────────────────────────────────────────────────────

def _get_request(token: str) -> LmsSigningRequest | None:
    return LmsSigningRequest.query.filter_by(token=token).first()


def _resolve_request(token: str):
    """Centralized validity-gates lookup.

    Returns either (sr, None) on success or (None, (json, status)) so callers
    can ``return resolve_err`` directly. Gates (in order):
      * unknown token → 404 Ссылка недействительна
      * sr.is_expired → 410 expired
      * sr.status == 'revoked' → 410 revoked
    """
    sr = _get_request(token)
    if not sr:
        return None, (jsonify(error="Ссылка недействительна"), 404)
    if sr.is_expired:
        return None, (jsonify(error="Срок ссылки истёк", code="expired"), 410)
    if sr.status == "revoked":
        return None, (jsonify(error="Ссылка отозвана", code="revoked"), 410)
    return sr, None


def _payload_path(lms: LmsContract) -> Path | None:
    if not lms.docx_path:
        return None
    return Path(current_app.config["ARCHIVE_FOLDER"]) / lms.docx_path


def _mask_iin_public(value: str | None) -> str:
    """Mask middle digits of an IIN/BIN — public summaries intentionally hide
    the full identifier (the QR + signer cert already carry the real value
    where needed)."""
    if not value:
        return ""
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    if len(digits) < 8:
        return digits
    return f"{digits[:6]}****{digits[-2:]}"


def _public_summary(lms: LmsContract) -> dict:
    """Token-public summary. Intentionally OMITS applicant address/phone/email
    (sensitive PII not needed to render the signer page) and masks the IIN.
    """
    settings = CollegeSettings.query.first()
    return {
        "number": lms.number,
        "contract_date": lms.contract_date.isoformat() if lms.contract_date else None,
        # Back-compat alias for the SPA which historically read `date`.
        "date": lms.contract_date.isoformat() if lms.contract_date else None,
        "applicant_full_name": lms.applicant_full_name,
        "applicant_iin": _mask_iin_public(lms.applicant_iin),
        "specialty": lms.specialty,
        "qualification": lms.qualification,
        "funding_source": lms.funding_source,
        "grant_order_number": lms.grant_order_number,
        "college_name": settings.name_ru if settings else "",
    }


@bp.get("/public/<string:token>")
def public_view(token):
    sr, err = _resolve_request(token)
    if err:
        return err

    lms = sr.lms_contract
    signed_by_me = any(s.signer_party == sr.signer_party for s in lms.signatures)
    return jsonify(
        request={
            "id": sr.id,
            "signer_party": sr.signer_party,
            "signer_party_label": PARTY_LABELS[sr.signer_party],
            "recipient_name": sr.recipient_name,
            "status": sr.status,
            "expires_at": sr.expires_at.isoformat() if sr.expires_at else None,
        },
        lms=_public_summary(lms),
        document={
            "key": DOC_LMS,
            "label": DOCUMENT_LABELS[DOC_LMS],
            "signed": signed_by_me,
            "docx": bool(lms.docx_path),
            "pdf": bool(lms.pdf_path),
        },
        signatures=[
            {
                "signer_party": s.signer_party,
                "signer_full_name": s.signer_full_name,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in lms.signatures
        ],
        applicant_age=lms.applicant_age,
    )


@bp.post("/public/<string:token>/view")
def public_mark_viewed(token):
    sr, err = _resolve_request(token)
    if err:
        return err
    if sr.status == "pending":
        sr.status = "viewed"
        sr.viewed_at = utc_now()
        db.session.commit()
    return jsonify(ok=True, status=sr.status)


@bp.get("/public/<string:token>/payload")
def public_payload(token):
    sr, err = _resolve_request(token)
    if err:
        return err
    lms = sr.lms_contract
    path = _payload_path(lms)
    if not path or not path.is_file():
        current_app.logger.error("LMS file missing on disk: %s", path)
        return jsonify(error="Файл документа недоступен на сервере"), 500
    data = path.read_bytes()
    return jsonify(
        sha256=payload_sha256(data),
        payload_base64=base64.b64encode(data).decode("ascii"),
        size=len(data),
        filename=path.name,
        document=DOC_LMS,
        document_label=DOCUMENT_LABELS[DOC_LMS],
    )


@bp.post("/public/<string:token>/submit")
def public_submit(token):
    # First do unlocked validity gates so we don't pointlessly take a row lock.
    sr_check, err = _resolve_request(token)
    if err:
        return err

    # Re-fetch with row lock; concurrent submits will queue here and the
    # second one will see the freshly-inserted LmsSignature → 409 below.
    sr = (
        db.session.query(LmsSigningRequest)
        .filter_by(id=sr_check.id)
        .with_for_update()
        .first()
    )
    if not sr:
        return jsonify(error="Ссылка недействительна"), 404
    if sr.is_expired:
        return jsonify(error="Срок ссылки истёк", code="expired"), 410
    if sr.status == "revoked":
        return jsonify(error="Ссылка отозвана", code="revoked"), 410

    lms = sr.lms_contract
    party = sr.signer_party

    existing = LmsSignature.query.filter_by(
        lms_contract_id=lms.id, signer_party=party,
    ).first()
    if existing:
        return jsonify(error="Договор уже подписан по этой ссылке", code="signed"), 409

    data = get_json_safe()
    cms_b64 = (data.get("cms") or "").strip()
    if not cms_b64:
        return jsonify(error="Подпись не передана"), 400

    path = _payload_path(lms)
    if not path or not path.is_file():
        current_app.logger.error("LMS file missing on disk: %s", path)
        return jsonify(error="Файл документа недоступен на сервере"), 500
    payload_bytes = path.read_bytes()

    try:
        parsed = verify_cms_signature(cms_b64, payload_bytes)
    except SignatureError as exc:
        # Mirror sibling handlers: human-readable Russian message in `error`,
        # with the machine code surfaced separately for the SPA to switch on.
        return jsonify(error=f"Подпись недействительна: {exc}", code="invalid_signature"), 400

    # Soft identity check (warn, don't reject) — same posture as enrollment.
    expected_iin = _normalize_iin(
        sr.recipient_iin or (lms.parent_iin if party == PARTY_PARENT else lms.applicant_iin)
    )
    actual_iin = _normalize_iin(parsed.signer_iin_or_bin)
    identity_mismatch = bool(expected_iin and actual_iin and expected_iin != actual_iin)
    if identity_mismatch:
        # Mask PII in logs (KZ Закон 152-V): last 4 digits only.
        current_app.logger.warning(
            "LMS signature ID mismatch lms=%s party=%s expected=*****%s signer=*****%s",
            lms.id, party, expected_iin[-4:], actual_iin[-4:],
        )

    sig = LmsSignature(
        lms_contract_id=lms.id,
        signer_party=party,
        signer_full_name=parsed.signer_full_name,
        signer_iin_or_bin=parsed.signer_iin_or_bin,
        signer_serial=parsed.signer_serial,
        signer_certificate_pem=parsed.certificate_pem,
        cms_signature=cms_b64,
        signed_payload_sha256=parsed.payload_sha256,
        verification_level=parsed.verification_level,
    )
    # Wrap the insert in a SAVEPOINT so the UNIQUE-constraint race surfaces
    # cleanly without poisoning the outer transaction with a failed flush.
    try:
        with db.session.begin_nested():
            db.session.add(sig)
    except (IntegrityError, OperationalError):
        return jsonify(error="Договор уже подписан", code="signed"), 409

    # Single-party matrix: once this signature is committed the contract is
    # fully signed by definition.
    if sr.status != "signed":
        sr.status = "signed"
        sr.signed_at = utc_now()
    if lms.is_fully_signed and lms.status != LmsStatus.SIGNED:
        lms.status = LmsStatus.SIGNED

    try:
        db.session.commit()
    except (IntegrityError, OperationalError):
        db.session.rollback()
        return jsonify(error="Договор уже подписан", code="signed"), 409

    return jsonify(
        ok=True,
        signature=sig.to_dict(),
        warnings=parsed.warnings + (
            [f"ИИН подписанта ({actual_iin}) не совпал с ожидаемым ({expected_iin})"]
            if identity_mismatch else []
        ),
        all_signed=lms.is_fully_signed,
    )


@bp.get("/public/<string:token>/download/<string:fmt>")
def public_download(token, fmt):
    sr, err = _resolve_request(token)
    if err:
        return err
    lms = sr.lms_contract
    if fmt not in ("docx", "pdf"):
        return jsonify(error="Файл не найден"), 404
    rel = lms.doc_path(fmt)
    if not rel:
        return jsonify(error="Файл не найден"), 404
    inline = request.args.get("inline") in ("1", "true", "yes")
    # Inline PDF preview needs an explicit mimetype so the browser previews
    # it instead of triggering "open with…". DOCX is always a download.
    send_kwargs: dict = {"as_attachment": not inline}
    if inline and fmt == "pdf":
        send_kwargs["mimetype"] = "application/pdf"
    return send_from_directory(
        current_app.config["ARCHIVE_FOLDER"], rel, **send_kwargs
    )
