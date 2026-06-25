"""Generate the enrollment DOCX/PDF documents (contract + consent)."""
from __future__ import annotations

from datetime import date
from pathlib import Path

from docxtpl import DocxTemplate
from flask import current_app

from ..models import (
    CollegeSettings,
    EnrollmentContract,
    DOC_CONTRACT,
    DOC_CONSENT,
    ADULT_SIGN_AGE,
)
from ..utils.files import safe_filename, ensure_dir
from ..utils.time import utc_today
from .document_generator import _convert_to_pdf, _MONTHS_RU
from .enrollment_template_builder import ensure_enrollment_templates


def _fmt_date(value: date | None) -> str:
    return value.strftime("%d.%m.%Y") if value else "____________"


def _fmt_amount(value) -> str:
    if value in (None, ""):
        return "____________"
    try:
        return f"{int(value):,}".replace(",", " ")
    except (TypeError, ValueError):
        return str(value)


def _build_context(e: EnrollmentContract) -> dict:
    settings = CollegeSettings.query.first()
    d = e.contract_date or utc_today()
    # Drives the age-aware consent/contract wording. Unknown age → treat as minor
    # (safe: invite() already blocks until a birth date exists, so a real signed
    # document always has a known age).
    is_minor = (e.applicant_age is None) or (e.applicant_age < ADULT_SIGN_AGE)

    addr_parts = [
        e.applicant_address_city,
        e.applicant_address_district,
        e.applicant_address_street,
        (f"д. {e.applicant_address_house}" if e.applicant_address_house else None),
    ]
    applicant = {
        "full_name": e.applicant_full_name or "",
        "iin": e.applicant_iin or "",
        "birth_date": _fmt_date(e.applicant_birth_date),
        "gender": e.applicant_gender or "",
        "id_doc_type": e.applicant_id_doc_type or "удостоверение личности",
        "id_doc_number": e.applicant_id_doc_number or "",
        "id_doc_issued_by": e.applicant_id_doc_issued_by or "",
        "id_doc_issued_date": _fmt_date(e.applicant_id_doc_issued_date),
        "address": ", ".join(p for p in addr_parts if p) or "",
        # Separate address parts feed the bilingual contract's split address line
        # (город / район / улица / дом); the joined `address` feeds the consent.
        "addr_city": e.applicant_address_city or "",
        "addr_district": e.applicant_address_district or "",
        "addr_street": e.applicant_address_street or "",
        "addr_house": e.applicant_address_house or "",
        "home_phone": e.applicant_home_phone or "",
        "phone": e.applicant_phone or "",
        "email": e.applicant_email or "",
        "specialty": e.specialty or "",
        "specialty_code": e.specialty_code or "",
        "qualification": e.qualification or "",
        "is_minor": is_minor,
    }
    parent = {
        "full_name": e.parent_full_name or "",
        "relation": e.parent_relation or "",
        "iin": e.parent_iin or "",
        "id_doc_number": e.parent_id_doc_number or "",
        "id_doc_issued_by": e.parent_id_doc_issued_by or "",
        "address": e.parent_address or "",
        "phone": e.parent_phone or "",
        "email": e.parent_email or "",
    }
    return {
        "contract": {
            "number": e.number or "________",
            "date": _fmt_date(d),
            "date_day": f"{d.day:02d}",
            "date_month": _MONTHS_RU[d.month],
            "date_year": d.year,
            "tuition_amount": _fmt_amount(e.tuition_year_amount),
            "education_base": e.education_base or "",
            "study_form": e.study_form or "очная",
            "course": e.course or 1,
        },
        "college": settings.to_dict() if settings else {},
        # `student` and `applicant` point at the same person — the contract uses
        # `student.*`, the consent uses `applicant.*`.
        "student": applicant,
        "applicant": applicant,
        "parent": parent,
    }


def _archive_dir(e: EnrollmentContract) -> Path:
    base = Path(current_app.config["ARCHIVE_FOLDER"]) / "Образовательные услуги"
    base = base / str(e.year or (e.contract_date or utc_today()).year)
    base = base / safe_filename(e.applicant_full_name or f"enroll_{e.id}")
    return ensure_dir(base)


