from ..utils.time import utc_now
from ..extensions import db


class Specialty(db.Model):
    """Reference-data entry for a study specialty.

    A single row bundles the three values that always travel together on a
    contract — the specialty name, its official code and the resulting
    qualification — so an operator picks one item from the «Данные» dictionary
    and the contract form auto-fills all three. The fields on the contract
    itself stay free-text, so a one-off specialty can still be typed by hand;
    this table is just a convenience source for the picker.
    """

    __tablename__ = "specialties"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False, index=True)  # специальность
    code = db.Column(db.String(60))                               # код специальности
    qualification = db.Column(db.String(200))                     # квалификация
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    sort_order = db.Column(db.Integer, default=0, nullable=False)

    created_at = db.Column(db.DateTime, default=utc_now)
    updated_at = db.Column(db.DateTime, default=utc_now, onupdate=utc_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "code": self.code,
            "qualification": self.qualification,
            "is_active": self.is_active,
            "sort_order": self.sort_order,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
