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
    algo = algo.lower()
    if algo not in _HASH_BY_OID:
        raise SignatureError(f"Не поддерживаемый алгоритм хэширования: {algo}")
    try:
        h = hashlib.new(algo)
    except ValueError as e:  # pragma: no cover - defensive
        raise SignatureError(f"Не поддерживаемый алгоритм хэширования: {algo}") from e
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

# Signature-algorithm allow-lists, keyed by the asn1crypto `.native` name of
# SignerInfo.signature_algorithm. We pick the RSA padding scheme from the
# declared algorithm instead of blindly assuming PKCS#1 v1.5, and reject any
# unrecognised algorithm rather than silently defaulting.
_RSA_PKCS1V15_ALGOS = {
    "rsassa_pkcs1v15",
    "sha1_rsa",
    "sha224_rsa",
    "sha256_rsa",
    "sha384_rsa",
    "sha512_rsa",
}
_ECDSA_ALGOS = {
    "ecdsa",
    "sha1_ecdsa",
    "sha224_ecdsa",
    "sha256_ecdsa",
    "sha384_ecdsa",
    "sha512_ecdsa",
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
        # Select the RSA padding scheme from the declared signature algorithm
        # rather than assuming PKCS#1 v1.5 for every RSA key.
        if sig_algo_name == "rsassa_pss":
            rsa_padding = padding.PSS(
                mgf=padding.MGF1(hash_klass()),
                salt_length=padding.PSS.MAX_LENGTH,
            )
        elif sig_algo_name in _RSA_PKCS1V15_ALGOS:
            rsa_padding = padding.PKCS1v15()
        else:
            raise SignatureError(
                f"Неподдерживаемый алгоритм подписи RSA: {sig_algo_name}"
            )
        try:
            pub.verify(signature, signed_attrs_der, rsa_padding, hash_klass())
        except InvalidSignature as e:
            raise SignatureError("Неверная подпись (RSA)") from e
        return

    if isinstance(pub, ec.EllipticCurvePublicKey):
        if sig_algo_name not in _ECDSA_ALGOS:
            raise SignatureError(
                f"Неподдерживаемый алгоритм подписи ECDSA: {sig_algo_name}"
            )
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

    warnings: list[str] = []
    # RFC 5652 §11.1: when SignedAttributes are present, a content-type attribute
    # MUST be present and MUST equal the encapContentInfo eContentType. We surface
    # a deviation as a non-fatal warning rather than a hard reject so a genuine
    # NCALayer signature is never blocked by an implementation quirk (the
    # load-bearing binding is the messageDigest check above).
    try:
        expected_content_type = signed_data["encap_content_info"]["content_type"].native
    except Exception:
        expected_content_type = None
    if content_type_value is None:
        warnings.append("В подписи отсутствует атрибут content-type")
    elif expected_content_type is not None and content_type_value != expected_content_type:
        warnings.append(
            "Атрибут content-type подписи не совпадает с типом подписанного содержимого"
        )

    # 3) Verify the RSA/ECDSA signature itself against the signed_attrs DER bytes.
    # RFC 5652 §5.4: the signed bytes are the DER encoding of the SignedAttributes
    # as an explicit universal SET (tag 0x31), NOT the IMPLICIT [0] (0xA0) form
    # that appears on the wire. For a parsed child of a loaded SignerInfo,
    # `.dump()` returns the wire form tagged 0xA0; `.untag().dump()` strips the
    # implicit context tag and re-applies the universal SET tag, yielding the
    # exact RFC 5652 encoding while preserving the original contents octets (so
    # BER input from non-asn1crypto signers, e.g. Java/BouncyCastle, stays intact).
    signed_attrs_der = signed_attrs.untag().dump()

    sig_algo = signer_info["signature_algorithm"]["algorithm"].native
    signature_bytes = signer_info["signature"].native

    try:
        _verify_signature(cert, signed_attrs_der, signature_bytes, sig_algo, digest_algo)
    except SignatureError:
        raise
    except Exception as e:
        raise SignatureError(f"Не удалось проверить подпись: {e}") from e

    # 4) Validity period check (non-fatal warning if the cert is past validity).
    # cryptography >= 42 always exposes the tz-aware *_utc accessors; keep
    # everything tz-aware and avoid the deprecated datetime.utcnow().
    not_before = cert.not_valid_before_utc
    not_after = cert.not_valid_after_utc
    now = datetime.now(timezone.utc)
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
