"""Public contract-verification API.

The QR-code stamped on every generated DOCX/PDF resolves to
`/verify/<code>` on the SPA, which calls these endpoints to render the
"are all signatures valid?" page. No JWT required — verification is a public
operation by design.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

from flask import Blueprint, current_app, jsonify, send_from_directory

from ..models import (
    Contract,
    ContractStatus,
    DOC_LMS,
    DOCUMENT_LABELS,
    EnrollmentContract,
    EnrollmentStatus,
    LmsContract,
    LmsStatus,
    PARTY_LABELS,
)

bp = Blueprint("verify", __name__)


_ROLE_LABELS = {
    "college": "Колледж (организация образования)",
    "partner": "Предприятие",
    "student": "Обучающийся",
}


def _mask_iin(value: str | None) -> str:
    """Show first 6 and last 2 digits, mask the middle (`XXXXXX****XX`)."""
    if not value:
        return ""
    digits = "".join(ch for ch in value if ch.isdigit())
    if len(digits) < 8:
        return digits
    return f"{digits[:6]}****{digits[-2:]}"


def _serial_tail(serial: str | None) -> str:
    if not serial:
        return ""
    return serial[-12:].upper()


def _signature_dto(sig) -> dict:
    return {
        "signer_role": sig.signer_role,
        "signer_role_label": _ROLE_LABELS.get(sig.signer_role, sig.signer_role),
        "signer_full_name": sig.signer_full_name or "—",
        "signer_iin_or_bin_masked": _mask_iin(sig.signer_iin_or_bin),
        "signer_serial_tail": _serial_tail(sig.signer_serial),
        "signed_payload_sha256": sig.signed_payload_sha256,
        "verification_level": getattr(sig, "verification_level", "full"),
        "created_at": sig.created_at.isoformat() if sig.created_at else None,
    }


def _request_dto(req) -> dict:
    return {
        "signer_role": req.signer_role,
        "signer_role_label": _ROLE_LABELS.get(req.signer_role, req.signer_role),
        "status": req.status,
        "viewed_at": req.viewed_at.isoformat() if req.viewed_at else None,
        "signed_at": req.signed_at.isoformat() if req.signed_at else None,
    }


def _current_file_hash(contract: Contract) -> str | None:
    if not contract.docx_path:
        return None
    p = Path(current_app.config["ARCHIVE_FOLDER"]) / contract.docx_path
    if not p.is_file():
        return None
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _lms_signature_dto(sig) -> dict:
    # NOTE: shape mirrors the practicum `_signature_dto` so the SPA renders
    # both aggregates through the same VerificationBadge component.
    return {
        "signer_role": sig.signer_party,
        "signer_role_label": PARTY_LABELS.get(sig.signer_party, sig.signer_party),
        "signer_party": sig.signer_party,
        "signer_party_label": PARTY_LABELS.get(sig.signer_party, sig.signer_party),
        "signer_full_name": sig.signer_full_name or "—",
        "signer_iin_or_bin_masked": _mask_iin(sig.signer_iin_or_bin),
        "signer_serial_tail": _serial_tail(sig.signer_serial),
        "signed_payload_sha256": sig.signed_payload_sha256,
        "verification_level": getattr(sig, "verification_level", "full"),
        "created_at": sig.created_at.isoformat() if sig.created_at else None,
        "facsimile": False,
    }


def _lms_college_facsimile_dto() -> dict:
    """College side of an LMS contract is a printed facsimile + М.П. on the
    bilingual template — there's no ЭЦП row for it. We surface a synthetic
    entry so the verifier UI lists all three parties (college + the one ЭЦП
    signer) in one table while VerifyPage still only renders VerificationBadge
    rows for entries with a `signed_payload_sha256` value.
    """
    return {
        "signer_role": "college",
        "signer_role_label": _ROLE_LABELS["college"],
        "signer_party": "college",
        "signer_party_label": _ROLE_LABELS["college"],
        "signer_full_name": "—",
        "signer_iin_or_bin_masked": "",
        "signer_serial_tail": "",
        "signed_payload_sha256": None,
        "verification_level": None,
        "created_at": None,
        "facsimile": True,
        "note": "Подпись и печать — факсимильные на бланке",
    }


def _lms_current_file_hash(lms: LmsContract) -> str | None:
    if not lms.docx_path:
        return None
    p = Path(current_app.config["ARCHIVE_FOLDER"]) / lms.docx_path
    if not p.is_file():
        return None
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _verify_lms(code: str, lms: LmsContract):
    """Render the verification payload for a standalone LMS contract.

    The aggregate has exactly one document (DOC_LMS) and exactly one signer
    (student OR parent depending on age), so the shape is intentionally simpler
    than the practicum verifier and the frontend differentiates with `kind`.
    """
    sigs = list(lms.signatures or [])
    required_party = lms.signer_party
    required_parties = {required_party} if required_party else set()
    signed_parties = {s.signer_party for s in sigs}
    fully_signed = bool(required_parties) and required_parties.issubset(signed_parties)

    current_hash = _lms_current_file_hash(lms)
    signed_hash = sigs[0].signed_payload_sha256 if sigs else None
    integrity_ok = (
        signed_hash is not None
        and current_hash is not None
        and signed_hash == current_hash
    )

    # Real ЭЦП rows first, college facsimile appended last (purely cosmetic;
    # the SPA filters facsimile entries out of any cryptographic summary).
    signature_rows = [
        _lms_signature_dto(s) for s in sorted(sigs, key=lambda x: x.created_at or 0)
    ]
    signature_rows.append(_lms_college_facsimile_dto())

    return jsonify(
        kind="lms",
        contract={
            "kind": "lms",
            "aggregate": "lms",
            "number": lms.number,
            "verification_code": lms.verify_code,
            "year": lms.year,
            "contract_date": lms.contract_date.isoformat() if lms.contract_date else None,
            "status": lms.status,
            "status_label": LmsStatus.LABELS.get(lms.status, lms.status),
            "document_label": DOCUMENT_LABELS[DOC_LMS],
            "applicant_full_name": lms.applicant_full_name,
            "applicant_iin_masked": _mask_iin(lms.applicant_iin),
            "specialty": lms.specialty,
            "qualification": lms.qualification,
            "funding_source": lms.funding_source,
            "grant_order_number": lms.grant_order_number,
            "grant_order_date": lms.grant_order_date.isoformat() if lms.grant_order_date else None,
        },
        signatures=signature_rows,
        summary={
            # Both shapes are emitted so the SPA's existing practicum-shape
            # code (`summary.required_roles.map(...)`) works without any
            # `kind`-branching. Parties and roles are identical strings for
            # LMS — student/parent/college — so the dual naming is harmless
            # and the migration cost is zero on the frontend side.
            "required_parties": sorted(required_parties),
            "signed_parties": sorted(signed_parties),
            "missing_parties": sorted(required_parties - signed_parties),
            "required_roles": sorted(required_parties),
            "signed_roles": sorted(signed_parties),
            "missing_roles": sorted(required_parties - signed_parties),
            "fully_signed": fully_signed,
            "signed_count": len(signed_parties),
            "required_count": len(required_parties),
        },
        integrity={
            "signed_payload_sha256": signed_hash,
            "current_file_sha256": current_hash,
            "match": integrity_ok,
            "available": signed_hash is not None and current_hash is not None,
        },
        download={
            "docx": f"/api/verify/{code}/file/docx" if lms.docx_path else None,
            "pdf": f"/api/verify/{code}/file/pdf" if lms.pdf_path else None,
        },
    )


def _enrollment_current_file_hash(e: EnrollmentContract, document: str) -> str | None:
    rel = e.doc_path(document, "docx")
    if not rel:
        return None
    p = Path(current_app.config["ARCHIVE_FOLDER"]) / rel
    if not p.is_file():
        return None
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _enrollment_signature_dto(s) -> dict:
    return {
        "document": s.document,
        "document_label": DOCUMENT_LABELS.get(s.document, s.document),
        "signer_role": s.signer_party,
        "signer_role_label": PARTY_LABELS.get(s.signer_party, s.signer_party),
        "signer_party": s.signer_party,
        "signer_party_label": PARTY_LABELS.get(s.signer_party, s.signer_party),
        "signer_full_name": s.signer_full_name or "—",
        "signer_iin_or_bin_masked": _mask_iin(s.signer_iin_or_bin),
        "signer_serial_tail": _serial_tail(s.signer_serial),
        "signed_payload_sha256": s.signed_payload_sha256,
        "verification_level": getattr(s, "verification_level", "full"),
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


def _verify_enrollment(code: str, e: EnrollmentContract):
    """Render the verification payload for an EnrollmentContract.

    Enrollment is a two-document aggregate (contract + consent), each with its
    own signer matrix. Surface ONE row per (document, party) so a verifier can
    see who signed what.
    """
    sigs = list(e.signatures or [])
    required = e.required_matrix or {}
    # signed = set of (document, party) tuples
    signed_tuples = {(s.document, s.signer_party) for s in sigs}
    required_tuples = {(doc, party) for party, docs in required.items() for doc in docs}
    fully_signed = bool(required_tuples) and required_tuples.issubset(signed_tuples)

    # A "first" hash for the integrity panel — every signer signs the same
    # document bytes for that document, so we pick the contract signature if
    # available; if not, any signature; if none, None.
    contract_sigs = [s for s in sigs if s.document == "contract"]
    candidate_sig = contract_sigs[0] if contract_sigs else (sigs[0] if sigs else None)
    signed_hash = candidate_sig.signed_payload_sha256 if candidate_sig else None

    # Compute current-file hash for the SAME document the signed_hash came from.
    if candidate_sig:
        current_hash = _enrollment_current_file_hash(e, candidate_sig.document)
    else:
        current_hash = None
    integrity_ok = (
        signed_hash is not None
        and current_hash is not None
        and signed_hash == current_hash
    )

    parties_required = sorted({p for p in required.keys()})
    parties_signed = sorted({s.signer_party for s in sigs})
    parties_missing = sorted(set(parties_required) - set(parties_signed))

    return jsonify(
        kind="enrollment",
        contract={
            "kind": "enrollment",
            "aggregate": "enrollment",
            "number": e.number,
            "verification_code": e.verification_code,
            "year": e.year,
            "contract_date": e.contract_date.isoformat() if e.contract_date else None,
            "status": e.status,
            "status_label": EnrollmentStatus.LABELS.get(e.status, e.status),
            "applicant_full_name": e.applicant_full_name,
            "applicant_iin_masked": _mask_iin(e.applicant_iin),
            "specialty": e.specialty,
            "qualification": e.qualification,
            "education_base": e.education_base,
            "study_form": e.study_form,
        },
        signatures=[_enrollment_signature_dto(s) for s in sorted(sigs, key=lambda x: x.created_at or 0)],
        summary={
            "required_parties": parties_required,
            "signed_parties": parties_signed,
            "missing_parties": parties_missing,
            "required_roles": parties_required,
            "signed_roles": parties_signed,
            "missing_roles": parties_missing,
            "fully_signed": fully_signed,
            "signed_count": len(parties_signed),
            "required_count": len(parties_required),
        },
        integrity={
            "signed_payload_sha256": signed_hash,
            "current_file_sha256": current_hash,
            "match": integrity_ok,
            "available": signed_hash is not None and current_hash is not None,
        },
        download={
            # Enrollment has TWO documents; expose both. Frontend can render
            # whichever fields are non-null. The verify file endpoint accepts
            # the standard format; for enrollment we encode the document key
            # into the format slot (docx-contract / docx-consent / pdf-* ).
            "docx": f"/api/verify/{code}/file/docx" if e.contract_docx_path else None,
            "pdf": f"/api/verify/{code}/file/pdf" if e.contract_pdf_path else None,
            "consent_docx": f"/api/verify/{code}/file/docx-consent" if e.consent_docx_path else None,
            "consent_pdf": f"/api/verify/{code}/file/pdf-consent" if e.consent_pdf_path else None,
        },
    )


@bp.get("/<string:code>")
def public_verify(code: str):
    contract: Contract | None = Contract.query.filter_by(verification_code=code).first()
    if not contract:
        # Verify codes are minted independently across all three aggregates
        # (practicum, LMS, enrollment) — the SPA hits ONE endpoint and we
        # resolve internally. Try LMS, then enrollment.
        lms = LmsContract.query.filter_by(verify_code=code).first()
        if lms:
            return _verify_lms(code, lms)
        enr = EnrollmentContract.query.filter_by(verification_code=code).first()
        if enr:
            return _verify_enrollment(code, enr)
        return jsonify(error="Документ не найден", code="not_found"), 404

    sigs = list(contract.signatures or [])
    signed_roles = {s.signer_role for s in sigs}
    required_roles = {"college", "partner", "student"}
    fully_signed = required_roles.issubset(signed_roles)

    current_hash = _current_file_hash(contract)
    # If at least one signature exists, the canonical hash is what was signed
    # (every signer signs the same DOCX bytes, so all `signed_payload_sha256`
    # values agree). We expose that single value plus a mismatch flag for the
    # currently-archived file so a tampered re-archive is visible to anyone.
    signed_hash = sigs[0].signed_payload_sha256 if sigs else None
    integrity_ok = (
        signed_hash is not None
        and current_hash is not None
        and signed_hash == current_hash
    )

    return jsonify(
        kind="practicum",
        contract={
            "kind": "practicum",
            "aggregate": "contract",
            "number": contract.number,
            "verification_code": contract.verification_code,
            "year": contract.year,
            "contract_date": contract.contract_date.isoformat() if contract.contract_date else None,
            "status": contract.status,
            "status_label": ContractStatus.LABELS.get(contract.status, contract.status),
            "partner_name": contract.partner.organization_name if contract.partner else None,
            "partner_bin": contract.partner.bin if contract.partner else None,
            "student_name": contract.student.full_name if contract.student else None,
            "student_iin_masked": _mask_iin(contract.student.iin if contract.student else None),
            "student_group": contract.student.group_name if contract.student else None,
            "student_specialty": contract.student.specialty if contract.student else None,
            "practice_start": contract.student.practice_start.isoformat()
            if contract.student and contract.student.practice_start
            else None,
            "practice_end": contract.student.practice_end.isoformat()
            if contract.student and contract.student.practice_end
            else None,
        },
        signatures=[_signature_dto(s) for s in sorted(sigs, key=lambda x: x.created_at or 0)],
        signing_requests=[
            _request_dto(r)
            for r in (contract.signing_requests or [])
            if r.status in ("pending", "viewed", "signed")
        ],
        summary={
            "required_roles": sorted(required_roles),
            "signed_roles": sorted(signed_roles),
            "missing_roles": sorted(required_roles - signed_roles),
            "fully_signed": fully_signed,
            "signed_count": len(signed_roles),
            "required_count": len(required_roles),
        },
        integrity={
            "signed_payload_sha256": signed_hash,
            "current_file_sha256": current_hash,
            "match": integrity_ok,
            "available": signed_hash is not None and current_hash is not None,
        },
        download={
            "docx": f"/api/verify/{code}/file/docx" if contract.docx_path else None,
            "pdf": f"/api/verify/{code}/file/pdf" if contract.pdf_path else None,
        },
    )


@bp.get("/<string:code>/file/<string:fmt>")
def public_verify_file(code: str, fmt: str):
    """Public file download — resolves the verify code across all three aggregates.

    PDF downloads on signed enrollments get the merged "Сертификат подписания"
    annex appended; DOCX downloads stay raw (legal signed payload).
    """
    rel: str | None = None
    is_enrollment = False
    enr_obj: EnrollmentContract | None = None

    contract: Contract | None = Contract.query.filter_by(verification_code=code).first()
    if contract:
        if fmt == "docx":
            rel = contract.docx_path
        elif fmt == "pdf":
            rel = contract.pdf_path
    else:
        lms = LmsContract.query.filter_by(verify_code=code).first()
        if lms:
            if fmt == "docx":
                rel = lms.docx_path
            elif fmt == "pdf":
                rel = lms.pdf_path
        else:
            enr = EnrollmentContract.query.filter_by(verification_code=code).first()
            if not enr:
                return jsonify(error="Документ не найден"), 404
            mapping = {
                "docx":         ("contract", "docx"),
                "pdf":          ("contract", "pdf"),
                "docx-consent": ("consent",  "docx"),
                "pdf-consent":  ("consent",  "pdf"),
            }
            if fmt in mapping:
                doc_key, ext = mapping[fmt]
                rel = enr.doc_path(doc_key, ext)
                is_enrollment = True
                enr_obj = enr
    if not rel:
        return jsonify(error="Файл недоступен"), 404

    archive_root = current_app.config["ARCHIVE_FOLDER"]
    # On enrollment PDF downloads with at least one signature, merge in the
    # "Сертификат подписания" annex so the file SHOWS the signatures + QR.
    if is_enrollment and enr_obj and fmt in ("pdf", "pdf-consent") and (enr_obj.signatures or []):
        from ..services.pdf_visualization import merge_enrollment_pdf
        from flask import send_file, request as _req
        base_pdf = Path(archive_root) / rel
        public_base = _req.headers.get("X-Public-Origin") or None
        try:
            merged = merge_enrollment_pdf(enr_obj, base_pdf, public_base=public_base)
        except Exception as exc:  # noqa: BLE001
            current_app.logger.exception("Verify PDF merge failed: %s", exc)
            merged = base_pdf
        if merged and Path(merged).is_file():
            return send_file(
                str(merged),
                as_attachment=True,
                download_name=Path(rel).name,
                mimetype="application/pdf",
            )

    return send_from_directory(archive_root, rel, as_attachment=True)
