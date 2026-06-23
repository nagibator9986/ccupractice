"""Verification orchestrator: in-process checks + (optional) NCANode legal-grade.

`verify_cms_signature` is the single entry point the signing endpoints call. It:

1. Runs the in-process verification (`parse_cms_signature`) — this extracts the
   signer identity, enforces certificate validity, binds the signature to OUR
   document, and fully verifies RSA/ECDSA. GOST is accepted here (cryptography
   can't verify it) with a binding check.
2. If `NCANODE_URL` is configured, asks NCANode (official KalkanCrypt SDK) for a
   legal-grade verdict — GOST signature validity + certificate chain to the НУЦ
   root + revocation (OCSP/CRL). NCANode is AUTHORITATIVE: an invalid/revoked
   verdict rejects the signature (this is what closes the GOST gap for legally
   replacing paper contracts). If NCANode is unreachable we fall back to the
   in-process result with a warning — unless `NCANODE_STRICT` is on, in which
   case verification must not silently downgrade and we reject.

The result is a `ParsedSignature` whose `verification_level` reflects the
strongest check that actually ran (``legal`` once NCANode confirms it).
"""
from __future__ import annotations

from flask import current_app

from .signature_service import (
    ParsedSignature,
    SignatureError,
    parse_cms_signature,
    VERIFY_LEGAL,
)
from .ncanode_client import NCANodeError, verify_cms as ncanode_verify


def _bool_cfg(name: str, default: bool = False) -> bool:
    val = current_app.config.get(name)
    if isinstance(val, bool):
        return val
    if val is None:
        return default
    return str(val).strip().lower() in ("1", "true", "yes", "on")


def verify_cms_signature(cms_b64: str, payload_bytes: bytes) -> ParsedSignature:
    parsed = parse_cms_signature(cms_b64, payload_bytes)

    base_url = (current_app.config.get("NCANODE_URL") or "").strip()
    if not base_url:
        # No legal-grade verifier configured — in-process result stands. The
        # verification_level already tells the admin how strong that was.
        return parsed

    strict = _bool_cfg("NCANODE_STRICT", default=False)
    try:
        result = ncanode_verify(
            base_url,
            cms_b64,
            verify_ocsp=_bool_cfg("NCANODE_VERIFY_OCSP", default=True),
            verify_crl=_bool_cfg("NCANODE_VERIFY_CRL", default=False),
        )
    except NCANodeError as exc:
        current_app.logger.warning("NCANode verification unavailable: %s", exc)
        if strict:
            raise SignatureError(
                "Сервис проверки подписи (НУЦ РК) недоступен. Подпись не может быть "
                "принята до восстановления проверки. Повторите позже."
            ) from exc
        parsed.warnings.append(
            "Полная проверка НУЦ РК временно недоступна — подпись принята по локальной "
            "проверке. Рекомендуется перепроверить позже."
        )
        return parsed

    if result.revoked:
        raise SignatureError("Сертификат подписанта отозван (НУЦ РК / OCSP-CRL).")
    if not result.valid:
        detail = f" ({result.reason})" if result.reason else ""
        raise SignatureError(f"НУЦ РК: электронная подпись недействительна{detail}.")

    # NCANode confirmed signature + chain (+ optional OCSP). This is the legal
    # grade — prefer NCANode's identity if it returned one, else keep ours.
    parsed.verification_level = VERIFY_LEGAL
    if result.signer_full_name and not parsed.signer_full_name:
        parsed.signer_full_name = result.signer_full_name
    if result.signer_iin_or_bin and not parsed.signer_iin_or_bin:
        parsed.signer_iin_or_bin = result.signer_iin_or_bin
    parsed.warnings.append(
        "Проверено НУЦ РК: подпись, цепочка сертификата"
        + (" и статус отзыва (OCSP/CRL)." if result.ocsp_checked else ".")
    )
    return parsed
