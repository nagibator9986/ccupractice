from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from ..extensions import db
from ..models import Partner, Student, Contract
from ..utils.auth import admin_required
from ..utils.serializers import (
    clean_str,
    get_json_safe,
    parse_date,
    parse_positive_int,
)

bp = Blueprint("partners", __name__)

# Text fields with their max DB lengths from the model.
_TEXT_FIELDS = {
    "organization_name": 300,
    "bin": 20,
    "legal_address": 500,
    "actual_address": 500,
    "director_full_name": 200,
    "director_position": 200,
    "director_basis": 300,
    "contact_person": 200,
    "phone": 60,
    "email": 160,
    "specialty": 200,
    "contract_status": 40,
    "bank_name": 200,
    "bank_bik": 40,
    "bank_iik": 50,
}


@bp.get("")
@jwt_required()
def list_partners():
    q = (request.args.get("q") or "").strip()
    query = Partner.query
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                Partner.organization_name.ilike(like),
                Partner.bin.ilike(like),
                Partner.contact_person.ilike(like),
                Partner.specialty.ilike(like),
            )
        )
    items = query.order_by(Partner.organization_name.asc()).all()
    return jsonify(items=[p.to_dict() for p in items], total=len(items))


@bp.get("/<int:pid>")
@jwt_required()
def get_partner(pid):
    partner = Partner.query.get_or_404(pid)
    return jsonify(item=partner.to_dict())


@bp.post("")
@admin_required
def create_partner():
    data = get_json_safe()
    name = clean_str(data.get("organization_name"), max_len=_TEXT_FIELDS["organization_name"])
    if not name:
        return jsonify(error="Укажите наименование организации"), 400

    # Optional uniqueness check on BIN to prevent accidental duplicates.
    bin_value = clean_str(data.get("bin"), max_len=_TEXT_FIELDS["bin"])
    if bin_value and Partner.query.filter_by(bin=bin_value).first():
        return jsonify(error=f"Партнёр с БИН {bin_value} уже существует"), 409

    partner = Partner(organization_name=name, bin=bin_value)
    _apply(partner, data, skip=("organization_name", "bin"))
    db.session.add(partner)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(error=f"Партнёр с БИН {bin_value} уже существует"), 409
    return jsonify(item=partner.to_dict()), 201


@bp.put("/<int:pid>")
@admin_required
def update_partner(pid):
    partner = Partner.query.get_or_404(pid)
    data = get_json_safe()
    if "organization_name" in data:
        name = clean_str(data.get("organization_name"), max_len=_TEXT_FIELDS["organization_name"])
        if not name:
            return jsonify(error="Наименование организации не может быть пустым"), 400
        partner.organization_name = name
    if "bin" in data:
        bin_value = clean_str(data.get("bin"), max_len=_TEXT_FIELDS["bin"])
        if bin_value:
            dup = Partner.query.filter_by(bin=bin_value).filter(Partner.id != pid).first()
            if dup:
                return jsonify(error=f"Партнёр с БИН {bin_value} уже существует"), 409
        partner.bin = bin_value
    _apply(partner, data, skip=("organization_name", "bin"))
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(error="Партнёр с таким БИН уже существует"), 409
    return jsonify(item=partner.to_dict())


@bp.delete("/<int:pid>")
@admin_required
def delete_partner(pid):
    partner = Partner.query.get_or_404(pid)
    contracts_count = Contract.query.filter_by(partner_id=pid).count()
    if contracts_count:
        return jsonify(
            error=f"Нельзя удалить партнёра — связаны {contracts_count} договор(ов). Сначала удалите или переназначьте их."
        ), 409
    # Block deletion if students reference this partner — otherwise SQLAlchemy
    # nullifies their partner_id and we lose the link silently.
    students_count = Student.query.filter_by(partner_id=pid).count()
    if students_count:
        return jsonify(
            error=f"Нельзя удалить партнёра — у него {students_count} студент(ов). Сначала переназначьте студентов другому партнёру."
        ), 409
    db.session.delete(partner)
    try:
        db.session.commit()
    except IntegrityError:
        # A contract referencing this partner was inserted between the check and
        # the delete (the NOT NULL FK then rejects the delete). Report cleanly.
        db.session.rollback()
        return jsonify(error="Нельзя удалить партнёра — есть связанные договоры."), 409
    return jsonify(ok=True)


def _apply(partner: Partner, data: dict, *, skip=()) -> None:
    for field, max_len in _TEXT_FIELDS.items():
        if field in skip or field not in data:
            continue
        setattr(partner, field, clean_str(data.get(field), max_len=max_len))
    if "seats_count" in data:
        partner.seats_count = parse_positive_int(data["seats_count"], minimum=0, default=0)
    if "contract_valid_until" in data:
        partner.contract_valid_until = parse_date(data["contract_valid_until"])
    if "notes" in data:
        partner.notes = clean_str(data.get("notes"))
