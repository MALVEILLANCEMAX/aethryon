"""AETHRYON Tools (TOOLS_ENABLED): imported files, edits, storyboard and waveform — ffmpeg only, never a platform.

Runs in the worker processes (app.runner: own process group, killed as a whole on cancel or timeout), except
`probe_media` / `media_info`, which the parent also uses (ffprobe in a thread, bounded by a timeout).

Imported files are untrusted: every ffprobe/ffmpeg call that reads one gets `-protocol_whitelist file` and
`-format_whitelist` (UPLOAD_FORMATS) — a playlist (HLS, concat…) or an image disguised as a video is refused
before any demuxer could open another file or a network address — and the file always has a server-chosen name.
All values put in ffmpeg arguments are validated numbers (app.params.DeriveParams) or server paths, never text from
the caller (the title only goes in a -metadata value, as one argument).
"""

from __future__ import annotations

import json
import logging
import math
import re
import subprocess
from array import array
from pathlib import Path
from typing import Any

from .errors import ApiError
from .filenames import build_download_name, sanitize_title

log = logging.getLogger("ytapi.studio")

# Demuxers allowed for an imported file (ffmpeg names): MP4/MOV/M4A/3GP, Matroska/WebM, MP3, WAV, Ogg, FLAC, AAC.
UPLOAD_FORMATS = "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,mp3,wav,ogg,flac,aac"
MAX_SIDE = 8192
MAX_PIXELS = 4096 * 2304  # 4K (16:9 DCI included); larger pictures are refused (decoder memory)
EXTRA_MEDIA_TYPES = {"wav": "audio/wav", "ogg": "audio/ogg", "flac": "audio/flac", "aac": "audio/aac",
                     "weba": "audio/webm", "mkv": "video/x-matroska", "webm": "video/webm"}
# What every current browser plays inside <video>/<audio> (HEVC: Safari and some Chrome builds only).
BROWSER_VIDEO = {"h264", "vp8", "vp9", "av1"}
BROWSER_AUDIO = {"aac", "mp3", "opus", "vorbis", "flac", "pcm_s16le", "pcm_s24le", "pcm_f32le"}
CRF_X264 = {"haute": 18, "standard": 21, "legere": 26}
CRF_VP9 = {"haute": 30, "standard": 34, "legere": 40}
SAMPLE_S = 2.0  # length of a compression sample (op echantillon)
DEFAULT_RATE = 48000  # Sped Up / Slowed of a sound whose sample rate is unknown


def guard(upload: bool) -> list[str]:
    """Input options for a file that may come from a user (imported file or something derived from it)."""
    return ["-protocol_whitelist", "file", "-format_whitelist", UPLOAD_FORMATS] if upload else []


def media_types() -> dict[str, str]:
    from .worker import MEDIA_TYPES  # lazy: the parent never imports yt-dlp

    return {**MEDIA_TYPES, **EXTRA_MEDIA_TYPES}


def unsupported(detail: str = "Ce fichier n'est pas une vidéo ou un son pris en charge (MP4, MOV, WebM, MKV, "
                              "MP3, M4A, WAV, OGG, FLAC).") -> ApiError:
    return ApiError(415, "unsupported_file", detail)


