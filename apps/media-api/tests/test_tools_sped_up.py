"""Sped Up / Slowed (pitch "shift"): tempo and pitch move together, like a record played faster. Parameters, filters
and names are checked as values; the real ffmpeg exports are measured — duration, sample rate, channels, dominant
frequency (Goertzel scan of the decoded sound), peak level, picture/sound sync —, never assumed."""

from __future__ import annotations

import math
import re
import shutil
import subprocess
from array import array
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic import ValidationError

from app import studio
from app.jobs import _derive_key
from app.params import TOOLS_FIELDS, DeriveParams
from tests.conftest import run_ffmpeg
from tests.test_tools_ffmpeg import _edit, _meta

SOXR_48 = "aresample=48000:resampler=soxr:precision=28"


# --- parameters, filters, names ------------------------------------------------------------------------------------

def test_pitch_is_a_tools_field_kept_by_default() -> None:
    assert "pitch" in TOOLS_FIELDS
    assert DeriveParams(op="audio", speed=1.25).pitch == "keep"
    assert DeriveParams(op="audio", speed=1.25, pitch="shift").pitch == "shift"
    for wrong in ("up", "SHIFT", "", None, 2):
        with pytest.raises(ValidationError):
            DeriveParams(op="audio", speed=1.25, pitch=wrong)  # type: ignore[arg-type]
    # A GIF has no sound: the field is accepted and changes nothing.
    assert DeriveParams(op="gif", speed=2, pitch="shift").pitch_shift is False


def test_summary_shows_sped_up_only_when_it_changes_the_file() -> None:
    passage = {"op": "audio", "start_s": 6, "duration_s": 5}
    assert DeriveParams(**passage, speed=1.25, pitch="shift").summary() == {  # type: ignore[arg-type]
        "op": "audio", "start_s": 6.0, "duration_s": 5.0, "speed": 1.25, "pitch": "shift"}
    assert DeriveParams(**passage, speed=1.25).summary() == {  # type: ignore[arg-type]
        "op": "audio", "start_s": 6.0, "duration_s": 5.0, "speed": 1.25}
    assert DeriveParams(**passage, pitch="shift").summary() == {  # type: ignore[arg-type]
        "op": "audio", "start_s": 6.0, "duration_s": 5.0}
    assert DeriveParams(op="video", speed=0.8, pitch="shift").summary() == {
        "op": "video", "speed": 0.8, "pitch": "shift"}
    assert "pitch" not in DeriveParams(op="gif", speed=2, pitch="shift").summary()
    assert "pitch" not in DeriveParams(op="video", speed=2, pitch="shift", mute=True).summary()


def test_two_exports_that_differ_by_pitch_alone_are_two_jobs() -> None:
    source = SimpleNamespace(id="src")

    def key(**fields: Any) -> str:
        return _derive_key(source, DeriveParams(**fields))  # type: ignore[arg-type]

    assert key(op="video", speed=1.25) != key(op="video", speed=1.25, pitch="shift")
    small = {"op": "compress", "max_bytes": 2**21, "speed": 0.8}
    assert key(**small) != key(**small, pitch="shift")
    # Without a speed change or without a sound, "shift" changes nothing: the same file, the same job.
    assert key(op="video") == key(op="video", pitch="shift")
    assert key(op="gif", speed=2) == key(op="gif", speed=2, pitch="shift")


def test_audio_filters_keep_the_pitch_or_resample_like_a_record() -> None:
    keep = {"op": "audio", "speed": 1.25}
    assert studio.audio_filters(keep, 3.2, 48000) == ["atempo=1.25000"]
    assert studio.audio_filters({**keep, "speed": 0.25}, 16.0, 48000) == ["atempo=0.5", "atempo=0.50000"]
    shift = {**keep, "pitch": "shift"}
    assert studio.audio_filters(shift, 3.2, 48000) == ["asetrate=60000", SOXR_48]
    assert studio.audio_filters({**shift, "speed": 0.8}, 5.0, 44100) == [
        "asetrate=35280", "aresample=44100:resampler=soxr:precision=28"]
    # Unknown rate: first brought to 48 kHz, so that asetrate declares the rate the samples really have.
    assert studio.audio_filters(shift, 3.2, None) == [SOXR_48, "asetrate=60000", SOXR_48]
    assert studio.audio_filters({**shift, "speed": 1}, 4.0, 48000) == []
    # Volume and fades come after the resampling, placed in the time of the result (3.2 s).
    assert studio.audio_filters({**shift, "volume_db": -6, "fade_in_s": 0.5, "fade_out_s": 1}, 3.2, 48000) == [
        "asetrate=60000", SOXR_48, "volume=-6.0dB", "afade=t=in:st=0:d=0.500", "afade=t=out:st=2.200:d=1.000"]


