"""lms contract aggregate — grant-only standalone Caspian Digital contract

Promotes the optional `EnrollmentContract.include_lms` checkbox into a sibling
aggregate `LmsContract` with its own tables (lms_contracts, lms_signatures,
lms_signing_requests), and migrates any pre-existing LMS data verbatim:

  * `students.is_grant_student` is added (Boolean NOT NULL, default 0) +
    indexed. Pre-existing students linked to a migrated LMS get flipped to 1.
  * For every `enrollment_contracts` row with `include_lms=1` AND a
    `lms_docx_path` set, an `lms_contracts` row is created, snapshotting all
    applicant/parent/program fields, REUSING the on-disk DOCX/PDF paths verbatim
    so signatures bound by `signed_payload_sha256 = SHA-256(DOCX bytes)` keep
    verifying. The grant invariant CHECK is satisfied via
    `is_grant_at_signing = 1`.
  * `enrollment_signatures` rows with `document='lms'` are copied bit-for-bit
    into `lms_signatures` (cms_signature, signed_payload_sha256, cert PEM,
    verification_level — everything that makes the legal CMS valid).
  * Strict Python asserts on both counts before we drop anything; assertion
    failure raises and Alembic rolls back the whole transaction.
  * Finally, `enrollment_signatures` rows for the LMS doc are removed and the
    three legacy columns (`include_lms`, `lms_docx_path`, `lms_pdf_path`) are
    dropped from `enrollment_contracts`.

Downgrade is the strict reverse: re-add columns, copy paths/signatures back to
the enrollment row via `source_enrollment_id`, drop the three new tables, drop
`students.is_grant_student`.

Revision ID: g1b2c3d4e5f6
Revises: f0a4b5c6d7e8
Create Date: 2026-07-15 09:00:00.000000

"""
import re
import secrets
from datetime import datetime

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'g1b2c3d4e5f6'
down_revision = 'f0a4b5c6d7e8'
branch_labels = None
depends_on = None


_LMS_NUM_SEQ_RE = re.compile(r"-(\d+)\s*$")
_OU_PREFIX_RE = re.compile(r"^\s*ОУ-", re.IGNORECASE)


def _now() -> datetime:
    return datetime.utcnow()


def _truthy(val) -> bool:
    """Boolean coercion that handles SQLite ints + PostgreSQL booleans."""
    if val is None:
        return False
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return int(val) != 0
    s = str(val).strip().lower()
    return s in ("1", "t", "true", "y", "yes", "on")


def _suggest_lms_number(year: int | None, taken: set[str]) -> str:
    """Find the next free LMS-YYYY-NNN number, avoiding everything in `taken`."""
    if year is None:
        year = _now().year
    prefix = f"LMS-{year}-"
    max_seq = 0
    for num in taken:
        if not num or not num.startswith(prefix):
            continue
        m = _LMS_NUM_SEQ_RE.search(num)
        if m:
            try:
                max_seq = max(max_seq, int(m.group(1)))
            except (TypeError, ValueError):
                pass
    while True:
        max_seq += 1
        candidate = f"{prefix}{max_seq:03d}"
        if candidate not in taken:
            return candidate


def _generate_verify_code(taken: set[str]) -> str:
    while True:
        code = secrets.token_urlsafe(20)
        if code not in taken:
            taken.add(code)
            return code


def _generate_token(taken: set[str]) -> str:
    while True:
        token = secrets.token_urlsafe(32)
        if token not in taken:
            taken.add(token)
            return token


