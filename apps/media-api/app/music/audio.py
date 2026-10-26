"""Checks and tags of an imported audio file: magic bytes, ffprobe (real duration and quality), ffmpeg tags.

ffprobe/ffmpeg (already in the image) instead of a tagging library: no new dependency. The file is untrusted:
`-protocol_whitelist file` + `-format_whitelist` (audio demuxers only, like app/studio.py), server-chosen paths, and
every metadata value goes as ONE argument (never through a shell). Tagging copies the streams (`-c copy`): the audio
is never re-encoded; when the container refuses the tags, the untouched file is kept (`etiquetage: impossible`)."""

from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path
from typing import Any

from ..errors import ApiError
from .model import AUDIO_TYPES

log = logging.getLogger("ytapi.music")

DEMUXERS = ",".join(sorted({d for _, demux in AUDIO_TYPES.values() for d in demux.split(",")} | {"aac"}))
MUXERS = {"mp3": ["-f", "mp3", "-id3v2_version", "3"], "ogg": ["-f", "ogg"], "opus": ["-f", "ogg"],
          "flac": ["-f", "flac"], "wav": ["-f", "wav"], "m4a": ["-f", "ipod"]}
GUARD = ["-protocol_whitelist", "file", "-format_whitelist", DEMUXERS]


def sniff(head: bytes) -> str | None:
    """Audio format from the first bytes (None: not a supported audio file)."""
    if head.startswith(b"ID3"):
        return "mp3"
    if len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0 and ((head[1] >> 1) & 3) != 0:
        return "mp3"
    if head.startswith(b"OggS"):
        return "opus" if b"OpusHead" in head[:64] else "ogg"
    if head.startswith(b"fLaC"):
        return "flac"
    if head.startswith(b"RIFF") and head[8:12] == b"WAVE":
        return "wav"
    if head[4:8] == b"ftyp" and head[8:12] in (b"M4A ", b"M4B ", b"mp42", b"isom", b"mp41", b"iso2", b"dash"):
        return "m4a"
    return None


def same_family(declared: str, sniffed: str) -> bool:
    groups = ({"ogg", "opus"},)
    return declared == sniffed or any(declared in g and sniffed in g for g in groups)


def probe(path: Path, max_duration_s: int, timeout: float = 60.0) -> dict[str, Any]:
    """Real properties of the file; 415 when it is not one audio track, 413 when too long."""
    cmd = ["ffprobe", "-v", "error", *GUARD, "-print_format", "json", "-show_format", "-show_streams", "--", str(path)]
    try:
        out = subprocess.run(cmd, capture_output=True, encoding="utf-8", errors="replace", timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise ApiError(422, "fichier_invalide", "Le fichier n'a pas pu être lu à temps.") from None
    if out.returncode != 0:
        log.warning("music: ffprobe refused a file", extra={"returncode": out.returncode, "stderr": out.stderr[-300:]})
        raise ApiError(422, "fichier_invalide", "Fichier audio illisible ou corrompu.")
    try:
        meta = json.loads(out.stdout or "{}")
    except ValueError:
        raise ApiError(422, "fichier_invalide", "Fichier audio illisible.") from None
    streams = meta.get("streams") or []
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    video = [s for s in streams if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")]
    if not audio or video:
        raise ApiError(415, "type_refuse", "Ce fichier n'est pas un fichier audio (piste audio absente ou vidéo).")
    fmt = meta.get("format") or {}
    try:
        duration = float(fmt.get("duration") or audio[0].get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0.0
    if duration <= 0:
        raise ApiError(422, "fichier_invalide", "Durée du fichier illisible.")
    if duration > max_duration_s:
        raise ApiError(413, "duree_trop_longue", f"Fichier trop long ({int(duration // 60)} min ; "
                                                 f"{max_duration_s // 60} min au plus).")
    a = audio[0]

    def num(v: Any) -> int | None:
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return None

    bitrate = num(a.get("bit_rate")) or num(fmt.get("bit_rate"))
    return {"dureeS": round(duration, 2), "codec": str(a.get("codec_name") or "")[:20] or None,
            "debitKbps": round(bitrate / 1000) if bitrate else None, "frequenceHz": num(a.get("sample_rate")),
            "canaux": num(a.get("channels")), "bitsParEchantillon": num(a.get("bits_per_raw_sample")) or None,
            "conteneur": str(fmt.get("format_name") or "")[:40] or None,
            "sansPerte": str(a.get("codec_name") or "") in ("flac", "alac") or str(a.get("codec_name") or "").startswith("pcm_")}


def _clean(value: str | None, limit: int = 500) -> str | None:
    if not value:
        return None
    out = "".join(c for c in value if c.isprintable())[:limit].strip()
    return out or None


def tag(src: Path, dst: Path, ext: str, tags: dict[str, str | None], timeout: float = 300.0) -> bool:
    """Copy `src` to `dst` with the tags (streams copied, never re-encoded). False when the container refused."""
    meta: list[str] = []
    for key, value in tags.items():
        clean = _clean(value)
        if clean:
            meta += ["-metadata", f"{key}={clean}"]
    for maps in (["-map", "0"], ["-map", "0:a"]):
        cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-v", "error", "-y", *GUARD, "-i", str(src), *maps, "-c", "copy",
               "-map_metadata", "0", *meta, *MUXERS[ext], str(dst)]
        try:
            out = subprocess.run(cmd, capture_output=True, encoding="utf-8", errors="replace", timeout=timeout,
                                 check=False)
        except subprocess.TimeoutExpired:
            out = None
        if out is not None and out.returncode == 0 and dst.exists() and dst.stat().st_size > 0:
            return True
        dst.unlink(missing_ok=True)
        if out is not None:
            log.info("music: tagging refused", extra={"ext": ext, "stderr": out.stderr[-300:]})
    return False
