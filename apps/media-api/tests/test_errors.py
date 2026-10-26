"""yt-dlp message -> HTTP error mapping (messages observed live on 2026-10-07 or quoted from source)."""

import pytest
from fastapi.testclient import TestClient

from app.errors import ApiError, map_ytdlp_error


@pytest.mark.parametrize(
    ("message", "platform", "status", "code"),
    [
        ("ERROR: [youtube] GdtIKYTcdQw: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies",
         "youtube", 503, "bot_check"),
        ("ERROR: [youtube] x: Sign in to confirm you're not a bot", "youtube", 503, "bot_check"),
        ("ERROR: [youtube] yZIXLfi8CZQ: Private video", "youtube", 403, "private"),
        ("ERROR: [youtube] aaaaaaaaaaa: This video is unavailable", "youtube", 404, "not_found"),
        ("ERROR: [youtube] sJL6WA-aGkQ: Video unavailable", "youtube", 404, "not_found"),
        ("ERROR: [youtube] Tq92D6wQ1mg: Sign in to confirm your age. Use --cookies-from-browser or --cookies",
         "youtube", 403, "age_restricted"),
        ("ERROR: [youtube] RomFraj-AtY: This video is available to this channel's members on level: X. "
         "Join this channel to get access to members-only content", "youtube", 403, "members_only"),
        ("ERROR: [youtube] x: The uploader has not made this video available in your country",
         "youtube", 403, "geo_restricted"),
        ("ERROR: [youtube] x: This live event will begin in 3 hours.", "youtube", 400, "live_not_supported"),
        ("ERROR: [youtube] x: Requested format is not available. Use --list-formats", "youtube", 422,
         "format_unavailable"),
        ("ERROR: [youtube] x: This content isn't available, try again later. The current session has been "
         "rate-limited by YouTube for up to an hour.", "youtube", 503, "upstream_rate_limited"),
        ("ERROR: Unsupported URL: https://www.youtube.com/feed/trending", "youtube", 400, "unsupported_url"),
        ("ERROR: No suitable extractor found for URL https://www.youtube.com/xyz", "youtube", 400, "unsupported_url"),
        ("ERROR: [twitter] 1575199173472927762: No video could be found in this tweet", "twitter", 404, "no_video"),
        ("ERROR: Unsupported URL: https://swordshield.pokemon.com/en-us/", "twitter", 404, "no_video"),
        ("ERROR: [twitter] 1: NSFW tweet requires authentication", "twitter", 403, "login_required"),
        ("ERROR: [twitter] 1: You are not authorized to view this protected tweet", "twitter", 403, "private"),
        # TikTok 10204 (status_deleted from this server): deleted OR blocked in the server's country.
        ("ERROR: [TikTok] 6748451240264420610: Your IP address is blocked from accessing this post",
         "tiktok", 404, "unavailable"),
        ("ERROR: Unsupported URL: https://www.tiktok.com/@/photo/7508442021644782866?x=1", "tiktok", 400,
         "unsupported_content"),
        ("ERROR: Unsupported URL: https://www.tiktok.com/?_r=1", "tiktok", 502, "short_link_unresolved"),
        ("ERROR: No suitable extractor found for URL https://www.tiktok.com/?_r=1", "tiktok", 502,
         "short_link_unresolved"),
        # yt-dlp's wording of TikTok statuses 10216 (private post) and 10222 (private account).
        ("ERROR: [TikTok] 1: You do not have permission to view this post. Log into an account that has access",
         "tiktok", 403, "private"),
        ("ERROR: [TikTok] 1: Unexpected response from webpage request; please report this issue", "tiktok", 502,
         "extractor_broken"),
        ("ERROR: [TikTok] 1: Unable to extract universal data for rehydration", "tiktok", 502, "extractor_broken"),
        ("ERROR: unable to download video data: <urlopen error timed out>", "youtube", 504, "upstream_timeout"),
        ("ERROR: something totally new", "youtube", 502, "upstream_error"),
        ("\x1b[0;31mERROR:\x1b[0m [youtube] x: Private video", "youtube", 403, "private"),
    ],
)
def test_mapping(message: str, platform: str, status: int, code: str) -> None:
    err = map_ytdlp_error(message, platform)
    assert (err.status, err.code) == (status, code)
    assert "Traceback" not in err.detail and "ERROR" not in err.detail


