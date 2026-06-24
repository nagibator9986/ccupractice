"""LMS (Caspian Digital) standalone contract aggregate — grant-only seats.

A `LmsContract` is a sibling aggregate to `EnrollmentContract`. It is created
ONLY for state-grant ("госзаказ") students and represents the «Договор о
подключении к цифровой экосистеме Caspian Digital» as its own contract — with
its own number, its own signing matrix, its own QR-verifiable PDF.

Why standalone?
- The grant-only invariant must be enforced at the data layer (FK to a
  grant-flagged Student + a CHECK constraint that `is_grant_at_signing = TRUE`),
  not by an opt-in checkbox on the educational-services contract.
- Applicant / parent / program fields are *snapshotted* at create-time so the
  signed DOCX stays reproducible even if the Student row is edited afterwards.
- Single signer (the student if ≥16, else the parent — College is facsimile in
  the template).

Source-of-truth imports:
- `_full_years`, `ADULT_SIGN_AGE`, `PARTY_STUDENT`, `PARTY_PARENT`, `DOC_LMS`,
  `DOCUMENT_LABELS`, `PARTY_LABELS` are re-used from `models.enrollment` so we
  never duplicate the age math or party vocabulary.
"""
import os
import re
import secrets
from datetime import date, timedelta

from ..extensions import db
from ..utils.time import utc_now
from .enrollment import (
    ADULT_SIGN_AGE,
    DOC_LMS,
    DOCUMENT_LABELS,
    PARTY_LABELS,
    PARTY_PARENT,
    PARTY_STUDENT,
    _full_years,
)


# Re-export the LMS document key + label so callers can `from .lms_contract import DOC_LMS`.
__all__ = [
    "DOC_LMS",
    "LmsStatus",
    "LmsContract",
    "LmsSignature",
    "LmsSigningRequest",
    "lms_signing_matrix",
    "suggest_lms_number",
    "LMS_NUMBER_PREFIX",
]


LMS_NUMBER_PREFIX = "LMS"


class LmsStatus:
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


_LMS_NUM_SEQ_RE = re.compile(r"-(\d+)\s*$")


def suggest_lms_number(year: int | None = None) -> str:
    """Suggest the next free `LMS-YYYY-NNN` number for the given year.

    Scans `lms_contracts.number` for the `LMS-{year}-` prefix and returns
    `max(existing trailing seq) + 1`. Max-seq + 1 (not count+1) so deletions
    don't create a collision with a kept number.
    """
    if year is None:
        year = utc_now().year
    max_seq = 0
    rows = (
        LmsContract.query
        .with_entities(LmsContract.number)
        .filter(LmsContract.year == year)
    )
    for (num,) in rows:
        if not num:
            continue
        m = _LMS_NUM_SEQ_RE.search(num)
        if m:
            try:
                max_seq = max(max_seq, int(m.group(1)))
            except (TypeError, ValueError):
                pass
    return f"{LMS_NUMBER_PREFIX}-{year}-{max_seq + 1:03d}"


def lms_signing_matrix(applicant_age: int | None) -> dict[str, list[str]]:
    """Single-signer matrix for the LMS contract.

    Returns `{}` if age is unknown so callers can demand birth_date before
    inviting. For age ≥ ADULT_SIGN_AGE the applicant signs personally; otherwise
    the legal representative signs on their behalf. The College never signs via
    ЭЦП — the template carries the College's facsimile / М.П.
    """
    if applicant_age is None:
        return {}
    if applicant_age >= ADULT_SIGN_AGE:
        return {PARTY_STUDENT: [DOC_LMS]}
    return {PARTY_PARENT: [DOC_LMS]}


