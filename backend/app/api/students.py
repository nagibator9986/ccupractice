from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from ..extensions import db
from ..models import Student, Partner, Contract
from ..utils.auth import admin_required
from ..utils.serializers import (
    clean_str,
    get_json_safe,
    parse_date,
    parse_int,
    parse_positive_int,
)

bp = Blueprint("students", __name__)

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

    items = query.order_by(Student.full_name.asc()).all()
    return jsonify(items=[s.to_dict() for s in items], total=len(items))


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
    contracts_count = Contract.query.filter_by(student_id=sid).count()
    if contracts_count:
        return jsonify(
            error=f"Нельзя удалить студента — связаны {contracts_count} договор(ов)."
        ), 409
    db.session.delete(student)
    try:
        db.session.commit()
    except IntegrityError:
        # A contract referencing this student was inserted between the check and
        # the delete (the NOT NULL FK then rejects the delete). Report cleanly.
        db.session.rollback()
        return jsonify(error="Нельзя удалить студента — есть связанные договоры."), 409
    return jsonify(ok=True)


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
