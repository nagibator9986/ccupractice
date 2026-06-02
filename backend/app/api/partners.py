from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import or_
from ..extensions import db
from ..models import Partner
from ..utils.auth import admin_required
from ..utils.serializers import parse_date, parse_int

bp = Blueprint("partners", __name__)


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
    data = request.get_json() or {}
    if not data.get("organization_name"):
        return jsonify(error="Укажите наименование организации"), 400
    partner = Partner()
    _apply(partner, data)
    db.session.add(partner)
    db.session.commit()
    return jsonify(item=partner.to_dict()), 201


@bp.put("/<int:pid>")
@admin_required
def update_partner(pid):
    partner = Partner.query.get_or_404(pid)
    _apply(partner, request.get_json() or {})
    db.session.commit()
    return jsonify(item=partner.to_dict())


@bp.delete("/<int:pid>")
@admin_required
def delete_partner(pid):
    partner = Partner.query.get_or_404(pid)
    if partner.contracts:
        return jsonify(error="Нельзя удалить партнера с договорами"), 409
    db.session.delete(partner)
    db.session.commit()
    return jsonify(ok=True)


def _apply(partner: Partner, data: dict) -> None:
    fields = (
        "organization_name", "bin", "legal_address", "actual_address",
        "director_full_name", "director_position", "director_basis",
        "contact_person", "phone", "email", "specialty", "contract_status",
        "bank_name", "bank_bik", "bank_iik", "notes",
    )
    for f in fields:
        if f in data:
            setattr(partner, f, (data.get(f) or "").strip() if isinstance(data.get(f), str) else data.get(f))
    if "seats_count" in data:
        partner.seats_count = parse_int(data["seats_count"]) or 0
    if "contract_valid_until" in data:
        partner.contract_valid_until = parse_date(data["contract_valid_until"])
