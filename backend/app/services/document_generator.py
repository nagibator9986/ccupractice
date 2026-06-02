"""Generate contract DOCX and PDF files from the configured template."""
from __future__ import annotations

import shutil
import subprocess
from datetime import date
from pathlib import Path

from docxtpl import DocxTemplate
from flask import current_app

from ..models import Contract, CollegeSettings, Partner, Student
from ..utils.files import safe_filename, ensure_dir


_MONTHS_RU = [
    "", "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
]


def _fmt_date(value: date | None) -> str:
    if not value:
        return "____________"
    return value.strftime("%d.%m.%Y")


def _build_context(contract: Contract) -> dict:
    settings: CollegeSettings = CollegeSettings.query.first()
    partner: Partner = contract.partner
    student: Student = contract.student

    d = contract.contract_date or date.today()
    return {
        "contract": {
            "number": contract.number,
            "date": _fmt_date(d),
            "date_day": f"{d.day:02d}",
            "date_month": _MONTHS_RU[d.month],
            "date_year": d.year,
            "practice_start": _fmt_date(student.practice_start),
            "practice_end": _fmt_date(student.practice_end),
        },
        "college": settings.to_dict() if settings else {},
        "partner": {
            "organization_name": partner.organization_name or "",
            "bin": partner.bin or "",
            "legal_address": partner.legal_address or "",
            "actual_address": partner.actual_address or "",
            "director_full_name": partner.director_full_name or "",
            "director_position": partner.director_position or "Директор",
            "director_basis": partner.director_basis or "Устава",
            "bank_name": partner.bank_name or "",
            "bank_bik": partner.bank_bik or "",
            "bank_iik": partner.bank_iik or "",
            "email": partner.email or "",
            "phone": partner.phone or "",
        },
        "student": {
            "full_name": student.full_name or "",
            "iin": student.iin or "",
            "group_name": student.group_name or "",
            "specialty": student.specialty or "",
            "specialty_code": student.specialty_code or "",
            "course": student.course or "",
            "education_program": student.education_program or student.specialty or "",
            "enrollment_year": student.enrollment_year or (d.year - (student.course or 1) + 1),
            "form_of_study": student.form_of_study or "очная",
            "practice_type": student.practice_type or "профессиональной",
            "practice_start": _fmt_date(student.practice_start),
            "practice_end": _fmt_date(student.practice_end),
            "birth_date": _fmt_date(student.birth_date),
            "id_card_number": student.id_card_number or "",
            "id_card_issued_by": student.id_card_issued_by or "",
            "home_address": student.home_address or "",
            "phone": student.phone or "",
            "legal_rep_full_name": student.legal_rep_full_name or "—",
            "legal_rep_iin": student.legal_rep_iin or "",
            "legal_rep_phone": student.legal_rep_phone or "",
        },
    }


def _template_path() -> Path:
    settings: CollegeSettings = CollegeSettings.query.first()
    template_name = (settings.template_path if settings else "contract_template.docx") or "contract_template.docx"
    base = Path(current_app.config["TEMPLATES_FOLDER"])
    path = base / template_name
    if not path.exists():
        from .template_builder import ensure_default_template
        ensure_default_template(base)
        path = base / "contract_template.docx"
    return path


def _archive_dir(contract: Contract) -> Path:
    base = Path(current_app.config["ARCHIVE_FOLDER"]) / "Профессиональная практика"
    base = base / str(contract.year) / safe_filename(contract.partner.organization_name) / "Договоры"
    return ensure_dir(base)


def _archive_filename(contract: Contract, ext: str) -> str:
    base = f"Договор_практика_{safe_filename(contract.partner.organization_name)}_{safe_filename(contract.student.full_name)}_{contract.year}"
    return f"{base}.{ext}"


def _convert_to_pdf(docx_path: Path) -> Path | None:
    """Best-effort DOCX -> PDF conversion using LibreOffice (`soffice`)."""
    pdf_path = docx_path.with_suffix(".pdf")
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return None
    try:
        subprocess.run(
            [soffice, "--headless", "--convert-to", "pdf", "--outdir", str(docx_path.parent), str(docx_path)],
            check=True,
            timeout=120,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return None
    return pdf_path if pdf_path.exists() else None


def generate_contract_files(contract: Contract) -> Contract:
    template = _template_path()
    archive_dir = _archive_dir(contract)

    docx_name = _archive_filename(contract, "docx")
    docx_full = archive_dir / docx_name

    tpl = DocxTemplate(str(template))
    tpl.render(_build_context(contract))
    tpl.save(str(docx_full))

    contract.docx_path = str(docx_full.relative_to(current_app.config["ARCHIVE_FOLDER"]))

    pdf_full = _convert_to_pdf(docx_full)
    if pdf_full:
        contract.pdf_path = str(pdf_full.relative_to(current_app.config["ARCHIVE_FOLDER"]))

    return contract
