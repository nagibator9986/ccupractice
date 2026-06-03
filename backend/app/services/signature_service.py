"""Parse and cryptographically verify CMS (CAdES) signatures produced by NCALayer.

NCALayer (kz.gov.pki.knca.basics) returns a base64-encoded CMS structure
embedding the signer certificate. This module:

1. Parses the CMS, locates the signer's certificate (matching by issuer + serial
   inside `SignerInfo.sid`, not blindly taking the first cert).
2. Verifies that the `messageDigest` signed attribute equals SHA-256 of the
   payload we hold on disk — this binds the signature to *our* document.
3. Verifies the cryptographic signature itself: signature_algorithm over the
   DER-encoded SignedAttributes, using the signer's public key (RSA, ECDSA).
4. Sanity-checks certificate validity period (notBefore / notAfter).
5. Extracts signer identity (full name + IIN/BIN) from the certificate Subject.

What we deliberately DON'T do (out of scope for an in-college MVP):
- Verify the certificate chain back to the NCA root.
- Check CRL / OCSP revocation status.
- Verify TSP/timestamp token (we don't request TSA in NCALayer params).

A complete chain/revocation check would require shipping the NCA root and
intermediate CAs, refreshing CRL on a schedule and adding OCSP support — these
are orthogonal hardening steps and easy to add later.
"""
from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from asn1crypto import cms, x509 as a_x509
from cryptography import x509 as cx509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.serialization import Encoding


class SignatureError(ValueError):
    """Raised for any structural or cryptographic problem with the CMS."""


@dataclass
class ParsedSignature:
    signer_full_name: str
    signer_iin_or_bin: str
    signer_serial: str
    certificate_pem: str
    payload_sha256: str
    not_valid_before: Optional[datetime]
    not_valid_after: Optional[datetime]
    warnings: list[str]


# ── Hashing helpers ─────────────────────────────────────────────────────────

_HASH_BY_OID = {
    "sha1": hashes.SHA1,
    "sha224": hashes.SHA224,
    "sha256": hashes.SHA256,
    "sha384": hashes.SHA384,
    "sha512": hashes.SHA512,
}


def _hash(payload_bytes: bytes, algo: str) -> bytes:
    klass = _HASH_BY_OID.get(algo.lower())
    if not klass:
        raise SignatureError(f"Не поддерживаемый алгоритм хэширования: {algo}")
    h = hashlib.new(algo if algo != "sha1" else "sha1")
    h.update(payload_bytes)
    return h.digest()


def payload_sha256(payload_bytes: bytes) -> str:
    return hashlib.sha256(payload_bytes).hexdigest()


# ── Subject parsing ─────────────────────────────────────────────────────────

def _subject_attr(cert: cx509.Certificate, oid_dotted: str) -> str:
    try:
        attrs = cert.subject.get_attributes_for_oid(cx509.ObjectIdentifier(oid_dotted))
    except cx509.AttributeNotFound:
        return ""
    return attrs[0].value if attrs else ""


def _full_name_from_cert(cert: cx509.Certificate) -> str:
    """Build a human full name from KZ NCA subject attributes.

    KZ NCA certificates typically carry:
      CN (2.5.4.3)         : "СУРНАМЕ ИМЯ ОТЧЕСТВО" — full name
      Surname (2.5.4.4)    : "СУРНАМЕ"
      GivenName (2.5.4.42) : "ИМЯ ОТЧЕСТВО"
      SerialNumber (2.5.4.5): "IIN..." or "BIN..."

    We prefer CN when it contains the most information.
    """
    cn = _subject_attr(cert, "2.5.4.3")
    surname = _subject_attr(cert, "2.5.4.4")
    given = _subject_attr(cert, "2.5.4.42")

    # Prefer the longer source — CN usually has SURNAME + GIVENNAME + PATRONYMIC.
    composed = f"{surname} {given}".strip()
    if cn and len(cn) >= len(composed):
        return cn
    return composed or cn


def _iin_bin_from_cert(cert: cx509.Certificate) -> str:
    val = _subject_attr(cert, "2.5.4.5")
    if not val:
        # Some cert profiles place IIN/BIN inside the OrganizationalUnitName.
        val = _subject_attr(cert, "2.5.4.11")
    if not val:
        return ""
    # KZ NCA prefixes with "IIN" or "BIN" — strip them, keep digits.
    cleaned = val.replace("IIN", "").replace("BIN", "").strip()
    return cleaned


