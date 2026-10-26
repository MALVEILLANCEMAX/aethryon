"""Control Center (docs/ADMIN.md §5): usage events with job_id/cause, refusal platform_disabled, internal
admin API /internal/v1 (forwarding headers, source network, internal token, status, jobs, cancel)."""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import ConfigError, load_settings, parse_allow_from
from app.errors import USER_TEXT, ApiError
from app.internal import FORBIDDEN_DETAIL, address_allowed
from app.logging_setup import JsonFormatter
from app.userkeys import CAUSE_MAX, UsageEvents, clean_cause
from tests.conftest import TOKEN, FakeWorker
from tests.test_user_keys import (INTERNAL, KEY_A, KEY_B, TT, TT2, FakeAccount, account,  # noqa: F401 (fixture)
                                  bearer, wait_events)

INSIDE = ("10.251.20.5", 40000)  # ytc-account on ytc-internal
OUTSIDE = ("172.18.0.7", 40000)  # reverse proxy network
NETS = parse_allow_from("10.251.20.0/24")
H = {"X-Internal-Token": INTERNAL}
JOB_FIELDS = {"job_id", "usage_id", "user_id", "platform", "fmt", "quality", "stage", "progress", "status",
              "created_at", "updated_at"}
FORBIDDEN = {"error": "forbidden", "detail": FORBIDDEN_DETAIL}


@pytest.fixture
def make_internal(account: FakeAccount, make_client: Callable[..., TestClient],  # noqa: F811
                  tmp_path: Path) -> Callable[..., TestClient]:
    # account first: set up before the apps, stopped after them (their last usage events are delivered)
    token_file = tmp_path / "account_internal_token"
    token_file.write_text(INTERNAL + "\n")

    def factory(client: tuple[str, int] = INSIDE, **overrides: Any) -> TestClient:
        options: dict[str, Any] = {
            "user_keys_enabled": True, "account_internal_url": account.url,  # type: ignore[attr-defined]
            "account_internal_token_file": token_file, "user_key_cache_s": 0.0, "internal_allow_from": NETS,
        }
        options.update(overrides)
        return make_client({"client": client}, **options)

    return factory


@pytest.fixture
def ic(make_internal: Callable[..., TestClient]) -> TestClient:
    return make_internal()


