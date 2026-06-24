"""Build the docxtpl-ready template for the standalone LMS contract.

The LMS contract is the «Договор о подключении к цифровой экосистеме Caspian
Digital» — bilingual (қазақша + русский), two-column table layout. Per the
project guide (``CLAUDE.md`` §4) we never hand-rebuild the official document:
the pristine ``source_contract_lms.docx`` lives in
``templates_docx/source/`` and this module injects ``{{ jinja }}`` tags
**only into the blank fill-in fields**, leaving every byte of the official
layout intact.

This file extracts the LMS-specific portions from
``services.enrollment_template_builder`` (``LMS_FILLS``, ``_LMS_EXPECTED``,
``build_lms_template``) into a standalone module so the new ``LmsContract``
aggregate has its own template lifecycle separate from the enrollment package.
The fill map, expected-replacement count and source-DOCX filename are kept
identical so existing template fidelity tests still pass.

Produced template (rendered later by :mod:`lms_documents`):
  * contract_lms_solo_template_v1.docx — «Договор о подключении к цифровой
    экосистеме Caspian Digital» (bilingual KZ/RU)

A separate output filename (``..._solo_...``) is used so that bumping the LMS
solo template's version cannot collide with the enrollment-package's
``contract_lms_template_v1.docx`` even though the two are byte-identical today.
"""
from __future__ import annotations

from pathlib import Path

# Re-use the heavy lifting from the enrollment builder (single source of truth
# for the fill primitives + LMS-specific fill map). Importing the constants
# directly means a fix to ``LMS_FILLS`` lands in both code paths automatically.
from .enrollment_template_builder import (
    LMS_FILLS,
    SOURCE_DIRNAME,
    SOURCE_LMS,
    _LMS_EXPECTED,
    _build_from_source,
)


# Bump the filename to force regeneration when the injection logic changes
# (``ensure_lms_templates`` only builds a file that doesn't already exist).
LMS_SOLO_FILENAME = "contract_lms_solo_template_v1.docx"


def build_lms_solo_template(out_path: str | Path, source_dir: str | Path) -> Path:
    """Build the standalone LMS template from the pristine bilingual source.

    Mirrors :func:`enrollment_template_builder.build_lms_template` but writes to
    ``LMS_SOLO_FILENAME`` so the solo aggregate has its own template lifecycle.
    """
    source = Path(source_dir) / SOURCE_LMS
    return _build_from_source(source, LMS_FILLS, _LMS_EXPECTED, Path(out_path))


def ensure_lms_templates(templates_dir: str | Path) -> dict:
    """Build any missing LMS template into ``templates_dir`` and return paths.

    Sources live in ``templates_dir/source/``. Idempotent — only builds files
    that don't already exist on disk (matching ``ensure_enrollment_templates``).
    """
    templates_dir = Path(templates_dir)
    templates_dir.mkdir(parents=True, exist_ok=True)
    source_dir = templates_dir / SOURCE_DIRNAME

    lms = templates_dir / LMS_SOLO_FILENAME
    if not lms.exists():
        build_lms_solo_template(lms, source_dir)

    return {"lms": lms}


__all__ = [
    "LMS_SOLO_FILENAME",
    "build_lms_solo_template",
    "ensure_lms_templates",
]
