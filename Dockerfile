# syntax=docker/dockerfile:1.6

# ─── Stage 1: build the Vite/React frontend ───────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /build

COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
# VITE_API_BASE_URL is empty by default so the SPA calls the same origin's
# /api path served by Flask. Override at build time if hosting elsewhere.
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build


# ─── Stage 2: runtime image with Python + LibreOffice ─────────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DEBIAN_FRONTEND=noninteractive \
    LANG=ru_RU.UTF-8 \
    LC_ALL=ru_RU.UTF-8 \
    PORT=8000

# System deps:
#   libreoffice-core / writer  → DOCX → PDF conversion via soffice
#   fonts-liberation / dejavu  → reasonable Cyrillic glyphs in PDFs
#   curl                       → for Railway / docker healthchecks
#   locales                    → ru_RU.UTF-8 for filenames + reports
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        libreoffice-core libreoffice-writer \
        fonts-liberation fonts-dejavu fonts-dejavu-core fonts-dejavu-extra \
        libpq5 \
        curl \
        locales \
        ca-certificates \
 && sed -i 's/# ru_RU.UTF-8/ru_RU.UTF-8/' /etc/locale.gen \
 && locale-gen \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (better layer cache).
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --upgrade pip \
 && pip install -r /app/backend/requirements.txt

# Copy backend source.
COPY backend/ /app/backend/

# Bring in the built frontend so Flask can serve it as static files.
COPY --from=frontend-build /build/dist /app/frontend/dist

# Persisted data dirs. To keep them across redeploys, mount a Railway Volume at
# EACH of these paths (or a single volume at /app/backend) — these exact
# directories hold the SQLite DB + JWT/secret keys (instance/), uploaded scans
# (uploads/) and generated contracts (archive/). A volume at /app/data would
# persist nothing, since nothing is written there.
RUN mkdir -p /app/backend/instance /app/backend/uploads /app/backend/archive

ENV FRONTEND_DIST=/app/frontend/dist \
    PYTHONPATH=/app/backend \
    FLASK_APP=run:app

WORKDIR /app/backend

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT:-8000}/healthz || exit 1

# Apply DB migrations ONCE here (single process) before starting the workers, so
# the per-worker boot-time upgrade is a no-op and gunicorn workers never race on
# concurrent Alembic upgrades. Then start gunicorn (2 workers × 4 threads).
# `sh -c` so $PORT (Railway-provided) is expanded at runtime.
CMD ["sh", "-c", "flask db upgrade && gunicorn --bind 0.0.0.0:${PORT:-8000} --workers ${WEB_CONCURRENCY:-2} --threads ${WEB_THREADS:-4} --timeout 180 --access-logfile - --error-logfile - run:app"]