def wait_until(predicate: Callable[[], bool], timeout: float = 5.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError("condition not reached")


def states_of(account: FakeAccount, usage_id: str) -> list[str]:  # noqa: F811
    return [payload["state"] for uid, payload in account.events if uid == usage_id]


# --- configuration ---------------------------------------------------------------------------------

def test_parse_allow_from() -> None:
    assert parse_allow_from("") == ()
    nets = parse_allow_from(" 10.251.20.0/24 , 10.251.10.0/24,,fd00:ab::/64, 10.251.20.0/24")
    assert [str(n) for n in nets] == ["10.251.20.0/24", "10.251.10.0/24", "fd00:ab::/64"]
    assert [str(n) for n in parse_allow_from("10.251.20.9")] == ["10.251.20.9/32"]


@pytest.mark.parametrize("raw", ["nope", "10.251.20.0/33", "10.251.20.5/24", "0.0.0.0/0", "::/0", "10.251.20.0/24,x"])
def test_bad_allow_from(raw: str) -> None:
    with pytest.raises(ConfigError):
        parse_allow_from(raw)


def test_load_settings_reads_internal_allow_from(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_TOKEN", TOKEN)
    monkeypatch.delenv("INTERNAL_ALLOW_FROM", raising=False)
    assert load_settings().internal_allow_from == ()
    monkeypatch.setenv("INTERNAL_ALLOW_FROM", "10.251.20.0/24")
    assert [str(n) for n in load_settings().internal_allow_from] == ["10.251.20.0/24"]
    monkeypatch.setenv("INTERNAL_ALLOW_FROM", "10.251.20.0/240")
    with pytest.raises(ConfigError):
        load_settings()


def test_address_allowed() -> None:
    assert address_allowed("10.251.20.5", NETS)
    assert address_allowed("::ffff:10.251.20.5", NETS)  # dual-stack socket
    for host in ("10.251.21.5", "172.18.0.7", "127.0.0.1", "testclient", "", None, "fd00::1"):
        assert not address_allowed(host, NETS), host
    assert not address_allowed("10.251.20.5", ())


# --- usage events: job_id and cause ------------------------------------------------------------------

def test_usage_events_carry_job_id(ic: TestClient, account: FakeAccount) -> None:  # noqa: F811
    r = ic.post("/jobs?wait=5", json={"url": TT, "fmt": "mp4"}, headers=bearer(KEY_A))
    assert r.status_code == 200, r.text
    events = wait_events(account, 2)
    assert [(e[1]["state"], e[1]["job_id"]) for e in events] == [("running", r.json()["job_id"]),
                                                                ("done", r.json()["job_id"])]
    assert all("cause" not in e[1] for e in events)


def test_error_event_carries_the_cleaned_cause(ic: TestClient, account: FakeAccount,  # noqa: F811
                                               fake_worker: FakeWorker) -> None:
    error = ApiError(502, "upstream_forbidden", "La plateforme refuse le flux du média (HTTP 403).")
    error.cause = ("HTTP Error 403: Forbidden (client visionos) "  # type: ignore[attr-defined]
                   "https://rr1---sn.googlevideo.com/videoplayback?sig=SECRET " + "x" * 400)
    fake_worker.error = error
    r = ic.post("/jobs?wait=5", json={"url": TT, "fmt": "mp4"}, headers=bearer(KEY_A))
    assert r.status_code == 502
    payload = wait_events(account, 2)[-1][1]
    assert payload["state"] == "error" and payload["error_code"] == "upstream_forbidden"
    assert payload["job_id"] == r.json()["job_id"]
    assert payload["cause"].startswith("HTTP Error 403: Forbidden (client visionos) <url>")
    assert len(payload["cause"]) <= CAUSE_MAX
    assert "googlevideo" not in json.dumps(payload) and "SECRET" not in json.dumps(payload)
    assert "tiktok.com" not in json.dumps(payload)
    assert "cause" not in r.json() and "cause" not in ic.get(f"/jobs/{r.json()['job_id']}",
                                                             headers=bearer(KEY_A)).json()


def test_crash_event_cause_is_the_exception_class_only(ic: TestClient, account: FakeAccount,  # noqa: F811
                                                       fake_worker: FakeWorker) -> None:
    fake_worker.error = RuntimeError("secret https://www.tiktok.com/@x/video/1")  # type: ignore[assignment]
    assert ic.post("/jobs?wait=5", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A)).status_code == 500
    payload = wait_events(account, 2)[-1][1]
    assert (payload["error_code"], payload["cause"]) == ("internal_error", "RuntimeError")


def test_clean_cause() -> None:
    assert clean_cause(None) is None and clean_cause(12) is None and clean_cause("  ") is None
    assert clean_cause("a\nb  see www.example.com/x?y=1 or ftp://h/p") == "a b see <url> or <url>"
    assert len(clean_cause("é" * 1000) or "") == CAUSE_MAX
    started = time.monotonic()  # hostile input: no catastrophic backtracking
    assert clean_cause("a" * 100_000 + "://x") == "a" * CAUSE_MAX
    assert clean_cause("http://" * 50_000) == "<url>"
    assert time.monotonic() - started < 1


def test_usage_events_allow_job_id_and_cause_only_on_top() -> None:
    assert UsageEvents.ALLOWED == {"state", "job_id", "error_code", "cause", "platform", "size_bytes"}


# --- refusal platform_disabled ------------------------------------------------------------------------

def test_platform_disabled_is_a_503_and_keeps_the_key(make_internal: Callable[..., TestClient],
                                                      account: FakeAccount) -> None:  # noqa: F811
    c = make_internal(user_key_cache_s=30.0)  # positive access decisions cached: forget() would show
    assert c.get("/jobs/nope", headers=bearer(KEY_A)).status_code == 404
    accesses = sum(1 for x in account.calls if x["action"] == "access")
    account.disabled_platforms.add("tiktok")
    for _ in range(12):  # never counted as authentication failures (10 would lock the IP out)
        r = c.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A))
        assert (r.status_code, r.json()) == (503, {"error": "platform_disabled",
                                                   "detail": "Cette plateforme est momentanément désactivée."})
        assert "WWW-Authenticate" not in r.headers
    # the key was not forgotten: still served from the access cache, never re-asked to account
    assert c.get("/jobs/nope", headers=bearer(KEY_A)).status_code == 404
    assert sum(1 for x in account.calls if x["action"] == "access") == accesses
    # other platforms keep working
    assert c.post("/jobs?wait=5", json={"url": "https://x.com/u/status/1234567890", "fmt": "mp4"},
                  headers=bearer(KEY_A)).status_code == 200


