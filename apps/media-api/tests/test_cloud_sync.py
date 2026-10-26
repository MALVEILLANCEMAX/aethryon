"""AETHRYON Cloud V1 on the ytapi side (app/cloud.py): after a successful user job, account decides and signs; ytapi
streams the file to the presigned URL (no storage key here) and reports the end; the delivery is never affected."""

from __future__ import annotations

import base64
import hashlib
import io
import threading
import time
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.cloud import UploadError, digests, put_file
from app.config import ConfigError, parse_domains

from tests.test_user_keys import INTERNAL, KEY_A, KEY_B, TT, FakeAccount, bearer


class FakeStorage:
    """Presigned PUT target: checks the signed headers like a provider would (size, MD5), keeps the bytes."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.puts: list[dict[str, str]] = []
        self.fail_next = 0  # answer 503 to this many PUTs
        self.status: int | None = None  # forced answer
        storage = self

        class Handler(BaseHTTPRequestHandler):
            def do_PUT(self) -> None:  # noqa: N802
                length = int(self.headers.get("content-length") or 0)
                body = self.rfile.read(length)
                storage.puts.append({k.lower(): v for k, v in self.headers.items()})
                code = 200
                if storage.fail_next > 0:
                    storage.fail_next -= 1
                    code = 503
                elif storage.status:
                    code = storage.status
                elif base64.b64encode(hashlib.md5(body).digest()).decode() != self.headers.get("content-md5"):
                    code = 400
                else:
                    storage.objects[self.path.split("?")[0]] = body
                self.send_response(code)
                self.send_header("content-length", "0")
                self.end_headers()

            def log_message(self, *args: Any) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()


class CloudAccount(FakeAccount):
    """FakeAccount + the cloud routes of account (user-a is the administrator)."""

    def __init__(self, storage: FakeStorage) -> None:
        super().__init__()
        self.storage = storage
        self.admins = {"user-a"}
        self.cloud_calls: list[tuple[str, dict[str, Any]]] = []
        self.offers: dict[str, dict[str, Any]] = {}
        self.cloud_down = False  # cloud routes of account in error (the rest of account works)

    def envoi(self, objet_id: str, offer: dict[str, Any]) -> dict[str, Any]:
        return {"url": f"{self.storage.base}/seau/{objet_id}?X-Amz-Signature=abc&n={len(self.cloud_calls)}", "methode": "PUT",
                "entetes": {"content-length": str(offer["taille"]), "content-type": offer["type"],
                            "content-md5": offer["md5"], "x-amz-meta-sha256": offer["sha256"]}}

    def handle(self, path: str, token: str | None, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        if not path.startswith("/internal/v1/cloud/"):
            return super().handle(path, token, body)
        if token != INTERNAL:
            return 401, {"error": "unauthorized"}
        with self.lock:
            self.cloud_calls.append((path, body))
            if self.cloud_down:
                return 500, {"error": "internal_error"}
            if path == "/internal/v1/cloud/offre":
                if body.get("user_id") not in self.admins:
                    return 200, {"sauvegarder": False, "raison": "non_admin"}
                objet_id = f"obj{len(self.offers):019d}"
                self.offers[objet_id] = body
                return 200, {"sauvegarder": True, "objet": {"id": objet_id, "statut": "envoi_en_cours"},
                             "envoi": self.envoi(objet_id, body)}
            objet_id = path.split("/")[5]
            offer = self.offers.get(objet_id)
            if offer is None or offer["user_id"] != body.get("user_id"):
                return 404, {"error": "not_found"}
            if path.endswith("/url-envoi"):
                return 200, {"envoi": self.envoi(objet_id, offer)}
            if path.endswith("/termine"):
                if not body.get("ok"):
                    return 200, {"statut": "echec"}
                stored = self.storage.objects.get(f"/seau/{objet_id}")
                ok = stored is not None and hashlib.sha256(stored).hexdigest() == offer["sha256"]
                return 200, {"statut": "sauvegarde" if ok else "echec"}
        return 404, {"error": "not_found"}


@pytest.fixture
def storage() -> Any:
    s = FakeStorage()
    yield s
    s.stop()


@pytest.fixture
def cloud_account(storage: FakeStorage) -> Any:
    fake = CloudAccount(storage)
    fake.url = fake.start()  # type: ignore[attr-defined]
    yield fake
    fake.stop()


@pytest.fixture
def cloud_client(make_client: Callable[..., TestClient], cloud_account: CloudAccount, tmp_path: Path) -> TestClient:
    token_file = tmp_path / "account_internal_token"
    token_file.write_text(INTERNAL)
    return make_client(user_keys_enabled=True, account_internal_url=cloud_account.url,  # type: ignore[attr-defined]
                       account_internal_token_file=token_file, user_key_cache_s=0.0,
                       cloud_sync=True, cloud_sync_allow_http=True)


def wait_for(predicate: Callable[[], bool], timeout: float = 10.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


def finished_job(client: TestClient, key: str) -> str:
    r = client.post("/jobs?wait=10", json={"url": TT, "fmt": "mp4"}, headers=bearer(key))
    assert r.status_code in (200, 202), r.text
    job_id = r.json()["job_id"]
    assert wait_for(lambda: client.get(f"/jobs/{job_id}", headers=bearer(key)).json()["status"] == "done")
    return job_id


# --- unit: hashes, PUT ----------------------------------------------------------------------------------------------

def test_digests_match_hashlib() -> None:
    data = bytes(range(256)) * 9000  # > 1 chunk
    size, sha, md5 = digests(io.BytesIO(data))
    assert size == len(data)
    assert sha == hashlib.sha256(data).hexdigest()
    assert md5 == base64.b64encode(hashlib.md5(data).digest()).decode()


def test_put_file_refuses_unsafe_urls_and_headers(storage: FakeStorage) -> None:
    data = b"x" * 10
    ok_headers = {"content-length": "10", "content-type": "video/mp4", "content-md5": base64.b64encode(hashlib.md5(data).digest()).decode()}
    with pytest.raises(UploadError) as e:
        put_file({"url": f"{storage.base}/seau/a", "entetes": ok_headers}, io.BytesIO(data), 10)  # http refused
    assert e.value.code == "url_refusee"
    for bad in ({**ok_headers, "authorization": "x"}, {**ok_headers, "content-type": "a\r\nx: y"}, {**ok_headers, "content-length": "9"}):
        with pytest.raises(UploadError):
            put_file({"url": f"{storage.base}/seau/a", "entetes": bad}, io.BytesIO(data), 10, allow_http=True)
    assert storage.puts == []  # nothing sent
    put_file({"url": f"{storage.base}/seau/a?sig=1", "entetes": ok_headers}, io.BytesIO(data), 10, allow_http=True)
    assert storage.objects["/seau/a"] == data
    storage.status = 500
    with pytest.raises(UploadError) as e:
        put_file({"url": f"{storage.base}/seau/b", "entetes": ok_headers}, io.BytesIO(data), 10, allow_http=True)
    assert e.value.retry and e.value.code == "http_500"
    storage.status = 400
    with pytest.raises(UploadError) as e:
        put_file({"url": f"{storage.base}/seau/b", "entetes": ok_headers}, io.BytesIO(data), 10, allow_http=True)
    assert not e.value.retry


# --- end to end in ytapi -------------------------------------------------------------------------------------------

def test_admin_download_is_backed_up_and_verified(cloud_client: TestClient, cloud_account: CloudAccount, storage: FakeStorage) -> None:
    job_id = finished_job(cloud_client, KEY_A)
    assert wait_for(lambda: any(p.endswith("/termine") for p, _ in cloud_account.cloud_calls))
    offre = next(b for p, b in cloud_account.cloud_calls if p.endswith("/offre"))
    assert offre["user_id"] == "user-a" and offre["job_id"] == job_id and offre["taille"] == 1000
    assert offre["type"] == "video/mp4" and offre["nom"].endswith(".mp4") and len(offre["sha256"]) == 64
    assert storage.objects[f"/seau/{next(iter(cloud_account.offers))}"] == b"\x00" * 1000
    fin = next(b for p, b in cloud_account.cloud_calls if p.endswith("/termine"))
    assert fin == {"user_id": "user-a", "ok": True}
    # The delivery of the file is unchanged.
    r = cloud_client.get(f"/jobs/{job_id}/file", headers=bearer(KEY_A))
    assert r.status_code == 200 and len(r.content) == 1000


def test_non_admin_download_is_not_uploaded(cloud_client: TestClient, cloud_account: CloudAccount, storage: FakeStorage) -> None:
    job_id = finished_job(cloud_client, KEY_B)
    assert wait_for(lambda: any(p.endswith("/offre") for p, _ in cloud_account.cloud_calls))
    time.sleep(0.3)
    assert [p for p, _ in cloud_account.cloud_calls] == ["/internal/v1/cloud/offre"]
    assert storage.puts == []
    assert cloud_client.get(f"/jobs/{job_id}/file", headers=bearer(KEY_B)).status_code == 200


def test_transient_storage_failure_is_retried_with_a_fresh_url(cloud_client: TestClient, cloud_account: CloudAccount,
                                                              storage: FakeStorage) -> None:
    cloud_client.app.state.jobs.cloud_sink.__self__.retry_delays_s = (0.05, 0.05)  # type: ignore[attr-defined]
    storage.fail_next = 1
    finished_job(cloud_client, KEY_A)
    assert wait_for(lambda: any(p.endswith("/termine") for p, _ in cloud_account.cloud_calls))
    paths = [p.rsplit("/", 1)[-1] for p, _ in cloud_account.cloud_calls]
    assert paths == ["offre", "url-envoi", "termine"]
    assert len(storage.puts) == 2
    assert next(b for p, b in cloud_account.cloud_calls if p.endswith("/termine"))["ok"] is True


def test_storage_down_never_fails_the_download(cloud_client: TestClient, cloud_account: CloudAccount, storage: FakeStorage) -> None:
    cloud_client.app.state.jobs.cloud_sink.__self__.retry_delays_s = (0.05, 0.05)  # type: ignore[attr-defined]
    storage.status = 503
    job_id = finished_job(cloud_client, KEY_A)
    assert wait_for(lambda: any(p.endswith("/termine") for p, _ in cloud_account.cloud_calls))
    fin = next(b for p, b in cloud_account.cloud_calls if p.endswith("/termine"))
    assert fin == {"user_id": "user-a", "ok": False, "erreur": "http_503"}
    assert len(storage.puts) == 3
    view = cloud_client.get(f"/jobs/{job_id}", headers=bearer(KEY_A)).json()
    assert view["status"] == "done"
    assert cloud_client.get(f"/jobs/{job_id}/file", headers=bearer(KEY_A)).status_code == 200


def test_account_cloud_unavailable_never_fails_the_download(cloud_client: TestClient, cloud_account: CloudAccount) -> None:
    cloud_account.cloud_down = True  # account answers 500 on its cloud routes
    job_id = finished_job(cloud_client, KEY_A)
    assert wait_for(lambda: any(p.endswith("/offre") for p, _ in cloud_account.cloud_calls))
    assert cloud_client.get(f"/jobs/{job_id}", headers=bearer(KEY_A)).json()["status"] == "done"
    assert cloud_client.get(f"/jobs/{job_id}/file", headers=bearer(KEY_A)).status_code == 200


def test_upload_holds_the_files_past_the_ttl(cloud_client: TestClient) -> None:
    jobs = cloud_client.app.state.jobs  # type: ignore[attr-defined]
    job_id = finished_job(cloud_client, KEY_A)
    job = jobs.jobs[job_id]
    job.cloud_hold_until = time.time() + 3600
    assert job.expires_at(0) >= time.time() + 3500  # kept while the upload runs
    job.cloud_hold_until = None
    assert job.expires_at(0) <= time.time()


def test_sink_errors_never_fail_a_job(make_client: Callable[..., TestClient], cloud_account: CloudAccount, tmp_path: Path) -> None:
    token_file = tmp_path / "t"
    token_file.write_text(INTERNAL)
    client = make_client(user_keys_enabled=True, account_internal_url=cloud_account.url,  # type: ignore[attr-defined]
                         account_internal_token_file=token_file, user_key_cache_s=0.0)
    client.app.state.jobs.cloud_sink = lambda job: (_ for _ in ()).throw(RuntimeError("boom"))  # type: ignore[attr-defined]
    job_id = finished_job(client, KEY_A)
    assert client.get(f"/jobs/{job_id}/file", headers=bearer(KEY_A)).status_code == 200


def test_cloud_sync_off_by_default(client: TestClient) -> None:
    assert client.app.state.jobs.cloud_sink is None  # type: ignore[attr-defined]


# --- stream ripping closed by configuration -------------------------------------------------------------------------

@pytest.mark.parametrize("domain", ["soundcloud.com", "open.spotify.com", "music.apple.com", "deezer.com", "bandcamp.com", "vimeo.com"])
def test_music_and_other_domains_cannot_be_allowed(domain: str) -> None:
    with pytest.raises(ConfigError):
        parse_domains(f"youtube.com,{domain}")


def test_cloud_sync_requires_user_keys(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    from app.config import load_settings

    monkeypatch.setenv("API_TOKEN", "t" * 40)
    monkeypatch.setenv("TMP_DIR", str(tmp_path))
    monkeypatch.setenv("CLOUD_SYNC", "true")
    monkeypatch.delenv("USER_KEYS_ENABLED", raising=False)
    with pytest.raises(ConfigError, match="CLOUD_SYNC"):
        load_settings()
