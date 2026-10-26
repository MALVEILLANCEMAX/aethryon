"""Clips, compression and GIF with the real ffmpeg (small generated media, no network): what the bot Discord v2
delivers is measured with ffprobe and decoded, never assumed."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

import pytest

from app import worker
from app.errors import ApiError
from app.worker import Reporter, check_video_track, probe
from tests.conftest import run_ffmpeg

CFG = {"max_filesize_bytes": 10**9, "transcode_max_duration_s": 900, "gif_max_duration_s": 30}


class _Conn:
    def __init__(self) -> None:
        self.messages: list[dict[str, Any]] = []

    def send(self, message: dict[str, Any]) -> None:
        self.messages.append(message)


def _reporter() -> Reporter:
    return Reporter(_Conn())  # type: ignore[arg-type]


def _copy(source: Path, workdir: Path, name: str | None = None) -> Path:
    workdir.mkdir(parents=True, exist_ok=True)
    target = workdir / (name or source.name)
    shutil.copy2(source, target)
    return target


def _streams(path: Path) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for s in probe(path).get("streams") or []:
        kind = "cover" if (s.get("disposition") or {}).get("attached_pic") else s.get("codec_type")
        out.setdefault(str(kind), s)
    return out


def _duration(path: Path) -> float:
    return float(probe(path)["format"]["duration"])


@pytest.fixture(scope="session")
def noisy_720p(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """6 s of 1280x720 30 im/s noise + sound: hard to compress (several MiB), like a real phone video."""
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg absent")
    path = tmp_path_factory.mktemp("big") / "noisy.mp4"
    run_ffmpeg("-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30,noise=alls=30:allf=t", "-f", "lavfi", "-i",
               "sine=frequency=440:duration=6", "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "16",
               "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path))
    return path


@pytest.fixture(scope="session")
def landscape_320(tmp_path_factory: pytest.TempPathFactory) -> Path:
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg absent")
    path = tmp_path_factory.mktemp("gif") / "land.mp4"
    run_ffmpeg("-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25", "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p",
               str(path))
    return path


# --- clips -----------------------------------------------------------------------------------------


def test_video_clip_is_h264_aac_of_the_requested_length(media_samples: dict[str, Path], tmp_path: Path) -> None:
    source = _copy(media_samples["h264"], tmp_path)
    out, notes = worker.cut_clip(source, tmp_path, {"fmt": "mp4", "start_s": 1.0, "end_s": 2.5}, _reporter())
    assert out.suffix == ".mp4" and out.is_file() and not (tmp_path / "h264.clip.mp4").exists()
    streams = _streams(out)
    assert streams["video"]["codec_name"] == "h264" and streams["audio"]["codec_name"] == "aac"
    assert abs(_duration(out) - 1.5) < 0.15
    assert notes == []
    checked = check_video_track(out, h264=True)
    assert checked["frames"] and checked["middle_frames"]


def test_hevc_source_clip_becomes_h264(media_samples: dict[str, Path], tmp_path: Path) -> None:
    if "hevc" not in media_samples:
        pytest.skip("libx265 absent")
    source = _copy(media_samples["hevc"], tmp_path)
    out, _ = worker.cut_clip(source, tmp_path, {"fmt": "mp4", "start_s": 0.5, "end_s": 2.0}, _reporter())
    assert _streams(out)["video"]["codec_name"] == "h264"
    check_video_track(out, h264=True)


def test_clip_end_is_clamped_and_start_beyond_the_end_refused(media_samples: dict[str, Path], tmp_path: Path) -> None:
    source = _copy(media_samples["h264"], tmp_path / "a")
    out, notes = worker.cut_clip(source, tmp_path / "a", {"fmt": "mp4", "start_s": 2.0, "end_s": 60.0}, _reporter())
    assert abs(_duration(out) - 1.0) < 0.15
    assert notes and "jusqu'à la fin" in notes[0]
    source = _copy(media_samples["h264"], tmp_path / "b")
    with pytest.raises(ApiError) as caught:
        worker.cut_clip(source, tmp_path / "b", {"fmt": "mp4", "start_s": 5.0, "end_s": 9.0}, _reporter())
    assert (caught.value.status, caught.value.code) == (400, "clip_out_of_range")
    with pytest.raises(ApiError) as early:  # refused at extraction time, before any download (run_clip)
        worker.clip_bounds(4.0, 9.0, 3.0, strict=False)
    assert (early.value.status, early.value.code) == (400, "clip_out_of_range")


def test_audio_only_source_gives_no_video_clip(media_samples: dict[str, Path], tmp_path: Path) -> None:
    source = _copy(media_samples["audio_only"], tmp_path)
    with pytest.raises(ApiError) as caught:
        worker.cut_clip(source, tmp_path, {"fmt": "mp4", "start_s": 0.0, "end_s": 2.0}, _reporter())
    assert caught.value.code == "format_unavailable"  # never an .mp4 that only plays sound


def test_mp3_clip_keeps_bitrate_and_cover(media_samples: dict[str, Path], tmp_path: Path) -> None:
    with_cover = tmp_path / "cover.mp3"
    run_ffmpeg("-i", str(media_samples["music"]), "-i", str(media_samples["cover"]), "-map", "0:a", "-map", "1:v",
               "-c:a", "copy", "-c:v", "mjpeg", "-disposition:v:0", "attached_pic", "-id3v2_version", "3", str(with_cover))
    out, notes = worker.cut_clip(with_cover, tmp_path, {"fmt": "mp3", "start_s": 0.5, "end_s": 2.5, "bitrate": 128},
                                 _reporter())
    assert out.suffix == ".mp3"
    streams = _streams(out)
    assert streams["audio"]["codec_name"] == "mp3"
    assert abs(_duration(out) - 2.0) < 0.15
    assert abs(int(streams["audio"]["bit_rate"]) - 128_000) < 8_000
    assert "cover" in streams or notes == ["La pochette n'a pas pu être intégrée."]


def test_mp3_clip_of_a_silent_video_is_refused(media_samples: dict[str, Path], tmp_path: Path) -> None:
    if "hevc_video_only" not in media_samples:
        pytest.skip("libx265 absent")
    source = _copy(media_samples["hevc_video_only"], tmp_path)
    with pytest.raises(ApiError) as caught:
        worker.cut_clip(source, tmp_path, {"fmt": "mp3", "start_s": 0.0, "end_s": 2.0}, _reporter())
    assert caught.value.code == "no_audio"


# --- compression -------------------------------------------------------------------------------------


def test_sizes_in_notes_are_readable() -> None:
    assert [worker._mib(n) for n in (1024 * 1024, 10 * 1024 * 1024, int(1.2 * 1024 * 1024), 9_961_472)] == \
        ["1 Mio", "10 Mio", "1,2 Mio", "9,5 Mio"]


def test_plan_compression() -> None:
    mib = 1024 * 1024
    # 6 s of 720p under 1 MiB: 1.3 Mbit/s in all -> 96 kbit/s of sound, 540p kept at >= 0.045 bit per pixel.
    plan = worker.plan_compression(6, 1280, 720, 30, True, mib)
    assert plan["audio_kbps"] == 96 and plan["short_side"] == 540 and plan["fps"] == 0
    assert plan["video_kbps"] + plan["audio_kbps"] <= mib * 8 / 6 / 1000
    # Vertical 1080x1920 at 60 im/s: the short side is the width, 60 -> 30 im/s.
    vertical = worker.plan_compression(60, 1080, 1920, 60, True, 10 * mib)
    assert vertical["fps"] == 30 and vertical["short_side"] in worker.COMPRESS_SIDES
    # A small budget: the sound drops to 64 kbit/s; never scaled up.
    small = worker.plan_compression(120, 640, 360, 25, True, 5 * mib)
    assert small["audio_kbps"] == 64 and small["short_side"] <= 360
    assert worker.plan_compression(10, 320, 240, 25, False, mib)["audio_kbps"] == 0
    with pytest.raises(ApiError) as caught:
        worker.plan_compression(3600, 1920, 1080, 30, True, 10 * mib)  # 1 h in 10 MiB
    assert (caught.value.status, caught.value.code) == (413, "cannot_fit")


def test_compress_hits_the_target_size_with_a_playable_h264(noisy_720p: Path, tmp_path: Path) -> None:
    max_bytes = 1024 * 1024
    source = _copy(noisy_720p, tmp_path / "work", "noisy.mp4")
    assert source.stat().st_size > 2 * max_bytes, "the sample must really need compressing"
    out, notes, recompressed = worker.compress_video(source, tmp_path / "work", max_bytes, CFG, _reporter())
    assert recompressed and out.is_file() and out.stat().st_size <= max_bytes
    streams = _streams(out)
    assert streams["video"]["codec_name"] == "h264" and streams["audio"]["codec_name"] == "aac"
    assert min(int(streams["video"]["width"]), int(streams["video"]["height"])) == 540
    assert abs(_duration(out) - 6.0) < 0.2
    assert notes == ["Image réduite à 540p pour tenir dans 1 Mio."]
    check_video_track(out, h264=True)


def test_compress_leaves_a_file_that_already_fits(media_samples: dict[str, Path], tmp_path: Path) -> None:
    source = _copy(media_samples["h264"], tmp_path)
    before = source.read_bytes()
    out, notes, recompressed = worker.compress_video(source, tmp_path, 1024 * 1024, CFG, _reporter())
    assert out == source and not recompressed and out.read_bytes() == before
    assert "n'a pas été recompressé" in notes[0]


def test_compress_respects_the_transcode_limit(noisy_720p: Path, tmp_path: Path) -> None:
    source = _copy(noisy_720p, tmp_path)
    with pytest.raises(ApiError) as caught:
        worker.compress_video(source, tmp_path, 1024 * 1024, CFG | {"transcode_max_duration_s": 5}, _reporter())
    assert caught.value.code == "transcode_too_long"


# --- GIF -------------------------------------------------------------------------------------------


def test_gif_of_a_passage(landscape_320: Path, tmp_path: Path) -> None:
    source = _copy(landscape_320, tmp_path)
    out = worker.derive_gif(source, tmp_path, {"start_s": 1.0, "duration_s": 2.0, "gif_width": 480, "gif_fps": 10},
                            CFG, _reporter())
    assert out.suffix == ".gif" and not source.exists() and not (tmp_path / "palette.png").exists()
    video = _streams(out)["video"]
    assert video["codec_name"] == "gif" and int(video["width"]) == 320  # never scaled up
    assert abs(_duration(out) - 2.0) < 0.25


def test_gif_shrinks_until_it_fits_or_says_it_cannot(landscape_320: Path, tmp_path: Path) -> None:
    params = {"start_s": 0.0, "duration_s": 3.0, "gif_width": 480, "gif_fps": 15}
    first = worker.derive_gif(_copy(landscape_320, tmp_path / "a"), tmp_path / "a", params, CFG, _reporter())
    full = first.stat().st_size
    fitted = worker.derive_gif(_copy(landscape_320, tmp_path / "b"), tmp_path / "b", params | {"max_bytes": int(full * 0.7)},
                               CFG, _reporter())
    assert fitted.stat().st_size <= full * 0.7
    with pytest.raises(ApiError) as caught:
        worker.derive_gif(_copy(landscape_320, tmp_path / "c"), tmp_path / "c", params | {"max_bytes": 2000}, CFG,
                          _reporter())
    assert caught.value.code == "cannot_fit"
    assert not list((tmp_path / "c").glob("*.gif"))


def test_gif_start_beyond_the_end(landscape_320: Path, tmp_path: Path) -> None:
    with pytest.raises(ApiError) as caught:
        worker.derive_gif(_copy(landscape_320, tmp_path), tmp_path,
                          {"start_s": 10.0, "duration_s": 2.0, "gif_width": 320, "gif_fps": 10}, CFG, _reporter())
    assert caught.value.code == "clip_out_of_range"


# --- run_derive (worker entry point of POST /jobs/{id}/derive) ------------------------------------------


def test_run_derive_names_and_types(landscape_320: Path, noisy_720p: Path, tmp_path: Path) -> None:
    gif_dir = tmp_path / "gif"
    src = _copy(landscape_320, gif_dir / "source")
    task = {"kind": "derive", "platform": "tiktok", "params": {
        "op": "gif", "source": str(src), "title": "Café 東京", "media_id": "abc", "start_s": 0.0, "duration_s": 1.5,
        "gif_width": 240, "gif_fps": 10, "max_bytes": None}}
    result = worker.run_derive(task, CFG, gif_dir, _reporter())
    assert result["download_name"] == "Café 東京 (GIF) [abc].gif" and result["media_type"] == "image/gif"
    assert result["size"] == Path(result["filepath"]).stat().st_size > 0

    small_dir = tmp_path / "small"
    src = _copy(noisy_720p, small_dir / "source")
    task["params"] = {"op": "compress", "source": str(src), "title": "Clip", "media_id": "xyz", "max_bytes": 2 * 1024 * 1024,
                      "start_s": 0.0, "duration_s": 6.0, "gif_width": 480, "gif_fps": 15}
    result = worker.run_derive(task, CFG, small_dir, _reporter())
    assert result["download_name"] == "Clip (compressé) [xyz].mp4" and result["media_type"] == "video/mp4"
    assert result["size"] <= 2 * 1024 * 1024

    task["params"] = dict(task["params"], source=str(tmp_path / "gone.mp4"))
    with pytest.raises(ApiError) as caught:
        worker.run_derive(task, CFG, tmp_path, _reporter())
    assert (caught.value.status, caught.value.code) == (410, "file_gone")
