"""Per-user API keys (USER_KEYS_ENABLED): auth via a fake account service, ownership, quotas, events."""

from __future__ import annotations

import json
import logging
import threading
import time
from collections.abc import Callable, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.errors import USER_TEXT, ApiError
from tests.conftest import TOKEN, FakeWorker

INTERNAL = "internal-test-token-" + "z" * 32
KEY_A = "ytc_" + "A" * 64
KEY_A2 = "ytc_" + "a" * 64  # second key of user A
KEY_B = "ytc_" + "B" * 64
TT = "https://www.tiktok.com/@someone/video/7234567890123456789"
TT2 = "https://www.tiktok.com/@someone/video/7234567890123456780"


class FakeAccount:
    """Minimal stand-in for the account service's internal API."""

    def __init__(self) -> None:
        self.keys: dict[str, dict[str, Any]] = {
            KEY_A: {"user_id": "user-a", "key_id": "key-a-0001"},
            KEY_A2: {"user_id": "user-a", "key_id": "key-a-0002"},
            KEY_B: {"user_id": "user-b", "key_id": "key-b-0001"},
        }
        self.revoked: set[str] = set()
        self.expired: set[str] = set()
        self.suspended: set[str] = set()
        self.paused = False
        self.disabled_platforms: set[str] = set()  # plateformes coupées dans le Control Center
        self.kinds: dict[str, str] = {}  # key_kind (« discord » : clé remise au bot), « shortcut » sinon
        self.daily = 10
        self.used: dict[str, int] = {}
        self.calls: list[dict[str, Any]] = []
        self.events: list[tuple[str, dict[str, Any]]] = []
        self.down = False
        self.lock = threading.Lock()
        self.server: ThreadingHTTPServer | None = None

    def handle(self, path: str, token: str | None, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        if self.down:
            return 500, {"error": "internal_error"}
        if token != INTERNAL:
            return 401, {"error": "unauthorized"}
        with self.lock:
            if path == "/internal/v1/authorize":
                self.calls.append(body)
                key = self.keys.get(body.get("key", ""))
                if key is None or body["key"] in self.revoked:
                    return 200, {"allow": False, "reason": "invalid_key", "message": "Jeton absent ou invalide."}
                if body["key"] in self.expired:
                    return 200, {"allow": False, "reason": "expired",
                                 "message": "Ce jeton a expiré. Génère une nouvelle clé depuis ton espace personnel."}
                if key["user_id"] in self.suspended:
                    return 200, {"allow": False, "reason": "user_suspended", "message": "Ce compte est suspendu."}
                base = {"allow": True, "user_id": key["user_id"], "key_id": key["key_id"], "key_name": "iPhone",
                        "key_kind": self.kinds.get(body["key"], "shortcut"),
                        "limits": {"daily": self.daily, "max_active": 1}}
                if body["action"] == "access":
                    return 200, {**base, "remaining_today": self.daily - self.used.get(key["user_id"], 0)}
                if body.get("fmt") not in ("mp3", "mp4"):
                    return 200, {"allow": False, "reason": "format_not_allowed", "message": "Format non disponible."}
                if self.paused:
                    return 200, {"allow": False, "reason": "paused", "message": "Conversions suspendues.", "retry_after_s": 300}
                if body.get("platform") in self.disabled_platforms:
                    return 200, {"allow": False, "reason": "platform_disabled",
                                 "message": "Cette plateforme est momentanément désactivée."}
                used = self.used.get(key["user_id"], 0)
                if used >= self.daily:
                    return 200, {"allow": False, "reason": "quota_exceeded", "message": "Limite atteinte.", "retry_after_s": 3600}
                self.used[key["user_id"]] = used + 1
                return 200, {**base, "remaining_today": self.daily - used - 1, "usage_id": f"usage-{len(self.calls):04d}"}
            if path.startswith("/internal/v1/usage/"):
                self.events.append((path.rsplit("/", 1)[1], body))
                return 200, {"ok": True}
        return 404, {"error": "not_found"}

    def start(self) -> str:
        account = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("content-length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                status, payload = account.handle(self.path, self.headers.get("x-internal-token"), body)
                data = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args: Any) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def stop(self) -> None:
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()

    def creates(self) -> int:
        return sum(1 for c in self.calls if c["action"] == "create_job")


@pytest.fixture
def account() -> Iterator[FakeAccount]:
    fake = FakeAccount()
    fake.url = fake.start()  # type: ignore[attr-defined]
    yield fake
    fake.stop()


@pytest.fixture
def ukclient(make_client: Callable[..., TestClient], account: FakeAccount, tmp_path: Path) -> TestClient:
    token_file = tmp_path / "account_internal_token"
    token_file.write_text(INTERNAL)
    return make_client(user_keys_enabled=True, account_internal_url=account.url,  # type: ignore[attr-defined]
                       account_internal_token_file=token_file, user_key_cache_s=0.0)


def bearer(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"}


def wait_events(account: FakeAccount, n: int, timeout: float = 5.0) -> list[tuple[str, dict[str, Any]]]:
    deadline = time.time() + timeout
    while time.time() < deadline and len(account.events) < n:
        time.sleep(0.05)
    return list(account.events)


def assert_no_null_error(body: dict[str, Any]) -> None:
    assert "error" not in body or body["error"] is not None


# --- flag off ----------------------------------------------------------------------------------

def test_flag_off_user_key_is_rejected_as_before(client: TestClient) -> None:
    r = client.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert r.status_code == 401
    assert r.json()["error"] == "unauthorized"
    assert "?token=" in r.json()["detail"]  # unchanged admin message


# --- flag on: admin path unchanged --------------------------------------------------------------

def test_admin_token_unchanged(ukclient: TestClient, account: FakeAccount) -> None:
    auth = {"Authorization": f"Bearer {TOKEN}"}
    assert ukclient.get("/status", headers=auth).status_code == 200
    r = ukclient.post("/jobs?wait=5", json={"url": TT, "fmt": "mp3"}, headers=auth)
    assert r.status_code == 200
    assert ukclient.get(f"/jobs/{r.json()['job_id']}?token={TOKEN}").status_code == 200
    assert account.calls == []  # admin tokens never reach the account service


# --- flag on: user keys -------------------------------------------------------------------------

def test_user_job_lifecycle_and_events(ukclient: TestClient, account: FakeAccount, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    r = ukclient.post("/jobs?wait=5", json={"url": TT, "fmt": "mp4"}, headers=bearer(KEY_A))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "done"
    assert_no_null_error(body)
    job_id = body["job_id"]
    assert ukclient.get(f"/jobs/{job_id}", headers=bearer(KEY_A)).status_code == 200
    f = ukclient.get(f"/jobs/{job_id}/file", headers=bearer(KEY_A))
    assert f.status_code == 200 and f.headers["content-type"] == "video/mp4"
    # the other key of the same user also sees it
    assert ukclient.get(f"/jobs/{job_id}", headers=bearer(KEY_A2)).status_code == 200
    events = wait_events(account, 2)
    states = [e[1]["state"] for e in events]
    assert states == ["running", "done"]
    for _, payload in events:
        assert set(payload) <= {"state", "job_id", "error_code", "cause", "platform", "size_bytes"}
        assert payload["job_id"] == job_id  # docs/ADMIN.md §5 : l'usage connaît son job ytapi
        assert "tiktok.com" not in json.dumps(payload) and "Café" not in json.dumps(payload)
    assert events[-1][1]["size_bytes"] == 1000
    # polling and downloading did not consume quota
    assert account.creates() == 1
    # the key never appears in logs; the label does
    text = "\n".join(rec.getMessage() + json.dumps(getattr(rec, "token", "")) for rec in caplog.records)
    assert KEY_A not in text and KEY_A[4:20] not in text
    assert any(getattr(rec, "token", None) == "u:key-a-00" for rec in caplog.records)


def test_other_user_cannot_see_job(ukclient: TestClient, account: FakeAccount) -> None:
    job_id = ukclient.post("/jobs?wait=5", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A)).json()["job_id"]
    for method, path in (("get", f"/jobs/{job_id}"), ("get", f"/jobs/{job_id}/file"), ("delete", f"/jobs/{job_id}")):
        r = getattr(ukclient, method)(path, headers=bearer(KEY_B))
        assert r.status_code == 404, (method, path)
        assert r.json()["error"] == "job_not_found"
    # admins still see everything
    assert ukclient.get(f"/jobs/{job_id}", headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 200


@pytest.mark.parametrize("path", ["/status", "/info?url=" + TT, "/dl?url=" + TT])
def test_admin_routes_forbidden_to_user_keys(ukclient: TestClient, path: str) -> None:
    r = ukclient.get(path, headers=bearer(KEY_A))
    assert r.status_code == 403
    assert r.json()["error"] == "forbidden_for_user_keys"


def test_user_key_in_query_string_refused(ukclient: TestClient, account: FakeAccount) -> None:
    r = ukclient.post(f"/jobs?token={KEY_A}", json={"url": TT, "fmt": "mp3"})
    assert r.status_code == 401
    assert account.calls == []


def test_quota_exceeded(ukclient: TestClient, account: FakeAccount) -> None:
    account.daily = 1
    assert ukclient.post("/jobs?wait=5", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A)).status_code == 200
    r = ukclient.post("/jobs", json={"url": TT2, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert r.status_code == 429
    assert r.json()["error"] == "quota_exceeded"
    assert r.headers["Retry-After"] == "3600"


def test_paused_and_format(ukclient: TestClient, account: FakeAccount) -> None:
    account.paused = True
    r = ukclient.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert (r.status_code, r.json()["error"], r.headers.get("Retry-After")) == (503, "service_paused", "300")
    account.paused = False
    r = ukclient.post("/jobs", json={"url": TT, "fmt": "gif"}, headers=bearer(KEY_A))
    assert (r.status_code, r.json()["error"]) == (400, "invalid_parameter")


def test_suspended_user(ukclient: TestClient, account: FakeAccount) -> None:
    account.suspended.add("user-a")
    r = ukclient.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert (r.status_code, r.json()["error"]) == (403, "account_suspended")


def test_invalid_and_revoked_keys_count_as_auth_failures(ukclient: TestClient, account: FakeAccount) -> None:
    unknown = "ytc_" + "Q" * 64
    r = ukclient.get("/jobs/whatever", headers=bearer(unknown))
    assert (r.status_code, r.json()["error"]) == (401, "unauthorized")
    account.revoked.add(KEY_B)
    for _ in range(9):
        assert ukclient.get("/jobs/whatever", headers=bearer(KEY_B)).status_code == 401
    # 10 failures from this IP: locked out, even with a valid key (existing behaviour)
    assert ukclient.get("/jobs/whatever", headers=bearer(KEY_A)).status_code == 429


def test_account_service_down_is_503_not_an_auth_failure(ukclient: TestClient, account: FakeAccount) -> None:
    account.down = True
    for _ in range(12):
        r = ukclient.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A))
        assert (r.status_code, r.json()["error"], r.headers.get("Retry-After")) == (503, "auth_unavailable", "10")
    account.down = False
    assert ukclient.post("/jobs?wait=5", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A)).status_code == 200


def test_same_request_joins_own_active_job_without_quota(ukclient: TestClient, account: FakeAccount, fake_worker: FakeWorker) -> None:
    fake_worker.delay_s = 1.0
    first = ukclient.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert first.status_code == 202
    again = ukclient.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert again.json()["job_id"] == first.json()["job_id"]
    assert again.json()["merged"] is True
    assert account.creates() == 1
    other = ukclient.post("/jobs", json={"url": TT2, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert (other.status_code, other.json()["error"], other.headers["Retry-After"]) == (429, "active_job_limit", "15")
    assert account.creates() == 1


def test_no_cross_user_merge(ukclient: TestClient, account: FakeAccount, fake_worker: FakeWorker) -> None:
    fake_worker.delay_s = 0.5
    a = ukclient.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A)).json()
    b = ukclient.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_B)).json()
    assert a["job_id"] != b["job_id"]
    assert b["merged"] is False
    assert account.creates() == 2


