"""Import grant («госзаказ») applicants from the ministry's XLSX export.

The College receives the awarded-grant list as a workbook with one sheet per
group (`ГБ`, `МГК`, `МГР`, `МР`, `ПО`, `ТК`, `ТР`) and the columns
`ФИО · ИИН · Специальность · Квалификация · Язык обучения · База обучения ·
Квота · Статус`. This script turns each row into a `Student` with
`is_grant_student = True`, which is exactly the flag
`GET /api/lms-contracts/grant-students` filters on — so every imported
applicant becomes selectable in the «Новый LMS-договор» modal.

Why the hand-rolled XLSX reader: the backend has no spreadsheet dependency and
this script must run on the Railway image too, so the workbook is parsed with
`zipfile` + `ElementTree` (SpreadsheetML is just zipped XML). No new package.

Birth date matters: `lms_signing_matrix()` returns `{}` when the applicant's
age is unknown, which blocks inviting a signer, and the age decides *who*
signs (< 16 → parent, ≥ 16 → the applicant). It is derived from the ИИН
(`YYMMDD` + a century digit), so the imported rows are immediately signable.

The script is idempotent — matching is on the unique `students.iin`, so a
re-run with a refreshed export updates the existing rows instead of
duplicating them.

Usage:
    cd backend && . .venv/bin/activate
    python import_grant_students.py [--file PATH] [--year 2026] [--dry-run]

Against production, point `DATABASE_URL` at the Railway Postgres first.
"""
from __future__ import annotations

import argparse
import re
import sys
import zipfile
from datetime import date
from pathlib import Path
from xml.etree import ElementTree as ET

from app import create_app
from app.extensions import db
from app.models import Specialty, Student
from app.utils.time import utc_today

# ─────────────────────────────────────────────────────────────────────────────
# Minimal XLSX reader (SpreadsheetML → rows of {header: value})
# ─────────────────────────────────────────────────────────────────────────────

_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_COL_RE = re.compile(r"\d+")


def _cell_text(cell, shared: list[str]) -> str:
    """Resolve one `<c>` element to text (shared-string, inline or literal)."""
    inline = cell.find(_NS + "is")
    if inline is not None:
        return "".join(t.text or "" for t in inline.iter(_NS + "t")).strip()
    value = cell.find(_NS + "v")
    if value is None or value.text is None:
        return ""
    if cell.get("t") == "s":
        try:
            return shared[int(value.text)].strip()
        except (ValueError, IndexError):
            return ""
    return value.text.strip()


def read_sheets(path: Path) -> list[tuple[str, list[dict[str, str]]]]:
    """Return `[(sheet_name, [{header: value}, ...]), ...]`.

    The header is the first row that carries a `ФИО` cell, so a sheet with a
    leading title/blank row parses the same as one without.
    """
    with zipfile.ZipFile(path) as z:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            shared = [
                "".join(t.text or "" for t in si.iter(_NS + "t"))
                for si in ET.fromstring(z.read("xl/sharedStrings.xml"))
            ]
        rels = {
            r.get("Id"): r.get("Target")
            for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        }
        book = ET.fromstring(z.read("xl/workbook.xml"))

        sheets: list[tuple[str, list[dict[str, str]]]] = []
        for sheet in book.iter(_NS + "sheet"):
            target = rels.get(sheet.get(_REL + "id")) or ""
            data = z.read("xl/" + target.lstrip("/"))
            raw: list[dict[str, str]] = []
            for row in ET.fromstring(data).iter(_NS + "row"):
                cells = {}
                for cell in row:
                    ref = cell.get("r") or ""
                    cells[_COL_RE.sub("", ref)] = _cell_text(cell, shared)
                raw.append(cells)

            header_idx = next(
                (i for i, r in enumerate(raw) if "ФИО" in r.values()), None
            )
            if header_idx is None:
                continue
            # {header text: column letter} — value lookups go through the label,
            # so a column added or moved upstream doesn't shift the mapping.
            header = {v: k for k, v in raw[header_idx].items() if v}
            rows = [
                {name: r.get(col, "") for name, col in header.items()}
                for r in raw[header_idx + 1:]
                if (r.get(header.get("ФИО", ""), "") or "").strip()
            ]
            sheets.append((sheet.get("name") or "", rows))
        return sheets


# ─────────────────────────────────────────────────────────────────────────────
# ИИН helpers
# ─────────────────────────────────────────────────────────────────────────────

