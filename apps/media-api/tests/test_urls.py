import pytest

from app.config import DEFAULT_ALLOWED_DOMAINS, parse_domains
from app.errors import ApiError
from app.urls import detect_platform, host_matches, media_key, validate_media_url

ALLOWED = parse_domains(DEFAULT_ALLOWED_DOMAINS)


@pytest.mark.parametrize(
    ("url", "platform"),
    [
        ("https://www.youtube.com/watch?v=jNQXAC9IVRw", "youtube"),
        ("https://youtube.com/watch?v=jNQXAC9IVRw", "youtube"),
        ("https://m.youtube.com/watch?v=jNQXAC9IVRw", "youtube"),
        ("https://youtu.be/jNQXAC9IVRw?si=abc", "youtube"),
        ("https://www.youtube.com/shorts/18NGQq7p3LY", "youtube"),
        ("https://www.youtube-nocookie.com/embed/jNQXAC9IVRw", "youtube"),
        ("http://www.youtube.com/watch?v=jNQXAC9IVRw", "youtube"),
        ("https://www.youtube.com:443/watch?v=jNQXAC9IVRw", "youtube"),
        ("https://WWW.YouTube.COM/watch?v=jNQXAC9IVRw", "youtube"),
        ("https://www.tiktok.com/@scout2015/video/6718335390845095173", "tiktok"),
        ("https://vm.tiktok.com/ZTR45GpSF/", "tiktok"),
        ("https://vt.tiktok.com/ZSXjHUWbe/", "tiktok"),
        ("https://x.com/historyinmemes/status/1790637656616943991", "twitter"),
        ("https://twitter.com/historyinmemes/status/1790637656616943991", "twitter"),
        ("https://mobile.twitter.com/i/status/1790637656616943991", "twitter"),
        ("  https://x.com/i/status/1790637656616943991  ", "twitter"),
    ],
)
def test_accepts_supported_urls(url: str, platform: str) -> None:
    assert validate_media_url(url, ALLOWED).platform == platform


@pytest.mark.parametrize(
    ("url", "code"),
    [
        ("https://evil.com/youtube.com", "domain_not_allowed"),
        ("https://evil.com/?u=https://youtube.com/watch?v=x", "domain_not_allowed"),
        ("https://youtube.com.evil.com/watch?v=x", "domain_not_allowed"),
        ("https://notyoutube.com/watch?v=x", "domain_not_allowed"),
        ("https://youtube.co/watch?v=x", "domain_not_allowed"),
        ("https://x.com.evil.org/status/1", "domain_not_allowed"),
        ("https://xx.com/status/1", "domain_not_allowed"),
        ("https://tiktok.com.attacker.net/@a/video/1", "domain_not_allowed"),
        ("https://youtube.com@evil.com/watch?v=x", "invalid_url"),
        ("https://user:pass@youtube.com/watch?v=x", "invalid_url"),
        ("https://youtube.com\\@evil.com/", "invalid_url"),
        ("https://www.youtube.com:8443/watch?v=x", "invalid_url"),
        ("https://www.youtube.com:0/watch?v=x", "invalid_url"),
        ("https://www.youtube.com:99999/watch?v=x", "invalid_url"),
        ("http://127.0.0.1/watch?v=x", "invalid_url"),
        ("http://[::1]/watch?v=x", "invalid_url"),
        ("http://169.254.169.254/latest/meta-data/", "invalid_url"),
        ("http://2130706433/", "invalid_url"),
        ("http://localhost/watch?v=x", "invalid_url"),
        ("http://youtube.localhost/watch?v=x", "invalid_url"),
        ("file:///etc/passwd", "invalid_url"),
        ("ftp://youtube.com/x", "invalid_url"),
        ("javascript:alert(1)", "invalid_url"),
        ("gopher://youtube.com/x", "invalid_url"),
        ("//youtube.com/watch?v=x", "invalid_url"),
        ("youtube.com/watch?v=x", "invalid_url"),
        ("https://www.youtube.com/watch?v=x y", "invalid_url"),
        ("https://www.youtube.com/watch?v=x\ny", "invalid_url"),
        ("https://www.you\ttube.com/", "invalid_url"),
        ("https://www.youtube.com./watch?v=x", "invalid_url"),
        ("https://www.yöutube.com/watch?v=x", "invalid_url"),
        ("https://www.youtube.com/" + "a" * 2100, "invalid_url"),
        ("", "invalid_url"),
        (None, "invalid_url"),
    ],
)
def test_rejects_tricky_urls(url: str | None, code: str) -> None:
    with pytest.raises(ApiError) as excinfo:
        validate_media_url(url, ALLOWED)
    assert excinfo.value.status == 400
    assert excinfo.value.code == code