def probe_media(path: Path, upload: bool, timeout: float = 60) -> dict[str, Any]:
    cmd = ["ffprobe", "-v", "error", *guard(upload), "-print_format", "json", "-show_format", "-show_streams",
           "--", str(path)]
    try:
        out = subprocess.run(cmd, capture_output=True, encoding="utf-8", errors="replace", timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise unsupported("Le fichier n'a pas pu être lu à temps.") from None
    if out.returncode != 0:
        log.warning("ffprobe refused a file", extra={"returncode": out.returncode, "stderr": out.stderr[-600:]})
        if upload:
            raise unsupported()
        raise ApiError(500, "conversion_failed", "Impossible de lire le média.")
    try:
        return json.loads(out.stdout or "{}")
    except ValueError:
        raise unsupported() from None


def streams_of(meta: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    streams = meta.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"
                  and not (s.get("disposition") or {}).get("attached_pic")), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    return video, audio


def duration_of(meta: dict[str, Any], *streams: dict[str, Any] | None) -> float:
    for value in [(meta.get("format") or {}).get("duration"), *((s or {}).get("duration") for s in streams)]:
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if number > 0 and math.isfinite(number):
            return number
    return 0.0


def rotation_of(video: dict[str, Any]) -> int:
    """Rotation applied at display (display matrix, or the old `rotate` tag), as 0/90/180/270."""
    angle = 0.0
    for side in video.get("side_data_list") or []:
        if isinstance(side, dict) and "rotation" in side:
            try:
                angle = float(side["rotation"])
            except (TypeError, ValueError):
                pass
    tag = (video.get("tags") or {}).get("rotate")
    if not angle and tag:
        try:
            angle = float(tag)
        except ValueError:
            pass
    return int(round(angle / 90.0)) % 4 * 90


def sar_of(video: dict[str, Any]) -> float:
    num, _, den = str(video.get("sample_aspect_ratio") or "1:1").partition(":")
    try:
        value = float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        return 1.0
    return value if 0.2 <= value <= 5 else 1.0


def display_size(video: dict[str, Any]) -> tuple[int, int]:
    """Size of the picture as displayed (square pixels, after the source's rotation): what a browser shows."""
    width, height = int(video.get("width") or 0), int(video.get("height") or 0)
    sar = sar_of(video)
    if abs(sar - 1) > 0.01:
        width = int(round(width * sar / 2)) * 2
    if rotation_of(video) in (90, 270):
        width, height = height, width
    return width, height


def fps_of(video: dict[str, Any]) -> float | None:
    for key in ("avg_frame_rate", "r_frame_rate"):
        num, _, den = str(video.get(key) or "").partition("/")
        try:
            value = float(num) / float(den or 1)
        except (ValueError, ZeroDivisionError):
            continue
        if 0 < value <= 240:
            return round(value, 3)
    return None


def media_info(meta: dict[str, Any], size: int | None = None) -> dict[str, Any]:
    """Summary used by the editor (duration, displayed size, codecs, sound, playability in a browser)."""
    video, audio = streams_of(meta)
    fmt = meta.get("format") or {}
    info: dict[str, Any] = {
        "duration": round(duration_of(meta, video, audio), 3),
        "size_bytes": int(size if size is not None else int(fmt.get("size") or 0)),
        "bit_rate": int(fmt.get("bit_rate") or 0) or None,
        "has_video": video is not None,
        "has_audio": audio is not None,
        "container": str(fmt.get("format_name") or "")[:40],
    }
    playable = True
    if video is not None:
        width, height = display_size(video)
        info.update(width=width, height=height, fps=fps_of(video), video_codec=str(video.get("codec_name") or "")[:20],
                    rotation=rotation_of(video))
        playable = info["video_codec"] in BROWSER_VIDEO
    if audio is not None:
        info.update(audio_codec=str(audio.get("codec_name") or "")[:20],
                    sample_rate=int(audio.get("sample_rate") or 0) or None, channels=int(audio.get("channels") or 0) or None,
                    audio_bit_rate=int(audio.get("bit_rate") or 0) or None)
        playable = playable and info["audio_codec"] in BROWSER_AUDIO
    info["playable"] = playable
    return info


# --- imported files ----------------------------------------------------------------------------------------------

def decoded(path: Path, upload: bool, stream: str, start: float, count: int, audio: bool = False) -> int:
    """Frames (video) or audio packets decoded from `start` (at most `count`, 10 s of input), as framemd5 lines."""
    limit = ["-t", "2"] if audio else ["-frames:v", str(count)]
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", *guard(upload), "-ss", f"{start:.3f}",
           "-t", "10", "-i", str(path), "-map", stream, *limit, "-f", "framemd5", "-"]
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=120, check=False)
    except subprocess.TimeoutExpired:
        return 0
    return sum(1 for line in out.stdout.decode("ascii", "replace").splitlines() if line and not line.startswith("#"))


def _upload_ext(fmt: str, video: dict[str, Any] | None, audio: dict[str, Any] | None, original: str) -> str:
    names = set(fmt.split(","))
    hint = Path(original).suffix.lower().lstrip(".")
    if names & {"mov", "mp4", "m4a", "3gp", "3g2", "mj2"}:
        if video is None:
            return "m4a"
        return "mov" if hint == "mov" else "mp4"
    if names & {"matroska", "webm"}:
        webm_codecs = (video is None or video.get("codec_name") in ("vp8", "vp9", "av1")) and \
                      (audio is None or audio.get("codec_name") in ("opus", "vorbis"))
        if video is None:
            return "weba" if webm_codecs else "mka"
        return "webm" if webm_codecs else "mkv"
    for name in ("mp3", "wav", "ogg", "flac", "aac"):
        if name in names:
            return name
    raise unsupported()


