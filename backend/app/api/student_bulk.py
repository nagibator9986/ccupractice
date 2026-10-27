"""Group-oriented bulk operations on the practice-student register.

Mounted under ``/api/students`` next to ``students.py`` (kept apart so the
single-student CRUD and its LMS invariants stay untouched):

    GET  /import/template     blank .xlsx template (dropdowns from the registers)
    POST /import/preview      parse + validate a file, return the plan (no writes)
    POST /import/commit       apply the same plan in one transaction
    GET  /export              students as .xlsx (same columns as the template)
    GET  /groups              per-group overview (students / partner / period / contracts)
    POST /bulk-practice       set partner / period / supervisors for many students
    POST /bulk-delete         delete many students that have no contracts
"""
from __future__ import annotations

import json

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError

from ..extensions import db
from ..models import Contract, ContractStatus, LmsContract, Partner, Specialty, Student
from ..services.student_import import (
    ImportFileError,
    ImportOptions,
    MODE_LABELS,
    apply_plan,
    build_plan,
    build_students_workbook,
    build_template_workbook,
    group_key,
    parse_file,
)
from ..services.xlsx_utils import workbook_response
from ..utils.auth import admin_required
from ..utils.serializers import clean_str, get_json_safe, parse_date, parse_int
from ..utils.time import utc_today

bp = Blueprint("student_bulk", __name__)

_SIGNED_STATUSES = (ContractStatus.SIGNED, ContractStatus.SCAN_UPLOADED, ContractStatus.COMPLETED)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def latest_contracts_by_student(student_ids: list[int] | None = None) -> dict[int, dict]:
    """Newest practice contract per student plus how many they have (1 query)."""
    q = db.session.query(
        Contract.id, Contract.number, Contract.status, Contract.student_id,
        Contract.partner_id, Contract.contract_date,
    )
    if student_ids is not None:
        if not student_ids:
            return {}
        q = q.filter(Contract.student_id.in_(student_ids))
    out: dict[int, dict] = {}
    for cid, number, status, sid, pid, cdate in q.order_by(Contract.id.desc()).all():
        held = out.get(sid)
        if held is None:
            out[sid] = {
                "id": cid, "number": number, "status": status,
                "status_label": ContractStatus.LABELS.get(status, status),
                "partner_id": pid,
                "contract_date": cdate.isoformat() if cdate else None,
                "count": 1,
            }
        else:
            held["count"] += 1
    return out


def group_filter(column, group: str):
    """SQL condition for «students of this group».

    ``__none__`` → students without a group. Otherwise every stored spelling that
    folds to the same key matches («ПО 25-1» / «ПО 25 - 1» / Latin «O»), so a
    group card's count and the list behind its link always agree.
    """
    if group == "__none__":
        return or_(column.is_(None), column == "")
    key = group_key(group)
    variants = [
        name for (name,) in db.session.query(column).filter(column.isnot(None)).distinct()
        if name and group_key(name) == key
    ]
    return column.in_(variants or [group])


def _json_options() -> dict:
    raw = request.form.get("options") or ""
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise ImportFileError("Некорректные настройки загрузки (options)") from exc
    if not isinstance(data, dict):
        raise ImportFileError("Некорректные настройки загрузки (options)")
    return data


def _plan_from_request():
    f = request.files.get("file")
    if f is None or not f.filename:
        raise ImportFileError("Файл не передан")
    data = f.read()
    if not data:
        raise ImportFileError("Файл пустой")
    opts = ImportOptions.from_request(_json_options())
    book = parse_file(data, f.filename, column_overrides=opts.column_overrides)
    return build_plan(book, opts)


# ─────────────────────────────────────────────────────────────────────────────
# Import
# ─────────────────────────────────────────────────────────────────────────────

