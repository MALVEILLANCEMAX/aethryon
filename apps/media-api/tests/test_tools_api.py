"""AETHRYON Tools API (TOOLS_ENABLED): imports in chunks, quota unit given back when an import is abandoned or refused,
files of one account invisible to another, retention while an editor is open, thumbnails behind an id."""

from __future__ import annotations

import dataclasses
import shutil
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.runner import Runner
from tests.conftest import TOKEN, run_ffmpeg
from tests.test_user_keys import INTERNAL, KEY_A, KEY_B, FakeAccount, bearer, wait_events

CHUNK = 1024 * 1024


@pytest.fixture
def account() -> Iterator[FakeAccount]:
    fake = FakeAccount()
    fake.url = fake.start()  # type: ignore[attr-defined]
    fake.kinds[KEY_A] = "outils"
    yield fake
    fake.stop()


@pytest.fixture
def tools(make_client: Callable[..., TestClient], account: FakeAccount, tmp_path: Path) -> TestClient:
    token_file = tmp_path / "account_internal_token"
    token_file.write_text(INTERNAL)
    return make_client(user_keys_enabled=True, account_internal_url=account.url,  # type: ignore[attr-defined]
                       account_internal_token_file=token_file, media_tools_enabled=True, tools_enabled=True,
                       upload_chunk_mb=1, max_upload_mb=8, max_derived_per_source=3)


def _import(client: TestClient, data: bytes, key: str = KEY_A, name: str = "Vacances.mp4") -> dict[str, Any]:
    created = client.post("/uploads", json={"name": name, "size": len(data), "type": "video/mp4"}, headers=bearer(key))
    assert created.status_code == 201, created.text
    job = created.json()
    assert job["kind"] == "upload" and job["stage"] == "uploading" and job["upload"]["name"] == name
    chunks = job["upload"]["chunks"]
    for i in range(chunks):
        part = data[i * CHUNK:(i + 1) * CHUNK]
        r = client.put(f"/uploads/{job['job_id']}/chunks/{i}", content=part, headers=bearer(key))
        assert r.status_code == 200, r.text
    done = client.post(f"/uploads/{job['job_id']}/complete?wait=10", headers=bearer(key))
    return done.json() | {"_status": done.status_code}


def test_import_in_chunks_then_edit_list_keep_and_delete(tools: TestClient, account: FakeAccount) -> None:
    data = bytes(range(256)) * 9000  # 2.3 MB: 3 chunks
    job = _import(tools, data)
    assert job["_status"] == 200 and job["status"] == "done" and job["media"]["width"] == 640
    assert job["filename"] == "Vacances.mp4"
    creates = [c for c in account.calls if c["action"] == "create_job"]
    assert len(creates) == 1 and creates[0]["platform"] == "fichier" and creates[0]["fmt"] == "mp4"
    states = [e[1]["state"] for e in wait_events(account, 2)]
    assert states == ["running", "done"]
    file = tools.get(f"/jobs/{job['job_id']}/file", headers=bearer(KEY_A))
    assert file.status_code == 200 and file.content == data
    ranged = tools.get(f"/jobs/{job['job_id']}/file", headers=bearer(KEY_A) | {"Range": "bytes=10-19"})
    assert ranged.status_code == 206 and ranged.content == data[10:20]
    # Edits: free (no new unit), owner only, the same request joins the same job.
    edit = tools.post(f"/jobs/{job['job_id']}/derive?wait=5", json={"op": "video", "start_s": 1, "duration_s": 4,
                                                                    "crop": {"x": 0, "y": 0, "w": 360, "h": 360}},
                      headers=bearer(KEY_A))
    assert edit.status_code == 200, edit.text
    assert edit.json()["derive"]["op"] == "video" and edit.json()["derive"]["crop"] == {"x": 0, "y": 0, "w": 360, "h": 360}
    assert account.creates() == 1
    listed = tools.get("/jobs", headers=bearer(KEY_A)).json()
    assert [j["job_id"] for j in listed["jobs"]] == [edit.json()["job_id"], job["job_id"]]
    assert listed["keep_min"] == 120
    before = tools.get(f"/jobs/{job['job_id']}", headers=bearer(KEY_A)).json()["expires_at"]
    kept = tools.post(f"/jobs/{job['job_id']}/keep", headers=bearer(KEY_A))
    assert kept.status_code == 200 and kept.json()["expires_at"] > before
    assert tools.get(f"/jobs/{edit.json()['job_id']}", headers=bearer(KEY_A)).json()["expires_at"] == kept.json()["expires_at"]
    assert tools.get(f"/jobs/{job['job_id']}/storyboard", headers=bearer(KEY_A)).json()["image_url"].endswith(
        f"/jobs/{job['job_id']}/storyboard.jpg")
    assert tools.get(f"/jobs/{job['job_id']}/storyboard.jpg", headers=bearer(KEY_A)).headers["content-type"] == "image/jpeg"
    assert tools.get(f"/jobs/{job['job_id']}/waveform", headers=bearer(KEY_A)).json()["count"] == 300
    assert tools.delete(f"/jobs/{job['job_id']}", headers=bearer(KEY_A)).status_code == 200
    assert tools.get(f"/jobs/{job['job_id']}", headers=bearer(KEY_A)).status_code == 404
    # A plain DELETE keeps the contract of every client: the exports already made stay until they expire.
    assert tools.get(f"/jobs/{edit.json()['job_id']}/file", headers=bearer(KEY_A)).status_code == 200


