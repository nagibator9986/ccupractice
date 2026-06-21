import base64
import hashlib
from datetime import datetime
from ..utils.time import utc_now
import bcrypt
from ..extensions import db

# Marks a hash whose password was SHA-256-prehashed before bcrypt. bcrypt
# silently truncates input at 72 bytes, so multibyte (Cyrillic) passphrases lose
# entropy; pre-hashing to a fixed 44-byte, NUL-free token avoids that. Legacy
# rows (no prefix) keep verifying via the raw-password path for back-compat.
_SHA256_PREFIX = "$sha256$"


def _prehash(password: str) -> bytes:
    return base64.b64encode(hashlib.sha256(password.encode("utf-8")).digest())


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(160), unique=True, nullable=False, index=True)
    full_name = db.Column(db.String(200), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default="viewer")  # admin | viewer
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=utc_now)

    def set_password(self, password: str) -> None:
        hashed = bcrypt.hashpw(_prehash(password), bcrypt.gensalt()).decode("utf-8")
        self.password_hash = _SHA256_PREFIX + hashed

    def check_password(self, password: str) -> bool:
        try:
            stored = self.password_hash or ""
            if stored.startswith(_SHA256_PREFIX):
                return bcrypt.checkpw(
                    _prehash(password), stored[len(_SHA256_PREFIX):].encode("utf-8")
                )
            # Legacy hash (raw password) — verify with the old path.
            return bcrypt.checkpw(password.encode("utf-8"), stored.encode("utf-8"))
        except Exception:
            return False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "email": self.email,
            "full_name": self.full_name,
            "role": self.role,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
