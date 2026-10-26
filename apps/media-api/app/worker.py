"""Worker process: yt-dlp extraction/download and ffmpeg conversions.

Runs in a child process started by app.runner (own process group). Communicates through a
one-way pipe: {"type": "progress"|"result"|"error", ...}. Never touches the HTTP layer.
"""

from __future__ import annotations

import copy
import functools
import json
import logging
import os
import re
import shutil
import subprocess
import sysconfig
import tempfile
import time
import warnings
from collections.abc import Callable, Sequence
from multiprocessing.connection import Connection
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import yt_dlp
from yt_dlp.globals import plugin_dirs
from yt_dlp.utils import DownloadCancelled, DownloadError, ExtractorError, GeoRestrictedError, LazyList

from . import extraits as X
from .cookies import EXPIRY_RE
from .errors import ApiError, clean_message, map_ytdlp_error
from .filenames import build_download_name
from .logging_setup import redact, setup_logging
from .urls import is_youtube_music_url, youtube_music_error

log = logging.getLogger("ytapi.worker")

try:  # yt-dlp's names of the YouTube player clients (format notes, 'c' parameter of the stream URLs)
    from yt_dlp.extractor.youtube._base import INNERTUBE_CLIENTS as _YT_CLIENT_DEFS
    from yt_dlp.extractor.youtube._base import short_client_name
except ImportError:  # pragma: no cover - yt-dlp moved its internals: same naming rule, 'c' lookup off
    _YT_CLIENT_DEFS = {}

    def short_client_name(client_name: str) -> str:
        main, *parts = client_name.split("_")
        return "-".join(filter(None, (main[:4], "".join(x[0] for x in parts)))).upper()

# yt-dlp plugins only from the root-owned venv (site-packages/yt_dlp_plugins: the optional bgutil
# plugin), never from $HOME (~/.config/yt-dlp/plugins...), which the app user can write.
plugin_dirs.value = [str(Path(sysconfig.get_paths()["purelib"]).parent)]

MEDIA_TYPES = {
    "mp4": "video/mp4",
    "m4v": "video/mp4",
    "mov": "video/quicktime",
    "mkv": "video/x-matroska",
    "webm": "video/webm",
    "mp3": "audio/mpeg",
    "m4a": "audio/mp4",
    "gif": "image/gif",
}
H264_CODECS = ("avc1", "avc3", "h264")
IPHONE_VIDEO_CODECS = ("h264", "h265")

# yt-dlp extractors allowed per platform (regexes, full match on the lowercased IE name).
# Never the generic extractor, and not twitter:shortener: it follows t.co redirects to any
# host (a tweet card could point the server at internal URLs).
PLATFORM_EXTRACTORS: dict[str, list[str]] = {
    "youtube": ["youtube", "youtube:.*", "youtubeytbe"],
    "tiktok": ["tiktok", r"vm\.tiktok"],
    "twitter": ["twitter", "twitter:(?!shortener).*"],
}

_STAGES = {"Merger": "merging", "ExtractAudio": "converting", "ThumbnailsConvertor": "converting",
           "Metadata": "tagging", "EmbedThumbnail": "tagging", "MoveFiles": "finalizing"}
# Post-processors of the mp3 cover art: a failure inside them is retried without the cover.
_COVER_PPS = {"FFmpegThumbnailsConvertor", "ThumbnailsConvertor", "EmbedThumbnail"}


class FileTooLarge(DownloadCancelled):
    msg = "file too large"


class ProxyBypass(DownloadCancelled):
    msg = "ffmpeg would bypass the proxy"


# --- yt-dlp options (pure functions, unit-tested) -------------------------------------------


def format_options(params: dict[str, Any], cover: bool = True) -> dict[str, Any]:
    """yt-dlp options selecting formats/post-processing for fmt/quality/bitrate.

    mp4 (no transcode):
      best    -> best H.264 + AAC/m4a (iPhone-friendly; 1080p max on YouTube)
      N       -> highest resolution <= N (short side), H.264 preferred at equal resolution;
                 above 1080p YouTube only has VP9/AV1, giving .mkv/.webm (or AV1 .mp4)
      worst   -> lowest resolution
    mp4 + transcode: same, except best = highest resolution up to 2160p whatever the codec;
    the result is re-encoded to H.264/AAC .mp4 afterwards (see transcode_to_h264).
    TikTok mp4: same ranking among muxed files, always delivered as H.264/AAC .mp4 (see _download).
    """
    fmt = params["fmt"]
    platform = params.get("platform")
    if fmt == "mp3":
        # TikTok exposes the post's attached "music track" as the only audio-only format:
        # take the audio of the muxed video instead (the soundtrack people actually hear).
        options: dict[str, Any] = {"format": "b/ba" if platform == "tiktok" else "ba/b", "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3",
             "preferredquality": str(params["bitrate"]), "nopostoverwrites": False},
            {"key": "FFmpegMetadata", "add_chapters": False, "add_metadata": True, "add_infojson": False},
        ]}
        if cover:
            options["writethumbnail"] = True
            options["postprocessors"].insert(0, {"key": "FFmpegThumbnailsConvertor", "format": "jpg",
                                                 "when": "before_dl"})
            options["postprocessors"].append({"key": "EmbedThumbnail", "already_have_thumbnail": False})
        return options
    if fmt == "gif":
        # Video only, small source: the GIF is scaled down to gif_width anyway.
        return {"format": "bv*/b", "format_sort": ["res:720", "vcodec:h264"]}

    quality = params["quality"]
    codec_prefs = ["vcodec:h264", "acodec:m4a"]
    if quality == "best":
        # With transcode, cap the source at 2160p: an 8K source would not fit in RAM for x264
        # and the H.264 result would not play on iPhones anyway.
        sort = ["res:2160", *codec_prefs] if params.get("transcode") else ["vcodec:h264", "res", "acodec:m4a"]
    elif quality == "worst":
        sort = ["+res", *codec_prefs]
    else:
        sort = [f"res:{quality}", *codec_prefs]
    if platform == "tiktok":
        # TikTok serves each post as muxed files (picture + the post's own sound) in HEVC ("bytevc1",
        # often the only 1080p) and in H.264 (often 720p), plus the attached "music track" alone
        # (mp3, no picture). yt-dlp's default ranking picks HEVC, which many players cannot decode
        # (Chrome/Edge without hardware HEVC, Windows without the HEVC extension): the .mp4 played
        # sound without picture. Muxed files first, ranked as on other sites (best: H.264 first);
        # a file that is not H.264 is re-encoded afterwards (see _download). The watermarked
        # "download" format has a lower extractor preference and only comes last.
        # Video-only + separate audio would be merged as MP3-in-MP4: convert audio to AAC.
        return {"format": "b/bv*+ba", "format_sort": sort, "merge_output_format": "mp4",
                "postprocessor_args": {"merger+ffmpeg_o": ["-c:a", "aac", "-b:a", "128k"]}}
    # Twitter/X: progressive mp4 variants already carry H.264+AAC (and their codecs are
    # unknown to yt-dlp), so prefer a single muxed file over HLS video+audio merges.
    selector = "b/bv*+ba" if platform == "twitter" else "bv*+ba/b"
    return {"format": selector, "format_sort": sort, "merge_output_format": "mp4/webm/mkv"}


def base_options(cfg: dict[str, Any], workdir: Path, platform: str, cookies_file: str | None = None) -> dict[str, Any]:
    # Fail closed: a platform without its own extractor list never runs yt-dlp. The former fallback (every default
    # extractor except generic) would have let SoundCloud, Bandcamp, Mixcloud, Audiomack... through had a domain been
    # added to ALLOWED_DOMAINS: stream ripping of music services (AUDIT cloud-music, 2026-10-23).
    if platform not in PLATFORM_EXTRACTORS:
        raise ApiError(400, "domain_not_allowed", "Plateforme non prise en charge.")
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": False,
        "noprogress": True,
        "verbose": cfg.get("log_level") == "DEBUG",
        "logger": _YdlLogger(),
        # Twitter/X needs playlist mode: multi-media posts are playlists and GIF posts fail
        # with noplaylist ("Media #1 is not a video"); the media is chosen with playlist_items.
        "noplaylist": platform != "twitter",
        "allowed_extractors": PLATFORM_EXTRACTORS[platform],
        "socket_timeout": 30,
        "retries": 3,
        "fragment_retries": 5,
        "extractor_retries": 2,
        "concurrent_fragment_downloads": 4,
        "paths": {"home": str(workdir), "temp": str(workdir)},
        "outtmpl": {"default": "%(id).80B.%(ext)s", "thumbnail": "%(id).80B.%(ext)s"},
        "restrictfilenames": True,
        "windowsfilenames": True,
        "overwrites": True,
        "max_filesize": cfg["max_filesize_bytes"],
        "cachedir": cfg.get("cache_dir") or False,
        "color": {"stdout": "no_color", "stderr": "no_color"},
        "extractor_args": copy.deepcopy(cfg.get("extractor_args") or {}),  # never the shared cfg
    }
    if platform != "twitter":
        # Never resolve playlist entries (a channel would mean one extraction per video);
        # playlists are rejected right after extraction anyway.
        opts["extract_flat"] = "in_playlist"
    if platform == "youtube" and cfg.get("yt_proxy"):
        opts["proxy"] = cfg["yt_proxy"]  # YouTube only (YT_PROXY); credentials masked by logging_setup.redact
        # yt-dlp's ffmpeg downloader ignores SOCKS proxies (direct connection): refuse it.
        opts["logger"].guard_proxy_bypass = not cfg["yt_proxy"].startswith("http://")
    else:
        opts["proxy"] = ""  # force direct: environment proxies (HTTP_PROXY...) never apply
    # Cookies are only ever sent for YouTube; the parent passes the file only when it validated it.
    cookies = cookies_file if platform == "youtube" else None
    if cookies:
        # yt-dlp rewrites the cookie jar on exit: work on a private, sanitised copy so the
        # read-only mounted original is never modified. A missing/unreadable file is ignored.
        jar = workdir / "cookies.txt"
        try:
            write_sanitized_cookies(Path(cookies), jar)
        except OSError as exc:
            log.warning("COOKIES_FILE set but not readable, ignoring it", extra={"reason": exc.strerror})
        else:
            opts["cookiefile"] = str(jar)
    if platform == "youtube":
        opts["extractor_args"] = youtube_extractor_args(cfg, cookies="cookiefile" in opts)
    return opts


def youtube_extractor_args(cfg: dict[str, Any], cookies: bool) -> dict[str, dict[str, list[str]]]:
    """yt-dlp extractor args of a YouTube task (a copy: the shared cfg is never modified).

    Without cookies, formats are asked to the YT_CLIENTS player clients (none needs a PO token) in
    one extraction, keeping the duplicate formats of each client: a stream refused by one client can
    then be fetched from another one without a new extraction (see _fetch). With cookies, yt-dlp's
    authenticated defaults are left alone (visionos does not support cookies). A player_client set by
    the admin in YTDLP_EXTRACTOR_ARGS always wins.
    """
    args = copy.deepcopy(cfg.get("extractor_args") or {})
    clients = list(cfg.get("yt_clients") or ())
    if cookies or not clients or "player_client" in (args.get("youtube") or {}):
        return args
    youtube = args.setdefault("youtube", {})
    youtube["player_client"] = clients
    formats = list(youtube.get("formats") or [])  # admin values (e.g. missing_pot) are kept
    if "duplicate" not in formats:
        formats.append("duplicate")
    youtube["formats"] = formats
    return args


