"""Endpoint behaviour with the worker process replaced by a fake (see conftest.FakeWorker)."""

import time
from pathlib import Path
from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient

from app.params import DownloadParams

URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"


def wait_for(client: TestClient, job_id: str, auth: dict[str, str], status: str, timeout: float = 5) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"/jobs/{job_id}", headers=auth).json()
        if body["status"] == status:
            return body
        time.sleep(0.02)
    raise AssertionError(f"job never reached {status}: {body}")


def test_info(client: TestClient, auth) -> None:
    res = client.get("/info", params={"url": URL}, headers=auth)
    assert res.status_code == 200
    assert res.json()["title"] == "Café 東京"


def test_info_rejects_bad_url(client: TestClient, auth) -> None:
    res = client.get("/info", params={"url": "https://youtube.com.evil.com/watch?v=x"}, headers=auth)
    assert res.status_code == 400
    assert res.json()["error"] == "domain_not_allowed"


def test_dl_returns_file_and_cleans_up(client: TestClient, auth, settings) -> None:
    res = client.get("/dl", params={"url": URL, "fmt": "mp4"}, headers=auth)
    assert res.status_code == 200
    assert res.headers["content-type"] == "video/mp4"
    disposition = res.headers["content-disposition"]
    assert disposition.startswith('attachment; filename="Cafe [abc].mp4"')
    assert unquote(disposition.split("filename*=UTF-8''")[1]) == "Café 東京 [abc].mp4"
    assert len(res.content) == 1000
    assert list(settings.tmp_dir.iterdir()) == []  # BackgroundTask removed the temp dir


def test_dl_error_cleans_up(client: TestClient, auth, fake_worker, settings) -> None:
    from app.errors import ApiError

    fake_worker.error = ApiError(413, "too_long", "too long")
    assert client.get("/dl", params={"url": URL}, headers=auth).status_code == 413
    assert list(settings.tmp_dir.iterdir()) == []


def test_dl_passes_validated_params(client: TestClient, auth, fake_worker) -> None:
    client.get("/dl", params={"url": "https://tiktok.com/@a/video/1?_r=1", "fmt": "mp3", "bitrate": "320k"},
               headers=auth)
    task = fake_worker.calls[-1]
    assert task.url == "https://www.tiktok.com/@a/video/1"
    assert task.platform == "tiktok"
    assert task.params["fmt"] == "mp3" and task.params["bitrate"] == 320


def test_job_lifecycle(client: TestClient, auth, settings) -> None:
    res = client.post("/jobs", json={"url": URL, "fmt": "mp4", "quality": "720p"}, headers=auth)
    assert res.status_code == 202
    body = res.json()
    job_id = body["job_id"]
    assert len(job_id) >= 16
    assert res.headers["location"].endswith(f"/jobs/{job_id}")
    assert body["params"]["quality"] == "720"

    done = wait_for(client, job_id, auth, "done")
    assert done["progress"] == 100
    assert done["filename"] == "Café 東京 [abc].mp4"
    assert done["file_url"].endswith(f"/jobs/{job_id}/file/Caf%C3%A9%20%E6%9D%B1%E4%BA%AC%20%5Babc%5D.mp4")
    assert done["expires_at"]

    file_res = client.get(f"/jobs/{job_id}/file", headers=auth)
    assert file_res.status_code == 200
    assert len(file_res.content) == 1000
    # The file stays available (Shortcuts may retry) until DELETE or expiry.
    assert client.get(f"/jobs/{job_id}/file", headers=auth).status_code == 200

    assert client.delete(f"/jobs/{job_id}", headers=auth).json() == {"job_id": job_id, "deleted": True}
    assert client.get(f"/jobs/{job_id}", headers=auth).status_code == 404
    assert list(settings.tmp_dir.iterdir()) == []


def test_job_file_not_ready(client: TestClient, auth, fake_worker) -> None:
    fake_worker.delay_s = 1.0
    job_id = client.post("/jobs", json={"url": URL}, headers=auth).json()["job_id"]
    res = client.get(f"/jobs/{job_id}/file", headers=auth)
    assert res.status_code == 409
    assert res.json()["error"] == "job_not_ready"
    client.delete(f"/jobs/{job_id}", headers=auth)


