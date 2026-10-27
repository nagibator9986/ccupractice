"""eGov mobile signing: signature channel/format + signing sessions

Adds ``signatures.payload_format`` ('docx' | 'pdf') and ``signatures.channel``
('ncalayer' | 'egov_mobile') — every pre-existing row is an NCALayer signature
over the DOCX, which is exactly what the server defaults say — and the
``egov_sign_sessions`` table that tracks one QR / deep-link attempt.

Revision ID: k5f6a7b8c9d0
Revises: j4e5f6a7b8c9
Create Date: 2026-10-26 21:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "k5f6a7b8c9d0"
down_revision = "j4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("signatures", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("payload_format", sa.String(length=10), nullable=False, server_default="docx")
        )
        batch_op.add_column(
            sa.Column("channel", sa.String(length=20), nullable=False, server_default="ncalayer")
        )

    op.create_table(
        "egov_sign_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("signing_request_id", sa.Integer(), nullable=False),
        sa.Column("secret", sa.String(length=64), nullable=False),
        sa.Column("auth_token", sa.String(length=64), nullable=False),
        sa.Column("payload_sha256", sa.String(length=64), nullable=False),
        sa.Column("base_url", sa.String(length=300), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("opened_at", sa.DateTime(), nullable=True),
        sa.Column("signed_at", sa.DateTime(), nullable=True),
        sa.Column("signature_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["signing_request_id"], ["signing_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["signature_id"], ["signatures.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_egov_sign_sessions_secret", "egov_sign_sessions", ["secret"], unique=True)
    op.create_index("ix_egov_sign_sessions_signing_request_id", "egov_sign_sessions", ["signing_request_id"])


def downgrade():
    op.drop_index("ix_egov_sign_sessions_signing_request_id", table_name="egov_sign_sessions")
    op.drop_index("ix_egov_sign_sessions_secret", table_name="egov_sign_sessions")
    op.drop_table("egov_sign_sessions")
    with op.batch_alter_table("signatures", schema=None) as batch_op:
        batch_op.drop_column("channel")
        batch_op.drop_column("payload_format")
