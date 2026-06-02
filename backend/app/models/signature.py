from datetime import datetime
from ..utils.time import utc_now
from ..extensions import db


class Signature(db.Model):
    """Electronic signature attached to a contract via NCALayer (ЭЦП)."""

    __tablename__ = "signatures"

    id = db.Column(db.Integer, primary_key=True)
    contract_id = db.Column(
        db.Integer, db.ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False
    )

    signer_role = db.Column(db.String(40), nullable=False)  # college | partner | student
    signer_full_name = db.Column(db.String(200))
    signer_iin_or_bin = db.Column(db.String(20))
    signer_serial = db.Column(db.String(80))
    signer_certificate_pem = db.Column(db.Text)

    cms_signature = db.Column(db.Text, nullable=False)  # base64-encoded CMS
    signed_payload_sha256 = db.Column(db.String(80), nullable=False)

    created_at = db.Column(db.DateTime, default=utc_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "contract_id": self.contract_id,
            "signer_role": self.signer_role,
            "signer_full_name": self.signer_full_name,
            "signer_iin_or_bin": self.signer_iin_or_bin,
            "signer_serial": self.signer_serial,
            "signed_payload_sha256": self.signed_payload_sha256,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
