"""Thin client for NCANode — the official-SDK-backed CMS verifier.

NCANode (https://github.com/malikzh/NCANode) wraps НУЦ РК's KalkanCrypt and does
what `cryptography` cannot: verify GOST 34.10/34.11 signatures, validate the
certificate chain to the НУЦ root, and check revocation (OCSP/CRL). We run it as
a separate service and POST the CMS here for a legal-grade verdict.

This client is deliberately defensive about the response shape (NCANode's JSON
differs across 3.x builds), mirroring how the NCALayer client tolerates envelope
drift — we extract `valid`, the signer identity (ИИН/БИН + ФИО) and the
revocation status without hard-coding one exact schema.

Uses only the stdlib (urllib) so no extra runtime dependency is added.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field


class NCANodeError(Exception):
    """NCANode was configured but could not return a verdict (network/5xx/parse)."""


@dataclass
class NCANodeResult:
    valid: bool
    revoked: bool
    ocsp_checked: bool
    signer_full_name: str = ""
    signer_iin_or_bin: str = ""
    reason: str = ""
    raw: dict = field(default_factory=dict)


def _first(*values):
    for v in values:
        if v:
            return v
    return None


def _deep_find(obj, keys: set[str]):
    """Return the first non-empty value whose key is in `keys`, anywhere in obj."""
    stack = [obj]
    seen = 0
    while stack and seen < 5000:
        seen += 1
        cur = stack.pop()
        if isinstance(cur, dict):
            for k, v in cur.items():
                if k in keys and isinstance(v, (str, int)) and str(v).strip():
                    return str(v).strip()
            stack.extend(cur.values())
        elif isinstance(cur, list):
            stack.extend(cur)
    return None


def _digits(value: str | None) -> str:
    if not value:
        return ""
    s = str(value).replace("IIN", "").replace("BIN", "").strip()
    return "".join(ch for ch in s if ch.isdigit())


def _extract_identity(data: dict) -> tuple[str, str]:
    iin = _deep_find(data, {"iin", "bin", "serialNumber"})
    # serialNumber from a subject is often the raw IIN/BIN; keep only digits.
    iin = _digits(iin) if iin else ""
    name = _deep_find(data, {"commonName", "cn", "fullName"})
    if not name:
        last = _deep_find(data, {"lastName", "surname"})
        given = _deep_find(data, {"firstName", "givenName"})
        name = " ".join(p for p in (last, given) if p) or ""
    return name or "", iin or ""


def _is_revoked(data: dict) -> tuple[bool, bool]:
    """Return (revoked, ocsp_checked) from any ocsp/crl status fields present."""
    status = _deep_find(data, {"status", "ocspStatus", "revocationStatus"})
    if not status:
        return False, False
    s = str(status).strip().upper()
    ocsp_checked = True
    revoked = s in ("REVOKED", "REVOCATION", "CERT_REVOKED", "UNKNOWN")
    return revoked, ocsp_checked


def verify_cms(base_url: str, cms_b64: str, *, verify_ocsp: bool = True,
               verify_crl: bool = False, timeout: int = 20) -> NCANodeResult:
    """POST the CMS to NCANode's /cms/verify and return a structured verdict.

    Raises NCANodeError on any transport/parse failure so the caller can decide
    whether to fall back to the in-process check (non-strict) or reject (strict).
    """
    url = base_url.rstrip("/") + "/cms/verify"
    payload = {
        "cms": cms_b64,
        # NCANode 3.x accepts these flags under slightly different names across
        # builds; send the common ones — unknown keys are ignored server-side.
        "verifyOcsp": verify_ocsp,
        "checkOcsp": verify_ocsp,
        "verifyCrl": verify_crl,
        "checkCrl": verify_crl,
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw_bytes = resp.read()
    except urllib.error.HTTPError as e:
        # NCANode returns 4xx/5xx with a JSON body for an invalid signature too.
        try:
            data = json.loads(e.read().decode("utf-8"))
        except Exception:
            raise NCANodeError(f"NCANode HTTP {e.code}") from e
        return _result_from(data, default_valid=False)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise NCANodeError(f"NCANode недоступен: {e}") from e

    try:
        data = json.loads(raw_bytes.decode("utf-8"))
    except Exception as e:
        raise NCANodeError("NCANode вернул нечитаемый ответ") from e
    return _result_from(data, default_valid=False)


def _result_from(data: dict, *, default_valid: bool) -> NCANodeResult:
    if not isinstance(data, dict):
        raise NCANodeError("NCANode вернул неожиданный формат")
    # `valid` may be top-level or nested per signer; treat missing as default.
    valid = data.get("valid")
    if valid is None:
        nested = _deep_find(data, {"valid"})
        valid = (str(nested).lower() == "true") if nested is not None else default_valid
    valid = bool(valid)
    name, iin = _extract_identity(data)
    revoked, ocsp_checked = _is_revoked(data)
    reason = _first(
        data.get("message"), data.get("error"), _deep_find(data, {"message", "error"})
    ) or ""
    return NCANodeResult(
        valid=valid and not revoked,
        revoked=revoked,
        ocsp_checked=ocsp_checked,
        signer_full_name=name,
        signer_iin_or_bin=iin,
        reason=str(reason),
        raw=data,
    )