def run_upload_check(task: dict[str, Any], cfg: dict[str, Any], workdir: Path, reporter: Any) -> dict[str, Any]:
    """Validate an imported file (POST /uploads/{id}/complete) and turn it into the result of its job.

    Refused: what the allowed demuxers cannot open, no sound and no picture, no readable duration, longer than
    MAX_DURATION_S, a picture larger than 4K, nothing decodable at the start and in the middle."""
    params = task["params"]
    source = Path(params["source"])
    size = source.stat().st_size
    reporter.send("checking", 0.2, force=True)
    meta = probe_media(source, upload=True)
    video, audio = streams_of(meta)
    if video is None and audio is None:
        raise unsupported("Ce fichier ne contient ni image ni son.")
    duration = duration_of(meta, video, audio)
    if duration <= 0:
        raise unsupported("La durée de ce fichier est illisible.")
    if duration > cfg["max_duration_s"] + 0.5:
        raise ApiError(413, "too_long", f"Le fichier dure plus de {cfg['max_duration_s'] // 60} min, la limite du service.")
    if video is not None:
        width, height = display_size(video)
        if width <= 0 or height <= 0:
            raise unsupported("L'image de cette vidéo est illisible.")
        if max(width, height) > MAX_SIDE or width * height > MAX_PIXELS:
            raise ApiError(413, "resolution_too_high", "Image trop grande : le service accepte jusqu'à la 4K.")
        stream = f"0:{video.get('index', 'v:0')}"
        first = decoded(source, True, stream, 0.0, 3)
        middle = decoded(source, True, stream, duration / 2, 2) if duration >= 2 else first
        if not first or not middle:
            raise unsupported("La vidéo de ce fichier ne se décode pas (fichier abîmé ou format non pris en charge).")
    elif not decoded(source, True, f"0:{audio.get('index', 'a:0')}", 0.0, 0, audio=True):  # type: ignore[union-attr]
        raise unsupported("Le son de ce fichier ne se décode pas (fichier abîmé ou format non pris en charge).")
    reporter.send("checking", 0.9, force=True)
    original = str(params.get("name") or "")
    ext = _upload_ext(str((meta.get("format") or {}).get("format_name") or ""), video, audio, original)
    final = workdir / f"media.{ext}"
    source.rename(final)
    title = sanitize_title(Path(original).stem if original else "", fallback="Fichier importé")
    info = media_info(meta, size)
    notes = []
    if not info["playable"]:
        notes.append("Ce format ne se lit pas dans tous les navigateurs : un aperçu compatible peut être préparé.")
    return {
        "filepath": str(final),
        "download_name": build_download_name(title, None, ext),
        "media_type": media_types().get(ext, "application/octet-stream"),
        "title": title,
        "id": None,
        "ext": ext,
        "size": size,
        "notes": notes,
        "media": info,
    }


# --- edits ---------------------------------------------------------------------------------------------------------

