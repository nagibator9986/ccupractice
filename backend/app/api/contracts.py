import os
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, send_file, send_from_directory
from flask_jwt_extended import jwt_required
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import contains_eager, selectinload
from ..extensions import db
from ..models import Contract, ContractStatus, Partner, Student, SigningRequest
from ..services.document_generator import generate_contract_files
from ..services.numbering import next_contract_number
from ..services.readiness import check_readiness
from ..services.signature_report import build_signature_report
from ..utils.auth import admin_required
from ..utils.files import safe_filename
from ..utils.serializers import clean_str, get_json_safe, parse_date, parse_int
from ..utils.time import utc_now, utc_today

bp = Blueprint("contracts", __name__)

_ALLOWED_SCAN_EXT = {"pdf", "jpg", "jpeg", "png"}

# Allowed manual status transitions for PUT /contracts/<id>. The SIGNED state is
# owned exclusively by the signing flow (it is entered only when all three roles
# have a verified Signature, and left only via a forced regeneration reset), so
# it can never be a manual target. A no-op write (same status) is always allowed.
_ALLOWED_STATUS_TRANSITIONS = {
    ContractStatus.DRAFT: {ContractStatus.GENERATED},
    ContractStatus.GENERATED: {ContractStatus.SENT, ContractStatus.DRAFT},
    ContractStatus.SENT: {ContractStatus.GENERATED, ContractStatus.COMPLETED},
    ContractStatus.SIGNED: {ContractStatus.COMPLETED},
    ContractStatus.SCAN_UPLOADED: {ContractStatus.COMPLETED},
    ContractStatus.COMPLETED: {ContractStatus.SCAN_UPLOADED},
}


def _filtered_query():
    """Contracts matching the list filters (shared by the list and the Excel
    export so the file always contains exactly what the screen showed)."""
    q = (request.args.get("q") or "").strip()
    status = (request.args.get("status") or "").strip()
    group = (request.args.get("group") or "").strip()
    specialty = (request.args.get("specialty") or "").strip()
    date_from = parse_date(request.args.get("date_from"))
    date_to = parse_date(request.args.get("date_to"))
    partner_id = parse_int(request.args.get("partner_id"))
    student_id = parse_int(request.args.get("student_id"))
    year = parse_int(request.args.get("year"))

    query = (
        Contract.query.join(Contract.partner).join(Contract.student)
        .options(
            contains_eager(Contract.partner),
            contains_eager(Contract.student),
            selectinload(Contract.signatures),
            selectinload(Contract.signing_requests),
        )
    )
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                Contract.number.ilike(like),
                Partner.organization_name.ilike(like),
                Student.full_name.ilike(like),
                Student.iin.ilike(like),
            )
        )
    if status:
        # A single status, or a comma list («signed,scan_uploaded,completed»).
        wanted = [x for x in (part.strip() for part in status.split(",")) if x]
        query = query.filter(Contract.status.in_(wanted) if len(wanted) > 1 else Contract.status == wanted[0])
    if (request.args.get("has_file") or "").lower() in ("1", "true", "yes"):
        query = query.filter(Contract.docx_path.isnot(None))
    if group:
        from .student_bulk import group_filter

        query = query.filter(group_filter(Student.group_name, group))
    if specialty:
        query = query.filter(Student.specialty.ilike(f"%{specialty}%"))
    if date_from:
        query = query.filter(Contract.contract_date >= date_from)
    if date_to:
        query = query.filter(Contract.contract_date <= date_to)
    if partner_id:
        query = query.filter(Contract.partner_id == partner_id)
    if student_id:
        query = query.filter(Contract.student_id == student_id)
    if year:
        query = query.filter(Contract.year == year)
    return query


@bp.get("")
@jwt_required()
def list_contracts():
    items = _filtered_query().order_by(Contract.created_at.desc(), Contract.id.desc()).all()
    return jsonify(items=[c.to_dict() for c in items], total=len(items))


