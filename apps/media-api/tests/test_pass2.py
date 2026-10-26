"""Second pass (2026-10-07): YouTube breaker/limiter, cache, merge, tokens, cookies, /status, ?wait."""

import asyncio
import dataclasses
import os
import stat
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.cache import ResultCache, cache_key
from app.config import ConfigError, load_settings, parse_proxy
from app.cookies import CookieMonitor, validate
from app.errors import ApiError, map_ytdlp_error
from app.platforms import PlatformMonitor
from app.tokens import TokenStore, parse_tokens, write_tokens_file
from app.urls import media_key, validate_media_url
from app.worker import DownloadProgress, Reporter, _extract, base_options, postprocess_hook, run_ffmpeg
from app.config import DEFAULT_ALLOWED_DOMAINS, parse_domains
from tests.conftest import TOKEN

ALLOWED = parse_domains(DEFAULT_ALLOWED_DOMAINS)
AUTH = {"Authorization": f"Bearer {TOKEN}"}
YT = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
TT = "https://www.tiktok.com/@scout2015/video/6718335390845095173"


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class _Conn:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    def send(self, message: dict) -> None:
        self.sent.append(message)


# --- A1: YouTube rate limit vs "deleted" ----------------------------------------------------


@pytest.mark.parametrize(
    "message",
    [
        "ERROR: [youtube] x: Video unavailable. This content isn't available, try again later. "
        "The current session has been rate-limited by YouTube for up to an hour.",
        "ERROR: [youtube] x: Video unavailable. This content isn’t available, try again later.",
        "ERROR: [youtube] x: HTTP Error 429: Too Many Requests",
    ],
)
def test_youtube_session_rate_limit_is_503(message: str) -> None:
    err = map_ytdlp_error(message, "youtube")
    assert (err.status, err.code) == (503, "upstream_rate_limited")


def test_not_available_on_this_app_means_update() -> None:
    err = map_ytdlp_error("ERROR: [youtube] x: The following content is not available on this app.. "
                          "Watch on the latest version of YouTube.", "youtube")
    assert err.code == "extractor_broken"


def test_plain_deleted_video_is_still_404() -> None:
    assert map_ytdlp_error("ERROR: [youtube] x: Video unavailable", "youtube").code == "not_found"


# --- B: circuit breaker --------------------------------------------------------------------


def test_breaker_opens_after_bot_check_and_spares_other_platforms(make_client, fake_worker) -> None:
    client = make_client(yt_cooldown_min=15)
    fake_worker.error = ApiError(503, "bot_check", "robot")
    first = client.get("/dl", params={"url": YT}, headers=AUTH)
    assert first.status_code == 503
    assert first.json()["error"] == "bot_check"
    assert first.headers["retry-after"] == str(15 * 60)
    calls = len(fake_worker.calls)
    # While cooling down: immediate 503 + Retry-After, YouTube is not contacted.
    for path, kwargs in (("/dl", {"params": {"url": YT}}), ("/info", {"params": {"url": YT}})):
        res = client.get(path, headers=AUTH, **kwargs)
        assert res.status_code == 503 and res.json()["error"] == "bot_check"
        assert 0 < int(res.headers["retry-after"]) <= 15 * 60
    res = client.post("/jobs", json={"url": YT}, headers=AUTH)
    assert res.status_code == 503 and "Retry-After" in res.headers
    assert len(fake_worker.calls) == calls
    # Other platforms are not affected.
    fake_worker.error = None
    assert client.get("/dl", params={"url": TT}, headers=AUTH).status_code == 200
    status = client.get("/status", headers=AUTH).json()["platforms"]
    assert status["youtube"]["state"] == "bot_check" and status["youtube"]["cooldown_until"]
    assert status["tiktok"]["state"] == "ok" and status["tiktok"]["last_success"]


def test_breaker_rate_limited_then_recovers(make_client, fake_worker, monkeypatch) -> None:
    client = make_client(yt_cooldown_min=1)
    fake_worker.error = ApiError(503, "upstream_rate_limited", "limite")
    assert client.get("/dl", params={"url": YT}, headers=AUTH).status_code == 503
    monitor = client.app.state.runner.platforms
    monitor.states["youtube"].cooldown_until = time.time() - 1  # cooldown over
    fake_worker.error = None
    assert client.get("/dl", params={"url": YT}, headers=AUTH).status_code == 200
    assert monitor.states["youtube"].state == "ok"