# --- internal API: access control ----------------------------------------------------------------

@pytest.mark.parametrize("path", ["/internal/v1/status", "/internal/v1/jobs"])
@pytest.mark.parametrize("headers", [
    {},
    {"X-Internal-Token": ""},
    {"X-Internal-Token": "wrong"},
    {"X-Internal-Token": INTERNAL[:-1] + "Z"},  # same length
    {"X-Internal-Token": INTERNAL + "x"},
    {"X-Internal-Token": KEY_A},
    {"Authorization": f"Bearer {TOKEN}"},  # the admin token does not open the internal API
    {"Authorization": f"Bearer {INTERNAL}"},
])
def test_internal_refuses_missing_or_wrong_token(ic: TestClient, path: str, headers: dict[str, str]) -> None:
    r = ic.get(path, headers=headers)
    assert (r.status_code, r.json()) == (403, FORBIDDEN)


@pytest.mark.parametrize("header", [
    {"X-Forwarded-For": "10.251.20.5"},
    {"X-Forwarded-For": ""},
    {"Forwarded": "for=10.251.20.5"},
    {"X-Real-IP": "10.251.20.5"},
    {"X-Forwarded-Proto": "https"},
    {"X-Forwarded-Host": "api.malvu.fr"},
])
def test_internal_refuses_forwarded_requests_even_with_the_token(ic: TestClient, header: dict[str, str]) -> None:
    for path in ("/internal/v1/status", "/internal/v1/jobs"):
        r = ic.get(path, headers={**H, **header})
        assert (r.status_code, r.json()) == (403, FORBIDDEN)
    r = ic.post("/internal/v1/jobs/whatever/cancel", headers={**H, **header})
    assert (r.status_code, r.json()) == (403, FORBIDDEN)


@pytest.mark.parametrize("client", [OUTSIDE, ("10.251.21.5", 1), ("127.0.0.1", 1), ("testclient", 50000)])
def test_internal_refuses_addresses_outside_the_allowed_networks(make_internal: Callable[..., TestClient],
                                                                 client: tuple[str, int]) -> None:
    c = make_internal(client=client)
    for method, path in (("get", "/internal/v1/status"), ("get", "/internal/v1/jobs"),
                         ("post", "/internal/v1/jobs/x/cancel"), ("get", "/internal/v1/nope")):
        r = getattr(c, method)(path, headers=H)
        assert (r.status_code, r.json()) == (403, FORBIDDEN), (method, path)


def test_internal_unknown_route_is_a_404_only_once_authenticated(ic: TestClient) -> None:
    assert ic.get("/internal/v1/nope", headers={"X-Internal-Token": "bad"}).status_code == 403
    r = ic.get("/internal/v1/nope", headers=H)
    assert (r.status_code, r.json()["error"]) == (404, "not_found")
    assert ic.get("/internal/v1/jobs/x/cancel", headers=H).status_code == 404  # GET on a POST route


