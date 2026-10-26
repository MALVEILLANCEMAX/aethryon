"""Media tools (MEDIA_TOOLS_ENABLED, bot Discord v2): POST /preview, clips (start_s/end_s), derived jobs
(POST /jobs/{id}/derive) and the per-IP exemption of the keys issued to the bot. Fake worker: no network."""

from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.cache import cache_key
from app.errors import ApiError
from app.params import DeriveParams, DownloadParams
from tests.conftest import FakeWorker
from tests.test_user_keys import INTERNAL, KEY_A, KEY_B, TT, TT2, FakeAccount, bearer
from tests.test_user_keys import account, ukclient  # noqa: F401  (fixtures)

ALLOWED_PREVIEW_KEYS = {"platform", "title", "uploader", "duration", "thumbnail", "is_gif", "live", "best_h264_quality",
                        "audio", "qualities", "est_size_bytes", "limits", "media_count"}


@pytest.fixture
def tools(make_client: Callable[..., TestClient], account: FakeAccount, tmp_path: Path) -> TestClient:
    token_file = tmp_path / "account_internal_token"
    token_file.write_text(INTERNAL)
    return make_client(user_keys_enabled=True, account_internal_url=account.url,  # type: ignore[attr-defined]
                       account_internal_token_file=token_file, user_key_cache_s=0.0, media_tools_enabled=True)


def done_job(client: TestClient, key: str = KEY_A, url: str = TT, fmt: str = "mp4") -> str:
    r = client.post("/jobs?wait=5", json={"url": url, "fmt": fmt}, headers=bearer(key))
    assert r.status_code == 200, r.text
    return r.json()["job_id"]


# --- off by default ------------------------------------------------------------------------------


def test_tools_absent_when_flag_off(ukclient: TestClient, account: FakeAccount) -> None:
    assert ukclient.post("/preview", json={"url": TT}, headers=bearer(KEY_A)).status_code == 404
    job_id = done_job(ukclient)
    assert ukclient.post(f"/jobs/{job_id}/derive", json={"op": "compress", "max_bytes": 2**23},
                         headers=bearer(KEY_A)).status_code == 404
    r = ukclient.post("/jobs", json={"url": TT2, "fmt": "mp4", "start_s": 1, "end_s": 5}, headers=bearer(KEY_A))
    assert r.status_code == 400 and r.json()["error"] == "invalid_parameter"
    assert "MEDIA_TOOLS_ENABLED" in r.json()["detail"]
    assert account.creates() == 1  # the refused clip consumed nothing


# --- preview -------------------------------------------------------------------------------------


def test_preview_allowlist_no_quota_no_cookies_and_cache(tools: TestClient, account: FakeAccount,
                                                         fake_worker: FakeWorker,
                                                         caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    r = tools.post("/preview", json={"url": TT}, headers=bearer(KEY_A))
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) <= ALLOWED_PREVIEW_KEYS
    assert body["platform"] == "tiktok" and body["title"] == "Café 東京" and body["media_count"] == 1
    assert "id" not in body and "webpage_url" not in body
    info_calls = [c for c in fake_worker.calls if c.kind == "info"]
    assert len(info_calls) == 1 and info_calls[0].cookies_file is None
    # Same media again (other user too): answered from the 5 min cache, no new extraction.
    assert tools.post("/preview", json={"url": TT}, headers=bearer(KEY_B)).json() == body
    assert len([c for c in fake_worker.calls if c.kind == "info"]) == 1
    assert account.creates() == 0  # a preview never takes a quota unit
    assert TT not in caplog.text and "7234567890123456789" not in caplog.text  # the link is never logged


def test_preview_only_by_post_body(tools: TestClient) -> None:
    assert tools.get("/preview", params={"url": TT}, headers=bearer(KEY_A)).status_code == 405
    r = tools.post("/preview", json={"url": "https://example.com/video"}, headers=bearer(KEY_A))
    assert r.status_code == 400 and r.json()["error"] == "domain_not_allowed"
    assert tools.post("/preview", json={"url": TT, "extra": 1}, headers=bearer(KEY_A)).status_code == 400


def test_preview_limited_per_user(tools: TestClient) -> None:
    base = "https://www.tiktok.com/@someone/video/72345678901234567"
    for i in range(30):
        assert tools.post("/preview", json={"url": f"{base}{i:02d}"}, headers=bearer(KEY_A)).status_code == 200
    over = tools.post("/preview", json={"url": f"{base}99"}, headers=bearer(KEY_A))
    assert over.status_code == 429 and over.json()["error"] == "rate_limited"
    assert int(over.headers["Retry-After"]) > 0
    assert tools.post("/preview", json={"url": f"{base}99"}, headers=bearer(KEY_B)).status_code == 200  # per user