def test_content_errors_do_not_open_the_breaker(make_client, fake_worker) -> None:
    client = make_client()
    fake_worker.error = ApiError(404, "not_found", "supprimé")
    assert client.get("/dl", params={"url": YT}, headers=AUTH).status_code == 404
    assert client.app.state.runner.platforms.states["youtube"].cooldown_until is None


# --- B: limiter ----------------------------------------------------------------------------


@pytest.mark.anyio
async def test_youtube_limiter_one_at_a_time_and_min_interval() -> None:
    monitor = PlatformMonitor(cooldown_min=15, concurrency=1, min_interval_s=0.3)
    started = time.monotonic()
    first = await monitor.acquire("youtube")
    waiter = asyncio.create_task(monitor.acquire("youtube"))
    await asyncio.sleep(0.1)
    assert not waiter.done()  # only one extraction at a time
    first.release()
    second = await waiter
    assert time.monotonic() - started >= 0.29  # min interval between two extraction starts
    second.release()
    other = await monitor.acquire("tiktok")  # other platforms are never gated
    assert other.released


# --- A3/A4: URLs -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?list=PLx",
        "https://www.youtube.com/watch?list=PLx&index=3",
        "https://m.youtube.com/watch?list=PLx",
        "https://www.youtube.com/embed/videoseries?list=PLx",
        "https://www.youtube-nocookie.com/embed/videoseries?list=PLx",
        "https://www.youtube.com/playlist?list=PLx",
        "https://www.youtube.com/@chan/videos",
        "https://youtu.be/",
    ],
)
def test_playlists_rejected_before_yt_dlp(url: str) -> None:
    with pytest.raises(ApiError) as excinfo:
        validate_media_url(url, ALLOWED)
    assert excinfo.value.code == "playlist_not_supported"


@pytest.mark.parametrize(
    "url",
    [
        "https://youtu.be/feedBACK123",
        "https://youtu.be/FEEDxyzABCD",
        "https://youtu.be/resultsABCD",
        "https://youtu.be/gamingABCDE",
        "https://youtu.be/premiumABCD",
        "https://youtu.be/playlistABC",
        "https://youtu.be/podcastsABC",
        "https://youtu.be/jNQXAC9IVRw?list=PLx",
        "https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PLx",
        "https://www.youtube.com/embed/jNQXAC9IVRw?list=PLx",
        "https://www.youtube.com/shorts/18NGQq7p3LY",
        "https://www.youtube.com/live/abcdefghijk",
        "https://www.youtube.com/clip/UgkxAbC",
    ],
)
def test_single_videos_accepted(url: str) -> None:
    assert validate_media_url(url, ALLOWED).platform == "youtube"


def test_extract_rejects_redirect_to_playlist_without_paging() -> None:
    class FakeYdl:
        processed = False

        def extract_info(self, url, download, process):
            assert process is False
            return {"_type": "url", "url": "https://www.youtube.com/playlist?list=PLx", "ie_key": "YoutubeTab"}

        def process_ie_result(self, *_a, **_k):
            FakeYdl.processed = True

    with pytest.raises(ApiError) as excinfo:
        _extract(FakeYdl(), "https://www.youtube.com/watch?list=PLx", "youtube")
    assert excinfo.value.code == "playlist_not_supported"
    assert not FakeYdl.processed


@pytest.mark.parametrize(
    ("url", "key"),
    [
        ("https://youtu.be/jNQXAC9IVRw?si=AAAA", "youtube:jNQXAC9IVRw"),
        ("https://youtu.be/jNQXAC9IVRw?si=BBBB", "youtube:jNQXAC9IVRw"),
        ("https://www.youtube.com/watch?v=jNQXAC9IVRw&t=10", "youtube:jNQXAC9IVRw"),
        ("https://m.youtube.com/shorts/18NGQq7p3LY?feature=share", "youtube:18NGQq7p3LY"),
        ("https://m.youtube.com/watch?v=jNQXAC9IVRw&si=x", "youtube:jNQXAC9IVRw"),
        ("https://tiktok.com/@a/video/123?_r=1", "tiktok:123"),
        ("https://x.com/a/status/42?s=46&t=x", "twitter:42"),
        ("https://twitter.com/a/status/42/video/2", "twitter:42"),
    ],
)
def test_media_key_ignores_share_parameters(url: str, key: str) -> None:
    assert media_key(validate_media_url(url, ALLOWED)) == key


