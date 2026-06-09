from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import jwt_required
from pathlib import Path

from ..extensions import db
from ..models import CollegeSettings
from ..utils.auth import admin_required
from ..utils.files import safe_filename
from ..utils.serializers import clean_str, get_json_safe

bp = Blueprint("settings", __name__)

_FIELD_LIMITS = {
    "name_ru": 300, "name_kz": 300, "director_full_name": 200,
    "director_basis": 200, "address": 300, "bin": 20, "iik": 40,
    "bank_name": 200, "bank_address": 200, "bank_bik": 40,
    "email": 160, "phone": 60, "city": 80, "contract_prefix": 10,
}


@bp.get("/college")
@jwt_required()
def get_settings():
    s = CollegeSettings.query.first()
    if not s:
        s = CollegeSettings()
        db.session.add(s)
        db.session.commit()
    return jsonify(item=s.to_dict())


@bp.put("/college")
@admin_required
def update_settings():
    s = CollegeSettings.query.first()
    if not s:
        s = CollegeSettings()
        db.session.add(s)
    data = get_json_safe()
    for field, max_len in _FIELD_LIMITS.items():
        if field in data:
            setattr(s, field, clean_str(data[field], max_len=max_len))
    # Require at least a college name
    if not s.name_ru:
        return jsonify(error="Поле «Наименование (рус.)» обязательно"), 400
    db.session.commit()
    return jsonify(item=s.to_dict())


@bp.post("/template")
@admin_required
def upload_template():
    if "file" not in request.files:
        return jsonify(error="Файл не передан"), 400
    f = request.files["file"]
    if not f or not f.filename:
        return jsonify(error="Файл не передан"), 400
    if not f.filename.lower().endswith(".docx"):
        return jsonify(error="Допустимы только .docx файлы"), 400
    # Use safe_filename (keeps Cyrillic) — secure_filename strips all non-ASCII,
    # so e.g. «Договор_2024.docx» collapses to «2024.docx» and distinct Cyrillic
    # templates silently overwrite each other.
    name = safe_filename(f.filename, fallback="contract_template.docx")
    if not name.lower().endswith(".docx"):
        name = name + ".docx"
    dest = Path(current_app.config["TEMPLATES_FOLDER"]) / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    f.save(str(dest))
    s = CollegeSettings.query.first()
    if not s:
        s = CollegeSettings()
        db.session.add(s)
    s.template_path = name
    db.session.commit()
    return jsonify(template=name)


@bp.get("/template/info")
@jwt_required()
def template_info():
    s = CollegeSettings.query.first()
    name = (s.template_path if s else "contract_template.docx") or "contract_template.docx"
    path = Path(current_app.config["TEMPLATES_FOLDER"]) / name
    return jsonify(
        template=name,
        exists=path.exists(),
        size=path.stat().st_size if path.exists() else 0,
    )
