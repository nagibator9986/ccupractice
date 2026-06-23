import base64
from pathlib import Path

from flask import Blueprint, current_app, jsonify
from flask_jwt_extended import jwt_required
from sqlalchemy.exc import IntegrityError

from ..extensions import db
from ..models import Contract, ContractStatus, Signature
from ..services.signature_service import SignatureError, payload_sha256
from ..services.signature_verification import verify_cms_signature
from ..utils.auth import admin_required
from ..utils.serializers import get_json_safe

bp = Blueprint("signatures", __name__)


@bp.get("/contracts/<int:cid>/payload-hash")
@jwt_required()
def payload_hash(cid):
    """Return the SHA256 + base64 bytes of the contract DOCX for the frontend to sign via NCALayer."""
    contract = Contract.query.get_or_404(cid)
    if not contract.docx_path:
        return jsonify(error="Сначала сформируйте договор"), 400
    path = Path(current_app.config["ARCHIVE_FOLDER"]) / contract.docx_path
    if not path.is_file():
        return jsonify(error="Файл договора отсутствует на сервере"), 404
    data = path.read_bytes()
    return jsonify(
        sha256=payload_sha256(data),
        payload_base64=base64.b64encode(data).decode("ascii"),
        size=len(data),
        filename=Path(contract.docx_path).name,
    )


@bp.post("/contracts/<int:cid>/attach")
@admin_required
def attach_signature(cid):
    """Persist an NCALayer-produced CMS signature for the contract.

    Used only for the admin-side "Подписать здесь" (college) flow; the public
    multi-party flow lives in `signing.py`.
    """
    contract = Contract.query.get_or_404(cid)
    data = get_json_safe()
    cms_b64 = (data.get("cms") or "").strip()
    signer_role = (data.get("signer_role") or "").strip()
    if not cms_b64:
        return jsonify(error="Подпись не передана"), 400
    if signer_role not in ("college", "partner", "student"):
        return jsonify(error="Неизвестная роль подписанта"), 400
    if not contract.docx_path:
        return jsonify(error="Сначала сформируйте договор"), 400

    # Block double-signing the same role at the admin endpoint.
    existing = Signature.query.filter_by(contract_id=cid, signer_role=signer_role).first()
    if existing:
        return jsonify(
            error=f"Эта роль уже подписана ({existing.signer_full_name or existing.signer_iin_or_bin or '—'})"
        ), 409

    payload_path = Path(current_app.config["ARCHIVE_FOLDER"]) / contract.docx_path
    if not payload_path.is_file():
        return jsonify(error="Файл договора отсутствует на сервере"), 500
    payload_bytes = payload_path.read_bytes()
    try:
        parsed = verify_cms_signature(cms_b64, payload_bytes)
    except SignatureError as exc:
        return jsonify(error=str(exc)), 400

    sig = Signature(
        contract_id=contract.id,
        signer_role=signer_role,
        signer_full_name=parsed.signer_full_name,
        signer_iin_or_bin=parsed.signer_iin_or_bin,
        signer_serial=parsed.signer_serial,
        signer_certificate_pem=parsed.certificate_pem,
        cms_signature=cms_b64,
        signed_payload_sha256=parsed.payload_sha256,
        verification_level=parsed.verification_level,
    )
    db.session.add(sig)

    roles_signed = {s.signer_role for s in contract.signatures} | {signer_role}
    if {"college", "partner", "student"}.issubset(roles_signed):
        contract.status = ContractStatus.SIGNED

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(error="Эта роль уже подписана"), 409
    return jsonify(
        signature=sig.to_dict(),
        contract=contract.to_dict(include_relations=True),
        warnings=parsed.warnings,
    ), 201


@bp.get("/contracts/<int:cid>")
@jwt_required()
def list_signatures(cid):
    Contract.query.get_or_404(cid)
    items = Signature.query.filter_by(contract_id=cid).order_by(Signature.created_at.asc()).all()
    return jsonify(items=[s.to_dict() for s in items])