def _even(value: float) -> int:
    return max(2, int(value) // 2 * 2)


def geometry(params: dict[str, Any], video: dict[str, Any]) -> tuple[list[str], int, int]:
    """Filters for square pixels, crop, rotation and mirror; returns (filters, width, height) of the result."""
    filters: list[str] = []
    width, height = display_size(video)
    if abs(sar_of(video) - 1) > 0.01:
        filters.append("scale=trunc(iw*sar/2)*2:ih,setsar=1")
    crop = params.get("crop")
    if crop:
        x, y, w, h = (int(crop[k]) for k in ("x", "y", "w", "h"))
        if x >= width - 8 or y >= height - 8:
            raise ApiError(400, "invalid_crop", "Le recadrage sort de l'image.")
        w, h = _even(min(w, width - x)), _even(min(h, height - y))
        x, y = x // 2 * 2, y // 2 * 2
        if w < 16 or h < 16:
            raise ApiError(400, "invalid_crop", "Le recadrage est trop petit (16 pixels au moins).")
        filters.append(f"crop={w}:{h}:{x}:{y}")
        width, height = w, h
    rotate = int(params.get("rotate") or 0)
    if rotate == 90:
        filters.append("transpose=1")
    elif rotate == 270:
        filters.append("transpose=2")
    elif rotate == 180:
        filters.append("hflip,vflip")
    if rotate in (90, 270):
        width, height = height, width
    flip = str(params.get("flip") or "")
    if "h" in flip:
        filters.append("hflip")
    if "v" in flip:
        filters.append("vflip")
    return filters, width, height


def atempo(speed: float) -> list[str]:
    """atempo takes 0.5–100 per instance: a chain for 0.25×."""
    chain, rest = [], speed
    while rest < 0.5:
        chain.append("atempo=0.5")
        rest /= 0.5
    if abs(rest - 1) > 1e-6:
        chain.append(f"atempo={rest:.5f}")
    return chain


def sample_rate_of(audio: dict[str, Any] | None) -> int | None:
    """Sample rate of a probed sound stream, None when missing or absurd."""
    try:
        rate = int((audio or {}).get("sample_rate") or 0)
    except (TypeError, ValueError):
        return None
    return rate if 1000 <= rate <= 768000 else None


def shift_rates(params: dict[str, Any], sample_rate: int | None) -> tuple[int, int] | None:
    """Sped Up / Slowed (pitch "shift"): the samples are declared at rate × speed, like a record played faster (tempo
    and pitch move together), then resampled back to the rate of the source (48 kHz when unknown). Returns (declared
    rate, rate), None when the pitch is kept or the speed is 1. asetrate takes whole hertz: the real speed is
    declared / rate, and the picture and every timing of the export follow that exact ratio."""
    speed = float(params.get("speed") or 1)
    if params.get("pitch") != "shift" or abs(speed - 1) <= 1e-6:
        return None
    rate = sample_rate or DEFAULT_RATE
    return round(rate * speed), rate


def audio_filters(params: dict[str, Any], length: float, sample_rate: int | None = None) -> list[str]:
    """Speed, volume, then fades placed in the time of the result (`length`: its length).

    sample_rate: rate of the source sound as probed, for pitch "shift" (None: unknown, the sound is first brought to
    48 kHz so that asetrate declares the rate the samples really have)."""
    rates = shift_rates(params, sample_rate)
    if rates:
        resample = f"aresample={rates[1]}:resampler=soxr:precision=28"
        filters = ([] if sample_rate else [resample]) + [f"asetrate={rates[0]}", resample]
    else:
        filters = atempo(float(params.get("speed") or 1))
    volume = float(params.get("volume_db") or 0)
    if volume:
        filters.append(f"volume={volume:.1f}dB")
    fade_in, fade_out = float(params.get("fade_in_s") or 0), float(params.get("fade_out_s") or 0)
    if fade_in:
        filters.append(f"afade=t=in:st=0:d={min(fade_in, length):.3f}")
    if fade_out:
        filters.append(f"afade=t=out:st={max(0.0, length - fade_out):.3f}:d={min(fade_out, length):.3f}")
    return filters


def video_fades(params: dict[str, Any], length: float) -> list[str]:
    filters = []
    fade_in, fade_out = float(params.get("fade_in_s") or 0), float(params.get("fade_out_s") or 0)
    if fade_in:
        filters.append(f"fade=t=in:st=0:d={min(fade_in, length):.3f}")
    if fade_out:
        filters.append(f"fade=t=out:st={max(0.0, length - fade_out):.3f}:d={min(fade_out, length):.3f}")
    return filters


def span(params: dict[str, Any], duration: float) -> tuple[float, float]:
    """(start, length) of the passage of the source, length clamped to the end of the media."""
    from .worker import _out_of_range

    start = float(params.get("start_s") or 0)
    if duration and start >= duration - 0.05:
        raise _out_of_range(start, duration)
    wanted = params.get("duration_s")
    length = (duration - start) if wanted is None else min(float(wanted), duration - start if duration else float(wanted))
    return round(start, 3), round(max(0.05, length), 3)


def _hms_name(seconds: float) -> str:
    from .worker import _hms

    return _hms(seconds)


def export_label(params: dict[str, Any], start: float, length: float, duration: float, sound: bool = True) -> str:
    """What an export adds after the title in its file name (build_download_name always keeps it whole).
    sound=False: the result has no sound track, a speed change is then only a speed change."""
    op = params["op"]
    if op == "apercu":
        return "(aperçu)"
    if op == "echantillon":
        return "(échantillon)"
    if op == "gif":
        return "(GIF)"
    if op == "compress":
        return "(compressé)"
    parts = []
    if start > 0.05 or start + length < duration - 0.05:
        parts.append(f"{_hms_name(start)}-{_hms_name(start + length)}")
    if params.get("crop"):
        parts.append("recadré")
    if params.get("rotate"):
        parts.append("pivoté")
    speed = float(params.get("speed") or 1)
    if abs(speed - 1) > 1e-6:
        shift = sound and params.get("pitch") == "shift"
        word = ("sped up" if speed > 1 else "slowed") if shift else "vitesse"
        parts.append(f"{word} ×{speed:g}".replace(".", ","))
    label = "audio" if op == "audio" else "montage"
    return f"({label}{' ' + ', '.join(parts) if parts else ''})"


def _limit(op: str, out_length: float, cfg: dict[str, Any]) -> None:
    if op in ("video", "compress", "echantillon", "apercu") and out_length > cfg["transcode_max_duration_s"] + 0.5:
        raise ApiError(413, "transcode_too_long",
                       f"Un export vidéo dure au plus {cfg['transcode_max_duration_s'] // 60} min : choisis un passage "
                       "plus court.")
    if op == "audio" and out_length > cfg["max_duration_s"] + 0.5:
        raise ApiError(413, "too_long", f"Un export audio dure au plus {cfg['max_duration_s'] // 60} min.")
    if op == "gif" and out_length > cfg["gif_max_duration_s"] + 0.05:
        raise ApiError(413, "gif_too_long", f"Un GIF dure au plus {cfg['gif_max_duration_s']} s : choisis un passage "
                                            "plus court.")


def run_tools_derive(task: dict[str, Any], cfg: dict[str, Any], workdir: Path, reporter: Any) -> dict[str, Any]:
    """Edits of AETHRYON Tools (op video / audio / gif / compress / echantillon / apercu with the Tools fields)."""
    from .worker import cpu_limit, plan_compression, run_ffmpeg

    params = task["params"]
    source = Path(params["source"])
    if not source.is_file():
        raise ApiError(410, "file_gone", "Le fichier d'origine a expiré : importe-le ou convertis-le à nouveau.")
    upload = bool(params.get("from_upload"))
    meta = probe_media(source, upload)
    video, audio = streams_of(meta)
    duration = duration_of(meta, video, audio)
    op = params["op"]
    rate = sample_rate_of(audio)
    sound = audio is not None and op != "gif" and not params.get("mute")  # the result has a sound track
    # Sped Up / Slowed: the exact ratio of the resampling drives the picture and every length below (same sync).
    rates = shift_rates(params, rate) if sound else None
    speed = rates[0] / rates[1] if rates else float(params.get("speed") or 1)
    title = params.get("title") or "media"
    threads = str(cpu_limit())
    reporter.band = (0.0, 99.0)
    notes: list[str] = []
    inputs = [*guard(upload)]

    if op == "apercu":
        start, length = 0.0, duration
        selection = duration
    else:
        start, length = span(params, duration)
        selection = length / speed  # length of the result the user asked for (the sample shows a piece of it)
        if op == "echantillon":
            sample = min(SAMPLE_S * speed, length)
            start, length = round(start + (length - sample) / 2, 3), round(sample, 3)
    out_length = length / speed
    _limit(op, selection, cfg)
    seek = ["-ss", f"{start:.3f}", "-t", f"{length:.3f}", *inputs, "-i", str(source)]

    if op == "audio":
        if audio is None:
            raise ApiError(400, "no_audio", "Ce média n'a pas de piste son : export audio impossible.")
        fmt = params.get("audio_format") or "mp3"
        bitrate = f"{int(params.get('bitrate') or 192)}k"
        codecs = {"mp3": ["-c:a", "libmp3lame", "-b:a", bitrate, "-id3v2_version", "3", "-write_xing", "1"],
                  "m4a": ["-c:a", "aac", "-b:a", bitrate, "-movflags", "+faststart"],
                  "wav": ["-c:a", "pcm_s16le"],
                  "ogg": ["-c:a", "libvorbis", "-q:a", "6"],
                  "flac": ["-c:a", "flac"]}[fmt]
        target = workdir / f"export.{fmt}"
        af = audio_filters(params, out_length, rate)
        args = [*seek, "-map", "0:a:0", "-vn", *(["-af", ",".join(af)] if af else []), *codecs,
                "-metadata", f"title={sanitize_title(title)}", str(target)]
        run_ffmpeg(args, out_length, reporter, "audio")
    elif op == "gif":
        if video is None:
            raise ApiError(422, "format_unavailable", "Ce média n'a pas d'image : GIF impossible.")
        pre, _, _ = geometry(params, video)
        if abs(speed - 1) > 1e-6:
            pre.append(f"setpts=PTS/{speed:.5f}")
        width, fps = int(params.get("gif_width") or 480), int(params.get("gif_fps") or 15)
        chain = ",".join([*pre, f"fps={fps}", f"scale='min({width},iw)':-2:flags=lanczos"])
        palette, target = workdir / "palette.png", workdir / "export.gif"
        run_ffmpeg([*seek, "-vf", f"{chain},palettegen=stats_mode=diff", "-update", "1", "-frames:v", "1", str(palette)],
                   out_length, reporter, "gif:palette")
        run_ffmpeg([*seek, "-i", str(palette), "-lavfi",
                    f"{chain}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle", "-loop", "0",
                    str(target)], out_length, reporter, "gif:encode")
        palette.unlink(missing_ok=True)
        max_bytes = params.get("max_bytes")
        if max_bytes and target.stat().st_size > int(max_bytes):
            target.unlink(missing_ok=True)
            raise ApiError(413, "cannot_fit", "Ce GIF dépasse la taille demandée : choisis un passage plus court, une "
                                              "largeur ou une cadence plus petite.")
    else:
        if video is None:
            raise ApiError(422, "format_unavailable", "Ce média n'a pas d'image : export vidéo impossible.")
        pre, width, height = geometry(params, video)
        if rates:
            pre.append(f"setpts=PTS*{rates[1]}/{rates[0]}")
        elif abs(speed - 1) > 1e-6:
            pre.append(f"setpts=PTS/{speed:.5f}")
        container = "mp4"
        keep_audio = sound
        if audio is None and (params.get("volume_db") or params.get("fade_in_s") or params.get("fade_out_s")
                              or (params.get("pitch") == "shift" and abs(speed - 1) > 1e-6)):
            notes.append("Ce média n'a pas de son : les réglages du son sont ignorés.")
        if op in ("compress", "echantillon"):
            max_bytes = int(params["max_bytes"])
            fps = fps_of(video)
            # A sample is encoded with the plan of the WHOLE passage the user wants to compress.
            plan = plan_compression(selection, width, height, (fps * speed) if fps else None, keep_audio, max_bytes)
            short = min(width, height)
            if plan["short_side"] < short:
                pre.append(f"scale=-2:{plan['short_side']}" if width >= height else f"scale={plan['short_side']}:-2")
            if plan["fps"]:
                pre.append(f"fps={plan['fps']}")
            pre.append("scale=trunc(iw/2)*2:trunc(ih/2)*2")
            video_kbps = plan["video_kbps"]
            vcodec = ["-c:v", "libx264", "-preset", "veryfast", "-b:v", f"{video_kbps}k", "-maxrate", f"{video_kbps}k",
                      "-bufsize", f"{video_kbps * 2}k", "-pix_fmt", "yuv420p", "-profile:v", "high", "-threads", threads]
            acodec = ["-c:a", "aac", "-b:a", f"{plan['audio_kbps']}k", "-ac", "2"]
            notes.append(f"Plan : {plan['short_side']}p, {video_kbps} kbit/s pour l'image"
                         + (f", {plan['audio_kbps']} kbit/s pour le son." if keep_audio else "."))
        else:
            if op == "apercu":
                short = min(width, height)
                if short > 720:
                    pre.append("scale=-2:720" if width >= height else "scale=720:-2")
                vcodec = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
                          "-profile:v", "high", "-threads", threads]
                acodec = ["-c:a", "aac", "-b:a", "128k", "-ac", "2"]
            else:
                container = str(params.get("container") or "mp4")
                wanted = params.get("height")
                if wanted and int(wanted) < height:
                    pre.append(f"scale=-2:{int(wanted)}")
                quality = str(params.get("quality") or "standard")
                if container == "webm":
                    vcodec = ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", str(CRF_VP9[quality]), "-deadline", "realtime",
                              "-cpu-used", "6", "-row-mt", "1", "-threads", threads, "-pix_fmt", "yuv420p"]
                    acodec = ["-c:a", "libopus", "-b:a", "128k", "-ac", "2"]
                else:
                    vcodec = ["-c:v", "libx264", "-preset", "veryfast", "-crf", str(CRF_X264[quality]),
                              "-pix_fmt", "yuv420p", "-profile:v", "high", "-threads", threads]
                    acodec = ["-c:a", "aac", "-b:a", "192k", "-ac", "2"]
            pre.append("scale=trunc(iw/2)*2:trunc(ih/2)*2")
            pre.extend(video_fades(params, out_length))
        target = workdir / f"export.{container}"
        af = audio_filters(params, out_length, rate) if keep_audio else []
        args = [*seek, "-map", "0:v:0", *(["-map", "0:a:0"] if keep_audio else ["-an"]), "-vf", ",".join(pre), *vcodec]
        if keep_audio:
            args += [*(["-af", ",".join(af)] if af else []), *acodec]
        if container in ("mp4", "mov"):
            args += ["-movflags", "+faststart"]
        args += ["-metadata", f"title={sanitize_title(title)}", str(target)]
        stage = {"compress": "compressing", "echantillon": "sampling", "apercu": "preview"}.get(op, "rendering")
        run_ffmpeg(args, out_length, reporter, stage)
        if op == "compress" and target.stat().st_size > int(params["max_bytes"]):
            # Same safety net as the media tools: one pass at a lower rate when x264 overshot.
            size = target.stat().st_size
            lower = int(plan["video_kbps"] * int(params["max_bytes"]) / size * 0.9)  # type: ignore[index]
            from .worker import COMPRESS_MIN_VIDEO_KBPS

            if lower < COMPRESS_MIN_VIDEO_KBPS:
                target.unlink(missing_ok=True)
                raise ApiError(413, "cannot_fit", "Impossible de faire tenir cette vidéo dans la taille demandée.")
            index = args.index("-b:v")
            args[index + 1] = f"{lower}k"
            args[args.index("-maxrate") + 1] = f"{lower}k"
            args[args.index("-bufsize") + 1] = f"{lower * 2}k"
            run_ffmpeg(args, out_length, reporter, "compressing")
            if target.stat().st_size > int(params["max_bytes"]):
                target.unlink(missing_ok=True)
                raise ApiError(413, "cannot_fit", "Impossible de faire tenir cette vidéo dans la taille demandée.")
    ext = target.suffix.lstrip(".")
    size = target.stat().st_size
    if size > cfg["max_filesize_bytes"]:
        target.unlink(missing_ok=True)
        from .worker import _too_large

        raise _too_large(cfg)
    out_meta = probe_media(target, upload=False)
    info = media_info(out_meta, size)
    if op not in ("echantillon", "apercu") and info["duration"] and abs(info["duration"] - out_length) > 0.5:
        log.warning("export duration differs", extra={"expected": round(out_length, 3), "got": info["duration"]})
    reporter.send("finalizing", 1.0, force=True)
    label = export_label(params, start, length, duration, sound)
    return {
        "filepath": str(target),
        "download_name": build_download_name(title, params.get("media_id"), ext, label=label),
        "media_type": media_types().get(ext, "application/octet-stream"),
        "title": title,
        "id": params.get("media_id"),
        "ext": ext,
        "size": size,
        "notes": notes,
        "media": info,
    }


