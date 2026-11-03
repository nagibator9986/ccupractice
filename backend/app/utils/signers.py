"""Who signs for the student's side of a practice contract.

A student under 16 (the same threshold the enrollment flow uses, ``ADULT_SIGN_AGE``) is
represented by a parent / legal representative; everyone else signs for themselves. The age is
taken ON THE CONTRACT DATE from the birth date, falling back to the date encoded in the ИИН.
Kept in one place — never re-derive it elsewhere (see CLAUDE.md §1, same rule as
``signing_matrix`` for enrollments).
"""
from __future__ import annotations

from datetime import date

from .iin import birth_date_from_iin, normalize_iin
from .time import utc_today

CAPACITY_SELF = "self"
CAPACITY_REP = "legal_representative"

BASE_ROLE_LABELS = {
    "college": "Колледж (организация образования)",
    "partner": "Предприятие",
    "student": "Обучающийся",
}
REP_LABEL = "Законный представитель обучающегося"


def birth_date_of(student) -> date | None:
    if student is None:
        return None
    if student.birth_date:
        return student.birth_date
    return birth_date_from_iin(normalize_iin(student.iin), utc_today())[0]


def age_on(student, on_date: date | None = None) -> int | None:
    born = birth_date_of(student)
    if born is None:
        return None
    ref = on_date or utc_today()
    return ref.year - born.year - ((ref.month, ref.day) < (born.month, born.day))


def student_capacity(student, on_date: date | None = None) -> str:
    """``legal_representative`` for a known age below 16, else ``self`` (unknown age → self,
    and the readiness check asks for the birth date)."""
    from ..models.enrollment import ADULT_SIGN_AGE

    age = age_on(student, on_date)
    return CAPACITY_REP if age is not None and age < ADULT_SIGN_AGE else CAPACITY_SELF


def role_label(role: str, capacity: str = CAPACITY_SELF) -> str:
    if role == "student" and capacity == CAPACITY_REP:
        return REP_LABEL
    return BASE_ROLE_LABELS.get(role, role)
