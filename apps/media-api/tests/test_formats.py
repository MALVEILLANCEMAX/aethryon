"""Format/quality selection: option building and real yt-dlp format selection (offline)."""

import copy
from typing import Any

import pytest
import yt_dlp

from app.errors import ApiError
from app.params import DownloadParams
from app.worker import PLATFORM_EXTRACTORS, base_options, format_options


def params(**kw: Any) -> dict[str, Any]:
    return DownloadParams(url="https://youtu.be/x", **kw).model_dump()


def test_mp4_best_prefers_h264() -> None:
    opts = format_options(params(fmt="mp4") | {"platform": "youtube"})
    assert opts["format"] == "bv*+ba/b"
    assert opts["format_sort"] == ["vcodec:h264", "res", "acodec:m4a"]
    assert opts["merge_output_format"] == "mp4/webm/mkv"


@pytest.mark.parametrize("quality", ["2160", "1440", "1080", "720", "480", "360"])
def test_mp4_quality_is_resolution_first(quality: str) -> None:
    opts = format_options(params(fmt="mp4", quality=quality) | {"platform": "youtube"})
    assert opts["format_sort"] == [f"res:{quality}", "vcodec:h264", "acodec:m4a"]


def test_mp4_worst() -> None:
    assert format_options(params(fmt="mp4", quality="worst"))["format_sort"][0] == "+res"


def test_mp4_best_with_transcode_takes_highest_resolution_up_to_2160() -> None:
    opts = format_options(params(fmt="mp4", transcode=True) | {"platform": "youtube"})
    assert opts["format_sort"][0] == "res:2160"


def test_mp3_options() -> None:
    opts = format_options(params(fmt="mp3", bitrate=320))
    assert opts["format"] == "ba/b"
    keys = [pp["key"] for pp in opts["postprocessors"]]
    assert keys == ["FFmpegThumbnailsConvertor", "FFmpegExtractAudio", "FFmpegMetadata", "EmbedThumbnail"]
    extract = opts["postprocessors"][1]
    assert extract["preferredcodec"] == "mp3"
    assert extract["preferredquality"] == "320"


def test_mp3_options_match_yt_dlp_cli_semantics() -> None:
    """Regression guard: our dict must stay equivalent to the CLI flags it mirrors."""
    cli = yt_dlp.parse_options([
        "--ignore-config", "-x", "--audio-format", "mp3", "--audio-quality", "192K",
        "--embed-metadata", "--embed-thumbnail", "--convert-thumbnails", "jpg",
    ]).ydl_opts
    ours = format_options(params(fmt="mp3", bitrate=192))
    cli_keys = [pp["key"] for pp in cli["postprocessors"] if pp.get("when") != "playlist"]
    assert cli_keys == [pp["key"] for pp in ours["postprocessors"]]
    assert ours["writethumbnail"] is cli["writethumbnail"] is True


def test_gif_options() -> None:
    opts = format_options(params(fmt="gif"))
    assert opts["format"] == "bv*/b"


def test_tiktok_mp4_muxed_h264_first() -> None:
    # Regression: yt-dlp's default ranking took TikTok's HEVC file (sound without picture in many players).
    opts = format_options(params(fmt="mp4") | {"platform": "tiktok"})
    assert opts["format"] == "b/bv*+ba"
    assert opts["format_sort"] == ["vcodec:h264", "res", "acodec:m4a"]
    assert opts["merge_output_format"] == "mp4"
    assert opts["postprocessor_args"] == {"merger+ffmpeg_o": ["-c:a", "aac", "-b:a", "128k"]}
    assert format_options(params(fmt="mp4", quality="720") | {"platform": "tiktok"})["format_sort"] == [
        "res:720", "vcodec:h264", "acodec:m4a"]


def test_twitter_prefers_progressive_mp4() -> None:
    assert format_options(params(fmt="mp4") | {"platform": "twitter"})["format"] == "b/bv*+ba"


def test_base_options_restrict_extractors(tmp_path) -> None:
    cfg = {"max_filesize_bytes": 10, "cache_dir": None, "cookies_file": None}
    yt = base_options(cfg, tmp_path, "youtube")
    assert yt["allowed_extractors"] == PLATFORM_EXTRACTORS["youtube"]
    assert yt["noplaylist"] is True
    tw = base_options(cfg, tmp_path, "twitter")
    assert tw["noplaylist"] is False  # GIF posts fail with noplaylist
    # Fail closed: no extractor list, no yt-dlp (SoundCloud & co. can never run, AUDIT cloud-music).
    with pytest.raises(ApiError) as refused:
        base_options(cfg, tmp_path, "other")
    assert refused.value.code == "domain_not_allowed"