def test_creation_failure_refunds_the_unit(ukclient: TestClient, account: FakeAccount) -> None:
    def busy() -> None:
        raise ApiError(503, "server_busy", "Serveur occupé.", {"Retry-After": "30"})

    ukclient.app.state.runner.reserve = busy  # type: ignore[attr-defined]
    r = ukclient.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert (r.status_code, r.json()["error"]) == (503, "server_busy")
    assert_no_null_error(r.json())
    events = wait_events(account, 1)
    assert [e[1]["state"] for e in events] == ["refunded"]


def test_failed_job_reports_error_code(ukclient: TestClient, account: FakeAccount, fake_worker: FakeWorker) -> None:
    fake_worker.error = ApiError(403, "private", "Vidéo privée.")
    r = ukclient.post("/jobs?wait=5", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert r.status_code == 403
    assert r.json()["error"] == "private"
    events = wait_events(account, 2)
    assert events[-1][1] == {"state": "error", "job_id": r.json()["job_id"], "error_code": "private",
                             "platform": "tiktok"}


def test_access_decisions_are_cached_briefly(make_client: Callable[..., TestClient], account: FakeAccount, tmp_path: Path) -> None:
    token_file = tmp_path / "tok"
    token_file.write_text(INTERNAL)
    c = make_client(user_keys_enabled=True, account_internal_url=account.url,  # type: ignore[attr-defined]
                    account_internal_token_file=token_file, user_key_cache_s=30.0)
    for _ in range(5):
        assert c.get("/jobs/nope", headers=bearer(KEY_A)).status_code == 404
    assert sum(1 for x in account.calls if x["action"] == "access") == 1
    # create_job is never cached
    c.post("/jobs?wait=5", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A))
    c.post("/jobs?wait=5", json={"url": TT2, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert account.creates() == 2


# --- corrections issues de la revue de sécurité -------------------------------------------------

def test_user_jobs_never_use_owner_cookies(make_client: Callable[..., TestClient], account: FakeAccount,
                                           tmp_path: Path, fake_worker: FakeWorker) -> None:
    token_file = tmp_path / "tok"
    token_file.write_text(INTERNAL)
    cookies = tmp_path / "cookies.txt"
    cookies.write_text("# Netscape HTTP Cookie File\n")
    c = make_client(user_keys_enabled=True, account_internal_url=account.url,  # type: ignore[attr-defined]
                    account_internal_token_file=token_file, user_key_cache_s=0.0)
    c.app.state.jobs.cookies_for = lambda platform: str(cookies)  # type: ignore[attr-defined]
    yt = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert c.post("/jobs?wait=5", json={"url": yt, "fmt": "mp3"}, headers=bearer(KEY_A)).status_code == 200
    assert fake_worker.calls[-1].cookies_file is None
    assert c.post("/jobs?wait=5", json={"url": yt, "fmt": "mp4"}, headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 200
    assert fake_worker.calls[-1].cookies_file == str(cookies)


def test_admin_cached_result_is_not_served_to_users(make_client: Callable[..., TestClient], account: FakeAccount,
                                                    tmp_path: Path, fake_worker: FakeWorker) -> None:
    token_file = tmp_path / "tok"
    token_file.write_text(INTERNAL)
    c = make_client(user_keys_enabled=True, account_internal_url=account.url,  # type: ignore[attr-defined]
                    account_internal_token_file=token_file, user_key_cache_s=0.0, cache_ttl_min=30,
                    cache_dir=None)
    admin = c.post("/jobs?wait=5", json={"url": TT, "fmt": "mp3"}, headers={"Authorization": f"Bearer {TOKEN}"}).json()
    assert admin["cached"] is False
    calls = len(fake_worker.calls)
    user = c.post("/jobs?wait=5", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert user.status_code == 200
    assert "cached" not in user.json()  # users never learn about the shared cache
    assert len(fake_worker.calls) == calls + 1  # the admin's file was not reused for the user
    # users share their own namespace: B gets A's result from the user cache
    b = c.post("/jobs?wait=5", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_B))
    assert b.status_code == 200 and len(fake_worker.calls) == calls + 1
    f = c.get(new_path(b.json()["file_url"]), headers=bearer(KEY_B))
    assert f.status_code == 200 and "X-Cache" not in f.headers


def new_path(url: str) -> str:
    from urllib.parse import urlsplit
    return urlsplit(url).path


def test_user_file_path_and_media_id_not_logged(ukclient: TestClient, account: FakeAccount, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    r = ukclient.post("/jobs?wait=5", json={"url": TT, "fmt": "mp4"}, headers=bearer(KEY_A)).json()
    assert ukclient.get(new_path(r["file_url"]), headers=bearer(KEY_A)).status_code == 200
    paths = [getattr(rec, "path", "") for rec in caplog.records if rec.getMessage() == "request"]
    assert any(p.endswith("/file") for p in paths)
    assert not any("Café" in str(p) or ".mp4" in str(p) for p in paths)
    done = [rec for rec in caplog.records if rec.getMessage() == "job done"]
    assert done and not any(hasattr(rec, "media_id") for rec in done)


def test_refused_keys_are_cached_negatively(ukclient: TestClient, account: FakeAccount) -> None:
    fake = "ytc_" + "N" * 64
    for _ in range(5):
        assert ukclient.get("/jobs/x", headers=bearer(fake)).status_code == 401
    assert sum(1 for c in account.calls if c["key"] == fake) == 1


def test_internal_client_ignores_http_proxy(monkeypatch: pytest.MonkeyPatch, ukclient: TestClient, account: FakeAccount) -> None:
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9")  # would fail if used
    monkeypatch.setenv("http_proxy", "http://127.0.0.1:9")
    assert ukclient.post("/jobs?wait=5", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A)).status_code == 200


# --- compatibilité ancien / nouveau jeton, révocation immédiate, plusieurs jetons par utilisateur ----


def test_default_settings_have_no_access_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import Settings, load_settings
    assert Settings.__dataclass_fields__["user_key_cache_s"].default == 0.0
    monkeypatch.delenv("USER_KEY_CACHE_S", raising=False)
    monkeypatch.setenv("API_TOKEN", TOKEN)
    assert load_settings().user_key_cache_s == 0.0


def test_revoked_key_is_refused_on_the_very_next_request(make_client: Callable[..., TestClient], account: FakeAccount,
                                                        tmp_path: Path) -> None:
    token_file = tmp_path / "tok"
    token_file.write_text(INTERNAL)
    from app.config import Settings
    c = make_client(user_keys_enabled=True, account_internal_url=account.url,  # type: ignore[attr-defined]
                    account_internal_token_file=token_file,
                    user_key_cache_s=Settings.__dataclass_fields__["user_key_cache_s"].default)
    r = c.post("/jobs?wait=5", json={"url": TT, "fmt": "mp4"}, headers=bearer(KEY_A))
    assert r.status_code == 200
    job_id = r.json()["job_id"]
    assert c.get(f"/jobs/{job_id}", headers=bearer(KEY_A)).status_code == 200
    assert c.get(f"/jobs/{job_id}/file", headers=bearer(KEY_A)).status_code == 200
    account.revoked.add(KEY_A)  # révoqué sur le site
    for path in (f"/jobs/{job_id}", f"/jobs/{job_id}/file"):
        r = c.get(path, headers=bearer(KEY_A))
        assert (r.status_code, r.json()["error"]) == (401, "unauthorized")
    r = c.post("/jobs", json={"url": TT2, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert (r.status_code, r.json()["error"]) == (401, "unauthorized")
    # l'autre jeton du même utilisateur, non révoqué, continue de fonctionner (même propriétaire du job)
    assert c.get(f"/jobs/{job_id}", headers=bearer(KEY_A2)).status_code == 200


def test_expired_key_is_refused_with_its_own_message(ukclient: TestClient, account: FakeAccount) -> None:
    account.expired.add(KEY_B)
    r = ukclient.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_B))
    assert (r.status_code, r.json()["error"]) == (401, "unauthorized")
    assert "expiré" in r.json()["detail"]
    assert r.headers.get("WWW-Authenticate") == "Bearer"
    assert account.creates() == 0


def test_two_keys_of_one_user_share_the_daily_quota(ukclient: TestClient, account: FakeAccount) -> None:
    account.daily = 2
    assert ukclient.post("/jobs?wait=5", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A)).status_code == 200
    assert ukclient.post("/jobs?wait=5", json={"url": TT2, "fmt": "mp3"}, headers=bearer(KEY_A2)).status_code == 200
    for key in (KEY_A, KEY_A2):  # créer un autre jeton ne remet pas le compteur à zéro
        r = ukclient.post("/jobs", json={"url": TT, "fmt": "mp4"}, headers=bearer(key))
        assert (r.status_code, r.json()["error"]) == (429, "quota_exceeded")
    # un autre utilisateur n'est pas touché
    assert ukclient.post("/jobs?wait=5", json={"url": TT, "fmt": "mp4"}, headers=bearer(KEY_B)).status_code == 200


def test_two_keys_of_one_user_share_the_active_job_limit(ukclient: TestClient, account: FakeAccount,
                                                         fake_worker: FakeWorker) -> None:
    fake_worker.delay_s = 1.5
    first = ukclient.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert first.status_code == 202
    r = ukclient.post("/jobs", json={"url": TT2, "fmt": "mp3"}, headers=bearer(KEY_A2))
    assert (r.status_code, r.json()["error"]) == (429, "active_job_limit")
    assert r.headers.get("Retry-After")
    # pas d'unité consommée pour la demande refusée
    assert account.used["user-a"] == 1
    # un autre utilisateur peut convertir en même temps
    assert ukclient.post("/jobs", json={"url": TT2, "fmt": "mp3"}, headers=bearer(KEY_B)).status_code == 202


def test_legacy_and_user_tokens_side_by_side(ukclient: TestClient, account: FakeAccount) -> None:
    admin = ukclient.post("/jobs?wait=5", json={"url": TT, "fmt": "mp4"}, headers=bearer(TOKEN))
    user = ukclient.post("/jobs?wait=5", json={"url": TT, "fmt": "mp4"}, headers=bearer(KEY_A))
    assert admin.status_code == user.status_code == 200
    assert admin.json()["job_id"] != user.json()["job_id"]  # jamais de fusion admin / utilisateur
    # chaque jeton récupère son fichier ; aucun ne voit le job de l'autre
    assert ukclient.get(admin.json()["file_url"].replace("http://testserver", ""), headers=bearer(TOKEN)).status_code == 200
    assert ukclient.get(user.json()["file_url"].replace("http://testserver", ""), headers=bearer(KEY_A)).status_code == 200
    assert ukclient.get(f"/jobs/{admin.json()['job_id']}", headers=bearer(KEY_A)).status_code == 404
    # le jeton historique ne passe jamais par account
    assert all(c["key"] != TOKEN for c in account.calls)


def test_negative_cache_keeps_the_account_message(ukclient: TestClient, account: FakeAccount) -> None:
    account.expired.add(KEY_B)
    first = ukclient.get("/jobs/x", headers=bearer(KEY_B)).json()["detail"]
    again = ukclient.get("/jobs/x", headers=bearer(KEY_B)).json()["detail"]  # servi par le cache de refus
    assert first == again and "expiré" in again
    assert sum(1 for c in account.calls if c["key"] == KEY_B) == 1


# --- textes affichés aux jetons personnels (docs/ERREURS.md) ---------------------------------------

MEDIA_403 = "La plateforme refuse le flux du média (HTTP 403), même après repli sur un autre client."
YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


def test_failed_job_shows_the_user_text_to_user_keys(ukclient: TestClient, account: FakeAccount,
                                                     fake_worker: FakeWorker) -> None:
    fake_worker.error = ApiError(502, "upstream_forbidden", MEDIA_403)
    r = ukclient.post("/jobs?wait=5", json={"url": YT, "fmt": "mp4"}, headers=bearer(KEY_A))
    assert r.status_code == 502
    user_detail = USER_TEXT["upstream_forbidden"]
    assert (r.json()["error"], r.json()["detail"]) == ("upstream_forbidden", user_detail)
    job_id = r.json()["job_id"]
    status = ukclient.get(f"/jobs/{job_id}", headers=bearer(KEY_A)).json()
    assert (status["error"], status["detail"]) == ("upstream_forbidden", user_detail)
    f = ukclient.get(f"/jobs/{job_id}/file", headers=bearer(KEY_A))
    assert (f.status_code, f.json()) == (409, {"error": "job_failed", "detail": user_detail})
    # The admin token sees the technical detail of the same job.
    admin = {"Authorization": f"Bearer {TOKEN}"}
    assert ukclient.get(f"/jobs/{job_id}", headers=admin).json()["detail"] == MEDIA_403
    f = ukclient.get(f"/jobs/{job_id}/file", headers=admin)
    assert f.status_code == 409 and MEDIA_403 in f.json()["detail"] and "upstream_forbidden" in f.json()["detail"]
    # The usage event only carries the code (+ the job id): the account site shows the same text from its
    # own table.
    assert wait_events(account, 2)[-1][1] == {"state": "error", "job_id": job_id, "error_code": "upstream_forbidden",
                                              "platform": "youtube"}


def test_admin_jobs_keep_technical_details(ukclient: TestClient, fake_worker: FakeWorker) -> None:
    fake_worker.error = ApiError(404, "unavailable", "TikTok ne fournit pas ce post au serveur (statut 10204 : "
                                                     "supprimé, masqué ou bloqué dans le pays du serveur).")
    r = ukclient.post("/jobs?wait=5", json={"url": TT, "fmt": "mp4"}, headers=bearer(TOKEN))
    assert (r.status_code, r.json()["error"]) == (404, "unavailable")
    assert "10204" in r.json()["detail"]


@pytest.mark.parametrize(("code", "status"), [("unavailable", 404), ("short_link_unresolved", 502),
                                              ("no_audio", 400), ("conversion_failed", 500), ("cancelled", 499)])
def test_user_text_for_each_failure_code(ukclient: TestClient, fake_worker: FakeWorker, code: str,
                                         status: int) -> None:
    fake_worker.error = ApiError(status, code, "détail technique")
    r = ukclient.post("/jobs?wait=5", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert (r.status_code, r.json()["error"], r.json()["detail"]) == (status, code, USER_TEXT[code])


def test_unknown_failure_code_keeps_its_detail(ukclient: TestClient, fake_worker: FakeWorker) -> None:
    fake_worker.error = ApiError(502, "brand_new_code", "Texte précis.")
    r = ukclient.post("/jobs?wait=5", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert (r.json()["error"], r.json()["detail"]) == ("brand_new_code", "Texte précis.")


def test_crashed_job_shows_the_internal_error_text(ukclient: TestClient, fake_worker: FakeWorker) -> None:
    fake_worker.error = RuntimeError("secret internal detail")  # type: ignore[assignment]
    r = ukclient.post("/jobs?wait=5", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert (r.status_code, r.json()["error"], r.json()["detail"]) == (500, "internal_error", "Erreur interne.")
    assert "secret" not in r.text


@pytest.mark.parametrize(("url", "code"), [
    ("https://www.tiktok.com/@someone", "playlist_not_supported"),
    ("https://www.tiktok.com/@someone/live", "live_not_supported"),
    ("https://www.tiktok.com/@someone/photo/7594147928399219990", "unsupported_content"),
    ("https://www.tiktok.com/", "unsupported_url"),
])
def test_refused_links_use_the_user_text(ukclient: TestClient, account: FakeAccount, fake_worker: FakeWorker,
                                         url: str, code: str) -> None:
    r = ukclient.post("/jobs", json={"url": url, "fmt": "mp4"}, headers=bearer(KEY_A))
    assert (r.status_code, r.json()) == (400, {"error": code, "detail": USER_TEXT[code]})
    assert account.creates() == 0 and fake_worker.calls == []  # refused before quota and worker
    admin = ukclient.post("/jobs", json={"url": url, "fmt": "mp4"}, headers=bearer(TOKEN))
    assert admin.json()["error"] == code and admin.json()["detail"] != USER_TEXT[code]


def test_errors_outside_the_table_keep_their_message(ukclient: TestClient, account: FakeAccount) -> None:
    r = ukclient.post("/jobs", json={"url": "https://evil.example/x", "fmt": "mp4"}, headers=bearer(KEY_A))
    assert r.json()["error"] == "domain_not_allowed" and "evil.example" in r.json()["detail"]
    unknown = ukclient.get("/jobs/x", headers=bearer("ytc_" + "Q" * 64))
    assert unknown.status_code == 401 and unknown.json()["detail"] == "Jeton absent ou invalide."
    account.daily = 0
    r = ukclient.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert (r.status_code, r.json()["detail"]) == (429, "Limite atteinte.")
    assert ukclient.get("/jobs/nope", headers=bearer(KEY_A)).json()["error"] == "job_not_found"
    r = ukclient.post("/jobs", json={"url": TT, "fmt": "avi"}, headers=bearer(KEY_A))
    assert r.json()["error"] == "invalid_parameter" and "fmt" in r.json()["detail"]


def test_user_rate_limit_message_unchanged(make_client: Callable[..., TestClient], account: FakeAccount,
                                           tmp_path: Path) -> None:
    token_file = tmp_path / "tok"
    token_file.write_text(INTERNAL)
    c = make_client(user_keys_enabled=True, account_internal_url=account.url,  # type: ignore[attr-defined]
                    account_internal_token_file=token_file, user_key_cache_s=0.0, rate_limit=(1, 60))
    limited = [c.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A)) for _ in range(2)][-1]
    assert limited.status_code == 429 and limited.json()["error"] == "rate_limited"
    assert limited.json()["detail"].startswith("Trop de requêtes, réessayez dans ")


def test_service_errors_raised_for_users_use_the_user_text(ukclient: TestClient, fake_worker: FakeWorker) -> None:
    def busy() -> None:
        raise ApiError(503, "server_busy", "File d'attente pleine, réessayez dans un moment.", {"Retry-After": "30"})

    real_reserve = ukclient.app.state.runner.reserve  # type: ignore[attr-defined]
    ukclient.app.state.runner.reserve = busy  # type: ignore[attr-defined]
    r = ukclient.post("/jobs", json={"url": TT, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert (r.status_code, r.json()["detail"], r.headers["Retry-After"]) == (503, USER_TEXT["server_busy"], "30")
    ukclient.app.state.runner.reserve = real_reserve  # type: ignore[attr-defined]
    # YouTube pause opened by an admin request: users get the fixed text, Retry-After is kept.
    fake_worker.error = ApiError(503, "bot_check", "robot")
    assert ukclient.get("/dl", params={"url": YT}, headers=bearer(TOKEN)).status_code == 503
    r = ukclient.post("/jobs", json={"url": YT, "fmt": "mp3"}, headers=bearer(KEY_A))
    assert (r.status_code, r.json()["error"], r.json()["detail"]) == (503, "bot_check", USER_TEXT["bot_check"])
    assert int(r.headers["Retry-After"]) > 0
    admin = ukclient.post("/jobs", json={"url": YT, "fmt": "mp3"}, headers=bearer(TOKEN))
    assert "min" in admin.json()["detail"]  # admins keep "réessayez dans ~N min"


def test_unexpected_exception_shows_the_user_text_to_personal_keys(ukclient: TestClient, account: FakeAccount,
                                                                     monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("unexpected")

    monkeypatch.setattr(ukclient.app.state.jobs, "get", boom)
    client = TestClient(ukclient.app, raise_server_exceptions=False)
    r = client.get("/jobs/whatever", headers=bearer(KEY_A))
    assert (r.status_code, r.json()) == (500, {"error": "internal_error", "detail": "Erreur interne."})


# --- AETHRYON pour Premiere Pro (key_kind « premiere ») ------------------------------------------
# Clé du panneau Premiere (account/src/premiere.ts, V2-CONNEXION.md point 5) : mêmes droits et même quota qu'une clé
# d'extension. ytapi n'a rien de particulier à faire : une clé ytc_ ordinaire, limites par IP ET par utilisateur
# (seules les clés de relais « discord » et « outils » échappent à la limite par IP).


def _kind_client(make_client: Callable[..., TestClient], account: FakeAccount, tmp_path: Path, **overrides: Any) -> TestClient:
    token_file = tmp_path / "account_internal_token"
    token_file.write_text(INTERNAL)
    return make_client(user_keys_enabled=True, account_internal_url=account.url,  # type: ignore[attr-defined]
                       account_internal_token_file=token_file, user_key_cache_s=0.0, media_tools_enabled=True, **overrides)


@pytest.mark.parametrize("kind", ["premiere", "extension"])
def test_premiere_key_works_like_an_extension_key(make_client: Callable[..., TestClient], account: FakeAccount,
                                                  tmp_path: Path, kind: str) -> None:
    c = _kind_client(make_client, account, tmp_path)
    account.kinds = {KEY_A: kind}
    p = c.post("/preview", json={"url": TT}, headers=bearer(KEY_A))
    assert p.status_code == 200, p.text
    r = c.post("/jobs?wait=5", json={"url": TT, "fmt": "mp4"}, headers=bearer(KEY_A))
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]
    assert c.get(f"/jobs/{job_id}", headers=bearer(KEY_A)).status_code == 200
    f = c.get(f"/jobs/{job_id}/file", headers=bearer(KEY_A))
    assert f.status_code == 200 and f.headers["content-type"] == "video/mp4"
    assert account.creates() == 1  # une seule unité de quota, celle du compte
    # Clé révoquée (« Mes jetons », « Se déconnecter » dans le panneau, rejeu du code d'appareil) : refusée aussitôt,
    # pour la conversion, l'aperçu et le fichier.
    account.revoked.add(KEY_A)
    for method, path, body in (("GET", f"/jobs/{job_id}/file", None), ("POST", "/jobs", {"url": TT2, "fmt": "mp3"}),
                               ("POST", "/preview", {"url": TT2})):
        res = c.request(method, path, json=body, headers=bearer(KEY_A))
        assert (res.status_code, res.json()["error"]) == (401, "unauthorized"), path
    assert account.creates() == 1


def test_premiere_keys_share_the_per_ip_limit_like_extension_keys(make_client: Callable[..., TestClient],
                                                                 account: FakeAccount, tmp_path: Path) -> None:
    c = _kind_client(make_client, account, tmp_path, rate_limit=(2, 60))
    account.kinds = {KEY_A: "premiere", KEY_B: "extension"}
    base = "https://www.tiktok.com/@someone/video/72345678901234561"
    for i in range(2):
        assert c.post("/preview", json={"url": f"{base}{i}"}, headers=bearer(KEY_A)).status_code == 200
    # Même adresse : la clé d'extension d'un autre compte est déjà au-delà de la limite par IP (pas de passe-droit).
    assert c.post("/preview", json={"url": f"{base}9"}, headers=bearer(KEY_B)).status_code == 429
