from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import case, or_
from sqlalchemy.exc import IntegrityError
from ..extensions import db
from ..models import Student, Partner, Contract, LmsContract, LmsStatus
from ..utils.auth import admin_required
from ..utils.serializers import (
    clean_str,
    get_json_safe,
    parse_date,
    parse_int,
    parse_positive_int,
)

bp = Blueprint("students", __name__)


def _plural(n: int, one: str, few: str, many: str) -> str:
    """Russian numeric agreement: 1 договор / 2 договора / 5 договоров."""
    r100, r10 = n % 100, n % 10
    if r10 == 1 and r100 != 11:
        return one
    if 2 <= r10 <= 4 and not 12 <= r100 <= 14:
        return few
    return many


def _lms_label(lms) -> str:
    """How an LMS contract is named in user-facing text.

    One shared fallback for a contract with no number yet: the registry renders
    such rows as `LMS-<id>`, so the message must not print a bare `№ <id>` that
    the admin would then fail to find.
    """
    return f"№ {lms.number}" if lms.number else f"(без номера, LMS-{lms.id})"

_TEXT_FIELDS = {
    "full_name": 200,
    "iin": 20,
    "group_name": 60,
    "specialty": 200,
    "college_supervisor": 200,
    "partner_supervisor": 200,
    "id_card_number": 60,
    "id_card_issued_by": 200,
    "home_address": 300,
    "phone": 60,
    "legal_rep_full_name": 200,
    "legal_rep_iin": 20,
    "legal_rep_phone": 60,
    "education_program": 300,
    "specialty_code": 60,
    "practice_type": 120,
    "form_of_study": 60,
}


@bp.get("")
@jwt_required()
def list_students():
    q = (request.args.get("q") or "").strip()
    group = (request.args.get("group") or "").strip()
    partner_id = parse_int(request.args.get("partner_id"))
    query = Student.query
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                Student.full_name.ilike(like),
                Student.iin.ilike(like),
                Student.specialty.ilike(like),
            )
        )
    if group:
        query = query.filter(Student.group_name == group)
    if partner_id:
        query = query.filter(Student.partner_id == partner_id)

    is_grant_param = (request.args.get("is_grant") or "").strip().lower()
    if is_grant_param in ("1", "true", "yes"):
        query = query.filter(Student.is_grant_student.is_(True))
    elif is_grant_param in ("0", "false", "no"):
        query = query.filter(Student.is_grant_student.is_(False))

    items = query.order_by(Student.full_name.asc()).all()
    payload = [s.to_dict() for s in items]
    # Opt-in: `?with_lms=1` attaches a compact LMS-contract summary so the
    # students table can explain why a student is hidden from the LMS
    # create-picker and why the card refuses to delete. Opt-in (not always on)
    # so every existing consumer of this endpoint keeps its exact payload.
    if (request.args.get("with_lms") or "").strip().lower() in ("1", "true", "yes"):
        _attach_lms_summary(payload)
    return jsonify(items=payload, total=len(payload))


def _attach_lms_summary(payload: list[dict]) -> None:
    """Add `lms_contract` (or None) to each serialized student, in one query.

    Deliberately uses `with_entities` instead of full ORM objects:
    `LmsContract.to_dict()` counts signatures through a lazy relationship, so
    serializing N contracts would fire N extra queries. Never touches
    `Student.to_dict()` — the shared serializer stays unchanged.
    """
    ids = [item["id"] for item in payload]
    if not ids:
        return
    rows = (
        db.session.query(
            LmsContract.id,
            LmsContract.number,
            LmsContract.status,
            LmsContract.student_id,
        )
        .filter(LmsContract.student_id.in_(ids))
        .order_by(LmsContract.created_at.desc())
        .all()
    )
    by_student: dict[int, dict] = {}
    for lid, number, status, student_id in rows:
        is_active = status != LmsStatus.COMPLETED
        held = by_student.get(student_id)
        # Newest wins, but an unfinished contract always outranks a completed
        # one — it is the one that pins the grant flag and hides the student
        # from the picker. Mirrors what `delete_student` reports.
        if held is None or (not held["is_active"] and is_active):
            by_student[student_id] = {
                "id": lid,
                "number": number,
                "status": status,
                "status_label": LmsStatus.LABELS.get(status, status),
                "is_active": is_active,
            }
    for item in payload:
        item["lms_contract"] = by_student.get(item["id"])


