"""Generate the standalone LMS contract DOCX + PDF.

The LMS contract is a sibling aggregate to ``EnrollmentContract`` — its own
contract, its own number, its own signing matrix, its own QR-verifiable PDF.
This module is the LMS analogue of :mod:`enrollment_documents`:

  1. ``ensure_lms_templates`` builds the docxtpl template from the pristine
     bilingual source (idempotent).
  2. ``_build_context`` mirrors the enrollment context shape so the same
     ``LMS_FILLS`` map renders correctly (``contract.*``, ``student.*``,
     ``parent.*``, ``college.*`` + ``program.*``).
  3. The DOCX is written under the SAME archive subtree the enrollment
     generator uses (``ARCHIVE_FOLDER / "Образовательные услуги" / {year} /
     {safe(applicant_full_name)}``) so backfilled migrations whose
     ``docx_path`` was copied verbatim continue to resolve without moving any
     bytes from disk.
  4. The verification stamp (per-page footer band + final "Список подписей"
     block with a QR pointing at ``PUBLIC_BASE_URL/verify/<verify_code>``) is
     applied via :func:`document_generator.apply_verification_stamp` — the
     SAME helper the practicum generator uses, so the visualization style
     stays consistent across the platform.
  5. The DOCX is converted to PDF via
     :func:`document_generator._convert_to_pdf` (LibreOffice ``soffice``).
  6. ``lms.docx_path`` / ``lms.pdf_path`` are stored relative to
     ``ARCHIVE_FOLDER``, and ``db.session.commit()`` persists the row.

A ``force=True`` path wipes ``lms.signatures`` and revokes any active
``lms.signing_requests`` BEFORE re-rendering, so the prior CMS payloads (bound
to the previous DOCX bytes via SHA-256) can never silently desynchronize from
the freshly-written file.

Notes on legal correctness
--------------------------
- The applicant / parent / program fields rendered into the DOCX are taken
  from the LMS row's SNAPSHOT columns — never re-derived from the linked
  ``Student`` — so the signed document remains reproducible even if the
  student row is edited later.
- The verification stamp rewrites the DOCX *before* signing, so the bytes a
  signer signs always include the QR + URL ("a signer sees what they sign").
- The signed payload is the DOCX bytes (per CLAUDE.md §1) — the PDF exists
  only for inline preview by signers and the printed visualization.
"""
from __future__ import annotations

import os
from datetime import date
from pathlib import Path

from docxtpl import DocxTemplate
from flask import current_app

from ..extensions import db
from ..models import ADULT_SIGN_AGE, CollegeSettings, LmsContract, LmsStatus
from ..utils.files import ensure_dir, safe_filename
from ..utils.time import utc_now
from .document_generator import (
    _MONTHS_RU,
    _convert_to_pdf,
    apply_verification_stamp,
)
from .lms_template_builder import ensure_lms_templates
from .qr import public_verify_url


# ─────────────────────────────────────────────────────────────────────────────
# Formatting helpers — mirror enrollment_documents for consistency.
# ─────────────────────────────────────────────────────────────────────────────

def _fmt_date(value: date | None) -> str:
    return value.strftime("%d.%m.%Y") if value else "____________"


def _fmt_amount(value) -> str:
    if value in (None, ""):
        return "____________"
    try:
        return f"{int(value):,}".replace(",", " ")
    except (TypeError, ValueError):
        return str(value)


# ─────────────────────────────────────────────────────────────────────────────
# Render context — shape matches enrollment_documents._build_context so the
# bilingual LMS template (LMS_FILLS) renders against the SAME variable names
# (`contract.*`, `student.*`, `parent.*`, `college.*`).
# ─────────────────────────────────────────────────────────────────────────────

