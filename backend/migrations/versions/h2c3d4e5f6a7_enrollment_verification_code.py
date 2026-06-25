"""enrollment verification code for QR stamp + signature certificate

Adds `enrollment_contracts.verification_code` so each enrollment can be:
  - QR-stamped at generation (the QR resolves to /verify/<code>);
  - reached via the public verifier endpoint and the SPA verify page;
  - referenced from the on-demand "Сертификат подписания" PDF the admin
    generates for already-signed enrollments to give signers a downloadable
    proof of signing (the original signed bytes are not modified — that
    would invalidate every existing CMS payload).

Two-phase column add so backfill is atomic on Postgres + SQLite:
  1) add nullable
  2) backfill every existing row with a unique URL-safe token
  3) set NOT NULL + create UNIQUE constraint + index

Revision ID: h2c3d4e5f6a7
Revises: g1b2c3d4e5f6
Create Date: 2026-08-01 09:00:00.000000

"""
import secrets

from alembic import op
import sqlalchemy as sa


revision = 'h2c3d4e5f6a7'
down_revision = 'g1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('enrollment_contracts', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('verification_code', sa.String(length=24), nullable=True)
        )

    # Backfill every existing row with a unique token.
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id FROM enrollment_contracts")).fetchall()
    taken: set[str] = set()
    for (eid,) in rows:
        while True:
            code = secrets.token_urlsafe(12)
            if code not in taken:
                taken.add(code)
                break
        conn.execute(
            sa.text(
                "UPDATE enrollment_contracts SET verification_code = :c WHERE id = :i"
            ),
            {"c": code, "i": eid},
        )

    with op.batch_alter_table('enrollment_contracts', schema=None) as batch_op:
        batch_op.alter_column(
            'verification_code',
            existing_type=sa.String(length=24),
            nullable=False,
        )
        batch_op.create_unique_constraint(
            'uq_enrollment_contracts_verification_code', ['verification_code']
        )
        batch_op.create_index(
            'ix_enrollment_contracts_verification_code',
            ['verification_code'],
            unique=False,
        )


def downgrade():
    with op.batch_alter_table('enrollment_contracts', schema=None) as batch_op:
        batch_op.drop_index('ix_enrollment_contracts_verification_code')
        batch_op.drop_constraint(
            'uq_enrollment_contracts_verification_code', type_='unique'
        )
        batch_op.drop_column('verification_code')
