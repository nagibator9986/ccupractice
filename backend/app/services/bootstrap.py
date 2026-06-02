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
    admin_email = os.getenv("ADMIN_EMAIL", "admin@ccu.kz")
    admin_password = os.getenv("ADMIN_PASSWORD", "admin123")

    try:
        if not User.query.filter_by(email=admin_email).first():
            admin = User(email=admin_email, full_name="Администратор", role="admin")
            admin.set_password(admin_password)
            db.session.add(admin)

        if not User.query.filter_by(email="viewer@ccu.kz").first():
            viewer = User(email="viewer@ccu.kz", full_name="Наблюдатель", role="viewer")
            viewer.set_password(os.getenv("VIEWER_PASSWORD", "viewer123"))
            db.session.add(viewer)

        if not CollegeSettings.query.first():
            db.session.add(CollegeSettings())

        db.session.commit()
    except IntegrityError:
        db.session.rollback()

    try:
        ensure_default_template(current_app.config["TEMPLATES_FOLDER"])
    except Exception as exc:  # noqa: BLE001
        current_app.logger.warning("Default template generation failed: %s", exc)
