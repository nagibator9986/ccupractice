from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import or_
from ..extensions import db
from ..models import Student
from ..utils.auth import admin_required
from ..utils.serializers import parse_date, parse_int

bp = Blueprint("students", __name__)


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
    data = request.get_json() or {}
    if not data.get("full_name"):
        return jsonify(error="Укажите ФИО студента"), 400
    student = Student()
    _apply(student, data)
    db.session.add(student)
    db.session.commit()
    return jsonify(item=student.to_dict()), 201


@bp.put("/<int:sid>")
@admin_required
def update_student(sid):
    student = Student.query.get_or_404(sid)
    _apply(student, request.get_json() or {})
    db.session.commit()
    return jsonify(item=student.to_dict())


@bp.delete("/<int:sid>")
@admin_required
def delete_student(sid):
    student = Student.query.get_or_404(sid)
    if student.contracts:
        return jsonify(error="Нельзя удалить студента с договорами"), 409
    db.session.delete(student)
    db.session.commit()
    return jsonify(ok=True)


def _apply(student: Student, data: dict) -> None:
    text_fields = (
        "full_name", "iin", "group_name", "specialty",
        "college_supervisor", "partner_supervisor",
        "id_card_number", "id_card_issued_by", "home_address", "phone",
        "legal_rep_full_name", "legal_rep_iin", "legal_rep_phone",
        "education_program", "specialty_code", "practice_type", "form_of_study",
        "notes",
    )
    for f in text_fields:
        if f in data:
            value = data.get(f)
            setattr(student, f, value.strip() if isinstance(value, str) else value)

    if "course" in data:
        student.course = parse_int(data["course"])
    if "partner_id" in data:
        student.partner_id = parse_int(data["partner_id"])
    if "enrollment_year" in data:
        student.enrollment_year = parse_int(data["enrollment_year"])
    if "practice_start" in data:
        student.practice_start = parse_date(data["practice_start"])
    if "practice_end" in data:
        student.practice_end = parse_date(data["practice_end"])
    if "birth_date" in data:
        student.birth_date = parse_date(data["birth_date"])
