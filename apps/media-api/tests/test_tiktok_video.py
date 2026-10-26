"""A video download always has a picture: TikTok .mp4 in H.264, no "video" delivered without a video track.

Regression of the TikTok MP4 that played sound without picture: yt-dlp's default ranking took TikTok's
HEVC ("bytevc1") file, which Chrome/Edge without hardware HEVC and Windows without the HEVC extension
cannot decode. Offline: the real yt-dlp selects, downloads (from a local HTTP server that plays TikTok's
media servers), merges and post-processes; only the extraction is fake. Media: conftest.media_samples.
"""

from __future__ import annotations

import json
import subprocess
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest
import yt_dlp

import app.worker as worker
from app.errors import ApiError
from app.worker import Reporter, check_video_track

TT = "https://www.tiktok.com/@nasa/video/7691727731800673549"
CFG = {"max_filesize_bytes": 10**9, "cache_dir": None, "max_duration_s": 3600, "transcode_max_duration_s": 900,
       "gif_max_duration_s": 30, "extractor_args": {}}


class _Conn:
    def send(self, message: dict[str, Any]) -> None:
        pass


def _probe(path: Path) -> dict[str, Any]:
    out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
                         capture_output=True, text=True, check=True, timeout=60)
    return json.loads(out.stdout)


def _kinds(path: Path) -> list[tuple[str, str]]:
    return [(s["codec_type"], s["codec_name"]) for s in _probe(path)["streams"]]


def _need(samples: dict[str, Path], *names: str) -> None:
    if missing := [n for n in names if n not in samples]:
        pytest.skip(f"ffmpeg without libx265: no {', '.join(missing)} sample")


# --- check_video_track ------------------------------------------------------------------------------


def test_real_video_track_passes(media_samples: dict[str, Path]) -> None:
    checked = check_video_track(media_samples["h264"], h264=True)
    assert (checked["codec"], checked["width"], checked["height"]) == ("h264", 72, 128)
    assert 2.9 <= checked["duration"] <= 3.1
    assert checked["frames"] == 5 and checked["middle_frames"] == 3


@pytest.mark.parametrize("sample", ["audio_only", "audio_cover"])
def test_sound_only_mp4_is_refused(media_samples: dict[str, Path], sample: str) -> None:
    if sample == "audio_cover":  # the cover art is a video stream for ffprobe, but not a video track
        assert [s["disposition"]["attached_pic"] for s in _probe(media_samples[sample])["streams"]
                if s["codec_type"] == "video"] == [1]
    with pytest.raises(ApiError) as excinfo:
        check_video_track(media_samples[sample])
    assert (excinfo.value.status, excinfo.value.code) == (422, "format_unavailable")
    assert "aucune piste vidéo" in excinfo.value.detail


def test_undecodable_video_is_refused(media_samples: dict[str, Path]) -> None:
    meta = _probe(media_samples["broken"])  # headers intact: ffprobe alone would accept it
    assert any(s["codec_type"] == "video" and s["width"] == 72 for s in meta["streams"])
    with pytest.raises(ApiError) as excinfo:
        check_video_track(media_samples["broken"])
    assert (excinfo.value.status, excinfo.value.code) == (500, "conversion_failed")


def test_hevc_refused_where_h264_is_required(media_samples: dict[str, Path]) -> None:
    _need(media_samples, "hevc")
    assert check_video_track(media_samples["hevc"])["codec"] == "hevc"  # elsewhere: a real, decodable track
    with pytest.raises(ApiError) as excinfo:
        check_video_track(media_samples["hevc"], h264=True)
    assert excinfo.value.code == "conversion_failed"


def test_tiktok_transcode_duration_limit() -> None:
    params = {"fmt": "mp4", "quality": "1080", "transcode": False, "platform": "tiktok"}
    with pytest.raises(ApiError) as excinfo:
        worker._check_request_limits({"duration": 1000, "vcodec": "h265"}, params, CFG)
    assert excinfo.value.code == "transcode_too_long" and "HEVC" in excinfo.value.detail
    worker._check_request_limits({"duration": 1000, "vcodec": "h264"}, params, CFG)  # H.264: no re-encoding
    worker._check_request_limits({"duration": 1000, "vcodec": "h265"}, params | {"platform": "youtube"}, CFG)


