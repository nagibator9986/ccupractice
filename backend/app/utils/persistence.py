"""Persistence health detector.

Background
==========
On Railway / any container PaaS, each deploy starts a *fresh* container.
Anything written inside that container — including SQLite files and generated
DOCX/PDF documents — is wiped on the next deploy unless the path is backed by
a mounted Volume (Railway) or external service (e.g. the Postgres plug-in).

If the platform silently runs on ephemeral storage, EVERY redeploy resets the
whole database (admins re-create users, partners re-input contracts, etc.).
We diagnose this on every boot and:

  * log a HUGE warning into stderr (Railway's logs panel shows it instantly);
  * expose the report via ``/healthz`` so an external monitor can alert on it;
  * include a hint in ``/readyz`` so an SRE looking at the deploy logs sees the
    actionable fix without grepping.

Detection heuristic
===================
A path is "persistent" if its ``st_dev`` (filesystem device id) differs from
the container's root device. Mounted volumes always live on a separate device,
so the heuristic gives:

  * **True** when the directory is on a Railway Volume / Docker bind-mount;
  * **False** when it's on the container's overlay filesystem (ephemeral);
  * **True** outside containers (local dev) — the assumption is safe because
    on a workstation nothing wipes the directory between runs.

Postgres + any other ``DATABASE_URL`` scheme is always treated as persistent
(the platform that provisioned it owns the lifecycle).
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from urllib.parse import urlparse


# Containers used on Railway / our Dockerfile run from /app. Outside Docker,
# this path does not exist and the heuristic short-circuits to "persistent"
# (local dev shouldn't trigger the warning).
_CONTAINER_ROOT_CANDIDATES = ("/app", "/workspace")


@dataclass
class PersistenceItem:
    name: str
    kind: str          # "sqlite-file" | "directory" | "postgres" | "other-db"
    path: str | None
    persistent: bool
    detail: str

    def asdict(self) -> dict:
        return asdict(self)


@dataclass
class PersistenceReport:
    container: bool
    persistent: bool                # overall: True iff ALL items persistent
    items: list[PersistenceItem] = field(default_factory=list)
    hints: list[str] = field(default_factory=list)

    def asdict(self) -> dict:
        return {
            "container": self.container,
            "persistent": self.persistent,
            "items": [it.asdict() for it in self.items],
            "hints": self.hints,
        }


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

def _container_root() -> Path | None:
    """Return the first existing container-root candidate, or None outside Docker."""
    for c in _CONTAINER_ROOT_CANDIDATES:
        p = Path(c)
        if p.is_dir():
            return p
    return None


def _path_is_persistent(path: Path, container_root: Path | None) -> tuple[bool, str]:
    """st_dev-based check — see module docstring.

    Always-persistent outside containers (local dev). Inside containers, a path
    is persistent iff its ``st_dev`` differs from the container root.
    """
    if container_root is None:
        return True, "not running in a known container layout"
    try:
        root_dev = os.stat(container_root).st_dev
    except OSError as exc:
        return True, f"cannot stat container root: {exc}"

    # Create the directory so `st_dev` is well-defined even on first boot.
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        return False, f"cannot create {path}: {exc}"
    try:
        path_dev = os.stat(path).st_dev
    except OSError as exc:
        return False, f"cannot stat {path}: {exc}"

    if path_dev != root_dev:
        return True, "lives on a separate (mounted) filesystem"
    return False, "lives on the container's ephemeral overlay filesystem"


def _classify_db(db_url: str) -> tuple[str, Path | None]:
    """(kind, sqlite_file_path) — kind is 'sqlite-file' / 'postgres' / 'other-db'."""
    try:
        parsed = urlparse(db_url)
    except Exception:
        return "other-db", None

    scheme = (parsed.scheme or "").lower()
    if scheme.startswith("postgres"):
        return "postgres", None
    if scheme.startswith("mysql") or scheme.startswith("mariadb"):
        return "other-db", None
    if scheme.startswith("sqlite"):
        # `sqlite:///relative.db`     -> path = "/relative.db" via urlparse
        # `sqlite:////abs/path.db`    -> path = "//abs/path.db"
        raw = parsed.path or ""
        if not raw:
            return "sqlite-file", None
        # Strip the leading "/" that urlparse leaves; the SQLAlchemy convention
        # is `sqlite:///path` (3 slashes = relative) vs `sqlite:////` (4 = abs).
        if db_url.startswith("sqlite:////"):
            return "sqlite-file", Path(raw)
        # Relative form — re-anchor.
        return "sqlite-file", Path(raw.lstrip("/"))
    return "other-db", None


# ────────────────────────────────────────────────────────────────────────────
# Public API
# ────────────────────────────────────────────────────────────────────────────

def check_persistence(
    *,
    db_url: str,
    archive_folder: str | os.PathLike,
    upload_folder: str | os.PathLike,
    instance_folder: str | os.PathLike,
) -> PersistenceReport:
    """Inspect the platform's storage paths and produce a report."""
    container_root = _container_root()
    report = PersistenceReport(container=container_root is not None, persistent=True)

    # ── Database ──
    db_kind, sqlite_path = _classify_db(db_url)
    if db_kind == "postgres":
        report.items.append(PersistenceItem(
            name="database",
            kind="postgres",
            path=None,
            persistent=True,
            detail="managed Postgres — persistence handled by the provider",
        ))
    elif db_kind == "other-db":
        report.items.append(PersistenceItem(
            name="database",
            kind="other-db",
            path=None,
            persistent=True,
            detail=f"non-sqlite scheme — assuming managed",
        ))
    else:
        # sqlite-file
        if sqlite_path is None:
            report.items.append(PersistenceItem(
                name="database",
                kind="sqlite-file",
                path=None,
                persistent=False,
                detail="DATABASE_URL is sqlite:// but no file path could be parsed",
            ))
            report.persistent = False
        else:
            # The SQLite *file* lives inside its parent directory; check the dir.
            parent = sqlite_path.parent if sqlite_path.parent != Path("") else Path(".")
            ok, why = _path_is_persistent(parent, container_root)
            report.items.append(PersistenceItem(
                name="database",
                kind="sqlite-file",
                path=str(sqlite_path),
                persistent=ok,
                detail=why,
            ))
            if not ok:
                report.persistent = False

    # ── Files ──
    # The `instance/` directory only holds secrets (.secret_key,
    # .jwt_secret_key, .seed_admin_password). If the corresponding env vars are
    # set — which is the recommended production setup — those files are never
    # consulted, so the directory does NOT need to be on a Volume. We still
    # report it, but mark it as covered-by-env so the overall verdict isn't
    # falsely red.
    env_covered_instance = bool(
        os.getenv("SECRET_KEY") and os.getenv("JWT_SECRET_KEY")
    )

    for name, raw in (
        ("instance", instance_folder),
        ("archive", archive_folder),
        ("uploads", upload_folder),
    ):
        p = Path(raw)
        ok, why = _path_is_persistent(p, container_root)

        effective_ok = ok
        effective_why = why
        if name == "instance" and not ok and env_covered_instance:
            effective_ok = True
            effective_why = (
                f"{why}; covered by SECRET_KEY + JWT_SECRET_KEY env vars "
                f"— no file fallback needed"
            )

        report.items.append(PersistenceItem(
            name=name,
            kind="directory",
            path=str(p),
            persistent=effective_ok,
            detail=effective_why,
        ))
        if not effective_ok:
            report.persistent = False

    # ── Hints ──
    if not report.persistent:
        report.hints = _build_hints(report)

    return report


