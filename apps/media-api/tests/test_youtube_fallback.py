"""YouTube player clients (YT_CLIENTS), client ranking, HTTP 403 fallback, hev1 -> hvc1 remux.

Offline only: yt-dlp is replaced by a fake, or (integration tests) the real yt-dlp downloads from a
local HTTP server that plays the media servers of two YouTube clients, one of which answers 403.
"""

from __future__ import annotations

import copy
import json
import logging
import shutil
import subprocess
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
import yt_dlp
from yt_dlp.utils import DownloadError, LazyList

import app.worker as worker
from app.config import ConfigError, load_settings, parse_yt_clients
from app.runner import WorkerConfig
from app.worker import (Attempt, Reporter, _extract, _pristine, base_options, format_client, hevc_to_hvc1,
                        player_clients, rank_youtube_formats, youtube_extractor_args)

YT = "https://www.youtube.com/watch?v=abcdefghijk"
CLIENTS = ("visionos", "web_embedded")
INNERTUBE = {"VISI": "VISIONOS", "WEB-E": "WEB_EMBEDDED_PLAYER", "MWEB": "MWEB"}
CFG = {"max_filesize_bytes": 10**9, "cache_dir": None, "max_duration_s": 3600, "transcode_max_duration_s": 900,
       "gif_max_duration_s": 30, "extractor_args": {}, "yt_clients": CLIENTS}
FORBIDDEN = "ERROR: unable to download video data: HTTP Error 403: Forbidden"


class _Conn:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    def send(self, message: dict[str, Any]) -> None:
        self.sent.append(message)


# --- YT_CLIENTS --------------------------------------------------------------------------------


def test_yt_clients_parsing() -> None:
    assert parse_yt_clients("visionos,web_embedded") == ("visionos", "web_embedded")
    assert parse_yt_clients(" visionos , ,web_embedded,visionos ") == ("visionos", "web_embedded")
    assert parse_yt_clients("") == () and parse_yt_clients(" , ") == ()


@pytest.mark.parametrize("raw", ["VisionOS", "web-embedded", "-web", "web embedded", "tv;rm", "mweb.ios"])
def test_yt_clients_invalid_names(raw: str) -> None:
    with pytest.raises(ConfigError):
        parse_yt_clients(raw)


def test_yt_clients_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_TOKEN", "x" * 32)
    monkeypatch.delenv("YT_CLIENTS", raising=False)
    settings = load_settings()
    assert settings.yt_clients == ("visionos", "web_embedded")
    assert WorkerConfig.from_settings(settings).yt_clients == ("visionos", "web_embedded")
    monkeypatch.setenv("YT_CLIENTS", "")  # empty: yt-dlp's own defaults
    assert load_settings().yt_clients == ()
    monkeypatch.setenv("YT_CLIENTS", "web_embedded,mweb")
    assert load_settings().yt_clients == ("web_embedded", "mweb")
    monkeypatch.setenv("YT_CLIENTS", "web,../x")
    with pytest.raises(ConfigError):
        load_settings()


# --- extractor args ------------------------------------------------------------------------------


def test_extractor_args_without_cookies(tmp_path: Path) -> None:
    cfg = {**CFG, "extractor_args": {"youtube": {"fetch_pot": ["never"]}}}
    args = base_options(cfg, tmp_path, "youtube")["extractor_args"]
    assert args["youtube"] == {"fetch_pot": ["never"], "player_client": ["visionos", "web_embedded"],
                               "formats": ["duplicate"]}
    assert cfg["extractor_args"] == {"youtube": {"fetch_pot": ["never"]}}  # shared cfg never modified
    assert base_options(cfg, tmp_path, "tiktok")["extractor_args"] == {"youtube": {"fetch_pot": ["never"]}}
    assert base_options(cfg, tmp_path, "tiktok")["extractor_args"] is not cfg["extractor_args"]


