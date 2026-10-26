"""Fixes for the adversarial review of the second pass (2026-10-07)."""

import asyncio
import contextlib
import io
import multiprocessing
import os
import stat
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from yt_dlp.cookies import YoutubeDLCookieJar
from yt_dlp.globals import plugin_dirs
from yt_dlp.utils import DownloadError

from app import worker
from app.config import DEFAULT_ALLOWED_DOMAINS, parse_domains
from app.cookies import validate
from app.errors import ApiError, map_ytdlp_error
from app.logging_setup import redact
from app.platforms import PlatformMonitor
from app.tokens import parse_tokens
from app.urls import media_key, validate_media_url
from tests.conftest import TOKEN

ALLOWED = parse_domains(DEFAULT_ALLOWED_DOMAINS)
AUTH = {"Authorization": f"Bearer {TOKEN}"}
YT = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
TT = "https://www.tiktok.com/@scout2015/video/6718335390845095173"
ROOT = Path(__file__).resolve().parent.parent
BOT = ApiError(503, "bot_check", "Sign in to confirm you're not a bot")


# --- circuit breaker, limiter, Retry-After ---------------------------------------------------


def test_stale_success_keeps_breaker_open() -> None:
    monitor = PlatformMonitor(15, 1, 0)
    started = time.time()
    time.sleep(0.01)
    monitor.record_error("youtube", BOT)
    monitor.record_success("youtube", started_at=started)  # a CDN download that began before the block
    assert monitor.states["youtube"].state == "bot_check"
    with pytest.raises(ApiError):
        monitor.check_available("youtube")
    monitor.record_success("youtube", started_at=time.time())
    assert monitor.states["youtube"].state == "ok"


def test_retry_after_on_job_paths(make_client, fake_worker) -> None:
    client = make_client()
    fake_worker.error = BOT
    res = client.post("/jobs", params={"wait": 5}, json={"url": YT}, headers=AUTH)
    assert res.status_code == 503 and 890 <= int(res.headers["Retry-After"]) <= 900
    body = res.json()
    assert body["error"] == "bot_check" and "~15 min" in body["detail"] and 890 <= body["retry_after_s"] <= 900
    assert client.get(body["status_url"], headers=AUTH).json()["retry_after_s"] > 0


def test_merged_dl_keeps_retry_after(make_client, fake_worker) -> None:
    client = make_client()
    fake_worker.delay_s, fake_worker.error = 0.5, BOT
    assert client.post("/jobs", json={"url": YT}, headers=AUTH).status_code == 202
    res = client.get("/dl", params={"url": YT}, headers=AUTH)
    assert res.status_code == 503 and res.json()["error"] == "bot_check" and int(res.headers["Retry-After"]) > 0


def test_cache_and_merge_survive_youtube_pause(make_client, fake_worker) -> None:
    client = make_client(cache_ttl_min=30)
    assert client.get("/dl", params={"url": YT}, headers=AUTH).status_code == 200
    client.app.state.runner.platforms.record_error("youtube", BOT)
    hit = client.get("/dl", params={"url": YT}, headers=AUTH)
    assert hit.status_code == 200 and hit.headers["x-cache"] == "hit"
    job = client.post("/jobs", params={"wait": 2}, json={"url": YT}, headers=AUTH)
    assert job.status_code == 200 and job.json()["cached"] is True
    other = client.get("/dl", params={"url": "https://youtu.be/dQw4w9WgXcQ"}, headers=AUTH)
    assert other.status_code == 503 and other.json()["error"] == "bot_check"
    assert len(fake_worker.calls) == 1


def test_youtube_gate_not_held_while_queued(make_client, fake_worker) -> None:
    client = make_client(max_concurrent=1)
    fake_worker.delay_by_platform = {"tiktok": 2.0}
    assert client.post("/jobs", json={"url": TT}, headers=AUTH).status_code == 202  # holds the only slot
    assert client.post("/jobs", json={"url": YT}, headers=AUTH).status_code == 202  # queued behind it
    started = time.monotonic()
    assert client.get("/info", params={"url": YT}, headers=AUTH).status_code == 200
    assert time.monotonic() - started < 1.0  # not stuck behind the queued YouTube job