def test_internal_router_absent_without_internal_allow_from(make_internal: Callable[..., TestClient]) -> None:
    c = make_internal(internal_allow_from=())
    for method, path in (("get", "/internal/v1/status"), ("get", "/internal/v1/jobs"),
                         ("post", "/internal/v1/jobs/x/cancel")):
        r = getattr(c, method)(path, headers=H)
        assert (r.status_code, r.json()["error"]) == (404, "not_found"), (method, path)
    assert not any(getattr(route, "path", "").startswith("/internal") for route in c.app.routes)


def test_internal_router_absent_without_user_keys(make_client: Callable[..., TestClient]) -> None:
    c = make_client({"client": INSIDE}, internal_allow_from=NETS)  # USER_KEYS_ENABLED off: no shared token
    r = c.get("/internal/v1/status", headers=H)
    assert (r.status_code, r.json()["error"]) == (404, "not_found")


def test_internal_token_never_logged(ic: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    ic.get("/internal/v1/status", headers=H)
    ic.get("/internal/v1/jobs", headers={**H, "X-Forwarded-For": "1.2.3.4"})
    ic.get("/internal/v1/jobs", headers={"X-Internal-Token": INTERNAL[:-1] + "Z"})
    formatter = JsonFormatter()
    text = "\n".join(formatter.format(rec) for rec in caplog.records)
    assert INTERNAL not in text and INTERNAL[:24] not in text
    requests = [rec for rec in caplog.records if rec.getMessage() == "request"]
    assert [getattr(rec, "token", None) for rec in requests] == ["internal", None, None]
    refused = [getattr(rec, "reason", None) for rec in caplog.records if rec.getMessage() == "internal access refused"]
    assert refused == ["forwarded", "token"]


# --- internal API: status and jobs ---------------------------------------------------------------

def test_internal_status(ic: TestClient) -> None:
    r = ic.get("/internal/v1/status", headers=H)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"status", "platforms", "youtube_cooldown_min", "youtube_cooldown_max_min", "youtube_proxy", "cookies", "queue", "disk",
                         "cache", "versions", "usage_events"}
    assert set(body["queue"]) == {"pending", "running", "capacity", "jobs"}
    assert set(body["queue"]["jobs"]) == {"queued", "running", "done", "error"}
    assert set(body["platforms"]) == {"youtube", "tiktok", "twitter"}
    assert {"free_bytes", "floor_bytes"} <= set(body["disk"])
    assert body["cookies"]["state"] == "absent"
    assert set(body["usage_events"]) == {"sent", "dropped", "pending"}
    assert "tokens" not in body and "labels" not in r.text and TOKEN not in r.text
    # the admin /status keeps its token labels
    admin = ic.get("/status", headers={"Authorization": f"Bearer {TOKEN}"}).json()
    assert "labels" in admin["tokens"] and "usage_events" not in admin


