from datetime import datetime
from ..extensions import db
from ..models import ContractCounter, CollegeSettings
from ..utils.time import utc_now


def next_contract_number(year: int | None = None) -> tuple[str, int, int]:
    """Atomically allocate the next contract number for the given year."""
    year = year or utc_now().year
    counter = ContractCounter.query.filter_by(year=year).with_for_update().first()
    if not counter:
        counter = ContractCounter(year=year, last_number=0)
        db.session.add(counter)
        db.session.flush()
    counter.last_number += 1
    seq = counter.last_number
    db.session.flush()

    settings = CollegeSettings.query.first()
    prefix = (settings.contract_prefix if settings else "ПП") or "ПП"
    number = f"{prefix}-{year}-{seq:03d}"
    return number, year, seq
