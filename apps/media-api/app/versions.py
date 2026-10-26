"""Tool versions exposed by /health (computed once at startup)."""

from __future__ import annotations

import re
import shutil
import subprocess
from importlib import metadata


def _first_line(cmd: list[str], pattern: str) -> str | None:
    if shutil.which(cmd[0]) is None:
        return None
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=10, check=False).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    match = re.search(pattern, out)
    return match.group(1) if match else None


def _dist_version(name: str) -> str | None:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def _impersonate_targets() -> int | None:
    """Number of curl_cffi impersonation targets (TikTok needs at least one). Private yt-dlp API."""
    try:
        import yt_dlp

        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
            return len(ydl._get_available_impersonate_targets())
    except Exception:  # noqa: BLE001 - diagnostics only
        return None


def collect_versions() -> dict[str, str | int | None]:
    try:
        from yt_dlp.version import __version__ as ytdlp_version
    except ImportError:  # pragma: no cover
        ytdlp_version = None
    return {
        "yt_dlp": ytdlp_version,
        "yt_dlp_ejs": _dist_version("yt-dlp-ejs"),
        "ffmpeg": _first_line(["ffmpeg", "-hide_banner", "-version"], r"ffmpeg version (\S+)"),
        "deno": _first_line(["deno", "--version"], r"deno (\S+)"),
        "curl_cffi": _dist_version("curl_cffi") or _dist_version("curl-cffi"),
        "impersonate_targets": _impersonate_targets(),
    }