def test_outer_whitespace_is_trimmed() -> None:
    # Shortcuts sometimes pass text with a trailing newline.
    assert validate_media_url("https://youtu.be/x\n", ALLOWED).url == "https://youtu.be/x"


def test_host_matching_is_label_based() -> None:
    assert host_matches("youtube.com", "youtube.com")
    assert host_matches("music.youtube.com", "youtube.com")
    assert not host_matches("evilyoutube.com", "youtube.com")
    assert not host_matches("youtube.com.evil.com", "youtube.com")


def test_allowlist_is_configurable() -> None:
    only_youtube = parse_domains("youtube.com, youtu.be")
    assert validate_media_url("https://youtu.be/x", only_youtube).platform == "youtube"
    with pytest.raises(ApiError):
        validate_media_url("https://x.com/i/status/1", only_youtube)


def test_detect_platform_other() -> None:
    assert detect_platform("vimeo.com") == "other"


def test_normalized_url_drops_fragment_and_lowercases_host() -> None:
    media = validate_media_url("HTTPS://WWW.YOUTUBE.COM/watch?v=AbC#t=10", ALLOWED)
    assert media.url == "https://www.youtube.com/watch?v=AbC"


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://tiktok.com/@scout2015/video/6718335390845095173?_r=1&lang=fr",
         "https://www.tiktok.com/@scout2015/video/6718335390845095173"),
        ("https://m.tiktok.com/v/6718335390845095173.html", "https://www.tiktok.com/@/video/6718335390845095173"),
        ("http://vt.tiktok.com/ZSXjHUWbe/", "https://vt.tiktok.com/ZSXjHUWbe/"),
        # Classic links: www host, no query, no trailing slash; uppercase hosts are lowered.
        ("https://www.tiktok.com/@scout2015/video/6718335390845095173/",
         "https://www.tiktok.com/@scout2015/video/6718335390845095173"),
        ("https://WWW.TIKTOK.COM/@scout2015/video/6718335390845095173?is_from_webapp=1&sender_device=pc#x",
         "https://www.tiktok.com/@scout2015/video/6718335390845095173"),
        ("https://www.tiktok.com/@the.user_1/Video/6718335390845095173",
         "https://www.tiktok.com/@the.user_1/video/6718335390845095173"),
        ("https://www.tiktok.com/@/video/6718335390845095173", "https://www.tiktok.com/@/video/6718335390845095173"),
        ("https://us.tiktok.com/@a/video/6718335390845095173", "https://www.tiktok.com/@a/video/6718335390845095173"),
        # Embeds, players, share pages: rewritten to the form yt-dlp's TikTokIE accepts (empty user).
        ("https://www.tiktok.com/embed/6718335390845095173", "https://www.tiktok.com/@/video/6718335390845095173"),
        ("https://www.tiktok.com/embed/v2/6718335390845095173?lang=fr",
         "https://www.tiktok.com/@/video/6718335390845095173"),
        ("https://www.tiktok.com/player/v1/6718335390845095173?autoplay=1",
         "https://www.tiktok.com/@/video/6718335390845095173"),
        ("https://m.tiktok.com/share/video/6718335390845095173/",
         "https://www.tiktok.com/@/video/6718335390845095173"),
        ("https://tiktok.com/v/6718335390845095173.html", "https://www.tiktok.com/@/video/6718335390845095173"),
        # Short links: unchanged but for https and the query string (yt-dlp follows the redirect).
        ("https://vm.tiktok.com/ZTR45GpSF/?_r=1", "https://vm.tiktok.com/ZTR45GpSF/"),
        ("https://VT.TikTok.com/ZSXjHUWbe", "https://vt.tiktok.com/ZSXjHUWbe"),
        ("https://www.tiktok.com/t/ZTRC5xgJp/?_t=8abc", "https://www.tiktok.com/t/ZTRC5xgJp/"),
        ("http://tiktok.com/T/ZTRC5xgJp", "https://www.tiktok.com/t/ZTRC5xgJp"),
    ],
)
def test_tiktok_normalization(url: str, expected: str) -> None:
    assert validate_media_url(url, ALLOWED).url == expected