def test_min_interval_spaces_concurrent_waiters() -> None:
    async def scenario() -> list[float]:
        monitor = PlatformMonitor(15, 2, 0.3)
        starts: list[float] = []

        async def one() -> None:
            gate = await monitor.acquire("youtube")
            starts.append(time.monotonic())
            gate.release()

        await asyncio.gather(one(), one(), one())
        return sorted(starts)

    starts = asyncio.run(scenario())
    assert starts[1] - starts[0] >= 0.28 and starts[2] - starts[1] >= 0.28


# --- merging and the result cache ----------------------------------------------------------------


def test_merge_is_refcounted(make_client, fake_worker) -> None:
    client = make_client()
    fake_worker.delay_s = 1.0
    first = client.post("/jobs", json={"url": TT}, headers=AUTH).json()
    second = client.post("/jobs", json={"url": TT}, headers=AUTH).json()
    assert second["merged"] is True and second["job_id"] == first["job_id"]
    assert client.delete(f"/jobs/{first['job_id']}", headers=AUTH).status_code == 200
    done = client.get(f"/jobs/{first['job_id']}", params={"wait": 5}, headers=AUTH).json()
    assert done["status"] == "done" and fake_worker.cancelled == 0  # the other participant still gets it
    assert client.get(done["file_url"], headers=AUTH).status_code == 200
    assert client.delete(f"/jobs/{first['job_id']}", headers=AUTH).status_code == 200  # last one leaves
    assert client.get(f"/jobs/{first['job_id']}", headers=AUTH).status_code == 404


def test_merged_dl_survives_creator_delete(make_client, fake_worker) -> None:
    client = make_client()
    fake_worker.delay_s = 1.0
    job = client.post("/jobs", json={"url": TT}, headers=AUTH).json()
    with ThreadPoolExecutor(1) as pool:
        pending = pool.submit(client.get, "/dl", params={"url": TT}, headers=AUTH)
        time.sleep(0.3)
        assert client.delete(f"/jobs/{job['job_id']}", headers=AUTH).status_code == 200
        res = pending.result(timeout=10)
    assert res.status_code == 200 and res.headers["x-cache"] == "merged" and fake_worker.cancelled == 0
    assert client.get(f"/jobs/{job['job_id']}", headers=AUTH).status_code == 404  # nobody left


def test_identical_dl_waiting_for_a_slot_uses_the_cache(make_client, fake_worker) -> None:
    client = make_client(cache_ttl_min=30, max_concurrent=1)
    fake_worker.delay_s = 1.0
    with ThreadPoolExecutor(2) as pool:
        first = pool.submit(client.get, "/dl", params={"url": TT}, headers=AUTH)
        time.sleep(0.3)
        second = pool.submit(client.get, "/dl", params={"url": TT}, headers=AUTH)
        r1, r2 = first.result(timeout=10), second.result(timeout=10)
    assert r1.headers["x-cache"] == "miss" and r2.headers["x-cache"] == "hit" and len(fake_worker.calls) == 1


def test_unusable_cache_entry_downloads_again(make_client, fake_worker, monkeypatch) -> None:
    client = make_client(cache_ttl_min=30)
    assert client.get("/dl", params={"url": TT}, headers=AUTH).status_code == 200

    def broken(*_args, **_kwargs):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(client.app.state.cache, "materialize", broken)
    job = client.post("/jobs", params={"wait": 5}, json={"url": TT}, headers=AUTH)
    assert job.status_code == 200 and job.json()["cached"] is False and len(fake_worker.calls) == 2
    assert all(j.status == "done" for j in client.app.state.jobs.jobs.values())  # no job stuck in queued


def test_merged_dl_timeout_is_504(make_client, fake_worker) -> None:
    client = make_client(download_timeout_s=1)
    fake_worker.delay_s = 3.0
    client.post("/jobs", json={"url": TT}, headers=AUTH)
    res = client.get("/dl", params={"url": TT}, headers=AUTH)
    assert res.status_code == 504 and res.json()["error"] == "timeout"