class LmsContract(db.Model):
    """Standalone Caspian Digital (LMS) contract for a grant-funded student."""

    __tablename__ = "lms_contracts"
    __table_args__ = (
        # Grant-only invariant: a non-grant row must never reach the DB. Using
        # the numeric (1) form so SQLite + PostgreSQL both accept the CHECK
        # without coercion warnings.
        db.CheckConstraint("is_grant_at_signing = 1", name="ck_lms_grant"),
    )

    id = db.Column(db.Integer, primary_key=True)

    # Identity / metadata
    number = db.Column(db.String(60), unique=True, index=True)
    contract_date = db.Column(db.Date)
    year = db.Column(db.Integer, index=True)

    # Foreign keys
    student_id = db.Column(
        db.Integer,
        db.ForeignKey("students.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    # Optional back-link to the enrollment that triggered this LMS contract.
    # Set NULL on delete so an enrollment removal doesn't take the LMS aggregate
    # (and its valid signatures) with it.
    source_enrollment_id = db.Column(
        db.Integer,
        db.ForeignKey("enrollment_contracts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # ── Applicant snapshot (mirrors EnrollmentContract.applicant_*) ──────────
    applicant_full_name = db.Column(db.String(200), nullable=False, index=True)
    applicant_iin = db.Column(db.String(20), index=True)
    applicant_birth_date = db.Column(db.Date)
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

    # ── Parent snapshot (only required when applicant_age < 16) ──────────────
    parent_full_name = db.Column(db.String(200))
    parent_iin = db.Column(db.String(20))
    parent_relation = db.Column(db.String(60))
    parent_address = db.Column(db.String(400))
    parent_phone = db.Column(db.String(60))
    parent_email = db.Column(db.String(160))

    # ── Program snapshot ─────────────────────────────────────────────────────
    specialty = db.Column(db.String(200))
    specialty_code = db.Column(db.String(60))
    qualification = db.Column(db.String(200))
    education_base = db.Column(db.String(10), default="9")
    study_form = db.Column(db.String(60), default="очная")
    course = db.Column(db.Integer, default=1)

    # ── Grant snapshot ───────────────────────────────────────────────────────
    grant_order_number = db.Column(db.String(60))
    grant_order_date = db.Column(db.Date)
    funding_source = db.Column(db.String(40), default="госзаказ")
    is_grant_at_signing = db.Column(db.Boolean, nullable=False, default=True)

    # ── Generated files (relative to ARCHIVE_FOLDER) ─────────────────────────
    docx_path = db.Column(db.String(500))
    pdf_path = db.Column(db.String(500))

    # ── Workflow ─────────────────────────────────────────────────────────────
    status = db.Column(
        db.String(30), default=LmsStatus.DRAFT, nullable=False, index=True
    )
    # Public QR verification code (printed into the DOCX QR-stamp).
    verify_code = db.Column(db.String(40), unique=True, index=True)

    notes = db.Column(db.Text)

    created_at = db.Column(db.DateTime, default=utc_now)
    updated_at = db.Column(db.DateTime, default=utc_now, onupdate=utc_now)

    # ── Relationships ────────────────────────────────────────────────────────
    signatures = db.relationship(
        "LmsSignature",
        back_populates="lms_contract",
        lazy=True,
        cascade="all, delete-orphan",
    )
    signing_requests = db.relationship(
        "LmsSigningRequest",
        back_populates="lms_contract",
        lazy=True,
        cascade="all, delete-orphan",
    )
    student = db.relationship("Student", backref=db.backref("lms_contracts", lazy=True))
    source_enrollment = db.relationship(
        "EnrollmentContract",
        backref=db.backref("lms_contracts", lazy=True),
    )

    # ── Defaults ─────────────────────────────────────────────────────────────
    @staticmethod
    def generate_verify_code() -> str:
        return secrets.token_urlsafe(20)

    def __init__(self, **kwargs):
        kwargs.setdefault("verify_code", self.generate_verify_code())
        kwargs.setdefault("is_grant_at_signing", True)
        super().__init__(**kwargs)

    # ── Derived helpers ──────────────────────────────────────────────────────
    @property
    def applicant_age(self) -> int | None:
        return _full_years(self.applicant_birth_date, self.contract_date or date.today())

    @property
    def required_matrix(self) -> dict[str, list[str]]:
        return lms_signing_matrix(self.applicant_age)

    @property
    def signer_party(self) -> str | None:
        """The single party that must sign — student or parent."""
        matrix = self.required_matrix
        if not matrix:
            return None
        # Single-signer matrix — exactly one key.
        return next(iter(matrix.keys()))

    @property
    def is_fully_signed(self) -> bool:
        matrix = self.required_matrix
        if not matrix:
            return False
        have = {s.signer_party for s in (self.signatures or [])}
        need = set(matrix.keys())
        return need.issubset(have)

    def doc_path(self, fmt: str) -> str | None:
        """Convenience to mirror EnrollmentContract.doc_path(doc, fmt)."""
        return getattr(self, f"{fmt}_path", None)

    def to_dict(self, include_relations: bool = False) -> dict:
        addr_parts = [
            self.applicant_address_city,
            self.applicant_address_district,
            self.applicant_address_street,
            (f"д. {self.applicant_address_house}" if self.applicant_address_house else None),
        ]
        signer_party = self.signer_party
        data = {
            "id": self.id,
            "number": self.number,
            "contract_date": self.contract_date.isoformat() if self.contract_date else None,
            "year": self.year,
            "student_id": self.student_id,
            "source_enrollment_id": self.source_enrollment_id,
            # Applicant snapshot
            "applicant_full_name": self.applicant_full_name,
            "applicant_iin": self.applicant_iin,
            "applicant_birth_date": self.applicant_birth_date.isoformat() if self.applicant_birth_date else None,
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
            # Parent snapshot
            "parent_full_name": self.parent_full_name,
            "parent_iin": self.parent_iin,
            "parent_relation": self.parent_relation,
            "parent_address": self.parent_address,
            "parent_phone": self.parent_phone,
            "parent_email": self.parent_email,
            # Program snapshot
            "specialty": self.specialty,
            "specialty_code": self.specialty_code,
            "qualification": self.qualification,
            "education_base": self.education_base,
            "study_form": self.study_form,
            "course": self.course,
            # Grant snapshot
            "grant_order_number": self.grant_order_number,
            "grant_order_date": self.grant_order_date.isoformat() if self.grant_order_date else None,
            "funding_source": self.funding_source,
            "is_grant_at_signing": bool(self.is_grant_at_signing),
            # Workflow
            "status": self.status or LmsStatus.DRAFT,
            "status_label": LmsStatus.LABELS.get(self.status or LmsStatus.DRAFT, self.status),
            "verify_code": self.verify_code,
            "notes": self.notes,
            "applicant_age": self.applicant_age,
            "required_matrix": self.required_matrix,
            "signer_party": signer_party,
            "signer_party_label": PARTY_LABELS.get(signer_party) if signer_party else None,
            "document": {
                "key": DOC_LMS,
                "label": DOCUMENT_LABELS.get(DOC_LMS, DOC_LMS),
                "docx": bool(self.docx_path),
                "pdf": bool(self.pdf_path),
            },
            "signatures_count": len(self.signatures or []),
            "is_fully_signed": self.is_fully_signed,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        # Compact source-enrollment summary (only IDs/number/date — full payload
        # would be redundant since fields are snapshotted onto the LMS row).
        if self.source_enrollment is not None:
            data["source_enrollment"] = {
                "id": self.source_enrollment.id,
                "number": self.source_enrollment.number,
                "contract_date": self.source_enrollment.contract_date.isoformat() if self.source_enrollment.contract_date else None,
                "status": self.source_enrollment.status,
            }
        else:
            data["source_enrollment"] = None
        if include_relations:
            data["signatures"] = [s.to_dict() for s in (self.signatures or [])]
            data["signing_requests"] = [r.to_dict() for r in (self.signing_requests or [])]
        return data


class LmsSignature(db.Model):
    """A verified CMS (ЭЦП) signature for the (single-document) LMS contract.

    Unlike `EnrollmentSignature` there is no `document` column — the LMS
    aggregate is one document by design; uniqueness is enforced on
    (lms_contract_id, signer_party) so the student-or-parent slot can be filled
    exactly once per contract.
    """

    __tablename__ = "lms_signatures"
    __table_args__ = (
        db.UniqueConstraint(
            "lms_contract_id", "signer_party", name="uq_lms_sig_party",
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    lms_contract_id = db.Column(
        db.Integer,
        db.ForeignKey("lms_contracts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    signer_party = db.Column(db.String(20), nullable=False)  # student | parent

    signer_full_name = db.Column(db.String(200))
    signer_iin_or_bin = db.Column(db.String(20))
    signer_serial = db.Column(db.String(80))
    signer_certificate_pem = db.Column(db.Text)

    cms_signature = db.Column(db.Text, nullable=False)
    signed_payload_sha256 = db.Column(db.String(80), nullable=False)
    # legal | full | document_bound | accepted (set by verify_cms_signature).
    verification_level = db.Column(db.String(20), default="full")

    created_at = db.Column(db.DateTime, default=utc_now)

    lms_contract = db.relationship("LmsContract", back_populates="signatures")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "lms_contract_id": self.lms_contract_id,
            "document": DOC_LMS,
            "document_label": DOCUMENT_LABELS.get(DOC_LMS, DOC_LMS),
            "signer_party": self.signer_party,
            "signer_party_label": PARTY_LABELS.get(self.signer_party, self.signer_party),
            "signer_full_name": self.signer_full_name,
            "signer_iin_or_bin": self.signer_iin_or_bin,
            "signer_serial": self.signer_serial,
            "signed_payload_sha256": self.signed_payload_sha256,
            "verification_level": self.verification_level or "full",
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class LmsSigningRequest(db.Model):
    """One tokenized signing link for the single LMS signer (student or parent).

    Mirrors `EnrollmentSigningRequest` shape; public URL is `/lms-sign/<token>`
    (single document, no document path segment).
    """

    __tablename__ = "lms_signing_requests"

    id = db.Column(db.Integer, primary_key=True)
    lms_contract_id = db.Column(
        db.Integer,
        db.ForeignKey("lms_contracts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
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

    lms_contract = db.relationship("LmsContract", back_populates="signing_requests")

    DEFAULT_TTL_DAYS = 30

    @staticmethod
    def generate_token() -> str:
        return secrets.token_urlsafe(32)

    @classmethod
    def create_for(
        cls,
        lms_contract_id: int,
        party: str,
        recipient: dict,
        ttl_days: int = DEFAULT_TTL_DAYS,
    ) -> "LmsSigningRequest":
        return cls(
            lms_contract_id=lms_contract_id,
            signer_party=party,
            recipient_name=recipient.get("name"),
            recipient_iin=recipient.get("iin"),
            token=cls.generate_token(),
            expires_at=utc_now() + timedelta(days=ttl_days),
        )

    @property
    def is_expired(self) -> bool:
        return bool(self.expires_at and self.expires_at < utc_now())

    @property
    def sign_url(self) -> str:
        base = (os.getenv("PUBLIC_BASE_URL") or "").rstrip("/")
        return f"{base}/lms-sign/{self.token}"

    def to_dict(self, include_token: bool = False, public_base_url: str | None = None) -> dict:
        data = {
            "id": self.id,
            "lms_contract_id": self.lms_contract_id,
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
            base = (public_base_url or os.getenv("PUBLIC_BASE_URL") or "").rstrip("/")
            data["sign_url"] = f"{base}/lms-sign/{self.token}"
        return data