def write_sanitized_cookies(source: Path, target: Path) -> None:
    """Copy a Netscape cookies file keeping only lines yt-dlp can load without complaining.

    yt-dlp prints malformed cookie lines (value included) to stderr and puts them in fatal
    error messages; dropping/normalising them here keeps cookie values out of the logs.
    """
    text = source.read_text(encoding="utf-8", errors="replace")
    lines = ["# Netscape HTTP Cookie File"]
    for line in text.splitlines()[1:]:
        httponly = line.startswith("#HttpOnly_")
        body = line[len("#HttpOnly_"):] if httponly else line
        if not body.strip() or body.startswith("#"):
            continue
        fields = body.split("\t")
        if len(fields) != 7 or not fields[0] or not EXPIRY_RE.fullmatch(fields[4]):
            continue
        fields[1] = "TRUE" if fields[0].startswith(".") else "FALSE"  # flag must match the leading dot
        lines.append(("#HttpOnly_" if httponly else "") + "\t".join(fields))
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


# --- YouTube player clients ---------------------------------------------------------------------


def player_clients(params: dict[str, Any]) -> tuple[str, ...]:
    """YouTube player clients asked to yt-dlp (options of the YoutubeDL), in preference order."""
    youtube = (params.get("extractor_args") or {}).get("youtube") or {}
    names = (str(c).strip().lower() for c in youtube.get("player_client") or ())
    return tuple(c for c in names if re.fullmatch(r"[a-z0-9_]+", c) and c not in ("default", "all"))


@functools.lru_cache(maxsize=8)
def _client_tables(preferred: tuple[str, ...]) -> tuple[frozenset[str], dict[str, str]]:
    """(short names of every known client, innertube client name -> short name).

    Several yt-dlp clients share an innertube name (web/web_safari, tv/tv_downgraded): the
    configured clients come first, then yt-dlp's own order."""
    names = list(dict.fromkeys([*preferred, *_YT_CLIENT_DEFS]))
    by_innertube: dict[str, str] = {}
    for name in names:
        context = (_YT_CLIENT_DEFS.get(name) or {}).get("INNERTUBE_CONTEXT") or {}
        innertube = (context.get("client") or {}).get("clientName")
        if innertube:
            by_innertube.setdefault(str(innertube).upper(), short_client_name(name))
    return frozenset(short_client_name(n) for n in names), by_innertube


def format_client(fmt: dict[str, Any], preferred: Sequence[str] = ()) -> str | None:
    """Short name of the YouTube player client of a format ('VISI', 'WEB-E'...), None if unknown.

    yt-dlp writes it last in format_note when duplicate formats are kept (or in verbose mode); the
    googlevideo URL also names the innertube client in its 'c' query parameter."""
    shorts, by_innertube = _client_tables(tuple(preferred))
    for token in reversed(re.split(r"[,\s]+", str(fmt.get("format_note") or ""))):
        if token in shorts:
            return token
    try:
        innertube = parse_qs(urlsplit(str(fmt.get("url") or "")).query).get("c")
    except ValueError:
        return None
    if not innertube:
        return None
    name = innertube[0].upper()
    return by_innertube.get(name, name)


def rank_youtube_formats(info: dict[str, Any], clients: Sequence[str]) -> None:
    """Among otherwise identical formats, prefer those of the first client (deterministic choice).

    With duplicate formats each itag comes once per client, and yt-dlp would break the tie on the
    format id. The offset only lowers source_preference by less than 1 in total, so yt-dlp's own
    penalties (MISSING POT -20, DRM -5, damaged formats...) still dominate. Unknown client: last.
    """
    if not clients:
        return
    ranks: dict[str, int] = {}
    for rank, client in enumerate(clients):
        ranks.setdefault(short_client_name(client), rank)
    step = 1 / (len(clients) + 1)
    for fmt in info.get("formats") or []:
        rank = ranks.get(format_client(fmt, clients) or "", len(clients))
        if rank:
            base = fmt.get("source_preference")
            fmt["source_preference"] = (-1 if base is None else base) - rank * step


def _has_pot(fmt: dict[str, Any]) -> bool:
    url = str(fmt.get("url") or "")
    return "pot=" in url or "/pot/" in url


def _is_http_403(exc: DownloadError) -> bool:
    cause = (getattr(exc, "exc_info", None) or (None, None))[1]
    return ("HTTP Error 403" in str(exc) or getattr(cause, "status", None) == 403
            or "HTTP Error 403" in str(cause or ""))


# --- logging bridge ---------------------------------------------------------------------------


class _YdlLogger:
    """Route yt-dlp messages to our JSON logger, keeping warnings for the job notes."""

    def __init__(self) -> None:
        self.warnings: list[str] = []
        self.too_large = False
        self.guard_proxy_bypass = False
        self._log = logging.getLogger("ytapi.yt_dlp")

    def debug(self, msg: str) -> None:
        if "larger than max-filesize" in msg:
            # yt-dlp aborts such downloads silently (no exception): remember it for a 413.
            self.too_large = True
        self._log.debug(msg)

    def info(self, msg: str) -> None:
        self._log.debug(msg)

    def warning(self, msg: str) -> None:
        text = clean_message(msg).removeprefix("WARNING: ")
        if self.guard_proxy_bypass and re.search(r"does not support SOCKS prox|delegated to ffmpeg", text, re.I):
            raise ProxyBypass()  # fail closed before ffmpeg connects directly
        if "cookie" in text.lower() and ("entry" in text.lower() or "\t" in text):
            text = "cookie file entry skipped (details hidden)"
        text = redact(text)  # these warnings also become job notes
        self.warnings.append(text)
        self._log.warning(text)

    def error(self, msg: str) -> None:
        text = clean_message(msg)
        self._log.error(hide_cookie_details(text))


# --- progress -----------------------------------------------------------------------------------


class Reporter:
    def __init__(self, conn: Connection) -> None:
        self.conn = conn
        self._last = 0.0
        self.band = (0.0, 100.0)  # current percent range for the active stage

    def send(self, stage: str, fraction: float | None = None, force: bool = False, **extra: Any) -> None:
        now = time.monotonic()
        if not force and now - self._last < 0.5:
            return
        self._last = now
        low, high = self.band
        percent = None if fraction is None else low + (high - low) * max(0.0, min(1.0, fraction))
        message: dict[str, Any] = {"type": "progress", "stage": stage, "percent": percent}
        message.update(extra)
        try:
            self.conn.send(message)
        except (BrokenPipeError, OSError):
            pass

    def extracted(self) -> None:
        try:
            self.conn.send({"type": "extracted"})
        except (BrokenPipeError, OSError):
            pass


class DownloadProgress:
    """yt-dlp progress hook: overall % over the 1-2 requested formats + file size guard."""

    def __init__(self, reporter: Reporter, max_bytes: int) -> None:
        self.reporter = reporter
        self.max_bytes = max_bytes
        self.expected: dict[str, float] = {}
        self.done: dict[str, float] = {}

    def plan(self, info: dict[str, Any]) -> None:
        parts = info.get("requested_formats") or [info]
        for part in parts:
            size = part.get("filesize") or part.get("filesize_approx") or 0
            self.expected[str(part.get("format_id"))] = float(size)

    def restart(self, info: dict[str, Any]) -> None:
        """New selection after a refused stream: the bytes of the failed attempt no longer count."""
        self.expected.clear()
        self.done.clear()
        self.plan(info)

    def __call__(self, d: dict[str, Any]) -> None:
        fmt_id = str((d.get("info_dict") or {}).get("format_id"))
        status = d.get("status")
        downloaded = float(d.get("downloaded_bytes") or 0)
        others = sum(v for k, v in self.done.items() if k != fmt_id)
        if status == "finished":
            size = downloaded or float(d.get("total_bytes") or 0)
            self.done[fmt_id] = size
            if size:
                self.expected[fmt_id] = size  # the real size replaces any estimate
        elif status == "downloading":
            self.done[fmt_id] = downloaded
            exact = float(d.get("total_bytes") or 0)
            if exact and exact + others > self.max_bytes:
                raise FileTooLarge()  # known up front: do not download 1.5 GB to find out
            if downloaded + others > self.max_bytes:
                raise FileTooLarge()
            latest = exact or float(d.get("total_bytes_estimate") or 0)
            if latest:
                self.expected[fmt_id] = latest
        expected = sum(self.expected.values())
        fraction = (sum(self.done.values()) / expected) if expected else None
        self.reporter.send("downloading", fraction, force=status == "finished")


class Attempt:
    """State shared between the two tries of an mp3 download (with, then without cover art)."""

    def __init__(self, info: dict[str, Any] | None = None, excluded_clients: set[str] | None = None) -> None:
        self.info = info  # extracted info to reuse: the retry must not contact the platform again
        self.running_pp: str | None = None  # post-processor running when an error is raised
        # YouTube clients whose streams were refused (HTTP 403): the cover retry skips them too.
        self.excluded_clients: set[str] = set(excluded_clients or ())


def postprocess_hook(progress: DownloadProgress, reporter: Reporter, attempt: Attempt | None = None) -> Any:
    """yt-dlp post-processor hook reporting the conversion stage.

    Pre-download post-processors (thumbnail conversion for the mp3 cover) run before any byte is
    downloaded: reporting them would pin the job at the top of the download band (80 %).
    """

    def hook(d: dict[str, Any]) -> None:
        if attempt is not None:
            attempt.running_pp = str(d.get("postprocessor")) if d.get("status") == "started" else None
        if not progress.done:
            return
        reporter.send(_STAGES.get(str(d.get("postprocessor")), "postprocessing"), 1.0,
                      force=d.get("status") == "started")

    return hook


# --- entry point --------------------------------------------------------------------------------


class _JobContext(logging.Filter):
    """Adds the job id to every record of the worker process (yt-dlp messages included)."""

    def __init__(self, job_id: str) -> None:
        super().__init__()
        self.job_id = job_id

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "job_id"):
            record.job_id = self.job_id
        return True


# "[youtube] <id>: " / "[TikTok] <id>: " (same rule as errors._IE_PREFIX_RE): no media id in the cause.
_CAUSE_PREFIX_RE = re.compile(r"^\[[^\]]+\]\s*[^:\s]*:\s*")
# Matches start at token boundaries only (lookbehinds) and the first class of the query pattern stops at
# the first "?": linear time on hostile messages (a long "?"/"." run made the old patterns cubic).
_CAUSE_URL_RES = (
    re.compile(r"(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*://[^\s'\"<>]+", re.I),  # scheme://...
    re.compile(r"(?<![^\s'\"<>])[^\s'\"<>?]*\?[^\s'\"<>]*=[^\s'\"<>]*"),  # path?query= (signed stream URLs)
)
# yt-dlp appends this generic hint to bot checks and login errors: it quotes no cookie, so it must not
# make the whole message look like a cookie-file error (which IS hidden: it may quote a cookie value).
_LOGIN_HINT_RE = re.compile(r"\s*\bUse --(?:cookies|username)\b.*$", re.I | re.S)


