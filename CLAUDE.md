# CLAUDE.md — CCU PRACTICUM

Authoritative engineering guide for this repository. Read it before changing
code. Written for an engineer who is also accountable for the business outcome:
legally-valid, correctly-signed college documents.

---

## 1. What this product is (business context)

CCU PRACTICUM is the digital contract platform for **Колледж УО «Каспийский
общественный университет» (Caspian College)**, Kazakhstan. It replaces manual
Word editing + wet-ink signing with generated documents signed by **ЭЦП**
(qualified e-signature) via **NCALayer** (НУЦ РК).

Two independent business processes live here:

| Process | Parties | Documents | Where |
| --- | --- | --- | --- |
| **Производственная практика** (internship) | Колледж · Предприятие (partner) · Студент | one three-party contract | `Contract`, `/contracts` |
| **Договоры со студентом** (enrollment) | Колледж · Абитуриент/Студент · Родитель | educational-services contract + personal-data consent + (optional) Caspian Digital/LMS contract | `EnrollmentContract`, `/enrollments` |

The two processes share infrastructure (auth, archive, NCALayer signing, PDF
conversion) but have separate models, APIs, generators and pages. **Do not
conflate them.**

**Non-negotiable domain rules**

- Документы — двуязычные (қазақша + на русском) двухколоночные таблицы. The
  generated file must match the College's official source layout exactly — same
  section order, same wording, ЭЦП/signature in the right place. A "tidied" or
  Russian-only rewrite is a regression, not an improvement.
- Кто подписывает определяется возрастом абитуриента на дату договора:
  `< 16` → подписывает законный представитель (родитель); `≥ 16` → подписывает
  сам абитуриент, а родитель дополнительно подписывает согласие. This is encoded
  once in `signing_matrix()` — never duplicate the age logic elsewhere.
- The signed payload is the **DOCX bytes**, bound by `messageDigest ==
  SHA-256(DOCX)`. If the document a signer sees diverges from the bytes they
  sign, the signature is legally worthless. Treat document integrity as sacred.

---

## 2. Architecture

```
backend/  Flask 3 + SQLAlchemy 2 + Flask-JWT-Extended + Flask-Migrate (Alembic)
  app/
    api/        blueprints: auth, partners, students, contracts, archive,
                settings, signatures, signing, enrollment, specialties
    models/     SQLAlchemy models (one file per aggregate)
    services/   document generation, template builders, numbering, CMS verify
    utils/      auth (RBAC), serializers, files, time
  templates_docx/
    source/     ← pristine official .docx (the source of truth for templates)
    *.docx      ← docxtpl-ready templates (generated from source/ or committed)
  migrations/   Alembic; applied automatically on startup
frontend/  React 18 + Vite 5 + Tailwind 3 + react-router 6 + axios
  src/{api,components,context,pages,utils}
```

- DB: SQLite in dev, PostgreSQL in prod (Railway). `DATABASE_URL` is normalised
  in `app/__init__.py` (`postgres://`→`postgresql://`; relative sqlite anchored
  to `backend/`).
- One Flask process serves both the JSON API (`/api/*`) and the built SPA.
- Startup runs `flask db upgrade` (if `migrations/versions/*` exist) else
  `create_all()`, then seeds default accounts/settings.

---

## 3. Domain model (enrollment — the active area)

