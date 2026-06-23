"""record signature verification level

Revision ID: e9f3a4b5c6d7
Revises: d8e2f3a4b5c6
Create Date: 2026-06-23 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e9f3a4b5c6d7'
down_revision = 'd8e2f3a4b5c6'
branch_labels = None
depends_on = None


def upgrade():
    # Existing rows predate the field; they were RSA/ECDSA fully-verified, so
    # default them to 'full'.
    for table in ('signatures', 'enrollment_signatures'):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(
                sa.Column('verification_level', sa.String(length=20),
                          nullable=False, server_default='full')
            )


def downgrade():
    for table in ('signatures', 'enrollment_signatures'):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_column('verification_level')
