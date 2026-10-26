"""Worker diagnostics: job_id on every log record of the child, technical cause of failures (logs only)."""

from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import multiprocessing
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from yt_dlp.utils import DownloadError

import app.worker as worker
from app.errors import ApiError
from app.runner import Runner, Task, _worker_error, error_cause
from tests.conftest import FakeWorker
from tests.test_user_keys import KEY_A, FakeAccount, account, bearer, ukclient  # noqa: F401  (fixtures)

YT = "https://www.youtube.com/watch?v=abcdefghijk"
AUTH = {"Authorization": "Bearer test-token-" + "x" * 32}
SIGNED = "https://rr1---sn-abc.googlevideo.com/videoplayback?expire=1&sig=SIGSECRET&pot=POTSECRET"


class _Collector(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


@pytest.fixture
def child(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture):
    """Run worker.child_main in-process with a fake run_download; returns (records, messages)."""
    caplog.set_level(logging.DEBUG)  # root level, as setup_logging would set it (restored after the test)
    collector = _Collector()

    def fake_setup_logging(level: str) -> None:  # the child's root handler, restored after the test
        monkeypatch.setattr(logging.getLogger(), "handlers", [collector])

    monkeypatch.setattr(worker.os, "setpgrp", lambda: None)
    monkeypatch.setattr(worker, "setup_logging", fake_setup_logging)

    def run(behaviour: Any, job_id: str = "job-123") -> tuple[list[logging.LogRecord], list[dict[str, Any]]]:
        monkeypatch.setattr(worker, "run_download", lambda task, cfg, workdir, reporter: behaviour())
        parent, conn = multiprocessing.Pipe(duplex=False)
        task = {"kind": "download", "workdir": str(tmp_path), "platform": "youtube", "url": YT, "job_id": job_id}
        worker.child_main(task, {"max_filesize_bytes": 10**9}, conn)
        messages = []
        try:
            while True:
                messages.append(parent.recv())
        except EOFError:  # child_main closed its end
            pass
        return collector.records, messages

    return run


def test_every_child_record_carries_the_job_id(child) -> None:
    def behaviour() -> dict[str, Any]:
        logging.getLogger("ytapi.worker").info("youtube formats selected", extra={"attempt": 1})
        worker._YdlLogger().warning("WARNING: [youtube] abcdefghijk: some yt-dlp warning")
        logging.getLogger("some.library").warning("third-party message")
        raise DownloadError("ERROR: unable to download video data: HTTP Error 403: Forbidden")

    records, messages = child(behaviour)
    assert len(records) >= 4  # three above + the worker's own "yt-dlp error"
    assert {getattr(r, "job_id", None) for r in records} == {"job-123"}
    assert messages[-1]["error"]["code"] == "upstream_forbidden"


def test_no_job_id_for_sync_downloads(child) -> None:
    def behaviour() -> dict[str, Any]:
        logging.getLogger("ytapi.worker").info("youtube formats selected")
        return {"ok": True}

    records, messages = child(behaviour, job_id="")  # GET /dl: no job
    assert records and not any(hasattr(r, "job_id") for r in records)
    assert messages == [{"type": "result", "data": {"ok": True}}]


def test_cause_is_cleaned_and_sent_with_the_error(child) -> None:
    def behaviour() -> None:
        raise DownloadError(f"ERROR: [youtube] abcdefghijk: unable to download video data: HTTP Error 403: "
                            f"Forbidden (while requesting {SIGNED})")

    _, messages = child(behaviour)
    error = messages[-1]
    assert error["type"] == "error" and error["error"]["code"] == "upstream_forbidden"
    cause = error["cause"]
    assert cause.startswith("unable to download video data: HTTP Error 403: Forbidden")
    assert "abcdefghijk" not in cause and "[youtube]" not in cause  # media id prefix stripped
    assert "<url>" in cause and "googlevideo" not in cause and "SECRET" not in cause


def test_internal_failure_cause(child) -> None:
    def behaviour() -> None:
        raise RuntimeError(f"boom while reading {SIGNED}")

    _, messages = child(behaviour)
    assert messages[-1]["error"]["code"] == "internal_error"
    assert messages[-1]["cause"] == "RuntimeError: boom while reading <url>"


@pytest.mark.parametrize(("message", "expected"), [
    ("ERROR: [TikTok] 7234567890123456789: Your IP address is blocked from accessing this post",
     "Your IP address is blocked from accessing this post"),
    ("\x1b[0;31mERROR:\x1b[0m [youtube] abcdefghijk: Sign in to confirm you're not a bot",
     "Sign in to confirm you're not a bot"),
    ("ERROR: unable to download video data: <urlopen error> url: /videoplayback?expire=1&sig=SIGSECRET",
     "unable to download video data: <urlopen error> url: <url>"),
    ("ERROR: invalid cookie line: .youtube.com TRUE / TRUE 0 SID secretvalue", "<cookie error, details hidden>"),
    ("ERROR: Postprocessing: Conversion failed!", "Postprocessing: Conversion failed!"),
])
def test_error_cause(message: str, expected: str) -> None:
    assert worker.error_cause(message) == expected


def test_error_cause_is_bounded() -> None:
    cause = worker.error_cause("ERROR: [youtube] abcdefghijk: " + "x" * 1000 + " " + SIGNED)
    assert len(cause) == 300 and set(cause) == {"x"}


# --- parent side ---------------------------------------------------------------------------------


def test_runner_carries_the_cause() -> None:
    error = ApiError(502, "upstream_forbidden", "refusé")
    message = {"type": "error", "error": error.to_dict(), "cause": "unable to download video data: HTTP Error 403"}
    assert error_cause(_worker_error(message)) == "unable to download video data: HTTP Error 403"
    old_worker = {"type": "error", "error": error.to_dict()}  # backward compatible: no cause
    assert error_cause(_worker_error(old_worker)) is None


def test_cause_survives_the_youtube_breaker(settings) -> None:
    runner = Runner(dataclasses.replace(settings, yt_cooldown_min=15))

    async def fake_run(*_args: Any) -> dict[str, Any]:
        error = ApiError(503, "bot_check", "robot")
        error.cause = "Sign in to confirm you're not a bot"  # type: ignore[attr-defined]
        raise error

    runner._run = fake_run  # type: ignore[method-assign]
    task = Task(kind="download", url=YT, platform="youtube", workdir="/nonexistent")
    with pytest.raises(ApiError) as excinfo:
        asyncio.run(runner.run(task, 10))
    assert excinfo.value.headers.get("Retry-After") == "900"  # the breaker's copy of the error
    assert error_cause(excinfo.value) == "Sign in to confirm you're not a bot"


def _forbidden_with_cause() -> ApiError:
    error = ApiError(502, "upstream_forbidden", "Échec de récupération du média.")
    error.cause = "unable to download video data: HTTP Error 403: Forbidden"  # type: ignore[attr-defined]
    return error


def test_job_failed_logs_the_cause_never_the_response(client: TestClient, fake_worker: FakeWorker,
                                                       caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO, logger="ytapi.jobs")
    fake_worker.error = _forbidden_with_cause()
    res = client.post("/jobs?wait=5", json={"url": YT}, headers=AUTH)
    body = res.json()
    assert body["error"] == "upstream_forbidden" and "HTTP Error" not in res.text
    status = client.get(f"/jobs/{body['job_id']}", headers=AUTH)
    assert "HTTP Error" not in status.text and "cause" not in status.json()
    assert fake_worker.calls[-1].job_id == body["job_id"]  # the worker logs with the same job_id
    [failed] = [r for r in caplog.records if r.getMessage() == "job failed"]
    assert failed.cause == "unable to download video data: HTTP Error 403: Forbidden"
    assert failed.job_id == body["job_id"] and not hasattr(failed, "usage_id")


def test_sync_download_never_returns_the_cause(client: TestClient, fake_worker: FakeWorker) -> None:
    fake_worker.error = _forbidden_with_cause()
    res = client.get("/dl", params={"url": YT}, headers=AUTH)
    assert res.status_code == 502 and set(res.json()) == {"error", "detail"} and "HTTP Error" not in res.text


def test_user_job_logs_carry_the_usage_id(ukclient: TestClient, account: FakeAccount,  # noqa: F811
                                          fake_worker: FakeWorker, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO, logger="ytapi.jobs")
    done = ukclient.post("/jobs?wait=5", json={"url": YT, "fmt": "mp4"}, headers=bearer(KEY_A)).json()
    assert done["status"] == "done"
    fake_worker.error = _forbidden_with_cause()
    failed = ukclient.post("/jobs?wait=5", json={"url": YT, "fmt": "mp3"}, headers=bearer(KEY_A)).json()
    assert failed["error"] == "upstream_forbidden" and "HTTP Error" not in json.dumps(failed)
    fake_worker.error = RuntimeError("worker exploded")  # type: ignore[assignment]
    crashed = ukclient.post("/jobs?wait=5", json={"url": YT, "fmt": "mp4"}, headers=bearer(KEY_A)).json()
    assert crashed["error"] == "internal_error"
    by_message: dict[str, list[logging.LogRecord]] = {}
    for record in caplog.records:
        by_message.setdefault(record.getMessage(), []).append(record)
    for name in ("job created", "job done", "job failed", "job crashed"):
        assert by_message.get(name), name
        assert all(str(getattr(r, "usage_id", "")).startswith("usage-") for r in by_message[name]), name
    assert by_message["job failed"][0].cause.startswith("unable to download video data")
    assert not any(hasattr(r, "media_id") for r in by_message["job done"])  # user jobs: no media id


# --- relecture du 2026-10-10 : motifs linéaires, astuce de connexion de yt-dlp, partie refusée ---------


@pytest.mark.parametrize("hostile", ["?" * 20000, "x?" * 10000, "a." * 20000, "a" * 5000 + "://" + "?" * 5000])
def test_error_cause_is_fast_on_hostile_messages(hostile: str) -> None:
    import time
    start = time.perf_counter()
    cause = worker.error_cause("ERROR: " + hostile)
    assert time.perf_counter() - start < 0.5
    assert len(cause) <= 300


def test_login_hint_does_not_hide_the_real_cause() -> None:
    message = ("ERROR: [youtube] abcdefghijk: Sign in to confirm you’re not a bot. Use --cookies-from-browser or "
               "--cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-"
               "cookies-to-yt-dlp  for how to manually pass cookies")
    assert worker.error_cause(message) == "Sign in to confirm you’re not a bot."
    assert worker.hide_cookie_details("invalid cookie line: SID secretvalue") == "<cookie error, details hidden>"


def test_only_the_refused_part_is_blamed(tmp_path: Path) -> None:
    video = {"format_id": "137-1", "format_note": "1080p, WEB-E"}
    audio = {"format_id": "140-0", "format_note": "medium, VISI"}
    # The video part finished (kept as <id>.f137-1.mp4), the audio one was refused (only a .part).
    (tmp_path / "abcdefghijk.f137-1.mp4").write_bytes(b"v")
    (tmp_path / "abcdefghijk.f140-0.m4a.part").write_bytes(b"")
    assert worker._refused_parts(tmp_path, [video, audio]) == [audio]
    # Nothing finished: the first part was refused.
    (tmp_path / "abcdefghijk.f137-1.mp4").unlink()
    assert worker._refused_parts(tmp_path, [video, audio]) == [video]
    # A single part, or every part finished (merge step failed): all parts.
    assert worker._refused_parts(tmp_path, [video]) == [video]
    (tmp_path / "abcdefghijk.f137-1.mp4").write_bytes(b"v")
    (tmp_path / "abcdefghijk.f140-0.m4a").write_bytes(b"a")
    assert worker._refused_parts(tmp_path, [video, audio]) == [video, audio]
