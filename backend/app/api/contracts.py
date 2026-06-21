from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from flask_jwt_extended import jwt_required
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from ..extensions import db
from ..models import Contract, ContractStatus, Partner, Student, SigningRequest
from ..services.document_generator import generate_contract_files
from ..services.numbering import next_contract_number
from ..services.signature_report import build_signature_report
from ..utils.auth import admin_required
from ..utils.files import safe_filename
from ..utils.serializers import clean_str, get_json_safe, parse_date, parse_int
from ..utils.time import utc_now, utc_today

bp = Blueprint("contracts", __name__)

_ALLOWED_SCAN_EXT = {"pdf", "jpg", "jpeg", "png"}

# Allowed manual status transitions for PUT /contracts/<id>. The SIGNED state is
# owned exclusively by the signing flow (it is entered only when all three roles
# have a verified Signature, and left only via a forced regeneration reset), so
# it can never be a manual target. A no-op write (same status) is always allowed.
_ALLOWED_STATUS_TRANSITIONS = {
    ContractStatus.DRAFT: {ContractStatus.GENERATED},
    ContractStatus.GENERATED: {ContractStatus.SENT, ContractStatus.DRAFT},
    ContractStatus.SENT: {ContractStatus.GENERATED, ContractStatus.COMPLETED},
    ContractStatus.SIGNED: {ContractStatus.COMPLETED},
    ContractStatus.SCAN_UPLOADED: {ContractStatus.COMPLETED},
    ContractStatus.COMPLETED: {ContractStatus.SCAN_UPLOADED},
}


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
    data = get_json_safe()
    partner_id = parse_int(data.get("partner_id"))
    student_id = parse_int(data.get("student_id"))
    if not partner_id:
        return jsonify(error="Укажите партнёра"), 400
    if not student_id:
        return jsonify(error="Укажите студента"), 400

    partner = Partner.query.get(partner_id)
    if not partner:
        return jsonify(error=f"Партнёр с id={partner_id} не найден"), 404
    student = Student.query.get(student_id)
    if not student:
        return jsonify(error=f"Студент с id={student_id} не найден"), 404

    contract_date = parse_date(data.get("contract_date")) or utc_today()

    # Allocate the number + insert with a bounded retry: under concurrent
    # creation two requests can race on the per-year counter and collide on the
    # UNIQUE(number) constraint. Retry re-allocates instead of 500-ing.
    last_exc = None
    for _attempt in range(5):
        number, year, _ = next_contract_number(contract_date.year)
        contract = Contract(
            number=number,
            year=year,
            contract_date=contract_date,
            partner_id=partner.id,
            student_id=student.id,
            status=ContractStatus.DRAFT,
            notes=clean_str(data.get("notes")),
        )
        db.session.add(contract)
        try:
            db.session.commit()
            return jsonify(item=contract.to_dict(include_relations=True)), 201
        except IntegrityError as exc:
            db.session.rollback()
            last_exc = exc
    current_app.logger.exception("Contract number allocation failed: %s", last_exc)
    return jsonify(error="Не удалось присвоить номер договора, попробуйте ещё раз"), 409


@bp.put("/<int:cid>")
@admin_required
def update_contract(cid):
    contract = Contract.query.get_or_404(cid)
    data = get_json_safe()
    if "status" in data:
        new_status = data["status"]
        if new_status not in ContractStatus.ALL:
            return jsonify(error=f"Неизвестный статус: {new_status}"), 400
        current = contract.status
        if new_status != current:
            allowed = _ALLOWED_STATUS_TRANSITIONS.get(current, set())
            if new_status not in allowed:
                cur_label = ContractStatus.LABELS.get(current, current)
                new_label = ContractStatus.LABELS.get(new_status, new_status)
                return jsonify(
                    error=f"Недопустимый переход статуса: «{cur_label}» → «{new_label}»",
                    code="invalid_status_transition",
                ), 409
            contract.status = new_status
    if "notes" in data:
        contract.notes = clean_str(data.get("notes"))
    if "contract_date" in data:
        new_date = parse_date(data["contract_date"])
        if new_date:
            contract.contract_date = new_date
    db.session.commit()
    return jsonify(item=contract.to_dict(include_relations=True))


@bp.post("/<int:cid>/generate")
@admin_required
def generate_contract(cid):
    contract = Contract.query.get_or_404(cid)

    # Regenerating overwrites the DOCX at a deterministic path. Every collected
    # ЭЦП (CMS) was verified against the *current* file bytes (messageDigest ==
    # SHA-256 of the file on disk), so overwriting silently invalidates all
    # existing signatures. Refuse unless the caller explicitly forces a reset.
    data = get_json_safe()
    force = bool(data.get("force"))
    has_sigs = bool(contract.signatures)
    active_reqs = (
        SigningRequest.query.filter_by(contract_id=cid)
        .filter(SigningRequest.status.in_(("pending", "viewed", "signed")))
        .all()
    )
    if (has_sigs or active_reqs) and not force:
        return (
            jsonify(
                error="Договор уже подписывается или подписан — перегенерация "
                "сделает существующие подписи недействительными. Повторите с "
                "подтверждением, чтобы сбросить подписи.",
                code="has_signatures",
            ),
            409,
        )
    if force and (has_sigs or active_reqs):
        # Explicit reset so DB state stays consistent with the new file: drop
        # signatures, revoke open/used links, demote the status.
        for s in list(contract.signatures):
            db.session.delete(s)
        for r in active_reqs:
            r.status = "revoked"
            r.revoked_at = utc_now()
            r.signature_id = None
        if contract.status in (ContractStatus.SIGNED, ContractStatus.SENT):
            contract.status = ContractStatus.DRAFT

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
    if not f or not f.filename:
        return jsonify(error="Файл не передан"), 400
    if "." not in f.filename:
        return jsonify(error="Допустимы PDF, JPG, PNG"), 400
    ext = f.filename.rsplit(".", 1)[-1].lower()
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
