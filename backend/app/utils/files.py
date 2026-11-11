import re
import unicodedata
from pathlib import Path


_SAFE_RE = re.compile(r"[^\w\-\. ]+", re.UNICODE)


# One path component may not exceed 255 BYTES on ext4/APFS/overlayfs, and a Cyrillic letter is two.
# A long organisation name plus a long ФИО in one file name overflows that («[Errno 36] File name too long»).
DIR_NAME_MAX_BYTES = 150      # a folder named after the organisation
FILE_PART_MAX_BYTES = 70      # the organisation inside a file name (the ФИО gets ``FILE_PERSON_MAX_BYTES``)
FILE_PERSON_MAX_BYTES = 90


def clip_bytes(text: str, max_bytes: int) -> str:
    """Cut ``text`` to at most ``max_bytes`` of UTF-8 without splitting a character."""
    clipped = text.encode("utf-8")[:max_bytes].decode("utf-8", errors="ignore")
    return clipped.rstrip("_. -")


def safe_filename(name: str, fallback: str = "file", max_bytes: int | None = None) -> str:
    """Produce a filesystem-friendly filename keeping Cyrillic letters.

    ``max_bytes`` caps the result (UTF-8 bytes, not characters) for names assembled from user data.
    """
    if not name:
        return fallback
    name = unicodedata.normalize("NFC", name)
    name = name.replace("/", "_").replace("\\", "_")
    name = _SAFE_RE.sub("", name).strip().replace(" ", "_")
    if max_bytes is not None:
        name = clip_bytes(name, max_bytes)
    return name or fallback


def partner_folder_name(organization_name: str) -> str:
    """Archive folder of one organisation — the same everywhere a contract's files are filed."""
    return safe_filename(organization_name, fallback="partner", max_bytes=DIR_NAME_MAX_BYTES)


def ensure_dir(path: str | Path) -> Path:
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p
