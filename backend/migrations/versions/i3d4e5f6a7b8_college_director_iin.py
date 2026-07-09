"""college_settings.director_iin

Adds the optional director's personal ИИН to CollegeSettings. Populated only
when the director signs enrollments with a PERSONAL ЭЦП certificate (the
common case in KZ colleges). The college-signing endpoint uses this value
alongside the org БИН as an "either matches" identity check so a normal
director sign no longer triggers a spurious "identity mismatch" warning.

Additive change: existing rows get an empty-string default; no data is
deleted or altered.

Revision ID: i3d4e5f6a7b8
Revises: h2c3d4e5f6a7
Create Date: 2026-07-09 10:15:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "i3d4e5f6a7b8"
down_revision = "h2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade():
    # batch_alter_table so SQLite (dev) also succeeds — Postgres runs it as a
    # single ALTER TABLE ADD COLUMN under the hood.
    with op.batch_alter_table("college_settings", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("director_iin", sa.String(length=20), nullable=True, server_default="")
        )


def downgrade():
    with op.batch_alter_table("college_settings", schema=None) as batch_op:
        batch_op.drop_column("director_iin")
