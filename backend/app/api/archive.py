from pathlib import Path
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import or_

from ..models import Contract, Partner, Student

bp = Blueprint("archive", __name__)


@bp.get("")
@jwt_required()
def list_archive():
    q = (request.args.get("q") or "").strip()
    year = request.args.get("year")
    query = Contract.query.join(Partner).join(Student).filter(Contract.docx_path.isnot(None))
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                Contract.number.ilike(like),
                Partner.organization_name.ilike(like),
                Student.full_name.ilike(like),
            )
        )
    if year:
        try:
            year_int = int(year)
        except (TypeError, ValueError):
            # Don't silently ignore a malformed year and return the FULL archive,
            # which looks like "the filter worked, there are just many results".
            return jsonify(error="Параметр «year» должен быть числом"), 400
        query = query.filter(Contract.year == year_int)

    items = []
    base = Path(current_app.config["ARCHIVE_FOLDER"])
    for c in query.order_by(Contract.year.desc(), Contract.created_at.desc()).all():
        d = c.to_dict()
        d["docx_exists"] = bool(c.docx_path and (base / c.docx_path).exists())
        d["pdf_exists"] = bool(c.pdf_path and (base / c.pdf_path).exists())
        items.append(d)
    return jsonify(items=items, total=len(items))


@bp.get("/tree")
@jwt_required()
def tree():
    """Hierarchical view: Year -> Partner -> Contracts."""
    rows = (
        Contract.query.join(Partner)
        .filter(Contract.docx_path.isnot(None))
        .order_by(Contract.year.desc(), Partner.organization_name.asc(), Contract.number.asc())
        .all()
    )
    base = Path(current_app.config["ARCHIVE_FOLDER"])
    tree_data: dict = {}
    for c in rows:
        year_key = str(c.year)
        partner_key = c.partner.organization_name
        d = c.to_dict()
        d["docx_exists"] = bool(c.docx_path and (base / c.docx_path).exists())
        d["pdf_exists"] = bool(c.pdf_path and (base / c.pdf_path).exists())
        tree_data.setdefault(year_key, {}).setdefault(partner_key, []).append(d)
    return jsonify(tree=tree_data)
