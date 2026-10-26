"""YouTube Music (music.youtube.com) est FERMÉ au convertisseur (décision du propriétaire, 2026-10-23).

Refus clair, en français, avec un code stable (`youtube_music_not_accepted`), décidé avant tout travail : aucun worker,
aucune unité de quota, aucune requête réseau. Les liens YouTube classiques (youtube.com, m.youtube.com, youtu.be,
Shorts) restent acceptés EXACTEMENT comme avant : les valeurs attendues ci-dessous ont été relevées avec l'ancien code
(commit f9aa2ba) avant le changement.
"""

from __future__ import annotations

import socket
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import worker
from app.config import DEFAULT_ALLOWED_DOMAINS, ConfigError, parse_domains
from app.errors import USER_TEXT, ApiError
from app.urls import (
    YOUTUBE_MUSIC_CODE,
    detect_platform,
    host_matches,
    is_youtube_music_host,
    is_youtube_music_url,
    validate_media_url,
)
from tests.conftest import TOKEN, FakeWorker
from tests.test_user_keys import INTERNAL, KEY_A, FakeAccount, bearer

ALLOWED = parse_domains(DEFAULT_ALLOWED_DOMAINS)
CODE = "youtube_music_not_accepted"
MESSAGE = "Les liens YouTube Music ne sont pas acceptés : AETHRYON ne télécharge pas le catalogue musical commercial."
VID = "jNQXAC9IVRw"

# --- liens YouTube Music, sous toutes leurs formes ---------------------------------------------------------------

MUSIC_LINKS = [
    # hôte principal, chemins de YouTube Music
    f"https://music.youtube.com/watch?v={VID}",
    f"https://music.youtube.com/watch?v={VID}&list=RDAMVM{VID}",
    f"https://music.youtube.com/watch?v={VID}&si=abcdef",
    f"http://music.youtube.com/watch?v={VID}",
    "https://music.youtube.com/playlist?list=PLx",
    "https://music.youtube.com/watch?list=PLx",
    "https://music.youtube.com/browse/MPREb_abc123",
    "https://music.youtube.com/browse/VL1",
    "https://music.youtube.com/channel/UC1234567890abcdefghij",
    "https://music.youtube.com/search?q=daft+punk",
    "https://music.youtube.com/library",
    "https://music.youtube.com/",
    "https://music.youtube.com",
    # majuscules, point final, port, identifiants, espaces
    f"https://MUSIC.YOUTUBE.COM/watch?v={VID}",
    f"https://Music.YouTube.com/watch?v={VID}",
    f"https://music.youtube.com./watch?v={VID}",
    f"https://music.youtube.com../watch?v={VID}",
    f"https://music.youtube.com:443/watch?v={VID}",
    f"http://music.youtube.com:80/watch?v={VID}",
    f"https://music.youtube.com:8443/watch?v={VID}",
    f"https://user:secret@music.youtube.com/watch?v={VID}",
    f"https://elsewhere.example@music.youtube.com/watch?v={VID}",
    f"  https://music.youtube.com/watch?v={VID}  ",
    # sans schéma, relatif au protocole, autre schéma (le refus reste celui de YouTube Music)
    f"music.youtube.com/watch?v={VID}",
    f"//music.youtube.com/watch?v={VID}",
    f"ftp://music.youtube.com/watch?v={VID}",
    # sous-domaines de music.youtube.com
    f"https://www.music.youtube.com/watch?v={VID}",
    f"https://m.music.youtube.com/watch?v={VID}",
    f"https://a.b.music.youtube.com/watch?v={VID}",
    # autres noms de YouTube Music
    f"https://music.youtu.be/{VID}",
    f"https://music.youtube-nocookie.com/embed/{VID}",
    "https://youtubemusic.com/",
    "https://www.youtubemusic.com/watch",
    # redirections de YouTube qui désignent un lien YouTube Music (jamais suivies : seul le message change)
    f"https://www.youtube.com/redirect?q=https%3A%2F%2Fmusic.youtube.com%2Fwatch%3Fv%3D{VID}&event=video_description",
    f"https://youtube.com/redirect?redir_token=x&q=https%253A%252F%252Fmusic.youtube.com%252Fwatch%253Fv%253D{VID}",
    f"https://m.youtube.com/redirect?q=//music.youtube.com/watch?v={VID}",
    f"https://www.youtube.com/redirect?q=music.youtube.com%2Fwatch%3Fv%3D{VID}",
    f"https://www.youtube.com/attribution_link?a=x&u=https%3A%2F%2Fmusic.youtube.com%2Fwatch%3Fv%3D{VID}",
    "https://www.youtube.com/redirect?q=https%3A%2F%2Fmusic.youtube.com%2F",
]