`EnrollmentContract` holds applicant + parent + program + finance fields and the
generated file paths. Key derived properties (single source of truth — use them,
don't re-derive):

- `applicant_age` — full years at `contract_date`.
- `required_matrix` → `signing_matrix(applicant_age, include_lms)` →
  `{party: [document_keys]}`.
- `relevant_documents` → which documents this enrollment issues
  (`contract`, `consent`, and `lms` only when `include_lms`).
- `is_fully_signed` — every (document, party) pair in the matrix has a signature.

Document keys: `DOC_CONTRACT`, `DOC_CONSENT`, `DOC_LMS`. Parties:
`PARTY_STUDENT`, `PARTY_PARENT`. File paths follow `{document}_{fmt}_path`
(`e.doc_path(doc, fmt)`), so the whole stack is document-key driven — add a key
and most endpoints flow through.

Signing tables: `EnrollmentSignature` (unique on
`enrollment_id+document+signer_party`) and `EnrollmentSigningRequest` (one
tokenized link per party; public URL `/enroll-sign/<token>`).

---

## 4. Document generation — the critical subsystem

**Principle: render real documents, never hand-rebuild them.**

The official contracts are bilingual two-column tables. We take the pristine
`.docx` from `templates_docx/source/` and inject `{{ jinja }}` tags **only into
the blank fill-in fields**, leaving 100% of the official layout/wording intact.
This is why `enrollment_template_builder.py` works the way it does:

- `_fill_paragraph(paragraph, {occurrence: tag})` replaces a run of `_{3,}`
  underscores with a Jinja tag **inside the run that holds it**, so run-level
  formatting (bold quoted terms) is preserved and the tag never splits across
  runs (docxtpl requires a contiguous tag).
- Fill maps `EDU_FILLS` / `LMS_FILLS` are `(row, col, paragraph_idx, {occ: tag})`
  coordinates **verified against the source**. `_build_from_source` asserts the
  exact replacement count (`_EDU_EXPECTED` / `_LMS_EXPECTED`) so a source edit
  that shifts paragraph indices fails loudly instead of producing a silently
  misaligned contract.
- The consent is RU-only in the original, so its template stays single-language
  and is generated programmatically (age-aware) in `build_consent_template`.

`enrollment_documents.py` builds the render context (`_build_context`), renders
each document with `docxtpl`, converts to PDF via LibreOffice (`soffice`,
isolated profile per call), and keeps the archive consistent (deletes stale PDFs
before reconversion; rolls back files on a mid-batch failure).

### How to add or change a document

1. Put the pristine `.docx` in `templates_docx/source/`.
2. Dump its table cells (`python-docx`) to find the blank fill-in fields:
   their `(row, col, paragraph_idx)` and the left-to-right blank occurrence.
3. Add a fill map; bump the output `*_FILENAME` version so it regenerates.
4. Add the doc key to `models/enrollment.py` (`DOC_*`, `DOCUMENTS`,
   `DOCUMENT_LABELS`, `signing_matrix`, `relevant_documents`), add
   `{doc}_docx_path/{doc}_pdf_path` columns + a migration, render it in
   `generate_enrollment_files`, and surface it in the API document list.
5. Verify by rendering with sample data and re-dumping the output — assert the
   fields land in **both** language columns and no `{{` survives.

Never edit a generated `templates_docx/*.docx` by hand — edit the source +
builder and regenerate, or the change is lost on the next rebuild.

---

## 5. Signing subsystem (ЭЦП / NCALayer)

- Client: `frontend/src/utils/ncalayer.js` talks to NCALayer over
  `wss://127.0.0.1:13579`. Load-bearing params: `decode: true` (boolean — sign
  raw DOCX bytes), `extKeyUsageOids: []` (required by NCALayer), ignore the
  version-handshake message.
- Server: `services/signature_service.py::parse_cms_signature` parses the CMS,
  picks the signer cert via `SignerInfo.sid`, verifies `messageDigest ==
  SHA-256(payload)`, verifies the RSA/ECDSA signature over the SignedAttributes,
  rejects weak digests (`< sha256`) and expired/not-yet-valid certs.
- KZ national **GOST** certs (OID arc `1.2.398.3.10`, Қалқан) are common.
  `cryptography` can't verify GOST 34.10/34.11, so they take a national path:
  identity + cert validity are enforced and the document binding is checked
  best-effort via Streebog (`gostcrypto`) — never hard-rejected on a hash miss
  (KZ GOST may differ from Russian Streebog), only warned. RSA/ECDSA keep full
  cryptographic verification (digest + signature).
- **Legal-grade verification via NCANode** is wired: set `NCANODE_URL` to a
  running NCANode service (official KalkanCrypt SDK) and `verify_cms_signature`
  (the orchestrator the endpoints call) routes every CMS through it — full GOST
  signature + cert chain to the НУЦ root + OCSP/CRL revocation. NCANode is
  authoritative: invalid/revoked → reject. Unreachable → fall back to in-process
  (or reject if `NCANODE_STRICT=1`). Setup: `docs/NCANODE_SETUP.md`.
- Every signature records a **`verification_level`** (`legal` | `full` |
  `document_bound` | `accepted`) shown to the admin via `VerificationBadge`, so
  the real assurance per signature is auditable. `legal` = NCANode-verified.
  Without `NCANODE_URL`: RSA/ECDSA = `full`, GOST = `document_bound`/`accepted`.
- Out of scope (documented MVP limit): cert-chain to НУЦ root, CRL/OCSP, TSA
  timestamps; server-side asymmetric verification of GOST signatures.
- Public token flow: GET preview is read-only; `pending→viewed` is an explicit
  POST; the signer can preview the full **bilingual PDF inline** (`?inline=1`)
  before signing; one signature per (enrollment, document, party) enforced by a
  UNIQUE constraint; status flips to SIGNED when the whole matrix is satisfied
  (recomputed from committed rows so concurrent submits converge).

---

## 6. Conventions

- **Backend**: blueprints per resource, `@jwt_required()` for reads,
  `@admin_required` for writes. Validate/clean with `utils/serializers`
  (`clean_str`, `parse_int`, `parse_date`, `get_json_safe`). Catch
  `IntegrityError` → 409 for uniqueness races. Times via `utils/time`
  (`utc_now`, `utc_today`) — never `datetime.now()` / `date.today()` in handlers.
- **Frontend**: pages in `pages/`, shared `Modal`/`Field`/`SpecialtyPicker` in
  `components/`, axios wrappers in `api/endpoints.js`. Inputs are controlled and
  rendered through the stable shared `Field` components — **never define a
  component inside another component's render** (it remounts and drops focus;
  this exact bug bit the modal once). Loaders always `try/catch` with a toast and
  a safe state reset.