@pytest.mark.parametrize(
    ("message", "platform", "status", "code"),
    [
        # The stream vanished after a successful extraction: a download failure, not a deleted video.
        ("ERROR: unable to download video data: HTTP Error 404: Not Found", "youtube", 502, "download_failed"),
        ("ERROR: unable to download video data: HTTP Error 410: Gone", "youtube", 502, "download_failed"),
        ("ERROR: [youtube] x: Unable to download webpage: HTTP Error 404: Not Found", "youtube", 404, "not_found"),
        # Server-side failures are never blamed on the platform.
        ("ERROR: Postprocessing: ffprobe and ffmpeg not found. Please install or provide the path using "
         "--ffmpeg-location", "youtube", 500, "conversion_failed"),
        ("ERROR: Postprocessing: Error opening output files: Encoder not found", "youtube", 500,
         "conversion_failed"),
        ("ERROR: Postprocessing: Option not found", "tiktok", 500, "conversion_failed"),
        ("ERROR: ffmpeg not found. Please install or provide the path using --ffmpeg-location", "youtube", 500,
         "conversion_failed"),
        ("ERROR: Postprocessing: WARNING: unable to obtain file audio codec with ffprobe", "youtube", 400,
         "no_audio"),
        ("ERROR: unable to write data: [Errno 28] No space left on device", "youtube", 503, "insufficient_storage"),
        ("ERROR: Postprocessing: [Errno 28] No space left on device", "tiktok", 503, "insufficient_storage"),
        ("ERROR: unable to write data: [Errno 13] Permission denied: '/data/tmp/x.part'", "youtube", 500,
         "internal_error"),
        ("ERROR: unable to open for writing: [Errno 2] No such file or directory: 'x.part'", "youtube", 500,
         "internal_error"),
        ("ERROR: unable to rename file: [Errno 18] Invalid cross-device link", "youtube", 500, "internal_error"),
        ("ERROR: [youtube] x: No supported JavaScript runtime could be found. Only deno is enabled by default",
         "youtube", 500, "internal_error"),
        # A cut TLS stream is not "terminated account" (the old bare "terminated" said not_found).
        ("ERROR: unable to download video data: TLS connection was non-properly terminated", "youtube", 502,
         "download_failed"),
        ("ERROR: [youtube] x: This account has been terminated because we received multiple third-party "
         "claims of copyright infringement", "youtube", 404, "not_found"),
        ("ERROR: [youtube] x: This video is no longer available because the YouTube account associated with "
         "this video has been terminated.", "youtube", 404, "not_found"),
        ("ERROR: [twitter] 1: User not found.", "twitter", 404, "not_found"),
        ("ERROR: [youtube] x: Some unknown thing not found", "youtube", 502, "upstream_error"),
        # TikTok statuses: never "not found" (10204 is also the regional block of this server).
        ("ERROR: [TikTok] 7: Video not available, status code 10101", "tiktok", 404, "unavailable"),
        ("ERROR: [TikTok] 7404412345678901234: Video not available, status code 0", "tiktok", 404, "unavailable"),
        # Platform 5xx: temporary, not a deleted video.
        ("ERROR: unable to download video data: HTTP Error 503: Service Unavailable", "youtube", 503,
         "upstream_unavailable"),
        ("ERROR: [TikTok] 1: Unable to download webpage: HTTP Error 502: Bad Gateway", "tiktok", 503,
         "upstream_unavailable"),
        ("ERROR: [youtube] x: Only images are available for download. use --list-formats to see them", "youtube",
         400, "unsupported_content"),
        # 403 on the page and on the stream: same code.
        ("ERROR: [youtube] x: Unable to download webpage: HTTP Error 403: Forbidden (caused by <HTTPError 403: "
         "Forbidden>)", "youtube", 502, "upstream_forbidden"),
        ("ERROR: unable to download video data: HTTP Error 403: Forbidden", "tiktok", 502, "upstream_forbidden"),
    ],
)
def test_classification_rules(message: str, platform: str, status: int, code: str) -> None:
    err = map_ytdlp_error(message, platform)
    assert (err.status, err.code) == (status, code), err.detail


