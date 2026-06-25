import logging
import os
import secrets
from datetime import timedelta
from pathlib import Path
from flask import Flask, send_from_directory, jsonify, request
from flask_cors import CORS
from flask_jwt_extended import JWTManager, jwt_required
from dotenv import load_dotenv
from sqlalchemy import event
from sqlalchemy.engine import Engine, make_url

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
    """Resolve SECRET / JWT key: env var first, else a key persisted in instance/.

    Setting SECRET_KEY / JWT_SECRET_KEY as env vars is STRONGLY recommended in
    production: instance/ is often ephemeral and per-container, so a generated key
    changes on every redeploy (logging everyone out) and differs between replicas
    (a token minted by one worker is rejected by another). We no longer crash when
    they're unset — we generate, persist and warn — so a deploy is never bricked
    by a missing secret, but the warning nudges toward stable env vars.
    """
    env_val = os.getenv(name)
    if env_val:
        return env_val

    is_debug = os.getenv("FLASK_DEBUG", "0").strip().lower() in ("1", "true", "yes")
    secret_file = instance_dir / f".{name.lower()}"
    if secret_file.exists():
        return secret_file.read_text().strip()

    value = secrets.token_hex(32)
    try:
        secret_file.parent.mkdir(parents=True, exist_ok=True)
        secret_file.write_text(value)
        secret_file.chmod(0o600)
    except OSError:
        pass
    if not is_debug:
        logging.getLogger("ccu").warning(
            "%s not set — generated an ephemeral key in instance/. Set %s as an "
            "environment variable for stable sessions across redeploys and replicas.",
            name, name,
        )
    return value