- **Migrations**: every model change ships an Alembic migration whose
  `down_revision` chains to the current head. Use `batch_alter_table` (SQLite
  can't `ALTER` in place). Startup applies them automatically.
- **RBAC**: `role_required` re-checks the live DB user every request, so
  deactivation/demotion take effect immediately.

---

## 7. Run, build, verify

```bash
# Backend
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && python run.py        # http://127.0.0.1:5000
# Frontend
cd frontend && npm install && npm run dev               # http://127.0.0.1:5173
```

Default accounts (dev): `admin@ccu.kz / admin123`, `viewer@ccu.kz / viewer123`.
PDF conversion needs LibreOffice (`soffice` on PATH); without it DOCX still
generates and the UI degrades gracefully.

**Verification bar (do this before declaring done):**

- `python -m compileall app migrations` clean.
- App boots on a fresh DB through migrations; `/readyz` returns ready.
- For any document change: render with sample data, re-dump the output, assert
  both language columns are filled and no `{{` survives.
- `npm run build` succeeds.
- Functional checks via Flask test client for changed endpoints (auth, 403 for
  viewer writes, 409 for uniqueness/locked states).

Never mark work done without proving it. If tests fail, say so with the output.

---

## 8. Deploy (Railway)

Multi-stage `Dockerfile`: node build → `python:3.12-slim` runtime with
LibreOffice + ru locale; `gunicorn` serves API + SPA. Mount a Volume to
`/app/backend/{archive,uploads}` so generated documents and scans survive
redeploys. Required env: `SECRET_KEY`, `JWT_SECRET_KEY`, `DATABASE_URL` (Postgres
plugin), `ADMIN_PASSWORD`, `CORS_ORIGINS`. Railway deploys committed `main`, so
a fix only reaches production after commit + push.

---

## 9. Working agreements

- Plan first for non-trivial work; stop and re-plan if something goes sideways.
- Smallest correct change; find root causes, no band-aids.
- Preserve legal-document fidelity above code elegance — when in doubt, match the
  original.
- Confirm before outward-facing/irreversible actions (push, deploy, deleting
  archived PII).
```