@bp.get("/import/template")
@jwt_required()
def import_template():
    partners = Partner.query.order_by(Partner.organization_name.asc()).all()
    specialties = Specialty.query.filter_by(is_active=True).order_by(Specialty.sort_order, Specialty.name).all()
    groups = [
        g for (g,) in db.session.query(Student.group_name)
        .filter(Student.group_name.isnot(None)).distinct().order_by(Student.group_name).all()
    ]
    wb = build_template_workbook(partners=partners, specialties=specialties, groups=groups)
    return workbook_response(wb, "Шаблон_загрузки_студентов.xlsx")


@bp.post("/import/preview")
@admin_required
def import_preview():
    try:
        plan = _plan_from_request()
    except ImportFileError as exc:
        return jsonify(error=str(exc)), 400
    payload = plan.to_dict()
    payload["modes"] = [{"value": k, "label": v} for k, v in MODE_LABELS.items()]
    return jsonify(payload)


@bp.post("/import/commit")
@admin_required
def import_commit():
    try:
        plan = _plan_from_request()
    except ImportFileError as exc:
        return jsonify(error=str(exc)), 400

    counts = plan.counts
    # The operator confirmed a specific preview. If the register changed under
    # them (another admin imported, a student was edited) the plan may differ —
    # refuse instead of writing something they did not see.
    exp_new, exp_upd = parse_int(request.form.get("expect_new")), parse_int(request.form.get("expect_update"))
    if (exp_new is not None and exp_new != counts["new"]) or (exp_upd is not None and exp_upd != counts["update"]):
        return jsonify(
            error="Данные в системе изменились после проверки. Загрузите файл заново и повторите проверку.",
            code="plan_changed", summary=plan.summary(),
        ), 409
    if counts["new"] + counts["update"] == 0:
        return jsonify(error="Нечего импортировать: нет новых и изменяемых строк", code="nothing_to_import",
                       summary=plan.summary()), 422

    try:
        result = apply_plan(plan, year=utc_today().year)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(
            error="Конфликт ИИН при сохранении (запись появилась параллельно). Ничего не сохранено — повторите проверку.",
            code="integrity",
        ), 409
    except Exception:  # noqa: BLE001
        db.session.rollback()
        current_app.logger.exception("Student import failed")
        return jsonify(error="Не удалось сохранить студентов. Ничего не изменено."), 500

    return jsonify(
        ok=True,
        created=result["created"],
        updated=result["updated"],
        unchanged=counts["unchanged"],
        skipped=counts["skip"],
        errors=counts["error"],
        groups=result["groups"],
        summary=plan.summary(),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Export
# ─────────────────────────────────────────────────────────────────────────────

@bp.get("/export")
@jwt_required()
def export_students():
    q = (request.args.get("q") or "").strip()
    group = (request.args.get("group") or "").strip()
    partner_id = parse_int(request.args.get("partner_id"))
    query = Student.query
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Student.full_name.ilike(like), Student.iin.ilike(like),
                                    Student.specialty.ilike(like)))
    if group:
        query = query.filter(group_filter(Student.group_name, group))
    if partner_id:
        query = query.filter(Student.partner_id == partner_id)
    students = query.order_by(Student.group_name.asc(), Student.full_name.asc()).all()
    partner_names = {pid: name for pid, name in db.session.query(Partner.id, Partner.organization_name).all()}
    wb = build_students_workbook(
        students,
        contract_info=latest_contracts_by_student([s.id for s in students]),
        partner_names=partner_names,
    )
    name = f"Студенты_{group}.xlsx" if group else "Студенты.xlsx"
    return workbook_response(wb, name.replace(" ", "_"))


# ─────────────────────────────────────────────────────────────────────────────
# Groups overview
# ─────────────────────────────────────────────────────────────────────────────

