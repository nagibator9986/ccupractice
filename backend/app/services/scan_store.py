"""Storing the scan a party uploads after signing the contract on paper.

One party → one PDF. A PDF is kept as is; photos (JPG/PNG, up to ``MAX_IMAGES`` pages) are
combined into a single PDF, so the college reviews — and the verification page hashes — exactly
one file per signature. Everything is validated by CONTENT (magic bytes / actually parsing the
file), never by the name the browser sent.
"""
from __future__ import annotations

import hashlib
import io
from pathlib import Path

from flask import current_app
from PIL import Image, ImageOps, UnidentifiedImageError
from pypdf import PdfReader
from pypdf.errors import PyPdfError

from ..utils.files import safe_filename
from ..utils.time import utc_now

MAX_IMAGES = 10
MAX_FILE_BYTES = 15 * 1024 * 1024
MAX_SIDE_PX = 3200          # a phone photo is 4000+ px; contract text stays readable at this size
MAX_PIXELS = 60_000_000     # refuse decompression bombs


class ScanError(ValueError):
    """The upload cannot be accepted (user-facing text)."""


def _kind(data: bytes) -> str | None:
    if data[:5] == b"%PDF-":
        return "pdf"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    return None


def _image_to_page(data: bytes) -> Image.Image:
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ScanError("Не удалось прочитать изображение. Загрузите фото в формате JPG или PNG.") from exc
    img = ImageOps.exif_transpose(img)           # phone photos carry their rotation in EXIF
    if img.mode in ("RGBA", "LA", "P"):
        bg = Image.new("RGB", img.size, "white")
        bg.paste(img.convert("RGBA"), mask=img.convert("RGBA").split()[-1])
        img = bg
    else:
        img = img.convert("RGB")
    if max(img.size) > MAX_SIDE_PX:
        img.thumbnail((MAX_SIDE_PX, MAX_SIDE_PX))
    return img


def build_scan_pdf(files: list[tuple[str, bytes]]) -> tuple[bytes, str]:
    """``[(original_name, bytes)]`` → ``(pdf_bytes, display_name)``. Raises ``ScanError``."""
    if not files:
        raise ScanError("Файл не выбран.")
    kinds = []
    for name, data in files:
        if not data:
            raise ScanError(f"Файл «{name}» пустой.")
        if len(data) > MAX_FILE_BYTES:
            raise ScanError(f"Файл «{name}» больше {MAX_FILE_BYTES // (1024 * 1024)} МБ.")
        kind = _kind(data)
        if kind is None:
            raise ScanError(f"Файл «{name}» не похож на PDF или изображение. Допустимы PDF, JPG, PNG.")
        kinds.append(kind)

    if "pdf" in kinds:
        if len(files) != 1:
            raise ScanError("Загрузите один PDF-файл либо несколько фотографий страниц (JPG/PNG) — не вместе.")
        name, data = files[0]
        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                raise ScanError("PDF защищён паролем. Загрузите файл без пароля.")
            if len(reader.pages) < 1:
                raise ScanError("В PDF нет страниц.")
        except ScanError:
            raise
        except (PyPdfError, ValueError, OSError, KeyError, AttributeError) as exc:
            raise ScanError("PDF-файл повреждён или не читается.") from exc
        return data, name

    if len(files) > MAX_IMAGES:
        raise ScanError(f"Можно загрузить не больше {MAX_IMAGES} фотографий за раз.")
    pages = [_image_to_page(d) for _, d in files]
    buf = io.BytesIO()
    pages[0].save(buf, format="PDF", save_all=True, append_images=pages[1:], resolution=150.0)
    label = files[0][0] if len(files) == 1 else f"{len(files)} фото страниц"
    return buf.getvalue(), label


def save_party_scan(contract, role: str, files: list[tuple[str, bytes]]) -> tuple[str, str, str]:
    """Validate and store. Returns ``(relative_path, sha256, display_name)``."""
    pdf, display = build_scan_pdf(files)
    stamp = utc_now().strftime("%Y%m%d_%H%M%S")
    rel = Path("party_scans") / f"{safe_filename(contract.number)}_{role}_{stamp}.pdf"
    dest = Path(current_app.config["UPLOAD_FOLDER"]) / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(pdf)
    return str(rel), hashlib.sha256(pdf).hexdigest(), display[:200]


def remove_scan(rel_path: str | None) -> None:
    """Best-effort removal of a replaced / orphaned scan file."""
    if not rel_path:
        return
    path = Path(current_app.config["UPLOAD_FOLDER"]) / rel_path
    try:
        if path.is_file():
            path.unlink()
    except OSError as exc:
        current_app.logger.warning("Could not remove scan %s: %s", path, exc)