# --- A6: disk floor ----------------------------------------------------------------------------


def test_disk_floor_counts_admitted_downloads(make_client, monkeypatch) -> None:
    client = make_client(max_filesize_mb=100, max_concurrent=1, max_queue=5)
    runner = client.app.state.runner
    floor = 2 * 100 * 2**20 + 512 * 2**20
    import app.runner as runner_module

    monkeypatch.setattr(runner_module.shutil, "disk_usage",
                        lambda _p: type("U", (), {"free": floor + 50 * 2**20})())
    runner.reserve()  # 0 admitted: 50 MiB above the floor
    with pytest.raises(ApiError) as excinfo:
        runner.reserve()  # 1 admitted (up to 100 MiB still to come): 50 MiB below
    assert excinfo.value.code == "insufficient_storage"
    runner.release()
    assert runner.pending == 0


# --- A7: ffmpeg stderr -----------------------------------------------------------------------


def test_run_ffmpeg_non_utf8_stderr_is_conversion_failed(tmp_path, monkeypatch, caplog) -> None:
    fake = tmp_path / "ffmpeg"
    fake.write_text("#!/bin/sh\nprintf '\\377\\376\\303' >&2\nhead -c 3000 /dev/zero | tr '\\0' '\\351' >&2\nexit 1\n")
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{tmp_path}{os.pathsep}{os.environ['PATH']}")
    with pytest.raises(ApiError) as excinfo:
        run_ffmpeg([], 1.0, Reporter(_Conn()), "test")
    assert excinfo.value.code == "conversion_failed"
    assert any(r.getMessage() == "ffmpeg failed" for r in caplog.records)


# --- A2: mp3 progress ---------------------------------------------------------------------------


def test_pre_download_postprocessor_does_not_jump_to_80_percent() -> None:
    conn = _Conn()
    reporter = Reporter(conn)
    reporter.band = (0.0, 80.0)
    progress = DownloadProgress(reporter, max_bytes=10**9)
    hook = postprocess_hook(progress, reporter)
    hook({"status": "started", "postprocessor": "ThumbnailsConvertor"})  # before_dl
    assert not conn.sent
    progress({"status": "downloading", "downloaded_bytes": 50, "total_bytes": 100, "info_dict": {"format_id": "a"}})
    assert conn.sent[-1]["percent"] == pytest.approx(40.0)
    progress({"status": "finished", "downloaded_bytes": 100, "info_dict": {"format_id": "a"}})
    hook({"status": "started", "postprocessor": "ExtractAudio"})
    assert conn.sent[-1]["stage"] == "converting"


# --- A8 + B: cookies ---------------------------------------------------------------------------


def _cookie_line(domain: str, name: str, expires: int) -> str:
    return "\t".join([domain, "TRUE", "/", "TRUE", str(expires), name, "valeur-secrete"])


def _write_cookies(path: Path, lines: list[str], header: str = "# Netscape HTTP Cookie File") -> Path:
    path.write_text("\n".join([header, *lines]) + "\n")
    return path