@bp.get("/groups")
@jwt_required()
def list_groups():
    rows = db.session.query(
        Student.id, Student.group_name, Student.partner_id, Student.practice_start,
        Student.practice_end, Student.is_grant_student, Student.specialty, Student.course,
        Student.iin,
    ).all()
    contracts = latest_contracts_by_student()
    partner_names = {pid: name for pid, name in db.session.query(Partner.id, Partner.organization_name).all()}

    # Spelling variants of one group («ПО 25-1» / «ПО 25 - 1») fold into one card.
    buckets: dict[str, dict] = {}
    for sid, gname, pid, p_start, p_end, grant, specialty, course, iin in rows:
        key = group_key(gname) if gname else ""
        b = buckets.setdefault(key, {
            "name": gname or "", "spellings": {}, "students": 0, "with_partner": 0, "with_period": 0,
            "with_iin": 0, "grant": 0, "specialties": {}, "courses": {}, "partners": {},
            "periods": {}, "contracts_total": 0, "without_contract": 0,
            "by_status": {s: 0 for s in ContractStatus.ALL}, "fully_signed": 0,
        })
        if gname:
            b["spellings"][gname] = b["spellings"].get(gname, 0) + 1
        b["students"] += 1
        b["with_iin"] += 1 if iin else 0
        b["grant"] += 1 if grant else 0
        if pid:
            b["with_partner"] += 1
            b["partners"][pid] = b["partners"].get(pid, 0) + 1
        if p_start and p_end:
            b["with_period"] += 1
            pk = (p_start.isoformat(), p_end.isoformat())
            b["periods"][pk] = b["periods"].get(pk, 0) + 1
        if specialty:
            b["specialties"][specialty] = b["specialties"].get(specialty, 0) + 1
        if course:
            b["courses"][course] = b["courses"].get(course, 0) + 1
        c = contracts.get(sid)
        if c:
            b["contracts_total"] += 1
            b["by_status"][c["status"]] = b["by_status"].get(c["status"], 0) + 1
            if c["status"] in _SIGNED_STATUSES:
                b["fully_signed"] += 1
        else:
            b["without_contract"] += 1

    def _top(d: dict):
        return max(d.items(), key=lambda kv: kv[1])[0] if d else None

    items = []
    for b in buckets.values():
        if b["spellings"]:
            b["name"] = _top(b["spellings"])
        period = _top(b["periods"])
        items.append({
            "name": b["name"],
            "students": b["students"],
            "with_partner": b["with_partner"],
            "with_period": b["with_period"],
            "with_iin": b["with_iin"],
            "grant": b["grant"],
            "specialty": _top(b["specialties"]),
            "course": _top(b["courses"]),
            "partners": [
                {"id": pid, "name": partner_names.get(pid, "—"), "count": n}
                for pid, n in sorted(b["partners"].items(), key=lambda kv: -kv[1])[:3]
            ],
            "practice_start": period[0] if period else None,
            "practice_end": period[1] if period else None,
            "contracts": b["contracts_total"],
            "without_contract": b["without_contract"],
            "by_status": b["by_status"],
            "fully_signed": b["fully_signed"],
        })
    items.sort(key=lambda g: (g["name"] == "", g["name"]))
    return jsonify(items=items, total=len(items))


# ─────────────────────────────────────────────────────────────────────────────
# Bulk practice settings
# ─────────────────────────────────────────────────────────────────────────────

def select_students(data: dict) -> tuple[list[Student], str | None]:
    ids = data.get("student_ids")
    group = clean_str(data.get("group"))
    if isinstance(ids, list) and ids:
        clean_ids = [i for i in (parse_int(x) for x in ids) if i]
        return Student.query.filter(Student.id.in_(clean_ids)).all(), None
    if group is not None or data.get("group") == "":
        query = Student.query
        if group:
            keyed = [s for s in query.all() if group_key(s.group_name or "") == group_key(group)]
            return keyed, None
        return query.filter(or_(Student.group_name.is_(None), Student.group_name == "")).all(), None
    return [], "Выберите студентов или группу"