def refusal(url: str) -> ApiError:
    with pytest.raises(ApiError) as excinfo:
        validate_media_url(url, ALLOWED)
    return excinfo.value


@pytest.fixture
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """Prouve « avant tout travail » : la moindre résolution de nom ou connexion fait échouer l'essai."""
    def forbidden(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("accès réseau pendant le refus d'un lien YouTube Music")
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)
    monkeypatch.setattr(socket.socket, "connect", forbidden)


@pytest.mark.parametrize("url", MUSIC_LINKS)
def test_youtube_music_links_are_refused_with_the_stable_code(url: str, no_network: None) -> None:
    error = refusal(url)
    assert (error.status, error.code, error.detail) == (400, CODE, MESSAGE)


def test_the_refusal_text_is_the_one_of_docs_erreurs() -> None:
    assert YOUTUBE_MUSIC_CODE == CODE and USER_TEXT[CODE] == MESSAGE


@pytest.mark.parametrize(("host", "expected"), [
    ("music.youtube.com", True), ("MUSIC.YouTube.com", True), ("music.youtube.com.", True),
    ("www.music.youtube.com", True), ("m.music.youtube.com", True), ("music.youtu.be", True),
    ("youtubemusic.com", True), ("www.youtubemusic.com", True),
    # frontière d'étiquette : ce n'est pas YouTube Music
    ("notmusic.youtube.com", False), ("mymusic.youtube.com", False), ("xmusic.youtube.com", False),
    ("youtube.com", False), ("www.youtube.com", False), ("m.youtube.com", False), ("youtu.be", False),
    ("music.example.com", False), ("music.youtube.com.evil.example", False), ("", False),
])
def test_music_host_detection_respects_label_boundaries(host: str, expected: bool) -> None:
    assert is_youtube_music_host(host) is expected


def test_music_link_detection_never_raises_on_garbage() -> None:
    for junk in ("", " ", "://", "https://[::1", "https://[music.youtube.com", "\x00", "http://:80", "a" * 5000,
                 "https://music.youtube.com:notaport/x"):
        assert isinstance(is_youtube_music_url(junk), bool)
    assert is_youtube_music_url("https://music.youtube.com:notaport/x") is True  # le port invalide ne masque pas l'hôte


def test_the_platform_of_music_hosts_is_not_youtube_so_every_layer_fails_closed() -> None:
    assert detect_platform("music.youtube.com") == "other"
    assert detect_platform("m.music.youtube.com") == "other"
    assert detect_platform("www.youtube.com") == "youtube"
    assert detect_platform("notmusic.youtube.com") == "youtube"
    assert host_matches("music.youtube.com", "youtube.com")  # c'est bien le test d'hôte, plus la plateforme, qui ferme


@pytest.mark.parametrize("domains", ["music.youtube.com", "youtube.com,music.youtube.com", "tiktok.com,m.music.youtube.com"])
def test_music_domains_cannot_be_allowed_by_configuration(domains: str) -> None:
    with pytest.raises(ConfigError, match="YouTube Music"):
        parse_domains(domains)


# --- les liens classiques ne bougent pas -----------------------------------------------------------------------------

