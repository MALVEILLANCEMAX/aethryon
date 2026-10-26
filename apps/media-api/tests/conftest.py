"""Shared fixtures: settings, an app whose worker processes are replaced by a fake, small real media."""

from __future__ import annotations

import asyncio
import dataclasses
import shutil
import subprocess
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import pytest
from fastapi.testclient import TestClient

from app.config import DEFAULT_ALLOWED_DOMAINS, Settings, parse_domains
from app.errors import ApiError
from app.main import create_app
from app.runner import Cancelled, Runner, Task
from app.urls import MediaUrl, media_key

TOKEN = "test-token-" + "x" * 32


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        api_token=TOKEN,
        allowed_domains=parse_domains(DEFAULT_ALLOWED_DOMAINS),
        tmp_dir=tmp_path / "tmp",
        cache_dir=None,
        rate_limit=(1000, 60),
        root_path="",
        cache_ttl_min=0,  # cache off by default; cache tests enable it explicitly
        yt_min_interval_s=0,
    )


class FakeWorker:
    """Replaces Runner.run: no yt-dlp, no network, deterministic results."""

    def __init__(self) -> None:
        self.error: ApiError | None = None
        self.delay_s = 0.0
        self.delay_by_platform: dict[str, float] = {}  # overrides delay_s per platform
        self.calls: list[Task] = []
        self.cancelled = 0
        self.media_id: str | None = None  # id "downloaded" (default: the id named by the URL)

    def _media_id(self, task: Task) -> str:
        if self.media_id is not None:
            return self.media_id
        media = MediaUrl(url=task.url, host=urlsplit(task.url).hostname or "", platform=task.platform)
        ident = media_key(media).partition(":")[2]
        return "abc" if "/" in ident or "." in ident else ident

    async def __call__(
        self,
        task: Task,
        timeout_s: float,
        on_progress: Callable[[dict[str, Any]], None] | None = None,
        cancel_check: Callable[[], Any] | None = None,
        gate: Any = None,
    ) -> dict[str, Any]:
        self.calls.append(task)
        delay = self.delay_by_platform.get(task.platform, self.delay_s)
        waited = 0.0
        while waited < delay:
            if cancel_check is not None and await cancel_check():
                self.cancelled += 1
                raise Cancelled()
            if on_progress:
                on_progress({"type": "progress", "stage": "downloading", "percent": 100 * waited / delay})
            await asyncio.sleep(0.02)
            waited += 0.02
        if gate is not None:
            gate.release()  # extraction over
        if self.error is not None:
            raise self.error
        if task.kind == "info":
            return {"platform": task.platform, "id": "abc", "title": "Café 東京", "media_count": 1}
        if task.kind == "upload":  # AETHRYON Tools: check of an imported file (the real one: test_tools_ffmpeg)
            assert task.params is not None
            source = Path(task.params["source"])
            if source.read_bytes()[:3] == b"BAD":
                raise ApiError(415, "unsupported_file", "Ce fichier n'est pas une vidéo ou un son pris en charge.")
            path = source.with_name("media.mp4")
            source.rename(path)
            return {"filepath": str(path), "download_name": "Vacances.mp4", "media_type": "video/mp4",
                    "title": "Vacances", "id": None, "ext": "mp4", "size": path.stat().st_size, "notes": [],
                    "media": {"duration": 12.0, "has_video": True, "has_audio": True, "width": 640, "height": 360,
                              "playable": True}}
        if task.kind == "assets":
            assert task.params is not None
            out = Path(task.params["out_dir"])
            if task.params["asset"] == "storyboard":
                (out / "storyboard.jpg").write_bytes(b"\xff\xd8\xff" + b"\x00" * 100)
                data = {"count": 8, "cols": 8, "rows": 1, "tile_w": 200, "tile_h": 112, "interval_s": 1.5}
            else:
                data = {"count": 300, "duration": 12.0, "peaks": [0] * 300}
            import json as _json

            (out / f"{task.params['asset']}.json").write_text(_json.dumps(data))
            return data
        if task.kind == "derive":  # compression / GIF of a finished job: ffmpeg only, on the job's own link
            assert task.params is not None and Path(task.params["source"]).is_file()
            ext = "gif" if task.params["op"] == "gif" else "mp4"
            path = Path(task.workdir) / f"abc.{ext}"
            path.write_bytes(b"\x00" * 500)
            return {"filepath": str(path), "download_name": f"Café 東京 [abc].{ext}",
                    "media_type": "image/gif" if ext == "gif" else "video/mp4", "title": "Café 東京", "id": "abc",
                    "ext": ext, "size": 500, "notes": []}
        path = Path(task.workdir) / "abc.mp4"
        path.write_bytes(b"\x00" * 1000)
        return {
            "filepath": str(path),
            "download_name": "Café 東京 [abc].mp4",
            "media_type": "video/mp4",
            "title": "Café 東京",
            "id": self._media_id(task),
            "ext": "mp4",
            "size": 1000,
            "notes": [],
        }


