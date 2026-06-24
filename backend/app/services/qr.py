"""QR-code generation for document verification stamps.

The QR encodes a fully-qualified URL pointing at the public verification page
of the platform (`{public_base}/verify/<code>`), so a person can scan the
printed/PDF document with any phone and immediately see which signatures are
attached, when they were applied and to whom they belong.
"""
from __future__ import annotations

import io
import os

import qrcode
from qrcode.constants import ERROR_CORRECT_M


def generate_qr_png(payload: str, *, box_size: int = 10, border: int = 2) -> bytes:
    """Return PNG bytes for the given payload (URL or arbitrary text).

    ERROR_CORRECT_M (≈15% recovery) is the doodocs/eGov standard — readable
    even after photocopies or fax-grade compression.
    """
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=box_size,
        border=border,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#1F2024", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def public_verify_url(verification_code: str, base_url: str | None = None) -> str:
    """Build the absolute URL to embed in the QR-code.

    Resolution order:
      1. Explicit `base_url` argument (passed in from the request handler).
      2. `PUBLIC_BASE_URL` environment variable (set at deploy time).
      3. Empty → caller must handle (the URL becomes relative `/verify/<code>`).
    """
    base = (base_url or os.getenv("PUBLIC_BASE_URL") or "").rstrip("/")
    if base:
        return f"{base}/verify/{verification_code}"
    return f"/verify/{verification_code}"