def test_extractor_args_with_cookies_left_alone(tmp_path: Path) -> None:
    source = tmp_path / "cookies.src"
    source.write_text("# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2000000000\tSID\tx\n")
    work = tmp_path / "work"
    work.mkdir()
    opts = base_options(CFG, work, "youtube", str(source))
    assert "cookiefile" in opts and opts["extractor_args"] == {}
    # Cookie file set but unreadable: no cookies are sent, so the clients without cookies apply.
    unreadable = base_options(CFG, work, "youtube", str(tmp_path / "missing.txt"))
    assert unreadable["extractor_args"]["youtube"]["player_client"] == ["visionos", "web_embedded"]


def test_admin_player_client_and_formats() -> None:
    admin = {"youtube": {"player_client": ["mweb"], "formats": ["missing_pot"]}}
    assert youtube_extractor_args({**CFG, "extractor_args": admin}, cookies=False) == admin
    merged = youtube_extractor_args({**CFG, "extractor_args": {"youtube": {"formats": ["missing_pot"]}}}, cookies=False)
    assert merged["youtube"]["formats"] == ["missing_pot", "duplicate"]
    already = youtube_extractor_args({**CFG, "extractor_args": {"youtube": {"formats": ["duplicate"]}}}, cookies=False)
    assert already["youtube"]["formats"] == ["duplicate"]
    assert youtube_extractor_args({**CFG, "yt_clients": ()}, cookies=False) == {}  # YT_CLIENTS="" -> defaults
    assert player_clients({"extractor_args": merged}) == CLIENTS
    assert player_clients({"extractor_args": {"youtube": {"player_client": ["default", "-web", "TV"]}}}) == ("tv",)


# --- client of a format and ranking ------------------------------------------------------------------