def test_tiktok_status_details_name_the_status() -> None:
    blocked = map_ytdlp_error("ERROR: [TikTok] 6748451240264420610: Your IP address is blocked from accessing "
                              "this post", "tiktok")
    assert blocked.detail == ("TikTok ne fournit pas ce post au serveur (statut 10204 : supprimé, masqué ou bloqué "
                              "dans le pays du serveur).")
    other = map_ytdlp_error("ERROR: [TikTok] 7: Video not available, status code 10101", "tiktok")
    assert other.code == "unavailable" and "statut 10101" in other.detail
    assert "introuvable" not in blocked.detail + other.detail


def test_page_and_media_403_have_distinct_details() -> None:
    page = map_ytdlp_error("ERROR: [youtube] x: Unable to download webpage: HTTP Error 403: Forbidden", "youtube")
    media = map_ytdlp_error("ERROR: unable to download video data: HTTP Error 403: Forbidden", "youtube")
    assert page.code == media.code == "upstream_forbidden"
    assert page.detail == "La plateforme refuse la page au serveur (HTTP 403)."
    assert media.detail == "La plateforme refuse le flux du média (HTTP 403), même après repli sur un autre client."
    # Only YouTube has several clients to fall back to.
    tiktok = map_ytdlp_error("ERROR: unable to download video data: HTTP Error 403: Forbidden", "tiktok")
    assert tiktok.detail == "La plateforme refuse le flux du média (HTTP 403)."


@pytest.mark.parametrize(
    "message",
    [
        "ERROR: Unsupported URL: https://vm.tiktok.com/ZTR45GpSF/",  # TikTokVMIE: redirect to itself
        "ERROR: Unsupported URL: https://vt.tiktok.com/ZSXjHUWbe",
        "ERROR: Unsupported URL: https://www.tiktok.com/t/ZTRC5xgJp/",
        "ERROR: Unsupported URL: https://www.tiktok.com/",
        "ERROR: Unsupported URL: https://www.tiktok.com",
        "ERROR: Unsupported URL: https://www.tiktok.com/?_r=1&_t=8abc",
        "ERROR: Unsupported URL: https://www.tiktok.com/login?redirect_url=https%3A%2F%2Fwww.tiktok.com%2F",
        "ERROR: Unsupported URL: https://www.tiktok.com/foryou?lang=fr",
        "ERROR: Unsupported URL: https://m.tiktok.com/explore",
        # allowed_extractors is set: yt-dlp then says "No suitable extractor", sometimes with the IE name.
        "ERROR: No suitable extractor found for URL https://www.tiktok.com/?_r=1",
        "ERROR: No suitable extractor (TikTok) found for URL https://www.tiktok.com/login",
    ],
)
def test_tiktok_short_link_unresolved(message: str) -> None:
    err = map_ytdlp_error(message, "tiktok")
    assert (err.status, err.code) == (502, "short_link_unresolved")


@pytest.mark.parametrize(
    ("message", "code"),
    [
        # A short link that leads to something else than a video: same answer as for the full link.
        ("ERROR: Unsupported URL: https://www.tiktok.com/@u/photo/7508442021644782866", "unsupported_content"),
        ("ERROR: No suitable extractor found for URL https://www.tiktok.com/@u?_t=8abc&_r=1",
         "playlist_not_supported"),
        ("ERROR: No suitable extractor found for URL https://www.tiktok.com/music/son-original-6716591245678456622",
         "playlist_not_supported"),
        ("ERROR: Unsupported URL: https://www.tiktok.com/@u/live", "live_not_supported"),
        ("ERROR: Unsupported URL: https://www.tiktok.com/some/other/page", "short_link_unresolved"),  # only short links reach yt-dlp
        ("ERROR: Unsupported URL: https://www.tiktok.example/", "unsupported_url"),
    ],
)
def test_other_tiktok_unsupported_urls(message: str, code: str) -> None:
    assert map_ytdlp_error(message, "tiktok").code == code


def test_short_link_rule_is_tiktok_only() -> None:
    assert map_ytdlp_error("ERROR: Unsupported URL: https://www.tiktok.com/", "youtube").code == "unsupported_url"


