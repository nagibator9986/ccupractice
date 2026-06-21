import os
from flask import current_app
from sqlalchemy.exc import IntegrityError
from ..extensions import db
from ..models import User, CollegeSettings
from .template_builder import ensure_default_template


def ensure_seed_data() -> None:
    """Create default admin and college settings on first run.

    Safe to call concurrently from multiple gunicorn workers — duplicate
    inserts collapse via IntegrityError and we rollback gracefully.
    """
    # Only fall back to well-known default passwords in debug/dev. In any
    # non-debug (i.e. production-like) environment, refuse to seed an account
    # with a hardcoded password — otherwise a publicly reachable deployment
    # ships with universally-known admin credentials.
    is_debug = os.getenv("FLASK_DEBUG", "0").strip().lower() in ("1", "true", "yes")

    def _seed_password(env_var: str, dev_default: str) -> str | None:
        value = os.getenv(env_var)
        if value:
            return value
        if is_debug:
            return dev_default
        current_app.logger.error(
            "%s not set; refusing to seed default account in non-debug environment.",
            env_var,
        )
        return None

    admin_email = os.getenv("ADMIN_EMAIL", "admin@ccu.kz")
    admin_password = _seed_password("ADMIN_PASSWORD", "admin123")
    viewer_password = _seed_password("VIEWER_PASSWORD", "viewer123")

    try:
        if admin_password and not User.query.filter_by(email=admin_email).first():
            admin = User(email=admin_email, full_name="Администратор", role="admin")
            admin.set_password(admin_password)
            db.session.add(admin)

        if viewer_password and not User.query.filter_by(email="viewer@ccu.kz").first():
            viewer = User(email="viewer@ccu.kz", full_name="Наблюдатель", role="viewer")
            viewer.set_password(viewer_password)
            db.session.add(viewer)

        if not CollegeSettings.query.first():
            # Fixed singleton PK so a concurrent second worker collides on the
            # primary key (IntegrityError -> rollback below) instead of silently
            # inserting a duplicate settings row (CollegeSettings is treated as a
            # singleton via .query.first() throughout the codebase).
            db.session.add(CollegeSettings(id=1))

        db.session.commit()
    except IntegrityError:
        db.session.rollback()

    try:
        ensure_default_template(current_app.config["TEMPLATES_FOLDER"])
    except Exception as exc:  # noqa: BLE001
        current_app.logger.warning("Default template generation failed: %s", exc)