# --- real yt-dlp against a local "TikTok" -------------------------------------------------------------


class _TikTokServer:
    """One URL per format, each serving a local file; records the formats requested."""

    def __init__(self, files: dict[str, Path]) -> None:
        self.files = files
        self.requests: list[str] = []
        server = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                name = self.path.strip("/").partition("?")[0]
                server.requests.append(name)
                data = server.files[name].read_bytes()
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
def tiktok(media_samples: dict[str, Path]) -> Iterator[_TikTokServer]:
    server = _TikTokServer({"cover": media_samples["cover"], "audio": media_samples["music"]})
    yield server
    server.close()


def _fmt(server: _TikTokServer, fid: str, sample: Path, vcodec: str, width: int, height: int, quality: int | None,
         preference: int = -1, acodec: str = "aac") -> dict[str, Any]:
    server.files[fid] = sample
    return {"format_id": fid, "url": f"{server.base}/{fid}", "ext": "mp4", "vcodec": vcodec, "acodec": acodec,
            "width": width, "height": height, "quality": quality, "preference": preference}


def _raw(server: _TikTokServer, formats: list[dict[str, Any]]) -> dict[str, Any]:
    music = {"format_id": "audio", "url": f"{server.base}/audio", "ext": "mp3", "acodec": "mp3", "vcodec": "none"}
    return {"id": "7691727731800673549", "title": "Essai TikTok", "duration": 3, "formats": [*formats, music],
            "thumbnails": [{"url": f"{server.base}/cover", "id": "cover"}],
            "extractor": "TikTok", "extractor_key": "TikTok", "webpage_url": TT, "original_url": TT,
            "webpage_url_basename": "7691727731800673549", "webpage_url_domain": "tiktok.com"}


def _download(raw: dict[str, Any], tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fmt: str = "mp4",
              quality: str = "best") -> dict[str, Any]:
    class TikTokYdl(yt_dlp.YoutubeDL):
        def extract_info(self, url: str, download: bool = True, ie_key: Any = None, extra_info: Any = None,
                         process: bool = True, force_generic_extractor: bool = False) -> dict[str, Any]:
            assert process is False and download is False
            return json.loads(json.dumps(raw))

    monkeypatch.setattr(worker.yt_dlp, "YoutubeDL", TikTokYdl)
    work = tmp_path / "job"
    work.mkdir()
    params = {"fmt": fmt, "quality": quality, "bitrate": 192, "transcode": False, "index": 1}
    task = {"kind": "download", "url": TT, "platform": "tiktok", "workdir": str(work), "params": params}
    return worker.run_download(task, CFG, work, Reporter(_Conn()))  # type: ignore[arg-type]


def _nasa_like(server: _TikTokServer, samples: dict[str, Path], h264: bool = True,
               hevc_sample: str = "hevc", hevc_acodec: str = "aac") -> list[dict[str, Any]]:
    """TikTok's list for the NASA post (see test_formats.TIKTOK_LIKE), real clips behind each URL."""
    formats = [_fmt(server, "download", samples["h264"], "h264", 0, 0, None, preference=-2)]
    for fid, w, h, q in (("bytevc1_540p_167277", 576, 1024, 1), ("bytevc1_720p_209003", 720, 1280, 2),
                         ("bytevc1_1080p_289672", 1080, 1920, 3)):
        formats.append(_fmt(server, fid, samples[hevc_sample], "h265", w, h, q, acodec=hevc_acodec))
    if h264:
        formats.append(_fmt(server, "h264_720p_405934", samples["h264"], "h264", 720, 1280, 2))
    return formats