# (lien, url normalisée, hôte, plateforme, index de média) : relevé avec l'ANCIEN code, avant le changement.
CLASSIC_BEFORE = [
    ("https://www.youtube.com/watch?v=jNQXAC9IVRw", "https://www.youtube.com/watch?v=jNQXAC9IVRw", "www.youtube.com", "youtube", None),
    ("https://youtube.com/watch?v=jNQXAC9IVRw&t=10s", "https://youtube.com/watch?v=jNQXAC9IVRw&t=10s", "youtube.com", "youtube", None),
    ("https://m.youtube.com/watch?v=jNQXAC9IVRw", "https://m.youtube.com/watch?v=jNQXAC9IVRw", "m.youtube.com", "youtube", None),
    ("http://www.youtube.com/watch?v=jNQXAC9IVRw", "http://www.youtube.com/watch?v=jNQXAC9IVRw", "www.youtube.com", "youtube", None),
    ("https://WWW.YouTube.COM/watch?v=jNQXAC9IVRw", "https://www.youtube.com/watch?v=jNQXAC9IVRw", "www.youtube.com", "youtube", None),
    ("https://www.youtube.com:443/watch?v=jNQXAC9IVRw", "https://www.youtube.com:443/watch?v=jNQXAC9IVRw", "www.youtube.com", "youtube", None),
    ("https://youtu.be/jNQXAC9IVRw", "https://youtu.be/jNQXAC9IVRw", "youtu.be", "youtube", None),
    ("https://youtu.be/jNQXAC9IVRw?si=abc", "https://youtu.be/jNQXAC9IVRw?si=abc", "youtu.be", "youtube", None),
    ("https://youtu.be/jNQXAC9IVRw?list=PLx", "https://youtu.be/jNQXAC9IVRw?list=PLx", "youtu.be", "youtube", None),
    ("https://www.youtube.com/shorts/18NGQq7p3LY", "https://www.youtube.com/shorts/18NGQq7p3LY", "www.youtube.com", "youtube", None),
    ("https://m.youtube.com/shorts/18NGQq7p3LY?feature=share", "https://m.youtube.com/shorts/18NGQq7p3LY?feature=share", "m.youtube.com", "youtube", None),
    ("https://www.youtube.com/live/abcdefghijk", "https://www.youtube.com/live/abcdefghijk", "www.youtube.com", "youtube", None),
    ("https://www.youtube.com/embed/jNQXAC9IVRw", "https://www.youtube.com/embed/jNQXAC9IVRw", "www.youtube.com", "youtube", None),
    ("https://www.youtube-nocookie.com/embed/jNQXAC9IVRw", "https://www.youtube-nocookie.com/embed/jNQXAC9IVRw", "www.youtube-nocookie.com", "youtube", None),
    ("https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PLx&index=3", "https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PLx&index=3", "www.youtube.com", "youtube", None),
    # mots proches de « music » sans être YouTube Music : inchangés
    ("https://www.youtube.com/watch?v=jNQXAC9IVRw&list=RDAMVMjNQXAC9IVRw", "https://www.youtube.com/watch?v=jNQXAC9IVRw&list=RDAMVMjNQXAC9IVRw", "www.youtube.com", "youtube", None),
    ("https://www.youtube.com/watch?v=jNQXAC9IVRw&feature=music", "https://www.youtube.com/watch?v=jNQXAC9IVRw&feature=music", "www.youtube.com", "youtube", None),
    ("https://notmusic.youtube.com/watch?v=jNQXAC9IVRw", "https://notmusic.youtube.com/watch?v=jNQXAC9IVRw", "notmusic.youtube.com", "youtube", None),
    # TikTok et X : inchangés
    ("https://www.tiktok.com/@scout2015/video/6718335390845095173", "https://www.tiktok.com/@scout2015/video/6718335390845095173", "www.tiktok.com", "tiktok", None),
    ("https://vm.tiktok.com/ZTR45GpSF/", "https://vm.tiktok.com/ZTR45GpSF/", "vm.tiktok.com", "tiktok", None),
    ("https://x.com/historyinmemes/status/1790637656616943991", "https://x.com/historyinmemes/status/1790637656616943991", "x.com", "twitter", None),
    ("https://twitter.com/historyinmemes/status/1790637656616943991/video/2", "https://twitter.com/historyinmemes/status/1790637656616943991", "twitter.com", "twitter", 2),
]


@pytest.mark.parametrize(("url", "normalized", "host", "platform", "index"), CLASSIC_BEFORE)
def test_classic_links_are_accepted_exactly_as_before(url: str, normalized: str, host: str, platform: str,
                                                      index: int | None, no_network: None) -> None:
    media = validate_media_url(url, ALLOWED)
    assert (media.url, media.host, media.platform, media.media_index) == (normalized, host, platform, index)
    assert is_youtube_music_url(url) is False


@pytest.mark.parametrize(("url", "code"), [
    # un lien YouTube qui n'est pas une vidéo garde son refus d'avant (pas de faux « YouTube Music »)
    ("https://www.youtube.com/playlist?list=PLx", "playlist_not_supported"),
    ("https://www.youtube.com/@chan/videos", "playlist_not_supported"),
    ("https://www.youtube.com/redirect?q=https%3A%2F%2Fexample.com%2F", "playlist_not_supported"),
    ("https://www.youtube.com/attribution_link?a=x&u=%2Fwatch%3Fv%3DjNQXAC9IVRw", "playlist_not_supported"),
    # liens raccourcis d'autres services : jamais suivis, refusés sur leur seul domaine (aucun réseau)
    ("https://bit.ly/3xyz", "domain_not_allowed"),
    ("https://youtube.app.goo.gl/abc", "domain_not_allowed"),
    ("https://g.co/kgs/x", "domain_not_allowed"),
    ("https://t.co/abc", "domain_not_allowed"),
    ("https://example.com/redirect?q=https%3A%2F%2Fmusic.youtube.com%2Fwatch%3Fv%3DjNQXAC9IVRw", "domain_not_allowed"),
])
def test_other_refusals_keep_their_code_and_nothing_is_followed(url: str, code: str, no_network: None) -> None:
    assert refusal(url).code == code


# --- à travers l'API : refus avant tout travail ---------------------------------------------------------------------

