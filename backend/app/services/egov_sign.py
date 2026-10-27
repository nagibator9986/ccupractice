"""eGov mobile signing (QR / cross-signing) — protocol helpers.

Implements the information-system side of the official «QR/Кросс подписание в
приложении eGov Mobile» specification (Smart Bridge / НИТ):

* **API №1** (GET) — what the phone fetches after scanning the QR / opening the
  deep link: description, expiry, organisation and where/how to get the document.
* **API №2** (GET + PUT) — the phone downloads the documents to sign and PUTs the
  signed result back. We use ``CMS_WITH_DATA``: the CMS carries the exact bytes
  that were signed, so we can bind the signature to OUR file by content (works for
  RSA *and* for national GOST certificates, where a hash match cannot be
  recomputed server-side) and reject the Android quirk where a CMS was once made
  over the base64 text instead of the document.
* The QR content is ``mobileSign:<API №1 URL>``; on a phone the same URL goes into
  the ``mgovsign.page.link`` dynamic link (iOS / Android variants).

What is signed here is the **PDF** of the contract — eGov mobile only shows PDF /
text / XML to the signer, so the PDF is what they actually read. (NCALayer keeps
signing the DOCX; ``Signature.payload_format`` records which, and the public
verification page checks each signature against the matching file.)
"""
from __future__ import annotations

import base64
from urllib.parse import quote

from asn1crypto import cms as asn1_cms
from flask import current_app

DEEPLINK_PREFIX = "https://mgovsign.page.link/"
IOS_ISI = "1476128386"
IOS_IBI = "kz.egov.mobile"
ANDROID_APN = "kz.mobile.mgov"

SIGN_METHOD = "CMS_WITH_DATA"
SESSION_TTL_MIN_DEFAULT = 10


def is_enabled() -> bool:
    val = current_app.config.get("EGOV_SIGN_ENABLED")
    if isinstance(val, bool):
        return val
    return str(val or "").strip().lower() in ("1", "true", "yes", "on")


def session_ttl_minutes() -> int:
    try:
        return max(2, min(60, int(current_app.config.get("EGOV_SESSION_TTL_MIN") or SESSION_TTL_MIN_DEFAULT)))
    except (TypeError, ValueError):
        return SESSION_TTL_MIN_DEFAULT


# ─────────────────────────────────────────────────────────────────────────────
# URLs
# ─────────────────────────────────────────────────────────────────────────────

def api1_url(base: str, secret: str) -> str:
    return f"{base.rstrip('/')}/api/egov/{secret}"


def api2_url(base: str, secret: str) -> str:
    return f"{base.rstrip('/')}/api/egov/{secret}/documents"


def qr_content(api1: str) -> str:
    return f"mobileSign:{api1}"