def test_tiktok_mp4_is_the_muxed_h264_file(tiktok: _TikTokServer, media_samples: dict[str, Path],
                                           tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _need(media_samples, "hevc")
    result = _download(_raw(tiktok, _nasa_like(tiktok, media_samples)), tmp_path, monkeypatch)
    assert tiktok.requests == ["h264_720p_405934"]  # never the HEVC files, the watermark or the music
    path = Path(result["filepath"])
    assert result["ext"] == "mp4" and _kinds(path) == [("video", "h264"), ("audio", "aac")]
    assert path.read_bytes() == media_samples["h264"].read_bytes()  # delivered as is, no re-encoding
    assert not any("réencodée" in n for n in result["notes"])


@pytest.mark.parametrize("quality", ["best", "1080"])
def test_tiktok_hevc_is_reencoded_to_h264(tiktok: _TikTokServer, media_samples: dict[str, Path], tmp_path: Path,
                                          monkeypatch: pytest.MonkeyPatch, quality: str) -> None:
    # best without any H.264 file, or a resolution TikTok only has in HEVC: the bug's file, now re-encoded.
    _need(media_samples, "hevc")
    result = _download(_raw(tiktok, _nasa_like(tiktok, media_samples, h264=quality != "best")), tmp_path,
                       monkeypatch, quality=quality)
    assert tiktok.requests == ["bytevc1_1080p_289672"]
    path = Path(result["filepath"])
    assert result["ext"] == "mp4" and path.suffix == ".mp4"
    assert _kinds(path) == [("video", "h264"), ("audio", "aac")]
    video = next(s for s in _probe(path)["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"], video["pix_fmt"]) == (108, 192, "yuv420p")
    assert 2.9 <= float(_probe(path)["format"]["duration"]) <= 3.1
    assert check_video_track(path, h264=True)["frames"] == 5
    assert "Vidéo hevc réencodée en H.264." in result["notes"]


def test_tiktok_video_only_hevc_never_gets_the_music_track(tiktok: _TikTokServer, media_samples: dict[str, Path],
                                                           tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _need(media_samples, "hevc_video_only")
    formats = _nasa_like(tiktok, media_samples, hevc_sample="hevc_video_only", hevc_acodec="none")
    result = _download(_raw(tiktok, formats), tmp_path, monkeypatch)
    assert tiktok.requests == ["h264_720p_405934"]
    assert _kinds(Path(result["filepath"])) == [("video", "h264"), ("audio", "aac")]


def test_tiktok_only_video_only_hevc_still_gives_picture_and_sound(
        tiktok: _TikTokServer, media_samples: dict[str, Path], tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Nothing muxed at all: the HEVC picture with the only sound offered, re-encoded to H.264 + AAC.
    _need(media_samples, "hevc_video_only")
    formats = [f for f in _nasa_like(tiktok, media_samples, h264=False, hevc_sample="hevc_video_only",
                                     hevc_acodec="none") if f["format_id"] != "download"]
    result = _download(_raw(tiktok, formats), tmp_path, monkeypatch)
    assert sorted(tiktok.requests) == ["audio", "bytevc1_1080p_289672"]
    assert _kinds(Path(result["filepath"])) == [("video", "h264"), ("audio", "aac")]


def test_tiktok_sound_only_file_is_never_delivered_as_mp4(
        tiktok: _TikTokServer, media_samples: dict[str, Path], tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # A "video" format whose file only holds sound: an explicit error, never a successful job.
    formats = [_fmt(tiktok, "h264_720p_405934", media_samples["audio_only"], "h264", 720, 1280, 2)]
    with pytest.raises(ApiError) as excinfo:
        _download(_raw(tiktok, formats), tmp_path, monkeypatch)
    assert excinfo.value.code == "format_unavailable"


def test_tiktok_mp3_is_the_video_soundtrack(tiktok: _TikTokServer, media_samples: dict[str, Path],
                                            tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _need(media_samples, "hevc")
    result = _download(_raw(tiktok, _nasa_like(tiktok, media_samples)), tmp_path, monkeypatch, fmt="mp3")
    assert "audio" not in tiktok.requests  # the post's own sound, not the attached music track
    assert result["ext"] == "mp3" and ("audio", "mp3") in _kinds(Path(result["filepath"]))
