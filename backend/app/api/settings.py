from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import jwt_required
from pathlib import Path
from werkzeug.utils import secure_filename

from ..extensions import db
from ..models import CollegeSettings
from ..utils.auth import admin_required

bp = Blueprint("settings", __name__)


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
    data = request.get_json() or {}
    for f in (
        "name_ru", "name_kz", "director_full_name", "director_basis", "address",
        "bin", "iik", "bank_name", "bank_address", "bank_bik", "email", "phone",
        "city", "contract_prefix",
    ):
        if f in data and data[f] is not None:
            setattr(s, f, str(data[f]).strip())
    db.session.commit()
    return jsonify(item=s.to_dict())


@bp.post("/template")
@admin_required
def upload_template():
    if "file" not in request.files:
        return jsonify(error="Файл не передан"), 400
    f = request.files["file"]
    if not f.filename.lower().endswith(".docx"):
        return jsonify(error="Допустимы только .docx файлы"), 400
    name = secure_filename(f.filename) or "contract_template.docx"
    dest = Path(current_app.config["TEMPLATES_FOLDER"]) / name
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