@bp.get("/export")
@jwt_required()
def export_contracts():
    """Register of contracts as .xlsx (honours the same filters as the list)."""
    from openpyxl import Workbook

    from ..services.xlsx_utils import table_sheet, workbook_response

    items = _filtered_query().order_by(Contract.year.desc(), Contract.number.asc()).all()
    mark = lambda c, role: "✓" if role in c.signed_roles else ""  # noqa: E731
    rows = []
    for c in items:
        st, pa = c.student, c.partner
        rows.append([
            c.number, c.contract_date, ContractStatus.LABELS.get(c.status, c.status),
            pa.organization_name if pa else "", pa.bin if pa else "",
            st.full_name if st else "", st.iin if st else "", st.group_name if st else "",
            st.specialty if st else "",
            st.practice_start if st else None, st.practice_end if st else None,
            mark(c, "college"), mark(c, "partner"), mark(c, "student"),
            c.notes or "",
        ])
    wb = Workbook()
    ws = wb.active
    ws.title = "Договоры практики"
    table_sheet(
        ws,
        ["№ договора", "Дата договора", "Статус", "Предприятие", "БИН", "Студент", "ИИН", "Группа",
         "Специальность", "Начало практики", "Окончание практики", "Подпись колледжа",
         "Подпись предприятия", "Подпись студента", "Примечание"],
        rows, required=[True] * 15, text_columns=(5, 7),
    )
    for row in ws.iter_rows(min_row=2, min_col=2, max_col=2):
        for cell in row:
            cell.number_format = "DD.MM.YYYY"
    for col in ("J", "K"):
        for cell in ws[col][1:]:
            cell.number_format = "DD.MM.YYYY"
    return workbook_response(wb, f"Договоры_практики_{utc_today():%Y-%m-%d}.xlsx")


@bp.get("/stats")
@jwt_required()
def stats():
    """Numbers for the dashboard: pipeline, per-group progress, what needs attention."""
    from datetime import timedelta

    from .student_bulk import list_groups

    today = utc_today()
    now = utc_now()
    contracts = (
        Contract.query.join(Contract.partner).join(Contract.student)
        .options(contains_eager(Contract.partner), contains_eager(Contract.student),
                 selectinload(Contract.signatures), selectinload(Contract.signing_requests))
        .order_by(Contract.created_at.desc(), Contract.id.desc())
        .all()
    )
    by_status = {st: 0 for st in ContractStatus.ALL}
    by_action: dict[str, int] = {}
    expiring, stale, drafts_incomplete = [], [], []
    for c in contracts:
        by_status[c.status] = by_status.get(c.status, 0) + 1
        by_action[c.next_action] = by_action.get(c.next_action, 0) + 1
        for r in c.signing_requests:
            if r.status in ("pending", "viewed") and r.expires_at and now <= r.expires_at <= now + timedelta(days=7):
                expiring.append({
                    "contract_id": c.id, "number": c.number, "student_name": c.student.full_name,
                    "role": r.signer_role, "expires_at": r.expires_at.isoformat(),
                })
        if c.status == ContractStatus.SENT and c.updated_at and (now - c.updated_at).days >= 7 and not c.signatures:
            stale.append({"contract_id": c.id, "number": c.number, "student_name": c.student.full_name,
                          "partner_name": c.partner.organization_name, "days": (now - c.updated_at).days})
        if c.status in (ContractStatus.DRAFT, ContractStatus.GENERATED) and len(drafts_incomplete) < 10:
            rd = check_readiness(c.student, c.partner)
            if not rd["ok"]:
                drafts_incomplete.append({"contract_id": c.id, "number": c.number,
                                          "student_name": c.student.full_name, "critical": rd["critical"]})

    student_ids_with_contract = {c.student_id for c in contracts}
    total_students = Student.query.count()
    partners = Partner.query.all()
    expired_partners = [
        {"id": p.id, "name": p.organization_name, "valid_until": p.contract_valid_until.isoformat()}
        for p in partners if p.contract_valid_until and p.contract_valid_until < today
    ]
    groups = list_groups().get_json()["items"]
    return jsonify(
        totals={
            "students": total_students,
            "students_with_contract": len(student_ids_with_contract),
            "students_without_contract": max(total_students - len(student_ids_with_contract), 0),
            "partners": len(partners),
            "contracts": len(contracts),
            "fully_signed": sum(1 for c in contracts if c.status in (
                ContractStatus.SIGNED, ContractStatus.SCAN_UPLOADED, ContractStatus.COMPLETED)),
        },
        by_status=by_status,
        by_next_action=by_action,
        attention={
            "links_expiring": sorted(expiring, key=lambda x: x["expires_at"])[:10],
            "links_expiring_total": len(expiring),
            "stale_sent": sorted(stale, key=lambda x: -x["days"])[:10],
            "stale_sent_total": len(stale),
            "incomplete_drafts": drafts_incomplete,
            "expired_partners": expired_partners[:10],
            "expired_partners_total": len(expired_partners),
        },
        groups=groups,
        recent=[c.to_dict() for c in contracts[:8]],
    )


