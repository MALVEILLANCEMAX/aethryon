"""Registre unique des plateformes (app/plateformes.json) : détection, refus, plateformes bêta, disjoncteur, formats
proposés d'après les métadonnées, vue publique GET /platforms. Aucune requête réseau."""

from __future__ import annotations

import re
import time
from pathlib import Path

import pytest
import yt_dlp
from fastapi.testclient import TestClient

from app.config import DEFAULT_ALLOWED_DOMAINS, ConfigError, enabled_platforms, parse_beta_platforms, parse_domains
from app.errors import USER_TEXT, ApiError, map_ytdlp_error
from app.platforms import PlatformMonitor
from app.registre import CATEGORIES, FORMATS, formats_proposes, parse_registry, registre
from app.urls import check_extractor_shape, check_platform_format, detect_platform, validate_media_url
from app.worker import PLATFORM_EXTRACTORS, base_options

OFFICIAL = parse_domains(DEFAULT_ALLOWED_DOMAINS)
REG = registre()
NEW = [p for p in REG.plateformes if p.telechargeable and p.id not in ("youtube", "tiktok", "twitter")]


def _err(url: str, allowed: tuple[str, ...] = OFFICIAL) -> ApiError:
    with pytest.raises(ApiError) as exc:
        validate_media_url(url, allowed)
    return exc.value


# --- registre ---------------------------------------------------------------------------------------------------------

def test_registry_shape() -> None:
    assert tuple(c["id"] for c in REG.categories) == CATEGORIES
    assert [c["nom"] for c in REG.categories] == ["Populaires", "Musique", "Streaming", "Autres"]
    for p in REG.plateformes:
        assert p.icone in REG.icones
        assert p.categorie in CATEGORIES
        if p.telechargeable:
            assert set(p.formats) <= set(FORMATS)


def test_only_tested_platforms_are_official() -> None:
    """Rien n'est « officielle » sans essai réel réussi : la liste est figée ici et ne change qu'avec le banc."""
    assert REG.ids("officielle") == ("youtube", "tiktok", "twitter")


def test_default_domains_are_the_official_ones() -> None:
    assert set(OFFICIAL) == {"youtube.com", "youtu.be", "youtube-nocookie.com", "tiktok.com", "twitter.com", "x.com"}
    assert enabled_platforms(OFFICIAL) == ("youtube", "tiktok", "twitter")


@pytest.mark.parametrize("platform", [p.id for p in NEW])
def test_new_platform_extractors_are_single_media(platform: str) -> None:
    """Chaque motif couvre au moins un extracteur réel de yt-dlp, jamais le générique, une redirection, une liste, une
    chaîne, un profil ou une recherche (les listes seraient extraites page par page)."""
    ydl = yt_dlp.YoutubeDL({"allowed_extractors": PLATFORM_EXTRACTORS[platform], "quiet": True})
    names = {name.lower() for name in ydl._ies}
    assert names, platform
    forbidden = re.compile(r"generic.*|.*(?:redirect|user|channel|playlist|search|collection|album|space).*|"
                           r".*:(?:tag|likes|watchlater|group|event|ondemand|review|stream|live|story|wallpost).*")
    assert not [n for n in names if forbidden.fullmatch(n)], names


def test_registry_rejects_generic_and_duplicates() -> None:
    base = {"version": "t", "ytdlp": "t", "categories": [{"id": c, "nom": c} for c in CATEGORIES],
            "icones": {"video": "v"}}
    entry = {"id": "demo", "nom": "Demo", "categorie": "autres", "etat": "beta", "icone": "video",
             "domaines": ["demo.example"], "extracteurs": ["gen.*"], "formats": ["mp4"]}
    with pytest.raises(ValueError, match="interdit"):
        parse_registry(base | {"plateformes": [entry]})
    ok = entry | {"extracteurs": ["demo"]}
    with pytest.raises(ValueError, match="double"):
        parse_registry(base | {"plateformes": [ok, ok]})
    with pytest.raises(ValueError, match="extracteurs"):
        parse_registry(base | {"plateformes": [ok | {"extracteurs": []}]})
    with pytest.raises(ValueError, match="agent"):
        parse_registry(base | {"plateformes": [ok | {"agent": "navigateur"}]})