@pytest.fixture
def fake_worker() -> FakeWorker:
    return FakeWorker()


@pytest.fixture
def make_client(settings: Settings, fake_worker: FakeWorker) -> Iterator[Callable[..., TestClient]]:
    clients: list[TestClient] = []

    def factory(client_kwargs: dict[str, Any] | None = None, **overrides: Any) -> TestClient:
        effective = dataclasses.replace(settings, **overrides)
        runner = Runner(effective)
        runner._run = fake_worker  # type: ignore[method-assign]  # wrapper (breaker, gates) stays real
        client = TestClient(create_app(effective, runner), **(client_kwargs or {}))
        client.__enter__()
        clients.append(client)
        return client

    yield factory
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def client(make_client: Callable[..., TestClient]) -> TestClient:
    return make_client()


@pytest.fixture
def auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


# --- small real media files (ffmpeg) --------------------------------------------------------------


def run_ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True, timeout=60)


def _zero_mdat(source: Path, target: Path) -> None:
    """Copy of an .mp4 whose media data is zeroed: headers intact, nothing decodable."""
    data, pos = bytearray(source.read_bytes()), 0
    while pos + 8 <= len(data):
        size, kind = int.from_bytes(data[pos:pos + 4], "big"), bytes(data[pos + 4:pos + 8])
        if kind == b"mdat":
            data[pos + 8:pos + size] = bytes(size - 8)
            break
        pos += size
    target.write_bytes(bytes(data))


@pytest.fixture(scope="session")
def media_samples(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    """3 s vertical clips like TikTok's: h264 (H.264 + AAC), hevc (HEVC hvc1 + AAC, if libx265),
    hevc_video_only, music (the "music track": mp3 alone), audio_only and audio_cover (sound only in an
    .mp4, without and with cover art), broken (H.264 .mp4 whose media data is zeroed), cover (jpg)."""
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg absent")
    root = tmp_path_factory.mktemp("media")
    paths = {name: root / f"{name}.{ext}" for name, ext in (
        ("h264", "mp4"), ("hevc", "mp4"), ("hevc_video_only", "mp4"), ("music", "mp3"), ("audio_only", "mp4"),
        ("audio_cover", "mp4"), ("broken", "mp4"), ("cover", "jpg"))}
    sine = ["-f", "lavfi", "-i", "sine=frequency=440:duration=3"]
    run_ffmpeg("-f", "lavfi", "-i", "testsrc=size=72x128:rate=25", *sine, "-t", "3", "-c:v", "libx264",
               "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", str(paths["h264"]))
    encoders = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=30)
    if "libx265" in encoders.stdout:
        hevc = ["-f", "lavfi", "-i", "testsrc=size=108x192:rate=25"]
        x265 = ["-c:v", "libx265", "-x265-params", "log-level=error", "-tag:v", "hvc1", "-pix_fmt", "yuv420p"]
        run_ffmpeg(*hevc, *sine, "-t", "3", *x265, "-c:a", "aac", "-shortest", str(paths["hevc"]))
        run_ffmpeg(*hevc, "-t", "3", *x265, "-an", str(paths["hevc_video_only"]))
    else:
        del paths["hevc"], paths["hevc_video_only"]
    run_ffmpeg("-f", "lavfi", "-i", "sine=frequency=880:duration=3", "-c:a", "libmp3lame", "-b:a", "64k",
               str(paths["music"]))
    run_ffmpeg(*sine, "-c:a", "aac", "-vn", "-f", "mp4", str(paths["audio_only"]))
    run_ffmpeg("-f", "lavfi", "-i", "testsrc=size=64x64", "-frames:v", "1", str(paths["cover"]))
    run_ffmpeg("-i", str(paths["audio_only"]), "-i", str(paths["cover"]), "-map", "0:a", "-map", "1:v", "-c:a", "copy",
               "-c:v", "mjpeg", "-disposition:v:0", "attached_pic", str(paths["audio_cover"]))
    _zero_mdat(paths["h264"], paths["broken"])
    return paths
