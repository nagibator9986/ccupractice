"""enrollment optional LMS (Caspian Digital) document

Revision ID: d8e2f3a4b5c6
Revises: c7d1e2f3a4b5
Create Date: 2026-06-22 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd8e2f3a4b5c6'
down_revision = 'c7d1e2f3a4b5'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('enrollment_contracts', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('include_lms', sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.add_column(sa.Column('lms_docx_path', sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column('lms_pdf_path', sa.String(length=500), nullable=True))


def downgrade():
    with op.batch_alter_table('enrollment_contracts', schema=None) as batch_op:
        batch_op.drop_column('lms_pdf_path')
        batch_op.drop_column('lms_docx_path')
        batch_op.drop_column('include_lms')
