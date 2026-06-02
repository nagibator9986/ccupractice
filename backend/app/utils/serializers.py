from datetime import date, datetime
from flask import request


def parse_date(value):
    """Parse YYYY-MM-DD into date; empty string and None → None."""
    if value in (None, "", "null"):
        return None
    if isinstance(value, (date, datetime)):
        return value if isinstance(value, date) and not isinstance(value, datetime) else value.date()
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def parse_int(value):
    """Tolerant int parser: '', None, 'abc', 'null' → None."""
    if value in (None, "", "null"):
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def parse_positive_int(value, *, minimum: int = 0, default=None):
    """Parse int and clamp at >= minimum. Return default if unparseable."""
    n = parse_int(value)
    if n is None:
        return default
    return max(minimum, n)


def clean_str(value, *, max_len: int | None = None):
    """Strip strings; convert empty string to None. Truncate to max_len."""
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    s = value.strip()
    if not s:
        return None
    if max_len is not None and len(s) > max_len:
        s = s[:max_len]
    return s


def get_json_safe() -> dict:
    """Get JSON body without raising 400 on empty / non-JSON request."""
    return request.get_json(silent=True) or {}