_IIN_W1 = list(range(1, 12))
_IIN_W2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2]
# 7th digit: century + sex. 1/2 → 18xx, 3/4 → 19xx, 5/6 → 20xx.
_CENTURY = {"1": 1800, "2": 1800, "3": 1900, "4": 1900, "5": 2000, "6": 2000}


def normalize_iin(value: str) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def iin_checksum_ok(iin: str) -> bool:
    """Standard KZ ИИН control digit (weights w1, falling back to w2 on 10)."""
    if len(iin) != 12 or not iin.isdigit():
        return False
    digits = [int(c) for c in iin]
    total = sum(a * b for a, b in zip(digits[:11], _IIN_W1)) % 11
    if total == 10:
        total = sum(a * b for a, b in zip(digits[:11], _IIN_W2)) % 11
        if total == 10:
            return False
    return total == digits[11]


def birth_date_from_iin(iin: str, today: date) -> tuple[date | None, bool]:
    """Derive the birth date from an ИИН. Returns `(date, century_inferred)`.

    The century digit is authoritative when it is valid (1–6). A few ministry
    rows carry `0` there; rather than dropping the birth date (which would
    leave the applicant un-invitable and hide who must sign), the century is
    inferred as the one that yields a plausible applicant age — and the caller
    reports every inferred row so it can be checked by hand.
    """
    if len(iin) != 12 or not iin.isdigit():
        return None, False
    yy, mm, dd = int(iin[0:2]), int(iin[2:4]), int(iin[4:6])

    def _make(century: int) -> date | None:
        try:
            return date(century + yy, mm, dd)
        except ValueError:
            return None

    marker = iin[6]
    if marker in _CENTURY:
        return _make(_CENTURY[marker]), False

    for century in (2000, 1900):
        candidate = _make(century)
        if candidate is None:
            continue
        age = today.year - candidate.year - (
            (today.month, today.day) < (candidate.month, candidate.day)
        )
        if 13 <= age <= 70:
            return candidate, True
    return None, False


# ─────────────────────────────────────────────────────────────────────────────
# Import
# ─────────────────────────────────────────────────────────────────────────────

NOTES_MARKER = "Импорт списка грантников"

_DEFAULT_GLOB = "Список абитуриентов получивших грант*.xlsx"


def default_source() -> Path | None:
    """The ministry export lives next to the repo; take the newest match."""
    root = Path(__file__).resolve().parents[2]
    matches = sorted(root.glob(_DEFAULT_GLOB))
    return matches[-1] if matches else None


def build_notes(group: str, row: dict[str, str], year: int) -> str:
    parts = [f"{NOTES_MARKER} {year} · группа {group}"]
    for label, key in (
        ("квалификация", "Квалификация"),
        ("язык обучения", "Язык обучения"),
        ("база", "База обучения"),
        ("статус", "Статус"),
        ("код заявки", "Код заявки"),
        ("квота", "Квота"),
    ):
        value = (row.get(key) or "").strip()
        if value:
            parts.append(f"{label}: {value}")
    return " · ".join(parts)


def seed_specialties(sheets, *, verbose: bool = True) -> int:
    """Add the (специальность, квалификация) pairs seen in the export to the
    «Данные» dictionary, so `SpecialtyPicker` can fill both fields on the LMS
    contract in one click. Codes stay blank — the official classifier code is
    not in the export and must not be invented into a legal document.
    """
    pairs: dict[str, str] = {}
    for _group, rows in sheets:
        for row in rows:
            name = (row.get("Специальность") or "").strip()
            if name and name not in pairs:
                pairs[name] = (row.get("Квалификация") or "").strip()

    created = 0
    for order, (name, qualification) in enumerate(sorted(pairs.items())):
        if Specialty.query.filter_by(name=name).first():
            continue
        db.session.add(
            Specialty(
                name=name[:200],
                qualification=(qualification or None) and qualification[:200],
                is_active=True,
                sort_order=order,
            )
        )
        created += 1
        if verbose:
            print(f"  + справочник: {name} → {qualification or '—'}")
    return created