@bp.get("/readiness")
@jwt_required()
def readiness_preview():
    """Pre-flight check before a contract exists (create dialog)."""
    student = db.session.get(Student, parse_int(request.args.get("student_id")) or 0)
    partner = db.session.get(Partner, parse_int(request.args.get("partner_id")) or 0)
    result = check_readiness(student, partner)
    dup = None
    if student and partner:
        found = Contract.query.filter_by(student_id=student.id, partner_id=partner.id).order_by(Contract.id.desc()).first()
        if found:
            dup = {"id": found.id, "number": found.number, "year": found.year, "status": found.status}
    others = Contract.query.filter_by(student_id=student.id).count() if student else 0
    return jsonify(readiness=result, duplicate=dup, student_contracts=others)


@bp.get("/<int:cid>")
@jwt_required()
def get_contract(cid):
    contract = Contract.query.get_or_404(cid)
    return jsonify(item=_detail(contract))


def _detail(contract: Contract) -> dict:
    """Card payload: the contract plus what is still missing to generate it."""
    item = contract.to_dict(include_relations=True)
    item["readiness"] = check_readiness(contract.student, contract.partner)
    return item


@bp.post("")
@admin_required
def create_contract():
    data = get_json_safe()
    partner_id = parse_int(data.get("partner_id"))
    student_id = parse_int(data.get("student_id"))
    if not partner_id:
        return jsonify(error="Укажите партнёра"), 400
    if not student_id:
        return jsonify(error="Укажите студента"), 400

    partner = Partner.query.get(partner_id)
    if not partner:
        return jsonify(error=f"Партнёр с id={partner_id} не найден"), 404
    student = Student.query.get(student_id)
    if not student:
        return jsonify(error=f"Студент с id={student_id} не найден"), 404

    contract_date = parse_date(data.get("contract_date")) or utc_today()

    # Same student + same partner + same year is almost always a double click or
    # a forgotten earlier draft. Refuse unless the operator insists.
    twin = Contract.query.filter_by(
        student_id=student.id, partner_id=partner.id, year=contract_date.year
    ).order_by(Contract.id.desc()).first()
    if twin and not data.get("allow_duplicate"):
        return jsonify(
            error=f"Для студента «{student.full_name}» и предприятия «{partner.organization_name}» "
                  f"уже есть договор № {twin.number} за {twin.year} год.",
            code="duplicate_contract",
            existing_contract_id=twin.id,
            existing_contract_number=twin.number,
        ), 409

    # Allocate the number + insert with a bounded retry: under concurrent
    # creation two requests can race on the per-year counter and collide on the
    # UNIQUE(number) constraint. Retry re-allocates instead of 500-ing.
    last_exc = None
    for _attempt in range(5):
        number, year, _ = next_contract_number(contract_date.year)
        contract = Contract(
            number=number,
            year=year,
            contract_date=contract_date,
            partner_id=partner.id,
            student_id=student.id,
            status=ContractStatus.DRAFT,
            notes=clean_str(data.get("notes")),
        )
        db.session.add(contract)
        try:
            db.session.commit()
            return jsonify(item=_detail(contract)), 201
        except IntegrityError as exc:
            db.session.rollback()
            last_exc = exc
    current_app.logger.exception("Contract number allocation failed: %s", last_exc)
    return jsonify(error="Не удалось присвоить номер договора, попробуйте ещё раз"), 409