# --- storyboard and waveform ---------------------------------------------------------------------------------------

def run_storyboard(task: dict[str, Any], cfg: dict[str, Any], workdir: Path) -> dict[str, Any]:
    """Sprite of evenly spaced pictures (JPEG, cols × rows tiles) for the editor's timeline."""
    params = task["params"]
    source, upload = Path(params["source"]), bool(params.get("from_upload"))
    out_dir = Path(params["out_dir"])
    meta = probe_media(source, upload)
    video, _ = streams_of(meta)
    if video is None:
        return {"count": 0}
    duration = duration_of(meta, video)
    width, height = display_size(video)
    if duration <= 0 or width <= 0 or height <= 0:
        return {"count": 0}
    count = max(8, min(120, math.ceil(duration / 2)))
    tile_h = 112
    tile_w = max(40, min(224, _even(tile_h * width / height)))
    cols = min(count, 12)
    rows = math.ceil(count / cols)
    target = out_dir / "storyboard.jpg"
    skip = ["-skip_frame", "nokey"] if duration > 120 else []
    vf = (f"fps={count / duration:.6f},scale={tile_w}:{tile_h}:force_original_aspect_ratio=decrease,"
          f"pad={tile_w}:{tile_h}:(ow-iw)/2:(oh-ih)/2:color=0x0F0F10,tile={cols}x{rows}:color=0x0F0F10")
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-y", *guard(upload), *skip, "-threads", "2",
           "-i", str(source), "-map", "0:v:0", "-an", "-sn", "-vf", vf, "-frames:v", "1", "-q:v", "5", str(target)]
    out = subprocess.run(cmd, capture_output=True, timeout=150, check=False)
    if out.returncode != 0 or not target.is_file():
        log.warning("storyboard failed", extra={"stderr": out.stderr.decode("utf-8", "replace")[-600:]})
        raise ApiError(500, "conversion_failed", "La planche d'images n'a pas pu être préparée.")
    data = {"count": count, "cols": cols, "rows": rows, "tile_w": tile_w, "tile_h": tile_h,
            "interval_s": round(duration / count, 4), "duration": round(duration, 3)}
    (out_dir / "storyboard.json").write_text(json.dumps(data), encoding="utf-8")
    return data