@bp.post("/bulk-practice")
@admin_required
def bulk_practice():
    """Apply practice settings to many students at once.

    ``fields`` carries only what the operator filled in; empty values are
    ignored (they never clear data). ``only_empty`` fills gaps without touching
    values already set on a card.
    """
    data = get_json_safe()
    students, err = select_students(data)
    if err:
        return jsonify(error=err), 400
    if not students:
        return jsonify(error="Студенты не найдены"), 404

    raw = data.get("fields") or {}
    only_empty = bool(data.get("only_empty"))
    updates: dict[str, object] = {}

    if raw.get("partner_id") not in (None, ""):
        pid = parse_int(raw.get("partner_id"))
        if not pid or not db.session.get(Partner, pid):
            return jsonify(error="Партнёр не найден"), 404
        updates["partner_id"] = pid
    for key in ("practice_start", "practice_end"):
        if raw.get(key) not in (None, ""):
            d = parse_date(raw.get(key))
            if d is None:
                return jsonify(error="Некорректная дата практики (нужен формат ГГГГ-ММ-ДД)"), 400
            updates[key] = d
    for key, limit in (("college_supervisor", 200), ("partner_supervisor", 200), ("practice_type", 120)):
        v = clean_str(raw.get(key), max_len=limit)
        if v:
            updates[key] = v
    if not updates:
        return jsonify(error="Заполните хотя бы одно поле для назначения"), 400
    if updates.get("practice_start") and updates.get("practice_end") and updates["practice_end"] < updates["practice_start"]:
        return jsonify(error="Окончание практики не может быть раньше начала"), 400

    changed, skipped = 0, []
    for s in students:
        if only_empty:
            payload = {k: v for k, v in updates.items() if getattr(s, k) in (None, "")}
        else:
            payload = dict(updates)
        eff_start = payload.get("practice_start", s.practice_start)
        eff_end = payload.get("practice_end", s.practice_end)
        if eff_start and eff_end and eff_end < eff_start:
            skipped.append({"id": s.id, "full_name": s.full_name,
                            "reason": "окончание практики раньше начала с учётом уже заданной даты"})
            continue
        if not payload:
            continue
        for k, v in payload.items():
            setattr(s, k, v)
        changed += 1
    db.session.commit()

    warnings = []
    pid = updates.get("partner_id")
    if pid:
        partner = db.session.get(Partner, pid)
        assigned = Student.query.filter_by(partner_id=pid).count()
        if partner and partner.seats_count and assigned > partner.seats_count:
            warnings.append({
                "code": "partner_overbooked",
                "message": f"У «{partner.organization_name}» {partner.seats_count} мест, "
                           f"а закреплено студентов: {assigned}",
                "partner_id": pid, "seats": partner.seats_count, "assigned": assigned,
            })
    return jsonify(ok=True, updated=changed, selected=len(students), skipped=skipped, warnings=warnings)


# ─────────────────────────────────────────────────────────────────────────────
# Bulk delete (clean-up after a wrong import)
# ─────────────────────────────────────────────────────────────────────────────

@bp.post("/bulk-delete")
@admin_required
def bulk_delete():
    data = get_json_safe()
    ids = [i for i in (parse_int(x) for x in (data.get("student_ids") or [])) if i]
    if not ids:
        return jsonify(error="Не выбраны студенты"), 400
    with_contract = {sid for (sid,) in db.session.query(Contract.student_id).filter(Contract.student_id.in_(ids)).distinct()}
    with_lms = {sid for (sid,) in db.session.query(LmsContract.student_id).filter(LmsContract.student_id.in_(ids)).distinct()}
    blocked, deleted = [], 0
    for s in Student.query.filter(Student.id.in_(ids)).all():
        if s.id in with_contract:
            blocked.append({"id": s.id, "full_name": s.full_name, "reason": "есть договор практики"})
        elif s.id in with_lms:
            blocked.append({"id": s.id, "full_name": s.full_name, "reason": "есть LMS-договор"})
        else:
            db.session.delete(s)
            deleted += 1
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(error="Не удалось удалить: у некоторых студентов появились связанные договоры"), 409
    return jsonify(ok=True, deleted=deleted, blocked=blocked)