def _fmt(itag: str, short: str, *, video: bool, note: str = "", pref: float = -1, height: int = 1080,
         vcodec: str = "avc1.640028", pot: bool = False) -> dict[str, Any]:
    query = f"c={INNERTUBE.get(short, short)}&itag={itag}" + ("&pot=SECRETPOT" if pot else "")
    fmt: dict[str, Any] = {
        "format_id": itag, "url": f"https://rr1---sn-test.googlevideo.com/videoplayback?{query}",
        "format_note": ", ".join(filter(None, (note or (f"{height}p" if video else "medium"), short))),
        "source_preference": pref, "protocol": "https",
    }
    if video:
        fmt.update(ext="mp4", vcodec=vcodec, acodec="none", height=height, width=height * 16 // 9, filesize=4_000_000)
    else:
        fmt.update(ext="m4a", vcodec="none", acodec="mp4a.40.2", abr=128, filesize=500_000)
    return fmt


def test_format_client_from_note_or_url() -> None:
    assert format_client(_fmt("137", "VISI", video=True), CLIENTS) == "VISI"
    assert format_client({"format_note": "1080p, MISSING POT, MWEB"}) == "MWEB"
    assert format_client({"format_note": "English (default) original, medium, DRC, WEB-E"}) == "WEB-E"
    # Without duplicate formats (cookies), the note has no client: the 'c' URL parameter names it.
    embedded = {"format_note": "1080p", "url": "https://h/videoplayback?c=WEB_EMBEDDED_PLAYER&x=1"}
    assert format_client(embedded) == "WEB-E"
    assert format_client({"url": "https://h/videoplayback?c=TVHTML5"}, ("tv_downgraded",)) == "TV-D"
    assert format_client({"url": "https://h/videoplayback?c=TVHTML5"}) == "TV"
    assert format_client({"url": "https://h/videoplayback?c=NEWCLIENT"}) == "NEWCLIENT"
    assert format_client({"format_note": "storyboard", "url": "https://i.ytimg.com/sb/x/M0.jpg"}) is None


def test_rank_adjusts_only_lower_clients_and_keeps_penalties() -> None:
    info = {"formats": [_fmt("137", "VISI", video=True), _fmt("137", "WEB-E", video=True),
                        _fmt("137", "MWEB", video=True, pref=-21, note="1080p, MISSING POT"),
                        {"format_id": "sb0", "format_note": "storyboard", "url": "https://i.ytimg.com/sb/0"}]}
    rank_youtube_formats(info, CLIENTS)
    prefs = [f.get("source_preference") for f in info["formats"]]
    assert prefs[0] == -1  # rank 0: unchanged
    assert -2 < prefs[1] < prefs[0]  # second client: slightly lower, less than a real penalty
    assert prefs[2] < -21 and prefs[2] < prefs[1] - 19  # MISSING POT keeps dominating
    assert -2 < prefs[3] < -1  # unknown client (storyboard, no preference): last rank
    untouched = {"formats": [_fmt("137", "WEB-E", video=True)]}
    rank_youtube_formats(untouched, ())
    assert untouched["formats"][0]["source_preference"] == -1  # no clients: nothing changed


class _ExtractYdl:
    def __init__(self, raw: dict[str, Any], params: dict[str, Any]) -> None:
        self.raw, self.params = raw, params

    def extract_info(self, url: str, download: bool, process: bool) -> dict[str, Any]:
        return self.raw

    def process_ie_result(self, info: dict[str, Any], download: bool = True) -> dict[str, Any]:
        return info


@pytest.mark.parametrize(("platform", "changed"), [("youtube", True), ("tiktok", False), ("twitter", False)])
def test_ranking_only_for_youtube(platform: str, changed: bool) -> None:
    raw = {"id": "x", "formats": [_fmt("137", "VISI", video=True), _fmt("137", "WEB-E", video=True)]}
    params = {"extractor_args": {"youtube": {"player_client": list(CLIENTS)}}}
    info = _extract(_ExtractYdl(raw, params), YT, platform)  # type: ignore[arg-type]
    assert (info["formats"][1]["source_preference"] < -1) is changed


def _real_raw(base: str, *, missing_pot_visi: bool = False, sizes: dict[str, int] | None = None) -> dict[str, Any]:
    """Raw YouTube-like info (process=False) with the same itags from two clients, VISI listed first."""
    sizes = sizes or {}
    formats = []
    for short in ("VISI", "WEB-E"):
        query = f"c={INNERTUBE[short]}"
        missing = missing_pot_visi and short == "VISI"
        formats += [
            {"format_id": "137", "url": f"{base}/videoplayback?{query}&itag=137", "ext": "mp4",
             "vcodec": "avc1.64001e", "acodec": "none", "width": 320, "height": 240, "fps": 25, "tbr": 100,
             "filesize": sizes.get("137"), "format_note": f"240p{', MISSING POT' if missing else ''}, {short}",
             "source_preference": -21 if missing else -1, "quality": 5, "container": "mp4_dash"},
            {"format_id": "140", "url": f"{base}/videoplayback?{query}&itag=140", "ext": "m4a",
             "vcodec": "none", "acodec": "mp4a.40.2", "abr": 128, "tbr": 128, "asr": 44100,
             "filesize": sizes.get("140"), "format_note": f"medium, {short}", "source_preference": -1,
             "quality": 3, "container": "m4a_dash"},
        ]
    # formats=duplicate also keeps a "dashy" copy of each https format, with lazy fragment lists.
    formats += [{**f, "format_id": f"{f['format_id']}-dashy", "protocol": "http_dash_segments",
                 "fragments": LazyList({"url": f"{f['url']}&range=0-{n}"} for n in (f.get("filesize") or 1,))}
                for f in formats if f.get("filesize")]
    return {
        "id": "abcdefghijk", "title": "Essai repli", "duration": 1, "formats": formats,
        "thumbnails": [{"url": f"{base}/thumb.jpg", "id": "0"}],
        "extractor": "youtube", "extractor_key": "Youtube", "webpage_url": YT, "original_url": YT,
        "webpage_url_basename": "watch", "webpage_url_domain": "youtube.com",
        "_format_sort_fields": ("quality", "res", "fps", "hdr:12", "source", "vcodec", "channels", "acodec",
                                "lang", "proto"),
    }


class _RealYdl(yt_dlp.YoutubeDL):
    """The real YoutubeDL (selection, download, merge, post-processing); only the extraction is fake."""

    make_raw: Any = staticmethod(dict)  # fresh raw info per extraction (lazy fragments: no deepcopy)
    extractions = 0

    def extract_info(self, url: str, download: bool = True, ie_key: Any = None, extra_info: Any = None,
                     process: bool = True, force_generic_extractor: bool = False) -> dict[str, Any]:
        assert process is False and download is False
        type(self).extractions += 1
        return type(self).make_raw()


def _use_raw(make_raw: Any) -> None:
    _RealYdl.make_raw, _RealYdl.extractions = staticmethod(make_raw), 0


def _real_ydl(make_raw: Any, tmp_path: Path, params: dict[str, Any]) -> yt_dlp.YoutubeDL:
    _use_raw(make_raw)
    opts = base_options(CFG, tmp_path, "youtube") | worker.format_options({**params, "platform": "youtube"})
    return _RealYdl(opts)


def test_real_selection_prefers_first_client(tmp_path: Path) -> None:
    params = {"fmt": "mp4", "quality": "best", "bitrate": 192}
    with _real_ydl(lambda: _real_raw("https://h.invalid"), tmp_path, params) as ydl:
        info = _extract(ydl, YT, "youtube")
    # Without ranking, yt-dlp's stable sort would keep the client listed last (WEB-E) on a tie.
    assert [format_client(f) for f in info["requested_formats"]] == ["VISI", "VISI"]
    assert {format_client(f) for f in info["formats"] if f["format_id"] in ("137-0", "137-1")} == {"VISI", "WEB-E"}
    with _real_ydl(lambda: _real_raw("https://h.invalid", missing_pot_visi=True), tmp_path, params) as ydl:
        info = _extract(ydl, YT, "youtube")
    assert [format_client(f) for f in info["requested_formats"]] == ["WEB-E", "VISI"]  # MISSING POT still loses


# --- fallback on HTTP 403 (fake yt-dlp) ------------------------------------------------------------


def _client_of_url(fmt: dict[str, Any]) -> str:
    return parse_qs(urlsplit(fmt["url"]).query, keep_blank_values=True)["c"][0]


def _download_error(message: str) -> DownloadError:
    """DownloadError as yt-dlp raises it: the HTTP error of the stream as exc_info (if any)."""
    status = next((code for code in (403, 404) if f"HTTP Error {code}" in message), None)
    if status is None:
        return DownloadError(message)
    cause = type("HTTPError", (Exception,), {"status": status})(message.rpartition("data: ")[2])
    return DownloadError(message, (type(cause), cause, None))


class FakeYdl:
    """Selection by source_preference (best first), download that fails with 403 for some clients."""

    instances: list[FakeYdl] = []
    raw: dict[str, Any] = {}
    refuse: set[str] = set()
    error = FORBIDDEN
    sample = b""  # real H.264 + AAC clip: the video track of an mp4 is checked before delivery

    def __init__(self, opts: dict[str, Any]) -> None:
        self.params = opts
        self.extractions = 0
        self.downloads: list[list[str]] = []
        type(self).instances.append(self)

    def __enter__(self) -> FakeYdl:
        return self

    def __exit__(self, *_exc: Any) -> None:
        return None

    def add_postprocessor_hook(self, hook: Any) -> None:
        pass

    def extract_info(self, url: str, download: bool, process: bool) -> dict[str, Any]:
        self.extractions += 1
        return copy.deepcopy(type(self).raw)

    def process_ie_result(self, info: dict[str, Any], download: bool = True) -> dict[str, Any]:
        if not download:
            return self._select(info)
        parts = info.get("requested_formats") or [info]
        self.downloads.append([p["format_id"] for p in parts])
        workdir = Path(self.params["paths"]["home"])
        if any(_client_of_url(p) in type(self).refuse for p in parts) or type(self).error != FORBIDDEN:
            for p in parts:  # what yt-dlp leaves behind: a partial part, its resume file
                (workdir / f"{info['id']}.f{p['format_id']}.{p['ext']}.part").write_bytes(b"x")
                (workdir / f"{info['id']}.f{p['format_id']}.{p['ext']}.ytdl").write_bytes(b"{}")
            raise _download_error(type(self).error)
        ext = "mp3" if self.params["format"] == "ba/b" else "mp4"
        path = workdir / f"{info['id']}.{ext}"
        path.write_bytes(type(self).sample if ext == "mp4" else b"\x00" * 1000)
        return {**info, "requested_downloads": [{"filepath": str(path)}]}

    def _select(self, info: dict[str, Any]) -> dict[str, Any]:
        formats = sorted(info["formats"], key=lambda f: -f.get("source_preference", -1))
        video = [f for f in formats if f.get("vcodec", "none") != "none"]
        audio = [f for f in formats if f.get("acodec", "none") != "none" and f.get("vcodec", "none") == "none"]
        for key in ("requested_formats", "url"):
            info.pop(key, None)
        if self.params["format"] == "ba/b":
            info.update(audio[0])
        else:
            info.update(format_id=f"{video[0]['format_id']}+{audio[0]['format_id']}", ext="mp4",
                        vcodec=video[0]["vcodec"], acodec=audio[0]["acodec"],
                        requested_formats=[video[0], audio[0]])
        return info


def _fake_raw() -> dict[str, Any]:
    formats = []
    for i, short in enumerate(("VISI", "WEB-E")):
        for f in (_fmt("137", short, video=True), _fmt("140", short, video=False)):
            f["format_id"] += f"-{i}"  # what yt-dlp makes of duplicate itags
            formats.append(f)
    return {"id": "abcdefghijk", "title": "Essai", "duration": 60, "formats": formats, "webpage_url": YT}


@pytest.fixture
def fake_ydl(monkeypatch: pytest.MonkeyPatch, media_samples: dict[str, Path]) -> type[FakeYdl]:
    FakeYdl.instances, FakeYdl.raw, FakeYdl.refuse, FakeYdl.error = [], _fake_raw(), set(), FORBIDDEN
    FakeYdl.sample = media_samples["h264"].read_bytes()
    monkeypatch.setattr(worker.yt_dlp, "YoutubeDL", FakeYdl)
    return FakeYdl


def _task(tmp_path: Path, fmt: str = "mp4", platform: str = "youtube") -> dict[str, Any]:
    params = {"fmt": fmt, "quality": "best", "bitrate": 192, "transcode": False, "index": 1}
    return {"kind": "download", "url": YT, "platform": platform, "workdir": str(tmp_path), "params": params}


def test_403_falls_back_to_the_other_client(fake_ydl: type[FakeYdl], tmp_path: Path,
                                            caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO, logger="ytapi.worker")
    fake_ydl.refuse = {"VISIONOS"}
    (tmp_path / "abcdefghijk.jpg").write_bytes(b"cover")  # must survive the cleanup
    result = worker.run_download(_task(tmp_path), CFG, tmp_path, Reporter(_Conn()))
    [ydl] = fake_ydl.instances
    assert ydl.extractions == 1  # one extraction: the YouTube limiter is never bypassed
    assert ydl.downloads == [["137-0", "140-0"], ["137-1", "140-1"]]
    assert Path(result["filepath"]).is_file() and result["ext"] == "mp4"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["abcdefghijk.jpg", "abcdefghijk.mp4"]
    selected = [r for r in caplog.records if r.getMessage() == "youtube formats selected"]
    assert [(r.attempt, r.clients, r.pot_present) for r in selected] == [(1, ["VISI", "VISI"], False),
                                                                          (2, ["WEB-E", "WEB-E"], False)]
    [fallback] = [r for r in caplog.records if r.getMessage() == "youtube stream refused, trying another client"]
    assert fallback.levelno == logging.WARNING and fallback.failed_clients == ["VISI"]
    assert fallback.format_ids == ["137-1", "140-1"] and fallback.attempt == 2
    logged = json.dumps([vars(r) for r in caplog.records], default=str)
    assert "googlevideo" not in logged and "videoplayback" not in logged


def test_403_mp3_selection_falls_back(fake_ydl: type[FakeYdl], tmp_path: Path) -> None:
    fake_ydl.refuse = {"VISIONOS"}
    result = worker.run_download(_task(tmp_path, "mp3"), CFG, tmp_path, Reporter(_Conn()))
    assert fake_ydl.instances[0].downloads == [["140-0"], ["140-1"]]
    assert result["ext"] == "mp3" and fake_ydl.instances[0].extractions == 1


def test_all_clients_refused_raises_the_last_403(fake_ydl: type[FakeYdl], tmp_path: Path) -> None:
    fake_ydl.refuse = {"VISIONOS", "WEB_EMBEDDED_PLAYER"}
    with pytest.raises(DownloadError, match="HTTP Error 403"):
        worker.run_download(_task(tmp_path), CFG, tmp_path, Reporter(_Conn()))
    assert fake_ydl.instances[0].downloads == [["137-0", "140-0"], ["137-1", "140-1"]]
    assert worker.map_ytdlp_error(FORBIDDEN, "youtube").code == "upstream_forbidden"


@pytest.mark.parametrize("error", ["ERROR: unable to download video data: HTTP Error 404: Not Found",
                                   "ERROR: fragment 1 not found, unable to continue"])
def test_other_errors_are_not_retried(fake_ydl: type[FakeYdl], tmp_path: Path, error: str) -> None:
    fake_ydl.error = error
    with pytest.raises(DownloadError):
        worker.run_download(_task(tmp_path), CFG, tmp_path, Reporter(_Conn()))
    assert fake_ydl.instances[0].downloads == [["137-0", "140-0"]]


def test_no_fallback_outside_youtube(fake_ydl: type[FakeYdl], tmp_path: Path) -> None:
    fake_ydl.refuse = {"VISIONOS"}
    with pytest.raises(DownloadError):
        worker.run_download(_task(tmp_path, platform="tiktok"), CFG, tmp_path, Reporter(_Conn()))
    assert len(fake_ydl.instances[0].downloads) == 1


def test_unknown_client_is_not_retried(fake_ydl: type[FakeYdl], tmp_path: Path) -> None:
    for f in fake_ydl.raw["formats"]:
        f["format_note"] = "1080p"
        f["url"] = f["url"].replace("c=VISIONOS", "c=").replace("c=WEB_EMBEDDED_PLAYER", "c=")
    fake_ydl.refuse = {""}
    with pytest.raises(DownloadError):
        worker.run_download(_task(tmp_path), CFG, tmp_path, Reporter(_Conn()))
    assert len(fake_ydl.instances[0].downloads) == 1


def test_fallback_selection_too_large(fake_ydl: type[FakeYdl], tmp_path: Path) -> None:
    for f in fake_ydl.raw["formats"]:
        if "WEB-E" in f["format_note"]:
            f["filesize"] = 2 * 10**9  # only the second client's streams exceed the limit
    fake_ydl.refuse = {"VISIONOS"}
    with pytest.raises(worker.ApiError) as excinfo:
        worker.run_download(_task(tmp_path), CFG, tmp_path, Reporter(_Conn()))
    assert excinfo.value.code == "too_large" and len(fake_ydl.instances[0].downloads) == 1


def test_cover_retry_skips_refused_clients(fake_ydl: type[FakeYdl], tmp_path: Path, monkeypatch) -> None:
    # Second pass of an mp3 whose cover failed after a fallback: no new 403 on the refused client.
    fake_ydl.refuse = {"VISIONOS"}
    ydl = FakeYdl({"format": "ba/b", "paths": {"home": str(tmp_path)},
                   "extractor_args": {"youtube": {"player_client": list(CLIENTS)}}})
    info = ydl._select(_fake_raw())
    progress = worker.DownloadProgress(Reporter(_Conn()), 10**9)
    attempt = Attempt(info, {"VISI"})
    task = _task(tmp_path, "mp3")
    _result, used = worker._fetch(ydl, info, task, CFG, tmp_path, progress, attempt)  # type: ignore[arg-type]
    assert ydl.downloads == [["140-1"]] and used["format_id"] == "140-1"


def test_pristine_copies_lazy_fragments() -> None:
    fragments = LazyList({"url": f"https://h/v?range={i}"} for i in range(3))
    info = {"id": "x", "formats": [{"format_id": "137-dashy-0", "fragments": fragments}]}
    snapshot = _pristine(info)
    assert snapshot is not None and len(snapshot["formats"][0]["fragments"]) == 3
    assert len(info["formats"][0]["fragments"]) == 3  # the original still works


# --- real yt-dlp against a local media server ---------------------------------------------------------


def _ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True, timeout=60)


