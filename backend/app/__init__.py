import os
import secrets
from datetime import timedelta
from pathlib import Path
from flask import Flask, send_from_directory, jsonify, request
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv
from sqlalchemy import event
from sqlalchemy.engine import Engine

from .extensions import db, migrate


# Enforce foreign-key constraints on every SQLite connection so dangling
# references can't silently break referential integrity (Postgres does it
# natively; SQLite needs the pragma per-connection).
@event.listens_for(Engine, "connect")
def _enable_sqlite_fk(dbapi_connection, _conn_record):
    try:
        if dbapi_connection.__class__.__module__.startswith("sqlite3"):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
    except Exception:
        pass


def _persistent_secret(name: str, instance_dir: Path) -> str:
    """Read SECRET / JWT key from env, else lazy-generate to instance/ file.

    In production set SECRET_KEY / JWT_SECRET_KEY via Railway env vars so the
    value survives across redeploys (instance/ may be ephemeral).
    """
    env_val = os.getenv(name)
    if env_val:
        return env_val
    secret_file = instance_dir / f".{name.lower()}"
    if secret_file.exists():
        return secret_file.read_text().strip()
    value = secrets.token_hex(32)
    secret_file.parent.mkdir(parents=True, exist_ok=True)
    secret_file.write_text(value)
    try:
        secret_file.chmod(0o600)
    except OSError:
        pass
    return value


