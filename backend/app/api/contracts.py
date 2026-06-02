from datetime import date, datetime
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from flask_jwt_extended import jwt_required
from sqlalchemy import or_
from ..extensions import db
from ..models import Contract, ContractStatus, Partner, Student
from ..services.document_generator import generate_contract_files
from ..services.numbering import next_contract_number
from ..services.signature_report import build_signature_report
from ..utils.auth import admin_required
from ..utils.files import safe_filename
from ..utils.serializers import parse_date, parse_int
from ..utils.time import utc_now

bp = Blueprint("contracts", __name__)

_ALLOWED_SCAN_EXT = {"pdf", "jpg", "jpeg", "png"}


@bp.get("")
@jwt_required()
def list_contracts():
    q = (request.args.get("q") or "").strip()
    status = (request.args.get("status") or "").strip()
    group = (request.args.get("group") or "").strip()
    specialty = (request.args.get("specialty") or "").strip()
    date_from = parse_date(request.args.get("date_from"))
    date_to = parse_date(request.args.get("date_to"))

    query = Contract.query.join(Partner).join(Student)
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                Contract.number.ilike(like),
                Partner.organization_name.ilike(like),
                Student.full_name.ilike(like),
            )
        )
    if status:
        query = query.filter(Contract.status == status)
    if group:
        query = query.filter(Student.group_name == group)
    if specialty:
        query = query.filter(Student.specialty.ilike(f"%{specialty}%"))
    if date_from:
        query = query.filter(Contract.contract_date >= date_from)
    if date_to:
        query = query.filter(Contract.contract_date <= date_to)

    items = query.order_by(Contract.created_at.desc()).all()
    return jsonify(items=[c.to_dict() for c in items], total=len(items))


@bp.get("/<int:cid>")
@jwt_required()
def get_contract(cid):
    contract = Contract.query.get_or_404(cid)
    return jsonify(item=contract.to_dict(include_relations=True))


@bp.post("")
@admin_required
def create_contract():
    data = request.get_json() or {}
    partner_id = parse_int(data.get("partner_id"))
    student_id = parse_int(data.get("student_id"))
    if not partner_id or not student_id:
        return jsonify(error="Укажите партнера и студента"), 400

    partner = Partner.query.get(partner_id)
    student = Student.query.get(student_id)
    if not partner or not student:
        return jsonify(error="Партнёр или студент не найдены"), 404

    contract_date = parse_date(data.get("contract_date")) or date.today()
    number, year, _ = next_contract_number(contract_date.year)

    contract = Contract(
        number=number,
        year=year,
        contract_date=contract_date,
        partner_id=partner.id,
        student_id=student.id,
        status=ContractStatus.DRAFT,
        notes=(data.get("notes") or "").strip() or None,
    )
    db.session.add(contract)
    db.session.commit()
    return jsonify(item=contract.to_dict(include_relations=True)), 201


@bp.put("/<int:cid>")
@admin_required
def update_contract(cid):
    contract = Contract.query.get_or_404(cid)
    data = request.get_json() or {}
    if "status" in data and data["status"] in ContractStatus.ALL:
        contract.status = data["status"]
    if "notes" in data:
        contract.notes = (data["notes"] or "").strip() or None
    if "contract_date" in data:
        contract.contract_date = parse_date(data["contract_date"]) or contract.contract_date
    db.session.commit()
    return jsonify(item=contract.to_dict(include_relations=True))


@bp.post("/<int:cid>/generate")
@admin_required
def generate_contract(cid):
    contract = Contract.query.get_or_404(cid)
    try:
        generate_contract_files(contract)
    except Exception as exc:  # noqa: BLE001
        current_app.logger.exception("Contract generation failed: %s", exc)
        db.session.rollback()
        return jsonify(error=f"Не удалось сформировать договор: {exc}"), 500
    if contract.status == ContractStatus.DRAFT:
        contract.status = ContractStatus.GENERATED
    db.session.commit()
    return jsonify(item=contract.to_dict(include_relations=True))


@bp.get("/<int:cid>/download/<string:fmt>")
@jwt_required()
def download(cid, fmt):
    contract = Contract.query.get_or_404(cid)
    fmt = fmt.lower()
    if fmt == "docx" and contract.docx_path:
        rel = contract.docx_path
    elif fmt == "pdf" and contract.pdf_path:
        rel = contract.pdf_path
    elif fmt == "scan" and contract.signed_scan_path:
        rel = contract.signed_scan_path
        return send_from_directory(
            current_app.config["UPLOAD_FOLDER"], rel, as_attachment=True
        )
    else:
        return jsonify(error="Файл не найден"), 404

    base_dir = Path(current_app.config["ARCHIVE_FOLDER"])
    return send_from_directory(str(base_dir), rel, as_attachment=True)


@bp.post("/<int:cid>/upload-scan")
@admin_required
def upload_scan(cid):
    contract = Contract.query.get_or_404(cid)
    if "file" not in request.files:
        return jsonify(error="Файл не передан"), 400
    f = request.files["file"]
    ext = (f.filename.rsplit(".", 1)[-1] or "").lower() if "." in f.filename else ""
    if ext not in _ALLOWED_SCAN_EXT:
        return jsonify(error="Допустимы PDF, JPG, PNG"), 400

    stamp = utc_now().strftime("%Y%m%d_%H%M%S")
    # `secure_filename` drops non-ASCII letters and would strip Cyrillic
    # `ПП-` prefix from the contract number. Use `safe_filename` which keeps
    # Cyrillic, then defensively sanitise via secure_filename on a Latin-only
    # combination of cid + timestamp as the last-resort fallback.
    base = safe_filename(f"scan_{contract.number}_{stamp}", fallback=f"scan_{cid}_{stamp}")
    name = f"{base}.{ext}"
    dest = Path(current_app.config["UPLOAD_FOLDER"]) / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    f.save(str(dest))

    contract.signed_scan_path = name
    contract.status = ContractStatus.SCAN_UPLOADED
    db.session.commit()
    return jsonify(item=contract.to_dict(include_relations=True))


@bp.post("/<int:cid>/signature-report")
@admin_required
def generate_signature_report(cid):
    contract = Contract.query.get_or_404(cid)
    report_path = build_signature_report(contract)
    rel = str(report_path.relative_to(current_app.config["ARCHIVE_FOLDER"]))
    return jsonify(report_path=rel)


@bp.get("/<int:cid>/signature-report/download")
@jwt_required()
def download_signature_report(cid):
    contract = Contract.query.get_or_404(cid)
    report_path = build_signature_report(contract)
    rel = str(report_path.relative_to(current_app.config["ARCHIVE_FOLDER"]))
    return send_from_directory(current_app.config["ARCHIVE_FOLDER"], rel, as_attachment=True)


@bp.delete("/<int:cid>")
@admin_required
def delete_contract(cid):
    contract = Contract.query.get_or_404(cid)

    archive_base = Path(current_app.config["ARCHIVE_FOLDER"])
    upload_base = Path(current_app.config["UPLOAD_FOLDER"])
    candidate_files = []
    for rel, base in (
        (contract.docx_path, archive_base),
        (contract.pdf_path, archive_base),
        (contract.signed_scan_path, upload_base),
    ):
        if rel:
            candidate_files.append(base / rel)

    db.session.delete(contract)
    db.session.commit()

    for path in candidate_files:
        try:
            if path.is_file():
                path.unlink()
        except OSError as exc:
            current_app.logger.warning("Failed to remove %s: %s", path, exc)

    return jsonify(ok=True)