class _MediaServer:
    """Plays googlevideo for two clients: streams of the refused client get HTTP 403."""

    def __init__(self, root: Path) -> None:
        self.files = {"137": root / "v.mp4", "140": root / "a.m4a", "thumb": root / "t.jpg"}
        self.refuse: set[str] = set()
        self.requests: list[tuple[str, str]] = []
        server = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                parts = urlsplit(self.path)
                query = parse_qs(parts.query)
                client, itag = query.get("c", [""])[0], query.get("itag", ["thumb"])[0]
                server.requests.append((client, itag))
                if client in server.refuse:
                    self.send_error(403, "Forbidden")
                    return
                data = server.files[itag].read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *_args: Any) -> None:
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture
def media_server(tmp_path: Path) -> Iterator[_MediaServer]:
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg absent")
    root = tmp_path / "srv"
    root.mkdir()
    _ffmpeg("-f", "lavfi", "-i", "testsrc=size=320x240:rate=25", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-an", "-f", "mp4", str(root / "v.mp4"))
    _ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac", "-vn", "-f", "mp4", str(root / "a.m4a"))
    _ffmpeg("-f", "lavfi", "-i", "testsrc=size=64x64", "-frames:v", "1", str(root / "t.jpg"))
    server = _MediaServer(root)
    yield server
    server.close()


def _probe(path: Path) -> dict[str, Any]:
    out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
                         capture_output=True, text=True, check=True, timeout=60)
    return json.loads(out.stdout)