def hide_cookie_details(text: str) -> str:
    """The message without yt-dlp's login hint, or a placeholder if it still mentions cookies."""
    text = _LOGIN_HINT_RE.sub("", text)
    return "<cookie error, details hidden>" if re.search(r"cookie", text, re.I) else text


def error_cause(message: str) -> str:
    """Technical cause sent to the parent for its 'job failed' log: cleaned yt-dlp message, without the
    '[extractor] <id>:' prefix nor any URL, at most 300 characters. Never shown to the user."""
    text = hide_cookie_details(clean_message(message)[:2000])  # cut first: the patterns run on all of it
    text = _CAUSE_PREFIX_RE.sub("", text)
    for pattern in _CAUSE_URL_RES:
        text = pattern.sub("<url>", text)
    return redact(text)[:300]


def child_main(task: dict[str, Any], cfg: dict[str, Any], conn: Connection) -> None:
    os.setpgrp()  # own process group: the parent kills yt-dlp + ffmpeg together
    setup_logging(cfg.get("log_level", "INFO"))
    if task.get("job_id"):
        context = _JobContext(str(task["job_id"]))
        for handler in logging.getLogger().handlers:
            handler.addFilter(context)
    # http.cookiejar reports internal errors as warnings quoting the cookie line (value included).
    warnings.filterwarnings("ignore", message="http.cookiejar bug")
    reporter = Reporter(conn)
    workdir = Path(task["workdir"])
    try:
        if task["kind"] == "info":
            data = run_info(task, cfg, workdir)
        elif task["kind"] == "derive":
            if (task.get("params") or {}).get("tools"):
                from . import studio  # AETHRYON Tools: edits (ffmpeg only)

                data = studio.run_tools_derive(task, cfg, workdir, reporter)
            else:
                data = run_derive(task, cfg, workdir, reporter)
        elif task["kind"] == "upload":
            from . import studio

            data = studio.run_upload_check(task, cfg, workdir, reporter)
        elif task["kind"] == "assets":
            from . import studio

            data = studio.assets_task(task, cfg, workdir)
        else:
            data = run_download(task, cfg, workdir, reporter)
        conn.send({"type": "result", "data": data})
    except ApiError as exc:
        conn.send({"type": "error", "error": exc.to_dict()})
    except FileTooLarge:
        conn.send({"type": "error", "error": _too_large(cfg).to_dict()})
    except ProxyBypass:
        error = ApiError(502, "proxy_bypass", "Ce média passerait par ffmpeg, qui ignore le proxy SOCKS : "
                                              "téléchargement refusé (utilisez un proxy http:// ou retirez YT_PROXY).")
        conn.send({"type": "error", "error": error.to_dict()})
    except (DownloadError, ExtractorError) as exc:
        message = clean_message(str(exc))
        # Cookie loading errors quote the offending line, value included: never log them as-is.
        logged = hide_cookie_details(message)[:500]
        log.warning("yt-dlp error", extra={"platform": task["platform"], "ytdlp_error": logged})
        cause = (getattr(exc, "exc_info", None) or (None, None))[1]
        geo = isinstance(cause, GeoRestrictedError) or isinstance(exc, GeoRestrictedError)
        conn.send({"type": "error", "error": map_ytdlp_error(message, task["platform"], geo=geo).to_dict(),
                   "cause": error_cause(message)})
    except Exception as exc:
        log.exception("worker failure", extra={"platform": task["platform"]})
        conn.send({"type": "error", "error": ApiError(500, "internal_error", "Erreur interne du serveur (voir les logs).").to_dict(),
                   "cause": error_cause(f"{type(exc).__name__}: {exc}")})
    finally:
        # yt-dlp rewrote the private cookie copy (refreshed session) when it closed: drop it.
        (workdir / "cookies.txt").unlink(missing_ok=True)
        conn.close()


def _too_large(cfg: dict[str, Any]) -> ApiError:
    mb = cfg["max_filesize_bytes"] // (1024 * 1024)
    return ApiError(413, "too_large", f"Fichier plus gros que la limite de {mb} Mio (MAX_FILESIZE_MB).")


# --- extraction helpers ----------------------------------------------------------------------


def _extract(ydl: yt_dlp.YoutubeDL, url: str, platform: str,
             keep: Callable[[dict[str, Any]], bool] | None = None) -> dict[str, Any]:
    """Extract without download; reject playlists BEFORE any entry is processed.

    keep: formats kept before the selection (clips: only the streams that can be read by parts)."""
    if is_youtube_music_url(url):  # defence in depth: app.urls already refused it (owner's decision, 2026-10-23)
        raise youtube_music_error()
    raw = ydl.extract_info(url, download=False, process=False)
    if platform != "twitter":
        if raw.get("_type") in ("playlist", "multi_video"):
            raise _playlist_error()
        # watch?list= / embed/videoseries are first redirected (url result) to the playlist
        # extractors; resolving them would page through the whole playlist.
        if raw.get("_type") in ("url", "url_transparent") and raw.get("ie_key") in _PLAYLIST_IES:
            raise _playlist_error()
    if keep is not None:
        _keep_formats(raw, keep)
    if platform == "youtube":
        # Before yt-dlp sorts the formats: the first configured client wins among identical ones.
        rank_youtube_formats(raw, player_clients(getattr(ydl, "params", None) or {}))
    return ydl.process_ie_result(raw, download=False)


def _keep_formats(raw: dict[str, Any], keep: Callable[[dict[str, Any]], bool]) -> None:
    """Formats of the media (and of the entries of an X post) reduced to those `keep` accepts; none left: the
    clip cannot be fetched by parts (never a silent full download)."""
    from .extraits import partiel_impossible

    items = [raw] + [e for e in raw.get("entries") or [] if isinstance(e, dict)] \
        if isinstance(raw.get("entries"), list) else [raw]
    for item in items:
        formats = item.get("formats")
        if isinstance(formats, list) and formats:
            kept = [f for f in formats if isinstance(f, dict) and keep(f)]
            if not kept:
                raise partiel_impossible(
                    "Cette vidéo n'est proposée que sous une forme qui ne se découpe pas à distance (flux segmenté "
                    "sans index de temps, protégé ou en direct) : impossible de récupérer seulement l'extrait, et le "
                    "serveur ne télécharge jamais la vidéo entière pour un extrait.")
            item["formats"] = kept


_PLAYLIST_IES = {"YoutubeTab", "YoutubePlaylist", "YoutubeSearchURL", "YoutubeMusicSearchURL", "TikTokUser",
                  "TikTokCollection", "TikTokTag", "TikTokSound", "TikTokEffect"}


def _playlist_error() -> ApiError:
    return ApiError(400, "playlist_not_supported",
                    "Les playlists, chaînes et recherches ne sont pas prises en charge : envoyez le lien d'une vidéo.")


def _pick_entry(info: dict[str, Any], platform: str, index: int, index_from_url: bool = False) -> dict[str, Any]:
    """Resolve a playlist-like result to one media item (tweets with several media)."""
    if info.get("_type") not in ("playlist", "multi_video"):
        if index > 1 and not index_from_url:
            # yt-dlp ignores playlist_items on single-media posts: do not silently return #1.
            raise ApiError(404, "media_index_not_found", f"Ce post ne contient qu'un média : index={index} n'existe pas.")
        return info  # a /video/N link to a post with one video (plus photos) is unambiguous
    entries = [e for e in (info.get("entries") or []) if e]
    if platform != "twitter":
        raise _playlist_error()
    if not entries:
        # Out-of-range playlist_items gives an empty playlist, not an error.
        hint = (" Les liens X /video/N comptent aussi les photos, alors que index ne compte que les vidéos "
                "et GIF : passez index=K explicitement.") if index_from_url else ""
        raise ApiError(404, "media_index_not_found", f"Ce post n'a pas de vidéo/GIF n°{index}.{hint}")
    return entries[0]


def _check_common(info: dict[str, Any], cfg: dict[str, Any], platform: str, clip: bool = False) -> None:
    """clip: the length of the source does not matter (only the requested range is fetched)."""
    live = info.get("live_status")
    if info.get("is_live") or live in ("is_live", "is_upcoming"):
        raise ApiError(400, "live_not_supported", "Les directs et premières ne sont pas pris en charge.")
    if platform == "tiktok" and _is_tiktok_slideshow(info):
        raise ApiError(400, "unsupported_content", "Les diaporamas photo TikTok ne sont pas pris en charge (vidéos uniquement).")
    duration = info.get("duration")
    if not clip and duration and duration > cfg["max_duration_s"]:
        raise ApiError(413, "too_long",
                       f"Le média dure {int(duration)} s, la limite est de {cfg['max_duration_s']} s (MAX_DURATION_S).")


def _is_tiktok_slideshow(info: dict[str, Any]) -> bool:
    url = str(info.get("webpage_url") or info.get("original_url") or "")
    if "/photo/" in url:
        return True
    formats = info.get("formats") or []
    has_video = any((f.get("vcodec") or "none") != "none" for f in formats)
    return bool(formats) and not has_video


def _estimated_size(info: dict[str, Any]) -> int | None:
    parts = info.get("requested_formats") or [info]
    total = 0
    for part in parts:
        size = part.get("filesize") or part.get("filesize_approx")
        if not size:
            tbr, duration = part.get("tbr"), info.get("duration")
            if not (tbr and duration):
                return None
            size = tbr * 1000 / 8 * duration
        total += int(size)
    return total


def _selected_video_codec(info: dict[str, Any]) -> str:
    parts = info.get("requested_formats") or [info]
    vcodec = next((p.get("vcodec") for p in parts if p.get("vcodec") and p.get("vcodec") != "none"), None)
    return _codec_family(vcodec) if vcodec else "unknown"


# --- /info -------------------------------------------------------------------------------------


def run_info(task: dict[str, Any], cfg: dict[str, Any], workdir: Path) -> dict[str, Any]:
    platform = task["platform"]
    opts = base_options(cfg, workdir, platform, task.get("cookies_file")) | {"skip_download": True}
    opts["format"] = "bv*+ba/b"  # format selection needs a non-failing spec
    opts.pop("max_filesize", None)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.sanitize_info(_extract(ydl, task["url"], platform))
    if info.get("_type") in ("playlist", "multi_video"):
        entries = [e for e in (info.get("entries") or []) if e]
        if platform != "twitter":
            raise _playlist_error()
        items = [summarize(e, cfg, platform) | {"index": i} for i, e in enumerate(entries, start=1)]
        first = items[0] if items else {}
        return {
            "platform": platform,
            "id": info.get("id"),
            "title": info.get("title") or first.get("title"),
            "uploader": first.get("uploader"),
            "webpage_url": info.get("webpage_url"),
            "media_count": len(items),
            "entries": items,
            "note": "Post with several media: pass index=N (1-based, videos/GIFs only) to /dl or /jobs.",
        }
    return summarize(info, cfg, platform) | {"media_count": 1}