_STEMS = {
    DOC_CONTRACT: "Договор_ОУ",
    DOC_CONSENT: "Согласие_ПДн",
}


def _filename(e: EnrollmentContract, document: str, ext: str) -> str:
    who = safe_filename(e.applicant_full_name or f"enroll_{e.id}")
    year = e.year or (e.contract_date or utc_today()).year
    stem = _STEMS.get(document, document)
    return f"{stem}_{who}_{year}.{ext}"


def _unlink_quietly(path: Path, label: str) -> None:
    try:
        if path.is_file():
            path.unlink()
    except OSError as exc:
        current_app.logger.warning("Failed to remove %s %s: %s", label, path, exc)


def _render_one(e: EnrollmentContract, document: str, template_path: Path,
                context: dict, archive_dir: Path,
                written: list[Path] | None = None) -> None:
    archive_root = current_app.config["ARCHIVE_FOLDER"]

    # Capture the previously-recorded files BEFORE we overwrite the DB paths.
    # The applicant name / contract-year are editable, and both feed into the
    # output location — regenerating after such an edit writes to a NEW path, so
    # the old files would otherwise be orphaned on disk (with no DB reference and
    # unreachable by the DELETE handler). They still hold applicant PII, so we
    # remove any whose location differs from the new output.
    old_paths = [
        Path(archive_root) / rel
        for rel in (e.doc_path(document, "docx"), e.doc_path(document, "pdf"))
        if rel
    ]

    docx_name = _filename(e, document, "docx")
    docx_full = archive_dir / docx_name

    tpl = DocxTemplate(str(template_path))
    tpl.render(context)
    tpl.save(str(docx_full))
    if written is not None:
        written.append(docx_full)

    setattr(e, f"{document}_docx_path", str(docx_full.relative_to(archive_root)))

    # The DOCX was just rewritten → any prior PDF is stale. Clear + remove before
    # reconverting so a failed conversion can't leave a mismatched PDF.
    setattr(e, f"{document}_pdf_path", None)
    new_pdf = docx_full.with_suffix(".pdf")
    _unlink_quietly(new_pdf, "stale PDF")

    # Remove the prior generation's files only when they live somewhere other
    # than the new docx/pdf (a same-path rewrite is already handled above).
    keep = {docx_full.resolve(), new_pdf.resolve()}
    for old in old_paths:
        try:
            resolved = old.resolve()
        except OSError:
            resolved = old
        if resolved not in keep:
            _unlink_quietly(old, "orphaned enrollment file")

    produced = _convert_to_pdf(docx_full)
    if produced:
        if written is not None:
            written.append(produced)
        setattr(e, f"{document}_pdf_path", str(produced.relative_to(archive_root)))


def generate_enrollment_files(e: EnrollmentContract) -> EnrollmentContract:
    templates = ensure_enrollment_templates(current_app.config["TEMPLATES_FOLDER"])
    context = _build_context(e)
    archive_dir = _archive_dir(e)

    # The two documents are rendered in sequence: the contract writes its
    # .docx/.pdf and mutates e.*_path before the consent is rendered. If the
    # SECOND render fails, the caller rolls back the DB but cannot undo the files
    # already written for the FIRST — leaving an orphaned, unreferenced contract
    # on disk (and, on a regeneration to a new path, a DB column pointing at a
    # now-deleted prior file). Match the DB rollback with a disk rollback: track
    # every file written during THIS call and unlink it on failure before
    # re-raising, so the archive cannot end up half-generated.
    written: list[Path] = []
    try:
        _render_one(e, DOC_CONTRACT, templates["contract"], context, archive_dir, written)
        _render_one(e, DOC_CONSENT, templates["consent"], context, archive_dir, written)
    except Exception:
        for path in written:
            _unlink_quietly(path, "partially-generated enrollment file")
        raise
    return e