@pytest.mark.parametrize("fmt", ["mp4", "mp3"])
def test_real_ytdlp_403_fallback(media_server: _MediaServer, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
                                 caplog: pytest.LogCaptureFixture, fmt: str) -> None:
    caplog.set_level(logging.INFO, logger="ytapi.worker")
    media_server.refuse = {"VISIONOS"}
    sizes = {"137": media_server.files["137"].stat().st_size, "140": media_server.files["140"].stat().st_size}
    _use_raw(lambda: _real_raw(media_server.base, sizes=sizes))
    monkeypatch.setattr(worker.yt_dlp, "YoutubeDL", _RealYdl)
    work = tmp_path / "job"
    work.mkdir()
    result = worker.run_download(_task(work, fmt), CFG, work, Reporter(_Conn()))
    assert _RealYdl.extractions == 1
    media = [r for r in media_server.requests if r[1] != "thumb"]
    wanted = ["137", "140"] if fmt == "mp4" else ["140"]
    assert [r for r in media if r[0] == "VISIONOS"] == [("VISIONOS", wanted[0])]  # refused once, never again
    assert sorted(r[1] for r in media if r[0] == "WEB_EMBEDDED_PLAYER") == wanted
    assert all(r[0] == "" or r[1] in ("137", "140") for r in media_server.requests)
    selected = [r for r in caplog.records if r.getMessage() == "youtube formats selected"]
    assert not any("dashy" in i for r in selected for i in r.format_ids)  # https wins over the dashy copy
    streams = {s["codec_type"]: s["codec_name"] for s in _probe(Path(result["filepath"]))["streams"]}
    if fmt == "mp4":
        assert result["ext"] == "mp4" and streams == {"video": "h264", "audio": "aac"}
    else:
        assert result["ext"] == "mp3" and streams["audio"] == "mp3"
    assert not [p for p in work.iterdir() if p.name.endswith((".part", ".ytdl"))]
    [fallback] = [r for r in caplog.records if r.getMessage() == "youtube stream refused, trying another client"]
    assert fallback.failed_clients == ["VISI"] and media_server.base not in caplog.text