_BULK_LIMIT = 500


@bp.post("/bulk")
@admin_required
def bulk_create():
    """Create one draft contract per student (a whole group in one call).

    Body: ``student_ids`` | ``group``; ``partner_id`` (omit to use each student's
    own partner); ``contract_date``; ``existing`` = ``skip`` (default: a student
    who already has a contract this year is left out) | ``allow``;
    ``skip_incomplete`` (default true: students with critical gaps are listed,
    not created); ``dry_run`` returns the per-student verdict without writing.

    Documents are NOT generated here — LibreOffice takes seconds per PDF, so the
    SPA drives generation one contract at a time with a progress bar.
    """
    from ..services.student_import import group_key, normalize_name
    from .student_bulk import select_students

    data = get_json_safe()
    students, err = select_students(data)
    if err:
        return jsonify(error=err), 400
    if not students:
        return jsonify(error="Студенты не найдены"), 404
    if len(students) > _BULK_LIMIT:
        return jsonify(error=f"За один раз можно оформить не более {_BULK_LIMIT} договоров"), 400

    fixed_partner = None
    if data.get("partner_id") not in (None, ""):
        fixed_partner = db.session.get(Partner, parse_int(data.get("partner_id")) or 0)
        if fixed_partner is None:
            return jsonify(error="Партнёр не найден"), 404
    contract_date = parse_date(data.get("contract_date")) or utc_today()
    allow_existing = (data.get("existing") or "skip") == "allow"
    skip_incomplete = data.get("skip_incomplete", True) is not False
    dry_run = bool(data.get("dry_run"))

    partners = {p.id: p for p in Partner.query.all()}
    year_contracts: dict[int, str] = {}
    for sid, number in db.session.query(Contract.student_id, Contract.number).filter(
        Contract.year == contract_date.year
    ).order_by(Contract.id.asc()):
        year_contracts[sid] = number

    students.sort(key=lambda s: (group_key(s.group_name or "") or "~", normalize_name(s.full_name)))
    items, to_create = [], []
    for s in students:
        partner = fixed_partner or partners.get(s.partner_id)
        entry = {
            "student_id": s.id, "full_name": s.full_name, "group_name": s.group_name or "",
            "partner_id": partner.id if partner else None,
            "partner_name": partner.organization_name if partner else None,
            "action": "create", "code": None, "reason": None, "missing": [],
            "contract_id": None, "number": None,
        }
        if partner is None:
            entry.update(action="skip", code="no_partner", reason="Не назначено предприятие")
        elif not allow_existing and s.id in year_contracts:
            entry.update(action="skip", code="has_contract",
                         reason=f"Уже есть договор № {year_contracts[s.id]} за {contract_date.year} год",
                         number=year_contracts[s.id])
        else:
            rd = check_readiness(s, partner)
            entry["missing"] = [m["label"] for m in rd["missing"] if m["severity"] == "critical"]
            if not rd["ok"] and skip_incomplete:
                entry.update(action="skip", code="incomplete",
                             reason="Не хватает данных: " + ", ".join(entry["missing"]))
            else:
                to_create.append((s, partner, entry))
        items.append(entry)

    warnings = []
    per_partner: dict[int, int] = {}
    for _, partner, _ in to_create:
        per_partner[partner.id] = per_partner.get(partner.id, 0) + 1
    for pid, n in per_partner.items():
        partner = partners[pid]
        if partner.seats_count:
            already = Contract.query.filter_by(partner_id=pid, year=contract_date.year).count()
            if already + n > partner.seats_count:
                warnings.append({
                    "code": "partner_overbooked", "partner_id": pid,
                    "message": f"«{partner.organization_name}»: мест {partner.seats_count}, "
                               f"будет договоров {already + n}",
                })
        if partner.contract_valid_until and partner.contract_valid_until < contract_date:
            warnings.append({
                "code": "partner_expired", "partner_id": pid,
                "message": f"Срок договора с «{partner.organization_name}» истёк "
                           f"{partner.contract_valid_until:%d.%m.%Y}",
            })

    created_ids: list[int] = []
    if not dry_run and to_create:
        try:
            for s, partner, entry in to_create:
                number, year, _ = next_contract_number(contract_date.year)
                contract = Contract(
                    number=number, year=year, contract_date=contract_date,
                    partner_id=partner.id, student_id=s.id, status=ContractStatus.DRAFT,
                    notes=clean_str(data.get("notes")),
                )
                db.session.add(contract)
                db.session.flush()
                entry.update(contract_id=contract.id, number=number)
                created_ids.append(contract.id)
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return jsonify(error="Не удалось присвоить номера договоров, попробуйте ещё раз"), 409

    counts = {"create": 0, "skip": 0}
    for e in items:
        counts[e["action"]] += 1
    return jsonify(
        ok=True, dry_run=dry_run,
        created=len(created_ids), will_create=counts["create"], skipped=counts["skip"],
        contract_ids=created_ids, items=items, warnings=warnings,
    ), (200 if dry_run or not to_create else 201)