# --- détection --------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize(("host", "expected"), [
    ("www.youtube.com", "youtube"), ("youtu.be", "youtube"), ("vm.tiktok.com", "tiktok"), ("x.com", "twitter"),
    ("vimeo.com", "vimeo"), ("player.vimeo.com", "vimeo"), ("www.dailymotion.com", "dailymotion"),
    ("dai.ly", "dailymotion"), ("clips.twitch.tv", "twitch"), ("www.instagram.com", "instagram"),
    ("old.reddit.com", "reddit"), ("www.threads.net", "threads"), ("threads.com", "threads"), ("bsky.app", "bluesky"), ("commons.wikimedia.org", "wikimedia"),
    ("archive.org", "archive"), ("i.imgur.com", "imgur"),
    ("notvimeo.com", "other"), ("vimeo.com.evil.example", "other"), ("wikimedia.org", "other"),
    ("soundcloud.com", "other"), ("open.spotify.com", "other"), ("music.youtube.com", "other"),
])
def test_detect_platform(host: str, expected: str) -> None:
    assert detect_platform(host) == expected


@pytest.mark.parametrize("url", [
    "https://soundcloud.com/artiste/titre", "https://open.spotify.com/track/abc", "https://www.deezer.com/fr/track/1",
    "https://music.apple.com/fr/album/x/1", "https://artiste.bandcamp.com/track/titre", "https://www.mixcloud.com/a/b/",
    "https://www.netflix.com/watch/1", "https://www.disneyplus.com/video/x", "https://www.primevideo.com/detail/x",
])
def test_refused_platforms_get_a_stable_code_before_any_work(url: str) -> None:
    err = _err(url, OFFICIAL + ("soundcloud.com",))  # même si un domaine refusé était (à tort) dans la liste
    assert (err.status, err.code, err.detail) == (400, "platform_not_accepted", USER_TEXT["platform_not_accepted"])


def test_youtube_music_keeps_its_own_code() -> None:
    assert _err("https://music.youtube.com/watch?v=abcdefghijk").code == "youtube_music_not_accepted"


def test_beta_platform_closed_by_default() -> None:
    err = _err("https://www.dailymotion.com/video/x5kesuj")
    assert err.code == "domain_not_allowed" and "Dailymotion" in err.detail and "essai" in err.detail


def test_platform_that_failed_the_real_bench_is_unavailable() -> None:
    """Vimeo a échoué au banc réel du 2026-10-26 (connexion exigée) : refus clair 503, même si on l'ouvrait."""
    assert REG.get("vimeo").etat == "indisponible"
    err = _err("https://vimeo.com/56015672", OFFICIAL + ("vimeo.com",))
    assert (err.status, err.code) == (503, "platform_unavailable") and "Vimeo" in err.detail
    with pytest.raises(ConfigError, match="not beta"):
        parse_beta_platforms("vimeo")


@pytest.mark.parametrize("pid", ["facebook", "reddit", "vimeo", "tumblr", "bilibili", "rumble", "threads"])
def test_unavailable_platforms_decided_by_the_owner(pid: str) -> None:
    """Décision du propriétaire (2026-10-26) : « indisponible », aucun contournement (ni cookie, ni connexion, ni
    client détourné) ; Threads n'a même pas d'extracteur : le worker ne peut pas la télécharger."""
    p = REG.get(pid)
    assert p.etat == "indisponible" and pid not in PLATFORM_EXTRACTORS
    url = "https://www.threads.net/@meta/post/C8x" if pid == "threads" else None
    if url:
        err = _err(url, OFFICIAL)
        assert (err.status, err.code) == (503, "platform_unavailable") and "Threads" in err.detail


def test_unknown_domain_message_lists_open_platforms() -> None:
    err = _err("https://example.org/video.mp4")
    assert err.code == "domain_not_allowed" and "YouTube, TikTok, X" in err.detail