def test_job_error_status(client: TestClient, auth, fake_worker) -> None:
    from app.errors import ApiError

    fake_worker.error = ApiError(404, "not_found", "gone")
    job_id = client.post("/jobs", json={"url": URL}, headers=auth).json()["job_id"]
    body = wait_for(client, job_id, auth, "error")
    assert (body["error"], body["detail"]) == ("not_found", "gone")
    assert client.get(f"/jobs/{job_id}/file", headers=auth).json()["error"] == "job_failed"


def test_delete_cancels_running_job(client: TestClient, auth, fake_worker, settings) -> None:
    fake_worker.delay_s = 30
    job_id = client.post("/jobs", json={"url": URL}, headers=auth).json()["job_id"]
    wait_for(client, job_id, auth, "running")
    started = time.monotonic()
    assert client.delete(f"/jobs/{job_id}", headers=auth).status_code == 200
    assert time.monotonic() - started < 5
    assert list(settings.tmp_dir.iterdir()) == []


def test_queue_full_is_503(make_client, auth, fake_worker) -> None:
    client = make_client(max_concurrent=1, max_queue=1)
    fake_worker.delay_s = 30
    # Different qualities: identical requests would be merged into one job.
    first = client.post("/jobs", json={"url": URL, "quality": "1080"}, headers=auth)
    second = client.post("/jobs", json={"url": URL, "quality": "720"}, headers=auth)
    assert first.status_code == second.status_code == 202
    assert first.json()["job_id"] != second.json()["job_id"]
    wait_for(client, first.json()["job_id"], auth, "running")
    assert client.get(f"/jobs/{second.json()['job_id']}", headers=auth).json()["status"] == "queued"
    third = client.post("/jobs", json={"url": URL, "quality": "480"}, headers=auth)
    assert third.status_code == 503
    assert third.json()["error"] == "server_busy"
    assert third.headers["retry-after"] == "30"
    sync = client.get("/dl", params={"url": URL, "quality": "360"}, headers=auth)
    assert sync.status_code == 503
    for res in (first, second):
        client.delete(f"/jobs/{res.json()['job_id']}", headers=auth)


def test_jobs_reject_unknown_fields_and_bad_urls(client: TestClient, auth) -> None:
    assert client.post("/jobs", json={"url": URL, "foo": 1}, headers=auth).status_code == 400
    res = client.post("/jobs", json={"url": "file:///etc/passwd"}, headers=auth)
    assert res.status_code == 400 and res.json()["error"] == "invalid_url"
    assert client.post("/jobs", content=b"not json", headers=auth | {"content-type": "application/json"}).status_code == 400


@pytest.mark.anyio
async def test_expired_jobs_are_removed(make_client, auth, settings) -> None:
    client = make_client()
    job_id = client.post("/jobs", json={"url": URL}, headers=auth).json()["job_id"]
    wait_for(client, job_id, auth, "done")
    jobs = client.app.state.jobs
    jobs.jobs[job_id].finished_at -= jobs.ttl_s + 1
    assert await jobs.cleanup_expired() == 1
    assert client.get(f"/jobs/{job_id}", headers=auth).status_code == 404
    assert not any(p.name == f"job-{job_id}" for p in settings.tmp_dir.iterdir())


def test_orphans_removed_at_startup(make_client, settings) -> None:
    settings.tmp_dir.mkdir(parents=True, exist_ok=True)
    orphan = settings.tmp_dir / "job-old"
    orphan.mkdir()
    (orphan / "x.mp4").write_bytes(b"x")
    make_client()
    assert not orphan.exists()


