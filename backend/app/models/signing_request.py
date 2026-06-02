import secrets
from datetime import datetime, timedelta
from ..utils.time import utc_now
from ..extensions import db


class SigningRequest(db.Model):
    """One-time signing invitation for a party (partner / student / college).

    Each contract spawns up to three SigningRequest rows — one per party.
    Public URL `/sign/<token>` opens a tokenized page where the recipient can
    review the document and sign it with NCALayer. No login is required.
    """

    __tablename__ = "signing_requests"

    id = db.Column(db.Integer, primary_key=True)
    contract_id = db.Column(
        db.Integer, db.ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    signer_role = db.Column(db.String(20), nullable=False)  # college | partner | student
    recipient_name = db.Column(db.String(200))
    recipient_email = db.Column(db.String(160))
    recipient_iin_or_bin = db.Column(db.String(20))

    token = db.Column(db.String(64), unique=True, nullable=False, index=True)
    status = db.Column(db.String(20), default="pending", nullable=False)
    # pending | viewed | signed | revoked

    viewed_at = db.Column(db.DateTime)
    signed_at = db.Column(db.DateTime)
    revoked_at = db.Column(db.DateTime)

    signature_id = db.Column(db.Integer, db.ForeignKey("signatures.id", ondelete="SET NULL"))

    created_at = db.Column(db.DateTime, default=utc_now)
    expires_at = db.Column(db.DateTime)

    contract = db.relationship("Contract", backref=db.backref("signing_requests", lazy=True, cascade="all, delete-orphan"))
    signature = db.relationship("Signature", uselist=False)

    @staticmethod
    def generate_token() -> str:
        return secrets.token_urlsafe(32)

    @classmethod
    def create_for(cls, contract_id: int, signer_role: str, recipient: dict, ttl_days: int = 30) -> "SigningRequest":
        sr = cls(
            contract_id=contract_id,
            signer_role=signer_role,
            recipient_name=recipient.get("name"),
            recipient_email=recipient.get("email"),
            recipient_iin_or_bin=recipient.get("iin_or_bin"),
            token=cls.generate_token(),
            expires_at=utc_now() + timedelta(days=ttl_days),
        )
        return sr

    @property
    def is_expired(self) -> bool:
        return bool(self.expires_at and self.expires_at < utc_now())

    def to_dict(self, include_token: bool = False, public_base_url: str | None = None) -> dict:
        data = {
            "id": self.id,
            "contract_id": self.contract_id,
            "signer_role": self.signer_role,
            "recipient_name": self.recipient_name,
            "recipient_email": self.recipient_email,
            "recipient_iin_or_bin": self.recipient_iin_or_bin,
            "status": self.status,
            "viewed_at": self.viewed_at.isoformat() if self.viewed_at else None,
            "signed_at": self.signed_at.isoformat() if self.signed_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "expired": self.is_expired,
        }
        if include_token:
            data["token"] = self.token
            if public_base_url:
                data["sign_url"] = f"{public_base_url.rstrip('/')}/sign/{self.token}"
            else:
                data["sign_url"] = f"/sign/{self.token}"
        return data
