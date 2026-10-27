"""Is there enough data to generate a legally meaningful practice contract?

``critical`` fields are the ones whose absence leaves a blank in the legal text
that identifies a party or the practice period (a contract with no ИИН or no
dates cannot be signed in good faith). ``recommended`` fields are printed in the
contract too but a blank there is survivable.

The UI shows the list as a checklist with a link to the record to fix; the
generate endpoint refuses a contract with critical gaps unless the operator
explicitly passes ``allow_incomplete``.
"""
from __future__ import annotations

from ..models import CollegeSettings, Partner, Student

# (scope, attribute, label)
CRITICAL: tuple[tuple[str, str, str], ...] = (
    ("student", "full_name", "ФИО студента"),
    ("student", "iin", "ИИН студента"),
    ("student", "practice_start", "Дата начала практики"),
    ("student", "practice_end", "Дата окончания практики"),
    ("partner", "organization_name", "Наименование предприятия"),
    ("partner", "bin", "БИН предприятия"),
    ("partner", "director_full_name", "ФИО руководителя предприятия"),
    ("partner", "legal_address", "Юридический адрес предприятия"),
)

RECOMMENDED: tuple[tuple[str, str, str], ...] = (
    ("student", "group_name", "Группа студента"),
    ("student", "specialty", "Специальность"),
    ("student", "specialty_code", "Код специальности"),
    ("student", "birth_date", "Дата рождения студента"),
    ("student", "phone", "Телефон студента"),
    ("student", "id_card_number", "№ удостоверения личности студента"),
    ("student", "home_address", "Домашний адрес студента"),
    ("partner", "director_position", "Должность руководителя предприятия"),
    ("partner", "director_basis", "Основание действия руководителя"),
    ("partner", "bank_name", "Банк предприятия"),
    ("partner", "bank_iik", "ИИК предприятия"),
)


def _blank(value) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def check_readiness(student: Student | None, partner: Partner | None) -> dict:
    """Return ``{ok, critical, recommended, missing: [...]}``.

    ``ok`` means no CRITICAL gap. Each missing entry carries the owning record
    id so the SPA can deep-link to it.
    """
    missing: list[dict] = []

    def _scan(items, severity: str) -> None:
        for scope, attr, label in items:
            obj = student if scope == "student" else partner
            if obj is None:
                missing.append({"scope": scope, "field": attr, "label": label,
                                "severity": severity, "entity_id": None})
            elif _blank(getattr(obj, attr, None)):
                missing.append({"scope": scope, "field": attr, "label": label,
                                "severity": severity, "entity_id": obj.id})

    _scan(CRITICAL, "critical")
    _scan(RECOMMENDED, "recommended")

    settings = CollegeSettings.query.first()
    if settings is None or _blank(settings.director_full_name):
        missing.append({"scope": "college", "field": "director_full_name",
                        "label": "ФИО директора колледжа (Настройки)",
                        "severity": "critical", "entity_id": None})

    critical = sum(1 for m in missing if m["severity"] == "critical")
    return {
        "ok": critical == 0,
        "critical": critical,
        "recommended": len(missing) - critical,
        "missing": missing,
    }