def test_real_ytdlp_no_usable_format_left_keeps_the_403(media_server: _MediaServer, tmp_path: Path,
                                                        monkeypatch: pytest.MonkeyPatch) -> None:
    # The other client only has a video-only stream: yt-dlp's "b" would take it for the mp3.
    media_server.refuse = {"VISIONOS"}
    def make_raw() -> dict[str, Any]:
        raw = _real_raw(media_server.base)
        raw["formats"] = [f for f in raw["formats"]
                          if not (f["format_id"].startswith("140") and "WEB-E" in f["format_note"])]
        return raw

    _use_raw(make_raw)
    monkeypatch.setattr(worker.yt_dlp, "YoutubeDL", _RealYdl)
    work = tmp_path / "job"
    work.mkdir()
    with pytest.raises(DownloadError, match="HTTP Error 403") as excinfo:  # not "Requested format is not available"
        worker.run_download(_task(work, "mp3"), CFG, work, Reporter(_Conn()))
    assert worker.map_ytdlp_error(str(excinfo.value), "youtube").code == "upstream_forbidden"
    assert [r for r in media_server.requests if r[1] != "thumb"] == [("VISIONOS", "140")]
    assert _RealYdl.extractions == 1


# --- hev1 -> hvc1 --------------------------------------------------------------------------------------


