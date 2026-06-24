"""contract verification code for QR stamp

Revision ID: f0a4b5c6d7e8
Revises: e9f3a4b5c6d7
Create Date: 2026-07-01 10:00:00.000000

"""
import secrets

from alembic import op
import sqlalchemy as sa


revision = 'f0a4b5c6d7e8'
down_revision = 'e9f3a4b5c6d7'
branch_labels = None
depends_on = None


def upgrade():
    # Two-phase add: nullable first, backfill existing rows with unique codes,
    # then enforce NOT NULL and uniqueness.
    with op.batch_alter_table('contracts', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('verification_code', sa.String(length=24), nullable=True)
        )

    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id FROM contracts")).fetchall()
    used: set[str] = set()
    for (cid,) in rows:
        while True:
            code = secrets.token_urlsafe(12)
            if code not in used:
                used.add(code)
                break
        conn.execute(
            sa.text("UPDATE contracts SET verification_code = :c WHERE id = :i"),
            {"c": code, "i": cid},
        )

    with op.batch_alter_table('contracts', schema=None) as batch_op:
        batch_op.alter_column(
            'verification_code',
            existing_type=sa.String(length=24),
            nullable=False,
        )
        batch_op.create_unique_constraint(
            'uq_contracts_verification_code', ['verification_code']
        )
        batch_op.create_index(
            'ix_contracts_verification_code', ['verification_code'], unique=False
        )


def downgrade():
    with op.batch_alter_table('contracts', schema=None) as batch_op:
        batch_op.drop_index('ix_contracts_verification_code')
        batch_op.drop_constraint('uq_contracts_verification_code', type_='unique')
        batch_op.drop_column('verification_code')