def test_cookie_validation_states(tmp_path) -> None:
    future, past = int(time.time()) + 86400 * 30, int(time.time()) - 10
    good = _write_cookies(tmp_path / "ok.txt", [_cookie_line(".youtube.com", "SAPISID", future),
                                                _cookie_line(".youtube.com", "LOGIN_INFO", future),
                                                _cookie_line(".google.com", "SID", future)])
    # yt-dlp's rule: LOGIN_INFO + a SAPISID-type cookie sent to www.youtube.com.
    google_only = _write_cookies(tmp_path / "g.txt", [_cookie_line(".google.com", "SAPISID", future),
                                                      _cookie_line(".google.com", "LOGIN_INFO", future),
                                                      _cookie_line(".youtube.com", "PREF", future)])
    assert validate(google_only).state == "no_youtube"
    no_login_info = _write_cookies(tmp_path / "n.txt", [_cookie_line(".youtube.com", "SAPISID", future),
                                                        _cookie_line(".youtube.com", "SID", future)])
    assert validate(no_login_info).state == "no_youtube"
    mobile_only = _write_cookies(tmp_path / "m.txt", [_cookie_line(".m.youtube.com", "SAPISID", future),
                                                      _cookie_line(".m.youtube.com", "LOGIN_INFO", future)])
    assert validate(mobile_only).state == "no_youtube"
    report = validate(good)
    assert report.state == "ok" and report.youtube_entries == 2 and report.google_entries == 1
    assert "valeur-secrete" not in str(report.public())
    assert validate(tmp_path / "missing.txt").state == "absent"
    assert validate(_write_cookies(tmp_path / "nohdr.txt", [], header="SID\tx")).state == "invalid"
    (tmp_path / "json.txt").write_text('[{"name": "SID"}]')
    assert validate(tmp_path / "json.txt").state == "invalid"
    (tmp_path / "bom.txt").write_bytes(b"\xef\xbb\xbf# Netscape HTTP Cookie File\n")
    assert validate(tmp_path / "bom.txt").state == "invalid"
    expired = _write_cookies(tmp_path / "old.txt", [_cookie_line(".youtube.com", "SAPISID", past),
                                                    _cookie_line(".youtube.com", "LOGIN_INFO", past)])
    assert validate(expired).state == "expired"
    other = _write_cookies(tmp_path / "x.txt", [_cookie_line(".x.com", "auth_token", future)])
    assert validate(other).state == "no_youtube"
    httponly = _write_cookies(tmp_path / "h.txt", ["#HttpOnly_" + _cookie_line(".youtube.com", "__Secure-3PAPISID", future),
                                                   _cookie_line(".youtube.com", "LOGIN_INFO", future)])
    assert validate(httponly).state == "ok"


def test_netscape_header_error_maps_to_cookies_invalid() -> None:
    err = map_ytdlp_error("ERROR: '/data/tmp/x/cookies.txt' does not look like a Netscape format cookies file")
    assert (err.status, err.code) == (500, "cookies_invalid")


def test_invalid_cookies_fail_youtube_only(make_client, fake_worker, tmp_path) -> None:
    bad = tmp_path / "cookies.txt"
    bad.write_text('[{"name": "SID"}]')
    client = make_client(cookies_file=bad)
    res = client.get("/dl", params={"url": YT}, headers=AUTH)
    assert res.status_code == 500 and res.json()["error"] == "cookies_invalid"
    assert not fake_worker.calls  # failed before any download
    assert client.get("/dl", params={"url": TT}, headers=AUTH).status_code == 200
    assert fake_worker.calls[-1].cookies_file is None


def test_valid_cookies_are_passed_to_youtube_tasks_only(make_client, fake_worker, tmp_path) -> None:
    future = int(time.time()) + 86400
    good = _write_cookies(tmp_path / "cookies.txt", [_cookie_line(".youtube.com", "SAPISID", future),
                                                     _cookie_line(".youtube.com", "LOGIN_INFO", future)])
    client = make_client(cookies_file=good)
    client.get("/dl", params={"url": YT}, headers=AUTH)
    assert fake_worker.calls[-1].cookies_file == str(good)
    client.get("/dl", params={"url": TT}, headers=AUTH)
    assert fake_worker.calls[-1].cookies_file is None
    status = client.get("/status", headers=AUTH).json()["cookies"]
    assert status["state"] == "ok" and "valeur-secrete" not in str(status)


def test_cookie_monitor_picks_up_a_new_file(tmp_path) -> None:
    path = tmp_path / "cookies.txt"
    monitor = CookieMonitor(path)
    assert monitor.refresh().state == "absent" and monitor.for_youtube() is None
    _write_cookies(path, [_cookie_line(".youtube.com", "SAPISID", int(time.time()) + 3600),
                          _cookie_line(".youtube.com", "LOGIN_INFO", int(time.time()) + 3600)])
    monitor._last_check = 0
    assert monitor.refresh().state == "ok"
    assert monitor.for_youtube() == str(path)