def upgrade():
    # ── 1) students.is_grant_student ─────────────────────────────────────────
    # Use ``sa.false()`` so the dialect emits ``DEFAULT false`` on Postgres
    # (which rejects ``DEFAULT 0`` on a BOOLEAN column) AND ``DEFAULT 0`` on
    # SQLite — covered by the same SQLAlchemy compiler.
    with op.batch_alter_table('students', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'is_grant_student',
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
    op.create_index(
        'ix_students_is_grant_student',
        'students',
        ['is_grant_student'],
        unique=False,
    )

    # ── 2) lms_contracts ─────────────────────────────────────────────────────
    op.create_table(
        'lms_contracts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('number', sa.String(length=60), nullable=True),
        sa.Column('contract_date', sa.Date(), nullable=True),
        sa.Column('year', sa.Integer(), nullable=True),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('source_enrollment_id', sa.Integer(), nullable=True),
        # Applicant snapshot
        sa.Column('applicant_full_name', sa.String(length=200), nullable=False),
        sa.Column('applicant_iin', sa.String(length=20), nullable=True),
        sa.Column('applicant_birth_date', sa.Date(), nullable=True),
        sa.Column('applicant_id_doc_number', sa.String(length=60), nullable=True),
        sa.Column('applicant_id_doc_issued_by', sa.String(length=200), nullable=True),
        sa.Column('applicant_id_doc_issued_date', sa.Date(), nullable=True),
        sa.Column('applicant_address_city', sa.String(length=120), nullable=True),
        sa.Column('applicant_address_district', sa.String(length=120), nullable=True),
        sa.Column('applicant_address_street', sa.String(length=200), nullable=True),
        sa.Column('applicant_address_house', sa.String(length=60), nullable=True),
        sa.Column('applicant_phone', sa.String(length=60), nullable=True),
        sa.Column('applicant_home_phone', sa.String(length=60), nullable=True),
        sa.Column('applicant_email', sa.String(length=160), nullable=True),
        # Parent snapshot
        sa.Column('parent_full_name', sa.String(length=200), nullable=True),
        sa.Column('parent_iin', sa.String(length=20), nullable=True),
        sa.Column('parent_relation', sa.String(length=60), nullable=True),
        sa.Column('parent_address', sa.String(length=400), nullable=True),
        sa.Column('parent_phone', sa.String(length=60), nullable=True),
        sa.Column('parent_email', sa.String(length=160), nullable=True),
        # Program snapshot
        sa.Column('specialty', sa.String(length=200), nullable=True),
        sa.Column('specialty_code', sa.String(length=60), nullable=True),
        sa.Column('qualification', sa.String(length=200), nullable=True),
        sa.Column('education_base', sa.String(length=10), nullable=True),
        sa.Column('study_form', sa.String(length=60), nullable=True),
        sa.Column('course', sa.Integer(), nullable=True),
        # Grant snapshot
        sa.Column('grant_order_number', sa.String(length=60), nullable=True),
        sa.Column('grant_order_date', sa.Date(), nullable=True),
        sa.Column('funding_source', sa.String(length=40), nullable=True),
        sa.Column('is_grant_at_signing', sa.Boolean(), nullable=False),
        # Generated files
        sa.Column('docx_path', sa.String(length=500), nullable=True),
        sa.Column('pdf_path', sa.String(length=500), nullable=True),
        # Workflow
        sa.Column('status', sa.String(length=30), nullable=False),
        sa.Column('verify_code', sa.String(length=40), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ['student_id'], ['students.id'], ondelete='RESTRICT',
        ),
        sa.ForeignKeyConstraint(
            ['source_enrollment_id'], ['enrollment_contracts.id'], ondelete='SET NULL',
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('number', name='uq_lms_contracts_number'),
        sa.UniqueConstraint('verify_code', name='uq_lms_contracts_verify_code'),
        # Cross-dialect grant-only invariant: a bare boolean column reference
        # is truthy in PG ("WHERE is_grant_at_signing") and SQLite (which stores
        # bool as 0/1 and evaluates non-zero as true), so the constraint holds
        # for both back-ends without ``= 1`` (which Postgres rejects because the
        # left side is BOOLEAN and the right side is INTEGER).
        sa.CheckConstraint('is_grant_at_signing', name='ck_lms_grant'),
    )
    with op.batch_alter_table('lms_contracts', schema=None) as batch_op:
        batch_op.create_index(
            'ix_lms_contracts_number', ['number'], unique=False,
        )
        batch_op.create_index(
            'ix_lms_contracts_verify_code', ['verify_code'], unique=False,
        )
        batch_op.create_index(
            'ix_lms_contracts_year', ['year'], unique=False,
        )
        batch_op.create_index(
            'ix_lms_contracts_status', ['status'], unique=False,
        )
        batch_op.create_index(
            'ix_lms_contracts_student_id', ['student_id'], unique=False,
        )
        batch_op.create_index(
            'ix_lms_contracts_source_enrollment_id', ['source_enrollment_id'], unique=False,
        )
        batch_op.create_index(
            'ix_lms_contracts_applicant_full_name', ['applicant_full_name'], unique=False,
        )
        batch_op.create_index(
            'ix_lms_contracts_applicant_iin', ['applicant_iin'], unique=False,
        )

    # ── 3) lms_signatures ────────────────────────────────────────────────────
    op.create_table(
        'lms_signatures',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('lms_contract_id', sa.Integer(), nullable=False),
        sa.Column('signer_party', sa.String(length=20), nullable=False),
        sa.Column('signer_full_name', sa.String(length=200), nullable=True),
        sa.Column('signer_iin_or_bin', sa.String(length=20), nullable=True),
        sa.Column('signer_serial', sa.String(length=80), nullable=True),
        sa.Column('signer_certificate_pem', sa.Text(), nullable=True),
        sa.Column('cms_signature', sa.Text(), nullable=False),
        sa.Column('signed_payload_sha256', sa.String(length=80), nullable=False),
        sa.Column('verification_level', sa.String(length=20), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ['lms_contract_id'], ['lms_contracts.id'], ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'lms_contract_id', 'signer_party', name='uq_lms_sig_party',
        ),
    )
    with op.batch_alter_table('lms_signatures', schema=None) as batch_op:
        batch_op.create_index(
            'ix_lms_signatures_lms_contract_id', ['lms_contract_id'], unique=False,
        )

    # ── 4) lms_signing_requests ──────────────────────────────────────────────
    op.create_table(
        'lms_signing_requests',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('lms_contract_id', sa.Integer(), nullable=False),
        sa.Column('signer_party', sa.String(length=20), nullable=False),
        sa.Column('recipient_name', sa.String(length=200), nullable=True),
        sa.Column('recipient_iin', sa.String(length=20), nullable=True),
        sa.Column('token', sa.String(length=64), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('viewed_at', sa.DateTime(), nullable=True),
        sa.Column('signed_at', sa.DateTime(), nullable=True),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ['lms_contract_id'], ['lms_contracts.id'], ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token', name='uq_lms_signing_requests_token'),
    )
    with op.batch_alter_table('lms_signing_requests', schema=None) as batch_op:
        batch_op.create_index(
            'ix_lms_signing_requests_lms_contract_id', ['lms_contract_id'], unique=False,
        )
        batch_op.create_index(
            'ix_lms_signing_requests_token', ['token'], unique=False,
        )

    # ── 5) BACKFILL: enrollment_contracts(include_lms=1) → lms_contracts ─────
    conn = op.get_bind()
    now = _now()

    # Pull every enrollment row that materially has an LMS contract on disk.
    src_rows = conn.execute(
        sa.text(
            """
            SELECT id, number, contract_date, year,
                   applicant_full_name, applicant_iin, applicant_birth_date,
                   applicant_id_doc_number, applicant_id_doc_issued_by,
                   applicant_id_doc_issued_date,
                   applicant_address_city, applicant_address_district,
                   applicant_address_street, applicant_address_house,
                   applicant_phone, applicant_home_phone, applicant_email,
                   parent_full_name, parent_iin, parent_relation, parent_address,
                   parent_phone, parent_email,
                   specialty, specialty_code, qualification,
                   education_base, study_form, course,
                   include_lms, lms_docx_path, lms_pdf_path,
                   status, created_at, updated_at
              FROM enrollment_contracts
             WHERE lms_docx_path IS NOT NULL
            """
        )
    ).mappings().all()
    src_rows = [r for r in src_rows if _truthy(r["include_lms"])]

    expected_lms_count = len(src_rows)

    # Seed `taken` sets so generated numbers/codes/tokens stay unique inside
    # this loop (the DB is otherwise empty for these tables on first run).
    taken_numbers: set[str] = set()
    taken_verify_codes: set[str] = set()

    enroll_to_lms: dict[int, int] = {}

    for row in src_rows:
        enrollment_id = row["id"]
        applicant_iin = (row["applicant_iin"] or "").strip() or None
        applicant_full_name = (row["applicant_full_name"] or "").strip() or "—"

        # Resolve student_id: existing by IIN, else INSERT stub.
        student_id = None
        if applicant_iin:
            existing = conn.execute(
                sa.text("SELECT id FROM students WHERE iin = :iin"),
                {"iin": applicant_iin},
            ).first()
            if existing is not None:
                student_id = existing[0]

        if student_id is None:
            # Stub student. Force is_grant_student=1 to satisfy the invariant.
            ins = conn.execute(
                sa.text(
                    """
                    INSERT INTO students
                        (full_name, iin, is_grant_student, created_at, updated_at)
                    VALUES
                        (:full_name, :iin, :is_grant, :created_at, :updated_at)
                    """
                ),
                {
                    "full_name": applicant_full_name,
                    "iin": applicant_iin,
                    "is_grant": True,  # bind as boolean — driver casts per dialect
                    "created_at": now,
                    "updated_at": now,
                },
            )
            # SQLite + PostgreSQL both support lastrowid via cursor; fall back
            # to a SELECT if the driver doesn't expose it.
            new_sid = getattr(ins, "lastrowid", None)
            if new_sid is None and applicant_iin:
                got = conn.execute(
                    sa.text("SELECT id FROM students WHERE iin = :iin"),
                    {"iin": applicant_iin},
                ).first()
                new_sid = got[0] if got else None
            if new_sid is None:
                # Last-ditch fallback: most recent matching name.
                got = conn.execute(
                    sa.text(
                        "SELECT id FROM students WHERE full_name = :n "
                        "ORDER BY id DESC LIMIT 1"
                    ),
                    {"n": applicant_full_name},
                ).first()
                new_sid = got[0] if got else None
            student_id = new_sid
        else:
            # Force the grant flag on for the grandfathered Student row.
            conn.execute(
                sa.text(
                    "UPDATE students SET is_grant_student = :flag WHERE id = :sid"
                ),
                {"flag": True, "sid": student_id},
            )

        if student_id is None:
            raise RuntimeError(
                f"backfill: failed to resolve/create Student for enrollment "
                f"id={enrollment_id} (iin={applicant_iin!r})"
            )

        # Number: keep the original if it's already LMS-prefixed; otherwise
        # rewrite an 'ОУ-' prefix into 'LMS-'; otherwise mint a fresh one.
        original_number = (row["number"] or "").strip() or None
        new_number: str | None = None
        if original_number:
            if original_number.upper().startswith("LMS-"):
                new_number = original_number
            elif _OU_PREFIX_RE.match(original_number):
                new_number = _OU_PREFIX_RE.sub("LMS-", original_number, count=1)
            else:
                new_number = original_number
        # If the candidate collides with one we already inserted this run, fall
        # back to a generated number.
        if new_number is None or new_number in taken_numbers:
            new_number = _suggest_lms_number(row["year"], taken_numbers)
        taken_numbers.add(new_number)

        # Status: 'signed' if any LMS signature already exists on the
        # enrollment, else 'generated' (we know the DOCX is on disk).
        sig_count = conn.execute(
            sa.text(
                "SELECT COUNT(*) FROM enrollment_signatures "
                "WHERE enrollment_id = :eid AND document = 'lms'"
            ),
            {"eid": enrollment_id},
        ).scalar() or 0
        new_status = "signed" if int(sig_count) > 0 else "generated"

        verify_code = _generate_verify_code(taken_verify_codes)

        ins_lms = conn.execute(
            sa.text(
                """
                INSERT INTO lms_contracts (
                    number, contract_date, year,
                    student_id, source_enrollment_id,
                    applicant_full_name, applicant_iin, applicant_birth_date,
                    applicant_id_doc_number, applicant_id_doc_issued_by,
                    applicant_id_doc_issued_date,
                    applicant_address_city, applicant_address_district,
                    applicant_address_street, applicant_address_house,
                    applicant_phone, applicant_home_phone, applicant_email,
                    parent_full_name, parent_iin, parent_relation, parent_address,
                    parent_phone, parent_email,
                    specialty, specialty_code, qualification,
                    education_base, study_form, course,
                    grant_order_number, grant_order_date, funding_source,
                    is_grant_at_signing,
                    docx_path, pdf_path,
                    status, verify_code, notes,
                    created_at, updated_at
                ) VALUES (
                    :number, :contract_date, :year,
                    :student_id, :source_enrollment_id,
                    :applicant_full_name, :applicant_iin, :applicant_birth_date,
                    :applicant_id_doc_number, :applicant_id_doc_issued_by,
                    :applicant_id_doc_issued_date,
                    :applicant_address_city, :applicant_address_district,
                    :applicant_address_street, :applicant_address_house,
                    :applicant_phone, :applicant_home_phone, :applicant_email,
                    :parent_full_name, :parent_iin, :parent_relation, :parent_address,
                    :parent_phone, :parent_email,
                    :specialty, :specialty_code, :qualification,
                    :education_base, :study_form, :course,
                    :grant_order_number, :grant_order_date, :funding_source,
                    :is_grant,
                    :docx_path, :pdf_path,
                    :status, :verify_code, :notes,
                    :created_at, :updated_at
                )
                """
            ),
            {
                "number": new_number,
                "contract_date": row["contract_date"],
                "year": row["year"],
                "student_id": student_id,
                "source_enrollment_id": enrollment_id,
                "applicant_full_name": applicant_full_name,
                "applicant_iin": applicant_iin,
                "applicant_birth_date": row["applicant_birth_date"],
                "applicant_id_doc_number": row["applicant_id_doc_number"],
                "applicant_id_doc_issued_by": row["applicant_id_doc_issued_by"],
                "applicant_id_doc_issued_date": row["applicant_id_doc_issued_date"],
                "applicant_address_city": row["applicant_address_city"],
                "applicant_address_district": row["applicant_address_district"],
                "applicant_address_street": row["applicant_address_street"],
                "applicant_address_house": row["applicant_address_house"],
                "applicant_phone": row["applicant_phone"],
                "applicant_home_phone": row["applicant_home_phone"],
                "applicant_email": row["applicant_email"],
                "parent_full_name": row["parent_full_name"],
                "parent_iin": row["parent_iin"],
                "parent_relation": row["parent_relation"],
                "parent_address": row["parent_address"],
                "parent_phone": row["parent_phone"],
                "parent_email": row["parent_email"],
                "specialty": row["specialty"],
                "specialty_code": row["specialty_code"],
                "qualification": row["qualification"],
                "education_base": row["education_base"],
                "study_form": row["study_form"],
                "course": row["course"],
                "grant_order_number": None,
                "grant_order_date": None,
                "funding_source": "госзаказ",
                "is_grant": True,  # bind as boolean — driver casts per dialect
                "docx_path": row["lms_docx_path"],  # bytes don't move
                "pdf_path": row["lms_pdf_path"],
                "status": new_status,
                "verify_code": verify_code,
                "notes": None,
                "created_at": row["created_at"] or now,
                "updated_at": row["updated_at"] or now,
            },
        )
        new_lms_id = getattr(ins_lms, "lastrowid", None)
        if new_lms_id is None:
            got = conn.execute(
                sa.text(
                    "SELECT id FROM lms_contracts WHERE verify_code = :v"
                ),
                {"v": verify_code},
            ).first()
            new_lms_id = got[0] if got else None
        if new_lms_id is None:
            raise RuntimeError(
                f"backfill: failed to resolve new lms_contracts.id for "
                f"enrollment id={enrollment_id}"
            )
        enroll_to_lms[enrollment_id] = new_lms_id

    # ── 6) Migrate enrollment_signatures(document='lms') → lms_signatures ───
    expected_sig_count = 0
    if enroll_to_lms:
        sig_rows = conn.execute(
            sa.text(
                """
                SELECT id, enrollment_id, signer_party,
                       signer_full_name, signer_iin_or_bin, signer_serial,
                       signer_certificate_pem,
                       cms_signature, signed_payload_sha256,
                       verification_level, created_at
                  FROM enrollment_signatures
                 WHERE document = 'lms'
                """
            )
        ).mappings().all()
        expected_sig_count = len(sig_rows)
        for s in sig_rows:
            lms_id = enroll_to_lms.get(s["enrollment_id"])
            if lms_id is None:
                # An LMS-signed enrollment without a corresponding LMS aggregate
                # row would mean inconsistent input data — raise so the txn
                # rolls back instead of silently dropping a legal signature.
                raise RuntimeError(
                    f"backfill: orphan lms-signature id={s['id']} for "
                    f"enrollment_id={s['enrollment_id']} has no matching "
                    f"lms_contract"
                )
            conn.execute(
                sa.text(
                    """
                    INSERT INTO lms_signatures (
                        lms_contract_id, signer_party,
                        signer_full_name, signer_iin_or_bin, signer_serial,
                        signer_certificate_pem,
                        cms_signature, signed_payload_sha256,
                        verification_level, created_at
                    ) VALUES (
                        :lms_contract_id, :signer_party,
                        :signer_full_name, :signer_iin_or_bin, :signer_serial,
                        :signer_certificate_pem,
                        :cms_signature, :signed_payload_sha256,
                        :verification_level, :created_at
                    )
                    """
                ),
                {
                    "lms_contract_id": lms_id,
                    "signer_party": s["signer_party"],
                    "signer_full_name": s["signer_full_name"],
                    "signer_iin_or_bin": s["signer_iin_or_bin"],
                    "signer_serial": s["signer_serial"],
                    "signer_certificate_pem": s["signer_certificate_pem"],
                    "cms_signature": s["cms_signature"],
                    "signed_payload_sha256": s["signed_payload_sha256"],
                    "verification_level": s["verification_level"] or "full",
                    "created_at": s["created_at"] or now,
                },
            )

    # ── 7) Python asserts so a mismatch rolls the txn back ──────────────────
    got_lms_contracts = conn.execute(
        sa.text("SELECT COUNT(*) FROM lms_contracts")
    ).scalar() or 0
    got_lms_signatures = conn.execute(
        sa.text("SELECT COUNT(*) FROM lms_signatures")
    ).scalar() or 0
    if int(got_lms_contracts) != int(expected_lms_count):
        raise RuntimeError(
            f"backfill assert failed: lms_contracts={got_lms_contracts} "
            f"!= expected {expected_lms_count}"
        )
    if int(got_lms_signatures) != int(expected_sig_count):
        raise RuntimeError(
            f"backfill assert failed: lms_signatures={got_lms_signatures} "
            f"!= expected {expected_sig_count}"
        )

    # ── 8) Delete migrated LMS signatures from enrollment_signatures ────────
    op.execute(sa.text("DELETE FROM enrollment_signatures WHERE document='lms'"))

    # ── 9) Drop legacy LMS columns from enrollment_contracts ────────────────
    # IMPORTANT (SQLite): batch_alter_table rebuilds the parent table by
    # rename + DROP. With PRAGMA foreign_keys=ON, dropping the old
    # `enrollment_contracts` fires the `lms_contracts.source_enrollment_id`
    # FK's ON DELETE SET NULL action, nulling the back-link we just
    # populated in step 5. PRAGMA foreign_keys is a no-op inside a
    # transaction, so we can't simply flip it. Instead: snapshot the
    # (lms_id → enrollment_id) map in Python, perform the batch rebuild
    # (which clears `source_enrollment_id`), then restore the map by UPDATE.
    saved_links: dict[int, int] = {}
    is_sqlite = conn.dialect.name == 'sqlite'
    if is_sqlite:
        for lid, eid in conn.execute(
            sa.text(
                "SELECT id, source_enrollment_id FROM lms_contracts "
                "WHERE source_enrollment_id IS NOT NULL"
            )
        ).all():
            saved_links[lid] = eid

    with op.batch_alter_table('enrollment_contracts', schema=None) as batch_op:
        batch_op.drop_column('lms_pdf_path')
        batch_op.drop_column('lms_docx_path')
        batch_op.drop_column('include_lms')

    if saved_links:
        for lid, eid in saved_links.items():
            conn.execute(
                sa.text(
                    "UPDATE lms_contracts SET source_enrollment_id = :eid "
                    "WHERE id = :lid"
                ),
                {"eid": eid, "lid": lid},
            )


def downgrade():
    conn = op.get_bind()
    now = _now()

    # Snapshot lms_contracts FIRST: the upcoming batch_alter_table on
    # `enrollment_contracts` rebuilds the parent table (rename + DROP), which
    # — with foreign_keys=ON — fires `lms_contracts.source_enrollment_id`'s
    # ON DELETE SET NULL action, nulling out the back-link we need to
    # restore. We can't disable the pragma inside a transaction (no-op), so
    # we capture the linkage in Python before the rebuild.
    lms_rows = conn.execute(
        sa.text(
            """
            SELECT id, source_enrollment_id, docx_path, pdf_path
              FROM lms_contracts
             WHERE source_enrollment_id IS NOT NULL
            """
        )
    ).mappings().all()
    lms_to_enroll: dict[int, int] = {
        lr["id"]: lr["source_enrollment_id"] for lr in lms_rows
    }
    lms_paths: dict[int, tuple[str | None, str | None]] = {
        lr["id"]: (lr["docx_path"], lr["pdf_path"]) for lr in lms_rows
    }

    # Also snapshot lms_signatures so we can rewrite enrollment_signatures rows
    # back even after the batch rebuild has invalidated FK chains.
    sig_rows = conn.execute(
        sa.text(
            """
            SELECT lms_contract_id, signer_party,
                   signer_full_name, signer_iin_or_bin, signer_serial,
                   signer_certificate_pem,
                   cms_signature, signed_payload_sha256,
                   verification_level, created_at
              FROM lms_signatures
            """
        )
    ).mappings().all()

    # ── Reverse step 9: re-add legacy columns (nullable) ────────────────────
    with op.batch_alter_table('enrollment_contracts', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'include_lms', sa.Boolean(),
                nullable=False, server_default=sa.false(),
            )
        )
        batch_op.add_column(
            sa.Column('lms_docx_path', sa.String(length=500), nullable=True)
        )
        batch_op.add_column(
            sa.Column('lms_pdf_path', sa.String(length=500), nullable=True)
        )

    # ── Reverse steps 5+6: copy paths + signatures back to enrollment side ──
    # (using the snapshot, so we don't depend on lms_contracts.source_enrollment_id
    # still being populated after the batch rebuild).
    for lid, eid in lms_to_enroll.items():
        docx, pdf = lms_paths[lid]
        conn.execute(
            sa.text(
                """
                UPDATE enrollment_contracts
                   SET include_lms = :flag,
                       lms_docx_path = :docx,
                       lms_pdf_path = :pdf
                 WHERE id = :eid
                """
            ),
            {"flag": True, "docx": docx, "pdf": pdf, "eid": eid},
        )

    if lms_to_enroll:
        sig_rows = conn.execute(
            sa.text(
                """
                SELECT lms_contract_id, signer_party,
                       signer_full_name, signer_iin_or_bin, signer_serial,
                       signer_certificate_pem,
                       cms_signature, signed_payload_sha256,
                       verification_level, created_at
                  FROM lms_signatures
                """
            )
        ).mappings().all()
        for s in sig_rows:
            eid = lms_to_enroll.get(s["lms_contract_id"])
            if eid is None:
                # Signature belongs to a non-restorable LMS contract — skip.
                continue
            conn.execute(
                sa.text(
                    """
                    INSERT INTO enrollment_signatures (
                        enrollment_id, document, signer_party,
                        signer_full_name, signer_iin_or_bin, signer_serial,
                        signer_certificate_pem,
                        cms_signature, signed_payload_sha256,
                        verification_level, created_at
                    ) VALUES (
                        :eid, 'lms', :signer_party,
                        :signer_full_name, :signer_iin_or_bin, :signer_serial,
                        :signer_certificate_pem,
                        :cms_signature, :signed_payload_sha256,
                        :verification_level, :created_at
                    )
                    """
                ),
                {
                    "eid": eid,
                    "signer_party": s["signer_party"],
                    "signer_full_name": s["signer_full_name"],
                    "signer_iin_or_bin": s["signer_iin_or_bin"],
                    "signer_serial": s["signer_serial"],
                    "signer_certificate_pem": s["signer_certificate_pem"],
                    "cms_signature": s["cms_signature"],
                    "signed_payload_sha256": s["signed_payload_sha256"],
                    "verification_level": s["verification_level"] or "full",
                    "created_at": s["created_at"] or now,
                },
            )

    # ── Reverse steps 2-4: drop the three new tables (children first) ───────
    with op.batch_alter_table('lms_signing_requests', schema=None) as batch_op:
        batch_op.drop_index('ix_lms_signing_requests_token')
        batch_op.drop_index('ix_lms_signing_requests_lms_contract_id')
    op.drop_table('lms_signing_requests')

    with op.batch_alter_table('lms_signatures', schema=None) as batch_op:
        batch_op.drop_index('ix_lms_signatures_lms_contract_id')
    op.drop_table('lms_signatures')

    with op.batch_alter_table('lms_contracts', schema=None) as batch_op:
        batch_op.drop_index('ix_lms_contracts_applicant_iin')
        batch_op.drop_index('ix_lms_contracts_applicant_full_name')
        batch_op.drop_index('ix_lms_contracts_source_enrollment_id')
        batch_op.drop_index('ix_lms_contracts_student_id')
        batch_op.drop_index('ix_lms_contracts_status')
        batch_op.drop_index('ix_lms_contracts_year')
        batch_op.drop_index('ix_lms_contracts_verify_code')
        batch_op.drop_index('ix_lms_contracts_number')
    op.drop_table('lms_contracts')

    # ── Reverse step 1: drop students.is_grant_student ──────────────────────
    op.drop_index('ix_students_is_grant_student', table_name='students')
    with op.batch_alter_table('students', schema=None) as batch_op:
        batch_op.drop_column('is_grant_student')