def test_internal_jobs_lists_active_jobs_without_url(ic: TestClient, account: FakeAccount,  # noqa: F811
                                                     fake_worker: FakeWorker) -> None:
    assert ic.get("/internal/v1/jobs", headers=H).json() == []
    fake_worker.delay_s = 5.0
    user = ic.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A)).json()
    admin = ic.post("/jobs", json={"url": "https://x.com/u/status/1234567890", "fmt": "mp4", "quality": "720"},
                    headers={"Authorization": f"Bearer {TOKEN}"}).json()
    wait_until(lambda: all(j["status"] == "running" for j in ic.get("/internal/v1/jobs", headers=H).json()))
    r = ic.get("/internal/v1/jobs", headers=H)
    assert r.status_code == 200
    jobs = r.json()
    assert [j["job_id"] for j in jobs] == [user["job_id"], admin["job_id"]]  # oldest first
    for job in jobs:
        assert set(job) == JOB_FIELDS
        assert job["created_at"].endswith("Z") and job["updated_at"].endswith("Z")
        assert isinstance(job["progress"], float)
    u, a = jobs
    assert (u["user_id"], u["platform"], u["fmt"], u["quality"], u["status"]) == ("user-a", "tiktok", "mp3", None,
                                                                                   "running")
    assert u["usage_id"] and u["usage_id"].startswith("usage-")
    assert (a["user_id"], a["usage_id"], a["platform"], a["fmt"], a["quality"]) == (None, None, "twitter", "mp4", "720")
    for forbidden in ("tiktok.com", "x.com", "someone", "1234567890", "Café", "title", "filename", "url"):
        assert forbidden not in r.text, forbidden
    # finished jobs are not listed
    for job_id in (user["job_id"], admin["job_id"]):
        assert ic.post(f"/internal/v1/jobs/{job_id}/cancel", headers=H).status_code == 200
    assert ic.get("/internal/v1/jobs", headers=H).json() == []


# --- internal API: cancel ------------------------------------------------------------------------

def test_internal_cancel_running_user_job(ic: TestClient, account: FakeAccount,  # noqa: F811
                                          fake_worker: FakeWorker) -> None:
    fake_worker.delay_s = 10.0
    created = ic.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert created.status_code == 202
    job_id, usage_id = created.json()["job_id"], f"usage-{len(account.calls):04d}"
    wait_until(lambda: states_of(account, usage_id) == ["running"])
    job = ic.app.state.jobs.jobs[job_id]  # type: ignore[attr-defined]
    assert job.workdir.is_dir()
    started = time.monotonic()
    r = ic.post(f"/internal/v1/jobs/{job_id}/cancel", headers=H)
    assert (r.status_code, r.json()) == (200, {"job_id": job_id, "cancelled": True})
    assert time.monotonic() - started < 5
    assert fake_worker.cancelled == 1
    wait_until(lambda: states_of(account, usage_id) == ["running", "cancelled"])
    cancelled = [p for uid, p in account.events if uid == usage_id][-1]
    assert cancelled == {"state": "cancelled", "job_id": job_id, "platform": "tiktok"}
    assert not job.workdir.exists()
    # the owner reads the fixed text of docs/ERREURS.md instead of « job inconnu »
    status = ic.get(f"/jobs/{job_id}", headers=bearer(KEY_A)).json()
    assert (status["status"], status["error"], status["detail"]) == ("error", "cancelled", USER_TEXT["cancelled"])
    # a new conversion is possible right away (the active job limit is free again)
    assert ic.post("/jobs", json={"url": TT2, "fmt": "mp3"}, headers=bearer(KEY_A)).status_code == 202
    # idempotent: nothing changes the second time
    again = ic.post(f"/internal/v1/jobs/{job_id}/cancel", headers=H)
    assert (again.status_code, again.json()["error"]) == (409, "job_already_cancelled")
    assert states_of(account, usage_id) == ["running", "cancelled"]


def test_internal_cancel_unknown_and_finished_jobs(ic: TestClient, account: FakeAccount) -> None:  # noqa: F811
    r = ic.post("/internal/v1/jobs/does-not-exist/cancel", headers=H)
    assert (r.status_code, r.json()["error"]) == (404, "job_not_found")
    done = ic.post("/jobs?wait=5", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A)).json()
    assert done["status"] == "done"
    events = len(wait_events(account, 2))
    r = ic.post(f"/internal/v1/jobs/{done['job_id']}/cancel", headers=H)
    assert (r.status_code, r.json()["error"]) == (409, "job_finished")
    assert ic.get(f"/jobs/{done['job_id']}/file", headers=bearer(KEY_A)).status_code == 200  # untouched
    time.sleep(0.2)
    assert len(account.events) == events  # no event for a refused cancellation


