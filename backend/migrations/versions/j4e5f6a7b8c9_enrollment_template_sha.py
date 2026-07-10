"""enrollment_contracts: contract_template_sha / consent_template_sha

Adds two nullable SHA-256 columns to EnrollmentContract that record which
version of the docxtpl template was used to render each archived document.
The download endpoint compares the stored SHA against the CURRENT template
file's SHA and auto-regenerates the archive when they diverge — which
happens whenever the template builder code changes and the derivative
.docx gets rebuilt.

Why this exists: template-builder code changes (like adding then
reverting the 9/11 payment-section wrapping) rebuild the derivative
template on the next boot, but the ALREADY-ARCHIVED contract/consent
files for prior enrollments stay frozen. Users then see a document
rendered by the old code even though the fix is live. This column lets
the download route detect that mismatch and transparently re-render.

SAFETY: auto-regeneration is only triggered for enrollments WITHOUT
signatures — the signed DOCX bytes are cryptographically bound to the
CMS and MUST NOT be altered. Signed enrollments keep their original
archived bytes. Backfill: existing rows get NULL, which the download
route treats as "unknown template version" and triggers a one-off
regeneration on the next download (again, only if unsigned).

Revision ID: j4e5f6a7b8c9
Revises: i3d4e5f6a7b8
Create Date: 2026-07-10 10:15:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "j4e5f6a7b8c9"
down_revision = "i3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("enrollment_contracts", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("contract_template_sha", sa.String(length=64), nullable=True)
        )
        batch_op.add_column(
            sa.Column("consent_template_sha", sa.String(length=64), nullable=True)
        )


def downgrade():
    with op.batch_alter_table("enrollment_contracts", schema=None) as batch_op:
        batch_op.drop_column("consent_template_sha")
        batch_op.drop_column("contract_template_sha")