def test_preview_view_of_a_multi_media_post() -> None:
    from app.main import preview_view

    info = {"platform": "twitter", "id": "1", "title": "Post", "media_count": 2, "webpage_url": "https://x.com/a/status/1",
            "entries": [{"title": "A", "duration": 4.5, "thumbnail": "http://insecure/t.jpg", "index": 1, "id": "m1",
                         "qualities": [{"quality": 720, "est_size_bytes": 1000, "h264": True, "codecs": ["h264"]}]},
                        {"title": "B", "is_gif": True, "thumbnail": "https://pbs.twimg.com/t.jpg", "index": 2}]}
    view = preview_view(info, "twitter")
    assert view["media_count"] == 2 and [e["index"] for e in view["entries"]] == [1, 2]
    assert view["entries"][0]["thumbnail"] is None  # https only
    assert view["entries"][0]["qualities"] == [{"quality": 720, "est_size_bytes": 1000, "h264": True}]
    assert view["entries"][1]["is_gif"] is True
    assert "webpage_url" not in view and "id" not in view["entries"][0]
    # Sound: "no" only for an X GIF; X lists no audio codec for its muxed videos -> "unknown", never "no".
    assert [e["audio"] for e in view["entries"]] == ["unknown", "no"]
    assert preview_view({"audio_only_available": True}, "tiktok")["audio"] == "yes"


# --- clips ---------------------------------------------------------------------------------------


def test_clip_parameters() -> None:
    p = DownloadParams(url=TT, fmt="mp4", start_s="0:15", end_s="1:05.5")
    assert (p.start_s, p.end_s, p.clip) == (15.0, 65.5, True)
    assert p.summary() == {"fmt": "mp4", "quality": "best", "transcode": False, "index": 1, "start_s": 15.0, "end_s": 65.5}
    assert "start_s" not in DownloadParams(url=TT).summary()
    for bad in ({"start_s": 5}, {"end_s": 5}, {"start_s": 5, "end_s": 5}, {"start_s": "1:75", "end_s": 200},
                {"start_s": -1, "end_s": 3}, {"start_s": "nan", "end_s": 3}):
        with pytest.raises(ValidationError):
            DownloadParams(url=TT, **{"fmt": "mp4", **bad})
    assert DownloadParams(url=TT, fmt="mp3", start_s=0, end_s=600).clip  # 10 min of sound
    # No fixed length any more (the old 180 s MP4 / 600 s MP3 caps, no GIF clip): the server's settings decide, in
    # normalize_clip (tests/test_extraits.py).
    assert DownloadParams(url=TT, fmt="mp4", start_s=0, end_s=181).clip
    assert DownloadParams(url=TT, fmt="gif", start_s=0, end_s=10).clip


def test_clip_cache_keys() -> None:
    full = DownloadParams(url=TT).model_dump()
    clip = DownloadParams(url=TT, start_s=1, end_s=5).model_dump()
    other = DownloadParams(url=TT, start_s=1, end_s=6).model_dump()
    keys = {cache_key("tiktok:1", p) for p in (full, clip, other)}
    assert len(keys) == 3
    # Keys of full-length files are those computed before clips existed (cache kept across the upgrade).
    legacy = {k: v for k, v in full.items() if k not in ("start_s", "end_s")}
    assert cache_key("tiktok:1", full) == cache_key("tiktok:1", legacy)


def test_clip_job_counts_one_unit_and_reaches_the_worker(tools: TestClient, account: FakeAccount,
                                                          fake_worker: FakeWorker) -> None:
    r = tools.post("/jobs?wait=5", json={"url": TT, "fmt": "mp4", "start_s": "0:05", "end_s": 20}, headers=bearer(KEY_A))
    assert r.status_code == 200, r.text
    assert r.json()["params"]["start_s"] == 5.0 and r.json()["params"]["end_s"] == 20.0
    task = fake_worker.calls[-1]
    assert task.kind == "download" and task.params is not None
    assert (task.params["start_s"], task.params["end_s"]) == (5.0, 20.0)
    assert account.creates() == 1
    # Same media, full length: another file, another job.
    assert tools.post("/jobs?wait=5", json={"url": TT, "fmt": "mp4"}, headers=bearer(KEY_A)).json()["job_id"] != r.json()["job_id"]


# --- derived jobs --------------------------------------------------------------------------------


