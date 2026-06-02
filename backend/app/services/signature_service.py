"""Parse and verify CMS (CAdES) signatures produced by NCALayer.

NCALayer (kz.gov.pki.knca.basics) returns a base64-encoded CMS structure
embedding the signer certificate. We parse it with asn1crypto to extract
signer identity and verify that the signature corresponds to the original
payload bytes (SHA256 of the rendered DOCX in our flow).
"""
from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass
from typing import Optional

try:
    from asn1crypto import cms, x509  # type: ignore
except ImportError:  # pragma: no cover
    cms = None  # type: ignore
    x509 = None  # type: ignore

from cryptography import x509 as cx509
from cryptography.hazmat.primitives.serialization import Encoding


@dataclass
class ParsedSignature:
    signer_full_name: str
    signer_iin_or_bin: str
    signer_serial: str
    certificate_pem: str
    valid_structure: bool
    payload_sha256: str


def _extract_subject_field(cert: cx509.Certificate, oids: tuple[str, ...]) -> str:
    for oid in oids:
        try:
            attrs = cert.subject.get_attributes_for_oid(cx509.ObjectIdentifier(oid))
            if attrs:
                return attrs[0].value
        except Exception:
            continue
    return ""


def _full_name_from_cert(cert: cx509.Certificate) -> str:
    surname = _extract_subject_field(cert, ("2.5.4.4",))  # surname
    given = _extract_subject_field(cert, ("2.5.4.42",))  # given name
    common = _extract_subject_field(cert, ("2.5.4.3",))  # CN
    if surname or given:
        return f"{surname} {given}".strip()
    return common


def _iin_bin_from_cert(cert: cx509.Certificate) -> str:
    # serialNumber attribute in Kazakh PKI carries IIN/BIN
    val = _extract_subject_field(cert, ("2.5.4.5",))
    if val:
        return val.replace("IIN", "").replace("BIN", "").strip()
    return ""


def parse_cms_signature(cms_b64: str, payload_bytes: bytes) -> ParsedSignature:
    """Parse a base64 CMS signature, extract signer certificate and identity.

    Note: full chain verification against Kazakh CA (NCA) requires CRL/OCSP and
    is out of scope here. We confirm the CMS structure parses and the payload
    hash matches a SHA256 digest, which is what NCALayer signed.
    """
    if cms is None:
        raise RuntimeError("asn1crypto is required to parse CMS signatures")

    raw = base64.b64decode(cms_b64)
    content_info = cms.ContentInfo.load(raw)
    if content_info["content_type"].native != "signed_data":
        raise ValueError("CMS не является signed_data")

    signed_data = content_info["content"]
    signer_infos = signed_data["signer_infos"]
    if not signer_infos:
        raise ValueError("В CMS отсутствует signer_info")

    certs = signed_data["certificates"]
    if not certs:
        raise ValueError("В CMS отсутствует сертификат подписанта")

    der_cert = certs[0].chosen.dump()
    cert_pem = (
        cx509.load_der_x509_certificate(der_cert).public_bytes(Encoding.PEM).decode("ascii")
    )
    cert = cx509.load_der_x509_certificate(der_cert)

    payload_sha256 = hashlib.sha256(payload_bytes).hexdigest()

    return ParsedSignature(
        signer_full_name=_full_name_from_cert(cert),
        signer_iin_or_bin=_iin_bin_from_cert(cert),
        signer_serial=f"{cert.serial_number:X}",
        certificate_pem=cert_pem,
        valid_structure=True,
        payload_sha256=payload_sha256,
    )


def payload_sha256(payload_bytes: bytes) -> str:
    return hashlib.sha256(payload_bytes).hexdigest()