def summarize(info: dict[str, Any], cfg: dict[str, Any], platform: str) -> dict[str, Any]:
    formats = info.get("formats") or []
    duration = info.get("duration")

    def size_of(f: dict[str, Any]) -> int | None:
        size = f.get("filesize") or f.get("filesize_approx")
        if not size and f.get("tbr") and duration:
            size = f["tbr"] * 1000 / 8 * duration
        return int(size) if size else None

    audio = [f for f in formats if (f.get("vcodec") or "none") == "none" and (f.get("acodec") or "none") != "none"]
    best_audio = max(audio, key=lambda f: (f.get("abr") or f.get("tbr") or 0), default=None)
    best_audio_size = size_of(best_audio) if best_audio else None

    by_res: dict[int, dict[str, Any]] = {}
    for f in formats:
        vcodec = f.get("vcodec") or "none"
        if vcodec == "none" or not f.get("height"):
            continue
        res = min(int(f["height"]), int(f.get("width") or f["height"]))
        entry = by_res.setdefault(res, {"quality": res, "width": f.get("width"), "height": f.get("height"),
                                        "codecs": set(), "h264": False, "est_size_bytes": None, "fps": f.get("fps")})
        family = _codec_family(vcodec)
        entry["codecs"].add(family)
        entry["h264"] = entry["h264"] or family == "h264"
        video_size = size_of(f)
        if video_size:
            muxed = (f.get("acodec") or "none") != "none"
            total = video_size + (0 if muxed or not best_audio_size else best_audio_size)
            # Prefer the H.264 estimate (what /dl actually picks when available).
            if entry["est_size_bytes"] is None or family == "h264":
                entry["est_size_bytes"] = total
    qualities = []
    for res in sorted(by_res, reverse=True):
        entry = by_res[res]
        entry["codecs"] = sorted(entry["codecs"])
        qualities.append(entry)

    has_audio = bool(audio) or any((f.get("acodec") or "none") != "none" for f in formats)
    best_h264 = max((q["quality"] for q in qualities if q["h264"]), default=None)
    is_gif = _looks_like_gif(info, formats)
    return {
        "platform": platform,
        "id": info.get("id"),
        "title": info.get("title"),
        "uploader": info.get("uploader") or info.get("channel") or info.get("creator") or info.get("uploader_id"),
        "duration": duration,
        "thumbnail": info.get("thumbnail"),
        "webpage_url": info.get("webpage_url"),
        "extractor": info.get("extractor_key"),
        "live_status": info.get("live_status"),
        "is_gif": is_gif,
        "heights": sorted({int(f["height"]) for f in formats if f.get("height") and (f.get("vcodec") or "none") != "none"},
                          reverse=True),
        "qualities": qualities,
        "best_h264_quality": best_h264,
        "audio_only_available": has_audio and not is_gif,
        "est_size_bytes": {
            "audio_best": best_audio_size,
            **{f"mp3_{b}": int(b * 1000 / 8 * duration) for b in (128, 192, 320) if duration and has_audio},
        },
        "limits": {
            "too_long": bool(duration and duration > cfg["max_duration_s"]),
            "gif_allowed": bool(duration is None or duration <= cfg["gif_max_duration_s"]),
            "transcode_allowed": bool(duration is None or duration <= cfg["transcode_max_duration_s"]),
        },
    }


def _codec_family(vcodec: str) -> str:
    v = vcodec.lower()
    if v.startswith(H264_CODECS):
        return "h264"
    if v.startswith(("hev1", "hvc1", "h265", "hevc", "bytevc1")):
        return "h265"
    if v.startswith(("vp09", "vp9")):
        return "vp9"
    if v.startswith(("av01", "av1")):
        return "av1"
    return v.split(".")[0]


def _looks_like_gif(info: dict[str, Any], formats: list[dict[str, Any]] | None = None) -> bool:
    """Twitter/X 'GIFs' are silent looping mp4s; yt-dlp exposes no marker except the URL path."""
    if info.get("extractor_key") != "Twitter":
        return False
    urls = [str(f.get("url") or "") for f in (formats if formats is not None else info.get("formats") or [])]
    urls.append(str(info.get("url") or ""))
    return any("/tweet_video/" in u for u in urls) or "/tweet_video_thumb/" in str(info.get("thumbnail") or "")


# --- /dl and jobs ----------------------------------------------------------------------------


def run_download(task: dict[str, Any], cfg: dict[str, Any], workdir: Path, reporter: Reporter) -> dict[str, Any]:
    params = task["params"]
    if params.get("start_s") is not None and params.get("end_s") is not None:
        return run_clip(task, cfg, workdir, reporter)  # only the requested range is fetched (app/extraits.py)
    attempt = Attempt()
    try:
        return _download(task, cfg, workdir, reporter, cover=True, attempt=attempt)
    except DownloadError as exc:
        # Cover art is cosmetic: an undecodable thumbnail must not fail the mp3. Only a failure
        # inside a cover post-processor is retried, with the info already extracted (the retry
        # never contacts the platform again, so the YouTube limiter is not bypassed).
        if task["params"]["fmt"] == "mp3" and attempt.running_pp in _COVER_PPS and attempt.info is not None:
            message = clean_message(str(exc))
            log.warning("mp3 cover art failed, retrying without it", extra={"ytdlp_error": message[:300]})
            return _download(task, cfg, workdir, reporter, cover=False,
                             attempt=Attempt(attempt.info, attempt.excluded_clients))
        raise


# --- clips: only the requested range is fetched (app/extraits.py) ------------------------------------------------

# Public stages of a clip (CONTRAT-EXTRAITS: analyse, recuperation, conversion, finalisation) -> historical `stage`
# and band of the historical percentage (`progress`).
_CLIP_STAGES = {"analyse": ("extracting", (0.0, 5.0)), "recuperation": ("downloading", (5.0, 55.0)),
                "conversion": ("converting", (55.0, 97.0)), "finalisation": ("finalizing", (97.0, 99.0))}
CLIP_END_TOLERANCE_S = 1.0  # startMs/endMs: an end up to 1 s past the duration announced by the platform is accepted
CLIP_MAX_QUALITY = "1080"  # a clip is always re-encoded: its source is capped at 1080p


class ClipProgress:
    """Stage + measured progress of the current stage (None: not measurable) + bytes received, sent to the parent."""

    def __init__(self, reporter: Reporter) -> None:
        self.reporter = reporter
        self.counter: X.Compteur | None = None

    def stage(self, name: str, fraction: float | None = None, force: bool = False) -> None:
        """Throttled like every progress message (0,5 s), except a stage change and a completed stage (1.0)."""
        legacy, band = _CLIP_STAGES[name]
        force = force or fraction == 1.0
        self.reporter.band = band
        extra: dict[str, Any] = {"etape": name, "progression": None if fraction is None else round(fraction, 3)}
        if self.counter is not None:
            extra["octets"] = self.counter.total
        self.reporter.send(legacy, fraction, force=force, **extra)


def clip_format_options(params: dict[str, Any], platform: str) -> dict[str, Any]:
    """Format selection of a clip (no yt-dlp post-processing: the clip is cut and converted locally)."""
    fmt = params["fmt"]
    if fmt == "mp3":
        # Stéréo d'abord : le son 5.1 de YouTube (itag 258, 384 kbit/s) pèserait plus pour un MP3 stéréo.
        return {"format": "b/ba" if platform == "tiktok" else "ba/b", "format_sort": ["channels:2"]}
    if fmt == "gif":
        width = int(params.get("gif_width") or 480)
        res = 360 if width <= 640 else 480 if width <= 854 else 720
        return {"format": "bv*/b", "format_sort": [f"res:{res}", "vcodec:h264"]}
    quality = params.get("quality") or "best"
    if quality in ("2160", "1440"):
        quality = CLIP_MAX_QUALITY
    opts = format_options(params | {"platform": platform, "quality": quality, "transcode": False}, cover=False)
    if quality == "best":
        opts["format_sort"] = [f"res:{CLIP_MAX_QUALITY}", "vcodec:h264", "channels:2", "acodec:m4a"]
    elif "format_sort" in opts:
        opts["format_sort"] = [f for f in opts["format_sort"] if not f.startswith("acodec")] + ["channels:2",
                                                                                              "acodec:m4a"]
    return {key: opts[key] for key in ("format", "format_sort") if key in opts}


def clip_bounds(start: float, end: float, duration: float | None, strict: bool) -> tuple[float, float, str | None]:
    """Bounds of a clip against the duration of the source. strict (startMs/endMs, contract): 422 extrait_hors_source
    beyond the end (1 s of tolerance: platforms round durations); legacy start_s/end_s: end clamped, with a note."""
    if not duration:
        return start, end, None
    if strict:
        if start >= duration:
            raise X.hors_source(f"Le début demandé ({X.hms_ms(start)}) est après la fin de la vidéo "
                                f"({X.hms_ms(duration)}).")
        if end > duration + CLIP_END_TOLERANCE_S:
            raise X.hors_source(f"La fin demandée ({X.hms_ms(end)}) dépasse la durée de la vidéo ({X.hms_ms(duration)}).")
        return start, end, None
    if start >= duration - 0.05:
        raise _out_of_range(start, duration)
    note = f"La vidéo s'arrête à {_hms(duration)} : l'extrait va jusqu'à la fin." if end > duration + 0.5 else None
    return start, min(end, duration), note


def _impersonation(ydl: yt_dlp.YoutubeDL) -> Callable[[Any], dict[str, Any]]:
    def extensions(value: Any) -> dict[str, Any]:
        try:
            target, _ = ydl._parse_impersonate_targets(value)
        except Exception:  # noqa: BLE001 - yt-dlp internals moved: plain requests (as before the impersonation)
            return {}
        return {"impersonate": target} if target is not None else {}

    return extensions


def _wait_until_available(parts: list[X.Partie]) -> None:
    """YouTube may announce a short waiting time before its streams can be read (available_at), as yt-dlp does."""
    at = max((float(p.brut.get("available_at") or 0) for p in parts), default=0.0)
    if at - time.time() > 0:
        time.sleep(min(at - time.time(), 30.0))


def _clip_cover(ydl: yt_dlp.YoutubeDL, info: dict[str, Any], counter: X.Compteur, workdir: Path) -> Path | None:
    """Cover art of an MP3 clip (thumbnail of the media, <= 4 MiB, counted in the bytes received). None on failure."""
    url = info.get("thumbnail")
    if not isinstance(url, str) or not url.startswith("https://") or not X.hote_public(url):
        return None
    source, cover = workdir / "cover.src", workdir / "cover.jpg"
    try:
        counter.requete()
        response = X.ouvrir_ytdlp(ydl)(url, {}, {})
        try:
            with source.open("wb") as handle:
                read = X.lire(counter, response, handle.write, 4 * X.MIO + 1)
        finally:
            response.close()
        if read > 4 * X.MIO:
            return None
        out = subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", str(source),
                              "-frames:v", "1", "-vf", "scale='min(800,iw)':-2", str(cover)],
                             capture_output=True, timeout=60, check=False)
        return cover if out.returncode == 0 and cover.is_file() else None
    except (X.ErreurAmont, X.Depassement, OSError, subprocess.TimeoutExpired):
        return None
    finally:
        source.unlink(missing_ok=True)


