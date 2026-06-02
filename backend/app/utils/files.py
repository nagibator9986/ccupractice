import re
import unicodedata
from pathlib import Path


_SAFE_RE = re.compile(r"[^\w\-\. ]+", re.UNICODE)


def safe_filename(name: str, fallback: str = "file") -> str:
    """Produce a filesystem-friendly filename keeping Cyrillic letters."""
    if not name:
        return fallback
    name = unicodedata.normalize("NFC", name)
    name = name.replace("/", "_").replace("\\", "_")
    name = _SAFE_RE.sub("", name).strip().replace(" ", "_")
    return name or fallback


def ensure_dir(path: str | Path) -> Path:
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p
