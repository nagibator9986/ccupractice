import secrets
from datetime import timedelta

from ..extensions import db
from ..utils.time import utc_now


def _token() -> str:
    return secrets.token_urlsafe(32)


class EgovSignSession(db.Model):
    """One QR / deep-link signing attempt through the eGov mobile app.

    The phone calls our public API with ``secret`` in the URL (API №1) and with
    ``auth_token`` as a Bearer token (API №2). Both are single-purpose and die with
    the session. ``payload_sha256`` pins the exact PDF offered for signing, so a
    regeneration between "scan" and "confirm" cannot slip a different document
    under the signature.
    """

    __tablename__ = "egov_sign_sessions"

    id = db.Column(db.Integer, primary_key=True)
    signing_request_id = db.Column(
        db.Integer, db.ForeignKey("signing_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    secret = db.Column(db.String(64), unique=True, nullable=False, index=True, default=_token)
    auth_token = db.Column(db.String(64), nullable=False, default=_token)
    payload_sha256 = db.Column(db.String(64), nullable=False)
    # Public origin the SIGNER'S BROWSER used (X-Public-Origin). The phone calls us
    # without that header — and behind a proxy `request.host_url` says http — so the
    # URLs handed back to the app are built from this, fixed at session creation.
    base_url = db.Column(db.String(300), nullable=False)

    # pending → opened (phone fetched API №1) → signed | failed | expired | cancelled
    status = db.Column(db.String(12), nullable=False, default="pending")
    error = db.Column(db.Text)

    created_at = db.Column(db.DateTime, default=utc_now, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    opened_at = db.Column(db.DateTime)
    signed_at = db.Column(db.DateTime)
    signature_id = db.Column(db.Integer, db.ForeignKey("signatures.id", ondelete="SET NULL"))

    signing_request = db.relationship(
        "SigningRequest", backref=db.backref("egov_sessions", lazy=True, cascade="all, delete-orphan")
    )

    @staticmethod
    def new_expiry(minutes: int):
        return utc_now() + timedelta(minutes=minutes)

    @property
    def is_expired(self) -> bool:
        return bool(self.expires_at and self.expires_at < utc_now())

    def to_public_dict(self) -> dict:
        status = "expired" if self.status in ("pending", "opened") and self.is_expired else self.status
        return {
            "id": self.id,
            "status": status,
            "error": self.error,
            # Naive UTC in the DB; the trailing Z makes browsers read it as UTC, not local time.
            "expires_at": (self.expires_at.isoformat() + "Z") if self.expires_at else None,
        }
