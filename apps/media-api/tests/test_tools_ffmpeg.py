"""AETHRYON Tools with the real ffmpeg (small generated media, no network): imports are checked like untrusted files,
edits are measured with ffprobe and decoded — duration, size, codecs, crop, sound —, never assumed."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import pytest

from app import studio
from app.errors import ApiError
from app.worker import Reporter
from tests.conftest import run_ffmpeg

CFG = {"max_filesize_bytes": 10**9, "transcode_max_duration_s": 900, "gif_max_duration_s": 30, "max_duration_s": 3600}


class _Conn:
    def __init__(self) -> None:
        self.messages: list[dict[str, Any]] = []

    def send(self, message: dict[str, Any]) -> None:
        self.messages.append(message)


def _reporter() -> Reporter:
    return Reporter(_Conn())  # type: ignore[arg-type]


@pytest.fixture(scope="session")
def tools_media(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    """sync: 640x360 30 im/s, 12 s, a white frame + a 1 kHz beep at 0, 5, 10 s (sync measure); vertical: 360x640;
    audio: 20 s MP3; silent: video without sound; webm: VP9/Opus; traps: an HLS list, an ffconcat list, a PNG and
    text, all named like videos."""
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg absent")
    root = tmp_path_factory.mktemp("tools")
    p = {name: root / name for name in ("sync.mp4", "vertical.mp4", "audio.mp3", "silent.mp4", "clip.webm", "hls.mp4",
                                        "concat.mp4", "image.mp4", "text.mp4", "rotated.mp4")}
    run_ffmpeg("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=12", "-f", "lavfi", "-i",
               "sine=frequency=1000:sample_rate=48000:duration=12", "-filter_complex",
               "[0:v]drawbox=x=0:y=0:w=iw:h=ih:color=white@1:t=fill:enable='lt(mod(n,150),1)'[v];"
               "[1:a]volume=volume=0:enable='gte(mod(t,5),0.1)'[a]", "-map", "[v]", "-map", "[a]",
               "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "30", "-c:a", "aac", "-ac", "2",
               "-movflags", "+faststart", str(p["sync.mp4"]))
    run_ffmpeg("-f", "lavfi", "-i", "testsrc2=size=360x640:rate=25:duration=4", "-f", "lavfi", "-i",
               "sine=frequency=500:duration=4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-shortest", str(p["vertical.mp4"]))
    run_ffmpeg("-f", "lavfi", "-i", "sine=frequency=330:duration=20", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k",
               str(p["audio.mp3"]))
    run_ffmpeg("-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=3", "-an", "-c:v", "libx264",
               "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(p["silent.mp4"]))
    run_ffmpeg("-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=3", "-f", "lavfi", "-i",
               "sine=frequency=440:duration=3", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8",
               "-c:a", "libopus", "-shortest", str(p["clip.webm"]))
    # A phone video filmed upright: 320x240 pixels, displayed rotated (display matrix -90°).
    run_ffmpeg("-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=2", "-c:v", "libx264", "-preset",
               "ultrafast", "-pix_fmt", "yuv420p", "-metadata:s:v:0", "rotate=90", str(p["rotated.mp4"]))
    if "rotation" not in json.dumps(studio.probe_media(p["rotated.mp4"], upload=False)):
        run_ffmpeg("-display_rotation", "-90", "-i", str(p["silent.mp4"]), "-c", "copy", str(p["rotated.mp4"]))
    p["hls.mp4"].write_text("#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nhttp://169.254.169.254/latest\n#EXT-X-ENDLIST\n")
    p["concat.mp4"].write_text("ffconcat version 1.0\nfile /etc/passwd\n")
    run_ffmpeg("-f", "lavfi", "-i", "testsrc2=size=64x64", "-frames:v", "1", "-f", "image2", "-c:v", "png",
               str(p["image.mp4"]))
    p["text.mp4"].write_text("pas une vidéo\n")
    return p


def _upload(source: Path, tmp_path: Path, name: str) -> dict[str, Any]:
    workdir = tmp_path / "job"
    workdir.mkdir(parents=True)
    shutil.copy(source, workdir / "source.bin")
    task = {"params": {"source": str(workdir / "source.bin"), "name": name}}
    return studio.run_upload_check(task, CFG, workdir, _reporter())


def _edit(source: Path, tmp_path: Path, sub: str, **params: Any) -> dict[str, Any]:
    workdir = tmp_path / sub
    workdir.mkdir(parents=True)
    base = {"op": "video", "start_s": 0, "duration_s": None, "speed": 1.0, "title": "Essai", "media_id": None,
            "source": str(source), "from_upload": True, "tools": True}
    task = {"params": {**base, **params}}
    return studio.run_tools_derive(task, CFG, workdir, _reporter())


def _meta(path: str) -> dict[str, Any]:
    return studio.media_info(studio.probe_media(Path(path), upload=False))


# --- imports: untrusted files ------------------------------------------------------------------------------------

@pytest.mark.parametrize("name", ["hls.mp4", "concat.mp4", "image.mp4", "text.mp4"])
def test_disguised_files_are_refused_before_any_demuxer_opens_something_else(
        tools_media: dict[str, Path], tmp_path: Path, name: str) -> None:
    with pytest.raises(ApiError) as caught:
        _upload(tools_media[name], tmp_path, name)
    assert (caught.value.status, caught.value.code) == (415, "unsupported_file")


def test_import_of_a_video_is_checked_named_and_summarised(tools_media: dict[str, Path], tmp_path: Path) -> None:
    result = _upload(tools_media["sync.mp4"], tmp_path, "../../Mes vacances (été).mp4")
    assert Path(result["filepath"]).name == "media.mp4"  # server name, never the visitor's
    assert result["download_name"] == "Mes vacances (été).mp4"
    media = result["media"]
    assert (media["width"], media["height"], media["has_audio"], media["playable"]) == (640, 360, True, True)
    assert abs(media["duration"] - 12) < 0.1


def test_import_of_sound_only_and_webm(tools_media: dict[str, Path], tmp_path: Path) -> None:
    audio = _upload(tools_media["audio.mp3"], tmp_path / "a", "voix.mp3")
    assert audio["ext"] == "mp3" and audio["media"]["has_video"] is False and audio["media_type"] == "audio/mpeg"
    webm = _upload(tools_media["clip.webm"], tmp_path / "b", "écran.webm")
    assert webm["ext"] == "webm" and webm["media"]["video_codec"] == "vp9" and webm["media"]["playable"]


def test_rotated_phone_video_reports_its_displayed_size(tools_media: dict[str, Path], tmp_path: Path) -> None:
    result = _upload(tools_media["rotated.mp4"], tmp_path, "portrait.mp4")
    assert (result["media"]["width"], result["media"]["height"]) == (240, 320)


def test_too_long_import_is_refused(tools_media: dict[str, Path], tmp_path: Path) -> None:
    workdir = tmp_path / "job"
    workdir.mkdir()
    shutil.copy(tools_media["audio.mp3"], workdir / "source.bin")
    with pytest.raises(ApiError) as caught:
        studio.run_upload_check({"params": {"source": str(workdir / "source.bin"), "name": "x.mp3"}},
                                dict(CFG, max_duration_s=10), workdir, _reporter())
    assert caught.value.code == "too_long"


# --- edits ---------------------------------------------------------------------------------------------------------

def test_trim_is_frame_accurate_and_keeps_audio_in_sync(tools_media: dict[str, Path], tmp_path: Path) -> None:
    out = _edit(tools_media["sync.mp4"], tmp_path, "trim", start_s=4.0, duration_s=7.0)
    meta = _meta(out["filepath"])
    assert out["ext"] == "mp4" and meta["video_codec"] == "h264" and meta["audio_codec"] == "aac"
    assert abs(meta["duration"] - 7.0) < 0.1
    assert out["download_name"].startswith("Essai (montage 4s-11s)")
    # The white frames at 5 s and 10 s of the source are at 1 s and 6 s of the export, with their beeps.
    flashes = _white_frames(Path(out["filepath"]))
    assert [round(t, 2) for t in flashes] == [1.0, 6.0]


def _white_frames(path: Path) -> list[float]:
    import re
    import subprocess

    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path), "-an", "-vf",
                          "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"],
                         capture_output=True, text=True, timeout=120)
    times, t = [], None
    for line in out.stdout.splitlines():
        m = re.search(r"pts_time:([0-9.]+)", line)
        if m:
            t = float(m.group(1))
        m = re.search(r"YAVG=([0-9.]+)", line)
        if m and t is not None and float(m.group(1)) > 200:
            times.append(t)
    return times


def test_crop_rotation_and_presets_give_the_exact_picture(tools_media: dict[str, Path], tmp_path: Path) -> None:
    square = _edit(tools_media["sync.mp4"], tmp_path, "c1", crop={"x": 140, "y": 0, "w": 360, "h": 360})
    assert (_meta(square["filepath"])["width"], _meta(square["filepath"])["height"]) == (360, 360)
    vertical = _edit(tools_media["sync.mp4"], tmp_path, "c2", crop={"x": 219, "y": 0, "w": 203, "h": 360},
                     duration_s=2)
    m = _meta(vertical["filepath"])
    assert (m["width"], m["height"]) == (202, 360)  # even sizes (yuv420p)
    turned = _edit(tools_media["sync.mp4"], tmp_path, "c3", rotate=90, flip="h", duration_s=1)
    assert (_meta(turned["filepath"])["width"], _meta(turned["filepath"])["height"]) == (360, 640)
    with pytest.raises(ApiError) as caught:
        _edit(tools_media["sync.mp4"], tmp_path, "c4", crop={"x": 900, "y": 0, "w": 100, "h": 100})
    assert caught.value.code == "invalid_crop"


def test_speed_volume_fades_mute_height_and_containers(tools_media: dict[str, Path], tmp_path: Path) -> None:
    fast = _edit(tools_media["sync.mp4"], tmp_path, "s1", duration_s=6, speed=2.0, volume_db=-6, fade_in_s=0.5,
                 fade_out_s=0.5)
    assert abs(_meta(fast["filepath"])["duration"] - 3.0) < 0.1
    muted = _edit(tools_media["sync.mp4"], tmp_path, "s2", duration_s=2, mute=True, height=180)
    m = _meta(muted["filepath"])
    assert m["has_audio"] is False and m["height"] == 180 and m["width"] == 320
    for container, codec in (("webm", "vp9"), ("mov", "h264"), ("mkv", "h264")):
        out = _edit(tools_media["sync.mp4"], tmp_path, f"k-{container}", duration_s=1.5, container=container)
        assert out["ext"] == container and _meta(out["filepath"])["video_codec"] == codec


def test_audio_export_has_the_right_duration_and_bitrate(tools_media: dict[str, Path], tmp_path: Path) -> None:
    out = _edit(tools_media["audio.mp3"], tmp_path, "a1", op="audio", start_s=3.25, duration_s=8.5, bitrate=192)
    meta = _meta(out["filepath"])
    assert out["ext"] == "mp3" and meta["has_video"] is False and meta["audio_codec"] == "mp3"
    assert abs(meta["duration"] - 8.5) < 0.06
    assert abs((meta["audio_bit_rate"] or meta["bit_rate"]) - 192000) < 4000
    for fmt in ("m4a", "wav", "ogg", "flac"):
        out = _edit(tools_media["sync.mp4"], tmp_path, f"a-{fmt}", op="audio", audio_format=fmt, duration_s=2)
        assert out["ext"] == fmt and abs(_meta(out["filepath"])["duration"] - 2) < 0.1
    with pytest.raises(ApiError) as caught:
        _edit(tools_media["silent.mp4"], tmp_path, "a-none", op="audio")
    assert caught.value.code == "no_audio"


def test_gif_with_crop_and_speed(tools_media: dict[str, Path], tmp_path: Path) -> None:
    out = _edit(tools_media["sync.mp4"], tmp_path, "g1", op="gif", start_s=1, duration_s=4, speed=2.0, gif_width=200,
                gif_fps=10, crop={"x": 0, "y": 0, "w": 320, "h": 320})
    meta = _meta(out["filepath"])
    assert out["ext"] == "gif" and meta["width"] == 200 and meta["height"] == 200
    assert abs(meta["duration"] - 2.0) < 0.25
    with pytest.raises(ApiError) as caught:
        _edit(tools_media["sync.mp4"], tmp_path, "g2", op="gif", duration_s=12, speed=0.25)
    assert caught.value.code == "gif_too_long"


def test_compression_fits_and_a_sample_shows_the_plan(tools_media: dict[str, Path], tmp_path: Path) -> None:
    target = 1024 * 1024
    out = _edit(tools_media["sync.mp4"], tmp_path, "z1", op="compress", max_bytes=target)
    assert out["size"] <= target and _meta(out["filepath"])["video_codec"] == "h264"
    assert any(note.startswith("Plan :") for note in out["notes"])
    sample = _edit(tools_media["sync.mp4"], tmp_path, "z2", op="echantillon", max_bytes=target)
    assert abs(_meta(sample["filepath"])["duration"] - 2.0) < 0.15
    preview = _edit(tools_media["clip.webm"], tmp_path, "p1", op="apercu")
    assert _meta(preview["filepath"])["video_codec"] == "h264"


def test_limits_of_the_exports(tools_media: dict[str, Path], tmp_path: Path) -> None:
    with pytest.raises(ApiError) as caught:
        studio.run_tools_derive({"params": {"op": "video", "start_s": 0, "duration_s": None, "speed": 0.25,
                                            "title": "x", "source": str(tools_media["sync.mp4"]), "from_upload": True}},
                                dict(CFG, transcode_max_duration_s=30), tmp_path, _reporter())
    assert caught.value.code == "transcode_too_long"
    with pytest.raises(ApiError) as late:
        _edit(tools_media["sync.mp4"], tmp_path, "l2", start_s=30)
    assert late.value.code == "clip_out_of_range"


# --- storyboard and waveform ---------------------------------------------------------------------------------------

def test_storyboard_and_waveform(tools_media: dict[str, Path], tmp_path: Path) -> None:
    out_dir = tmp_path / "assets"
    out_dir.mkdir()
    task = {"params": {"asset": "storyboard", "source": str(tools_media["sync.mp4"]), "from_upload": True,
                       "out_dir": str(out_dir)}}
    board = studio.assets_task(task, CFG, tmp_path)
    assert board["count"] == 8 and board["cols"] == 8 and board["rows"] == 1 and board["tile_h"] == 112
    image = studio.media_info(studio.probe_media(out_dir / "storyboard.jpg", upload=False))
    assert (image["width"], image["height"]) == (board["tile_w"] * board["cols"], 112 * board["rows"])
    wave = studio.assets_task({"params": dict(task["params"], asset="waveform")}, CFG, tmp_path)
    assert wave["count"] == 300 and len(wave["peaks"]) == 300
    # The beeps (1 kHz at -18 dBFS, 0.1 s at 0, 5 and 10 s) stand out of the silence around them.
    per_s = wave["count"] / wave["duration"]
    assert wave["peaks"][int(5.03 * per_s)] >= 15 and wave["peaks"][int(3 * per_s)] <= 1
    silent = studio.assets_task({"params": dict(task["params"], asset="waveform",
                                                source=str(tools_media["silent.mp4"]))}, CFG, tmp_path)
    assert silent == {"count": 0}