def test_deleting_a_media_with_its_exports(tools: TestClient) -> None:
    job = _import(tools, b"\x07" * 70_000)
    made = [tools.post(f"/jobs/{job['job_id']}/derive?wait=5", json={"op": op, "start_s": 0, "duration_s": 2},
                       headers=bearer(KEY_A)).json()["job_id"] for op in ("video", "audio")]
    # Another account cannot remove anything, not even by naming the media.
    assert tools.delete(f"/jobs/{job['job_id']}?with_exports=true", headers=bearer(KEY_B)).status_code == 404
    gone = tools.delete(f"/jobs/{job['job_id']}?with_exports=true", headers=bearer(KEY_A))
    assert gone.status_code == 200 and gone.json() == {"job_id": job["job_id"], "deleted": True, "exports_deleted": 2}
    for jid in [job["job_id"], *made]:
        assert tools.get(f"/jobs/{jid}/file", headers=bearer(KEY_A)).status_code == 404, jid
    assert tools.get("/jobs", headers=bearer(KEY_A)).json()["jobs"] == []


def test_status_answers_when_the_progress_moves(tools: TestClient, fake_worker: Any) -> None:
    job = _import(tools, b"\x01" * 5000)
    fake_worker.delay_s = 6
    made = tools.post(f"/jobs/{job['job_id']}/derive", json={"op": "video", "start_s": 0, "duration_s": 2},
                      headers=bearer(KEY_A)).json()
    t0 = time.monotonic()
    live = tools.get(f"/jobs/{made['job_id']}?wait=20&change=true", headers=bearer(KEY_A))
    held = time.monotonic() - t0
    assert live.status_code == 200 and live.json()["status"] in ("queued", "running")
    assert 1.9 <= held < 4, held  # answered on the first move after the 2 s hold, not at the 20 s timeout
    t0 = time.monotonic()
    plain = tools.get(f"/jobs/{made['job_id']}?wait=2", headers=bearer(KEY_A))
    assert plain.json()["status"] in ("queued", "running") and time.monotonic() - t0 >= 1.9  # plain wait: end or timeout
    done = tools.get(f"/jobs/{made['job_id']}?wait=10&change=true", headers=bearer(KEY_A))
    while done.json()["status"] != "done":
        done = tools.get(f"/jobs/{made['job_id']}?wait=10&change=true", headers=bearer(KEY_A))
    assert done.json()["progress"] == 100


