from flask import Blueprint, jsonify
from flask_jwt_extended import (
    create_access_token,
    get_jwt_identity,
    jwt_required,
)
from ..extensions import db
from ..models import User
from ..utils.serializers import get_json_safe

bp = Blueprint("auth", __name__)


@bp.post("/login")
def login():
    data = get_json_safe()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email or not password:
        return jsonify(error="Введите email и пароль"), 400

    user: User | None = User.query.filter_by(email=email).first()
    if not user or not user.check_password(password) or not user.is_active:
        return jsonify(error="Неверные учётные данные"), 401

    token = create_access_token(
        identity=str(user.id),
        additional_claims={"role": user.role, "email": user.email},
    )
    return jsonify(token=token, user=user.to_dict())


@bp.get("/me")
@jwt_required()
def me():
    user = db.session.get(User, int(get_jwt_identity()))
    if not user:
        return jsonify(error="Пользователь не найден"), 404
    return jsonify(user=user.to_dict())


@bp.post("/change-password")
@jwt_required()
def change_password():
    data = get_json_safe()
    current = data.get("current_password") or ""
    new = data.get("new_password") or ""
    if len(new) < 6:
        return jsonify(error="Пароль должен быть не короче 6 символов"), 400
    user = db.session.get(User, int(get_jwt_identity()))
    if not user or not user.check_password(current):
        return jsonify(error="Неверный текущий пароль"), 400
    user.set_password(new)
    db.session.commit()
    return jsonify(ok=True)