def import_students(sheets, *, year: int, verbose: bool = True) -> dict:
    today = utc_today()
    stats = {
        "rows": 0, "created": 0, "updated": 0, "unchanged": 0,
        "no_birth_date": [], "inferred_century": [], "bad_iin": [],
        "duplicate_iin": [],
    }
    seen: dict[str, str] = {}

    for group, rows in sheets:
        for row in rows:
            stats["rows"] += 1
            full_name = (row.get("ФИО") or "").strip()
            iin = normalize_iin(row.get("ИИН"))
            specialty = (row.get("Специальность") or "").strip()

            if iin and not iin_checksum_ok(iin):
                stats["bad_iin"].append(f"{group}: {full_name} — {iin}")
            if iin and iin in seen:
                stats["duplicate_iin"].append(
                    f"{iin}: {seen[iin]} ↔ {group}/{full_name}"
                )
                continue
            if iin:
                seen[iin] = f"{group}/{full_name}"

            birth_date, inferred = birth_date_from_iin(iin, today)
            if birth_date is None:
                stats["no_birth_date"].append(f"{group}: {full_name} — {iin or '—'}")
            elif inferred:
                stats["inferred_century"].append(
                    f"{group}: {full_name} — {iin} → {birth_date.isoformat()}"
                )

            student = Student.query.filter_by(iin=iin).first() if iin else None
            if student is None:
                # Without an ИИН there is no stable key — fall back to the
                # (name, group) pair so a re-run still updates in place.
                student = Student.query.filter_by(
                    full_name=full_name, group_name=group
                ).first()
            is_new = student is None
            if is_new:
                student = Student(full_name=full_name, iin=iin or None)
                db.session.add(student)

            before = _snapshot(student)

            # Authoritative from the ministry export.
            student.full_name = full_name[:200]
            if iin:
                student.iin = iin
            student.group_name = group[:60]
            student.specialty = specialty[:200] or student.specialty
            if birth_date:
                student.birth_date = birth_date
            student.is_grant_student = True

            # Fill-only: never clobber an admin's manual correction.
            if not student.education_program and specialty:
                student.education_program = specialty[:300]
            if not student.course:
                student.course = 1
            if not student.enrollment_year:
                student.enrollment_year = year
            if not student.form_of_study:
                student.form_of_study = "очная"
            # Notes are refreshed only while they are still the import blob.
            if not student.notes or student.notes.startswith(NOTES_MARKER):
                student.notes = build_notes(group, row, year)

            if is_new:
                stats["created"] += 1
            elif _snapshot(student) != before:
                stats["updated"] += 1
            else:
                stats["unchanged"] += 1

    if verbose:
        print(
            f"  строк: {stats['rows']} · создано: {stats['created']} · "
            f"обновлено: {stats['updated']} · без изменений: {stats['unchanged']}"
        )
    return stats


def _snapshot(student: Student) -> tuple:
    return (
        student.full_name, student.iin, student.group_name, student.specialty,
        student.birth_date, bool(student.is_grant_student),
        student.education_program, student.course, student.enrollment_year,
        student.form_of_study, student.notes,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, default=None, help="путь к .xlsx")
    parser.add_argument(
        "--year", type=int, default=None, help="год зачисления (по умолчанию текущий)"
    )
    parser.add_argument(
        "--no-specialties", action="store_true",
        help="не добавлять специальности в справочник «Данные»",
    )
    parser.add_argument("--dry-run", action="store_true", help="ничего не сохранять")
    args = parser.parse_args(argv)

    source = args.file or default_source()
    if source is None or not source.exists():
        print(f"Файл не найден: {source or _DEFAULT_GLOB}", file=sys.stderr)
        return 2

    print(f"Источник: {source}")
    sheets = read_sheets(source)
    if not sheets:
        print("В книге не найдено ни одного листа с колонкой «ФИО»", file=sys.stderr)
        return 2
    print(
        "Листы: "
        + ", ".join(f"{name} ({len(rows)})" for name, rows in sheets)
    )

    app = create_app()
    with app.app_context():
        year = args.year or utc_today().year
        specialties_added = 0 if args.no_specialties else seed_specialties(sheets)
        stats = import_students(sheets, year=year)

        for title, key in (
            ("Некорректная контрольная сумма ИИН", "bad_iin"),
            ("Дубли ИИН в файле (пропущены)", "duplicate_iin"),
            ("Век рождения определён по возрасту — проверьте вручную", "inferred_century"),
            ("Дата рождения не определена (подписант неизвестен)", "no_birth_date"),
        ):
            items = stats[key]
            if items:
                print(f"\n⚠ {title}: {len(items)}")
                for line in items:
                    print(f"    {line}")

        if args.dry_run:
            db.session.rollback()
            print("\n--dry-run: изменения откачены.")
            return 0

        db.session.commit()
        total_grant = Student.query.filter_by(is_grant_student=True).count()
        print(
            f"\n✓ Сохранено. Специальностей в справочник: {specialties_added}. "
            f"Студентов с флагом «Грантник»: {total_grant} — "
            f"все они видны в списке «Студент-грантник» при создании LMS-договора."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
