from ..utils.time import utc_now, utc_today
from ..extensions import db


class ContractStatus:
    DRAFT = "draft"
    GENERATED = "generated"
    SENT = "sent"
    SIGNED = "signed"
    SCAN_UPLOADED = "scan_uploaded"
    COMPLETED = "completed"

    ALL = (DRAFT, GENERATED, SENT, SIGNED, SCAN_UPLOADED, COMPLETED)

    LABELS = {
        DRAFT: "Черновик",
        GENERATED: "Сформирован",
        SENT: "Отправлен партнеру",
        SIGNED: "Подписан",
        SCAN_UPLOADED: "Скан загружен",
        COMPLETED: "Завершен",
    }


class Contract(db.Model):
    __tablename__ = "contracts"

    id = db.Column(db.Integer, primary_key=True)
    number = db.Column(db.String(40), unique=True, nullable=False, index=True)
    year = db.Column(db.Integer, nullable=False, index=True)
    contract_date = db.Column(db.Date, default=utc_today, nullable=False)

    partner_id = db.Column(db.Integer, db.ForeignKey("partners.id"), nullable=False)
    student_id = db.Column(db.Integer, db.ForeignKey("students.id"), nullable=False)

    docx_path = db.Column(db.String(500))
    pdf_path = db.Column(db.String(500))
    signed_scan_path = db.Column(db.String(500))

    status = db.Column(db.String(30), default=ContractStatus.DRAFT, nullable=False, index=True)
    notes = db.Column(db.Text)

    created_at = db.Column(db.DateTime, default=utc_now)
    updated_at = db.Column(db.DateTime, default=utc_now, onupdate=utc_now)

    student = db.relationship("Student", backref="contracts", lazy=True)
    signatures = db.relationship(
        "Signature", backref="contract", lazy=True, cascade="all, delete-orphan"
    )

    def to_dict(self, include_relations: bool = False) -> dict:
        data = {
            "id": self.id,
            "number": self.number,
            "year": self.year,
            "contract_date": self.contract_date.isoformat() if self.contract_date else None,
            "partner_id": self.partner_id,
            "partner_name": self.partner.organization_name if self.partner else None,
            "student_id": self.student_id,
            "student_name": self.student.full_name if self.student else None,
            "student_group": self.student.group_name if self.student else None,
            "student_specialty": self.student.specialty if self.student else None,
            "practice_start": self.student.practice_start.isoformat()
            if self.student and self.student.practice_start
            else None,
            "practice_end": self.student.practice_end.isoformat()
            if self.student and self.student.practice_end
            else None,
            "docx_path": self.docx_path,
            "pdf_path": self.pdf_path,
            "signed_scan_path": self.signed_scan_path,
            "status": self.status,
            "status_label": ContractStatus.LABELS.get(self.status, self.status),
            "notes": self.notes,
            "signatures_count": len(self.signatures or []),
            "signing_requests_count": len(self.signing_requests or []),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_relations:
            data["signatures"] = [s.to_dict() for s in (self.signatures or [])]
            data["signing_requests"] = [
                r.to_dict() for r in (self.signing_requests or [])
            ]
        return data