def test_beta_platform_opened_by_setting() -> None:
    allowed = parse_domains(DEFAULT_ALLOWED_DOMAINS, ("streamable", "dailymotion"))
    media = validate_media_url("https://streamable.com/dnd1", allowed)
    assert (media.platform, media.url) == ("streamable", "https://streamable.com/dnd1")
    assert validate_media_url("https://www.dailymotion.com/video/x5kesuj", allowed).platform == "dailymotion"
    assert enabled_platforms(allowed) == ("youtube", "tiktok", "twitter", "dailymotion", "streamable")


@pytest.mark.parametrize(("platform", "url"), [
    ("vimeo", "https://vimeo.com/channels/staffpicks"), ("vimeo", "https://vimeo.com/user12345"),
    ("dailymotion", "https://www.dailymotion.com/playlist/x6hynp"), ("twitch", "https://www.twitch.tv/somechannel"),
    ("instagram", "https://www.instagram.com/someprofile/"), ("kick", "https://kick.com/somechannel"),
    ("reddit", "https://www.reddit.com/r/videos/"), ("bilibili", "https://space.bilibili.com/12345"),
])
def test_lists_profiles_and_channels_refused_before_any_worker(platform: str, url: str) -> None:
    with pytest.raises(ApiError) as exc:
        check_extractor_shape(platform, url)
    assert exc.value.code == "unsupported_url"
    if REG.get(platform).etat == "beta":
        assert _err(url, parse_domains(DEFAULT_ALLOWED_DOMAINS, (platform,))).code == "unsupported_url"


def test_custom_rules_of_the_three_platforms_unchanged() -> None:
    assert validate_media_url("https://youtu.be/BaW_jenozKc", OFFICIAL).platform == "youtube"
    assert _err("https://www.youtube.com/@chaine").code == "playlist_not_supported"


# --- configuration ----------------------------------------------------------------------------------------------------

@pytest.mark.parametrize(("raw", "match"), [("inconnue", "unknown"), ("youtube", "not beta"), ("soundcloud", "not beta")])
def test_beta_setting_validated(raw: str, match: str) -> None:
    with pytest.raises(ConfigError, match=match):
        parse_beta_platforms(raw)


def test_beta_domain_needs_the_beta_setting() -> None:
    with pytest.raises(ConfigError, match="PLATEFORMES_BETA"):
        parse_domains("youtube.com,dailymotion.com")
    assert "dai.ly" in parse_domains("youtube.com,dailymotion.com", ("dailymotion",))


