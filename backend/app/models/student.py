from datetime import datetime

import sqlalchemy as sa

from ..utils.time import utc_now
from ..extensions import db


class Student(db.Model):
    __tablename__ = "students"

    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(200), nullable=False, index=True)
    iin = db.Column(db.String(20), unique=True, index=True)
    group_name = db.Column(db.String(60), index=True)
    specialty = db.Column(db.String(200))
    course = db.Column(db.Integer)
    practice_start = db.Column(db.Date)
    practice_end = db.Column(db.Date)

    college_supervisor = db.Column(db.String(200))
    partner_supervisor = db.Column(db.String(200))
    partner_id = db.Column(db.Integer, db.ForeignKey("partners.id"))

    birth_date = db.Column(db.Date)
    id_card_number = db.Column(db.String(60))
    id_card_issued_by = db.Column(db.String(200))
    home_address = db.Column(db.String(300))
    phone = db.Column(db.String(60))

    legal_rep_full_name = db.Column(db.String(200))
    legal_rep_iin = db.Column(db.String(20))
    legal_rep_phone = db.Column(db.String(60))

    education_program = db.Column(db.String(300))
    specialty_code = db.Column(db.String(60))
    enrollment_year = db.Column(db.Integer)
    practice_type = db.Column(db.String(120), default="профессиональной")
    form_of_study = db.Column(db.String(60), default="очная")

    # Grant ("госзаказ") flag — gates standalone LMS-contract creation. Toggled
    # from the Students page by an admin; the API additionally enforces a CHECK
    # constraint at the LmsContract level so a non-grant row can never persist.
    is_grant_student = db.Column(
        db.Boolean,
        nullable=False,
        default=False,
        # ``sa.false()`` emits ``DEFAULT false`` on Postgres (which rejects the
        # bare integer literal on a BOOLEAN column) AND ``DEFAULT 0`` on SQLite
        # — same column declaration, dialect-correct DDL.
        server_default=sa.false(),
        index=True,
    )

    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=utc_now)
    updated_at = db.Column(db.DateTime, default=utc_now, onupdate=utc_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "full_name": self.full_name,
            "iin": self.iin,
            "group_name": self.group_name,
            "specialty": self.specialty,
            "course": self.course,
            "practice_start": self.practice_start.isoformat() if self.practice_start else None,
            "practice_end": self.practice_end.isoformat() if self.practice_end else None,
            "college_supervisor": self.college_supervisor,
            "partner_supervisor": self.partner_supervisor,
            "partner_id": self.partner_id,
            "partner_name": self.partner.organization_name if self.partner else None,
            "birth_date": self.birth_date.isoformat() if self.birth_date else None,
            "id_card_number": self.id_card_number,
            "id_card_issued_by": self.id_card_issued_by,
            "home_address": self.home_address,
            "phone": self.phone,
            "legal_rep_full_name": self.legal_rep_full_name,
            "legal_rep_iin": self.legal_rep_iin,
            "legal_rep_phone": self.legal_rep_phone,
            "education_program": self.education_program,
            "specialty_code": self.specialty_code,
            "enrollment_year": self.enrollment_year,
            "practice_type": self.practice_type,
            "form_of_study": self.form_of_study,
            "is_grant_student": bool(self.is_grant_student),
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