@bp.get("/<int:sid>")
@jwt_required()
def get_student(sid):
    return jsonify(item=Student.query.get_or_404(sid).to_dict())


@bp.post("")
@admin_required
def create_student():
    data = get_json_safe()
    full_name = clean_str(data.get("full_name"), max_len=_TEXT_FIELDS["full_name"])
    if not full_name:
        return jsonify(error="Укажите ФИО студента"), 400

    iin = clean_str(data.get("iin"), max_len=_TEXT_FIELDS["iin"])
    if iin and not iin.isdigit():
        return jsonify(error="ИИН должен содержать только цифры"), 400
    if iin and len(iin) != 12:
        return jsonify(error="ИИН должен состоять из 12 цифр"), 400
    if iin and Student.query.filter_by(iin=iin).first():
        return jsonify(error=f"Студент с ИИН {iin} уже существует"), 409

    student = Student(full_name=full_name, iin=iin)
    error = _apply(student, data, skip=("full_name", "iin"))
    if error:
        return jsonify(error=error), 400
    db.session.add(student)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(error="Студент с таким ИИН уже существует"), 409
    return jsonify(item=student.to_dict()), 201


@bp.put("/<int:sid>")
@admin_required
def update_student(sid):
    student = Student.query.get_or_404(sid)
    data = get_json_safe()

    # The grant flag carries the same invariant as PUT /students/<id>/grant: it
    # must not be cleared while a non-completed LmsContract references this
    # student. Checked FIRST, before any attribute is assigned, so a refusal
    # leaves the row untouched without needing a rollback. A payload that
    # repeats the current value — what the edit form sends — never gets here.
    if "is_grant_student" in data:
        blocked = _grant_removal_blocked(
            sid,
            currently_grant=student.is_grant_student,
            new_flag=coerce_grant_flag(data.get("is_grant_student")),
        )
        if blocked is not None:
            return blocked

    if "full_name" in data:
        full_name = clean_str(data.get("full_name"), max_len=_TEXT_FIELDS["full_name"])
        if not full_name:
            return jsonify(error="ФИО студента не может быть пустым"), 400
        student.full_name = full_name
    if "iin" in data:
        iin = clean_str(data.get("iin"), max_len=_TEXT_FIELDS["iin"])
        if iin and not iin.isdigit():
            return jsonify(error="ИИН должен содержать только цифры"), 400
        if iin and len(iin) != 12:
            return jsonify(error="ИИН должен состоять из 12 цифр"), 400
        if iin and Student.query.filter_by(iin=iin).filter(Student.id != sid).first():
            return jsonify(error=f"Студент с ИИН {iin} уже существует"), 409
        student.iin = iin
    error = _apply(student, data, skip=("full_name", "iin"))
    if error:
        return jsonify(error=error), 400
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(error="Студент с таким ИИН уже существует"), 409
    return jsonify(item=student.to_dict())


