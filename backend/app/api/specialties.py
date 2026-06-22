"""Specialties dictionary (раздел «Данные»).

A small admin-managed reference list of {specialty, code, qualification} used to
populate the picker on contract forms. Reads are available to any authenticated
user (the picker must work for whoever fills a contract); writes are admin-only.
"""
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import or_

from ..extensions import db
from ..models import Specialty
from ..utils.auth import admin_required
from ..utils.serializers import clean_str, get_json_safe, parse_int

bp = Blueprint("specialties", __name__)

_NAME_MAX = 200
_CODE_MAX = 60
_QUAL_MAX = 200


def _truthy(value, default=True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "on")


@bp.get("")
@jwt_required()
def list_specialties():
    q = (request.args.get("q") or "").strip()
    # `active=1` returns only enabled rows (what the contract picker wants);
    # omit it on the management page to see hidden rows too.
    active_only = request.args.get("active") in ("1", "true", "yes")
    query = Specialty.query
    if active_only:
        query = query.filter(Specialty.is_active.is_(True))
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                Specialty.name.ilike(like),
                Specialty.code.ilike(like),
                Specialty.qualification.ilike(like),
            )
        )
    items = query.order_by(
        Specialty.sort_order.asc(), Specialty.name.asc(), Specialty.id.asc()
    ).all()
    return jsonify(items=[s.to_dict() for s in items], total=len(items))


@bp.post("")
@admin_required
def create_specialty():
    data = get_json_safe()
    name = clean_str(data.get("name"), max_len=_NAME_MAX)
    if not name:
        return jsonify(error="Укажите название специальности"), 400
    s = Specialty(
        name=name,
        code=clean_str(data.get("code"), max_len=_CODE_MAX),
        qualification=clean_str(data.get("qualification"), max_len=_QUAL_MAX),
        is_active=_truthy(data.get("is_active"), default=True),
        sort_order=parse_int(data.get("sort_order")) or 0,
    )
    db.session.add(s)
    db.session.commit()
    return jsonify(item=s.to_dict()), 201


@bp.put("/<int:sid>")
@admin_required
def update_specialty(sid):
    s = Specialty.query.get_or_404(sid)
    data = get_json_safe()
    if "name" in data:
        name = clean_str(data.get("name"), max_len=_NAME_MAX)
        if not name:
            return jsonify(error="Название специальности не может быть пустым"), 400
        s.name = name
    if "code" in data:
        s.code = clean_str(data.get("code"), max_len=_CODE_MAX)
    if "qualification" in data:
        s.qualification = clean_str(data.get("qualification"), max_len=_QUAL_MAX)
    if "is_active" in data:
        s.is_active = _truthy(data.get("is_active"), default=True)
    if "sort_order" in data:
        s.sort_order = parse_int(data.get("sort_order")) or 0
    db.session.commit()
    return jsonify(item=s.to_dict())


@bp.delete("/<int:sid>")
@admin_required
def delete_specialty(sid):
    s = Specialty.query.get_or_404(sid)
    # Specialties are referenced by VALUE (copied onto the contract as free text),
    # not by FK, so deleting one never breaks an existing contract.
    db.session.delete(s)
    db.session.commit()
    return jsonify(ok=True)
