"""Request parameters shared by GET /dl (query string) and POST /jobs (JSON body)."""

from __future__ import annotations

import math
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .errors import ApiError

Fmt = Literal["mp4", "mp3", "gif"]
Quality = Literal["best", "2160", "1440", "1080", "720", "480", "360", "worst"]
QUALITIES: tuple[str, ...] = ("best", "2160", "1440", "1080", "720", "480", "360", "worst")
# Clips (MEDIA_TOOLS_ENABLED): bounds in milliseconds (startMs/endMs, CONTRAT-EXTRAITS) or in seconds (legacy
# start_s/end_s). Their longest length is a server setting (EXTRAIT_DUREE_MAX_S, GIF_MAX_DURATION_S), checked by
# normalize_clip: never a fixed value. The length of the source does not matter.
CLIP_MS_MAX = 86_400_000  # 24 h
# Derived jobs: compression targets between 1 MiB and 500 MiB.
DERIVE_MIN_BYTES = 1024 * 1024
DERIVE_MAX_BYTES = 500 * 1024 * 1024


def _seconds(value: object) -> object:
    """Seconds as a number, "75", "1:15" or "01:01:15" (iOS Shortcuts, Discord); rounded to the millisecond."""
    if isinstance(value, str):
        text = value.strip()
        if re.fullmatch(r"\d{1,2}(:[0-5]\d){1,2}(\.\d{1,3})?", text):
            total = 0.0
            for part in text.split(":"):
                total = total * 60 + float(part)
            return round(total, 3)
        try:
            return round(float(text), 3)
        except ValueError:
            return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return round(float(value), 3)
    return value