# --- B: tokens ---------------------------------------------------------------------------------


def test_tokens_file_parsing() -> None:
    tokens, invalid = parse_tokens("# c\niphone " + "a" * 64 + "\npc:" + "b" * 40 + "\nbad\nX " + "c" * 30 + "\n")
    assert tokens == {"iphone": "a" * 64, "pc": "b" * 40, "x": "c" * 30}
    assert invalid == [4]


def test_tokens_file_hot_reload_and_labels(make_client, tmp_path, caplog) -> None:
    path = tmp_path / "tokens"
    first = "f" * 64
    write_tokens_file(path, {"iphone": first})
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    client = make_client(tokens_file=path)
    import logging

    logging.getLogger().addHandler(caplog.handler)  # create_app() reset the root handlers
    assert client.get("/status", headers={"Authorization": f"Bearer {first}"}).json()["tokens"]["labels"] == ["env", "iphone"]
    second = "e" * 64
    write_tokens_file(path, {"iphone": second})
    os.utime(path, ns=(time.time_ns() + 10**9, time.time_ns() + 10**9))
    client.app.state.tokens._last_check = 0
    assert client.get("/status", headers={"Authorization": f"Bearer {first}"}).status_code == 401
    assert client.get("/status", headers={"Authorization": f"Bearer {second}"}).status_code == 200
    # Logs carry the label, never the token.
    request_logs = [r for r in caplog.records if r.getMessage() == "request"]
    assert any(getattr(r, "token", None) == "iphone" for r in request_logs)
    for record in caplog.records:
        if record.name.startswith(("httpx", "httpcore")):
            continue
        assert second not in str(record.__dict__) and first not in str(record.__dict__)


def test_tokens_file_alone_is_enough(monkeypatch, tmp_path) -> None:
    path = tmp_path / "tokens"
    monkeypatch.delenv("API_TOKEN", raising=False)
    monkeypatch.setenv("TOKENS_FILE", str(path))
    with pytest.raises(ConfigError):
        load_settings()
    write_tokens_file(path, {"iphone": "a" * 64})
    assert load_settings().api_token == ""
    store = TokenStore("", path)
    assert store.match("a" * 64) == "iphone" and store.match("b" * 64) is None and store.labels() == ["iphone"]


# --- B: POST /jobs?wait, merge, cache ------------------------------------------------------------


def test_post_jobs_wait_returns_done_with_file_url(client, fake_worker) -> None:
    res = client.post("/jobs", params={"wait": 10}, json={"url": TT, "fmt": "mp3"}, headers=AUTH)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "done" and body["file_url"] and "error" not in body


def test_post_jobs_wait_still_running_is_202(client, fake_worker) -> None:
    fake_worker.delay_s = 3
    res = client.post("/jobs", params={"wait": 1}, json={"url": TT}, headers=AUTH)
    assert res.status_code == 202 and res.json()["status"] in ("queued", "running")
    client.delete(f"/jobs/{res.json()['job_id']}", headers=AUTH)


def test_post_jobs_wait_error_has_status_and_json(client, fake_worker) -> None:
    fake_worker.error = ApiError(404, "not_found", "supprimé")
    res = client.post("/jobs", params={"wait": 10}, json={"url": TT}, headers=AUTH)
    assert res.status_code == 404
    assert res.json()["error"] == "not_found" and res.json()["detail"] == "supprimé"
    assert client.post("/jobs", params={"wait": 26}, json={"url": TT}, headers=AUTH).status_code == 400


def test_identical_jobs_are_merged(client, fake_worker) -> None:
    fake_worker.delay_s = 2
    first = client.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=AUTH).json()
    second = client.post("/jobs", json={"url": TT + "?_r=1", "fmt": "mp3"}, headers=AUTH).json()
    assert second["job_id"] == first["job_id"] and second["merged"] is True
    other = client.post("/jobs", json={"url": TT, "fmt": "mp3", "bitrate": 320}, headers=AUTH).json()
    assert other["job_id"] != first["job_id"]
    for job_id in {first["job_id"], other["job_id"]}:
        client.delete(f"/jobs/{job_id}", headers=AUTH)


