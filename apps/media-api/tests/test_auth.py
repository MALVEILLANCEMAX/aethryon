import logging

import pytest
from fastapi.testclient import TestClient

from app.security import SlidingWindowLimiter, token_is_valid
from tests.conftest import TOKEN

URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"


def test_health_needs_no_auth(client: TestClient) -> None:
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert set(body["versions"]) >= {"yt_dlp", "ffmpeg"}


@pytest.mark.parametrize("path", ["/info", "/dl", "/jobs/abc", "/jobs/abc/file"])
def test_missing_token_is_401(client: TestClient, path: str) -> None:
    res = client.get(path, params={"url": URL})
    assert res.status_code == 401
    assert res.json()["error"] == "unauthorized"
    assert res.headers["www-authenticate"] == "Bearer"


def test_wrong_token_is_401(client: TestClient) -> None:
    res = client.get("/info", params={"url": URL}, headers={"Authorization": "Bearer nope"})
    assert res.status_code == 401


def test_post_and_delete_need_token(client: TestClient) -> None:
    assert client.post("/jobs", json={"url": URL}).status_code == 401
    assert client.delete("/jobs/abc").status_code == 401


def test_bearer_header_works(client: TestClient) -> None:
    res = client.get("/info", params={"url": URL}, headers={"Authorization": f"Bearer {TOKEN}"})
    assert res.status_code == 200


def test_bearer_scheme_is_case_insensitive(client: TestClient) -> None:
    res = client.get("/info", params={"url": URL}, headers={"Authorization": f"bearer {TOKEN}"})
    assert res.status_code == 200


def test_query_token_works(client: TestClient) -> None:
    res = client.get("/info", params={"url": URL, "token": TOKEN})
    assert res.status_code == 200


def test_token_compare() -> None:
    assert token_is_valid(TOKEN, TOKEN)
    assert not token_is_valid(TOKEN[:-1], TOKEN)
    assert not token_is_valid(TOKEN + "x", TOKEN)
    assert not token_is_valid("", TOKEN)
    assert not token_is_valid(None, TOKEN)
    assert not token_is_valid("é" * 10, TOKEN)


def test_repeated_auth_failures_are_rate_limited(client: TestClient) -> None:
    for _ in range(10):
        assert client.get("/info", params={"url": URL, "token": "bad"}).status_code == 401
    res = client.get("/info", params={"url": URL, "token": "bad"})
    assert res.status_code == 429
    assert int(res.headers["retry-after"]) >= 1
    # Even the right token is refused while the IP is locked out.
    assert client.get("/info", params={"url": URL, "token": TOKEN}).status_code == 429


def test_heavy_rate_limit(make_client) -> None:
    client = make_client(rate_limit=(2, 60))
    headers = {"Authorization": f"Bearer {TOKEN}"}
    assert client.get("/info", params={"url": URL}, headers=headers).status_code == 200
    assert client.get("/info", params={"url": URL}, headers=headers).status_code == 200
    res = client.get("/info", params={"url": URL}, headers=headers)
    assert res.status_code == 429
    assert res.json()["error"] == "rate_limited"
    # Polling endpoints use the separate, larger budget.
    assert client.get("/jobs/unknown", headers=headers).status_code == 404


def test_sliding_window() -> None:
    limiter = SlidingWindowLimiter(2, 10)
    assert limiter.hit("a", now=0) is None
    assert limiter.hit("a", now=1) is None
    assert limiter.hit("a", now=2) == pytest.approx(8)
    assert limiter.hit("b", now=2) is None
    assert limiter.hit("a", now=10.5) is None
    limiter.prune(now=100)
    assert limiter._events == {}


def test_docs_disabled_by_default(client: TestClient) -> None:
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


def test_docs_enabled_with_debug(make_client) -> None:
    client = make_client(debug=True)
    assert client.get("/openapi.json").status_code == 200


def test_token_never_logged(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    client.get("/info", params={"url": URL, "token": TOKEN})
    client.get("/info", params={"url": URL}, headers={"Authorization": f"Bearer {TOKEN}"})
    server_records = [r for r in caplog.records if not r.name.startswith(("httpx", "httpcore"))]
    assert any(r.name == "ytapi" and r.getMessage() == "request" for r in server_records)
    for record in server_records:  # the test client's own httpx log is not the server's
        assert TOKEN not in record.getMessage()
        assert TOKEN not in str(record.__dict__)