@bp.put("/<int:cid>")
@admin_required
def update_contract(cid):
    contract = Contract.query.get_or_404(cid)
    data = get_json_safe()
    if "status" in data:
        new_status = data["status"]
        if new_status not in ContractStatus.ALL:
            return jsonify(error=f"Неизвестный статус: {new_status}"), 400
        current = contract.status
        if new_status != current:
            allowed = _ALLOWED_STATUS_TRANSITIONS.get(current, set())
            if new_status not in allowed:
                cur_label = ContractStatus.LABELS.get(current, current)
                new_label = ContractStatus.LABELS.get(new_status, new_status)
                return jsonify(
                    error=f"Недопустимый переход статуса: «{cur_label}» → «{new_label}»",
                    code="invalid_status_transition",
                ), 409
            contract.status = new_status
    if "notes" in data:
        contract.notes = clean_str(data.get("notes"))
    warning = None
    if "contract_date" in data:
        new_date = parse_date(data["contract_date"])
        if new_date and new_date != contract.contract_date:
            # The date is printed in the signed DOCX: changing it under a
            # signature would leave the record disagreeing with the document.
            if contract.signatures:
                return jsonify(
                    error="Договор уже подписан — менять дату нельзя. Сбросьте подписи пересформированием.",
                    code="has_signatures",
                ), 409
            contract.contract_date = new_date
            if contract.docx_path:
                warning = "Дата изменена — пересформируйте договор, чтобы она попала в документ."
    db.session.commit()
    return jsonify(item=_detail(contract), warning=warning)