def _normalize_db_url(url: str, base_dir: Path) -> str:
    """Normalise the database URL.

    - Railway / Heroku style `postgres://` → SQLAlchemy `postgresql://`.
    - Anchor a RELATIVE sqlite path (``sqlite:///instance/ccu.db``) to base_dir.
      SQLAlchemy otherwise resolves it against the process CWD, so running
      ``flask db ...``, pytest from the repo root, or any tooling that doesn't
      chdir into backend/ would point at a different (often non-existent) file
      and fail with "unable to open database file".
    """
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    # 3 slashes (sqlite:///) = relative path; 4 (sqlite:////) = absolute.
    prefix = "sqlite:///"
    if url.startswith(prefix) and not url.startswith("sqlite:////"):
        rel = url[len(prefix):]
        if rel and rel != ":memory:" and not os.path.isabs(rel):
            url = prefix + str((base_dir / rel).resolve())
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
    db_url = _normalize_db_url(os.getenv("DATABASE_URL") or default_db, base_dir)

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
        # Legal-grade ЭЦП verification via NCANode (official KalkanCrypt SDK):
        # set NCANODE_URL to the running service to verify GOST signatures, the
        # certificate chain to the НУЦ root and revocation (OCSP/CRL). Unset =
        # in-process verification only. NCANODE_STRICT rejects (instead of
        # falling back) when NCANode is configured but unreachable.
        NCANODE_URL=os.getenv("NCANODE_URL", ""),
        NCANODE_STRICT=os.getenv("NCANODE_STRICT", "0"),
        NCANODE_VERIFY_OCSP=os.getenv("NCANODE_VERIFY_OCSP", "1"),
        NCANODE_VERIFY_CRL=os.getenv("NCANODE_VERIFY_CRL", "0"),
    )

    Path(app.config["UPLOAD_FOLDER"]).mkdir(parents=True, exist_ok=True)
    Path(app.config["ARCHIVE_FOLDER"]).mkdir(parents=True, exist_ok=True)
    Path(app.config["TEMPLATES_FOLDER"]).mkdir(parents=True, exist_ok=True)

    # ── Persistence check (one of the most common reasons for "all my data
    # disappeared after I redeployed"). On Railway / any container PaaS, the
    # filesystem inside the container is wiped on every redeploy. We log a
    # huge warning into stderr if SQLite or the file folders aren't on a
    # mounted volume, and expose the report through /healthz so it's visible
    # both in the Railway logs panel AND to any external monitor.
    from .utils.persistence import check_persistence, log_persistence_report
    persistence_report = check_persistence(
        db_url=db_url,
        archive_folder=app.config["ARCHIVE_FOLDER"],
        upload_folder=app.config["UPLOAD_FOLDER"],
        instance_folder=str(instance_dir),
    )
    log_persistence_report(persistence_report, app.logger)
    app.config["PERSISTENCE_REPORT"] = persistence_report

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
    # Never reflect an arbitrary Origin together with credentials: a wildcard
    # origin list plus supports_credentials=True is forbidden by the CORS spec
    # and turns the API into a credential-reflecting open endpoint. Auth here is
    # header-based Bearer tokens (no cookies), so credentials are only enabled
    # when an explicit allow-list is configured.
    allow_credentials = origins != ["*"]
    CORS(
        app,
        resources={r"/api/*": {"origins": origins}},
        supports_credentials=allow_credentials,
    )

    # Blueprints
    from .api.auth import bp as auth_bp
    from .api.partners import bp as partners_bp
    from .api.students import bp as students_bp
    from .api.contracts import bp as contracts_bp
    from .api.archive import bp as archive_bp
    from .api.settings import bp as settings_bp
    from .api.signatures import bp as signatures_bp
    from .api.signing import bp as signing_bp
    from .api.enrollment import bp as enrollment_bp
    from .api.specialties import bp as specialties_bp
    from .api.lms_contracts import bp as lms_contracts_bp
    from .api.verify import bp as verify_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(partners_bp, url_prefix="/api/partners")
    app.register_blueprint(students_bp, url_prefix="/api/students")
    app.register_blueprint(contracts_bp, url_prefix="/api/contracts")
    app.register_blueprint(archive_bp, url_prefix="/api/archive")
    app.register_blueprint(settings_bp, url_prefix="/api/settings")
    app.register_blueprint(signatures_bp, url_prefix="/api/signatures")
    app.register_blueprint(signing_bp, url_prefix="/api/signing")
    app.register_blueprint(enrollment_bp, url_prefix="/api/enrollments")
    app.register_blueprint(specialties_bp, url_prefix="/api/specialties")
    app.register_blueprint(lms_contracts_bp, url_prefix="/api/lms-contracts")
    app.register_blueprint(verify_bp, url_prefix="/api/verify")

    @app.get("/api/health")
    def health():
        report = app.config.get("PERSISTENCE_REPORT")
        return jsonify(
            status="ok",
            service="CCU PRACTICUM",
            persistent=bool(report and report.persistent),
            persistence=(report.asdict() if report else None),
        )

    # Liveness probe — process is up (no DB roundtrip).
    @app.get("/healthz")
    def healthz():
        report = app.config.get("PERSISTENCE_REPORT")
        body = {"status": "ok"}
        if report is not None:
            body["persistent"] = report.persistent
            if not report.persistent:
                # Surface the actionable hints right in the healthz body so
                # they show up in Railway's "Recent deploys → View logs"
                # panel without an SRE having to grep stderr.
                body["persistence_warning"] = "data is on ephemeral storage — will be wiped on next redeploy"
                body["persistence_hints"] = list(report.hints)
        return jsonify(body)

    # Readiness probe — the DB is reachable. Point the platform's readiness
    # check here so a broken-DB deploy is marked unhealthy instead of serving
    # 500s behind a green /healthz.
    @app.get("/readyz")
    def readyz():
        try:
            db.session.execute(db.text("SELECT 1"))
            report = app.config.get("PERSISTENCE_REPORT")
            body = {"status": "ready"}
            if report is not None:
                body["persistent"] = report.persistent
                if not report.persistent:
                    body["persistence_warning"] = "ephemeral storage — see /healthz for hints"
            return jsonify(body)
        except Exception as exc:  # noqa: BLE001
            app.logger.warning("Readiness check failed: %s", exc)
            db.session.rollback()
            return jsonify(status="not-ready"), 503

    # These expose archived contracts / uploaded signed scans (contract PII).
    # They MUST require auth — the SPA never uses them (it downloads via the
    # JWT-protected /api/contracts/<id>/download and the token-scoped public
    # signing routes), so without a guard they were an unauthenticated read of
    # every document to anyone who can guess a filename.
    @app.get("/api/files/archive/<path:filename>")
    @jwt_required()
    def archive_file(filename):
        return send_from_directory(app.config["ARCHIVE_FOLDER"], filename, as_attachment=True)

    @app.get("/api/files/upload/<path:filename>")
    @jwt_required()
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

    # Ensure the SQLite parent directory exists before we touch the DB (Postgres
    # ignores this). Anchored absolute path comes from _normalize_db_url.
    try:
        url_obj = make_url(db_url)
        if url_obj.get_backend_name() == "sqlite" and url_obj.database and url_obj.database != ":memory:":
            Path(url_obj.database).parent.mkdir(parents=True, exist_ok=True)
    except Exception:  # noqa: BLE001
        pass

    with app.app_context():
        # Bootstrap the schema on startup. Prefer real Alembic migrations when a
        # migrations/versions/ tree exists (so an evolving Postgres schema can be
        # ALTERed via `flask db upgrade`); otherwise fall back to create_all()
        # for a from-scratch dev DB. Seed default accounts/settings afterwards.
        if os.getenv("SKIP_DB_INIT", "").lower() not in ("1", "true", "yes"):
            try:
                migrations_dir = base_dir / "migrations"
                versions_dir = migrations_dir / "versions"
                if versions_dir.is_dir() and any(versions_dir.glob("*.py")):
                    from flask_migrate import upgrade as _alembic_upgrade
                    _alembic_upgrade(directory=str(migrations_dir))
                else:
                    db.create_all()
                from .services.bootstrap import ensure_seed_data
                ensure_seed_data()
            except Exception as exc:  # noqa: BLE001
                # On first boot multiple gunicorn workers bootstrap concurrently
                # (run:app is imported per-worker, no --preload). create_all()
                # uses checkfirst=True and migrations stamp the version table, so
                # the loser of that race can raise "table already exists" /
                # "duplicate". That is benign — log quietly. Any OTHER failure
                # (unable to open DB, auth failure, missing driver) is fatal:
                # re-raise so the worker exits non-zero and the orchestrator marks
                # the deploy failed instead of serving 500s behind a green probe.
                msg = str(exc).lower()
                if "already exists" in msg or "duplicate" in msg:
                    app.logger.info(
                        "DB schema already present (concurrent worker bootstrap): %s", exc
                    )
                else:
                    app.logger.exception("DB bootstrap failed: %s", exc)
                    raise

    return app