def test_the_real_speed_is_the_ratio_of_whole_hertz() -> None:
    assert studio.shift_rates({"speed": 1.25, "pitch": "shift"}, 48000) == (60000, 48000)
    assert studio.shift_rates({"speed": 1.333, "pitch": "shift"}, 44100) == (58785, 44100)  # 1.332993…×
    assert studio.shift_rates({"speed": 1.25, "pitch": "shift"}, None) == (60000, 48000)
    assert studio.shift_rates({"speed": 1.25, "pitch": "keep"}, 48000) is None
    assert studio.shift_rates({"speed": 1, "pitch": "shift"}, 48000) is None
    assert studio.sample_rate_of({"sample_rate": "44100"}) == 44100
    for wrong in ({"sample_rate": "0"}, {"sample_rate": "n/a"}, {}, None):
        assert studio.sample_rate_of(wrong) is None


def test_export_labels() -> None:
    def label(sound: bool = True, **params: Any) -> str:
        return studio.export_label({"op": "video", **params}, 0, 4, 4, sound)

    assert label(speed=1.25) == "(montage vitesse ×1,25)"
    assert label(speed=1.25, pitch="shift") == "(montage sped up ×1,25)"
    assert label(op="audio", speed=0.8, pitch="shift") == "(audio slowed ×0,8)"
    assert label(pitch="shift") == "(montage)"
    assert label(False, speed=1.25, pitch="shift") == "(montage vitesse ×1,25)"  # no sound in the result
    assert label(op="gif", speed=2, pitch="shift") == "(GIF)"
    passage = studio.export_label({"op": "audio", "speed": 1.25, "pitch": "shift"}, 6, 5, 20)
    assert passage == "(audio 6s-11s, sped up ×1,25)"


# --- the real ffmpeg -------------------------------------------------------------------------------------------------

@pytest.fixture(scope="session")
def tones(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    """4 s of a 440 Hz sine at -6 dBFS, stereo: WAV at 48 kHz and at 44.1 kHz, and a 320x240 25 im/s H.264 video with
    that sound (AAC, 48 kHz)."""
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg absent")
    root = tmp_path_factory.mktemp("tones")
    p = {name: root / name for name in ("tone48.wav", "tone44.wav", "tone.mp4")}
    for name, rate in (("tone48.wav", 48000), ("tone44.wav", 44100)):
        run_ffmpeg("-f", "lavfi", "-i", f"aevalsrc=0.5*sin(2*PI*440*t)|0.5*sin(2*PI*440*t):s={rate}:d=4",
                   "-c:a", "pcm_s16le", str(p[name]))
    run_ffmpeg("-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=4", "-i", str(p["tone48.wav"]),
               "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
               "-shortest", str(p["tone.mp4"]))
    return p


def _streams(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    video, audio = studio.streams_of(studio.probe_media(path, upload=False))
    return video or {}, audio or {}


def _pcm(path: Path, rate: int = 8000) -> array[int]:
    """The sound of a file as mono 16-bit samples at `rate` (8 kHz: plenty for tones under 1 kHz, quick to scan)."""
    out = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path), "-map", "0:a:0", "-ac", "1",
                          "-ar", str(rate), "-f", "s16le", "-"], capture_output=True, check=True, timeout=60)
    samples = array("h")
    samples.frombytes(out.stdout)
    return samples