def test_root_path_urls(make_client, auth) -> None:
    # Traefik strips /media; uvicorn --root-path /media puts it back in generated URLs.
    proxied = make_client(client_kwargs={"root_path": "/media", "base_url": "https://api.malvu.fr"})
    body = proxied.post("/jobs", json={"url": URL}, headers=auth).json()
    assert body["status_url"] == f"https://api.malvu.fr/media/jobs/{body['job_id']}"
    done = wait_for(proxied, body["job_id"], auth, "done")
    assert done["file_url"] == (f"https://api.malvu.fr/media/jobs/{body['job_id']}/file/"
                                "Caf%C3%A9%20%E6%9D%B1%E4%BA%AC%20%5Babc%5D.mp4")
    assert proxied.get("/health").status_code == 200


def test_named_file_url_serves_the_file(client: TestClient, auth) -> None:
    job_id = client.post("/jobs", json={"url": URL}, headers=auth).json()["job_id"]
    done = wait_for(client, job_id, auth, "done")
    assert client.get(done["file_url"], headers=auth).status_code == 200
    assert client.get(f"/jobs/{job_id}/file/anything.mp4", headers=auth).status_code == 200


def test_long_poll_returns_when_done(client: TestClient, auth, fake_worker) -> None:
    fake_worker.delay_s = 0.6
    job_id = client.post("/jobs", json={"url": URL}, headers=auth).json()["job_id"]
    started = time.monotonic()
    body = client.get(f"/jobs/{job_id}", params={"wait": 10}, headers=auth).json()
    assert body["status"] == "done"
    assert time.monotonic() - started < 5
    assert client.get(f"/jobs/{job_id}", params={"wait": 99}, headers=auth).status_code == 400


def test_body_limits(client: TestClient, auth) -> None:
    big = {"url": URL, "pad": "x" * 70_000}
    res = client.post("/jobs", json=big, headers=auth)
    assert res.status_code == 413 and res.json()["error"] == "body_too_large"

    def chunks():  # no Content-Length: capped while reading
        for _ in range(20):
            yield b"x" * 8192

    res = client.post("/jobs", content=chunks(), headers=auth | {"content-type": "application/json"})
    assert res.status_code == 400
    small = client.post("/jobs", content=iter([b'{"url": "https://youtu.be/jNQXAC9IVRw"}']),
                        headers=auth | {"content-type": "application/json"})
    assert small.status_code == 202


def test_params_model() -> None:
    p = DownloadParams(url="u", quality="1080P", bitrate="192k")
    assert (p.quality, p.bitrate) == ("1080", 192)
    assert DownloadParams(url="u", quality=720).quality == "720"
    assert DownloadParams(url="u", fmt="MP3").fmt == "mp3"
    # JSON numbers from iOS Shortcuts may be floats.
    p = DownloadParams.model_validate({"url": "u", "bitrate": 192.0, "quality": 720.0, "index": 2.0,
                                       "gif_width": 320.0, "transcode": "true"})
    assert (p.bitrate, p.quality, p.index, p.gif_width, p.transcode) == (192, "720", 2, 320, True)
    assert "gif_width" not in DownloadParams(url="u").summary()
    assert "url" not in DownloadParams(url="u").summary()


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def test_file_name_never_logged_for_any_caller(client: TestClient, auth, caplog: pytest.LogCaptureFixture) -> None:
    """The readable file name (the media title) is cut from the request log for legacy tokens and refused
    requests too, not only for user keys (privacy page: no title kept)."""
    import logging
    from urllib.parse import urlsplit

    caplog.set_level(logging.INFO)
    job_id = client.post("/jobs", json={"url": URL, "fmt": "mp4"}, headers=auth).json()["job_id"]
    done = wait_for(client, job_id, auth, "done")
    named = urlsplit(done["file_url"]).path
    assert "/file/" in named  # the public URL keeps the readable name (Shortcuts names the file with it)
    assert client.get(named, headers=auth).status_code == 200
    assert client.get("/jobs/abcdefghijklmnop/file/Titre-secret.mp4").status_code == 401
    paths = [str(getattr(rec, "path", "")) for rec in caplog.records if rec.getMessage() == "request"]
    assert any(p.endswith(f"/jobs/{job_id}/file") for p in paths)
    assert not any("/file/" in p or "Caf" in p or "Titre-secret" in p for p in paths), paths