def test_another_account_sees_nothing(tools: TestClient) -> None:
    job = _import(tools, b"\x00" * 5000)
    for method, path in [("GET", f"/jobs/{job['job_id']}"), ("GET", f"/jobs/{job['job_id']}/file"),
                         ("GET", f"/jobs/{job['job_id']}/media"), ("GET", f"/jobs/{job['job_id']}/storyboard"),
                         ("GET", f"/jobs/{job['job_id']}/waveform"), ("POST", f"/jobs/{job['job_id']}/keep"),
                         ("PUT", f"/uploads/{job['job_id']}/chunks/0"), ("POST", f"/uploads/{job['job_id']}/complete"),
                         ("DELETE", f"/jobs/{job['job_id']}")]:
        r = tools.request(method, path, headers=bearer(KEY_B), content=b"" if method == "PUT" else None)
        assert r.status_code == 404, (method, path, r.status_code)
    r = tools.post(f"/jobs/{job['job_id']}/derive", json={"op": "video"}, headers=bearer(KEY_B))
    assert r.status_code == 404
    assert tools.get("/jobs", headers=bearer(KEY_B)).json()["jobs"] == []
    # Admin tokens have no account: no import, no list.
    assert tools.post("/uploads", json={"size": 10}, headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 403


def test_refused_or_abandoned_import_gives_the_unit_back(tools: TestClient, account: FakeAccount) -> None:
    refused = _import(tools, b"BAD" + b"\x00" * 100)
    assert refused["status"] == "error" and refused["error"] == "unsupported_file"
    assert refused["detail"] == "Ce fichier n'est pas une vidéo ou un son pris en charge."
    created = tools.post("/uploads", json={"name": "x.mp4", "size": 3 * CHUNK}, headers=bearer(KEY_A)).json()
    tools.put(f"/uploads/{created['job_id']}/chunks/0", content=b"\x00" * CHUNK, headers=bearer(KEY_A))
    second = tools.post("/uploads", json={"name": "y.mp4", "size": 10}, headers=bearer(KEY_A))
    assert second.status_code == 409 and second.json()["error"] == "upload_pending"
    incomplete = tools.post(f"/uploads/{created['job_id']}/complete", headers=bearer(KEY_A))
    assert incomplete.status_code == 409 and incomplete.json()["error"] == "upload_incomplete"
    assert tools.delete(f"/jobs/{created['job_id']}", headers=bearer(KEY_A)).status_code == 200
    events = wait_events(account, 4)
    assert [e[1]["state"] for e in events] == ["running", "error", "running", "refunded"]


def test_chunk_rules_and_limits(tools: TestClient) -> None:
    too_big = tools.post("/uploads", json={"name": "x.mp4", "size": 9 * CHUNK}, headers=bearer(KEY_A))
    assert too_big.status_code == 413 and too_big.json()["error"] == "too_large"
    job = tools.post("/uploads", json={"name": "x.mp4", "size": CHUNK + 10}, headers=bearer(KEY_A)).json()
    wrong = tools.put(f"/uploads/{job['job_id']}/chunks/1", content=b"\x00" * 11, headers=bearer(KEY_A))
    assert wrong.status_code == 400 and wrong.json()["error"] == "invalid_chunk"
    out = tools.put(f"/uploads/{job['job_id']}/chunks/2", content=b"\x00" * 10, headers=bearer(KEY_A))
    assert out.status_code == 416
    # A chunk larger than UPLOAD_CHUNK_MB never reaches the route; other bodies keep their 64 KiB limit.
    huge = tools.put(f"/uploads/{job['job_id']}/chunks/0", content=b"\x00" * (CHUNK + 1), headers=bearer(KEY_A))
    assert huge.status_code == 413
    body = tools.post("/jobs", content=b"{" + b" " * 70000 + b"}", headers=bearer(KEY_A) | {"Content-Type": "application/json"})
    assert body.status_code == 413
    assert tools.put(f"/uploads/{job['job_id']}/chunks/1", content=b"\x00" * 10, headers=bearer(KEY_A)).status_code == 200
    # Re-sending a chunk is harmless (resume after a network cut).
    assert tools.put(f"/uploads/{job['job_id']}/chunks/1", content=b"\x00" * 10, headers=bearer(KEY_A)).status_code == 200


def test_stalled_import_expires(tools: TestClient, account: FakeAccount) -> None:
    job = tools.post("/uploads", json={"name": "x.mp4", "size": 10}, headers=bearer(KEY_A)).json()
    manager = tools.app.state.jobs  # type: ignore[attr-defined]
    manager.jobs[job["job_id"]].upload["last"] -= 31 * 60
    import asyncio

    assert asyncio.run(manager.expire_stalled_uploads()) == 1
    assert tools.get(f"/jobs/{job['job_id']}", headers=bearer(KEY_A)).status_code == 404
    assert [e[1]["state"] for e in wait_events(account, 2)] == ["running", "refunded"]


def test_edits_are_refused_without_tools_and_media_tools_keep_their_contract(
        make_client: Callable[..., TestClient], account: FakeAccount, tmp_path: Path) -> None:
    token_file = tmp_path / "t"
    token_file.write_text(INTERNAL)
    client = make_client(user_keys_enabled=True, account_internal_url=account.url,  # type: ignore[attr-defined]
                         account_internal_token_file=token_file, media_tools_enabled=True, tools_enabled=False)
    assert client.post("/uploads", json={"size": 10}, headers=bearer(KEY_A)).status_code == 404
    assert client.get("/jobs", headers=bearer(KEY_A)).status_code == 405  # POST /jobs only
    job = client.post("/jobs?wait=5", json={"url": "https://www.tiktok.com/@a/video/7234567890123456789"},
                      headers=bearer(KEY_A)).json()
    r = client.post(f"/jobs/{job['job_id']}/derive", json={"op": "video"}, headers=bearer(KEY_A))
    assert r.status_code == 400 and "TOOLS_ENABLED" in r.json()["detail"]
    r = client.post(f"/jobs/{job['job_id']}/derive", json={"op": "gif", "rotate": 90}, headers=bearer(KEY_A))
    assert r.status_code == 400
    legacy = client.post(f"/jobs/{job['job_id']}/derive?wait=5", json={"op": "gif", "start_s": 1, "duration_s": 3},
                         headers=bearer(KEY_A))
    assert legacy.status_code == 200 and legacy.json()["derive"] == {
        "op": "gif", "start_s": 1.0, "duration_s": 3.0, "gif_width": 480, "gif_fps": 15, "source_job_id": job["job_id"]}


def test_plain_gif_and_compression_of_an_import_use_the_tools_pipeline(tools: TestClient, fake_worker: Any) -> None:
    job = _import(tools, b"\x00" * 1000)
    gif = tools.post(f"/jobs/{job['job_id']}/derive?wait=5", json={"op": "gif", "start_s": 0, "duration_s": 3}, headers=bearer(KEY_A))
    assert gif.status_code == 200, gif.text
    small = tools.post(f"/jobs/{job['job_id']}/derive?wait=5", json={"op": "compress", "max_bytes": 2 * 1024 * 1024}, headers=bearer(KEY_A))
    assert small.status_code == 200, small.text
    derives = [c for c in fake_worker.calls if c.kind == "derive"]
    assert [c.params["tools"] for c in derives] == [True, True] and all(c.params["from_upload"] for c in derives)


def test_sped_up_export_is_its_own_file(tools: TestClient, fake_worker: Any) -> None:
    job = _import(tools, b"\x00" * 1000)
    body = {"op": "audio", "start_s": 6, "duration_s": 5, "speed": 1.25}
    keep = tools.post(f"/jobs/{job['job_id']}/derive?wait=5", json=body, headers=bearer(KEY_A)).json()
    shift = tools.post(f"/jobs/{job['job_id']}/derive?wait=5", json=body | {"pitch": "shift"},
                       headers=bearer(KEY_A)).json()
    assert keep["derive"] == {"op": "audio", "start_s": 6.0, "duration_s": 5.0, "speed": 1.25,
                              "source_job_id": job["job_id"]}
    assert shift["derive"] == keep["derive"] | {"pitch": "shift"}  # the export library shows « Sped up ×1,25 »
    assert shift["job_id"] != keep["job_id"] and shift["merged"] is False
    again = tools.post(f"/jobs/{job['job_id']}/derive?wait=5", json=body | {"pitch": "shift"}, headers=bearer(KEY_A))
    assert again.json()["job_id"] == shift["job_id"] and again.json()["merged"] is True
    assert [c.params["pitch"] for c in fake_worker.calls if c.kind == "derive"] == ["keep", "shift"]
    wrong = tools.post(f"/jobs/{job['job_id']}/derive", json=body | {"pitch": "up"}, headers=bearer(KEY_A))
    assert wrong.status_code == 400 and wrong.json()["error"] == "invalid_parameter"


def test_derive_limit_and_relay_keys(tools: TestClient, account: FakeAccount) -> None:
    job = _import(tools, b"\x00" * 1000)
    for start in (0, 1, 2):
        assert tools.post(f"/jobs/{job['job_id']}/derive?wait=5", json={"op": "video", "start_s": start},
                          headers=bearer(KEY_A)).status_code == 200
    r = tools.post(f"/jobs/{job['job_id']}/derive", json={"op": "video", "start_s": 3}, headers=bearer(KEY_A))
    assert r.status_code == 429 and r.json()["error"] == "derive_limit"


def test_thumbnail_ids_belong_to_one_user(tools: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    import app.main as main

    calls: list[str] = []

    def fake_fetch(url: str) -> tuple[bytes, str]:
        calls.append(url)
        return b"\xff\xd8\xff" + b"\x00" * 10, "image/jpeg"

    monkeypatch.setattr(main, "fetch_image", fake_fetch)
    refs = tools.app.state.thumb_refs  # type: ignore[attr-defined]
    refs["tid-a"] = ("user-a", "https://i.ytimg.com/vi/x/hq.jpg", time.time())
    ok = tools.get("/preview/thumbnail/tid-a", headers=bearer(KEY_A))
    assert ok.status_code == 200 and ok.headers["content-type"] == "image/jpeg"
    assert tools.get("/preview/thumbnail/tid-a", headers=bearer(KEY_B)).status_code == 404
    assert tools.get("/preview/thumbnail/inconnu", headers=bearer(KEY_A)).status_code == 404
    tools.get("/preview/thumbnail/tid-a", headers=bearer(KEY_A))
    assert calls == ["https://i.ytimg.com/vi/x/hq.jpg"]  # fetched once, then served from memory


# --- the real chain: worker processes, ffmpeg, studio ----------------------------------------------------------------

@pytest.fixture
def real_tools(settings: Any, account: FakeAccount, tmp_path: Path) -> Iterator[TestClient]:
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg absent")
    token_file = tmp_path / "account_internal_token"
    token_file.write_text(INTERNAL)
    effective = dataclasses.replace(settings, user_keys_enabled=True, account_internal_url=account.url,  # type: ignore[attr-defined]
                                    account_internal_token_file=token_file, media_tools_enabled=True, tools_enabled=True,
                                    upload_chunk_mb=1)
    with TestClient(create_app(effective, Runner(effective))) as client:
        yield client


def test_real_import_crop_and_audio_export(real_tools: TestClient, tmp_path: Path) -> None:
    source = tmp_path / "phone.mp4"
    run_ffmpeg("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=5", "-f", "lavfi", "-i",
               "sine=frequency=440:duration=5", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-shortest", str(source))
    job = _import(real_tools, source.read_bytes(), name="Mon film.mp4")
    assert job["status"] == "done", job
    assert job["media"]["width"] == 640 and job["filename"] == "Mon film.mp4"
    crop = real_tools.post(f"/jobs/{job['job_id']}/derive?wait=25",
                           json={"op": "video", "start_s": 1, "duration_s": 2, "crop": {"x": 140, "y": 0, "w": 360, "h": 360}},
                           headers=bearer(KEY_A))
    assert crop.status_code == 200, crop.text
    assert crop.json()["media"]["width"] == 360 and abs(crop.json()["media"]["duration"] - 2) < 0.15
    sound = real_tools.post(f"/jobs/{job['job_id']}/derive?wait=25",
                            json={"op": "audio", "start_s": 0.5, "duration_s": 3, "bitrate": 128}, headers=bearer(KEY_A))
    assert sound.status_code == 200, sound.text
    assert sound.json()["filename"].endswith(".mp3") and abs(sound.json()["media"]["duration"] - 3) < 0.1
    board = real_tools.get(f"/jobs/{job['job_id']}/storyboard", headers=bearer(KEY_A)).json()
    assert board["count"] == 8 and board["tile_h"] == 112
    wave = real_tools.get(f"/jobs/{job['job_id']}/waveform", headers=bearer(KEY_A)).json()
    assert wave["count"] == 200 and max(wave["peaks"]) > 10