@bp.post("/<int:cid>/generate")
@admin_required
def generate_contract(cid):
    contract = Contract.query.get_or_404(cid)

    # Regenerating overwrites the DOCX at a deterministic path. Every collected
    # ЭЦП (CMS) was verified against the *current* file bytes (messageDigest ==
    # SHA-256 of the file on disk), so overwriting silently invalidates all
    # existing signatures. Refuse unless the caller explicitly forces a reset.
    data = get_json_safe()
    force = bool(data.get("force"))

    # A contract with no ИИН / dates / partner requisites is not worth signing.
    readiness = check_readiness(contract.student, contract.partner)
    if not readiness["ok"] and not data.get("allow_incomplete"):
        crit = [m["label"] for m in readiness["missing"] if m["severity"] == "critical"]
        return jsonify(
            error="Не заполнены обязательные данные: " + ", ".join(crit),
            code="incomplete",
            readiness=readiness,
        ), 422

    has_sigs = bool(contract.signatures)
    active_reqs = (
        SigningRequest.query.filter_by(contract_id=cid)
        .filter(SigningRequest.status.in_(("pending", "viewed", "signed")))
        .all()
    )
    if (has_sigs or active_reqs) and not force:
        return (
            jsonify(
                error="Договор уже подписывается или подписан — перегенерация "
                "сделает существующие подписи недействительными. Повторите с "
                "подтверждением, чтобы сбросить подписи.",
                code="has_signatures",
            ),
            409,
        )
    if force and (has_sigs or active_reqs):
        # Explicit reset so DB state stays consistent with the new file: drop
        # signatures, revoke open/used links, demote the status.
        for s in list(contract.signatures):
            db.session.delete(s)
        for r in active_reqs:
            r.status = "revoked"
            r.revoked_at = utc_now()
            r.signature_id = None
        # Any status that coexisted with signatures/active requests (SIGNED, SENT,
        # but also COMPLETED or SCAN_UPLOADED reached via a manual transition or a
        # scan upload while signed) must be demoted now that every signature has
        # been dropped — otherwise the contract is left in a terminal/"finalized"
        # state with a brand-new unsigned document and zero signatures. We are
        # already inside `if force and (has_sigs or active_reqs)`, so a reset
        # definitely happened; demote unconditionally. Line below re-promotes
        # DRAFT -> GENERATED so the result is a consistent GENERATED contract.
        contract.status = ContractStatus.DRAFT

    # Front-end origin (sent via axios as X-Public-Origin) is the URL we want
    # the QR-stamp on the generated document to point at.
    public_base = (
        request.headers.get("X-Public-Origin")
        or os.getenv("PUBLIC_BASE_URL")
        or None
    )
    try:
        generate_contract_files(contract, public_base=public_base)
    except Exception as exc:  # noqa: BLE001
        current_app.logger.exception("Contract generation failed: %s", exc)
        db.session.rollback()
        return jsonify(error=f"Не удалось сформировать договор: {exc}"), 500
    if contract.status == ContractStatus.DRAFT:
        contract.status = ContractStatus.GENERATED
    db.session.commit()
    return jsonify(item=_detail(contract))


def serve_contract_pdf(contract: Contract, *, inline: bool, public_base: str | None):
    """PDF response; with signatures the visualisation annex is merged on the fly.

    Shared with the public signing links so a signer sees (and downloads) the
    same file the college does.
    """
    archive_root = current_app.config["ARCHIVE_FOLDER"]
    rel = contract.pdf_path
    base_pdf = Path(archive_root) / rel
    if contract.signatures:
        from ..services.pdf_visualization import merge_practicum_pdf

        try:
            merged = merge_practicum_pdf(contract, base_pdf, public_base=public_base)
        except Exception as exc:  # noqa: BLE001
            current_app.logger.exception("Practicum PDF merge failed: %s", exc)
            merged = base_pdf
        if merged and Path(merged).is_file():
            return send_file(
                str(merged), as_attachment=not inline,
                download_name=Path(rel).name, mimetype="application/pdf",
            )
    return send_from_directory(archive_root, rel, as_attachment=not inline, mimetype="application/pdf")


@bp.get("/<int:cid>/download/<string:fmt>")
@jwt_required()
def download(cid, fmt):
    """Practicum contract download (``?inline=1`` for the in-browser preview).

    For PDF on contracts with signatures, merges the signature-report PDF
    annex onto the original. DOCX stays raw (signed payload).
    """
    contract = Contract.query.get_or_404(cid)
    fmt = fmt.lower()
    inline = (request.args.get("inline") or "").lower() in ("1", "true", "yes")
    if fmt == "scan" and contract.signed_scan_path:
        return send_from_directory(
            current_app.config["UPLOAD_FOLDER"], contract.signed_scan_path, as_attachment=not inline
        )
    if fmt == "docx" and contract.docx_path:
        return send_from_directory(current_app.config["ARCHIVE_FOLDER"], contract.docx_path, as_attachment=True)
    if fmt == "pdf" and contract.pdf_path:
        if not (Path(current_app.config["ARCHIVE_FOLDER"]) / contract.pdf_path).is_file():
            return jsonify(error="PDF-файл отсутствует на сервере. Пересформируйте договор."), 404
        return serve_contract_pdf(
            contract, inline=inline, public_base=request.headers.get("X-Public-Origin") or None
        )
    return jsonify(error="Файл не найден"), 404