def run_clip(task: dict[str, Any], cfg: dict[str, Any], workdir: Path, reporter: Reporter) -> dict[str, Any]:
    """Clip [start_s, end_s] of a media: extraction, partial fetch of the range only (never the whole file), then a
    precise local cut/conversion (app/extraits.py). Errors: extrait_hors_source / clip_out_of_range (bounds),
    extrait_partiel_impossible (no stream readable by parts, or the byte guard tripped), extrait_trop_lourd."""
    params = task["params"]
    platform = task["platform"]
    fmt = params["fmt"]
    start, end = float(params["start_s"]), float(params["end_s"])
    strict = params.get("startMs") is not None
    progress = ClipProgress(reporter)
    progress.stage("analyse", force=True)
    started = time.monotonic()
    opts = base_options(cfg, workdir, platform, task.get("cookies_file")) | clip_format_options(params, platform)
    opts.pop("max_filesize", None)
    if platform == "twitter":
        opts["playlist_items"] = str(params["index"])
    limit = int(cfg.get("extrait_telechargement_max_bytes") or 1024 * X.MIO)
    counter = X.Compteur(limit)
    progress.counter = counter
    notes: list[str] = []
    if fmt == "mp4" and str(params.get("quality")) in ("2160", "1440"):
        notes.append(f"Extrait limité à {CLIP_MAX_QUALITY}p (il est toujours réencodé en H.264).")
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = _extract(ydl, task["url"], platform, keep=X.format_partiel)
        info = _pick_entry(info, platform, int(params["index"]), bool(params.get("index_from_url")))
        _check_common(info, cfg, platform, clip=True)
        _check_request_limits(info, params | {"platform": platform}, cfg)
        source_duration = float(info["duration"]) if info.get("duration") else None
        start, end, note = clip_bounds(start, end, source_duration, strict)
        if note:
            notes.append(note)
        length = round(end - start, 3)
        reporter.extracted()  # the parent releases the YouTube limiter slot here
        clients = player_clients(ydl.params) if platform == "youtube" else ()
        snapshot = _pristine(info) if platform == "youtube" else None
        excluded: set[str] = set()
        cover: Path | None = None
        while True:
            parts = X.parties_de(info, _impersonation(ydl))
            if not all(X.format_partiel(p.brut) or (p.protocole in X.PROTOCOLES_PARTIELS and p.url) for p in parts):
                raise X.partiel_impossible("Le format choisi pour cette vidéo ne se lit pas par morceaux : impossible "
                                           "de récupérer seulement l'extrait.")
            plan = X.Plan(fmt, start, length, parts)
            window_s = plan.fenetre[1]
            estimate = X.estimation_fenetre([p for p in parts if not (fmt == "gif" and not p.video)
                                             and not (fmt == "mp3" and not p.audio)], window_s)
            if estimate and estimate > limit:
                raise ApiError(413, "extrait_trop_lourd",
                               f"Ce passage pèse environ {X.mo(estimate)} dans la qualité choisie, au-delà de la limite "
                               f"de {X.mo(limit)} par extrait : choisis un passage plus court ou une qualité plus basse.")
            counter.budget = min(limit, counter.total + X.budget_pour(estimate, limit))
            log.info("clip plan", extra={
                "fmt": fmt, "start_s": start, "length_s": length, "window_s": round(window_s, 3),
                "protocols": [p.protocole for p in parts], "format_ids": [p.format_id for p in parts],
                "estimate_bytes": estimate, "budget_bytes": counter.budget, "source_duration_s": source_duration,
                "clients": [format_client(p.brut, clients) or "?" for p in parts] if clients else None})
            _wait_until_available(parts)
            progress.stage("recuperation", 0.0, force=True)
            with X.Relais(X.ouvrir_ytdlp(ydl), counter, autoriser_prive=X.AUTORISER_PRIVE) as relay:
                try:
                    windows = X.recuperer(plan, relay, workdir, lambda f: progress.stage("recuperation", f),
                                          source_duration)
                except X.Depassement:
                    log.warning("clip byte guard tripped", extra={"reason": counter.raison, "bytes": counter.total,
                                                                  "budget": counter.budget, "limit": counter.limite})
                    raise X.erreur_depassement(counter) from None
                except ApiError as exc:
                    error = X.erreur_amont(relay, platform) or exc
                    refused = X.refus_403(relay)
                    if not refused or snapshot is None:
                        raise error from None
                    refused_clients = {format_client(parts[i].brut, clients) for i in refused if i < len(parts)}
                    if None in refused_clients or refused_clients <= excluded:
                        raise error from None
                    excluded |= {c for c in refused_clients if c}
                    selected = _reselect(ydl, snapshot, excluded, clients, params | {"platform": platform}, cfg)
                    if selected is None:
                        raise error from None
                    log.warning("youtube stream refused, trying another client", extra={
                        "failed_clients": sorted(excluded), "format_ids": [p.format_id for p in parts]})
                    info = selected
                    for leftover in workdir.glob("fenetre*"):
                        leftover.unlink(missing_ok=True)
                    continue
                requests_log = list(relay.journal)
            if fmt == "mp3":
                cover = _clip_cover(ydl, info, counter, workdir)
            break
        logger: _YdlLogger = ydl.params["logger"]
    fetched_s = round(time.monotonic() - started, 2)
    log.info("clip fetched", extra={"bytes": counter.total, "requests": counter.requetes, "seconds": fetched_s,
                                    "announced_bytes": counter.annonces})

    progress.stage("conversion", 0.0, force=True)
    video = next((w for w in windows if w.video), None)
    sound = next((w for w in windows if w.audio), None)
    out_max = int(cfg.get("extrait_sortie_max_bytes") or cfg["max_filesize_bytes"])
    target = workdir / f"extrait.{fmt}"

    def converting(fraction: float | None) -> None:
        progress.stage("conversion", fraction)

    if fmt == "mp4":
        if video is None:
            raise ApiError(422, "format_unavailable",
                           "Le passage récupéré ne contient aucune image (son seul) : aucun MP4 n'est fourni.")
        X.convertir_mp4(video, sound, start, length, target, cpu_limit(), out_max, converting)
    elif fmt == "mp3":
        if sound is None:
            raise ApiError(400, "no_audio", "Ce média n'a pas de piste son : extrait MP3 impossible.")
        uploader = info.get("uploader") or info.get("channel") or info.get("creator")
        if not X.convertir_mp3(sound, start, length, target, int(params.get("bitrate") or 192), info.get("title"),
                               uploader, cover, converting):
            notes.append("La pochette n'a pas pu être intégrée.")
    else:
        if video is None:
            raise ApiError(422, "format_unavailable", "Le passage récupéré ne contient aucune image : GIF impossible.")
        X.convertir_gif(video, start, length, target, int(params.get("gif_width") or 480),
                        int(params.get("gif_fps") or 15), converting)
    progress.stage("finalisation", force=True)
    for leftover in workdir.glob("fenetre*"):
        leftover.unlink(missing_ok=True)
    if cover is not None:
        cover.unlink(missing_ok=True)
    size = target.stat().st_size if target.is_file() else 0
    if size == 0:
        raise ApiError(500, "conversion_failed", "La conversion de l'extrait n'a produit aucun fichier.")
    if size >= out_max * 0.995:
        raise ApiError(413, "too_large", f"L'extrait obtenu dépasse la taille maximale de {X.mo(out_max)} : choisis un "
                                         "passage plus court ou une qualité plus basse.")
    if fmt == "mp4":
        check_video_track(target, h264=True)
    got = _duration_of(probe(target))
    if got is not None and got < length - 1.0:
        seconds = f"{got:.1f}".replace(".", ",")
        notes.append(f"L'extrait obtenu dure {seconds} s : la vidéo s'arrête avant la fin demandée.")
    title = info.get("title")
    named = f"{title or 'media'} (extrait {_hms(start)}-{_hms(end)})"
    full_sizes = [p.taille for p in parts]
    return {
        "filepath": str(target),
        "download_name": build_download_name(named, info.get("id"), fmt),
        "media_type": MEDIA_TYPES.get(fmt, "application/octet-stream"),
        "title": title,
        "id": info.get("id"),
        "ext": fmt,
        "size": size,
        "notes": notes + [w for w in logger.warnings if "ffmpeg" not in w.lower()][:5],
        "extrait": {
            "debutMs": int(round(start * 1000)), "finMs": int(round(end * 1000)), "dureeMs": int(round(length * 1000)),
            "methode": "partielle", "protocoles": sorted({p.protocole for p in parts}),
            "octetsTelecharges": counter.total, "octetsAnnonces": counter.annonces,
            "octetsSourceComplete": sum(full_sizes) if all(full_sizes) else None,  # type: ignore[arg-type]
            "requetes": counter.requetes, "dureeSourceS": source_duration, "recuperationS": fetched_s,
        },
        "requests_log": requests_log[:200],
    }