@bp.delete("/<int:sid>")
@admin_required
def delete_student(sid):
    student = Student.query.get_or_404(sid)
    # Practice contracts block the delete too. This branch used to report a
    # bare count — the same dead end the LMS branch below was fixed for — so it
    # now names the contract and returns its id for a deep link.
    blocking_contract = (
        Contract.query
        .filter_by(student_id=sid)
        .order_by(Contract.contract_date.desc().nullslast(), Contract.id.desc())
        .first()
    )
    if blocking_contract is not None:
        contracts_count = Contract.query.filter_by(student_id=sid).count()
        label = (
            f"№ {blocking_contract.number}" if blocking_contract.number
            else f"(без номера, id={blocking_contract.id})"
        )
        more = (
            f" (и ещё {contracts_count - 1} "
            f"{_plural(contracts_count - 1, 'договор', 'договора', 'договоров')})"
            if contracts_count > 1 else ""
        )
        return jsonify(
            error=f"Нельзя удалить студента — с ним связан договор практики {label}{more}. "
                  "Сначала удалите договор, затем повторите.",
            code="contract_exists",
            contract_id=blocking_contract.id,
            contract_number=blocking_contract.number,
            contracts_count=contracts_count,
        ), 409

    # `lms_contracts.student_id` is NOT NULL + ``ondelete="RESTRICT"`` and the
    # relationship intentionally does not cascade, so an LmsContract makes the
    # delete impossible. Refuse BEFORE touching the session and name the
    # blocking contract — otherwise the admin only sees "есть связанные
    # договоры" with nothing to act on (the LMS row is invisible from the
    # student card, and the student is also hidden from the LMS create-picker
    # while the contract is open, which reads as "the student disappeared").
    # `first()` BEFORE `count()`: the reverse order can see count>0 and then
    # first()==None if a concurrent request removes the contract in between,
    # which would blow up on `blocking.number` with a 500 instead of a 409.
    # Ordering mirrors `_attach_lms_summary` so the table badge and this error
    # always name the SAME contract.
    blocking = (
        LmsContract.query
        .filter_by(student_id=sid)
        .order_by(
            case((LmsContract.status != LmsStatus.COMPLETED, 0), else_=1),
            LmsContract.created_at.desc(),
        )
        .first()
    )
    if blocking is not None:
        lms_count = LmsContract.query.filter_by(student_id=sid).count()
        label = _lms_label(blocking)
        more = (
            f" (и ещё {lms_count - 1} {_plural(lms_count - 1, 'договор', 'договора', 'договоров')})"
            if lms_count > 1 else ""
        )
        # A signed / completed contract carries ЭЦП signatures and archived
        # files — never advise deleting one. Only an unsigned draft is safe to
        # remove, and only that branch offers the shortcut.
        destructive = blocking.status in (LmsStatus.SIGNED, LmsStatus.COMPLETED)
        if destructive:
            tail = ("Этот договор подписан — удалять его нельзя, иначе будут "
                    "потеряны электронные подписи и файлы. Карточку студента "
                    "удалить невозможно.")
        else:
            tail = "Откройте договор и удалите его, затем повторите."
        return jsonify(
            error=f"Нельзя удалить студента — с ним связан LMS-договор {label}{more}. {tail}",
            code="lms_contract_exists",
            lms_contract_id=blocking.id,
            lms_contract_number=blocking.number,
            lms_contract_status=blocking.status,
            lms_contract_signed=destructive,
            lms_contracts_count=lms_count,
        ), 409

    db.session.delete(student)
    try:
        db.session.commit()
    except IntegrityError:
        # A contract referencing this student was inserted between the checks
        # above and the delete (the FK then rejects it). Report cleanly.
        db.session.rollback()
        return jsonify(
            error="Нельзя удалить студента — есть связанные договоры.",
            code="related_rows",
        ), 409
    return jsonify(ok=True)