@bp.post("/<int:cid>/upload-scan")
@admin_required
def upload_scan(cid):
    contract = Contract.query.get_or_404(cid)
    if "file" not in request.files:
        return jsonify(error="Файл не передан"), 400
    f = request.files["file"]
    if not f or not f.filename:
        return jsonify(error="Файл не передан"), 400
    if "." not in f.filename:
        return jsonify(error="Допустимы PDF, JPG, PNG"), 400
    ext = f.filename.rsplit(".", 1)[-1].lower()
    if ext not in _ALLOWED_SCAN_EXT:
        return jsonify(error="Допустимы PDF, JPG, PNG"), 400

    stamp = utc_now().strftime("%Y%m%d_%H%M%S")
    # `secure_filename` drops non-ASCII letters and would strip Cyrillic
    # `ПП-` prefix from the contract number. Use `safe_filename` which keeps
    # Cyrillic, then defensively sanitise via secure_filename on a Latin-only
    # combination of cid + timestamp as the last-resort fallback.
    base = safe_filename(f"scan_{contract.number}_{stamp}", fallback=f"scan_{cid}_{stamp}")
    name = f"{base}.{ext}"
    dest = Path(current_app.config["UPLOAD_FOLDER"]) / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    f.save(str(dest))

    contract.signed_scan_path = name
    contract.status = ContractStatus.SCAN_UPLOADED
    db.session.commit()
    return jsonify(item=_detail(contract))


@bp.post("/<int:cid>/signature-report")
@admin_required
def generate_signature_report(cid):
    contract = Contract.query.get_or_404(cid)
    report_path = build_signature_report(contract)
    rel = str(report_path.relative_to(current_app.config["ARCHIVE_FOLDER"]))
    return jsonify(report_path=rel)


@bp.get("/<int:cid>/signature-report/download")
@jwt_required()
def download_signature_report(cid):
    contract = Contract.query.get_or_404(cid)
    report_path = build_signature_report(contract)
    rel = str(report_path.relative_to(current_app.config["ARCHIVE_FOLDER"]))
    return send_from_directory(current_app.config["ARCHIVE_FOLDER"], rel, as_attachment=True)


@bp.delete("/<int:cid>")
@admin_required
def delete_contract(cid):
    contract = Contract.query.get_or_404(cid)

    # Signatures and the signed scan are evidence. Deleting them takes an
    # explicit second confirmation from the client (`force`).
    if (contract.signatures or contract.signed_scan_path) and not get_json_safe().get("force"):
        return jsonify(
            error=f"Договор № {contract.number} подписан или содержит скан — удаление уничтожит "
                  "электронные подписи и файлы. Это необратимо.",
            code="has_signatures",
            signatures_count=len(contract.signatures or []),
        ), 409

    archive_base = Path(current_app.config["ARCHIVE_FOLDER"])
    upload_base = Path(current_app.config["UPLOAD_FOLDER"])
    candidate_files = []
    for rel, base in (
        (contract.docx_path, archive_base),
        (contract.pdf_path, archive_base),
        (contract.signed_scan_path, upload_base),
    ):
        if rel:
            candidate_files.append(base / rel)

    db.session.delete(contract)
    db.session.commit()

    for path in candidate_files:
        try:
            if path.is_file():
                path.unlink()
        except OSError as exc:
            current_app.logger.warning("Failed to remove %s: %s", path, exc)

    return jsonify(ok=True)
