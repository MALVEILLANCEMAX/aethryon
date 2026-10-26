"""Regression tests for the issues found by the adversarial review (2026-10-07)."""

import asyncio
import os
import socket
import stat
import threading
import time
from pathlib import Path

import pytest
import uvicorn
from fastapi.testclient import TestClient

from app.config import DEFAULT_ALLOWED_DOMAINS, parse_domains
from app.errors import ApiError, map_ytdlp_error
from app.main import create_app
from app.runner import Runner, _acquire
from app.urls import validate_media_url
from app.worker import (
    DownloadProgress,
    FileTooLarge,
    Reporter,
    _pick_entry,
    base_options,
    format_options,
    make_gif,
    run_ffmpeg,
    transcode_to_h264,
)
from tests.conftest import TOKEN

ALLOWED = parse_domains(DEFAULT_ALLOWED_DOMAINS)
URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


# --- client disconnects reach the handlers (no BaseHTTPMiddleware) ---------------------------


def _serve(app) -> tuple[uvicorn.Server, threading.Thread, int]:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", lifespan="on"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.05)
    return server, thread, port


def _open_get(port: int, path: str) -> socket.socket:
    raw = socket.create_connection(("127.0.0.1", port))
    raw.sendall(f"GET {path} HTTP/1.1\r\nHost: test\r\nAuthorization: Bearer {TOKEN}\r\n\r\n".encode())
    return raw


def _wait_until(predicate, timeout: float = 10) -> bool:
    deadline = time.monotonic() + timeout
    while not predicate() and time.monotonic() < deadline:
        time.sleep(0.05)
    return predicate()


def test_disconnect_cancels_running_and_queued_downloads(settings, fake_worker) -> None:
    import dataclasses

    effective = dataclasses.replace(settings, max_concurrent=1, max_queue=5)
    runner = Runner(effective)
    runner._run = fake_worker  # type: ignore[method-assign]
    app = create_app(effective, runner)
    fake_worker.delay_s = 30
    server, thread, port = _serve(app)
    try:
        path = "/dl?url=https%3A%2F%2Fyoutu.be%2FjNQXAC9IVRw"
        running = _open_get(port, path)
        assert _wait_until(lambda: len(fake_worker.calls) == 1)
        queued = _open_get(port, path)
        assert _wait_until(lambda: runner.pending == 2)
        queued.close()  # abandoned while waiting for a slot
        assert _wait_until(lambda: runner.pending == 1), "the queued request must leave the queue"
        assert len(fake_worker.calls) == 1, "the abandoned queued request must never start"
        running.close()  # abandoned while downloading
        assert _wait_until(lambda: runner.pending == 0 and fake_worker.cancelled == 1)
        time.sleep(1.5)
        assert len(fake_worker.calls) == 1
    finally:
        server.should_exit = True
        thread.join(10)


# --- /dl bookkeeping --------------------------------------------------------------------------


def test_dl_releases_reservation_when_workdir_fails(make_client, settings) -> None:
    client = make_client(max_concurrent=1, max_queue=0)
    broken = settings.tmp_dir
    for child in broken.iterdir():
        child.rmdir()
    broken.rmdir()
    broken.write_text("not a directory")
    no_raise = TestClient(client.app, raise_server_exceptions=False)
    assert no_raise.get("/dl", params={"url": URL}, headers=AUTH).status_code == 500
    assert client.app.state.runner.pending == 0
    broken.unlink()
    broken.mkdir()
    assert client.get("/dl", params={"url": URL}, headers=AUTH).status_code == 200


@pytest.mark.parametrize("range_header", ["bytes=999999-", "items=0-1"])
def test_dl_cleans_up_after_range_errors(client, settings, range_header: str) -> None:
    res = client.get("/dl", params={"url": URL}, headers=AUTH | {"Range": range_header})
    assert res.status_code in (400, 416)
    assert list(settings.tmp_dir.iterdir()) == []


def test_insufficient_storage(make_client, monkeypatch) -> None:
    client = make_client()
    import app.runner as runner_module

    monkeypatch.setattr(runner_module.shutil, "disk_usage", lambda _: type("U", (), {"free": 10})())
    res = client.post("/jobs", json={"url": URL}, headers=AUTH)
    assert res.status_code == 503 and res.json()["error"] == "insufficient_storage"
    assert client.app.state.runner.pending == 0


# --- /health ------------------------------------------------------------------------------