def test_media_key_only_for_unambiguous_urls() -> None:
    def key(url: str) -> str:
        return media_key(validate_media_url(url, ALLOWED))

    assert key("https://youtu.be/jNQXAC9IVRw?si=x") == "youtube:jNQXAC9IVRw"
    assert key("https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PL1") == "youtube:jNQXAC9IVRw"
    assert key("https://www.youtube.com/shorts/jNQXAC9IVRw?si=y") == "youtube:jNQXAC9IVRw"
    assert key("https://www.tiktok.com/@a/video/6718335390845095173?is_from_webapp=1") == "tiktok:6718335390845095173"
    for ambiguous in ("https://www.youtube.com/shorts/aaaaaaaaaaa?v=jNQXAC9IVRw",
                      "https://www.youtube.com/embed/aaaaaaaaaaa?v=jNQXAC9IVRw",
                      "https://www.youtube.com/watch?x=1;v=aaaaaaaaaaa&v=jNQXAC9IVRw"):
        assert key(ambiguous) not in ("youtube:jNQXAC9IVRw", "youtube:aaaaaaaaaaa"), ambiguous
    # TikTok links are an allowlist of exact shapes: an embed followed by another id never reaches yt-dlp.
    with pytest.raises(ApiError) as exc:
        key("https://www.tiktok.com/embed/6718335390845095173/video/1111111111111111111")
    assert exc.value.code == "unsupported_url"
    assert key("https://www.tiktok.com/embed/v2/6718335390845095173?lang=fr") == "tiktok:6718335390845095173"


def test_result_with_another_id_is_not_cached(make_client, fake_worker) -> None:
    client = make_client(cache_ttl_min=30)
    fake_worker.media_id = "aaaaaaaaaaa"  # yt-dlp downloaded something else than the URL's id
    assert client.get("/dl", params={"url": YT}, headers=AUTH).headers["x-cache"] == "miss"
    fake_worker.media_id = None
    assert client.get("/dl", params={"url": YT}, headers=AUTH).headers["x-cache"] == "miss"
    assert client.get("/dl", params={"url": YT}, headers=AUTH).headers["x-cache"] == "hit"


@pytest.mark.parametrize("url", [
    "https://www.youtube.com/course?list=PLx",
    "https://www.youtube.com/watch_videos?video_ids=jNQXAC9IVRw,dQw4w9WgXcQ",
    "https://www.youtube.com/view_play_list?p=PLx",
    "https://www.youtube.com/SomeChannel",
    "https://www.youtube.com/ytsearch",
    "https://www.youtube.com/post/UgkxAbCdEfGhIjKlMn",
    "https://www.youtube.com/attribution_link?u=/watch%3Fv%3DjNQXAC9IVRw",
    "https://www.youtube.com/watch",
])
def test_youtube_paths_outside_the_allowlist_are_refused(url: str) -> None:
    with pytest.raises(ApiError) as exc:
        validate_media_url(url, ALLOWED)
    assert exc.value.status == 400
    assert exc.value.code in ("playlist_not_supported", "unsupported_url", "invalid_url")


@pytest.mark.parametrize("url", [
    "https://www.youtube.com/clip/UgkxAbCdEfGhIjKlMnOpQrStUvWxYz012345",
    "https://www.youtube.com/@chan/videos?v=jNQXAC9IVRw",
    "https://www.youtube.com/live/jNQXAC9IVRw?si=a",
    "https://www.youtube.com/embed/jNQXAC9IVRw",
    "https://www.youtube.com/v/jNQXAC9IVRw",
    "https://m.youtube.com/watch?v=jNQXAC9IVRw",
    "https://m.youtube.com/shorts/jNQXAC9IVRw/",
])
def test_single_video_youtube_paths_are_accepted(url: str) -> None:
    assert validate_media_url(url, ALLOWED).platform == "youtube"


# --- errors, logs ----------------------------------------------------------------------------------


@pytest.mark.parametrize(("message", "code"), [
    ("SocksHTTPSConnection(host='www.youtube.com', port=443): Failed to establish a new connection: "
     "[Errno 111] Connection refused", "proxy_unreachable"),
    ("SocksHTTPSConnection(host='www.youtube.com', port=443): Failed to establish a new connection: timed out",
     "proxy_unreachable"),
    ("SocksHTTPSConnection(host='www.youtube.com', port=443): Failed to establish a new connection: "
     "[Errno 113] No route to host", "proxy_unreachable"),
    ("HTTPSConnectionPool(host='www.tiktok.com', port=443): Max retries exceeded (Caused by "
     "NewConnectionError('Failed to establish a new connection: [Errno 111] Connection refused'))", "upstream_error"),
    ("ERROR: unable to download video data: HTTP Error 403: Forbidden", "upstream_forbidden"),
    ("ERROR: fragment 1 not found, unable to continue", "download_failed"),
])
def test_review2_error_mapping(message: str, code: str) -> None:
    assert map_ytdlp_error(message, "youtube").code == code