def coerce_grant_flag(value) -> bool:
    """Coerce any truthy form the front-end may send into a bool.

    Shared by `_apply` (POST/PUT /students) and `set_grant_flag`
    (PUT /students/<id>/grant) so the two endpoints can never disagree about
    what "включён" means for the same payload.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        # json.loads accepts the bare literals NaN / Infinity, and int() raises
        # on both — treat anything non-finite as "not set" rather than a 500.
        try:
            return int(value) != 0
        except (ValueError, OverflowError):
            return False
    if value is None:
        return False
    return str(value).strip().lower() in ("1", "true", "yes", "on", "y")


def active_lms_contract(sid: int):
    """The non-completed LmsContract blocking a grant-flag removal, or None.

    `completed` is treated as released — a student whose previous LMS contract
    finished may be moved out of the grant category (and issued a new one).
    """
    if sid is None:
        # `student_id == None` renders as `IS NULL` and would match nothing —
        # returning early keeps the helper honest if it is ever called for an
        # unsaved Student (e.g. from create_student). Only None is special:
        # `not sid` would also swallow a legitimate id of 0.
        return None
    return (
        LmsContract.query
        .filter(LmsContract.student_id == sid)
        .filter(LmsContract.status != LmsStatus.COMPLETED)
        .first()
    )


def _grant_removal_blocked(sid: int, *, currently_grant: bool, new_flag: bool):
    """Return the 409 response tuple when clearing the flag is not allowed."""
    if not (currently_grant and not new_flag):
        return None
    blocking = active_lms_contract(sid)
    if blocking is None:
        return None
    return jsonify(
        error="Нельзя снять отметку «Грантник», пока существует "
        "незавершённый LMS-договор. Завершите договор и повторите.",
        code="lms_contract_active",
        lms_contract_id=blocking.id,
        lms_contract_number=blocking.number,
    ), 409


def _apply(student: Student, data: dict, *, skip=()) -> str | None:
    """Apply fields. Returns an error string when validation fails."""
    for field, max_len in _TEXT_FIELDS.items():
        if field in skip or field not in data:
            continue
        setattr(student, field, clean_str(data.get(field), max_len=max_len))

    # Numeric / date fields
    if "course" in data:
        student.course = parse_positive_int(data["course"], minimum=1, default=None)
    if "enrollment_year" in data:
        student.enrollment_year = parse_positive_int(data["enrollment_year"], minimum=1900, default=None)
    if "practice_start" in data:
        student.practice_start = parse_date(data["practice_start"])
    if "practice_end" in data:
        student.practice_end = parse_date(data["practice_end"])
    if "birth_date" in data:
        student.birth_date = parse_date(data["birth_date"])
    if "notes" in data:
        student.notes = clean_str(data.get("notes"))

    # Grant flag — gates standalone LMS-contract creation. Accept ints/strings
    # so the front-end can send any truthy form ("1", "true", boolean true).
    # CLEARING the flag is guarded in `update_student` (not here) — `_apply` is
    # also used by `create_student`, where no LMS contract can exist yet.
    if "is_grant_student" in data:
        student.is_grant_student = coerce_grant_flag(data.get("is_grant_student"))

    # FK validation: partner_id must reference an existing partner.
    if "partner_id" in data:
        pid = parse_int(data["partner_id"])
        if pid is not None:
            if not Partner.query.get(pid):
                return f"Партнёр с id={pid} не найден"
        student.partner_id = pid

    # Date sanity: practice_end must not be before practice_start.
    if student.practice_start and student.practice_end and student.practice_end < student.practice_start:
        return "Окончание практики не может быть раньше начала"
    return None


@bp.put("/<int:sid>/grant")
@admin_required
def set_grant_flag(sid):
    """Toggle the `is_grant_student` flag (grant / госзаказ).

    Turning the flag OFF is blocked when the student still has a
    non-completed LmsContract — the LMS-contract aggregate enforces a
    grant-only invariant (CHECK constraint + service guard), so flipping the
    Student row without first resolving the active LMS would create an
    inconsistency.
    """
    student = Student.query.get_or_404(sid)
    data = get_json_safe()
    if "is_grant_student" not in data:
        return jsonify(error="Не передано поле is_grant_student"), 400
    new_flag = coerce_grant_flag(data.get("is_grant_student"))

    # Blocked when an active (non-completed) LmsContract still references this
    # student — the grant-only invariant must hold for as long as the LMS row
    # exists.
    blocked = _grant_removal_blocked(
        sid, currently_grant=student.is_grant_student, new_flag=new_flag
    )
    if blocked is not None:
        return blocked

    student.is_grant_student = new_flag
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(error="Не удалось обновить отметку"), 409
    return jsonify(item=student.to_dict())
