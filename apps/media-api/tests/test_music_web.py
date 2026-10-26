"""The real HTTP client of AETHRYON Music (app/music/web.py) against a local server (MUSIC_ALLOW_LOCAL_SOURCES, tests
only): real sockets, progress, size limit, incomplete transfer, redirects re-checked, cancellation mid-download."""

from __future__ import annotations

import io
import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest

from app.errors import ApiError
from app.music.web import ANY_PUBLIC, Cancelled, Web

BODY = bytes(range(256)) * 4096  # 1 MiB


@pytest.fixture
def server() -> Iterator[str]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/redirect-cdn":
                self.send_response(302)
                self.send_header("Location", "https://cf-media.sndcdn.com/x.mp3")
                self.end_headers()
                return
            if self.path == "/redirect-ok":
                self.send_response(301)
                self.send_header("Location", "/file")
                self.end_headers()
                return
            if self.path == "/m3u8":
                self.send_response(200)
                self.send_header("Content-Type", "application/x-mpegURL")
                self.end_headers()
                self.wfile.write(b"#EXTM3U")
                return
            short = self.path == "/short"
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(BODY) + (10 if short else 0)))
            self.end_headers()
            slow = self.path == "/slow"
            try:
                for i in range(0, len(BODY), 65536):
                    self.wfile.write(BODY[i:i + 65536])
                    if slow:
                        time.sleep(0.05)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, *args: Any) -> None:
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
    srv.server_close()


def test_local_sources_are_refused_without_the_test_switch(server: str) -> None:
    with pytest.raises(ApiError):
        Web("ua").request("GET", server + "/file", ANY_PUBLIC)


def test_download_with_real_progress(server: str) -> None:
    web = Web("ua", allow_local=True)
    seen: list[tuple[int, int | None]] = []
    sink = io.BytesIO()
    resp = web.request("GET", server + "/redirect-ok", ANY_PUBLIC, sink=sink, max_bytes=2 * len(BODY),
                       progress=lambda r, t: seen.append((r, t)))
    assert resp.status == 200 and sink.getvalue() == BODY and resp.received == len(BODY)
    assert resp.redirects == [server + "/redirect-ok"]
    assert seen[0][1] == len(BODY) and seen[-1] == (len(BODY), len(BODY))
    assert [r for r, _ in seen] == sorted(r for r, _ in seen) and len(seen) == len(BODY) // 65536


def test_size_limit_incomplete_transfer_and_manifest(server: str) -> None:
    web = Web("ua", allow_local=True)
    with pytest.raises(ApiError) as err:
        web.request("GET", server + "/file", ANY_PUBLIC, sink=io.BytesIO(), max_bytes=1000)
    assert err.value.code == "fichier_trop_volumineux"
    with pytest.raises(ApiError) as err:
        web.request("GET", server + "/short", ANY_PUBLIC, sink=io.BytesIO(), max_bytes=4 * len(BODY))
    assert err.value.code == "transfert_incomplet"
    with pytest.raises(ApiError) as err:
        web.request("GET", server + "/m3u8", ANY_PUBLIC)
    assert err.value.code == "telechargement_non_autorise"


def test_redirect_to_a_streaming_cdn_is_refused(server: str) -> None:
    with pytest.raises(ApiError) as err:
        Web("ua", allow_local=True).request("GET", server + "/redirect-cdn", ANY_PUBLIC, sink=io.BytesIO())
    assert err.value.code == "telechargement_non_autorise"


def test_cancel_mid_download(server: str) -> None:
    web = Web("ua", allow_local=True)
    flag = threading.Event()
    seen: list[int] = []

    def progress(received: int, total: int | None) -> None:
        seen.append(received)
        if received >= 3 * 65536:
            flag.set()
    with pytest.raises(Cancelled):
        web.request("GET", server + "/slow", ANY_PUBLIC, sink=io.BytesIO(), max_bytes=2 * len(BODY),
                    progress=progress, cancelled=flag.is_set)
    assert 3 * 65536 <= seen[-1] < len(BODY)


def test_overall_deadline(server: str) -> None:
    with pytest.raises(ApiError) as err:
        Web("ua", allow_local=True).request("GET", server + "/slow", ANY_PUBLIC, sink=io.BytesIO(),
                                            max_bytes=2 * len(BODY), deadline_s=0.2)
    assert err.value.code == "source_trop_lente"