def test_proxy_credentials_are_masked() -> None:
    line = "[debug] params: {'proxy': 'socks5h://fakeuser:FAKEPASS123@127.0.0.1:9', 'retries': 3}"
    masked = redact(line)
    assert "FAKEPASS123" not in masked and "fakeuser" not in masked and "127.0.0.1:9" in masked
    assert redact(TT) == TT  # @user in a path is not userinfo
    ydl_logger = worker._YdlLogger()
    ydl_logger.warning("WARNING: Retrying via http://user:hunter22@10.0.0.1:8080")
    assert "hunter22" not in ydl_logger.warnings[0]


@pytest.mark.parametrize(("query", "fragment"), [
    ({"quality": "999"}, "valeur non autorisée"),
    ({"bitrate": "7"}, " ou 320"),
    ({"fmt": "gif", "gif_fps": "99"}, "doit être ≤ 30"),
    ({"transcode": "maybe"}, "true ou false"),
])
def test_validation_details_are_french(make_client, query, fragment) -> None:
    res = make_client().get("/dl", params={"url": YT, **query}, headers=AUTH)
    detail = res.json()["detail"]
    assert res.status_code == 400 and fragment in detail and "Input should" not in detail


def test_json_body_validation_is_french(make_client) -> None:
    client = make_client()
    assert "champ inconnu" in client.post("/jobs", json={"url": YT, "foo": 1}, headers=AUTH).json()["detail"]
    assert "doit être ≤ 25" in client.post("/jobs", params={"wait": 99}, json={"url": YT}, headers=AUTH).json()["detail"]
    assert "objet JSON" in client.post("/jobs", content=b'"texte"', headers={**AUTH, "Content-Type": "application/json"}).json()["detail"]


# --- worker: cookies, cover retry, ffprobe, plugins ------------------------------------------------


def _line(name: str, expires: str) -> str:
    return "\t".join([".youtube.com", "TRUE", "/", "TRUE", expires, name, "valeur-secrete"])


@pytest.mark.filterwarnings("ignore:http.cookiejar bug")
def test_cookie_lines_ytdlp_would_print_are_dropped(tmp_path) -> None:
    future = str(int(time.time()) + 86400)
    src = tmp_path / "cookies.txt"
    src.write_text("\n".join(["# Netscape HTTP Cookie File", _line("LOGIN_INFO", future), _line("SAPISID", future),
                              _line("BAD1", ".5"), _line("BAD2", "١٢٣"), _line("BAD3", "9" * 400),
                              _line("SESSION", "")]) + "\n", encoding="utf-8")
    raw_err = io.StringIO()
    with contextlib.redirect_stderr(raw_err), contextlib.suppress(Exception):
        YoutubeDLCookieJar(str(src)).load()
    assert "skipping cookie file entry" in raw_err.getvalue()  # what the sanitizer prevents
    copy = tmp_path / "copy.txt"
    worker.write_sanitized_cookies(src, copy)
    assert "BAD" not in copy.read_text() and "SESSION" in copy.read_text()
    err = io.StringIO()
    jar = YoutubeDLCookieJar(str(copy))
    with contextlib.redirect_stderr(err):
        jar.load()
    assert err.getvalue() == "" and len(jar) == 3
    report = validate(src)
    assert report.state == "ok" and report.entries == 3


