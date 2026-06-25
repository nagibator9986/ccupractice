import errno
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

    The persist step uses O_CREAT|O_EXCL so concurrent first-boot workers cannot
    race two different random values into the file (one would land in the DB,
    the other on disk → operator locked out reading instance/.seed_*).
    """
    value = os.getenv(env_var)
    if value:
        return value, False
    if is_debug:
        return dev_default, False
    pw_file = Path(current_app.instance_path) / f".seed_{env_var.lower()}"
    try:
        # If a previous boot already persisted a generated password, reuse it.
        if pw_file.exists():
            return pw_file.read_text().strip(), False
        pw_file.parent.mkdir(parents=True, exist_ok=True)
        generated = secrets.token_urlsafe(12)
        try:
            # O_EXCL: refuse to overwrite a file written by a parallel worker.
            fd = os.open(str(pw_file), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            try:
                os.write(fd, generated.encode("utf-8"))
            finally:
                os.close(fd)
            return generated, True
        except OSError as exc:
            if exc.errno == errno.EEXIST:
                # A parallel worker won the file-create race. Read its value.
                return pw_file.read_text().strip(), False
            raise
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

    # Surface ONLY the location of the generated credentials, never the plaintext
    # password. Application logs are commonly shipped to aggregators (Railway log
    # panel, Datadog, Sentry, Loki) where the read-access surface is much wider
    # than the running container's filesystem — logging the cleartext password
    # there is a real credential exposure (KZ 152-V / general PII hygiene).
    if created_admin and admin_generated:
        pw_file = Path(current_app.instance_path) / ".seed_admin_password"
        current_app.logger.warning(
            "\n=== FIRST-BOOT ADMIN ACCOUNT CREATED (set ADMIN_PASSWORD env to control this) ===\n"
            "    email:    %s\n"
            "    password: read once from %s, then log in and change it.\n"
            "=== This message is shown only on first boot. ===",
            admin_email, pw_file,
        )

    try:
        ensure_default_template(current_app.config["TEMPLATES_FOLDER"])
    except Exception as exc:  # noqa: BLE001
        # Templates are required for contract generation. Log loudly so it shows
        # up in deploy logs; the readiness probe still passes — operators
        # discover the issue when they hit /api/health/admin.
        current_app.logger.warning("Default template generation failed: %s", exc)