class DownloadParams(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    url: str = Field(min_length=1, max_length=2048)
    fmt: Fmt = "mp4"
    quality: Quality = "best"
    bitrate: Literal[128, 192, 320] = 192
    gif_width: int = Field(480, ge=64, le=1280)
    gif_fps: int = Field(15, ge=1, le=30)
    transcode: bool = False
    index: int = Field(1, ge=1, le=50)
    # Extract [start_s, end_s] of the media (both or neither; MEDIA_TOOLS_ENABLED; mp4, mp3 or gif).
    start_s: float | None = Field(None, ge=0, le=86400, allow_inf_nan=False)
    end_s: float | None = Field(None, gt=0, le=86400, allow_inf_nan=False)
    # Same, in integer milliseconds (CONTRAT-EXTRAITS): checked by normalize_clip (422 with a French message), which
    # also fills start_s/end_s. Raw here so that a wrong value gets the clip error, not a generic 400.
    startMs: Any = None  # noqa: N815 - name of the contract
    endMs: Any = None  # noqa: N815

    @field_validator("start_s", "end_s", mode="before")
    @classmethod
    def _parse_seconds(cls, value: object) -> object:
        return _seconds(value)

    @model_validator(mode="after")
    def _check_clip(self) -> DownloadParams:
        if self.start_s is None and self.end_s is None:
            return self
        if self.start_s is None or self.end_s is None:
            raise ValueError("start_s et end_s vont ensemble (début et fin de l'extrait, en secondes)")
        if self.end_s <= self.start_s:
            raise ValueError("end_s doit être après start_s")
        return self

    @property
    def clip(self) -> bool:
        return self.start_s is not None and self.end_s is not None

    @field_validator("fmt", mode="before")
    @classmethod
    def _lower_fmt(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("quality", mode="before")
    @classmethod
    def _normalize_quality(cls, value: object) -> object:
        # Accept "1080p", "1080P", " Best " and plain ints from JSON bodies.
        if isinstance(value, float) and value.is_integer():
            value = int(value)
        if isinstance(value, int) and not isinstance(value, bool):
            value = str(value)
        if isinstance(value, str):
            value = value.strip().lower()
            if value.endswith("p") and value[:-1].isdigit():
                value = value[:-1]
        return value

    @field_validator("bitrate", mode="before")
    @classmethod
    def _normalize_bitrate(cls, value: object) -> object:
        # iOS Shortcuts "Number" fields may arrive as 192.0.
        if isinstance(value, float) and value.is_integer():
            return int(value)
        if isinstance(value, str):
            value = value.strip().lower().removesuffix("k")
            if value.isdigit():
                return int(value)
        return value

    def summary(self) -> dict[str, object]:
        """Parameters safe to log/return (no URL query string)."""
        data = self.model_dump(exclude={"url"})
        if self.fmt != "gif":
            data.pop("gif_width"), data.pop("gif_fps")
        if self.fmt != "mp3":
            data.pop("bitrate")
        if self.fmt != "mp4":
            data.pop("transcode"), data.pop("quality")
        if not self.clip:
            data.pop("start_s"), data.pop("end_s")
        if self.startMs is None and self.endMs is None:
            data.pop("startMs"), data.pop("endMs")
        return data

    @property
    def wants_clip(self) -> bool:
        return self.clip or self.startMs is not None or self.endMs is not None


def _clip_ms(value: Any, name: str) -> int:
    """Integer milliseconds: a JSON integer (or an integral number, or digits as text, as Shortcuts send them)."""
    if isinstance(value, bool) or value is None:
        number = None
    elif isinstance(value, int):
        number = value
    elif isinstance(value, float) and math.isfinite(value) and value.is_integer():
        number = int(value)
    elif isinstance(value, str) and re.fullmatch(r"\s*-?\d{1,9}\s*", value):
        number = int(value)
    else:
        number = None
    if number is None:
        raise ApiError(422, "extrait_invalide", f"{name} doit être un nombre entier de millisecondes "
                                                "(ex. 7987800 pour 02:13:07.800).")
    if number < 0:
        raise ApiError(422, "extrait_invalide", f"{name} ne peut pas être négatif.")
    if number > CLIP_MS_MAX:
        raise ApiError(422, "extrait_invalide", f"{name} dépasse 24 h.")
    return number


def _readable(ms: float) -> str:
    """Une durée pour un message, à la milliseconde : 10 min, 10 min 00,001 s, 1 h 05 min, 45 s, 1,5 s."""
    total = int(round(ms))
    hours, rest = divmod(total, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    seconds, milli = divmod(rest, 1000)
    text = f"{seconds:02d}" if hours or minutes else str(seconds)
    if milli:
        text += "," + f"{milli:03d}".rstrip("0")
    parts = []
    if hours:
        parts.append(f"{hours} h")
    if minutes or (hours and (seconds or milli)):
        parts.append(f"{minutes:02d} min" if hours else f"{minutes} min")
    if seconds or milli or not parts:
        parts.append(f"{text} s")
    return " ".join(parts)


def clip_max_s(fmt: str, extrait_duree_max_s: int, gif_max_duration_s: int) -> int:
    """Longest clip for a format: EXTRAIT_DUREE_MAX_S, and GIF_MAX_DURATION_S as well for a GIF."""
    return min(extrait_duree_max_s, gif_max_duration_s) if fmt == "gif" else extrait_duree_max_s


def normalize_clip(params: DownloadParams, extrait_duree_max_s: int, gif_max_duration_s: int) -> DownloadParams:
    """Clip bounds checked by the server, whatever the client checked: startMs/endMs (integers) become start_s/end_s;
    the length must stay within the server's limit for the format. 422 extrait_invalide / extrait_trop_long."""
    if params.startMs is not None or params.endMs is not None:
        if params.start_s is not None or params.end_s is not None:
            raise ApiError(422, "extrait_invalide", "Donne les bornes de l'extrait soit en millisecondes (startMs, endMs), "
                                                    "soit en secondes (start_s, end_s), pas les deux.")
        if params.startMs is None or params.endMs is None:
            raise ApiError(422, "extrait_invalide", "startMs et endMs vont ensemble (début et fin de l'extrait, en "
                                                    "millisecondes).")
        start, end = _clip_ms(params.startMs, "startMs"), _clip_ms(params.endMs, "endMs")
        if end <= start:
            raise ApiError(422, "extrait_invalide", "La fin de l'extrait (endMs) doit être après son début (startMs).")
        params = params.model_copy(update={"startMs": start, "endMs": end, "start_s": start / 1000, "end_s": end / 1000})
    if not params.clip:
        return params
    assert params.start_s is not None and params.end_s is not None
    limit_s = clip_max_s(params.fmt, extrait_duree_max_s, gif_max_duration_s)
    length_ms = round((params.end_s - params.start_s) * 1000)
    if length_ms > limit_s * 1000:
        kind = {"mp4": "Un extrait MP4", "mp3": "Un extrait MP3", "gif": "Un GIF"}[params.fmt]
        raise ApiError(422, "extrait_trop_long", f"{kind} dure au plus {_readable(limit_s * 1000)} sur ce serveur ; "
                                                 f"celui demandé dure {_readable(length_ms)}.")
    return params


class Crop(BaseModel):
    """Rectangle kept from the DISPLAYED picture (after the source's own rotation), in source pixels."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    x: int = Field(ge=0, le=16384)
    y: int = Field(ge=0, le=16384)
    w: int = Field(ge=16, le=16384)
    h: int = Field(ge=16, le=16384)


# AETHRYON Tools (TOOLS_ENABLED): edits of a finished download or of an imported file.
TOOLS_OPS = ("video", "audio", "apercu", "echantillon")
VIDEO_CONTAINERS = ("mp4", "mov", "mkv", "webm")
AUDIO_FORMATS = ("mp3", "m4a", "wav", "ogg", "flac")
# Fields only the Tools may set (the media tools of the Discord bot keep their original contract).
TOOLS_FIELDS = ("crop", "rotate", "flip", "speed", "pitch", "mute", "volume_db", "fade_in_s", "fade_out_s", "height",
                "quality", "container", "audio_format", "bitrate")


class DeriveParams(BaseModel):
    """POST /jobs/{id}/derive: a new file made from a finished job of the same caller, without a new download nor
    a new quota unit.

    Media tools (Discord bot): compress = same video under max_bytes (H.264/AAC, smaller picture if needed);
    gif = duration_s seconds from start_s (<= GIF_MAX_DURATION_S), optionally under max_bytes.
    AETHRYON Tools (TOOLS_ENABLED) add: video (MP4/MOV/MKV/WebM of a passage: crop, rotation, mirror, speed, sound
    level and fades, height, quality), audio (MP3/M4A/WAV/OGG/FLAC of a passage), apercu (H.264 720p copy that every
    browser plays, for an imported file the browser cannot read), echantillon (2 s encoded with the compression
    plan: the real look of the result before compressing), and the same geometry/speed fields for gif and compress.
    duration_s None = to the end of the media (video, audio, compress). A speed change keeps the pitch of the sound,
    unless pitch="shift" (Sped Up / Slowed: tempo and pitch move together, like a record played faster)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    op: Literal["compress", "gif", "video", "audio", "apercu", "echantillon"]
    max_bytes: int | None = Field(None, ge=DERIVE_MIN_BYTES, le=DERIVE_MAX_BYTES)
    start_s: float = Field(0, ge=0, le=86400, allow_inf_nan=False)
    duration_s: float | None = Field(None, gt=0, le=86400, allow_inf_nan=False)
    gif_width: int = Field(480, ge=64, le=1280)
    gif_fps: int = Field(15, ge=5, le=30)
    crop: Crop | None = None
    rotate: Literal[0, 90, 180, 270] = 0
    flip: Literal["", "h", "v", "hv"] = ""
    speed: float = Field(1.0, ge=0.25, le=4.0, allow_inf_nan=False)
    pitch: Literal["keep", "shift"] = "keep"
    mute: bool = False
    volume_db: float = Field(0.0, ge=-30, le=20, allow_inf_nan=False)
    fade_in_s: float = Field(0.0, ge=0, le=10, allow_inf_nan=False)
    fade_out_s: float = Field(0.0, ge=0, le=10, allow_inf_nan=False)
    height: int | None = Field(None, ge=144, le=2160)
    quality: Literal["haute", "standard", "legere"] = "standard"
    container: Literal["mp4", "mov", "mkv", "webm"] = "mp4"
    audio_format: Literal["mp3", "m4a", "wav", "ogg", "flac"] = "mp3"
    bitrate: Literal[96, 128, 192, 256, 320] = 192

    @field_validator("start_s", "duration_s", mode="before")
    @classmethod
    def _parse_seconds(cls, value: object) -> object:
        return _seconds(value)

    @field_validator("speed", mode="before")
    @classmethod
    def _round_speed(cls, value: object) -> object:
        return round(float(value), 3) if isinstance(value, (int, float)) and not isinstance(value, bool) else value

    @model_validator(mode="after")
    def _check(self) -> DeriveParams:
        if self.op == "compress" and self.max_bytes is None:
            raise ValueError("max_bytes est obligatoire pour compresser (taille visée, en octets)")
        if self.op == "echantillon" and self.max_bytes is None:
            raise ValueError("max_bytes est obligatoire pour un échantillon de compression (taille visée, en octets)")
        if self.op == "audio" and (self.crop or self.rotate or self.flip or self.height):
            raise ValueError("un export audio n'a pas d'image : ni recadrage, ni rotation, ni hauteur")
        if self.op == "audio" and self.mute:
            raise ValueError("un export audio sans son n'a pas de sens")
        if self.op == "gif" and (self.mute or self.volume_db or self.fade_in_s or self.fade_out_s):
            raise ValueError("un GIF n'a pas de son : ni volume ni fondu sonore")
        if self.op == "apercu" and (self.uses_tools_fields() or self.start_s or self.duration_s is not None):
            raise ValueError("l'aperçu reprend le média entier, tel quel")
        return self

    def uses_tools_fields(self) -> bool:
        """True when a field outside the original media-tools contract differs from its default."""
        defaults = DeriveParams.model_fields
        return any(getattr(self, name) != defaults[name].default for name in TOOLS_FIELDS) or \
            (self.op in ("compress",) and (self.start_s != 0 or self.duration_s is not None))

    @property
    def gif_duration_s(self) -> float:
        return self.duration_s if self.duration_s is not None else 6.0

    @property
    def pitch_shift(self) -> bool:
        """Sped Up / Slowed really applies: a speed change on an export that may carry a sound (not a GIF, not mute)."""
        return self.pitch == "shift" and self.speed != 1 and self.op != "gif" and not self.mute

    def summary(self) -> dict[str, object]:
        if self.op == "compress" and not self.uses_tools_fields():
            return {"op": "compress", "max_bytes": self.max_bytes}
        if self.op == "gif" and not self.uses_tools_fields():
            data: dict[str, object] = {"op": "gif", "start_s": self.start_s, "duration_s": self.gif_duration_s,
                                       "gif_width": self.gif_width, "gif_fps": self.gif_fps}
            if self.max_bytes is not None:
                data["max_bytes"] = self.max_bytes
            return data
        # Tools: every field that differs from its default (stable order: the merge key of derived jobs). pitch only
        # when it changes the result: two exports that differ by it alone are two files, never one merged job.
        data = {"op": self.op}
        for name, info in DeriveParams.model_fields.items():
            if name == "op" or (name == "pitch" and not self.pitch_shift):
                continue
            value = getattr(self, name)
            if value != info.default:
                data[name] = value.model_dump() if isinstance(value, Crop) else value
        if self.op == "gif":
            data["duration_s"] = self.gif_duration_s
        return data


class PreviewParams(BaseModel):
    """POST /preview body: the link only (in the body, so that it never lands in an access log)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    url: str = Field(min_length=1, max_length=2048)


AUDIO_EXTENSIONS = (".mp3", ".m4a", ".aac", ".wav", ".ogg", ".oga", ".opus", ".flac", ".weba")


class UploadParams(BaseModel):
    """POST /uploads (AETHRYON Tools): announce an import. The file then comes in chunks of UPLOAD_CHUNK_MB."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field("", max_length=255)
    size: int = Field(ge=1, le=64 * 1024 * 1024 * 1024)
    type: str = Field("", max_length=100)

    @property
    def is_audio(self) -> bool:
        """Sound only, as announced (for the history line; the real content is checked after the import)."""
        return self.type.lower().startswith("audio/") or self.name.lower().endswith(AUDIO_EXTENSIONS)
