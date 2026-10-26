"""Download file names: "Title [id].ext", Unicode-safe, plus RFC 6266/5987 Content-Disposition."""

from __future__ import annotations

import re
import unicodedata
from urllib.parse import quote

MAX_TITLE_CHARS = 120
MAX_NAME_BYTES = 240  # most filesystems cap a name at 255 bytes

# Path separators, characters forbidden on Windows/macOS/iOS share targets, and quotes.
_FORBIDDEN_RE = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]')
_SPACES_RE = re.compile(r"\s+")
_SAFE_ID_RE = re.compile(r"[^A-Za-z0-9_-]")


def _strip_invisible(text: str) -> str:
    # Drop control/format characters (bidi overrides, zero-width joiners stay out of names).
    return "".join(ch for ch in text if unicodedata.category(ch) not in {"Cc", "Cf", "Cs", "Co", "Cn"})


def sanitize_title(title: str | None, fallback: str = "media") -> str:
    text = unicodedata.normalize("NFC", title or "")
    text = _SPACES_RE.sub(" ", text)  # tabs/newlines become spaces before control chars are dropped
    text = _strip_invisible(text)
    text = _FORBIDDEN_RE.sub(" ", text)
    text = _SPACES_RE.sub(" ", text).strip(" .-_")
    if len(text) > MAX_TITLE_CHARS:
        text = text[:MAX_TITLE_CHARS].rstrip(" .-_")
    return text or fallback


def safe_id(media_id: str | None) -> str:
    return _SAFE_ID_RE.sub("", media_id or "")[:64]


def build_download_name(title: str | None, media_id: str | None, ext: str, label: str = "") -> str:
    """Return 'Title [id].ext', trimmed so the UTF-8 encoding stays under MAX_NAME_BYTES.

    label: what a derived file adds after the title, e.g. "(montage 6s-11s)". It is always kept whole: when
    'Title (label)' is over MAX_TITLE_CHARS characters or the byte budget, only the title is shortened (ending
    with "…")."""
    ext = _SAFE_ID_RE.sub("", ext or "bin")[:8] or "bin"
    clean_id = safe_id(media_id)
    suffix = (f" [{clean_id}]" if clean_id else "") + f".{ext}"
    budget = MAX_NAME_BYTES - len(suffix.encode())
    tail = sanitize_title(label, fallback="")
    if tail:
        stem = sanitize_title(f"{title or 'media'} {tail}")
        if stem.endswith(tail) and len(stem.encode()) <= budget:
            return stem + suffix
        head = sanitize_title(title)[:max(0, MAX_TITLE_CHARS - len(tail) - 2)]  # room for " " and "…"
        while head and len(f"{head}… {tail}".encode()) > budget:
            head = head[:-1]
        head = head.rstrip(" .,-_([…")
        if head:
            return f"{head}… {tail}{suffix}"
        title = stem  # a label longer than any room for a title (never an export's): trimmed like a title below
    stem = sanitize_title(title)
    while len(stem.encode()) > budget and stem:
        stem = stem[:-1]
    stem = stem.rstrip(" .-_") or "media"
    return stem + suffix


def ascii_fallback(name: str) -> str:
    decomposed = unicodedata.normalize("NFKD", name)
    ascii_name = decomposed.encode("ascii", "ignore").decode("ascii")
    ascii_name = re.sub(r"[^A-Za-z0-9 ._()\[\]-]", "_", ascii_name)
    ascii_name = re.sub(r"_+", "_", ascii_name)
    ascii_name = _SPACES_RE.sub(" ", ascii_name).strip(" _")
    if not ascii_name or ascii_name.startswith("."):
        ascii_name = "media" + ascii_name
    elif ascii_name.startswith("["):  # title was entirely non-Latin: keep "media [id].ext"
        ascii_name = "media " + ascii_name
    return ascii_name


def content_disposition(name: str, disposition: str = "attachment") -> str:
    """attachment; filename="ascii fallback"; filename*=UTF-8''percent-encoded (RFC 6266)."""
    fallback = ascii_fallback(name)
    return f"{disposition}; filename=\"{fallback}\"; filename*=UTF-8''{quote(name, safe='')}"
