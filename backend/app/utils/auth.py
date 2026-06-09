from functools import wraps
from flask import jsonify
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request

from ..extensions import db
from ..models import User


def role_required(*allowed_roles):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            # Re-validate against the live DB on every protected request rather
            # than trusting the role/is_active snapshot baked into the JWT at
            # login. This makes deactivation, deletion and demotion take effect
            # immediately instead of lingering until the token's 12h expiry.
            user = db.session.get(User, int(get_jwt_identity()))
            if not user or not user.is_active:
                return jsonify(error="Учётная запись недоступна", code="account_inactive"), 401
            if user.role not in allowed_roles:
                return jsonify(error="Недостаточно прав"), 403
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def admin_required(fn):
    return role_required("admin")(fn)
