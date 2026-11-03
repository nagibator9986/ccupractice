"""Signing on paper: the party prints the contract, signs it by hand and uploads a scan.

For people who cannot sign electronically (typically a student or parent living abroad). The
college decides per link («Способ подписания: скан»); the student card carries the default.

Signer (token = their signing link):
    POST /api/signing/public/<token>/scan            upload PDF or photos of the pages
    GET  /api/signing/public/<token>/scan/file       look at what they uploaded

College (admin):
    GET  /api/signing/requests/<id>/scan             the uploaded file (``?inline=1`` to preview)
    POST /api/signing/requests/<id>/scan/review      {decision: accept|reject, note}
    POST /api/signing/requests/<id>/scan/upload      upload on the party's behalf (e.g. sent via WhatsApp)
    POST /api/signing/requests/<id>/method           switch a link between ecp and scan

A scan is NOT a verified signature, so it never counts until the college has looked at it and
pressed «Принять». Only then a ``Signature`` (channel ``scan``) is written and the contract can
move to «Подписан». A rejected scan keeps the link alive with the reason shown to the signer.
"""
from __future__ import annotations

from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from flask_jwt_extended import jwt_required

from ..extensions import db
from ..models import SigningRequest
from ..services.scan_store import MAX_FILE_BYTES, ScanError, remove_scan, save_party_scan
from ..utils.auth import admin_required
from ..utils.serializers import clean_str, get_json_safe
from ..utils.time import utc_now
from .signing import SIGN_METHODS, SignConflict, _public_base, _request_payload, record_scan_signature

bp = Blueprint("party_scan", __name__)


def _uploaded_files() -> list[tuple[str, bytes]]:
    out = []
    for f in request.files.getlist("files") + request.files.getlist("file"):
        if not f or not f.filename:
            continue
        data = f.read(MAX_FILE_BYTES + 1)     # never buffer more than one file's limit per part
        out.append((f.filename, data))
    return out


def _store(sr: SigningRequest, files: list[tuple[str, bytes]]) -> None:
    """Save the upload on the request (replacing an earlier one) and queue it for review."""
    rel, sha, name = save_party_scan(sr.contract, sr.signer_role, files)
    previous = sr.scan_path
    sr.scan_path, sr.scan_sha256, sr.scan_name = rel, sha, name
    sr.scan_uploaded_at = utc_now()
    sr.scan_review, sr.scan_review_note, sr.scan_reviewed_at = "pending", None, None
    if sr.status == "pending":
        sr.status = "viewed"
        sr.viewed_at = utc_now()
    db.session.commit()
    if previous and previous != rel:
        remove_scan(previous)