def test_cookie_copy_removed_after_task(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(worker.os, "setpgrp", lambda: None)
    monkeypatch.setattr(worker, "setup_logging", lambda level: None)

    def fake_run_info(task, cfg, workdir):
        (workdir / "cookies.txt").write_text("copie rafraîchie")
        return {"ok": True}

    monkeypatch.setattr(worker, "run_info", fake_run_info)
    parent, child = multiprocessing.Pipe(duplex=False)
    worker.child_main({"kind": "info", "workdir": str(tmp_path), "platform": "youtube", "url": YT}, {}, child)
    assert parent.recv() == {"type": "result", "data": {"ok": True}}
    assert not (tmp_path / "cookies.txt").exists()


@pytest.mark.parametrize(("running_pp", "retried"), [("EmbedThumbnail", True), ("ThumbnailsConvertor", True),
                                                     ("ExtractAudio", False), (None, False)])
def test_mp3_cover_retry_reuses_extraction(monkeypatch, running_pp, retried) -> None:
    calls: list[tuple[bool, object]] = []

    def fake_download(task, cfg, workdir, reporter, cover, attempt=None):
        calls.append((cover, attempt.info))
        if cover:
            attempt.info, attempt.running_pp = {"id": "x"}, running_pp
            raise DownloadError("ERROR: Postprocessing: Conversion failed!")
        return {"ok": True}

    monkeypatch.setattr(worker, "_download", fake_download)
    task = {"params": {"fmt": "mp3"}}
    if retried:
        assert worker.run_download(task, {}, Path("."), None) == {"ok": True}
        assert calls == [(True, None), (False, {"id": "x"})]  # no second extraction
    else:
        with pytest.raises(DownloadError):
            worker.run_download(task, {}, Path("."), None)
        assert len(calls) == 1


def test_postprocess_hook_tracks_running_pp() -> None:
    class Conn:
        def send(self, _message) -> None:
            pass

    attempt = worker.Attempt()
    reporter = worker.Reporter(Conn())
    hook = worker.postprocess_hook(worker.DownloadProgress(reporter, 10**9), reporter, attempt)
    hook({"status": "started", "postprocessor": "EmbedThumbnail"})
    assert attempt.running_pp == "EmbedThumbnail"
    hook({"status": "finished", "postprocessor": "EmbedThumbnail"})
    assert attempt.running_pp is None


def test_probe_failure_is_conversion_failed(tmp_path) -> None:
    bad = tmp_path / "x.mp4"
    bad.write_bytes(b"\xff\xfe pas une video \xe9")
    with pytest.raises(ApiError) as exc:
        worker.probe(bad)
    assert exc.value.code == "conversion_failed"


def test_plugins_only_from_the_venv() -> None:
    assert plugin_dirs.value and "default" not in plugin_dirs.value
    assert not any(Path(p).resolve().is_relative_to(Path.home().resolve()) for p in plugin_dirs.value)


# --- host scripts (secrets) ----------------------------------------------------------------------


def _script(name: str, *args: str, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, str(ROOT / "scripts" / name), *args], capture_output=True, text=True,
                          env={**os.environ, **env}, timeout=60, check=False)


def _cookie_file(path: Path) -> Path:
    future = str(int(time.time()) + 86400)
    path.write_text("\n".join(["# Netscape HTTP Cookie File", _line("LOGIN_INFO", future),
                               _line("SAPISID", future)]) + "\n")
    return path


def test_cookies_install_reports_shred_failure(tmp_path) -> None:
    src = _cookie_file(tmp_path / "cookies.txt")
    fakebin = tmp_path / "bin"
    fakebin.mkdir()
    (fakebin / "shred").write_text("#!/bin/sh\nexit 1\n")
    (fakebin / "shred").chmod(0o755)
    res = _script("cookies_install.py", str(src), env={"YTAPI_SECRETS_DIR": str(tmp_path / "secrets"),
                                                       "PATH": f"{fakebin}:{os.environ['PATH']}"})
    assert res.returncode == 1 and "ÉCHEC" in res.stderr and src.exists()
    installed = tmp_path / "secrets" / "cookies.txt"
    assert stat.S_IMODE(installed.stat().st_mode) == 0o440
    assert "valeur-secrete" not in res.stdout + res.stderr


def test_cookies_install_deletes_source_and_refuses_invalid(tmp_path) -> None:
    env = {"YTAPI_SECRETS_DIR": str(tmp_path / "secrets")}
    bad = tmp_path / "bad.txt"
    bad.write_text('[{"name": "SID"}]')
    res = _script("cookies_install.py", str(bad), env=env)
    assert res.returncode == 1 and bad.exists() and not (tmp_path / "secrets" / "cookies.txt").exists()
    src = _cookie_file(tmp_path / "cookies.txt")
    res = _script("cookies_install.py", str(src), env=env)
    assert res.returncode == 0 and not src.exists() and (tmp_path / "secrets" / "cookies.txt").is_file()