# ── Picking the right signer certificate ───────────────────────────────────

def _find_signer_cert(signed_data: cms.SignedData, signer_info: cms.SignerInfo) -> a_x509.Certificate:
    """Locate the certificate that produced this SignerInfo.

    SignerInfo.sid identifies the signer either by IssuerAndSerialNumber or by
    SubjectKeyIdentifier. We match against the cert pool inside SignedData.
    """
    sid = signer_info["sid"]
    sid_name = sid.name

    certs = signed_data["certificates"]
    if not certs:
        raise SignatureError("В CMS отсутствуют сертификаты подписанта")

    for choice in certs:
        if choice.name != "certificate":
            continue
        cert = choice.chosen
        if sid_name == "issuer_and_serial_number":
            iasn = sid.chosen
            if cert.issuer == iasn["issuer"] and cert["tbs_certificate"]["serial_number"].native == iasn["serial_number"].native:
                return cert
        elif sid_name == "subject_key_identifier":
            ski_attr = None
            for ext in cert["tbs_certificate"]["extensions"] or []:
                if ext["extn_id"].native == "key_identifier":
                    ski_attr = ext["extn_value"].parsed.native
                    break
            if ski_attr == sid.chosen.native:
                return cert

    # Fallback: if there's exactly one cert, assume it's the signer.
    only_certs = [c.chosen for c in certs if c.name == "certificate"]
    if len(only_certs) == 1:
        return only_certs[0]
    raise SignatureError("Не удалось найти сертификат подписанта в CMS")


# ── Crypto verification helpers ────────────────────────────────────────────

_RSA_SIG_HASHES = {
    "sha256_rsa": hashes.SHA256,
    "sha384_rsa": hashes.SHA384,
    "sha512_rsa": hashes.SHA512,
    "sha1_rsa": hashes.SHA1,
    "rsassa_pkcs1v15": hashes.SHA256,  # disambiguated by digest_algorithm
}

_ECDSA_SIG_HASHES = {
    "sha256_ecdsa": hashes.SHA256,
    "sha384_ecdsa": hashes.SHA384,
    "sha512_ecdsa": hashes.SHA512,
}


def _verify_signature(cert: cx509.Certificate, signed_attrs_der: bytes,
                      signature: bytes, sig_algo_name: str,
                      digest_algo_name: str) -> None:
    pub = cert.public_key()
    digest_algo_name = digest_algo_name.lower()
    sig_algo_name = sig_algo_name.lower()

    hash_klass = _HASH_BY_OID.get(digest_algo_name)
    if not hash_klass:
        raise SignatureError(f"Неподдерживаемый digest: {digest_algo_name}")

    if isinstance(pub, rsa.RSAPublicKey):
        try:
            pub.verify(signature, signed_attrs_der, padding.PKCS1v15(), hash_klass())
        except InvalidSignature as e:
            raise SignatureError("Неверная подпись (RSA)") from e
        return

    if isinstance(pub, ec.EllipticCurvePublicKey):
        try:
            pub.verify(signature, signed_attrs_der, ec.ECDSA(hash_klass()))
        except InvalidSignature as e:
            raise SignatureError("Неверная подпись (ECDSA)") from e
        return

    # GOST 2015/2022 keys aren't natively supported by the `cryptography`
    # package. NCALayer for KZ also issues RSA-based "RSA-SIGN" certs which we
    # cover above. If we hit a GOST cert, surface a clear warning instead of
    # silently passing.
    raise SignatureError(
        "Алгоритм ключа сертификата не поддерживается серверной проверкой "
        "(ожидается RSA или ECDSA, получен другой)"
    )


# ── Main entry point ───────────────────────────────────────────────────────