def test_health_is_public_and_never_checks_tokens(client) -> None:
    for headers in ({}, {"Authorization": f"Bearer {TOKEN}"}, {"Authorization": "Bearer nope"}):
        body = client.get("/health", headers=headers).json()
        assert body == {"status": "ok", "versions": body["versions"]}
        assert set(body["versions"]) == {"yt_dlp", "ffmpeg"}
    # 15 wrong tokens on /health must not count as auth failures (no lockout, no oracle).
    for _ in range(15):
        client.get("/health", headers={"Authorization": "Bearer nope"})
    assert client.get("/status", headers=AUTH).status_code == 200


# --- jobs JSON ------------------------------------------------------------------------------


def test_job_json_has_no_null_error(client) -> None:
    body = client.post("/jobs", json={"url": URL}, headers=AUTH).json()
    assert "error" not in body and "detail" not in body


def test_twitter_url_index(client, fake_worker) -> None:
    client.get("/dl", params={"url": "https://x.com/a/status/1/video/2"}, headers=AUTH)
    task = fake_worker.calls[-1]
    assert task.url == "https://x.com/a/status/1"
    assert task.params["index"] == 2 and task.params["index_from_url"] is True
    client.get("/dl", params={"url": "https://x.com/a/status/1/video/2", "index": "1"}, headers=AUTH)
    assert fake_worker.calls[-1].params["index"] == 1
    assert fake_worker.calls[-1].params["index_from_url"] is False


def test_pick_entry_index_from_url_is_lenient_for_single_media() -> None:
    single = {"_type": "video", "id": "v"}
    assert _pick_entry(single, "twitter", 2, index_from_url=True) is single
    with pytest.raises(ApiError):
        _pick_entry(single, "twitter", 2, index_from_url=False)
    with pytest.raises(ApiError) as excinfo:
        _pick_entry({"_type": "playlist", "entries": []}, "twitter", 3, index_from_url=True)
    assert "index=K" in excinfo.value.detail


# --- URL handling ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/playlist?list=PL1",
        "https://www.youtube.com/@jawed",
        "https://www.youtube.com/@jawed/videos",
        "https://www.youtube.com/channel/UC1",
        "https://www.youtube.com/c/foo",
        "https://www.youtube.com/user/foo",
        "https://www.youtube.com/results?search_query=x",
        "https://www.youtube.com/feed/trending",
        "https://m.youtube.com/browse/VL1",
        "https://www.youtube.com/",
    ],
)
def test_youtube_collections_rejected_without_network(url: str) -> None:
    with pytest.raises(ApiError) as excinfo:
        validate_media_url(url, ALLOWED)
    assert excinfo.value.code == "playlist_not_supported"


def test_watch_url_with_list_is_still_a_video() -> None:
    assert validate_media_url("https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PL1", ALLOWED).platform == "youtube"


# --- yt-dlp options ------------------------------------------------------------------------


def test_extract_flat_for_non_twitter(tmp_path) -> None:
    cfg = {"max_filesize_bytes": 1, "cache_dir": None, "cookies_file": None}
    assert base_options(cfg, tmp_path, "youtube")["extract_flat"] == "in_playlist"
    assert "extract_flat" not in base_options(cfg, tmp_path, "twitter")


def test_twitter_shortener_not_allowed() -> None:
    import yt_dlp

    ydl = yt_dlp.YoutubeDL({"allowed_extractors": base_options(
        {"max_filesize_bytes": 1, "cache_dir": None, "cookies_file": None}, Path("/tmp"), "twitter"
    )["allowed_extractors"], "quiet": True})
    names = {n.lower() for n in ydl._ies}
    assert "twittershortener" not in names
    assert "twitter" in names


def test_unreadable_cookies_are_ignored(tmp_path, monkeypatch) -> None:
    cfg = {"max_filesize_bytes": 1, "cache_dir": None}
    assert "cookiefile" not in base_options(cfg, tmp_path, "youtube", str(tmp_path / "missing.txt"))
    import app.worker as worker

    def deny(*_a, **_k):
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(worker.shutil, "copyfile", deny)
    assert "cookiefile" not in base_options(cfg, tmp_path, "youtube", str(tmp_path))


def test_transcode_best_is_capped_at_2160() -> None:
    params = {"fmt": "mp4", "quality": "best", "transcode": True, "platform": "youtube", "bitrate": 192}
    assert format_options(params)["format_sort"][0] == "res:2160"


def test_tiktok_mp3_uses_the_video_soundtrack() -> None:
    assert format_options({"fmt": "mp3", "bitrate": 192, "platform": "tiktok"})["format"] == "b/ba"
    assert format_options({"fmt": "mp3", "bitrate": 192, "platform": "youtube"})["format"] == "ba/b"


def test_mp3_without_cover() -> None:
    opts = format_options({"fmt": "mp3", "bitrate": 192}, cover=False)
    assert "writethumbnail" not in opts
    assert [pp["key"] for pp in opts["postprocessors"]] == ["FFmpegExtractAudio", "FFmpegMetadata"]