def _normalize_db_url(url: str) -> str:
    """Railway / Heroku style `postgres://` → SQLAlchemy `postgresql://`."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return url


def create_app() -> Flask:
    load_dotenv()
    base_dir = Path(__file__).resolve().parent.parent

    # Where to serve the built frontend from (Vite `dist`). Configurable for
    # Railway/Docker layouts where frontend is copied next to the backend.
    frontend_dist = Path(
        os.getenv("FRONTEND_DIST", str(base_dir.parent / "frontend" / "dist"))
    ).resolve()

    # We serve the SPA ourselves via an explicit catch-all so that unknown
    # paths fall back to index.html (React Router). Flask's built-in static
    # handler is left at the default /static/ prefix to avoid clashes.
    app = Flask(__name__, instance_path=str(base_dir / "instance"))
    Path(app.instance_path).mkdir(parents=True, exist_ok=True)

    instance_dir = Path(app.instance_path)

    default_db = f"sqlite:///{base_dir / 'instance' / 'ccu.db'}"
    db_url = _normalize_db_url(os.getenv("DATABASE_URL") or default_db)

    app.config.update(
        SECRET_KEY=_persistent_secret("SECRET_KEY", instance_dir),
        JWT_SECRET_KEY=_persistent_secret("JWT_SECRET_KEY", instance_dir),
        SQLALCHEMY_DATABASE_URI=db_url,
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        SQLALCHEMY_ENGINE_OPTIONS={"pool_pre_ping": True},
        UPLOAD_FOLDER=str(base_dir / os.getenv("UPLOAD_FOLDER", "uploads")),
        ARCHIVE_FOLDER=str(base_dir / os.getenv("ARCHIVE_FOLDER", "archive")),
        TEMPLATES_FOLDER=str(base_dir / "templates_docx"),
        MAX_CONTENT_LENGTH=int(os.getenv("MAX_CONTENT_LENGTH", 33_554_432)),
        JWT_ACCESS_TOKEN_EXPIRES=timedelta(hours=int(os.getenv("JWT_TTL_HOURS", "12"))),
        FRONTEND_DIST=str(frontend_dist),
    )

    Path(app.config["UPLOAD_FOLDER"]).mkdir(parents=True, exist_ok=True)
    Path(app.config["ARCHIVE_FOLDER"]).mkdir(parents=True, exist_ok=True)
    Path(app.config["TEMPLATES_FOLDER"]).mkdir(parents=True, exist_ok=True)

    db.init_app(app)
    migrate.init_app(app, db)

    # ── JWT: normalise every auth-related failure to a JSON 401 so the SPA
    # interceptor reliably redirects to /login instead of silently failing
    # with "Ошибка сохранения" toasts (default Flask-JWT-Extended returns 422
    # for malformed/invalid tokens which the SPA can't distinguish from
    # business errors).
    jwt = JWTManager(app)

    @jwt.unauthorized_loader
    def _unauthorized(reason):
        return jsonify(error="Требуется авторизация", reason=reason), 401

    @jwt.invalid_token_loader
    def _invalid(reason):
        return jsonify(error="Некорректный токен авторизации", reason=reason), 401

    @jwt.expired_token_loader
    def _expired(_jwt_header, _jwt_data):
        return jsonify(error="Сессия истекла, войдите снова", code="token_expired"), 401

    @jwt.revoked_token_loader
    def _revoked(_jwt_header, _jwt_data):
        return jsonify(error="Токен отозван", code="token_revoked"), 401

    @jwt.needs_fresh_token_loader
    def _needs_fresh(_jwt_header, _jwt_data):
        return jsonify(error="Требуется свежая авторизация"), 401

    cors_origins = os.getenv("CORS_ORIGINS", "*")
    origins = [o.strip() for o in cors_origins.split(",") if o.strip()] or ["*"]
    CORS(app, resources={r"/api/*": {"origins": origins}}, supports_credentials=True)

    # Blueprints
    from .api.auth import bp as auth_bp
    from .api.partners import bp as partners_bp
    from .api.students import bp as students_bp
    from .api.contracts import bp as contracts_bp
    from .api.archive import bp as archive_bp
    from .api.settings import bp as settings_bp
    from .api.signatures import bp as signatures_bp
    from .api.signing import bp as signing_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(partners_bp, url_prefix="/api/partners")
    app.register_blueprint(students_bp, url_prefix="/api/students")
    app.register_blueprint(contracts_bp, url_prefix="/api/contracts")
    app.register_blueprint(archive_bp, url_prefix="/api/archive")
    app.register_blueprint(settings_bp, url_prefix="/api/settings")
    app.register_blueprint(signatures_bp, url_prefix="/api/signatures")
    app.register_blueprint(signing_bp, url_prefix="/api/signing")

    @app.get("/api/health")
    def health():
        return jsonify(status="ok", service="CCU PRACTICUM")

    # Railway / load-balancer health probe (no DB roundtrip).
    @app.get("/healthz")
    def healthz():
        return jsonify(status="ok")

    @app.get("/api/files/archive/<path:filename>")
    def archive_file(filename):
        return send_from_directory(app.config["ARCHIVE_FOLDER"], filename, as_attachment=True)

    @app.get("/api/files/upload/<path:filename>")
    def upload_file(filename):
        return send_from_directory(app.config["UPLOAD_FOLDER"], filename, as_attachment=True)

    # ── Serve built frontend (SPA) in production ────────────────────────────
    if frontend_dist.exists():
        @app.get("/")
        def spa_root():
            return send_from_directory(str(frontend_dist), "index.html")

        @app.get("/<path:path>")
        def spa_catch_all(path: str):
            # API and reserved prefixes are handled above; everything else
            # serves the SPA's index.html so React Router can take over.
            if path.startswith("api/"):
                return jsonify(error="Not found"), 404
            candidate = frontend_dist / path
            if candidate.is_file():
                return send_from_directory(str(frontend_dist), path)
            return send_from_directory(str(frontend_dist), "index.html")

    with app.app_context():
        # Auto-bootstrap on first run. For Postgres in multi-worker setups
        # this is idempotent; race is harmless because IntegrityErrors on the
        # seed are swallowed by the unique constraints + rollback.
        if os.getenv("SKIP_DB_INIT", "").lower() not in ("1", "true", "yes"):
            try:
                db.create_all()
                from .services.bootstrap import ensure_seed_data
                ensure_seed_data()
            except Exception as exc:  # noqa: BLE001
                app.logger.exception("DB bootstrap failed: %s", exc)

    return app