def test_dl_joins_a_running_identical_job(client, fake_worker) -> None:
    fake_worker.delay_s = 0.5
    job = client.post("/jobs", json={"url": TT}, headers=AUTH).json()
    res = client.get("/dl", params={"url": TT}, headers=AUTH)
    assert res.status_code == 200 and res.headers["x-cache"] == "merged"
    assert len(fake_worker.calls) == 1
    assert client.get(f"/jobs/{job['job_id']}", headers=AUTH).json()["status"] == "done"


def test_result_cache_for_dl_and_jobs(make_client, fake_worker, settings) -> None:
    client = make_client(cache_ttl_min=30)
    first = client.get("/dl", params={"url": "https://youtu.be/jNQXAC9IVRw?si=A"}, headers=AUTH)
    assert first.headers["x-cache"] == "miss"
    again = client.get("/dl", params={"url": "https://youtu.be/jNQXAC9IVRw?si=B"}, headers=AUTH)
    assert again.status_code == 200 and again.headers["x-cache"] == "hit" and again.content == first.content
    assert len(fake_worker.calls) == 1
    job = client.post("/jobs", params={"wait": 5}, json={"url": YT}, headers=AUTH)
    assert job.status_code == 200 and job.json()["cached"] is True and len(fake_worker.calls) == 1
    assert client.get(job.json()["file_url"], headers=AUTH).status_code == 200
    other = client.get("/dl", params={"url": YT, "quality": "720"}, headers=AUTH)
    assert other.headers["x-cache"] == "miss" and len(fake_worker.calls) == 2
    stats = client.get("/status", headers=AUTH).json()["cache"]
    assert stats["entries"] == 2 and stats["bytes"] == 2000
    # Deleting the job keeps the cache entry (separate hard links).
    client.delete(f"/jobs/{job.json()['job_id']}", headers=AUTH)
    assert client.get("/dl", params={"url": YT}, headers=AUTH).headers["x-cache"] == "hit"


def test_cache_eviction_and_ttl(tmp_path) -> None:
    cache = ResultCache(tmp_path / "cache", ttl_s=60, max_bytes=2500)
    for name in ("a", "b", "c"):
        src = tmp_path / name
        src.write_bytes(b"x" * 1000)
        cache.put(name, {"filepath": str(src), "size": 1000, "download_name": name, "media_type": "video/mp4"})
        time.sleep(0.01)
    assert cache.get("a") is None and cache.get("b") and cache.get("c")  # oldest evicted
    cache._entries["b"].created -= 120
    assert cache.get("b") is None  # expired
    assert cache_key("youtube:x", {"fmt": "mp3", "bitrate": 192, "quality": "720"}) == \
        cache_key("youtube:x", {"fmt": "mp3", "bitrate": 192, "quality": "best"})  # quality irrelevant to mp3


# --- B: /status, JSON range errors, proxy --------------------------------------------------------


def test_status_requires_token_and_reports(client) -> None:
    assert client.get("/status").status_code == 401
    body = client.get("/status", headers=AUTH).json()
    assert set(body) >= {"platforms", "cookies", "queue", "disk", "cache", "tokens", "versions"}
    assert set(body["platforms"]) == {"youtube", "tiktok", "twitter"}
    assert body["disk"]["free_bytes"] > 0
    assert TOKEN not in str(body)


@pytest.mark.parametrize(("value", "status", "code"), [("bytes=999999-", 416, "range_not_satisfiable"),
                                                        ("items=0-1", 400, "invalid_range")])
def test_range_errors_are_json(client, settings, value: str, status: int, code: str) -> None:
    res = client.get("/dl", params={"url": TT}, headers=AUTH | {"Range": value})
    assert res.status_code == status and res.json()["error"] == code
    assert list(settings.tmp_dir.iterdir()) == []
    ok = client.get("/dl", params={"url": TT}, headers=AUTH | {"Range": "bytes=0-9"})
    assert ok.status_code == 206 and len(ok.content) == 10