# --- progress ---------------------------------------------------------------------------------


class _Conn:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    def send(self, message: dict) -> None:
        self.sent.append(message)


def test_progress_uses_real_size_and_aborts_early_on_known_size() -> None:
    conn = _Conn()
    progress = DownloadProgress(Reporter(conn), max_bytes=1000)
    progress({"status": "downloading", "downloaded_bytes": 10, "total_bytes_estimate": 900, "info_dict": {"format_id": "a"}})
    progress({"status": "finished", "downloaded_bytes": 100, "info_dict": {"format_id": "a"}})
    assert progress.expected["a"] == 100
    assert conn.sent[-1]["percent"] == pytest.approx(100.0)
    with pytest.raises(FileTooLarge):
        progress({"status": "downloading", "downloaded_bytes": 0, "total_bytes": 950, "info_dict": {"format_id": "b"}})


@pytest.mark.anyio
async def test_slot_wait_is_fifo() -> None:
    sem = asyncio.Semaphore(1)
    await sem.acquire()
    order: list[str] = []

    async def never() -> bool:
        return False

    async def waiter(name: str, delay: float) -> None:
        await asyncio.sleep(delay)
        await _acquire(sem, never)
        order.append(name)
        sem.release()

    tasks = [asyncio.create_task(waiter(n, d)) for n, d in (("A", 0.0), ("B", 0.4), ("C", 0.8))]
    await asyncio.sleep(2.5)  # several 1 s polling rounds
    sem.release()
    await asyncio.gather(*tasks)
    assert order == ["A", "B", "C"]


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


# --- error mapping additions -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("message", "code"),
    [
        ("ERROR: [TikTok] 7404412345678901234: Requested format is not available", "format_unavailable"),
        ("ERROR: [twitter] 1840404123456789012: HTTP Error 429: Too Many Requests", "upstream_rate_limited"),
        ("ERROR: [twitter] 1: Requested tweet is unavailable", "not_found"),
        ("ERROR: [twitter] 1: Twitter API says: This Post is from a suspended account", "not_found"),
        ("ERROR: [youtube] x: This video is DRM protected", "unsupported_content"),
        ("ERROR: Postprocessing: WARNING: unable to obtain file audio codec with ffprobe", "no_audio"),
        ("ERROR: Preprocessing: Conversion failed!", "conversion_failed"),
        ("ERROR: Cookies file must be Netscape formatted, not JSON", "cookies_invalid"),
        ("ERROR: [youtube] x: This live stream recording is not available.", "not_found"),
    ],
)
def test_more_error_mapping(message: str, code: str) -> None:
    assert map_ytdlp_error(message, "twitter" if "twitter" in message else "youtube").code == code


# --- ffmpeg -------------------------------------------------------------------------------


def test_run_ffmpeg_survives_a_stderr_flood(tmp_path, monkeypatch) -> None:
    fake = tmp_path / "ffmpeg"
    fake.write_text("#!/bin/sh\nhead -c 300000 /dev/zero | tr '\\0' x >&2\necho out_time_us=1000000\nexit 0\n")
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{tmp_path}{os.pathsep}{os.environ['PATH']}")
    started = time.monotonic()
    run_ffmpeg([], 2.0, Reporter(_Conn()), "test")
    assert time.monotonic() - started < 10


needs_ffmpeg = pytest.mark.skipif(not Path("/usr/bin/ffmpeg").exists(), reason="ffmpeg not installed")


def _synthetic(path: Path, size: str, codec: list[str], seconds: str = "1") -> Path:
    import subprocess

    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc=size={size}:rate=10",
                    "-t", seconds, *codec, str(path)], check=True)
    return path


@needs_ffmpeg
def test_transcode_handles_odd_dimensions(tmp_path) -> None:
    source = _synthetic(tmp_path / "odd.webm", "405x721", ["-c:v", "libvpx-vp9", "-b:v", "200k"])
    final, note = transcode_to_h264(source, tmp_path, Reporter(_Conn()))
    assert final.suffix == ".mp4" and final.exists()
    assert note and "H.264" in note


@needs_ffmpeg
def test_make_gif(tmp_path) -> None:
    source = _synthetic(tmp_path / "clip.mp4", "640x360", ["-c:v", "libx264", "-pix_fmt", "yuv420p"], "2")
    gif = make_gif(source, tmp_path, {"gif_width": 320, "gif_fps": 10},
                   {"gif_max_duration_s": 30}, Reporter(_Conn()))
    assert gif.suffix == ".gif" and gif.read_bytes()[:6] in (b"GIF89a", b"GIF87a")