def _serve(sr: SigningRequest, inline: bool):
    if not sr.scan_path or not (Path(current_app.config["UPLOAD_FOLDER"]) / sr.scan_path).is_file():
        return jsonify(error="Скан не загружен"), 404
    return send_from_directory(
        current_app.config["UPLOAD_FOLDER"], sr.scan_path,
        as_attachment=not inline, mimetype="application/pdf",
        download_name=f"scan_{sr.contract.number}_{sr.signer_role}.pdf",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Signer
# ─────────────────────────────────────────────────────────────────────────────

def _live_scan_request(token: str):
    sr = SigningRequest.query.filter_by(token=token).first()
    if not sr:
        return None, (jsonify(error="Ссылка недействительна"), 404)
    if sr.is_expired:
        return None, (jsonify(error="Срок ссылки истёк", code="expired"), 410)
    if sr.status == "revoked":
        return None, (jsonify(error="Ссылка отозвана", code="revoked"), 410)
    if sr.status == "signed":
        return None, (jsonify(error="Эта сторона уже подписала договор", code="signed"), 409)
    return sr, None


@bp.post("/signing/public/<string:token>/scan")
def public_upload(token: str):
    sr, err = _live_scan_request(token)
    if err:
        return err
    if (sr.method or "ecp") != "scan":
        return jsonify(
            error="Для этой ссылки подписание на бумаге не предусмотрено. Подпишите электронной подписью "
                  "или попросите колледж выдать ссылку для скана.",
            code="not_scan",
        ), 409
    if not sr.contract.docx_path:
        return jsonify(error="Договор ещё не сформирован. Обратитесь в колледж.", code="no_document"), 409
    files = _uploaded_files()
    try:
        _store(sr, files)
    except ScanError as exc:
        db.session.rollback()
        return jsonify(error=str(exc), code="bad_scan"), 400
    return jsonify(ok=True, scan=_request_payload(sr, _public_base())["scan"])


@bp.get("/signing/public/<string:token>/scan/file")
def public_file(token: str):
    sr = SigningRequest.query.filter_by(token=token).first()
    if not sr or sr.status == "revoked":
        return jsonify(error="Ссылка недействительна"), 404
    return _serve(sr, inline=True)


# ─────────────────────────────────────────────────────────────────────────────
# College
# ─────────────────────────────────────────────────────────────────────────────

@bp.get("/signing/requests/<int:rid>/scan")
@jwt_required()
def admin_file(rid: int):
    sr = SigningRequest.query.get_or_404(rid)
    return _serve(sr, inline=(request.args.get("inline") or "").lower() in ("1", "true", "yes"))


@bp.post("/signing/requests/<int:rid>/scan/review")
@admin_required
def review(rid: int):
    sr = SigningRequest.query.get_or_404(rid)
    data = get_json_safe()
    decision = (data.get("decision") or "").strip()
    note = clean_str(data.get("note"), max_len=500)
    if sr.status == "signed":
        return jsonify(error="Эта сторона уже подписала договор", code="signed"), 409
    if sr.scan_review != "pending" or not sr.scan_path:
        return jsonify(error="Нет скана, ожидающего проверки", code="nothing_to_review"), 409

    if decision == "reject":
        if not note or len(note) < 3:
            return jsonify(error="Укажите причину отказа — её увидит подписант", code="note_required"), 400
        sr.scan_review, sr.scan_review_note, sr.scan_reviewed_at = "rejected", note, utc_now()
        db.session.commit()
    elif decision == "accept":
        sr.scan_review, sr.scan_review_note, sr.scan_reviewed_at = "accepted", note, utc_now()
        try:
            record_scan_signature(sr, sr.contract)
        except SignConflict:
            db.session.rollback()
            return jsonify(error="Эта роль уже подписана другим способом", code="signed"), 409
    else:
        return jsonify(error="decision должен быть accept или reject"), 400
    return jsonify(ok=True, item=_request_payload(sr, _public_base()), contract_status=sr.contract.status)


@bp.post("/signing/requests/<int:rid>/scan/upload")
@admin_required
def admin_upload(rid: int):
    """The party sent the signed paper through another channel — the college attaches it.
    ``accept`` (default on) also records it as the party's signature right away: the person
    uploading is the one who has just looked at the scan."""
    sr = SigningRequest.query.get_or_404(rid)
    if sr.status in ("signed", "revoked"):
        return jsonify(error="Ссылка уже использована или отозвана", code="closed"), 409
    if not sr.contract.docx_path:
        return jsonify(error="Договор ещё не сформирован", code="no_document"), 409
    try:
        _store(sr, _uploaded_files())
    except ScanError as exc:
        db.session.rollback()
        return jsonify(error=str(exc), code="bad_scan"), 400
    if (sr.method or "ecp") != "scan":
        sr.method = "scan"
        db.session.commit()
    if (request.form.get("accept") or "1").lower() in ("1", "true", "yes"):
        sr.scan_review, sr.scan_reviewed_at = "accepted", utc_now()
        sr.scan_review_note = "Загружено сотрудником колледжа"
        try:
            record_scan_signature(sr, sr.contract)
        except SignConflict:
            db.session.rollback()
            return jsonify(error="Эта роль уже подписана другим способом", code="signed"), 409
    return jsonify(ok=True, item=_request_payload(sr, _public_base()), contract_status=sr.contract.status)


@bp.post("/signing/requests/<int:rid>/method")
@admin_required
def set_method(rid: int):
    sr = SigningRequest.query.get_or_404(rid)
    method = (get_json_safe().get("method") or "").strip()
    if method not in SIGN_METHODS:
        return jsonify(error="method должен быть ecp или scan"), 400
    if sr.status in ("signed", "revoked"):
        return jsonify(error="Ссылка уже использована или отозвана", code="closed"), 409
    if sr.scan_review == "pending":
        return jsonify(error="Сначала примите или отклоните загруженный скан", code="scan_pending"), 409
    sr.method = method
    db.session.commit()
    return jsonify(ok=True, item=_request_payload(sr, _public_base()))