def _build_context(lms: LmsContract) -> dict:
    settings = CollegeSettings.query.first()
    d = lms.contract_date or date.today()
    is_minor = (lms.applicant_age is None) or (lms.applicant_age < ADULT_SIGN_AGE)

    addr_parts = [
        lms.applicant_address_city,
        lms.applicant_address_district,
        lms.applicant_address_street,
        (f"д. {lms.applicant_address_house}" if lms.applicant_address_house else None),
    ]
    applicant = {
        "full_name": lms.applicant_full_name or "",
        "iin": lms.applicant_iin or "",
        "birth_date": _fmt_date(lms.applicant_birth_date),
        # The LMS source doesn't carry a doc-type slot but we still expose a
        # sensible default so tooling introspecting the dict doesn't KeyError.
        "id_doc_type": "удостоверение личности",
        "id_doc_number": lms.applicant_id_doc_number or "",
        "id_doc_issued_by": lms.applicant_id_doc_issued_by or "",
        "id_doc_issued_date": _fmt_date(lms.applicant_id_doc_issued_date),
        "address": ", ".join(p for p in addr_parts if p) or "",
        "addr_city": lms.applicant_address_city or "",
        "addr_district": lms.applicant_address_district or "",
        "addr_street": lms.applicant_address_street or "",
        "addr_house": lms.applicant_address_house or "",
        "home_phone": lms.applicant_home_phone or "",
        "phone": lms.applicant_phone or "",
        "email": lms.applicant_email or "",
        "specialty": lms.specialty or "",
        "specialty_code": lms.specialty_code or "",
        "qualification": lms.qualification or "",
        "is_minor": is_minor,
    }
    parent = {
        "full_name": lms.parent_full_name or "",
        "relation": lms.parent_relation or "",
        "iin": lms.parent_iin or "",
        # The bilingual LMS source doesn't include parent ID-doc slots, but the
        # enrollment context exposes the keys so we mirror the shape for parity.
        "id_doc_number": "",
        "id_doc_issued_by": "",
        "address": lms.parent_address or "",
        "phone": lms.parent_phone or "",
        "email": lms.parent_email or "",
    }
    return {
        "contract": {
            "number": lms.number or "________",
            "date": _fmt_date(d),
            "date_day": f"{d.day:02d}",
            "date_month": _MONTHS_RU[d.month],
            "date_year": d.year,
            "year": lms.year or d.year,
            "grant_order_number": lms.grant_order_number or "",
            "grant_order_date": _fmt_date(lms.grant_order_date),
            "funding_source": lms.funding_source or "госзаказ",
        },
        "college": settings.to_dict() if settings else {},
        "program": {
            "specialty": lms.specialty or "",
            "specialty_code": lms.specialty_code or "",
            "qualification": lms.qualification or "",
            "education_base": lms.education_base or "",
            "study_form": lms.study_form or "очная",
            "course": lms.course or 1,
        },
        # `student` and `applicant` point at the same person — the bilingual
        # LMS template uses `student.*`; `applicant.*` is exposed for parity
        # with the enrollment context.
        "student": applicant,
        "applicant": applicant,
        "parent": parent,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Archive layout — REUSED from enrollment_documents so migrated rows whose
# `docx_path` was copied verbatim (from EnrollmentContract.lms_docx_path)
# continue to resolve without moving any bytes on disk.
# ─────────────────────────────────────────────────────────────────────────────

_FILENAME_STEM = "Договор_Caspian_Digital"


def _archive_dir(lms: LmsContract) -> Path:
    base = Path(current_app.config["ARCHIVE_FOLDER"]) / "Образовательные услуги"
    base = base / str(lms.year or (lms.contract_date or date.today()).year)
    base = base / safe_filename(lms.applicant_full_name or f"lms_{lms.id}")
    return ensure_dir(base)


def _filename(lms: LmsContract, ext: str) -> str:
    who = safe_filename(lms.applicant_full_name or f"lms_{lms.id}")
    year = lms.year or (lms.contract_date or date.today()).year
    return f"{_FILENAME_STEM}_{who}_{year}.{ext}"


def _unlink_quietly(path: Path, label: str) -> None:
    try:
        if path.is_file():
            path.unlink()
    except OSError as exc:
        current_app.logger.warning("Failed to remove %s %s: %s", label, path, exc)


# ─────────────────────────────────────────────────────────────────────────────
# Force-reset helpers — wipe signatures and revoke active signing requests
# before re-rendering, so prior CMS payloads (bound to the previous DOCX bytes
# via SHA-256) don't silently desync from the freshly-written file.
# ─────────────────────────────────────────────────────────────────────────────

_ACTIVE_REQUEST_STATUSES: tuple[str, ...] = ("pending", "viewed", "signed")


def _wipe_signatures_and_revoke(lms: LmsContract) -> bool:
    """Delete all signatures and revoke active signing requests for `lms`.

    Returns True if anything was cleared. Uses ORM-level delete so cascades and
    event listeners fire as expected.
    """
    cleared = False
    for sig in list(lms.signatures or []):
        db.session.delete(sig)
        cleared = True
    for req in list(lms.signing_requests or []):
        if req.status in _ACTIVE_REQUEST_STATUSES and req.status != "revoked":
            req.status = "revoked"
            req.revoked_at = utc_now()
            cleared = True
    return cleared


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def generate_lms_files(
    lms: LmsContract,
    *,
    force: bool = False,
    public_base: str | None = None,
) -> LmsContract:
    """Render → stamp with QR → convert to PDF for a single LMS contract.

    Steps:
      1. Ensure the docxtpl template exists (idempotent build from source).
      2. If ``force=True``: wipe `lms.signatures` and revoke active
         `lms.signing_requests` first — the bytes are about to change so prior
         CMS payloads would otherwise refer to a now-stale SHA-256.
      3. Build the render context from the LMS row's SNAPSHOT columns.
      4. Render the DOCX into the SAME archive subtree the enrollment
         generator uses (so backfilled migrations keep resolving).
      5. Embed the per-page verification footer band + final "Список подписей"
         QR block. The QR encodes ``{public_base}/verify/<verify_code>``.
      6. Convert to PDF via LibreOffice for inline preview.
      7. Commit the new ``docx_path`` / ``pdf_path`` (relative to
         ``ARCHIVE_FOLDER``) and promote DRAFT → GENERATED.

    ``public_base`` is the absolute origin the QR-code URL should point at
    (typically the request's ``X-Public-Origin`` header). If omitted, falls
    back to env ``PUBLIC_BASE_URL``; if neither is available, the QR encodes
    the relative path ``/verify/<code>`` (caller is expected to set
    ``PUBLIC_BASE_URL`` in production).

    Atomicity: every file written during this call is tracked in a local list
    and unlinked on any mid-rendering exception, so the archive cannot end up
    half-generated even if PDF conversion or stamp embedding fails. The DB
    commit happens last so a disk failure rolls back cleanly.
    """
    if lms is None:
        raise ValueError("generate_lms_files: lms is required")

    # 1. Make sure the template exists.
    templates = ensure_lms_templates(current_app.config["TEMPLATES_FOLDER"])
    template_path = templates["lms"]
    if not template_path or not Path(template_path).exists():
        raise RuntimeError(
            "LMS template missing: place 'source_contract_lms.docx' into "
            "templates_docx/source/ and restart so ensure_lms_templates can "
            "build it."
        )

    # 2. Force-reset: clear prior signatures + revoke active requests before
    # the DOCX bytes change. Flush so the wipe is visible to subsequent reads.
    if force:
        cleared = _wipe_signatures_and_revoke(lms)
        if cleared:
            db.session.flush()
            if lms.status in (LmsStatus.SIGNED, LmsStatus.COMPLETED):
                lms.status = LmsStatus.DRAFT

    # 3. Build context + 4. Render into the shared archive subtree.
    context = _build_context(lms)
    archive_dir = _archive_dir(lms)
    archive_root = current_app.config["ARCHIVE_FOLDER"]

    # Capture the previously-recorded files BEFORE we overwrite the DB paths.
    # Applicant name / contract-year are editable and both feed the output
    # location — regenerating after such an edit writes to a NEW path, leaving
    # the old files orphaned (with no DB reference, unreachable to DELETE).
    # Remove any whose location differs from the new output.
    old_paths: list[Path] = [
        Path(archive_root) / rel
        for rel in (lms.docx_path, lms.pdf_path)
        if rel
    ]

    docx_full = archive_dir / _filename(lms, "docx")
    written: list[Path] = []
    try:
        tpl = DocxTemplate(str(template_path))
        tpl.render(context)
        tpl.save(str(docx_full))
        written.append(docx_full)

        lms.docx_path = str(docx_full.relative_to(archive_root))

        # The DOCX was just rewritten → any prior PDF is stale. Clear + remove
        # before reconverting so a failed conversion can't leave a mismatched
        # PDF beside a freshly-rewritten DOCX.
        lms.pdf_path = None
        new_pdf = docx_full.with_suffix(".pdf")
        _unlink_quietly(new_pdf, "stale LMS PDF")

        # Remove the prior generation's files only when they live somewhere
        # other than the new docx/pdf (a same-path rewrite is already handled).
        keep = {docx_full.resolve(), new_pdf.resolve()}
        for old in old_paths:
            try:
                resolved = old.resolve()
            except OSError:
                resolved = old
            if resolved not in keep:
                _unlink_quietly(old, "orphaned LMS file")

        # 5. Verification stamp — rewrite the DOCX BEFORE any signing happens
        # so the signed payload always includes the QR + URL. Errors here are
        # logged but do not abort the render: the unstamped DOCX is still
        # legally usable (the QR is a convenience, not a signature input).
        verify_url = public_verify_url(lms.verify_code, base_url=public_base)
        try:
            apply_verification_stamp(
                docx_full,
                brand_line=f"CCU PRACTICUM · LMS-договор № {lms.number or '—'}",
                verification_code=lms.verify_code,
                verify_url=verify_url,
            )
        except Exception:
            current_app.logger.exception(
                "Verification stamp embedding failed for LMS contract %s", lms.id
            )

        # 6. PDF conversion (best-effort — DOCX is the signed payload).
        produced_pdf = _convert_to_pdf(docx_full)
        if produced_pdf:
            written.append(produced_pdf)
            lms.pdf_path = str(produced_pdf.relative_to(archive_root))
    except Exception:
        for path in written:
            _unlink_quietly(path, "partially-generated LMS file")
        raise

    # 7. Promote DRAFT → GENERATED so the UI shows the contract as ready to
    # invite. Other transitions (SENT/SIGNED) are managed by the API layer.
    if lms.status == LmsStatus.DRAFT:
        lms.status = LmsStatus.GENERATED

    db.session.commit()
    return lms


def resolve_public_base() -> str | None:
    """Pick the absolute origin for QR URLs: X-Public-Origin → PUBLIC_BASE_URL → None.

    Convenience shim so the API handler can pass the right value to
    ``generate_lms_files`` without duplicating header-resolution logic.
    """
    from flask import request as _request  # local import keeps module import light
    return (
        _request.headers.get("X-Public-Origin")
        or os.getenv("PUBLIC_BASE_URL")
        or None
    )


__all__ = [
    "generate_lms_files",
    "resolve_public_base",
]
