"""On-the-fly merge of a base PDF + a signature-certificate annex.

Why an annex instead of modifying the original?
================================================
The signed payload of every ЭЦП is the **DOCX bytes** (SHA-256 hash bound into
the CMS structure). Touching the DOCX after signing invalidates every existing
``Signature`` row. But the PDF served as the human-readable view is NOT signed
— it is a one-way derivative of the signed DOCX. Modifying the PDF (or
appending pages to it) carries zero legal risk because nobody verifies the
PDF cryptographically: verification happens against the original DOCX bytes,
which we keep untouched.

This module produces, on demand, the PDF a user actually downloads:

  [ base PDF ──── original contract / consent / договор практики ]
  [ +annex ──── "Сертификат подписания": signers, masked IIN, time,
                verification level, QR code, public verify URL ]

Strategy
========
- Generate the signature-certificate DOCX, convert to PDF via the existing
  ``_convert_to_pdf`` (LibreOffice). Cache the result under the same archive
  subtree so a re-download doesn't pay the LibreOffice cost twice.
- Merge using ``pypdf`` — fast, no external process, preserves font subsets.
- Yield the merged file path. Caller streams it via ``send_file``.

Failure paths
=============
- If the base PDF doesn't exist (DOCX-only generation, LibreOffice missing in
  prod): return ``None`` and let the caller fall back to the raw DOCX or
  show an explicit error.
- If the certificate generator throws: log it and serve the base PDF as-is —
  the user still gets their original file; a missing visualization annex is
  not a reason to deny the download.
- If pypdf merge throws: same fallback.

NOTE on caching
================
The annex includes "Сформирован сертификат: dd.mm.YYYY HH:MM UTC" which means
the merged PDF will differ on every regeneration. We DO cache the certificate
PDF for a short window so two clicks within the same second produce identical
files; subsequent generations refresh the timestamp. This is a UX nicety, not
a correctness requirement — the verify URL is what matters legally.
"""
from __future__ import annotations

import hashlib
import io
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

from flask import current_app
from pypdf import PdfReader, PdfWriter


_CERTIFICATE_CACHE_TTL = timedelta(minutes=5)


def _cache_dir() -> Path:
    """Per-request short-lived merge cache (cleared on container restart)."""
    base = Path(tempfile.gettempdir()) / "ccu_pdf_merge_cache"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _signature_fingerprint(signatures) -> str:
    """Hash that changes whenever the signature set on the entity changes.

    Used as part of the cache key so a freshly-added signature invalidates a
    cached merged PDF without having to track creation timestamps explicitly.
    """
    h = hashlib.sha256()
    for s in sorted(signatures or [], key=lambda x: (x.id or 0)):
        h.update(str(s.id).encode())
        h.update((s.signed_payload_sha256 or "").encode())
        h.update((s.created_at.isoformat() if s.created_at else "").encode())
    return h.hexdigest()[:16]


def merge_pdf_with_certificate(
    *,
    base_pdf_path: Path,
    cache_key: str,
    certificate_builder: Callable[[Path], Path | None],
) -> Path | None:
    """Merge ``base_pdf_path`` with the certificate produced by ``certificate_builder``.

    Parameters
    ----------
    base_pdf_path:
        Absolute path to the original (signed-derived) PDF — the contract,
        consent, practicum, or LMS document.
    cache_key:
        Stable identifier for this (entity, signature-set) tuple. The merged
        output is keyed by ``cache_key`` and reused for 5 minutes.
    certificate_builder:
        Callback that, given an output directory, returns the absolute path of
        the certificate PDF to APPEND. May return ``None`` if the certificate
        couldn't be produced (e.g. LibreOffice unavailable) — in that case we
        return the base PDF path unchanged.

    Returns
    -------
    Absolute path to the merged PDF, or the base path when no merge happened,
    or ``None`` if the base PDF doesn't exist on disk.
    """
    if not base_pdf_path.is_file():
        return None

    cache = _cache_dir()
    out_path = cache / f"{cache_key}.pdf"
    now = datetime.utcnow()
    if out_path.is_file():
        age = now - datetime.utcfromtimestamp(out_path.stat().st_mtime)
        if age < _CERTIFICATE_CACHE_TTL:
            return out_path

    try:
        cert_path = certificate_builder(cache)
    except Exception:  # noqa: BLE001
        current_app.logger.exception(
            "Certificate builder threw — serving base PDF as-is for %s",
            base_pdf_path.name,
        )
        return base_pdf_path

    if not cert_path or not Path(cert_path).is_file():
        # LibreOffice may be missing; fall back to the base file.
        current_app.logger.warning(
            "Certificate PDF not produced — serving base PDF as-is for %s",
            base_pdf_path.name,
        )
        return base_pdf_path

    try:
        writer = PdfWriter()
        for src in (base_pdf_path, Path(cert_path)):
            with open(src, "rb") as fh:
                reader = PdfReader(fh)
                for page in reader.pages:
                    writer.add_page(page)
        # Write to a temp + rename for atomicity (parallel requests for the
        # same cache_key won't see a half-written file).
        tmp = out_path.with_suffix(".pdf.tmp")
        with open(tmp, "wb") as fh:
            writer.write(fh)
        tmp.replace(out_path)
        return out_path
    except Exception:
        current_app.logger.exception(
            "PDF merge failed — serving base PDF as-is for %s", base_pdf_path.name,
        )
        return base_pdf_path


# ────────────────────────────────────────────────────────────────────────────
# Convenience wrappers — one per aggregate. Each computes its own cache key
# and certificate builder, so the API layer just calls one of these.
# ────────────────────────────────────────────────────────────────────────────

def merge_enrollment_pdf(e, base_pdf_path: Path, *, public_base: str | None = None) -> Path | None:
    """Merge an enrollment contract/consent PDF with its signature certificate."""
    from .enrollment_certificate import generate_signature_certificate
    if not (e.signatures or []):
        # No signatures → no annex to append. Serve the base file.
        return base_pdf_path if base_pdf_path.is_file() else None

    fingerprint = _signature_fingerprint(e.signatures)
    cache_key = f"enroll_{e.id}_{base_pdf_path.stem}_{fingerprint}"

    def _builder(_out_dir: Path) -> Path | None:
        # Reuse the enrollment_certificate generator — it writes under the
        # archive tree, so we just hand off its PDF path. The DOCX is also
        # written but we only need the PDF for the merge.
        try:
            _docx_path, pdf_path = generate_signature_certificate(e, public_base=public_base)
        except Exception:
            current_app.logger.exception("enrollment certificate gen failed")
            return None
        return pdf_path

    return merge_pdf_with_certificate(
        base_pdf_path=base_pdf_path,
        cache_key=cache_key,
        certificate_builder=_builder,
    )