def test_internal_cancel_merged_job_whatever_its_subscribers(ic: TestClient, fake_worker: FakeWorker) -> None:
    fake_worker.delay_s = 10.0
    admin = {"Authorization": f"Bearer {TOKEN}"}
    first = ic.post("/jobs", json={"url": TT, "fmt": "mp4"}, headers=admin).json()
    second = ic.post("/jobs", json={"url": TT, "fmt": "mp4"}, headers=admin).json()
    assert second["merged"] is True and second["job_id"] == first["job_id"]
    r = ic.post(f"/internal/v1/jobs/{first['job_id']}/cancel", headers=H)
    assert (r.status_code, r.json()["cancelled"]) == (200, True)
    status = ic.get(f"/jobs/{first['job_id']}", headers=admin).json()
    assert (status["status"], status["error"]) == ("error", "cancelled")


def test_internal_cancel_queued_job(make_internal: Callable[..., TestClient], account: FakeAccount,  # noqa: F811
                                    fake_worker: FakeWorker) -> None:
    c = make_internal(max_concurrent=1)
    fake_worker.delay_s = 10.0
    running = c.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A)).json()
    queued = c.post("/jobs", json={"url": TT2, "fmt": "mp3"}, headers=bearer(KEY_B)).json()
    assert account.creates() == 2
    wait_until(lambda: [j["status"] for j in c.get("/internal/v1/jobs", headers=H).json()] == ["running", "queued"])
    r = c.post(f"/internal/v1/jobs/{queued['job_id']}/cancel", headers=H)
    assert (r.status_code, r.json()) == (200, {"job_id": queued["job_id"], "cancelled": True})
    jobs = c.get("/internal/v1/jobs", headers=H).json()
    assert [(j["job_id"], j["status"]) for j in jobs] == [(running["job_id"], "running")]
    # the queued job never ran: cancelled without a running event, the worker was never called for it
    wait_until(lambda: any(p == {"state": "cancelled", "job_id": queued["job_id"], "platform": "tiktok"}
                           for _, p in account.events))
    assert not any(p.get("job_id") == queued["job_id"] and p["state"] == "running" for _, p in account.events)
    assert len(fake_worker.calls) == 1


@pytest.mark.parametrize("moment", ["slot", "gate"])
def test_cancel_racing_the_slot_or_gate_never_starts_the_job(make_internal: Callable[..., TestClient],  # noqa: F811
                                                            account: FakeAccount, fake_worker: FakeWorker,
                                                            monkeypatch: pytest.MonkeyPatch, moment: str) -> None:
    """The slot and the platform gate only poll the cancel flag on their own timeouts: a cancel that
    lands exactly when the slot (or the gate) is granted must still stop the job before it runs."""
    import contextlib

    c = make_internal()
    runner, manager = c.app.state.runner, c.app.state.jobs  # type: ignore[attr-defined]

    def cancel_all() -> None:
        for job in list(manager.jobs.values()):
            job.cancel_event.set()

    if moment == "slot":
        original_slot = runner.download_slot

        @contextlib.asynccontextmanager
        async def racing_slot(cancel_check=None):  # type: ignore[no-untyped-def]
            async with original_slot(cancel_check):
                cancel_all()
                yield

        monkeypatch.setattr(runner, "download_slot", racing_slot)
    else:
        original_acquire = runner.platforms.acquire

        async def racing_acquire(platform, cancel_check=None):  # type: ignore[no-untyped-def]
            gate = await original_acquire(platform, cancel_check)
            cancel_all()
            return gate

        monkeypatch.setattr(runner.platforms, "acquire", racing_acquire)

    job = c.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A)).json()
    wait_until(lambda: any(p.get("job_id") == job["job_id"] and p["state"] == "cancelled" for _, p in account.events))
    assert not any(p.get("job_id") == job["job_id"] and p["state"] == "running" for _, p in account.events)
    assert fake_worker.calls == []
