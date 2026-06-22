"""specialties dictionary (раздел «Данные»)

Revision ID: c7d1e2f3a4b5
Revises: bcf6df38fb68
Create Date: 2026-06-22 10:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c7d1e2f3a4b5'
down_revision = 'bcf6df38fb68'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'specialties',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('code', sa.String(length=60), nullable=True),
        sa.Column('qualification', sa.String(length=200), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('specialties', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_specialties_name'), ['name'], unique=False)


def downgrade():
    with op.batch_alter_table('specialties', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_specialties_name'))
    op.drop_table('specialties')
