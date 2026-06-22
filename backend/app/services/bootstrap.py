import os
import secrets
from pathlib import Path

from flask import current_app
from sqlalchemy.exc import IntegrityError
from ..extensions import db
from ..models import User, CollegeSettings
from .template_builder import ensure_default_template


def _seed_password(env_var: str, dev_default: str, is_debug: bool) -> tuple[str | None, bool]:
    """Resolve a seed password → (password, was_generated).

    Priority: explicit env var → (dev) well-known default → a random password
    persisted in instance/ and LOGGED. A production deploy is therefore usable
    out of the box WITHOUT shipping a publicly-known default admin password, and
    without locking the operator out entirely. The persisted file makes all
    gunicorn workers agree on the same generated value.
    """
    value = os.getenv(env_var)
    if value:
        return value, False
    if is_debug:
        return dev_default, False
    pw_file = Path(current_app.instance_path) / f".seed_{env_var.lower()}"
    try:
        if pw_file.exists():
            return pw_file.read_text().strip(), False
        generated = secrets.token_urlsafe(12)
        pw_file.parent.mkdir(parents=True, exist_ok=True)
        pw_file.write_text(generated)
        try:
            pw_file.chmod(0o600)
        except OSError:
            pass
        return generated, True
    except OSError:
        # instance/ not writable — still don't lock the operator out.
        return secrets.token_urlsafe(12), True


def ensure_seed_data() -> None:
    """Create default admin/viewer and college settings on first run.

    Safe to call concurrently from multiple gunicorn workers — duplicate inserts
    collapse via IntegrityError and we rollback gracefully.
    """
    is_debug = os.getenv("FLASK_DEBUG", "0").strip().lower() in ("1", "true", "yes")

    admin_email = os.getenv("ADMIN_EMAIL", "admin@ccu.kz")
    admin_password, admin_generated = _seed_password("ADMIN_PASSWORD", "admin123", is_debug)
    viewer_password, _ = _seed_password("VIEWER_PASSWORD", "viewer123", is_debug)

    created_admin = False
    try:
        if admin_password and not User.query.filter_by(email=admin_email).first():
            admin = User(email=admin_email, full_name="Администратор", role="admin")
            admin.set_password(admin_password)
            db.session.add(admin)
            created_admin = True

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
        # A concurrent worker won the race; it (not us) will log the credentials.
        db.session.rollback()
        created_admin = False

    # Surface generated credentials once, on the worker that actually created the
    # admin, so the operator can retrieve them from the deploy logs.
    if created_admin and admin_generated:
        current_app.logger.warning(
            "\n=== FIRST-BOOT ADMIN CREDENTIALS (set ADMIN_PASSWORD env to control these) ===\n"
            "    email:    %s\n"
            "    password: %s\n"
            "=== Log in and change the password; this is shown only on first boot. ===",
            admin_email, admin_password,
        )

    try:
        ensure_default_template(current_app.config["TEMPLATES_FOLDER"])
    except Exception as exc:  # noqa: BLE001
        current_app.logger.warning("Default template generation failed: %s", exc)