def test_load_settings_reads_beta(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    from app.config import load_settings

    monkeypatch.setenv("API_TOKEN", "t" * 40)
    monkeypatch.setenv("TMP_DIR", str(tmp_path))
    monkeypatch.setenv("PLATEFORMES_BETA", "Wikimedia, archive")
    s = load_settings()
    assert s.plateformes_beta == ("wikimedia", "archive")
    assert "commons.wikimedia.org" in s.allowed_domains and "archive.org" in s.allowed_domains


# --- worker : fermé par défaut, jamais de cookie ni de proxy hors YouTube ---------------------------------------------

def test_worker_options_of_a_new_platform(tmp_path: Path) -> None:
    cookies = tmp_path / "c.txt"
    cookies.write_text("# Netscape HTTP Cookie File\n")
    cfg = {"max_filesize_bytes": 1, "cache_dir": None, "yt_proxy": "http://proxy:1"}
    opts = base_options(cfg, tmp_path, "dailymotion", str(cookies))
    assert opts["allowed_extractors"] == ["dailymotion"]
    assert "cookiefile" not in opts and opts["proxy"] == "" and opts["noplaylist"] is True
    assert "http_headers" not in opts  # agent identifié seulement là où le registre le demande
    for closed in ("soundcloud", "vimeo"):  # refusée, indisponible : le worker ne les connaît pas
        with pytest.raises(ApiError):
            base_options(cfg, tmp_path, closed)



def test_wikimedia_gets_an_identified_user_agent(tmp_path: Path) -> None:
    # Politique User-Agent de Wikimedia : un client automatisé se nomme et donne un contact, sans imiter un navigateur.
    cfg = {"max_filesize_bytes": 1, "cache_dir": None, "yt_proxy": ""}
    opts = base_options(cfg, tmp_path, "wikimedia")
    ua = opts["http_headers"]["User-Agent"]
    assert ua.startswith("AETHRYON/") and "https://" in ua and "Mozilla" not in ua
    for pid in ("youtube", "tiktok", "twitter"):  # les trois plateformes en production : inchangées
        assert "http_headers" not in base_options(cfg, tmp_path, pid)


@pytest.mark.parametrize(("message", "code"), [
    ("ERROR: [vimeo] 123: This video is DRM protected", "unsupported_content"),
    ("ERROR: [Instagram] abc: This video is private", "private"),
    ("ERROR: [facebook] 1: You need to log in to access this content", "login_required"),
])
def test_drm_private_and_login_are_refused_not_bypassed(message: str, code: str) -> None:
    assert map_ytdlp_error(message, "vimeo").code == code


# --- disjoncteur des autres plateformes -------------------------------------------------------------------------------

def _monitor() -> PlatformMonitor:
    return PlatformMonitor(15, 1, 0, 60, ("youtube", "vimeo"), breaker_failures=3, breaker_min=10, breaker_max_min=60)


def _fail(m: PlatformMonitor, code: str = "upstream_unavailable", platform: str = "vimeo") -> None:
    m.record_error(platform, ApiError(503, code, "x"), started_at=time.time())


def test_breaker_opens_after_consecutive_platform_failures() -> None:
    m = _monitor()
    _fail(m)
    _fail(m, "extractor_broken")
    m.check_available("vimeo")  # 2 échecs : encore ouvert
    _fail(m, "upstream_timeout")
    with pytest.raises(ApiError) as exc:
        m.check_available("vimeo")
    assert exc.value.status == 503 and exc.value.code == "platform_unavailable"
    assert "Vimeo est temporairement indisponible" in exc.value.detail
    assert 590 <= int(exc.value.headers["Retry-After"]) <= 601
    pub = m.public()["vimeo"]
    assert pub["state"] == "platform_unavailable" and pub["cooldown_until"]
    m.check_available("youtube")  # YouTube garde son propre disjoncteur


def test_video_errors_do_not_count() -> None:
    m = _monitor()
    for code in ("private", "not_found", "login_required", "too_long", "unsupported_content"):
        _fail(m, code)
    m.check_available("vimeo")
    assert m.states["vimeo"].failures == 0


def test_success_closes_and_failure_after_pause_reopens_longer() -> None:
    m = _monitor()
    for _ in range(3):
        _fail(m)
    first = m.states["vimeo"].cooldown_until
    m.states["vimeo"].cooldown_until = time.time() - 1  # pause finie : la requête suivante est la sonde
    m.check_available("vimeo")
    _fail(m)
    state = m.states["vimeo"]
    assert state.blocks == 2 and state.cooldown_until - time.time() > 1100  # 20 min
    assert first is not None
    state.cooldown_until = time.time() - 1
    m.record_success("vimeo", started_at=time.time())
    assert (state.state, state.failures, state.blocks, state.cooldown_until) == ("ok", 0, 0, None)


def test_task_started_before_the_pause_is_the_same_episode() -> None:
    m = _monitor()
    before = time.time() - 5
    for _ in range(3):
        _fail(m)
    blocks = m.states["vimeo"].blocks
    m.record_error("vimeo", ApiError(503, "upstream_unavailable", "x"), started_at=before)
    assert m.states["vimeo"].blocks == blocks


def test_breaker_off_when_zero() -> None:
    m = PlatformMonitor(15, 1, 0, 60, ("vimeo",), breaker_failures=0)
    for _ in range(10):
        _fail(m)
    m.check_available("vimeo")


# --- formats proposés d'après les métadonnées réelles -----------------------------------------------------------------

def test_formats_from_metadata() -> None:
    assert formats_proposes("vimeo", video=True, audio=True, duration=60) == ["mp4", "mp3", "gif", "extrait"]
    assert formats_proposes("archive", video=False, audio=True, duration=120) == ["mp3", "extrait"]
    assert formats_proposes("twitter", video=True, audio=False, duration=None) == ["mp4", "gif"]
    assert formats_proposes("imgur", video=True, audio=True, duration=5) == ["mp4", "gif", "extrait"]


def test_summary_carries_proposed_formats() -> None:
    from app.worker import summarize

    info = {"id": "1", "title": "t", "duration": 30, "extractor_key": "Vimeo", "formats": [
        {"format_id": "a", "vcodec": "none", "acodec": "mp4a.40.2", "abr": 128},
        {"format_id": "v", "vcodec": "avc1.64001f", "acodec": "none", "height": 720, "width": 1280, "tbr": 1500}]}
    out = summarize(info, {"max_duration_s": 3600, "gif_max_duration_s": 30, "transcode_max_duration_s": 900}, "vimeo")
    assert out["proposes"] == ["mp4", "mp3", "gif", "extrait"]
    assert out["qualities"][0]["quality"] == 720


def test_registry_formats_are_enforced() -> None:
    check_platform_format("vimeo", "mp3")
    with pytest.raises(ApiError) as exc:
        check_platform_format("imgur", "mp3")
    assert exc.value.code == "format_unavailable"


@pytest.mark.parametrize("pid", ["wikimedia", "bluesky"])
def test_clips_closed_where_the_end_to_end_bench_failed(pid: str) -> None:
    """Banc de bout en bout du 2026-10-26 : Wikimedia répond 429 aux requêtes partielles, Bluesky les ignore. L'extrait
    (et donc un GIF ou un MP3 d'un passage) est refusé avant tout travail ; le média entier reste permis."""
    for fmt in ("mp4", "mp3", "gif"):
        check_platform_format(pid, fmt)
        with pytest.raises(ApiError) as exc:
            check_platform_format(pid, fmt, clip=True)
        assert (exc.value.status, exc.value.code) == (422, "format_unavailable")
    assert "extrait" not in formats_proposes(pid, video=True, audio=True, duration=45.0)


# --- API ----------------------------------------------------------------------------------------------------------------

def test_platforms_route_is_public_and_static(client: TestClient) -> None:
    r = client.get("/platforms")
    assert r.status_code == 200
    body = r.json()
    assert [c["nom"] for c in body["categories"]] == ["Populaires", "Musique", "Streaming", "Autres"]
    by_id = {p["id"]: p for p in body["plateformes"]}
    assert by_id["youtube"]["active"] and by_id["youtube"]["disponible"]
    assert not by_id["streamable"]["active"] and by_id["streamable"]["etat"] == "beta"
    assert by_id["vimeo"]["etat"] == "indisponible" and not by_id["vimeo"]["disponible"]
    assert by_id["soundcloud"]["etat"] == "refusee" and by_id["soundcloud"]["motif"]
    assert "extracteurs" not in by_id["vimeo"]


def test_job_on_closed_beta_platform_refused(client: TestClient, auth: dict[str, str]) -> None:
    r = client.post("/jobs", json={"url": "https://streamable.com/dnd1", "fmt": "mp4"}, headers=auth)
    assert r.status_code == 400 and r.json()["error"] == "domain_not_allowed"


def test_job_on_open_beta_platform_and_breaker(make_client, auth: dict[str, str]) -> None:  # noqa: ANN001
    c = make_client(allowed_domains=parse_domains(DEFAULT_ALLOWED_DOMAINS, ("streamable",)),
                    plateformes_beta=("streamable",))
    r = c.post("/jobs", json={"url": "https://streamable.com/dnd1", "fmt": "mp4"}, headers=auth)
    assert r.status_code in (200, 202), r.text
    item = next(p for p in c.get("/platforms").json()["plateformes"] if p["id"] == "streamable")
    assert item["active"] and item["disponible"] and item["essai"].startswith("2026-10-26 réussi")
    monitor = c.app.state.runner.platforms  # type: ignore[attr-defined]
    monitor.states["streamable"].cooldown_until = time.time() + 300
    r = c.post("/jobs", json={"url": "https://streamable.com/moo", "fmt": "mp3"}, headers=auth)
    assert r.status_code == 503 and r.json()["error"] == "platform_unavailable"
    assert r.headers.get("Retry-After")
