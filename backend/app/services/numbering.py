from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from ..extensions import db
from ..models import ContractCounter, CollegeSettings
from ..utils.time import utc_now


def next_contract_number(year: int | None = None) -> tuple[str, int, int]:
    """Allocate the next contract number for the given year.

    Allocation uses a single in-DB ``UPDATE ... last_number = last_number + 1``
    so concurrent callers can never read the same value — the default SQLite
    engine ignores ``SELECT ... FOR UPDATE``, so we must not rely on it. The
    per-year counter row is created defensively; a race on the very first
    contract of a new year is resolved by the UNIQUE(year) constraint + retry.
    """
    year = year or utc_now().year

    # Ensure the per-year counter row exists.
    if ContractCounter.query.filter_by(year=year).first() is None:
        try:
            db.session.add(ContractCounter(year=year, last_number=0))
            db.session.flush()
        except IntegrityError:
            db.session.rollback()

    # Atomic increment at the DB level (works on both SQLite and Postgres).
    db.session.execute(
        text("UPDATE contract_counters SET last_number = last_number + 1 WHERE year = :y"),
        {"y": year},
    )
    seq = db.session.execute(
        text("SELECT last_number FROM contract_counters WHERE year = :y"),
        {"y": year},
    ).scalar_one()

    settings = CollegeSettings.query.first()
    prefix = (settings.contract_prefix if settings else "ПП") or "ПП"
    number = f"{prefix}-{year}-{seq:03d}"
    return number, year, seq
