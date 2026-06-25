"""Educational-services enrollment between an applicant (поступающий) and the College.

Distinct from the three-party internship `Contract`. Each enrollment produces TWO
documents — the educational-services contract («Договор на оказание образовательных
услуг») and the personal-data consent («Согласие на обработку персональных
данных») — and the set of ЭЦП signers is derived from the applicant's age at the
contract date:

  * applicant younger than 16  → the legal representative (parent) signs BOTH
    documents (the minor does not sign);
  * applicant 16 or older      → the applicant signs BOTH documents, and the
    parent additionally signs the consent.

The College side is a facsimile / М.П. inside the template, so the College does
not sign via ЭЦП here. CMS verification reuses ``services.signature_service``.
"""
import secrets
from datetime import date, datetime, timedelta

from ..extensions import db
from ..utils.time import utc_now


# Document keys used across signatures, signing requests and downloads.
DOC_CONTRACT = "contract"
DOC_CONSENT = "consent"
# DOC_LMS lives outside the enrollment aggregate now (see models/lms_contract.py)
# but the constant is kept here so the LMS module — and any historical importers —
# have one source of truth for the key string + label.
DOC_LMS = "lms"
DOCUMENTS = (DOC_CONTRACT, DOC_CONSENT)
DOCUMENT_LABELS = {
    DOC_CONTRACT: "Договор на оказание образовательных услуг",
    DOC_CONSENT: "Согласие на обработку персональных данных",
    DOC_LMS: "Договор о подключении к цифровой экосистеме Caspian Digital",
}

# Signing parties.
PARTY_STUDENT = "student"
PARTY_PARENT = "parent"
PARTY_LABELS = {
    PARTY_STUDENT: "Обучающийся (абитуриент)",
    PARTY_PARENT: "Законный представитель (родитель)",
}

# Age (in full years, at the contract date) at/above which the applicant signs
# personally instead of (only) the parent.
ADULT_SIGN_AGE = 16


def _full_years(born: date | None, on: date | None) -> int | None:
    if not born or not on:
        return None
    # A birth date after the reference date is invalid data, not "age 0" — return
    # None so signing_matrix() yields {} (invite is blocked) instead of silently
    # routing a negative age into the <16 "parent signs" branch.
    if on < born:
        return None
    return on.year - born.year - ((on.month, on.day) < (born.month, born.day))


def signing_matrix(age: int | None) -> dict[str, list[str]]:
    """Return {party: [documents]} the party must sign, given the applicant age.

    Returns ``{}`` when age is unknown — the caller must require a birth date
    before inviting signers (otherwise the legally-correct signer is ambiguous).

    The LMS (Caspian Digital) contract is its own aggregate now — see
    ``models/lms_contract.lms_signing_matrix`` — so it is no longer mixed into
    this matrix.
    """
    if age is None:
        return {}
    if age >= ADULT_SIGN_AGE:
        # Applicant signs the contract and consent; parent co-signs the consent.
        return {PARTY_STUDENT: [DOC_CONTRACT, DOC_CONSENT], PARTY_PARENT: [DOC_CONSENT]}
    # Minor: the legal representative signs everything.
    return {PARTY_PARENT: [DOC_CONTRACT, DOC_CONSENT]}


class EnrollmentStatus:
    DRAFT = "draft"
    GENERATED = "generated"
    SENT = "sent"
    SIGNED = "signed"
    COMPLETED = "completed"

    ALL = (DRAFT, GENERATED, SENT, SIGNED, COMPLETED)
    LABELS = {
        DRAFT: "Черновик",
        GENERATED: "Сформирован",
        SENT: "Отправлен на подпись",
        SIGNED: "Подписан",
        COMPLETED: "Завершён",
    }


