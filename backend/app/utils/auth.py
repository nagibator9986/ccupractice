from functools import wraps
from flask import jsonify
from flask_jwt_extended import get_jwt, verify_jwt_in_request


def role_required(*allowed_roles):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            claims = get_jwt()
            role = claims.get("role")
            if role not in allowed_roles:
                return jsonify(error="Недостаточно прав"), 403
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def admin_required(fn):
    return role_required("admin")(fn)