def test_extractor_whitelist_regexes_load(tmp_path) -> None:
    for platform, allowed in PLATFORM_EXTRACTORS.items():
        ydl = yt_dlp.YoutubeDL({"allowed_extractors": allowed, "quiet": True})
        names = {name.lower() for name in ydl._ies}
        assert "generic" not in names
        assert any(platform in name for name in names)


def test_cookies_file_is_copied(tmp_path) -> None:
    source = tmp_path / "cookies.txt"
    source.write_text("# Netscape HTTP Cookie File\n")
    work = tmp_path / "work"
    work.mkdir()
    cfg = {"max_filesize_bytes": 1, "cache_dir": None}
    opts = base_options(cfg, work, "youtube", str(source))
    assert opts["cookiefile"] == str(work / "cookies.txt")
    # Never sent to the other platforms.
    assert "cookiefile" not in base_options(cfg, work, "tiktok", str(source))
    assert (work / "cookies.txt").read_text() == source.read_text()


# --- real yt-dlp format selection on a synthetic YouTube-like format list --------------------


def _v(fid: str, h: int, vcodec: str, ext: str, tbr: int) -> dict[str, Any]:
    return {"format_id": fid, "url": f"https://example.invalid/{fid}", "ext": ext, "height": h,
            "width": h * 16 // 9, "vcodec": vcodec, "acodec": "none", "tbr": tbr, "protocol": "https"}


def _a(fid: str, acodec: str, ext: str, abr: int) -> dict[str, Any]:
    return {"format_id": fid, "url": f"https://example.invalid/{fid}", "ext": ext, "vcodec": "none",
            "acodec": acodec, "abr": abr, "tbr": abr, "protocol": "https"}


YOUTUBE_LIKE = {
    "id": "x", "title": "t", "extractor": "youtube", "extractor_key": "Youtube",
    "webpage_url": "https://www.youtube.com/watch?v=x", "duration": 100,
    "formats": [
        _v("571", 4320, "av01.0.16M.08", "mp4", 30000),
        _v("313", 2160, "vp9", "webm", 18000), _v("401", 2160, "av01.0.12M.08", "mp4", 12000),
        _v("271", 1440, "vp9", "webm", 9000), _v("137", 1080, "avc1.640028", "mp4", 4000),
        _v("248", 1080, "vp9", "webm", 2500), _v("136", 720, "avc1.4d401f", "mp4", 2000),
        _v("135", 480, "avc1.4d401e", "mp4", 1000), _v("134", 360, "avc1.4d401e", "mp4", 600),
        _v("160", 144, "avc1.4d400c", "mp4", 100),
        _a("140", "mp4a.40.2", "m4a", 129), _a("251", "opus", "webm", 135),
    ],
}


def select(opts: dict[str, Any]) -> dict[str, Any]:
    ydl_opts = {"quiet": True, "simulate": True, "noprogress": True} | {
        k: v for k, v in opts.items() if k in ("format", "format_sort", "merge_output_format")}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        return ydl.process_ie_result(copy.deepcopy(YOUTUBE_LIKE), download=False)


@pytest.mark.parametrize(
    ("kw", "format_id", "ext"),
    [
        ({}, "137+140", "mp4"),                                 # best -> 1080p H.264 + AAC
        ({"quality": "1080"}, "137+140", "mp4"),
        ({"quality": "720"}, "136+140", "mp4"),
        ({"quality": "1440"}, "271+140", "mkv"),                # VP9 only above 1080p
        ({"quality": "2160"}, "313+140", "mkv"),
        ({"quality": "worst"}, "160+140", "mp4"),
        ({"transcode": True}, "313+140", "mkv"),                # best + transcode -> 2160, never 8K
    ],
)
def test_real_selection(kw: dict[str, Any], format_id: str, ext: str) -> None:
    info = select(format_options(params(fmt="mp4", **kw) | {"platform": "youtube"}))
    assert info["format_id"] == format_id
    assert info["ext"] == ext


def test_missing_quality_falls_back_below() -> None:
    data = copy.deepcopy(YOUTUBE_LIKE)
    data["formats"] = [f for f in data["formats"] if f.get("height") != 720]
    opts = format_options(params(fmt="mp4", quality="720") | {"platform": "youtube"})
    with yt_dlp.YoutubeDL({"quiet": True, "simulate": True, "format": opts["format"],
                           "format_sort": opts["format_sort"], "merge_output_format": opts["merge_output_format"]}) as ydl:
        info = ydl.process_ie_result(data, download=False)
    assert info["height"] == 480


def test_mp3_selects_best_audio() -> None:
    info = select(format_options(params(fmt="mp3")))
    assert info["format_id"] == "251"


# --- real yt-dlp format selection on TikTok's format list ----------------------------------------


def _tt(fid: str, vcodec: str, width: int | None, height: int | None, tbr: int | None, quality: int | None,
        preference: int = -1, acodec: str = "aac") -> dict[str, Any]:
    return {"format_id": fid, "url": f"https://example.invalid/{fid}", "ext": "mp4", "vcodec": vcodec,
            "acodec": acodec, "width": width, "height": height, "tbr": tbr, "quality": quality,
            "preference": preference, "protocol": "https"}


# Formats of https://www.tiktok.com/@nasa/video/7691727731800673549 as yt-dlp 2026.08.19 lists them
# (web extraction, 2026-10-11): HEVC up to 1080p, H.264 at 720p, the watermarked download, the music.
TIKTOK_LIKE = {
    "id": "7691727731800673549", "title": "t", "extractor": "TikTok", "extractor_key": "TikTok",
    "webpage_url": "https://www.tiktok.com/@nasa/video/7691727731800673549", "duration": 16,
    "formats": [
        _tt("download", "h264", None, None, None, None, preference=-2),
        _tt("bytevc1_540p_167277", "h265", 576, 1024, 167, 1),
        _tt("h264_720p_405934", "h264", 720, 1280, 405, 2),
        _tt("bytevc1_720p_209003", "h265", 720, 1280, 209, 2),
        _tt("bytevc1_1080p_289672", "h265", 1080, 1920, 289, 3),
        {"format_id": "audio", "url": "https://example.invalid/audio", "ext": "mp3", "vcodec": "none",
         "acodec": "mp3", "protocol": "https"},
    ],
}


def select_tiktok(opts: dict[str, Any], drop: tuple[str, ...] = (), video_only: tuple[str, ...] = ()) -> dict[str, Any]:
    data = copy.deepcopy(TIKTOK_LIKE)
    data["formats"] = [f | ({"acodec": "none"} if f["format_id"].startswith(video_only) else {})
                       for f in data["formats"] if not f["format_id"].startswith(drop)]
    ydl_opts = {"quiet": True, "simulate": True, "noprogress": True} | {
        k: v for k, v in opts.items() if k in ("format", "format_sort", "merge_output_format")}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        return ydl.process_ie_result(data, download=False)


def test_tiktok_default_ranking_picks_hevc() -> None:
    """What the bug came from: without our options, yt-dlp ranks TikTok's HEVC file first."""
    assert select_tiktok({"format": "bv*+ba/b"})["format_id"] == "bytevc1_1080p_289672"


@pytest.mark.parametrize(
    ("kw", "format_id"),
    [
        ({}, "h264_720p_405934"),                    # best: the muxed H.264 file, no re-encoding
        ({"quality": "720"}, "h264_720p_405934"),
        ({"quality": "1080"}, "bytevc1_1080p_289672"),  # only in HEVC: re-encoded to H.264 afterwards
        ({"quality": "480"}, "bytevc1_540p_167277"),    # closest above (TikTok's "540p" is 576 wide)
        ({"quality": "worst"}, "bytevc1_540p_167277"),
    ],
)
def test_tiktok_real_selection(kw: dict[str, Any], format_id: str) -> None:
    info = select_tiktok(format_options(params(fmt="mp4", **kw) | {"platform": "tiktok"}))
    assert info["format_id"] == format_id
    assert "requested_formats" not in info  # one muxed file: the video's own sound, never the music track


def test_tiktok_without_h264_takes_hevc_not_the_watermark() -> None:
    info = select_tiktok(format_options(params(fmt="mp4") | {"platform": "tiktok"}), drop=("h264_",))
    assert info["format_id"] == "bytevc1_1080p_289672"


def test_tiktok_video_only_hevc_is_not_merged_with_the_music_track() -> None:
    # Some TikTok HEVC files are video only: the old "bv*+ba" merged them with the music track.
    opts = format_options(params(fmt="mp4") | {"platform": "tiktok"})
    assert select_tiktok(opts, video_only=("bytevc1_",))["format_id"] == "h264_720p_405934"
    old = select_tiktok({"format": "bv*+ba/b"}, video_only=("bytevc1_",))
    assert old["format_id"] == "bytevc1_1080p_289672+audio"


def test_tiktok_mp3_takes_the_video_soundtrack() -> None:
    info = select_tiktok(format_options(params(fmt="mp3") | {"platform": "tiktok"}))
    assert info["format_id"] != "audio" and info["vcodec"] != "none"
