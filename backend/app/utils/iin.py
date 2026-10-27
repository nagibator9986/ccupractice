"""ИИН (Kazakhstan individual identification number) helpers.

Shared by the grant-applicant importer (`import_grant_students.py`) and the
practice-student Excel import so both agree on what a valid ИИН is and how the
birth date is derived from it.
"""
from __future__ import annotations

from datetime import date

_IIN_W1 = list(range(1, 12))
_IIN_W2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2]
# 7th digit: century + sex. 1/2 → 18xx, 3/4 → 19xx, 5/6 → 20xx.
_CENTURY = {"1": 1800, "2": 1800, "3": 1900, "4": 1900, "5": 2000, "6": 2000}


def normalize_iin(value) -> str:
    """Digits only. Accepts str/int/float (Excel hands numeric cells as floats)."""
    if value is None:
        return ""
    if isinstance(value, float):
        # 5.1e11 style floats from a numeric cell: render without exponent.
        if value != value or value in (float("inf"), float("-inf")):
            return ""
        value = int(value)
    return "".join(ch for ch in str(value) if ch.isdigit())


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
    """Derive the birth date from an ИИН. Returns ``(date, century_inferred)``.

    The century digit is authoritative when it is valid (1–6). A few ministry
    rows carry ``0`` there; rather than dropping the birth date the century is
    inferred as the one that yields a plausible student age, and the caller
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