def _download(task: dict[str, Any], cfg: dict[str, Any], workdir: Path, reporter: Reporter,
              cover: bool, attempt: Attempt | None = None) -> dict[str, Any]:
    attempt = attempt or Attempt()
    params = task["params"]
    platform = task["platform"]
    fmt = params["fmt"]
    # A TikTok .mp4 is always H.264: its HEVC files show no picture in many players (format_options).
    h264_only = fmt == "mp4" and (bool(params.get("transcode")) or platform == "tiktok")
    clip = params.get("start_s") is not None and params.get("end_s") is not None
    needs_conversion = fmt in ("gif", "mp3") or h264_only or clip
    reporter.band = (0.0, 80.0 if needs_conversion else 97.0)
    reporter.send("extracting", 0.0, force=True)

    progress = DownloadProgress(reporter, cfg["max_filesize_bytes"])
    opts = base_options(cfg, workdir, platform, task.get("cookies_file")) | format_options(
        params | {"platform": platform}, cover=cover)
    opts["progress_hooks"] = [progress]
    if platform == "twitter":
        opts["playlist_items"] = str(params["index"])

    with yt_dlp.YoutubeDL(opts) as ydl:
        # Registered after construction: passing postprocessor_hooks in the options would
        # attach every hook twice.
        ydl.add_postprocessor_hook(postprocess_hook(progress, reporter, attempt))
        if attempt.info is not None:
            info = attempt.info  # cover retry: already extracted and checked
        else:
            info = _extract(ydl, task["url"], platform)
            info = _pick_entry(info, platform, int(params["index"]), bool(params.get("index_from_url")))
            _check_common(info, cfg, platform)
            _check_selection(info, params | {"platform": platform}, cfg)
            if fmt == "mp3" and cover:
                attempt.info = _pristine(info)
        progress.plan(info)
        reporter.extracted()  # the parent releases the YouTube limiter slot here
        reporter.send("downloading", 0.0, force=True)
        result, info = _fetch(ydl, info, task, cfg, workdir, progress, attempt)
        video_codec = _selected_video_codec(info)
        logger: _YdlLogger = ydl.params["logger"]

    downloads = result.get("requested_downloads") or []
    filepath = Path(downloads[-1]["filepath"]) if downloads and downloads[-1].get("filepath") else None
    if filepath is None or not filepath.is_file():
        if logger.too_large:
            raise _too_large(cfg)
        raise ApiError(502, "download_failed", "Le téléchargement n'a produit aucun fichier.")

    notes: list[str] = []
    reporter.band = (80.0, 99.0)
    if fmt == "gif":
        filepath = make_gif(filepath, workdir, params, cfg, reporter)
    elif clip:
        # The extract is re-encoded (H.264/AAC or MP3): no separate transcode/remux step.
        filepath, clip_notes = cut_clip(filepath, workdir, params, reporter)
        notes.extend(clip_notes)
        h264_only = fmt == "mp4"
    elif h264_only:
        filepath, transcode_note = transcode_to_h264(filepath, workdir, reporter)
        if transcode_note:
            notes.append(transcode_note)
    elif fmt == "mp4" and video_codec not in (*IPHONE_VIDEO_CODECS, "unknown"):
        notes.append(f"Pas de H.264/HEVC à cette qualité : vidéo {video_codec.upper()} en "
                     f".{filepath.suffix.lstrip('.')}, que Photos refuse en général. "
                     "Utilisez transcode=true (ou quality<=1080) pour un .mp4 compatible iPhone.")
    elif fmt == "mp4" and video_codec in ("h265", "unknown"):
        filepath = hevc_to_hvc1(filepath, workdir, reporter)
    if fmt == "mp4":
        check_video_track(filepath, h264=h264_only)
    if fmt == "mp3" and not cover:
        notes.append("La pochette n'a pas pu être intégrée.")

    ext = filepath.suffix.lstrip(".").lower()
    size = filepath.stat().st_size
    if size > cfg["max_filesize_bytes"]:
        raise _too_large(cfg)
    reporter.send("finalizing", 1.0, force=True)
    title = result.get("title") or info.get("title")
    named = f"{title or 'media'} (extrait {_hms(params['start_s'])}-{_hms(params['end_s'])})" if clip else title
    return {
        "filepath": str(filepath),
        "download_name": build_download_name(named, result.get("id"), ext),
        "media_type": MEDIA_TYPES.get(ext, "application/octet-stream"),
        "title": result.get("title"),
        "id": result.get("id"),
        "ext": ext,
        "size": size,
        "notes": notes + [w for w in logger.warnings if "ffmpeg" not in w.lower()][:5],
    }


def _fetch(ydl: yt_dlp.YoutubeDL, info: dict[str, Any], task: dict[str, Any], cfg: dict[str, Any],
           workdir: Path, progress: DownloadProgress, attempt: Attempt) -> tuple[dict[str, Any], dict[str, Any]]:
    """Download the selected formats; returns (yt-dlp result, info of the selection downloaded).

    YouTube: when the media server refuses a stream (HTTP 403), the formats of the client(s) of the
    refused selection are set aside and the best remaining combination (same format spec and sort)
    is downloaded. Selection only: no new extraction, so the parent's YouTube limiter (released after
    the extraction) is never bypassed. Other errors are never retried; once every client has been
    refused, the last 403 is raised (upstream_forbidden).
    """
    if task["platform"] != "youtube":
        return ydl.process_ie_result(info, download=True), info
    clients = player_clients(ydl.params)
    snapshot = _pristine(info)  # selection made at extraction time, before the download mutates it
    tries = 1
    if attempt.excluded_clients and snapshot is not None:
        # mp3 cover retry after a fallback: start again without the clients already refused.
        info = _reselect(ydl, snapshot, attempt.excluded_clients, clients, task["params"], cfg) or info
        progress.restart(info)
    while True:
        parts = info.get("requested_formats") or [info]
        log.info("youtube formats selected", extra={
            "format_ids": [str(p.get("format_id")) for p in parts],
            "clients": [format_client(p, clients) or "?" for p in parts],
            "pot_present": any(_has_pot(p) for p in parts), "attempt": tries})
        try:
            return ydl.process_ie_result(info, download=True), info
        except DownloadError as exc:
            if snapshot is None or not _is_http_403(exc):
                raise
            refused = {format_client(p, clients) for p in _refused_parts(workdir, parts)}
            if None in refused or refused <= attempt.excluded_clients:
                raise  # client unknown or already set aside: nothing reliable to exclude
            attempt.excluded_clients |= {c for c in refused if c}
            _remove_partials(workdir, parts)
            selected = _reselect(ydl, snapshot, attempt.excluded_clients, clients, task["params"], cfg)
            if selected is None:
                raise
        tries += 1
        info = selected
        parts = info.get("requested_formats") or [info]
        log.warning("youtube stream refused, trying another client", extra={
            "attempt": tries, "failed_clients": sorted(attempt.excluded_clients),
            "format_ids": [str(p.get("format_id")) for p in parts],
            "next_clients": [format_client(p, clients) or "?" for p in parts]})
        progress.restart(info)