def _libx265() -> bool:
    if not shutil.which("ffmpeg"):
        return False
    out = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=30)
    return "libx265" in out.stdout


@pytest.fixture
def hev1_file(tmp_path: Path) -> Path:
    if not _libx265():
        pytest.skip("ffmpeg without libx265: cannot generate an HEVC sample")
    path = tmp_path / "abcdefghijk.mp4"
    _ffmpeg("-f", "lavfi", "-i", "testsrc=size=128x96:rate=10", "-f", "lavfi", "-i", "sine=duration=1",
            "-t", "1", "-c:v", "libx265", "-x265-params", "log-level=error", "-tag:v", "hev1", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest", str(path))
    assert _probe(path)["streams"][0]["codec_tag_string"] == "hev1"
    return path


def test_hev1_is_remuxed_to_hvc1(hev1_file: Path, tmp_path: Path) -> None:
    out = hevc_to_hvc1(hev1_file, tmp_path, Reporter(_Conn()))
    assert out == hev1_file
    streams = _probe(out)["streams"]
    video = next(s for s in streams if s["codec_type"] == "video")
    assert (video["codec_name"], video["codec_tag_string"]) == ("hevc", "hvc1")
    assert any(s["codec_type"] == "audio" for s in streams)  # audio kept
    assert sorted(p.name for p in tmp_path.iterdir()) == ["abcdefghijk.mp4"]  # no leftover


def test_hvc1_and_h264_left_untouched(media_server: _MediaServer, tmp_path: Path) -> None:
    source = media_server.files["137"]
    before = source.stat().st_mtime_ns
    assert hevc_to_hvc1(source, tmp_path, Reporter(_Conn())) == source and source.stat().st_mtime_ns == before
    mkv = tmp_path / "x.mkv"
    mkv.write_bytes(b"not probed")
    assert hevc_to_hvc1(mkv, tmp_path, Reporter(_Conn())) == mkv


def test_download_remuxes_hev1(fake_ydl: type[FakeYdl], hev1_file: Path, tmp_path: Path,
                               monkeypatch: pytest.MonkeyPatch) -> None:
    for f in fake_ydl.raw["formats"]:
        if f["vcodec"] != "none":
            f["vcodec"] = "hev1.1.6.L93.B0"
    sample = hev1_file.read_bytes()
    work = tmp_path / "job"
    work.mkdir()
    original = FakeYdl.process_ie_result

    def download_hevc(self: FakeYdl, info: dict[str, Any], download: bool = True) -> dict[str, Any]:
        result = original(self, info, download)
        if download:
            Path(result["requested_downloads"][0]["filepath"]).write_bytes(sample)
        return result

    monkeypatch.setattr(FakeYdl, "process_ie_result", download_hevc)
    result = worker.run_download(_task(work), CFG, work, Reporter(_Conn()))
    video = next(s for s in _probe(Path(result["filepath"]))["streams"] if s["codec_type"] == "video")
    assert video["codec_tag_string"] == "hvc1" and result["size"] == Path(result["filepath"]).stat().st_size