@pytest.mark.parametrize(
    ("url", "code"),
    [
        # Lists (yt-dlp would extract every video of the profile / hashtag / sound).
        ("https://www.tiktok.com/@scout2015", "playlist_not_supported"),
        ("https://www.tiktok.com/@scout2015/", "playlist_not_supported"),
        ("https://www.tiktok.com/@scout2015?lang=fr", "playlist_not_supported"),
        ("https://www.tiktok.com/@scout2015/collection/Best-7123456789012345678", "playlist_not_supported"),
        ("https://www.tiktok.com/@scout2015/playlist/Mix-7123456789012345678", "playlist_not_supported"),
        ("https://www.tiktok.com/tag/funny", "playlist_not_supported"),
        ("https://www.tiktok.com/music/original-sound-6716591245678456622", "playlist_not_supported"),
        ("https://www.tiktok.com/sticker/Green-Screen-7123456", "playlist_not_supported"),
        # Lives.
        ("https://www.tiktok.com/live", "live_not_supported"),
        ("https://www.tiktok.com/@weathernewslive/live", "live_not_supported"),
        ("https://www.tiktok.com/@weathernewslive/live/", "live_not_supported"),
        ("https://m.tiktok.com/share/live/7210809319192726273", "live_not_supported"),
        # Photo slideshows.
        ("https://www.tiktok.com/@u/photo/7594147928399219990", "unsupported_content"),
        ("https://www.tiktok.com/@u/photo/7594147928399219990/", "unsupported_content"),
        # Anything else, home page included.
        ("https://www.tiktok.com/", "unsupported_url"),
        ("https://www.tiktok.com", "unsupported_url"),
        ("https://www.tiktok.com/?_r=1", "unsupported_url"),
        ("https://www.tiktok.com/foryou", "unsupported_url"),
        ("https://www.tiktok.com/explore", "unsupported_url"),
        ("https://www.tiktok.com/login", "unsupported_url"),
        ("https://www.tiktok.com/@a/video/abc", "unsupported_url"),
        ("https://www.tiktok.com/@a/video/6718335390845095173/extra", "unsupported_url"),
        ("https://www.tiktok.com/embed/6718335390845095173/video/1111111111111111111", "unsupported_url"),
        ("https://www.tiktok.com/t/", "unsupported_url"),
        ("https://vm.tiktok.com/", "unsupported_url"),
        ("https://vm.tiktok.com/ZTR45GpSF/extra", "unsupported_url"),
        ("https://vt.tiktok.com/@a/video/6718335390845095173", "unsupported_url"),
    ],
)
def test_tiktok_non_videos_rejected_before_any_worker(url: str, code: str) -> None:
    with pytest.raises(ApiError) as excinfo:
        validate_media_url(url, ALLOWED)
    assert (excinfo.value.status, excinfo.value.code) == (400, code)


@pytest.mark.parametrize(
    "url",
    [
        "https://www.tiktok.com/@scout2015/video/6718335390845095173?_r=1",
        "https://www.tiktok.com/embed/v2/6718335390845095173",
        "https://www.tiktok.com/player/v1/6718335390845095173",
        "https://m.tiktok.com/v/6718335390845095173.html",
    ],
)
def test_tiktok_video_aliases_share_one_cache_key(url: str) -> None:
    assert media_key(validate_media_url(url, ALLOWED)) == "tiktok:6718335390845095173"


def test_tiktok_slideshow_rejected_early() -> None:
    with pytest.raises(ApiError) as excinfo:
        validate_media_url("https://www.tiktok.com/@u/photo/7594147928399219990", ALLOWED)
    assert excinfo.value.code == "unsupported_content"


@pytest.mark.parametrize(
    ("url", "extractor"),
    [
        ("https://tiktok.com/@scout2015/video/6718335390845095173?_r=1", "TikTok"),
        ("https://www.tiktok.com/@the.user_1/Video/6718335390845095173/", "TikTok"),
        ("https://www.tiktok.com/embed/v2/6718335390845095173", "TikTok"),
        ("https://www.tiktok.com/player/v1/6718335390845095173", "TikTok"),
        ("https://m.tiktok.com/share/video/6718335390845095173", "TikTok"),
        ("https://m.tiktok.com/v/6718335390845095173.html", "TikTok"),
        ("https://vm.tiktok.com/ZTR45GpSF/", "TikTokVM"),
        ("https://vt.tiktok.com/ZSXjHUWbe", "TikTokVM"),
        ("http://tiktok.com/T/ZTRC5xgJp", "TikTokVM"),
    ],
)
def test_normalized_tiktok_links_reach_the_single_video_extractors(url: str, extractor: str) -> None:
    """Offline (URL regexes only): what we accept is exactly what yt-dlp's allowed TikTok extractors take."""
    import yt_dlp

    from app.worker import PLATFORM_EXTRACTORS

    normalized = validate_media_url(url, ALLOWED).url
    ydl = yt_dlp.YoutubeDL({"allowed_extractors": PLATFORM_EXTRACTORS["tiktok"], "quiet": True})
    suitable = [key for key, ie in ydl._ies.items() if ie.suitable(normalized)]
    assert suitable == [extractor], (normalized, suitable)