def deep_links(api1: str) -> dict[str, str]:
    """Dynamic links for the «open eGov mobile» button. Only ``link`` varies, the
    rest is fixed by the specification; the API URL is percent-encoded so its own
    ``?`` / ``=`` / ``&`` cannot clash with the dynamic link's parameters."""
    link = quote(api1, safe=":/")
    return {
        "ios": f"{DEEPLINK_PREFIX}?link={link}&isi={IOS_ISI}&ibi={IOS_IBI}",
        "android": f"{DEEPLINK_PREFIX}?link={link}&apn={ANDROID_APN}",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Payloads
# ─────────────────────────────────────────────────────────────────────────────

def iso_utc_ms(dt) -> str:
    """``yyyy-MM-dd'T'HH:mm:ss.SSSZ`` as the specification requires."""
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def build_api1(*, contract, settings, session, api2: str) -> dict:
    name_ru = (settings.name_ru if settings else "") or "Колледж"
    name_kz = (settings.name_kz if settings else "") or name_ru
    return {
        "description": f"Подписание договора практики № {contract.number}",
        "expiry_date": iso_utc_ms(session.expires_at),
        "organisation": {
            "nameRu": name_ru,
            "nameKz": name_kz,
            "nameEn": name_ru,
            "bin": (settings.bin if settings else "") or "",
        },
        "document": {
            "uri": api2,
            "auth_type": "Token",
            "auth_token": session.auth_token,
        },
    }


def build_documents(*, contract, role_label: str, pdf_bytes: bytes) -> dict:
    student, partner = contract.student, contract.partner
    period = ""
    if student and student.practice_start and student.practice_end:
        period = f"{student.practice_start:%d.%m.%Y} — {student.practice_end:%d.%m.%Y}"
    meta = [
        {"name": "Вы подписываете как", "value": role_label},
        {"name": "Студент", "value": student.full_name if student else ""},
        {"name": "Предприятие", "value": partner.organization_name if partner else ""},
    ]
    if period:
        meta.append({"name": "Период практики", "value": period})
    return {
        "signMethod": SIGN_METHOD,
        "version": 1,
        "documentsToSign": [
            {
                "id": contract.id,
                "nameRu": f"Договор практики № {contract.number}",
                "nameKz": f"Практика шарты № {contract.number}",
                "nameEn": f"Practice agreement No. {contract.number}",
                "meta": meta,
                "document": {
                    "file": {
                        "mime": "application/pdf",
                        "data": base64.b64encode(pdf_bytes).decode("ascii"),
                    }
                },
            }
        ],
    }


def extract_signed(body: dict, expected_id: int) -> str | None:
    """CMS (base64) from the PUT body, or None when the shape is wrong."""
    try:
        docs = body["documentsToSign"]
        if not isinstance(docs, list) or len(docs) != 1:
            return None
        doc = docs[0]
        if int(doc.get("id")) != int(expected_id):
            return None
        data = doc["document"]["file"]["data"]
        return data if isinstance(data, str) and data.strip() else None
    except (KeyError, TypeError, ValueError):
        return None


def embedded_content(cms_b64: str) -> bytes | None:
    """The document bytes carried INSIDE a CMS (``CMS_WITH_DATA``), if any."""
    try:
        raw = base64.b64decode("".join(cms_b64.split()), validate=False)
        info = asn1_cms.ContentInfo.load(raw)
        content = info["content"]["encap_content_info"]["content"]
        if content is None:
            return None
        native = content.native
        return bytes(native) if isinstance(native, (bytes, bytearray)) else None
    except Exception:  # noqa: BLE001 — malformed CMS is handled by the caller
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Messages for the phone UI (it sends Accept-Language: ru | kk | en)
# ─────────────────────────────────────────────────────────────────────────────

_MESSAGES = {
    "invalid": {
        "ru": "Сессия подписания недействительна.",
        "kk": "Қол қою сессиясы жарамсыз.",
        "en": "The signing session is invalid.",
    },
    "expired": {
        "ru": "Срок действия QR-кода истёк. Создайте новый на странице подписания.",
        "kk": "QR-кодтың мерзімі өтті. Қол қою бетінде жаңасын жасаңыз.",
        "en": "The QR code has expired. Create a new one on the signing page.",
    },
    "used": {
        "ru": "Эта сессия подписания уже закрыта. Создайте новый QR-код на странице подписания.",
        "kk": "Бұл қол қою сессиясы жабылған. Қол қою бетінде жаңа QR-код жасаңыз.",
        "en": "This signing session is closed. Create a new QR code on the signing page.",
    },
    "unauthorized": {
        "ru": "Нет доступа к документу.",
        "kk": "Құжатқа қол жеткізу мүмкін емес.",
        "en": "Access to the document is denied.",
    },
    "doc_changed": {
        "ru": "Документ изменился после создания QR-кода. Создайте новый QR-код.",
        "kk": "QR-код жасалғаннан кейін құжат өзгерді. Жаңа QR-код жасаңыз.",
        "en": "The document changed after the QR code was created. Create a new QR code.",
    },
    "already_signed": {
        "ru": "Эта сторона уже подписала договор.",
        "kk": "Бұл тарап шартқа қол қойып қойған.",
        "en": "This party has already signed the contract.",
    },
    "bad_request": {
        "ru": "Некорректный запрос.",
        "kk": "Қате сұрау.",
        "en": "Bad request.",
    },
    "rejected": {
        "ru": "Подпись не принята: {reason}",
        "kk": "Қол қабылданбады: {reason}",
        "en": "The signature was rejected: {reason}",
    },
    "wrong_document": {
        "ru": "Подписан не тот документ, который был передан на подпись.",
        "kk": "Қол қоюға берілген құжат емес, басқа құжатқа қол қойылған.",
        "en": "The signed content is not the document that was offered for signing.",
    },
    "unavailable": {
        "ru": "Подписание через eGov mobile сейчас недоступно.",
        "kk": "eGov mobile арқылы қол қою қазір қолжетімсіз.",
        "en": "Signing through eGov mobile is currently unavailable.",
    },
    "success": {"ru": "success", "kk": "success", "en": "success"},
}


def pick_lang(accept_language: str | None) -> str:
    head = (accept_language or "").lower()
    for code in ("kk", "ru", "en"):
        if head.startswith(code) or f",{code}" in head or f" {code}" in head:
            return code
    return "ru"


def message(key: str, lang: str = "ru", **fmt) -> str:
    texts = _MESSAGES.get(key) or _MESSAGES["bad_request"]
    return texts.get(lang, texts["ru"]).format(**fmt) if fmt else texts.get(lang, texts["ru"])