def test_if_range_resume_is_served(client) -> None:
    # A browser resuming a partly cached file sends Range + If-Range (its ETag or Last-Modified): this
    # used to raise KeyError (500), the validators being compared before Starlette had set them.
    job = client.post("/jobs", params={"wait": 5}, json={"url": TT}, headers=AUTH).json()
    first = client.get(job["file_url"], headers=AUTH | {"Range": "bytes=0-9"})
    assert first.status_code == 206 and len(first.content) == 10
    for validator in (first.headers["etag"], first.headers["last-modified"]):
        res = client.get(job["file_url"], headers=AUTH | {"Range": "bytes=10-19", "If-Range": validator})
        assert res.status_code == 206 and len(res.content) == 10
        assert res.headers["content-range"].startswith("bytes 10-19/")
    stale = client.get(job["file_url"], headers=AUTH | {"Range": "bytes=10-19", "If-Range": '"ancien"'})
    assert stale.status_code == 200 and len(stale.content) == int(stale.headers["content-length"]) > 10
    past = client.get(job["file_url"], headers=AUTH | {"Range": "bytes=999999-", "If-Range": first.headers["etag"]})
    assert past.status_code == 416 and past.json()["error"] == "range_not_satisfiable"
    dl = client.get("/dl", params={"url": TT}, headers=AUTH | {"Range": "bytes=0-9", "If-Range": '"ancien"'})
    assert dl.status_code == 200


def test_proxy_only_for_youtube(tmp_path) -> None:
    cfg = {"max_filesize_bytes": 1, "cache_dir": None, "yt_proxy": "socks5h://100.64.0.2:1080"}
    yt = base_options(cfg, tmp_path, "youtube")
    assert yt["proxy"] == "socks5h://100.64.0.2:1080"
    assert yt["logger"].guard_proxy_bypass is True
    # Other platforms: forced direct ("" ignores HTTP_PROXY/ALL_PROXY from the environment).
    assert base_options(cfg, tmp_path, "tiktok")["proxy"] == ""
    assert base_options(cfg, tmp_path, "twitter")["proxy"] == ""
    assert base_options({**cfg, "yt_proxy": "http://10.0.0.1:3128"}, tmp_path, "youtube")["logger"].guard_proxy_bypass is False


def test_ffmpeg_proxy_bypass_fails_closed(tmp_path) -> None:
    from app.worker import ProxyBypass

    logger = base_options({"max_filesize_bytes": 1, "cache_dir": None, "yt_proxy": "socks5h://h:1080"},
                          tmp_path, "youtube")["logger"]
    with pytest.raises(ProxyBypass):
        logger.warning("WARNING: ffmpeg does not support SOCKS proxies. Downloading is likely to fail.")
    logger.warning("WARNING: something harmless")  # other warnings pass


def test_proxy_errors_do_not_open_the_breaker() -> None:
    err = map_ytdlp_error("ERROR: [youtube] x: Unable to download webpage: Unable to connect to proxy", "youtube")
    assert (err.status, err.code) == (502, "proxy_unreachable")


@pytest.mark.parametrize("raw", ["ftp://h:1", "https://h:443", "socks4://h:1080", "socks5h://user:s3cr3t@host",
                                 "http://:8080", "nonsense", "socks5h://h:1/path", "socks5h://u:a+s3cr3t@h:1"])
def test_bad_proxy_rejected_without_echoing_it(raw: str) -> None:
    with pytest.raises(ConfigError) as excinfo:
        parse_proxy(raw)
    assert "s3cr3t" not in str(excinfo.value)


def test_proxy_normalisation() -> None:
    assert parse_proxy("socks5://user:pw@100.64.0.2:1080") == "socks5h://user:pw@100.64.0.2:1080"
    assert parse_proxy("SOCKS5H://100.64.0.2:1080/") == "socks5h://100.64.0.2:1080"
    assert parse_proxy("http://10.0.0.1:3128") == "http://10.0.0.1:3128"


def test_settings_new_defaults(monkeypatch) -> None:
    monkeypatch.setenv("API_TOKEN", "x" * 32)
    s = load_settings()
    assert (s.yt_cooldown_min, s.yt_concurrency, s.yt_min_interval_s) == (15, 1, 3)
    assert (s.cache_ttl_min, s.max_cache_mb, s.yt_proxy) == (30, 2000, None)


def test_settings_are_frozen_dataclass(settings) -> None:
    assert dataclasses.replace(settings, yt_cooldown_min=1).yt_cooldown_min == 1