def _build_hints(report: PersistenceReport) -> list[str]:
    bad = [it for it in report.items if not it.persistent]
    hints: list[str] = [
        "ALL data created via the SPA will be lost on the next redeploy.",
    ]
    # Database hint
    db_item = next((it for it in bad if it.name == "database"), None)
    if db_item is not None:
        hints.append(
            "FIX (DB): add the PostgreSQL plug-in in the Railway dashboard "
            "(`+ New → Database → PostgreSQL`). The `DATABASE_URL` env var is "
            "set automatically; the application detects the new URL on next "
            "boot — no code change needed."
        )
        hints.append(
            "ALTERNATIVE: mount a Railway Volume to `/app/backend/instance` "
            "so the SQLite file `ccu.db` survives redeploys."
        )
    # Directory hint
    dirs = [it for it in bad if it.kind == "directory"]
    if dirs:
        paths = ", ".join(it.path or "?" for it in dirs)
        hints.append(
            f"FIX (files): mount a Railway Volume to each of: {paths}. "
            "Generated DOCX / PDF documents and uploaded scans live here; "
            "without a Volume they disappear on every redeploy."
        )
    return hints


# ────────────────────────────────────────────────────────────────────────────
# Logging helper — called once on app startup so the report is the first
# thing an SRE sees in Railway's logs panel.
# ────────────────────────────────────────────────────────────────────────────

def log_persistence_report(report: PersistenceReport, logger) -> None:
    if report.persistent:
        logger.info("Persistence check OK (container=%s)", report.container)
        return

    # Print to stderr too — Railway's logs panel auto-highlights warnings, and
    # this needs to be impossible to miss.
    banner = "═" * 76
    msg_lines = [
        "",
        banner,
        "⚠⚠⚠   PERSISTENCE WARNING — DATA WILL BE LOST ON NEXT DEPLOY   ⚠⚠⚠",
        banner,
        "",
        "The platform is running with ephemeral storage. Every redeploy starts",
        "a fresh container and wipes the directories listed below:",
        "",
    ]
    for it in report.items:
        marker = "✓" if it.persistent else "✗"
        msg_lines.append(f"  {marker} {it.name:9s} [{it.kind}]  {it.path or '—'}")
        msg_lines.append(f"      └ {it.detail}")
    msg_lines.append("")
    for h in report.hints:
        msg_lines.append(f"  • {h}")
    msg_lines.append("")
    msg_lines.append(banner)
    msg_lines.append("")

    full_msg = "\n".join(msg_lines)
    # Logger path keeps the message in structured logs.
    logger.error("Persistence check FAILED:\n%s", full_msg)
    # Direct stderr write keeps the banner readable even when the log handler
    # serialises records as JSON.
    sys.stderr.write(full_msg + "\n")
    sys.stderr.flush()