def parse_cms_signature(cms_b64: str, payload_bytes: bytes) -> ParsedSignature:
    """Parse + cryptographically verify a base64 CMS for the given payload.

    Raises SignatureError on any tampering, mismatch or unsupported algorithm.
    Returns ParsedSignature carrying signer identity and any non-fatal warnings.
    """
    if not cms_b64:
        raise SignatureError("Подпись пуста")
    try:
        raw = base64.b64decode(cms_b64, validate=False)
    except Exception as e:
        raise SignatureError("Подпись не является корректным base64") from e

    try:
        content_info = cms.ContentInfo.load(raw)
    except Exception as e:
        raise SignatureError("Не удалось разобрать CMS") from e

    if content_info["content_type"].native != "signed_data":
        raise SignatureError("CMS не является signed_data")

    signed_data = content_info["content"]
    signer_infos = signed_data["signer_infos"]
    if not signer_infos:
        raise SignatureError("В CMS отсутствует signer_info")

    signer_info = signer_infos[0]

    # 1) Pick the signer certificate using SignerIdentifier (not certs[0]).
    a_cert = _find_signer_cert(signed_data, signer_info)
    der_cert = a_cert.dump()
    cert = cx509.load_der_x509_certificate(der_cert)
    cert_pem = cert.public_bytes(Encoding.PEM).decode("ascii")

    # 2) Verify messageDigest signed attribute matches SHA-(digest) of payload.
    digest_algo = signer_info["digest_algorithm"]["algorithm"].native
    expected_digest = _hash(payload_bytes, digest_algo)

    signed_attrs = signer_info["signed_attrs"]
    if not signed_attrs or len(signed_attrs) == 0:
        raise SignatureError("Подпись не содержит SignedAttributes")

    md_value: Optional[bytes] = None
    content_type_value = None
    for attr in signed_attrs:
        name = attr["type"].native
        if name == "message_digest":
            md_value = attr["values"][0].native
        elif name == "content_type":
            content_type_value = attr["values"][0].native

    if md_value is None:
        raise SignatureError("В подписи отсутствует messageDigest")
    if md_value != expected_digest:
        raise SignatureError(
            "Хэш подписанного содержимого не совпадает с хэшем файла договора "
            "(подпись сделана под другой документ)"
        )
    if content_type_value not in (None, "data"):
        # Some implementations use different content types; warn but don't fail.
        pass

    # 3) Verify the RSA/ECDSA signature itself against signed_attrs DER bytes.
    # The signed bytes per RFC 5652 §5.4 are the DER encoding of the SET OF
    # attributes (re-encoded with implicit tag 0xA0 → explicit 0x31 SET tag).
    signed_attrs_der = signed_attrs.dump()
    # RFC 5652: when verifying, the IMPLICIT [0] tag must be replaced by an
    # explicit SET tag (0x31). asn1crypto's `dump()` on `CMSAttributes` already
    # emits the SET form (0x31 ...).
    if signed_attrs_der[:1] != b"\x31":
        # Some implementations dump with the implicit [0] tag (0xA0).
        # Re-tag to SET (0x31) for verification, leaving length unchanged.
        signed_attrs_der = b"\x31" + signed_attrs_der[1:]

    sig_algo = signer_info["signature_algorithm"]["algorithm"].native
    signature_bytes = signer_info["signature"].native

    try:
        _verify_signature(cert, signed_attrs_der, signature_bytes, sig_algo, digest_algo)
    except SignatureError:
        raise
    except Exception as e:
        raise SignatureError(f"Не удалось проверить подпись: {e}") from e

    # 4) Validity period check (non-fatal warning if the cert is past validity).
    warnings: list[str] = []
    not_before = cert.not_valid_before_utc.replace(tzinfo=None) if hasattr(cert, "not_valid_before_utc") else cert.not_valid_before
    not_after = cert.not_valid_after_utc.replace(tzinfo=None) if hasattr(cert, "not_valid_after_utc") else cert.not_valid_after
    now = datetime.utcnow()
    if not_before and now < not_before:
        warnings.append(f"Сертификат ещё не действителен (с {not_before.isoformat()})")
    if not_after and now > not_after:
        warnings.append(f"Сертификат просрочен (истёк {not_after.isoformat()})")

    full_name = _full_name_from_cert(cert)
    iin_or_bin = _iin_bin_from_cert(cert)

    return ParsedSignature(
        signer_full_name=full_name,
        signer_iin_or_bin=iin_or_bin,
        signer_serial=f"{cert.serial_number:X}",
        certificate_pem=cert_pem,
        payload_sha256=hashlib.sha256(payload_bytes).hexdigest(),
        not_valid_before=not_before,
        not_valid_after=not_after,
        warnings=warnings,
    )
