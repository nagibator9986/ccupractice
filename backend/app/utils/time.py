"""Centralized time helpers.

`datetime.utcnow()` is deprecated as of Python 3.12 and will be removed in a
future release. We return a naive UTC datetime (no tzinfo) to keep schema
compatibility with existing SQLite rows while staying forward-compatible.
"""
from datetime import date, datetime, timezone


def utc_now() -> datetime:
    """Return current UTC time as a naive datetime (matching prior utcnow())."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def utc_today() -> date:
    """Today's date in UTC. Use as default for `Date` columns."""
    return utc_now().date()