def _refused_parts(workdir: Path, parts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The part(s) a 403 is blamed on. yt-dlp fetches the parts of a merge in order and keeps each
    finished one as <name>.f<format_id>.<ext>: the first part without such a file is the refused one,
    so the client of a part that downloaded fine stays usable. If that cannot be told, all parts."""
    if len(parts) > 1:
        names = [f.name for f in workdir.iterdir()] if workdir.is_dir() else []
        for part in parts:
            marker = f".f{part.get('format_id')}."
            finished = [n for n in names if marker in n and not n.endswith((".part", ".ytdl")) and ".part-Frag" not in n]
            if not finished:
                return [part]
    return parts


# Top-level keys of the previous selection that a new selection does not always overwrite.
_SELECTION_KEYS = ("requested_formats", "requested_downloads", "url", "manifest_url", "fragments",
                   "fragment_base_url", "downloader_options")


def _reselect(ydl: yt_dlp.YoutubeDL, snapshot: dict[str, Any], excluded: set[str], clients: Sequence[str],
              params: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any] | None:
    """Selection among the formats of the clients not refused yet (None: nothing usable left).

    The new selection must bring the same kinds of streams (an mp3 never falls back to a video-only
    format, which yt-dlp's "b" would accept when no format has both); same checks as after the
    extraction (size estimate, transcode limit)."""
    candidate = _pristine(snapshot)
    if candidate is None:
        return None
    formats = [f for f in candidate.get("formats") or [] if format_client(f, clients) not in excluded]
    if not any((f.get("vcodec") or "none") != "none" or (f.get("acodec") or "none") != "none" for f in formats):
        return None  # storyboards only
    for key in _SELECTION_KEYS:
        candidate.pop(key, None)
    candidate["formats"] = formats
    try:
        selected = ydl.process_ie_result(candidate, download=False)
    except (DownloadError, ExtractorError) as exc:  # e.g. no format left matching the spec
        log.info("no other youtube selection", extra={"reason": error_cause(str(exc))})
        return None
    if not _stream_kinds(snapshot) <= _stream_kinds(selected):
        log.info("no other youtube selection", extra={"reason": "missing audio or video streams"})
        return None
    _check_selection(selected, params, cfg)
    return selected


def _stream_kinds(info: dict[str, Any]) -> set[str]:
    kinds = set()
    for part in info.get("requested_formats") or [info]:
        if (part.get("vcodec") or "none") != "none":
            kinds.add("video")
        if (part.get("acodec") or "none") != "none":
            kinds.add("audio")
    return kinds


def _remove_partials(workdir: Path, parts: list[dict[str, Any]]) -> None:
    """Remove what a refused attempt left in the job directory (never the cover art or cookies)."""
    markers = tuple(f".f{p.get('format_id')}." for p in parts if p.get("format_id"))
    for path in workdir.iterdir():
        name = path.name
        partial = name.endswith((".part", ".ytdl")) or ".part-Frag" in name
        if (partial or any(m in name for m in markers)) and path.is_file():
            path.unlink(missing_ok=True)


def _pristine(info: dict[str, Any]) -> dict[str, Any] | None:
    """Copy of the extracted info before the download mutates it (None if it cannot be copied).

    Lazy fragment lists (YouTube "dashy" formats, kept with formats=duplicate) wrap a generator that
    deepcopy refuses: they are materialised first (computed locally, no request)."""
    try:
        for fmt in (info, *(info.get("formats") or []), *(info.get("requested_formats") or [])):
            if isinstance(fmt.get("fragments"), LazyList):
                fmt["fragments"].exhaust()
        return copy.deepcopy(info)
    except Exception:
        log.warning("extracted info cannot be copied: no retry possible", exc_info=True)
        return None


def _check_selection(info: dict[str, Any], params: dict[str, Any], cfg: dict[str, Any]) -> None:
    """Limits that depend on the formats selected (checked again after a YouTube client fallback)."""
    _check_request_limits(info, params, cfg)
    if _is_clip(params):
        return  # a clip never downloads the whole file: its weight is bounded by the partial fetch (app/extraits.py)
    estimate = _estimated_size(info)
    if estimate and estimate > cfg["max_filesize_bytes"]:
        raise _too_large(cfg)


def _is_clip(params: dict[str, Any]) -> bool:
    return params.get("start_s") is not None and params.get("end_s") is not None


def _check_request_limits(info: dict[str, Any], params: dict[str, Any], cfg: dict[str, Any]) -> None:
    duration = info.get("duration")
    if params["fmt"] == "mp3" and _looks_like_gif(info):
        raise ApiError(400, "no_audio", "C'est un GIF (vidéo muette) : mp3 impossible, utilisez fmt=gif ou fmt=mp4.")
    if _is_clip(params):
        return  # bounds checked by run_clip; the length of the source does not matter for a clip
    if params["fmt"] == "gif" and duration and duration > cfg["gif_max_duration_s"]:
        raise ApiError(413, "gif_too_long",
                       f"Le GIF est limité à {cfg['gif_max_duration_s']} s, ce média dure {int(duration)} s.")
    tiktok = params.get("platform") == "tiktok"
    if params["fmt"] == "mp4" and (params.get("transcode") or tiktok) and duration:
        if _selected_video_codec(info) != "h264" and duration > cfg["transcode_max_duration_s"]:
            hint = ("TikTok ne propose cette vidéo qu'en HEVC à cette qualité : essayez une autre qualité."
                    if tiktok and not params.get("transcode")
                    else "Baissez la qualité (<= 1080) ou mettez transcode=false.")
            raise ApiError(413, "transcode_too_long",
                           f"Le réencodage est limité à {cfg['transcode_max_duration_s']} s de média "
                           f"(TRANSCODE_MAX_DURATION_S), celui-ci dure {int(duration)} s. {hint}")


# --- ffmpeg ------------------------------------------------------------------------------------


def probe(path: Path) -> dict[str, Any]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", "--", str(path)],
        capture_output=True, encoding="utf-8", errors="replace", timeout=60, check=False,
    )
    if out.returncode != 0:
        log.error("ffprobe failed", extra={"returncode": out.returncode, "stderr": out.stderr[-1500:]})
        raise ApiError(500, "conversion_failed", "Impossible de lire le média téléchargé.")
    try:
        return json.loads(out.stdout or "{}")
    except ValueError:
        log.error("ffprobe output is not JSON", extra={"stdout": out.stdout[:500]})
        raise ApiError(500, "conversion_failed", "Impossible de lire le média téléchargé.") from None


def _duration_of(meta: dict[str, Any]) -> float | None:
    try:
        return float(meta.get("format", {}).get("duration"))
    except (TypeError, ValueError):
        return None


def check_video_track(path: Path, h264: bool = False) -> dict[str, Any]:
    """Refuse a video without a picture: never deliver as a success an .mp4 that only plays sound.

    The file must hold a video track (ffprobe lists cover art as a video stream with the attached_pic
    disposition: an audio file with a cover is still audio only) with a size and a duration, and
    ffmpeg must decode frames of it at the start and in the middle. h264: the track must also be
    H.264 (TikTok, transcode=true). Returns what was measured.
    """
    meta = probe(path)
    streams = meta.get("streams") or []
    found = [f"{s.get('codec_type')}:{s.get('codec_name')}" for s in streams]
    video = next((s for s in streams if s.get("codec_type") == "video"
                  and not (s.get("disposition") or {}).get("attached_pic")), None)
    if video is None:
        log.error("video file without a video track", extra={"streams": found})
        raise ApiError(422, "format_unavailable",
                       "Le fichier obtenu ne contient aucune piste vidéo (son seul) : aucun MP4 n'est fourni.")
    duration = _duration_of(meta) or 0.0
    checked: dict[str, Any] = {"codec": video.get("codec_name"), "width": int(video.get("width") or 0),
                               "height": int(video.get("height") or 0), "duration": round(duration, 2)}
    if checked["width"] <= 0 or checked["height"] <= 0 or duration <= 0:
        log.error("invalid video track", extra={"streams": found, **checked})
        raise ApiError(500, "conversion_failed",
                       "La piste vidéo obtenue est invalide (taille ou durée nulle) : aucun MP4 n'est fourni.")
    if h264 and checked["codec"] != "h264":
        log.error("video track is not H.264", extra={"streams": found, **checked})
        raise ApiError(500, "conversion_failed",
                       f"La vidéo obtenue est en {checked['codec']}, pas en H.264 : aucun MP4 n'est fourni.")
    stream = f"0:{video.get('index', 'v:0')}"
    checked["frames"] = _decoded_frames(path, stream, 0.0, 5)
    checked["middle_frames"] = _decoded_frames(path, stream, duration / 2, 3) if duration >= 2 else checked["frames"]
    if not checked["frames"] or not checked["middle_frames"]:
        log.error("video track cannot be decoded", extra={"streams": found, **checked})
        raise ApiError(500, "conversion_failed", "La piste vidéo obtenue ne se décode pas : aucun MP4 n'est fourni.")
    log.info("video track checked", extra={"streams": found, **checked})
    return checked


def _decoded_frames(path: Path, stream: str, start: float, count: int) -> int:
    """Frames of a video stream that ffmpeg decodes from `start` (at most count, 10 s of input read)."""
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", "10",
           "-i", str(path), "-map", stream, "-frames:v", str(count), "-f", "framemd5", "-"]
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=120, check=False)
    except subprocess.TimeoutExpired:
        log.error("ffmpeg decode check timed out", extra={"start": start})
        return 0
    frames = sum(1 for line in out.stdout.decode("ascii", "replace").splitlines() if line and not line.startswith("#"))
    if out.returncode != 0 or not frames:
        log.warning("ffmpeg decode check failed", extra={"start": start, "returncode": out.returncode,
                                                         "stderr": out.stderr.decode("utf-8", "replace")[-1500:]})
    return frames


def cpu_limit() -> int:
    """CPUs granted to the container (cgroup v2 cpu.max), not the host's core count."""
    try:
        quota, period = Path("/sys/fs/cgroup/cpu.max").read_text().split()[:2]
        if quota != "max":
            return max(1, round(int(quota) / int(period)))
    except (OSError, ValueError):
        pass
    return os.cpu_count() or 2


def run_ffmpeg(args: list[str], duration: float | None, reporter: Reporter, stage: str) -> None:
    """Run ffmpeg (argument list, never a shell) and report progress from -progress output.

    stderr goes to a temp file: a PIPE nobody reads would block ffmpeg once it fills (64 KB).
    """
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-progress", "pipe:1", "-nostats", *args]
    with tempfile.TemporaryFile() as err:  # binary: ffmpeg may print non-UTF-8 bytes
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=err)
        assert proc.stdout is not None
        for raw in proc.stdout:
            key, _, value = raw.decode("utf-8", "replace").strip().partition("=")
            if key == "out_time_us" and duration and value.isdigit():
                reporter.send(stage, int(value) / 1e6 / duration)
        if proc.wait() != 0:
            err.seek(0, os.SEEK_END)
            err.seek(max(0, err.tell() - 1500))
            tail = err.read().decode("utf-8", "replace")
            log.error("ffmpeg failed", extra={"stage": stage, "stderr": tail})
            raise ApiError(500, "conversion_failed", f"La conversion ffmpeg a échoué ({stage}).")


def make_gif(source: Path, workdir: Path, params: dict[str, Any], cfg: dict[str, Any], reporter: Reporter) -> Path:
    meta = probe(source)
    duration = _duration_of(meta)
    limit = cfg["gif_max_duration_s"]
    if duration and duration > limit + 0.5:
        raise ApiError(413, "gif_too_long", f"Le GIF est limité à {limit} s, ce média dure {int(duration)} s.")
    width, fps = int(params["gif_width"]), int(params["gif_fps"])
    scale = f"fps={fps},scale='min({width},iw)':-1:flags=lanczos"
    palette = workdir / "palette.png"
    target = source.with_suffix(".gif")
    reporter.band = (80.0, 88.0)
    run_ffmpeg(["-t", str(limit), "-i", str(source), "-vf", f"{scale},palettegen=stats_mode=diff", "-update", "1",
                "-frames:v", "1", str(palette)], duration, reporter, "gif:palette")
    reporter.band = (88.0, 99.0)
    run_ffmpeg(["-t", str(limit), "-i", str(source), "-i", str(palette), "-lavfi",
                f"{scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
                "-loop", "0", str(target)], duration, reporter, "gif:encode")
    source.unlink(missing_ok=True)
    palette.unlink(missing_ok=True)
    return target


def hevc_to_hvc1(source: Path, workdir: Path, reporter: Reporter) -> Path:
    """HEVC tagged 'hev1' -> 'hvc1' by a lossless remux: Photos on iPhone refuses hev1 files."""
    if source.suffix.lower() not in (".mp4", ".m4v", ".mov"):
        return source
    meta = probe(source)
    video = next((s for s in meta.get("streams") or [] if s.get("codec_type") == "video"), None)
    if not video or video.get("codec_name") != "hevc" or video.get("codec_tag_string") != "hev1":
        return source
    target = workdir / f"{source.stem}.hvc1{source.suffix}"
    run_ffmpeg(["-i", str(source), "-map", "0:v:0", "-map", "0:a?", "-c", "copy", "-tag:v", "hvc1",
                "-movflags", "+faststart", str(target)], _duration_of(meta), reporter, "remuxing")
    source.unlink(missing_ok=True)
    target.rename(source)
    return source


def transcode_to_h264(source: Path, workdir: Path, reporter: Reporter) -> tuple[Path, str | None]:
    """Re-encode to H.264/AAC .mp4 when needed (copy streams that are already compatible)."""
    meta = probe(source)
    streams = meta.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    v_ok = video is None or video.get("codec_name") == "h264"
    a_ok = audio is None or audio.get("codec_name") == "aac"
    if v_ok and a_ok and source.suffix.lower() == ".mp4":
        return source, None
    target = workdir / f"{source.stem}.h264.mp4"
    args = ["-i", str(source), "-map", "0:v:0?", "-map", "0:a:0?"]
    if v_ok:
        args += ["-c:v", "copy"]
    else:
        # yuv420p needs even dimensions (VP9/AV1/HEVC allow odd ones); bounded threads keep
        # x264's memory (lookahead buffers grow with threads) inside the container limit.
        args += ["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", "veryfast",
                 "-crf", "21", "-pix_fmt", "yuv420p", "-profile:v", "high", "-threads", str(cpu_limit())]
    args += ["-c:a", "copy"] if a_ok else ["-c:a", "aac", "-b:a", "192k"]
    args += ["-movflags", "+faststart", str(target)]
    run_ffmpeg(args, _duration_of(meta), reporter, "transcoding" if not v_ok else "remuxing")
    source.unlink(missing_ok=True)
    final = workdir / f"{source.stem.removesuffix('.h264')}.mp4"
    target.rename(final)
    note = None if v_ok else f"Vidéo {video.get('codec_name') if video else '?'} réencodée en H.264."
    return final, note


# --- clips and derived files (MEDIA_TOOLS_ENABLED) ----------------------------------------------

MIB = 1024 * 1024
# Short side of the picture tried by the compression, largest first (only ever scaled down).
COMPRESS_SIDES = (1080, 720, 540, 480, 360, 240)
# Below this many bits per pixel, x264 (veryfast) turns to mush: the picture is made smaller instead.
COMPRESS_MIN_BPP = 0.045
COMPRESS_MIN_VIDEO_KBPS = 80
GIF_MIN_WIDTH = 160
GIF_MIN_FPS = 8


def _mib(size: int | float) -> str:
    """10 Mio, 1,2 Mio (French decimal comma)."""
    value = float(size) / MIB
    return f"{value:.0f} Mio" if abs(value - round(value)) < 0.05 else f"{value:.1f} Mio".replace(".", ",")


def _hms(seconds: float) -> str:
    """15s, 1m05s, 1h02m03s: readable in a file name (no colon, forbidden on Windows and iOS)."""
    total = int(round(float(seconds)))
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    if hours:
        return f"{hours}h{minutes:02d}m{secs:02d}s"
    if minutes:
        return f"{minutes}m{secs:02d}s"
    return f"{secs}s"


def _out_of_range(start: float, duration: float) -> ApiError:
    return ApiError(400, "clip_out_of_range",
                    f"Le début demandé ({_hms(start)}) est après la fin du média ({_hms(duration)}).")


def _streams(meta: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any] | None, bool]:
    """(video track, audio track, has cover art): cover art is not a video track."""
    streams = meta.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"
                  and not (s.get("disposition") or {}).get("attached_pic")), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    cover = any(s.get("codec_type") == "video" and (s.get("disposition") or {}).get("attached_pic") for s in streams)
    return video, audio, cover


def _fps_of(stream: dict[str, Any]) -> float | None:
    for key in ("avg_frame_rate", "r_frame_rate"):
        num, _, den = str(stream.get(key) or "").partition("/")
        try:
            value = float(num) / float(den or 1)
        except (ValueError, ZeroDivisionError):
            continue
        if 0 < value <= 240:
            return value
    return None