class EnrollmentContract(db.Model):
    __tablename__ = "enrollment_contracts"

    id = db.Column(db.Integer, primary_key=True)

    # Number/date are MANUAL and editable at any time (auto-suggested on create).
    number = db.Column(db.String(60), index=True)
    contract_date = db.Column(db.Date)
    year = db.Column(db.Integer, index=True)

    # ── Applicant (Обучающийся) ──────────────────────────────────────────────
    applicant_full_name = db.Column(db.String(200), nullable=False, index=True)
    applicant_iin = db.Column(db.String(20), index=True)
    applicant_birth_date = db.Column(db.Date)
    applicant_gender = db.Column(db.String(10))  # М | Ж
    applicant_id_doc_type = db.Column(db.String(60), default="удостоверение личности")
    applicant_id_doc_number = db.Column(db.String(60))
    applicant_id_doc_issued_by = db.Column(db.String(200))
    applicant_id_doc_issued_date = db.Column(db.Date)
    applicant_address_city = db.Column(db.String(120))
    applicant_address_district = db.Column(db.String(120))
    applicant_address_street = db.Column(db.String(200))
    applicant_address_house = db.Column(db.String(60))
    applicant_phone = db.Column(db.String(60))
    applicant_home_phone = db.Column(db.String(60))
    applicant_email = db.Column(db.String(160))

    # ── Legal representative (Родитель / законный представитель) ─────────────
    parent_full_name = db.Column(db.String(200))
    parent_relation = db.Column(db.String(60))  # мать | отец | опекун | ...
    parent_iin = db.Column(db.String(20))
    parent_id_doc_number = db.Column(db.String(60))
    parent_id_doc_issued_by = db.Column(db.String(200))
    parent_address = db.Column(db.String(400))
    parent_phone = db.Column(db.String(60))
    parent_email = db.Column(db.String(160))

    # ── Program / academic ───────────────────────────────────────────────────
    specialty = db.Column(db.String(200))
    specialty_code = db.Column(db.String(60))
    qualification = db.Column(db.String(200))
    education_base = db.Column(db.String(10), default="9")  # 9 | 11 (класс)
    study_form = db.Column(db.String(60), default="очная")
    course = db.Column(db.Integer, default=1)

    # ── Finance ──────────────────────────────────────────────────────────────
    tuition_year_amount = db.Column(db.Integer)  # тенге за учебный год

    # ── Generated files (relative to ARCHIVE_FOLDER) ─────────────────────────
    contract_docx_path = db.Column(db.String(500))
    contract_pdf_path = db.Column(db.String(500))
    consent_docx_path = db.Column(db.String(500))
    consent_pdf_path = db.Column(db.String(500))

    status = db.Column(db.String(30), default=EnrollmentStatus.DRAFT, nullable=False, index=True)
    notes = db.Column(db.Text)

    created_at = db.Column(db.DateTime, default=utc_now)
    updated_at = db.Column(db.DateTime, default=utc_now, onupdate=utc_now)

    signatures = db.relationship(
        "EnrollmentSignature", backref="enrollment", lazy=True, cascade="all, delete-orphan"
    )
    signing_requests = db.relationship(
        "EnrollmentSigningRequest", backref="enrollment", lazy=True, cascade="all, delete-orphan"
    )

    # ── Derived helpers ──────────────────────────────────────────────────────
    @property
    def applicant_age(self) -> int | None:
        """Full years at the contract date (falls back to today if no date)."""
        return _full_years(self.applicant_birth_date, self.contract_date or date.today())

    @property
    def required_matrix(self) -> dict[str, list[str]]:
        return signing_matrix(self.applicant_age)

    @property
    def relevant_documents(self) -> tuple[str, ...]:
        """Documents this enrollment actually issues."""
        return (DOC_CONTRACT, DOC_CONSENT)

    def doc_path(self, document: str, fmt: str) -> str | None:
        return getattr(self, f"{document}_{fmt}_path", None)

    @property
    def is_fully_signed(self) -> bool:
        matrix = self.required_matrix
        if not matrix:
            return False
        have = {(s.document, s.signer_party) for s in (self.signatures or [])}
        need = {(doc, party) for party, docs in matrix.items() for doc in docs}
        return need.issubset(have)

    def to_dict(self, include_relations: bool = False) -> dict:
        addr_parts = [
            self.applicant_address_city,
            self.applicant_address_district,
            self.applicant_address_street,
            (f"д. {self.applicant_address_house}" if self.applicant_address_house else None),
        ]
        data = {
            "id": self.id,
            "number": self.number,
            "contract_date": self.contract_date.isoformat() if self.contract_date else None,
            "year": self.year,
            "applicant_full_name": self.applicant_full_name,
            "applicant_iin": self.applicant_iin,
            "applicant_birth_date": self.applicant_birth_date.isoformat() if self.applicant_birth_date else None,
            "applicant_gender": self.applicant_gender,
            "applicant_id_doc_type": self.applicant_id_doc_type,
            "applicant_id_doc_number": self.applicant_id_doc_number,
            "applicant_id_doc_issued_by": self.applicant_id_doc_issued_by,
            "applicant_id_doc_issued_date": self.applicant_id_doc_issued_date.isoformat() if self.applicant_id_doc_issued_date else None,
            "applicant_address_city": self.applicant_address_city,
            "applicant_address_district": self.applicant_address_district,
            "applicant_address_street": self.applicant_address_street,
            "applicant_address_house": self.applicant_address_house,
            "applicant_address": ", ".join(p for p in addr_parts if p) or None,
            "applicant_phone": self.applicant_phone,
            "applicant_home_phone": self.applicant_home_phone,
            "applicant_email": self.applicant_email,
            "parent_full_name": self.parent_full_name,
            "parent_relation": self.parent_relation,
            "parent_iin": self.parent_iin,
            "parent_id_doc_number": self.parent_id_doc_number,
            "parent_id_doc_issued_by": self.parent_id_doc_issued_by,
            "parent_address": self.parent_address,
            "parent_phone": self.parent_phone,
            "parent_email": self.parent_email,
            "specialty": self.specialty,
            "specialty_code": self.specialty_code,
            "qualification": self.qualification,
            "education_base": self.education_base,
            "study_form": self.study_form,
            "course": self.course,
            "tuition_year_amount": self.tuition_year_amount,
            "status": self.status,
            "status_label": EnrollmentStatus.LABELS.get(self.status, self.status),
            "notes": self.notes,
            "applicant_age": self.applicant_age,
            "required_matrix": self.required_matrix,
            "documents": {
                doc: {
                    "label": DOCUMENT_LABELS[doc],
                    "docx": bool(self.doc_path(doc, "docx")),
                    "pdf": bool(self.doc_path(doc, "pdf")),
                }
                for doc in self.relevant_documents
            },
            "signatures_count": len(self.signatures or []),
            "is_fully_signed": self.is_fully_signed,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        # Expose the first linked LmsContract (if any) so the SPA can render a
        # deep-link chip 'LMS-договор № … →' on the enrollment detail page.
        # The relationship is set via lms_contracts.source_enrollment_id (see
        # models/lms_contract.py — backref('lms_contracts')).
        lms_rows = getattr(self, "lms_contracts", None) or []
        first_lms = lms_rows[0] if lms_rows else None
        data["source_lms_contract_id"] = first_lms.id if first_lms else None
        data["source_lms_contract_number"] = first_lms.number if first_lms else None
        if include_relations:
            data["signatures"] = [s.to_dict() for s in (self.signatures or [])]
            data["signing_requests"] = [r.to_dict() for r in (self.signing_requests or [])]
        return data


class EnrollmentSigningRequest(db.Model):
    """One tokenized signing link per signing party (student / parent).

    A single link lets the party sign every document assigned to them (the
    matrix). The request becomes ``signed`` once all of its documents carry a
    verified signature.
    """

    __tablename__ = "enrollment_signing_requests"

    id = db.Column(db.Integer, primary_key=True)
    enrollment_id = db.Column(
        db.Integer, db.ForeignKey("enrollment_contracts.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    signer_party = db.Column(db.String(20), nullable=False)  # student | parent
    recipient_name = db.Column(db.String(200))
    recipient_iin = db.Column(db.String(20))

    token = db.Column(db.String(64), unique=True, nullable=False, index=True)
    status = db.Column(db.String(20), default="pending", nullable=False)  # pending|viewed|signed|revoked

    viewed_at = db.Column(db.DateTime)
    signed_at = db.Column(db.DateTime)
    revoked_at = db.Column(db.DateTime)

    created_at = db.Column(db.DateTime, default=utc_now)
    expires_at = db.Column(db.DateTime)

    DEFAULT_TTL_DAYS = 30

    @staticmethod
    def generate_token() -> str:
        return secrets.token_urlsafe(32)

    @classmethod
    def create_for(cls, enrollment_id: int, party: str, recipient: dict,
                   ttl_days: int = DEFAULT_TTL_DAYS) -> "EnrollmentSigningRequest":
        return cls(
            enrollment_id=enrollment_id,
            signer_party=party,
            recipient_name=recipient.get("name"),
            recipient_iin=recipient.get("iin"),
            token=cls.generate_token(),
            expires_at=utc_now() + timedelta(days=ttl_days),
        )

    @property
    def is_expired(self) -> bool:
        return bool(self.expires_at and self.expires_at < utc_now())

    def to_dict(self, include_token: bool = False, public_base_url: str | None = None) -> dict:
        data = {
            "id": self.id,
            "enrollment_id": self.enrollment_id,
            "signer_party": self.signer_party,
            "signer_party_label": PARTY_LABELS.get(self.signer_party, self.signer_party),
            "recipient_name": self.recipient_name,
            "recipient_iin": self.recipient_iin,
            "status": self.status,
            "viewed_at": self.viewed_at.isoformat() if self.viewed_at else None,
            "signed_at": self.signed_at.isoformat() if self.signed_at else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "expired": self.is_expired,
        }
        if include_token:
            data["token"] = self.token
            base = (public_base_url or "").rstrip("/")
            data["sign_url"] = f"{base}/enroll-sign/{self.token}"
        return data


class EnrollmentSignature(db.Model):
    """A verified CMS (ЭЦП) signature for one (document, party) of an enrollment."""

    __tablename__ = "enrollment_signatures"
    __table_args__ = (
        db.UniqueConstraint(
            "enrollment_id", "document", "signer_party",
            name="uq_enroll_sig_doc_party",
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    enrollment_id = db.Column(
        db.Integer, db.ForeignKey("enrollment_contracts.id", ondelete="CASCADE"), nullable=False
    )
    document = db.Column(db.String(20), nullable=False)      # contract | consent
    signer_party = db.Column(db.String(20), nullable=False)  # student | parent

    signer_full_name = db.Column(db.String(200))
    signer_iin_or_bin = db.Column(db.String(20))
    signer_serial = db.Column(db.String(80))
    signer_certificate_pem = db.Column(db.Text)

    cms_signature = db.Column(db.Text, nullable=False)
    signed_payload_sha256 = db.Column(db.String(80), nullable=False)
    # How strongly the server verified this signature: full | document_bound | accepted
    verification_level = db.Column(db.String(20), default="full")

    created_at = db.Column(db.DateTime, default=utc_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "enrollment_id": self.enrollment_id,
            "document": self.document,
            "document_label": DOCUMENT_LABELS.get(self.document, self.document),
            "signer_party": self.signer_party,
            "signer_party_label": PARTY_LABELS.get(self.signer_party, self.signer_party),
            "signer_full_name": self.signer_full_name,
            "signer_iin_or_bin": self.signer_iin_or_bin,
            "signer_serial": self.signer_serial,
            "signed_payload_sha256": self.signed_payload_sha256,
            "verification_level": self.verification_level or "full",
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