def test_derive_compress_without_quota_owner_only_idempotent(tools: TestClient, account: FakeAccount,
                                                             fake_worker: FakeWorker) -> None:
    source = done_job(tools)
    assert account.creates() == 1
    body = {"op": "compress", "max_bytes": 8 * 2**20}
    r = tools.post(f"/jobs/{source}/derive?wait=5", json=body, headers=bearer(KEY_A))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["derive"] == {"op": "compress", "max_bytes": 8 * 2**20, "source_job_id": source}
    assert data["merged"] is False and data["file_url"]
    task = fake_worker.calls[-1]
    assert task.kind == "derive" and task.cookies_file is None and task.params is not None
    assert Path(task.params["source"]).is_relative_to(Path(task.workdir))  # own hard link, in its own directory
    assert account.creates() == 1  # no new quota unit
    again = tools.post(f"/jobs/{source}/derive?wait=5", json=body, headers=bearer(KEY_A))
    assert again.json()["job_id"] == data["job_id"] and again.json()["merged"] is True
    assert len([c for c in fake_worker.calls if c.kind == "derive"]) == 1
    # Another user can neither derive nor see it.
    assert tools.post(f"/jobs/{source}/derive", json=body, headers=bearer(KEY_B)).status_code == 404
    assert tools.get(f"/jobs/{data['job_id']}", headers=bearer(KEY_B)).status_code == 404
    file = tools.get(f"/jobs/{data['job_id']}/file", headers=bearer(KEY_A))
    assert file.status_code == 200 and file.headers["content-type"] == "video/mp4"


def test_derive_asked_twice_by_its_owner_is_deleted_by_one_delete(tools: TestClient, fake_worker: FakeWorker) -> None:
    source = done_job(tools)
    body = {"op": "gif", "start_s": "0:01", "duration_s": 3}
    first = tools.post(f"/jobs/{source}/derive?wait=5", json=body, headers=bearer(KEY_A)).json()
    again = tools.post(f"/jobs/{source}/derive?wait=5", json=body, headers=bearer(KEY_A)).json()
    assert again["job_id"] == first["job_id"] and again["merged"] is True
    assert tools.delete(f"/jobs/{first['job_id']}", headers=bearer(KEY_A)).status_code == 200
    # Gone for good (it used to survive with one « participant » left, and came back in the list on reload).
    assert tools.get(f"/jobs/{first['job_id']}", headers=bearer(KEY_A)).status_code == 404
    assert tools.get(f"/jobs/{first['job_id']}/file", headers=bearer(KEY_A)).status_code == 404


def test_derive_joined_while_running_is_really_cancelled(tools: TestClient, fake_worker: FakeWorker) -> None:
    source = done_job(tools)
    fake_worker.delay_s = 2.0
    body = {"op": "compress", "max_bytes": 4 * 2**20}
    first = tools.post(f"/jobs/{source}/derive", json=body, headers=bearer(KEY_A)).json()
    assert tools.post(f"/jobs/{source}/derive", json=body, headers=bearer(KEY_A)).json()["merged"] is True
    assert tools.delete(f"/jobs/{first['job_id']}", headers=bearer(KEY_A)).status_code == 200
    assert fake_worker.cancelled == 1  # the work stops: the account's slot is free again
    other = tools.post(f"/jobs/{source}/derive", json={"op": "gif"}, headers=bearer(KEY_A))
    assert other.status_code == 202, other.text


def test_derive_gif_and_refusals(tools: TestClient, account: FakeAccount, fake_worker: FakeWorker) -> None:
    source = done_job(tools)
    gif = tools.post(f"/jobs/{source}/derive?wait=5", json={"op": "gif", "start_s": "0:02", "duration_s": 4},
                     headers=bearer(KEY_A))
    assert gif.status_code == 200, gif.text
    assert gif.json()["params"]["fmt"] == "gif" and gif.json()["derive"]["start_s"] == 2.0
    assert tools.get(f"/jobs/{gif.json()['job_id']}/file", headers=bearer(KEY_A)).headers["content-type"] == "image/gif"
    too_long = tools.post(f"/jobs/{source}/derive", json={"op": "gif", "duration_s": 45}, headers=bearer(KEY_A))
    assert too_long.status_code == 400 and "30 s" in too_long.json()["detail"]
    assert tools.post(f"/jobs/{source}/derive", json={"op": "compress"}, headers=bearer(KEY_A)).status_code == 400
    assert tools.post(f"/jobs/{source}/derive", json={"op": "compress", "max_bytes": 1000},
                      headers=bearer(KEY_A)).status_code == 400  # under 1 MiB
    # A derived file is not derived again; an mp3 is not a video.
    again = tools.post(f"/jobs/{gif.json()['job_id']}/derive", json={"op": "compress", "max_bytes": 2**21},
                       headers=bearer(KEY_A))
    assert again.status_code == 400
    mp3 = done_job(tools, url=TT2, fmt="mp3")
    assert tools.post(f"/jobs/{mp3}/derive", json={"op": "gif"}, headers=bearer(KEY_A)).status_code == 400
    assert account.creates() == 2  # the two conversions only


