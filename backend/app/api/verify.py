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

from ..models import Contract, ContractStatus

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


@bp.get("/<string:code>")
def public_verify(code: str):
    contract: Contract | None = Contract.query.filter_by(verification_code=code).first()
    if not contract:
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
        contract={
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
    contract: Contract | None = Contract.query.filter_by(verification_code=code).first()
    if not contract:
        return jsonify(error="Документ не найден"), 404
    rel = None
    if fmt == "docx":
        rel = contract.docx_path
    elif fmt == "pdf":
        rel = contract.pdf_path
    if not rel:
        return jsonify(error="Файл недоступен"), 404
    return send_from_directory(
        current_app.config["ARCHIVE_FOLDER"], rel, as_attachment=True
    )