@pytest.mark.parametrize("platform", ["tiktok", "twitter"])
def test_login_required_never_suggests_cookies_outside_youtube(platform: str) -> None:
    message = {"tiktok": "ERROR: [TikTok] 1: This post may not be comfortable for some audiences. Log in for "
                         "access. Use --cookies-from-browser or --cookies for the authentication.",
               "twitter": "ERROR: [twitter] 1: NSFW tweet requires authentication"}[platform]
    err = map_ytdlp_error(message, platform)
    assert err.code == "login_required"
    assert "cookie" not in err.detail.lower()
    assert ("TikTok" if platform == "tiktok" else "X ") in err.detail


def test_login_and_age_hints_keep_cookies_for_youtube() -> None:
    login = map_ytdlp_error("ERROR: [youtube] x: This video requires login", "youtube")
    age = map_ytdlp_error("ERROR: [youtube] x: Sign in to confirm your age. Use --cookies", "youtube")
    assert (login.code, age.code) == ("login_required", "age_restricted")
    assert "cookies" in login.detail and "cookies" in age.detail
    assert "cookies" not in map_ytdlp_error("ERROR: [twitter] 1: Age-restricted adult content", "twitter").detail


def test_geo_flag_wins() -> None:
    assert map_ytdlp_error("whatever", "youtube", geo=True).code == "geo_restricted"


def test_bot_check_hint_mentions_cookies() -> None:
    assert "cookies" in map_ytdlp_error("Sign in to confirm you're not a bot").detail.lower()


def test_api_error_roundtrip() -> None:
    err = ApiError(429, "rate_limited", "slow down", {"Retry-After": "3"})
    assert ApiError.from_dict(err.to_dict()) == err


def test_worker_errors_are_uniform_json(client: TestClient, fake_worker, auth) -> None:
    fake_worker.error = ApiError(502, "upstream_error", "La plateforme a refusé.")
    res = client.get("/dl", params={"url": "https://www.tiktok.com/@a/video/7234567890123456789"}, headers=auth)
    assert res.status_code == 502
    assert res.json() == {"error": "upstream_error", "detail": "La plateforme a refusé."}
    # A YouTube block opens the breaker: the detail says how long the pause lasts.
    fake_worker.error = ApiError(503, "bot_check", "YouTube asks to confirm you're not a bot.")
    res = client.get("/dl", params={"url": "https://youtu.be/jNQXAC9IVRw"}, headers=auth)
    assert res.status_code == 503 and res.headers["Retry-After"] == "900"
    assert res.json()["error"] == "bot_check" and "~15 min" in res.json()["detail"]


def test_unhandled_exception_is_500_without_stacktrace(client: TestClient, fake_worker, auth) -> None:
    fake_worker.error = RuntimeError("secret internal detail")  # type: ignore[assignment]
    client_no_raise = TestClient(client.app, raise_server_exceptions=False)
    res = client_no_raise.get("/info", params={"url": "https://youtu.be/jNQXAC9IVRw"}, headers=auth)
    assert res.status_code == 500
    assert res.json() == {"error": "internal_error", "detail": "Erreur interne du serveur (voir les logs)."}
    assert "secret" not in res.text


@pytest.mark.parametrize(
    ("method", "path", "status", "code"),
    [("GET", "/nope", 404, "not_found"), ("PUT", "/health", 405, "method_not_allowed")],
)
def test_framework_errors_are_uniform(client: TestClient, method: str, path: str, status: int, code: str) -> None:
    res = client.request(method, path)
    assert res.status_code == status
    assert res.json()["error"] == code
    assert set(res.json()) == {"error", "detail"}


@pytest.mark.parametrize(
    ("query", "fragment"),
    [
        ({"fmt": "avi"}, "fmt"),
        ({"quality": "999"}, "quality"),
        ({"bitrate": "256"}, "bitrate"),
        ({"fmt": "gif", "gif_width": "5000"}, "gif_width"),
        ({"fmt": "gif", "gif_fps": "0"}, "gif_fps"),
        ({"index": "0"}, "index"),
        ({"transcode": "maybe"}, "transcode"),
    ],
)
def test_invalid_parameters_are_400(client: TestClient, auth, query: dict[str, str], fragment: str) -> None:
    res = client.get("/dl", params={"url": "https://youtu.be/x", **query}, headers=auth)
    assert res.status_code == 400
    assert res.json()["error"] == "invalid_parameter"
    assert fragment in res.json()["detail"]