def _dominant_hz(path: Path) -> float:
    """Frequency of the strongest tone: Goertzel power of the middle half second (Hann window), 4 Hz steps over
    100–1000 Hz, then 0.25 Hz steps around the best one."""
    rate, size = 8000, 4000
    pcm = _pcm(path, rate)
    first = (len(pcm) - size) // 2
    part = [pcm[first + i] * (0.5 - 0.5 * math.cos(2 * math.pi * i / (size - 1))) for i in range(size)]

    def power(freq: float) -> float:
        coeff = 2 * math.cos(2 * math.pi * freq / rate)
        s1 = s2 = 0.0
        for x in part:
            s1, s2 = x + coeff * s1 - s2, s1
        return s1 * s1 + s2 * s2 - coeff * s1 * s2

    coarse = max(range(100, 1001, 4), key=power)
    return max((coarse - 4 + step / 4 for step in range(33)), key=power)


def _max_volume_db(path: Path) -> float:
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-map", "0:a:0", "-af", "volumedetect",
                          "-f", "null", "-"], capture_output=True, text=True, timeout=60)
    found = re.search(r"max_volume: (-?[\d.]+) dB", out.stderr)
    assert found, out.stderr[-500:]
    return float(found.group(1))


@pytest.mark.parametrize(("source", "speed", "pitch", "seconds", "hz", "rate"), [
    ("tone48.wav", 1.25, "keep", 3.2, 440, 48000),
    ("tone48.wav", 1.25, "shift", 3.2, 550, 48000),
    ("tone48.wav", 0.8, "keep", 5.0, 440, 48000),
    ("tone48.wav", 0.8, "shift", 5.0, 352, 48000),
    ("tone44.wav", 1.25, "shift", 3.2, 550, 44100),
])
def test_speed_keeps_the_pitch_or_moves_it_like_a_record(
        tones: dict[str, Path], tmp_path: Path, source: str, speed: float, pitch: str, seconds: float, hz: float,
        rate: int) -> None:
    out = _edit(tones[source], tmp_path, "x", op="audio", speed=speed, pitch=pitch)
    path = Path(out["filepath"])
    _, audio = _streams(path)
    assert out["ext"] == "mp3" and audio["codec_name"] == "mp3"
    assert abs(_meta(out["filepath"])["duration"] - seconds) <= 0.06
    assert (int(audio["sample_rate"]), int(audio["channels"])) == (rate, 2)
    assert abs(_dominant_hz(path) - hz) <= hz * 0.02
    assert _max_volume_db(path) < -0.5  # the -6 dBFS tone never clips


def test_sped_up_video_keeps_picture_and_sound_together(tones: dict[str, Path], tmp_path: Path) -> None:
    out = _edit(tones["tone.mp4"], tmp_path, "v", speed=1.25, pitch="shift")
    video, audio = _streams(Path(out["filepath"]))
    picture, sound = float(video["duration"]), float(audio["duration"])
    assert abs(sound - picture) <= 0.05 and abs(picture - 3.2) <= 0.06 and abs(sound - 3.2) <= 0.06
    assert int(audio["sample_rate"]) == 48000 and abs(_dominant_hz(Path(out["filepath"])) - 550) <= 11
    assert out["download_name"] == "Essai (montage sped up ×1,25).mp4"
    muted = _edit(tones["tone.mp4"], tmp_path, "m", speed=1.25, pitch="shift", mute=True)
    assert _meta(muted["filepath"])["has_audio"] is False
    assert muted["download_name"] == "Essai (montage vitesse ×1,25).mp4"  # no sound: only a speed change


def test_volume_and_fades_follow_the_sped_up_sound(tones: dict[str, Path], tmp_path: Path) -> None:
    out = _edit(tones["tone48.wav"], tmp_path, "f", op="audio", audio_format="wav", speed=1.25, pitch="shift",
                volume_db=-6, fade_in_s=1, fade_out_s=1)
    rate, pcm = 8000, _pcm(Path(out["filepath"]))
    assert abs(len(pcm) / rate - 3.2) < 0.02

    def peak(start: float, end: float) -> int:
        part = pcm[int(start * rate):int(end * rate)]
        return max(max(part), -min(part))

    middle = peak(1.5, 1.7)
    assert abs(20 * math.log10(middle / 32768) + 12) < 0.5  # -6 dBFS tone, -6 dB
    # Fades placed in the time of the result (3.2 s), not of the source passage (4 s).
    assert peak(0, 0.1) < middle * 0.15 and peak(3.1, 3.2) < middle * 0.15