WAVE_RATE = 4000


def run_waveform(task: dict[str, Any], cfg: dict[str, Any], workdir: Path) -> dict[str, Any]:
    """Peak level of the sound per slice of time (0–255), streamed from ffmpeg: never the whole sound in memory."""
    params = task["params"]
    source, upload = Path(params["source"]), bool(params.get("from_upload"))
    out_dir = Path(params["out_dir"])
    meta = probe_media(source, upload)
    _, audio = streams_of(meta)
    if audio is None:
        return {"count": 0}
    duration = duration_of(meta, audio)
    if duration <= 0:
        return {"count": 0}
    buckets = int(max(200, min(8000, duration * 25)))
    total = max(1, int(duration * WAVE_RATE))
    peaks = [0] * buckets
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", *guard(upload), "-threads", "2",
           "-i", str(source), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", str(WAVE_RATE), "-f", "s16le",
           "-acodec", "pcm_s16le", "pipe:1"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    assert proc.stdout is not None
    position = 0
    leftover = b""
    try:
        while True:
            chunk = proc.stdout.read(1 << 16)
            if not chunk:
                break
            chunk = leftover + chunk
            usable = len(chunk) // 2 * 2
            leftover = chunk[usable:]
            samples = array("h")
            samples.frombytes(chunk[:usable])
            i, n = 0, len(samples)
            while i < n:
                bucket = min(buckets - 1, position * buckets // total)
                boundary = ((bucket + 1) * total + buckets - 1) // buckets if bucket < buckets - 1 else position + n
                take = max(1, min(n - i, boundary - position))
                part = samples[i:i + take]
                peak = max(max(part), -min(part))
                if peak > peaks[bucket]:
                    peaks[bucket] = peak
                i += take
                position += take
        if proc.wait(timeout=150) != 0:
            raise ApiError(500, "conversion_failed", "La forme d'onde n'a pas pu être préparée.")
    finally:
        if proc.poll() is None:
            proc.kill()
    data = {"count": buckets, "duration": round(duration, 3), "peaks": [min(255, p * 255 // 32767) for p in peaks]}
    (out_dir / "waveform.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    return data


def assets_task(task: dict[str, Any], cfg: dict[str, Any], workdir: Path) -> dict[str, Any]:
    what = task["params"]["asset"]
    if what == "storyboard":
        return run_storyboard(task, cfg, workdir)
    if what == "waveform":
        return run_waveform(task, cfg, workdir)
    raise ApiError(400, "invalid_parameter", "Ressource inconnue.")


_NAME_RE = re.compile(r"[^\w .,()\[\]'&+-]", re.UNICODE)


def clean_upload_name(raw: str | None) -> str:
    """Original file name kept only for the title of the result (never a path on the server)."""
    text = _NAME_RE.sub(" ", (raw or "").replace("\\", "/").rsplit("/", 1)[-1])[:200]
    return re.sub(r"\s+", " ", text).strip()