AUTH = {"Authorization": f"Bearer {TOKEN}"}
API_LINKS = [
    f"https://music.youtube.com/watch?v={VID}",
    f"https://MUSIC.YOUTUBE.COM/watch?v={VID}",
    f"https://m.music.youtube.com/watch?v={VID}",
    "https://music.youtube.com/playlist?list=PLx",
    f"https://www.youtube.com/redirect?q=https%3A%2F%2Fmusic.youtube.com%2Fwatch%3Fv%3D{VID}",
]


def test_every_entry_point_refuses_before_any_worker(make_client: Callable[..., TestClient], fake_worker: FakeWorker) -> None:
    client = make_client(media_tools_enabled=True)
    for url in API_LINKS:
        for call in (
            lambda u=url: client.post("/jobs", json={"url": u, "fmt": "mp4"}, headers=AUTH),
            lambda u=url: client.post("/jobs?wait=5", json={"url": u, "fmt": "mp3"}, headers=AUTH),
            lambda u=url: client.get("/dl", params={"url": u, "fmt": "mp4"}, headers=AUTH),
            lambda u=url: client.get("/info", params={"url": u}, headers=AUTH),
            lambda u=url: client.post("/preview", json={"url": u}, headers=AUTH),
            lambda u=url: client.post("/jobs", json={"url": u, "fmt": "mp4", "start_s": 1, "end_s": 5}, headers=AUTH),
        ):
            r = call()
            assert r.status_code == 400, (url, r.status_code, r.text)
            assert r.json() == {"error": CODE, "detail": MESSAGE}, (url, r.text)
    assert fake_worker.calls == []  # aucun worker lancé


def test_a_classic_link_still_creates_its_job(make_client: Callable[..., TestClient], fake_worker: FakeWorker) -> None:
    client = make_client()
    for url in (f"https://www.youtube.com/watch?v={VID}", f"https://youtu.be/{VID}", "https://www.youtube.com/shorts/18NGQq7p3LY"):
        r = client.post("/jobs", json={"url": url, "fmt": "mp4"}, headers=AUTH)
        assert r.status_code == 202, (url, r.text)


@pytest.fixture
def account() -> Iterator[FakeAccount]:
    fake = FakeAccount()
    fake.url = fake.start()  # type: ignore[attr-defined]
    yield fake
    fake.stop()


def test_a_personal_key_gets_the_same_text_and_loses_no_quota(
        make_client: Callable[..., TestClient], fake_worker: FakeWorker, account: FakeAccount, tmp_path: Path) -> None:
    token_file = tmp_path / "account_internal_token"
    token_file.write_text(INTERNAL)
    client = make_client(user_keys_enabled=True, account_internal_url=account.url,  # type: ignore[attr-defined]
                         account_internal_token_file=token_file, user_key_cache_s=0.0, media_tools_enabled=True,
                         tools_enabled=True)
    for url in API_LINKS:
        r = client.post("/jobs", json={"url": url, "fmt": "mp3"}, headers=bearer(KEY_A))
        assert r.status_code == 400 and r.json() == {"error": CODE, "detail": MESSAGE}, (url, r.text)
        r = client.post("/preview", json={"url": url}, headers=bearer(KEY_A))
        assert r.status_code == 400 and r.json()["error"] == CODE, (url, r.text)
    assert fake_worker.calls == []
    assert account.creates() == 0 and account.used == {}  # aucune unité de quota consommée, aucun job ouvert côté compte
    assert client.get("/jobs", headers=bearer(KEY_A)).json()["jobs"] == []  # aucun job créé
    r = client.post("/jobs", json={"url": f"https://youtu.be/{VID}", "fmt": "mp3"}, headers=bearer(KEY_A))
    assert r.status_code == 202 and account.creates() == 1  # un lien classique passe toujours par le compte et son quota


# --- défense en profondeur dans le worker ---------------------------------------------------------------------------

class SpyYdl:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def extract_info(self, url: str, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(url)
        raise AssertionError("yt-dlp ne doit jamais voir un lien YouTube Music")


@pytest.mark.parametrize("url", [f"https://music.youtube.com/watch?v={VID}", f"https://m.music.youtube.com/watch?v={VID}",
                                 f"https://MUSIC.YOUTUBE.COM./watch?v={VID}"])
def test_the_worker_refuses_a_music_url_even_if_validation_were_bypassed(url: str) -> None:
    ydl = SpyYdl()
    with pytest.raises(ApiError) as excinfo:
        worker._extract(ydl, url, "youtube")  # type: ignore[arg-type]
    assert (excinfo.value.status, excinfo.value.code, excinfo.value.detail) == (400, CODE, MESSAGE)
    assert ydl.calls == []


def test_a_platform_unknown_to_the_worker_still_never_runs_yt_dlp(tmp_path: Path) -> None:
    with pytest.raises(ApiError) as excinfo:
        worker.base_options({"max_filesize_bytes": 1}, tmp_path, detect_platform("music.youtube.com"))
    assert excinfo.value.code == "domain_not_allowed"