def test_token_scripts(tmp_path) -> None:
    tokens = tmp_path / "secrets" / "tokens"
    env_file = tmp_path / ".env"
    env_file.write_text("API_TOKEN=ancien-jeton-de-test-0123456789\nOTHER=1\n")
    env = {"YTAPI_TOKENS_FILE": str(tokens), "YTAPI_ENV_FILE": str(env_file)}
    res = _script("disable_env_token.py", env=env)
    assert res.returncode == 1 and "API_TOKEN=ancien" in env_file.read_text()  # no labelled token yet
    assert _script("rotate_token.py", "iphone", "--no-qr", env=env).returncode == 0
    assert stat.S_IMODE(tokens.stat().st_mode) == 0o600
    labelled = parse_tokens(tokens.read_text())[0]
    assert set(labelled) == {"iphone"}
    res = _script("disable_env_token.py", "--copy-label", "iphone", env=env)
    assert res.returncode == 0 and labelled["iphone"] not in res.stdout + res.stderr
    assert f"API_TOKEN={labelled['iphone']}\n" in env_file.read_text() and "OTHER=1" in env_file.read_text()
    assert stat.S_IMODE(env_file.stat().st_mode) == 0o600
    assert _script("disable_env_token.py", "--copy-label", "pc", env=env).returncode == 1
    assert _script("disable_env_token.py", env=env).returncode == 0
    assert "API_TOKEN=\n" in env_file.read_text()


# --- bot_check 2026-10-13: backoff of consecutive blocks, same episode, closing ------------------


def test_consecutive_blocks_double_the_pause_up_to_the_cap() -> None:
    monitor = PlatformMonitor(15, 1, 0, cooldown_max_min=60)
    waits = []
    for _ in range(4):
        err = monitor.record_error("youtube", BOT, started_at=time.time(), cause="Sign in to confirm you're not a bot.")
        waits.append(int(err.headers["Retry-After"]))
        monitor.states["youtube"].cooldown_until = time.time() - 1  # pause over: the next request is the probe
    assert waits == [900, 1800, 3600, 3600]
    assert monitor.public()["youtube"]["consecutive_blocks"] == 4
    monitor.record_success("youtube", started_at=time.time())
    state = monitor.public()["youtube"]
    assert state["state"] == "ok" and state["consecutive_blocks"] == 0 and state["cooldown_until"] is None
    err = monitor.record_error("youtube", BOT, started_at=time.time())
    assert err.headers["Retry-After"] == "900"  # success resets the backoff


def test_concurrent_task_of_the_same_episode_does_not_extend_the_pause() -> None:
    monitor = PlatformMonitor(15, 2, 0, cooldown_max_min=60)
    early = time.time()
    time.sleep(0.01)
    monitor.record_error("youtube", BOT, started_at=time.time())
    until = monitor.states["youtube"].cooldown_until
    err = monitor.record_error("youtube", BOT, started_at=early)  # began before the block, failed after it
    assert monitor.states["youtube"].blocks == 1 and monitor.states["youtube"].cooldown_until == until
    assert 0 < int(err.headers["Retry-After"]) <= 900


def test_breaker_logs_open_refused_and_closed_without_url(caplog) -> None:
    caplog.set_level("INFO", logger="ytapi.platforms")
    monitor = PlatformMonitor(15, 1, 0, cooldown_max_min=60)
    monitor.record_error("youtube", BOT, started_at=time.time(), cause="Sign in to confirm you're not a bot.")
    with pytest.raises(ApiError) as refused:
        monitor.check_available("youtube")
    assert refused.value.code == "bot_check" and int(refused.value.headers["Retry-After"]) > 0
    monitor.record_success("youtube", started_at=time.time())
    msgs = {r.getMessage(): r for r in caplog.records}
    opened = msgs["youtube circuit breaker open"]
    assert (opened.reason, opened.cooldown_s, opened.consecutive_blocks) == ("bot_check", 900, 1)
    assert opened.until and "not a bot" in opened.cause
    assert msgs["youtube paused: request refused"].retry_after_s > 0
    assert msgs["youtube circuit breaker closed"].consecutive_blocks == 1
    assert not any("http" in r.getMessage() for r in caplog.records)


def test_cooldown_max_never_below_base() -> None:
    assert PlatformMonitor(15, 1, 0, cooldown_max_min=5).cooldown_for(3) == 900
    assert PlatformMonitor(15, 1, 0).cooldown_for(3) == 900  # no maximum given: fixed pause (former behaviour)