def test_derive_needs_a_finished_source_and_respects_the_active_limit(tools: TestClient, fake_worker: FakeWorker) -> None:
    source = done_job(tools)
    fake_worker.delay_s = 1.0
    running = tools.post("/jobs", json={"url": TT2, "fmt": "mp4"}, headers=bearer(KEY_B))
    assert running.status_code == 202
    not_ready = tools.post(f"/jobs/{running.json()['job_id']}/derive", json={"op": "gif"}, headers=bearer(KEY_B))
    assert not_ready.status_code == 409 and not_ready.json()["error"] == "job_not_ready"
    first = tools.post(f"/jobs/{source}/derive", json={"op": "gif"}, headers=bearer(KEY_A))
    assert first.status_code == 202
    busy = tools.post(f"/jobs/{source}/derive", json={"op": "compress", "max_bytes": 2**21}, headers=bearer(KEY_A))
    assert busy.status_code == 429 and busy.json()["error"] == "active_job_limit"
    # The same derivation while it runs joins it (no "busy" for a retry).
    assert tools.post(f"/jobs/{source}/derive", json={"op": "gif"}, headers=bearer(KEY_A)).json()["merged"] is True


def test_derive_limit_per_source(tools: TestClient) -> None:
    source = done_job(tools)
    for i in range(6):
        r = tools.post(f"/jobs/{source}/derive?wait=5", json={"op": "gif", "start_s": i}, headers=bearer(KEY_A))
        assert r.status_code == 200, r.text
    over = tools.post(f"/jobs/{source}/derive", json={"op": "gif", "start_s": 9}, headers=bearer(KEY_A))
    assert over.status_code == 429 and over.json()["error"] == "derive_limit"


def test_derived_failure_never_touches_the_platform_breaker(tools: TestClient, fake_worker: FakeWorker) -> None:
    yt = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    source = done_job(tools, url=yt)
    fake_worker.error = ApiError(429, "bot_check", "blocked")  # would open the YouTube breaker on a download
    r = tools.post(f"/jobs/{source}/derive?wait=5", json={"op": "compress", "max_bytes": 2**21}, headers=bearer(KEY_A))
    assert r.json()["status"] == "error" and r.json()["error"] == "bot_check"
    assert tools.app.state.runner.platforms.states["youtube"].state != "bot_check"
    fake_worker.error = None
    assert tools.post("/jobs?wait=5", json={"url": yt, "fmt": "mp3"}, headers=bearer(KEY_A)).status_code == 200


def test_derive_params() -> None:
    assert DeriveParams(op="gif", start_s="1:02", duration_s="4.5").summary() == {
        "op": "gif", "start_s": 62.0, "duration_s": 4.5, "gif_width": 480, "gif_fps": 15}
    with pytest.raises(ValidationError):
        DeriveParams(op="compress")
    with pytest.raises(ValidationError):
        DeriveParams(op="resize", max_bytes=2**21)  # type: ignore[arg-type]


# --- keys issued to the bot -----------------------------------------------------------------------


def test_bot_keys_skip_the_per_ip_limit_not_the_per_user_one(make_client: Callable[..., TestClient],
                                                            account: FakeAccount, tmp_path: Path) -> None:
    token_file = tmp_path / "account_internal_token"
    token_file.write_text(INTERNAL)
    client = make_client(user_keys_enabled=True, account_internal_url=account.url,  # type: ignore[attr-defined]
                         account_internal_token_file=token_file, user_key_cache_s=0.0, media_tools_enabled=True,
                         rate_limit=(2, 60))
    account.kinds = {KEY_A: "discord", KEY_B: "discord"}
    base = "https://www.tiktok.com/@someone/video/72345678901234560"
    # Two Discord users behind the bot's single address: 2 previews each, over the per-IP limit of 2.
    for n, key in enumerate((KEY_A, KEY_B), start=1):
        for i in range(2):
            assert client.post("/preview", json={"url": f"{base}{n}{i}"}, headers=bearer(key)).status_code == 200
        assert client.post("/preview", json={"url": f"{base}{n}9"}, headers=bearer(key)).status_code == 429
    # Ordinary keys from that same address share the per-IP limit: the second user is refused at once.
    key_c, key_d = "ytc_" + "C" * 64, "ytc_" + "D" * 64
    account.keys[key_c] = {"user_id": "user-c", "key_id": "key-c-0001"}
    account.keys[key_d] = {"user_id": "user-d", "key_id": "key-d-0001"}
    for i in range(2):
        assert client.post("/preview", json={"url": f"{base}3{i}"}, headers=bearer(key_c)).status_code == 200
    assert client.post("/preview", json={"url": f"{base}40"}, headers=bearer(key_d)).status_code == 429
