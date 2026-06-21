from datetime import datetime
from ..utils.time import utc_now
from ..extensions import db


class Partner(db.Model):
    __tablename__ = "partners"

    id = db.Column(db.Integer, primary_key=True)
    organization_name = db.Column(db.String(300), nullable=False, index=True)
    bin = db.Column(db.String(20), unique=True, index=True)
    legal_address = db.Column(db.String(500))
    actual_address = db.Column(db.String(500))
    director_full_name = db.Column(db.String(200))
    director_position = db.Column(db.String(200))
    director_basis = db.Column(db.String(300))  # "на основании Устава" и т.д.
    contact_person = db.Column(db.String(200))
    phone = db.Column(db.String(60))
    email = db.Column(db.String(160))
    specialty = db.Column(db.String(200))  # направление/специальность
    seats_count = db.Column(db.Integer, default=0)
    contract_status = db.Column(db.String(40), default="active")
    contract_valid_until = db.Column(db.Date)
    bank_name = db.Column(db.String(200))
    bank_bik = db.Column(db.String(40))
    bank_iik = db.Column(db.String(50))
    notes = db.Column(db.Text)

    created_at = db.Column(db.DateTime, default=utc_now)
    updated_at = db.Column(db.DateTime, default=utc_now, onupdate=utc_now)

    students = db.relationship("Student", backref="partner", lazy=True)
    contracts = db.relationship("Contract", backref="partner", lazy=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "organization_name": self.organization_name,
            "bin": self.bin,
            "legal_address": self.legal_address,
            "actual_address": self.actual_address,
            "director_full_name": self.director_full_name,
            "director_position": self.director_position,
            "director_basis": self.director_basis,
            "contact_person": self.contact_person,
            "phone": self.phone,
            "email": self.email,
            "specialty": self.specialty,
            "seats_count": self.seats_count,
            "contract_status": self.contract_status,
            "contract_valid_until": self.contract_valid_until.isoformat()
            if self.contract_valid_until
            else None,
            "bank_name": self.bank_name,
            "bank_bik": self.bank_bik,
            "bank_iik": self.bank_iik,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
