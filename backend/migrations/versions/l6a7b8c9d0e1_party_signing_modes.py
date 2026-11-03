"""practice signing: legal representative + signing on paper with a scan

* students.sign_method          — 'ecp' (default) | 'scan'
* signing_requests              — method, signer_capacity and the uploaded-scan review fields
* signatures.signer_capacity    — 'self' | 'legal_representative'

Every existing row keeps today's behaviour through the server defaults
(electronic signature, the student signs for themselves).

Revision ID: l6a7b8c9d0e1
Revises: k5f6a7b8c9d0
Create Date: 2026-11-03 18:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "l6a7b8c9d0e1"
down_revision = "k5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("students", schema=None) as b:
        b.add_column(sa.Column("sign_method", sa.String(length=10), nullable=False, server_default="ecp"))
    with op.batch_alter_table("signing_requests", schema=None) as b:
        b.add_column(sa.Column("method", sa.String(length=10), nullable=False, server_default="ecp"))
        b.add_column(sa.Column("signer_capacity", sa.String(length=20), nullable=False, server_default="self"))
        b.add_column(sa.Column("scan_path", sa.String(length=500), nullable=True))
        b.add_column(sa.Column("scan_name", sa.String(length=200), nullable=True))
        b.add_column(sa.Column("scan_sha256", sa.String(length=64), nullable=True))
        b.add_column(sa.Column("scan_uploaded_at", sa.DateTime(), nullable=True))
        b.add_column(sa.Column("scan_review", sa.String(length=12), nullable=True))
        b.add_column(sa.Column("scan_review_note", sa.Text(), nullable=True))
        b.add_column(sa.Column("scan_reviewed_at", sa.DateTime(), nullable=True))
    with op.batch_alter_table("signatures", schema=None) as b:
        b.add_column(sa.Column("signer_capacity", sa.String(length=20), nullable=False, server_default="self"))


def downgrade():
    with op.batch_alter_table("signatures", schema=None) as b:
        b.drop_column("signer_capacity")
    with op.batch_alter_table("signing_requests", schema=None) as b:
        for col in ("scan_reviewed_at", "scan_review_note", "scan_review", "scan_uploaded_at",
                    "scan_sha256", "scan_name", "scan_path", "signer_capacity", "method"):
            b.drop_column(col)
    with op.batch_alter_table("students", schema=None) as b:
        b.drop_column("sign_method")
