from pathlib import Path
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import jwt_required

from ..extensions import db
from ..models import Contract, ContractStatus, Signature
from ..services.signature_service import parse_cms_signature, payload_sha256
from ..utils.auth import admin_required
from ..utils.serializers import get_json_safe

bp = Blueprint("signatures", __name__)


@bp.get("/contracts/<int:cid>/payload-hash")
@jwt_required()
def payload_hash(cid):
    """Return the SHA256 hex digest of the contract DOCX bytes for the frontend to sign via NCALayer."""
    contract = Contract.query.get_or_404(cid)
    if not contract.docx_path:
        return jsonify(error="Сначала сформируйте договор"), 400
    path = Path(current_app.config["ARCHIVE_FOLDER"]) / contract.docx_path
    if not path.exists():
        return jsonify(error="Файл договора отсутствует"), 404
    data = path.read_bytes()
    import base64
    return jsonify(
        sha256=payload_sha256(data),
        payload_base64=base64.b64encode(data).decode("ascii"),
        size=len(data),
        filename=Path(contract.docx_path).name,
    )


@bp.post("/contracts/<int:cid>/attach")
@admin_required
def attach_signature(cid):
    """Persist an NCALayer-produced CMS signature for the contract."""
    contract = Contract.query.get_or_404(cid)
    data = get_json_safe()
    cms_b64 = (data.get("cms") or "").strip()
    signer_role = (data.get("signer_role") or "").strip()
    if not cms_b64 or signer_role not in ("college", "partner", "student"):
        return jsonify(error="Необходимы поля cms и signer_role"), 400
    if not contract.docx_path:
        return jsonify(error="Сначала сформируйте договор"), 400

    payload_path = Path(current_app.config["ARCHIVE_FOLDER"]) / contract.docx_path
    payload_bytes = payload_path.read_bytes()
    try:
        parsed = parse_cms_signature(cms_b64, payload_bytes)
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=f"Ошибка обработки подписи: {exc}"), 400

    sig = Signature(
        contract_id=contract.id,
        signer_role=signer_role,
        signer_full_name=parsed.signer_full_name,
        signer_iin_or_bin=parsed.signer_iin_or_bin,
        signer_serial=parsed.signer_serial,
        signer_certificate_pem=parsed.certificate_pem,
        cms_signature=cms_b64,
        signed_payload_sha256=parsed.payload_sha256,
    )
    db.session.add(sig)

    roles_signed = {s.signer_role for s in contract.signatures} | {signer_role}
    if {"college", "partner", "student"}.issubset(roles_signed):
        contract.status = ContractStatus.SIGNED

    db.session.commit()
    return jsonify(
        signature=sig.to_dict(),
        contract=contract.to_dict(include_relations=True),
    ), 201


@bp.get("/contracts/<int:cid>")
@jwt_required()
def list_signatures(cid):
    Contract.query.get_or_404(cid)
    items = Signature.query.filter_by(contract_id=cid).order_by(Signature.created_at.asc()).all()
    return jsonify(items=[s.to_dict() for s in items])