def cut_clip(source: Path, workdir: Path, params: dict[str, Any], reporter: Reporter) -> tuple[Path, list[str]]:
    """Extract [start_s, end_s] (the end is clamped to the media's end).

    mp4: re-encoded in H.264/AAC (frame-accurate cut, plays everywhere, even when the source is VP9/AV1/HEVC);
    mp3: re-encoded at the requested bitrate, cover art kept when there is one (dropped if ffmpeg refuses it)."""
    meta = probe(source)
    duration = _duration_of(meta) or 0.0
    start, end = float(params["start_s"]), float(params["end_s"])
    if duration and start >= duration - 0.05:
        raise _out_of_range(start, duration)
    if duration:
        end = min(end, duration)
    length = round(end - start, 3)
    notes: list[str] = []
    if duration and float(params["end_s"]) > duration + 0.5:
        notes.append(f"La vidéo s'arrête à {_hms(duration)} : l'extrait va jusqu'à la fin.")
    video, audio, cover = _streams(meta)
    seek = ["-ss", f"{start:.3f}", "-i", str(source), "-t", f"{length:.3f}"]
    reporter.send("clipping", 0.0, force=True)
    if params["fmt"] == "mp4":
        target = workdir / f"{source.stem}.clip.mp4"
        args = [*seek, "-map", "0:v:0?", "-map", "0:a:0?",
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
                "-pix_fmt", "yuv420p", "-profile:v", "high", "-threads", str(cpu_limit()),
                "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(target)]
        if video is None:
            raise ApiError(422, "format_unavailable",
                           "Le fichier obtenu ne contient aucune piste vidéo (son seul) : aucun MP4 n'est fourni.")
        run_ffmpeg(args, length, reporter, "clipping")
    else:
        if audio is None:
            raise ApiError(400, "no_audio", "Ce média n'a pas de piste son : extrait MP3 impossible.")
        target = workdir / f"{source.stem}.clip.mp3"
        sound = [*seek, "-map", "0:a:0", "-c:a", "libmp3lame", "-b:a", f"{int(params.get('bitrate') or 192)}k",
                 "-id3v2_version", "3"]
        art = ["-map", "0:v:0", "-c:v", "copy", "-disposition:v:0", "attached_pic"] if cover else []
        try:
            run_ffmpeg([*sound, *art, str(target)], length, reporter, "clipping")
        except ApiError:
            if not cover:
                raise
            target.unlink(missing_ok=True)
            run_ffmpeg([*sound, str(target)], length, reporter, "clipping")
            notes.append("La pochette n'a pas pu être intégrée.")
    source.unlink(missing_ok=True)
    final = source.with_suffix(target.suffix)
    target.rename(final)
    return final, notes


def plan_compression(duration: float, width: int, height: int, fps: float | None, has_audio: bool,
                     max_bytes: int) -> dict[str, int]:
    """Bitrates and picture size for a file of at most max_bytes (pure function, unit-tested).

    6 % of the budget is kept for the container and the rate control; the sound gets 96 kbit/s (64 below
    400 kbit/s in total); the picture keeps the largest short side of COMPRESS_SIDES that leaves at least
    COMPRESS_MIN_BPP bits per pixel at <= 30 images/s. Raises cannot_fit when even that is impossible."""
    if duration <= 0 or width <= 0 or height <= 0:
        raise ApiError(422, "format_unavailable", "La vidéo d'origine est illisible : compression impossible.")
    total_kbps = max_bytes * 8 * 0.94 / duration / 1000
    audio_kbps = 0 if not has_audio else (64 if total_kbps < 400 else 96)
    video_kbps = int(total_kbps - audio_kbps)
    if video_kbps < COMPRESS_MIN_VIDEO_KBPS:
        raise ApiError(413, "cannot_fit",
                       f"Impossible de faire tenir cette vidéo de {_hms(duration)} dans {_mib(max_bytes)} : "
                       "elle est trop longue pour cette taille.")
    rate = min(30.0, fps or 30.0)
    short = min(width, height)
    side = min(short, COMPRESS_SIDES[-1])
    for candidate in COMPRESS_SIDES:
        if candidate > short:
            continue
        scaled_long = max(width, height) * candidate / short
        if video_kbps * 1000 / (candidate * scaled_long * rate) >= COMPRESS_MIN_BPP:
            side = candidate
            break
    return {"video_kbps": video_kbps, "audio_kbps": audio_kbps, "short_side": int(side),
            "fps": int(rate) if fps and fps > 30 else 0}


def compress_video(source: Path, workdir: Path, max_bytes: int, cfg: dict[str, Any],
                   reporter: Reporter) -> tuple[Path, list[str], bool]:
    """Same video in H.264/AAC under max_bytes (one retry at a lower bitrate if the first pass overshoots).
    Returns (file, notes, recompressed): a file that already fits is given back untouched."""
    meta = probe(source)
    duration = _duration_of(meta) or 0.0
    video, audio, _ = _streams(meta)
    if video is None:
        raise ApiError(422, "format_unavailable", "Le fichier d'origine ne contient aucune piste vidéo.")
    if source.stat().st_size <= max_bytes:
        return source, ["Le fichier tenait déjà dans la taille demandée : il n'a pas été recompressé."], False
    if duration > cfg["transcode_max_duration_s"]:
        raise ApiError(413, "transcode_too_long",
                       f"La compression est limitée à {cfg['transcode_max_duration_s']} s de vidéo "
                       f"(TRANSCODE_MAX_DURATION_S), celle-ci dure {int(duration)} s.")
    width, height = int(video.get("width") or 0), int(video.get("height") or 0)
    plan = plan_compression(duration, width, height, _fps_of(video), audio is not None, max_bytes)
    short = min(width, height)
    filters = []
    if plan["short_side"] < short:
        filters.append(f"scale=-2:{plan['short_side']}" if width >= height else f"scale={plan['short_side']}:-2")
    else:
        filters.append("scale=trunc(iw/2)*2:trunc(ih/2)*2")
    if plan["fps"]:
        filters.append(f"fps={plan['fps']}")
    target = workdir / f"{source.stem}.small.mp4"
    video_kbps = plan["video_kbps"]
    reporter.send("compressing", 0.0, force=True)
    for attempt in (1, 2):
        args = ["-i", str(source), "-map", "0:v:0", "-map", "0:a:0?", "-vf", ",".join(filters),
                "-c:v", "libx264", "-preset", "veryfast", "-b:v", f"{video_kbps}k", "-maxrate", f"{video_kbps}k",
                "-bufsize", f"{video_kbps * 2}k", "-pix_fmt", "yuv420p", "-profile:v", "high",
                "-threads", str(cpu_limit())]
        args += ["-c:a", "aac", "-b:a", f"{plan['audio_kbps']}k", "-ac", "2"] if audio is not None else ["-an"]
        args += ["-movflags", "+faststart", str(target)]
        run_ffmpeg(args, duration, reporter, "compressing")
        size = target.stat().st_size
        log.info("compression pass", extra={"attempt": attempt, "video_kbps": video_kbps, "size": size,
                                            "max_bytes": max_bytes, "short_side": plan["short_side"]})
        if size <= max_bytes:
            break
        video_kbps = int(video_kbps * max_bytes / size * 0.9)
        if attempt == 2 or video_kbps < COMPRESS_MIN_VIDEO_KBPS:
            target.unlink(missing_ok=True)
            raise ApiError(413, "cannot_fit", f"Impossible de faire tenir cette vidéo dans {_mib(max_bytes)}.")
    notes = []
    if plan["short_side"] < short:
        notes.append(f"Image réduite à {plan['short_side']}p pour tenir dans {_mib(max_bytes)}.")
    source.unlink(missing_ok=True)
    final = source.with_suffix(".mp4")
    target.rename(final)
    return final, notes, True


def derive_gif(source: Path, workdir: Path, params: dict[str, Any], cfg: dict[str, Any], reporter: Reporter) -> Path:
    """GIF of duration_s seconds from start_s (<= GIF_MAX_DURATION_S). With max_bytes: smaller and slower
    images (3/4 of the width, 4/5 of the images per second) until it fits, at most 4 tries."""
    meta = probe(source)
    duration = _duration_of(meta) or 0.0
    start = float(params.get("start_s") or 0)
    if duration and start >= duration - 0.05:
        raise _out_of_range(start, duration)
    length = min(float(params.get("duration_s") or 6), float(cfg["gif_max_duration_s"]),
                 (duration - start) if duration else 1e9)
    width, fps = int(params["gif_width"]), int(params["gif_fps"])
    max_bytes = params.get("max_bytes")
    target = workdir / f"{source.stem}.gif"
    palette = workdir / "palette.png"
    seek = ["-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", str(source)]
    for attempt in range(1, 5):
        scale = f"fps={fps},scale='min({width},iw)':-2:flags=lanczos"
        reporter.send("converting", 0.0, force=True)
        run_ffmpeg([*seek, "-vf", f"{scale},palettegen=stats_mode=diff", "-update", "1", "-frames:v", "1",
                    str(palette)], length, reporter, "gif:palette")
        run_ffmpeg([*seek, "-i", str(palette), "-lavfi",
                    f"{scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
                    "-loop", "0", str(target)], length, reporter, "gif:encode")
        size = target.stat().st_size
        log.info("gif pass", extra={"attempt": attempt, "width": width, "fps": fps, "size": size})
        if not max_bytes or size <= int(max_bytes):
            break
        if attempt == 4 or (width <= GIF_MIN_WIDTH and fps <= GIF_MIN_FPS):
            target.unlink(missing_ok=True)
            raise ApiError(413, "cannot_fit",
                           f"Impossible de faire tenir ce GIF dans {_mib(int(max_bytes))} : choisis un passage plus court.")
        width = max(GIF_MIN_WIDTH, int(width * 0.75) // 2 * 2)
        fps = max(GIF_MIN_FPS, int(fps * 0.8))
    palette.unlink(missing_ok=True)
    source.unlink(missing_ok=True)
    return target


def run_derive(task: dict[str, Any], cfg: dict[str, Any], workdir: Path, reporter: Reporter) -> dict[str, Any]:
    """New file from a finished .mp4 (POST /jobs/{id}/derive): no platform access, only ffmpeg on a private
    hard link of the source file, made by the parent in this job's own directory."""
    params = task["params"]
    source = Path(params["source"])
    if not source.is_file():
        raise ApiError(410, "file_gone", "Le fichier d'origine a expiré : relance la conversion.")
    reporter.band = (0.0, 99.0)
    title = params.get("title") or "media"
    notes: list[str] = []
    if params["op"] == "compress":
        path, notes, recompressed = compress_video(source, workdir, int(params["max_bytes"]), cfg, reporter)
        check_video_track(path, h264=recompressed)
        label = "(compressé)" if recompressed else ""
    else:
        path = derive_gif(source, workdir, params, cfg, reporter)
        label = "(GIF)"
    ext = path.suffix.lstrip(".").lower()
    size = path.stat().st_size
    if size > cfg["max_filesize_bytes"]:
        raise _too_large(cfg)
    reporter.send("finalizing", 1.0, force=True)
    return {
        "filepath": str(path),
        "download_name": build_download_name(title, params.get("media_id"), ext, label=label),
        "media_type": MEDIA_TYPES.get(ext, "application/octet-stream"),
        "title": params.get("title"),
        "id": params.get("media_id"),
        "ext": ext,
        "size": size,
        "notes": notes,
    }
