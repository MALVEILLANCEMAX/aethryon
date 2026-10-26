"""AETHRYON Music (app/music): detection, connectors and their REAL capabilities, legal imports, cloud, matching,
and the guarantee that nothing can be downloaded from Spotify, Apple Music, SoundCloud, Deezer or YouTube Music."""

from __future__ import annotations

import ast
import hashlib
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.errors import ApiError
from app.music import licences
from app.music.base import Connector, ImportPlan
from app.music.matching import Candidat, match
from app.music.model import Fichier
from app.music.sources import ARCHIVE_FILES, COMMONS_FILES
from app.userkeys import Principal
from app.music.web import ANY_PUBLIC, BLOCKED_SUFFIXES, HostPolicy, check_url, public_address

from tests.conftest import TOKEN
from tests.music_fakes import FakeWeb, archive_metadata, commons_info, jreply, make_audio, md5_hex, rss, tags_of
from tests.test_cloud_sync import CloudAccount, FakeStorage
from tests.test_user_keys import INTERNAL, KEY_A, KEY_B, bearer

AUTH = {"Authorization": f"Bearer {TOKEN}"}
ACTIVE = ("en_file", "telechargement", "verification", "etiquetage")


@pytest.fixture(scope="session")
def sounds(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("sons")


def install(client: TestClient) -> FakeWeb:
    fake = FakeWeb()
    music = client.app.state.music  # type: ignore[attr-defined]
    music.web = music.ctx.web = music.imports.web = fake
    return fake


@pytest.fixture
def mk(make_client: Callable[..., TestClient]) -> Callable[..., tuple[TestClient, FakeWeb]]:
    def factory(**overrides: Any) -> tuple[TestClient, FakeWeb]:
        client = make_client(music_enabled=True, **overrides)
        return client, install(client)
    return factory


@pytest.fixture
def mc(mk: Callable[..., tuple[TestClient, FakeWeb]]) -> tuple[TestClient, FakeWeb]:
    return mk()


def analyse(client: TestClient, url: str, headers: dict[str, str] = AUTH, **extra: Any) -> Any:
    return client.post("/music/analyser", json={"url": url, **extra}, headers=headers)


def wait_import(client: TestClient, job_id: str, headers: dict[str, str] = AUTH, timeout: float = 20) -> dict[str, Any]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        view = client.get(f"/music/imports/{job_id}", headers=headers).json()["import"]
        if view["etat"] not in ACTIVE:
            return view
        time.sleep(0.05)
    raise AssertionError("import not finished")


def spotify_files(tmp_path: Path, refresh: bool = False) -> dict[str, Path]:
    (tmp_path / "sid").write_text("id-du-proprietaire-0001")
    (tmp_path / "ssecret").write_text("secret-du-proprietaire-0001")
    out = {"music_spotify_client_id_file": tmp_path / "sid", "music_spotify_client_secret_file": tmp_path / "ssecret"}
    if refresh:
        (tmp_path / "srefresh").write_text("refresh-du-proprietaire-0001")
        out["music_spotify_refresh_token_file"] = tmp_path / "srefresh"
    return out


TRACK_ID = "4uLU6hMCjMI75M1A2tKUQC"
PLAYLIST_ID = "37i9dQZF1DXcBWIGoYBM5M"


# --- switch, authentication, detection --------------------------------------------------------------------------

def test_music_is_off_by_default(client: TestClient) -> None:
    assert client.post("/music/analyser", json={"url": "https://archive.org/details/x"}, headers=AUTH).status_code == 404
    assert client.get("/music/connecteurs", headers=AUTH).status_code == 404


def test_music_requires_an_aethryon_key(mc: tuple[TestClient, FakeWeb]) -> None:
    client, web = mc
    assert client.get("/music/connecteurs").status_code == 401
    assert analyse(client, "https://archive.org/details/x", headers={}).status_code == 401
    assert analyse(client, "https://archive.org/details/x", headers={"Authorization": "Bearer faux"}).status_code == 401
    assert web.calls == []


@pytest.mark.parametrize(("url", "connecteur", "kind", "ident"), [
    (f"https://open.spotify.com/track/{TRACK_ID}?si=abc", "spotify", "titre", TRACK_ID),
    (f"https://open.spotify.com/intl-fr/album/{TRACK_ID}", "spotify", "album", TRACK_ID),
    (f"spotify:playlist:{PLAYLIST_ID}", "spotify", "playlist", PLAYLIST_ID),
    ("https://music.apple.com/fr/album/gymnopedies/1440833098?i=1440833103", "apple", "titre", "1440833103"),
    ("https://music.apple.com/fr/album/gymnopedies/1440833098", "apple", "album", "1440833098"),
    ("https://music.apple.com/fr/playlist/chill/pl.u-abc123", "apple", "playlist", "pl.u-abc123"),
    ("https://podcasts.apple.com/fr/podcast/les-ondes/id1234567", "apple", "podcast", "1234567"),
    ("https://soundcloud.com/artiste-libre/un-titre", "soundcloud", "titre", "artiste-libre/un-titre"),
    ("https://soundcloud.com/artiste-libre/sets/album-1", "soundcloud", "playlist", "artiste-libre/sets/album-1"),
    ("https://www.deezer.com/fr/track/3135556", "deezer", "titre", "3135556"),
    ("https://archive.org/details/gymnopedie-libre", "archive", "element", "gymnopedie-libre"),
    ("https://commons.wikimedia.org/wiki/File:Chant_oiseau.ogg", "commons", "fichier", "Chant_oiseau.ogg"),
    ("https://upload.wikimedia.org/wikipedia/commons/a/ab/Chant_oiseau.ogg", "commons", "fichier", "Chant_oiseau.ogg"),
])
def test_platform_detection(mc: tuple[TestClient, FakeWeb], url: str, connecteur: str, kind: str, ident: str) -> None:
    client, _ = mc
    connector, ref = client.app.state.music.detect(url)  # type: ignore[attr-defined]
    assert (connector.id, ref.type, ref.id) == (connecteur, kind, ident)
    assert ref.url.startswith("https://")


@pytest.mark.parametrize("url", [
    "", "pas un lien", "ftp://archive.org/details/x", "https://", "https://user:pw@archive.org/details/x",
    "https://open.spotify.com/track/court", "https://open.spotify.com/user/abc", "https://spotify.link/AbCdEf",
    "https://music.apple.com/fr/album/sans-id", "https://soundcloud.com/discover", "https://on.soundcloud.com/x1",
    "https://www.deezer.com/fr/track/abc", "https://archive.org/search?query=x", "https://commons.wikimedia.org/wiki/Main_Page",
    "https://archive.org/details/" + "a" * 2100, "spotify:track:court",
])
def test_invalid_urls(mc: tuple[TestClient, FakeWeb], url: str) -> None:
    client, web = mc
    r = analyse(client, url)
    assert r.status_code == 400, r.text
    assert r.json()["error"] in ("lien_invalide", "plateforme_inconnue")
    assert web.calls == []  # refused before any network call


def test_unknown_and_unsupported_platforms(mc: tuple[TestClient, FakeWeb]) -> None:
    client, web = mc
    r = analyse(client, "https://www.example.com/une-page")
    assert r.status_code == 400 and r.json()["error"] == "plateforme_inconnue"
    for url in ("https://music.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "https://artiste.bandcamp.com/track/titre", "https://tidal.com/browse/track/1"):
        r = analyse(client, url)
        assert r.status_code == 400 and r.json()["error"] == "plateforme_non_prise_en_charge", url
    assert web.calls == []


def test_connectors_announce_their_real_capabilities(mk: Callable[..., tuple[TestClient, FakeWeb]], tmp_path: Path) -> None:
    client, _ = mk()
    caps = {c["id"]: c for c in client.get("/music/connecteurs", headers=AUTH).json()["connecteurs"]}
    for cid in ("spotify", "apple", "soundcloud", "deezer"):
        assert caps[cid]["famille"] == "catalogue"
        assert "AuthorizedDownload" not in caps[cid]["capacites"] + caps[cid]["capacitesAvecIdentifiants"]
        assert "Import" not in caps[cid]["capacites"] + caps[cid]["capacitesAvecIdentifiants"]
    assert caps["spotify"]["capacites"] == ["Metadata", "Playback"]  # no credentials: no search
    assert [i["configure"] for i in caps["spotify"]["identifiants"]] == [False, False]
    assert caps["deezer"]["capacites"] == ["Playback"]  # API off by default (non-commercial terms)
    for cid in ("archive", "commons", "podcast", "fichier"):
        assert {"AuthorizedDownload", "Import"} <= set(caps[cid]["capacites"])
    with_ids, _ = mk(**spotify_files(tmp_path), music_deezer_api=True, music_direct_files=False)
    caps = {c["id"]: c for c in with_ids.get("/music/connecteurs", headers=AUTH).json()["connecteurs"]}
    assert caps["spotify"]["capacites"] == ["Metadata", "Search", "Playback"]
    assert caps["deezer"]["capacites"] == ["Metadata", "Preview", "Playback"]
    assert caps["fichier"]["actif"] is False and caps["fichier"]["capacites"] == []


# --- Spotify ------------------------------------------------------------------------------------------------------

def test_spotify_without_credentials_uses_public_oembed(mc: tuple[TestClient, FakeWeb]) -> None:
    client, web = mc
    web.add("open.spotify.com", "/oembed", jreply({"title": "Gymnopédie No. 1", "thumbnail_url": "https://i.scdn.co/image/ab",
                                                    "html": "<iframe></iframe>", "provider_name": "Spotify"}))
    f = analyse(client, f"https://open.spotify.com/track/{TRACK_ID}").json()["fiche"]
    assert f["etat"] == "identifie" and f["titre"] == "Gymnopédie No. 1" and f["sourceMetadonnees"] == "oembed"
    assert f["artistes"] == [] and f["dureeS"] is None
    assert any("Artistes, album, durée et ISRC" in m and "non configurés" in m for m in f["manque"])
    assert f["capacites"] == ["Metadata", "Playback"]
    assert [a["id"] for a in f["actions"]] == ["ouvrir", "lecteur_officiel", "enregistrer_lien"]
    assert f["actions"][1]["embed"] == f"https://open.spotify.com/embed/track/{TRACK_ID}"
    assert web.hosts() == {"open.spotify.com"}


def test_spotify_owner_credentials_give_full_metadata(mk: Callable[..., tuple[TestClient, FakeWeb]], tmp_path: Path) -> None:
    client, web = mk(**spotify_files(tmp_path))
    seen: list[str] = []

    def token(method: str, path: str, headers: dict[str, str]) -> Any:
        seen.append(headers.get("Authorization", ""))
        return jreply({"access_token": "jeton-app", "expires_in": 3600})
    web.add("accounts.spotify.com", "/api/token", token)
    web.add("api.spotify.com", f"/v1/tracks/{TRACK_ID}*", jreply({
        "name": "Gymnopédie No. 1", "duration_ms": 185000, "external_ids": {"isrc": "FR-AB1-23-00001"},
        "artists": [{"name": "Erik Satie"}, {"name": "Ensemble"}],
        "album": {"name": "Gymnopédies", "release_date": "2020-01-01", "images": [{"url": "https://i.scdn.co/image/cd"}]}}))
    f = analyse(client, f"https://open.spotify.com/track/{TRACK_ID}").json()["fiche"]
    assert f["sourceMetadonnees"] == "api_web" and f["artistes"] == ["Erik Satie", "Ensemble"]
    assert (f["album"], f["dureeS"], f["isrc"]) == ("Gymnopédies", 185.0, "FRAB12300001")
    assert f["etat"] == "identifie" and "AuthorizedDownload" not in f["capacites"]
    assert seen and seen[0].startswith("Basic ")  # owner's app credentials, server side only


def test_spotify_refused_credentials_fall_back_to_oembed(mk: Callable[..., tuple[TestClient, FakeWeb]], tmp_path: Path) -> None:
    client, web = mk(**spotify_files(tmp_path))
    web.add("accounts.spotify.com", "/api/token", jreply({"error": "invalid_client"}, 400))
    web.add("open.spotify.com", "/oembed", jreply({"title": "Titre public"}))
    f = analyse(client, f"https://open.spotify.com/track/{TRACK_ID}").json()["fiche"]
    assert f["sourceMetadonnees"] == "oembed" and f["titre"] == "Titre public"
    assert any("Identifiants Spotify refusés" in a for a in f["avertissements"])


def test_spotify_api_unavailable(mk: Callable[..., tuple[TestClient, FakeWeb]], tmp_path: Path) -> None:
    client, web = mk(**spotify_files(tmp_path))
    web.add("accounts.spotify.com", "/api/token", jreply({"access_token": "x", "expires_in": 3600}))
    web.add("api.spotify.com", "/v1/*", jreply({"error": "busy"}, 503))
    web.add("open.spotify.com", "/oembed", jreply({"error": "busy"}, 503))
    r = analyse(client, f"https://open.spotify.com/track/{TRACK_ID}")
    assert r.status_code == 503 and r.json()["error"] == "source_indisponible" and r.headers["retry-after"] == "60"


def test_spotify_playlist_metadata_absent_without_credentials(mc: tuple[TestClient, FakeWeb]) -> None:
    client, web = mc
    f = analyse(client, f"https://open.spotify.com/playlist/{PLAYLIST_ID}").json()["fiche"]
    assert f["etat"] == "lien_reconnu" and f["titre"] is None and f["sourceMetadonnees"] == "aucune"
    assert any("playlist" in m for m in f["manque"])
    assert web.calls == []  # the public oEmbed does not cover playlists: not even tried


def test_spotify_import_is_refused(mc: tuple[TestClient, FakeWeb]) -> None:
    client, web = mc
    for url in (f"https://open.spotify.com/track/{TRACK_ID}", f"https://open.spotify.com/playlist/{PLAYLIST_ID}"):
        r = client.post("/music/imports", json={"url": url}, headers=AUTH)
        assert r.status_code == 403 and r.json()["error"] == "telechargement_non_autorise"
    assert web.calls == []


def test_playlist_sync_needs_the_owner_authorisation(mk: Callable[..., tuple[TestClient, FakeWeb]], tmp_path: Path) -> None:
    client, web = mk(**spotify_files(tmp_path))
    r = client.post("/music/playlists/synchroniser", json={"url": f"https://open.spotify.com/playlist/{PLAYLIST_ID}"},
                    headers=AUTH)
    assert r.status_code == 409 and r.json()["error"] == "autorisation_spotify_requise"


def test_playlist_sync_links_owned_files_and_downloads_nothing(mk: Callable[..., tuple[TestClient, FakeWeb]],
                                                               tmp_path: Path) -> None:
    client, web = mk(**spotify_files(tmp_path, refresh=True))
    grants: list[str] = []

    def token(method: str, path: str, headers: dict[str, str]) -> Any:
        grants.append(method)
        return jreply({"access_token": "jeton-utilisateur", "expires_in": 3600})
    web.add("accounts.spotify.com", "/api/token", token)
    web.add("api.spotify.com", f"/v1/playlists/{PLAYLIST_ID}", jreply({
        "name": "Ma sélection", "owner": {"display_name": "Propriétaire"}, "snapshot_id": "snap-42", "items": {"total": 52}}))
    tracks = [{"type": "track", "id": f"{i:022d}", "name": f"Morceau {i}", "duration_ms": 200000,
               "artists": [{"name": "Artiste"}], "external_ids": {}} for i in range(52)]
    tracks[0] = {"type": "track", "id": "A" * 22, "name": "Gymnopédie No. 1 - 2011 Remaster", "duration_ms": 185000,
                 "artists": [{"name": "Erik Satie"}], "external_ids": {"isrc": "FRAB12300001"}}
    tracks[1] = {"type": "track", "id": "B" * 22, "name": "Clair de lune", "duration_ms": 300000,
                 "artists": [{"name": "Claude Debussy"}], "external_ids": {"isrc": "FRZZZ0000002"}}
    pages = {0: tracks[:50], 50: tracks[50:]}

    def items(method: str, path: str, headers: dict[str, str]) -> Any:
        offset = int(path.split("offset=")[1])
        return jreply({"items": [{"item": t} for t in pages[offset]], "next": "x" if offset == 0 else None})
    web.add("api.spotify.com", f"/v1/playlists/{PLAYLIST_ID}/items*", items)
    candidats = [
        {"ref": "bib:1", "origine": "bibliotheque", "titre": "Gymnopedie no 1", "artistes": ["Satie"], "dureeS": 184},
        {"ref": "cloud:9", "origine": "cloud", "titre": "Autre chose", "artistes": ["X"], "isrc": "FRZZZ0000002",
         "disponible": False},
    ]
    r = client.post("/music/playlists/synchroniser", json={"url": f"https://open.spotify.com/playlist/{PLAYLIST_ID}",
                                                          "candidats": candidats}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["telechargements"] == 0 and body["playlist"]["snapshot"] == "snap-42"
    rows = body["playlist"]["pistes"]
    assert len(rows) == 52 and body["stats"]["titres"] == 52
    assert rows[0]["etat"] == "correspondance" and rows[0]["correspondance"]["ref"] == "bib:1"
    assert rows[1]["correspondance"]["methode"] == "isrc" and rows[1]["correspondance"]["audioDisponible"] is False
    assert rows[5]["etat"] == "identifie" and rows[5]["correspondance"] is None
    assert web.hosts() <= {"accounts.spotify.com", "api.spotify.com"}


# --- Apple, SoundCloud, Deezer ------------------------------------------------------------------------------------

def itunes_song(preview: bool = True) -> dict[str, Any]:
    song = {"wrapperType": "track", "kind": "song", "trackId": 1440833103, "collectionId": 1440833098,
            "trackName": "Gymnopédie No. 1", "artistName": "Erik Satie", "collectionName": "Gymnopédies",
            "trackTimeMillis": 185000, "releaseDate": "2020-01-01T08:00:00Z",
            "artworkUrl100": "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg",
            "trackViewUrl": "https://music.apple.com/fr/album/x/1440833098?i=1440833103"}
    if preview:
        song["previewUrl"] = "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/x.m4a"
    return {"resultCount": 1, "results": [song]}


def test_apple_metadata_and_30s_preview_presented_as_preview(mc: tuple[TestClient, FakeWeb]) -> None:
    client, web = mc
    web.add("itunes.apple.com", "/lookup", jreply(itunes_song()))
    f = analyse(client, "https://music.apple.com/fr/album/gymnopedies/1440833098?i=1440833103").json()["fiche"]
    assert (f["titre"], f["artistes"], f["dureeS"]) == ("Gymnopédie No. 1", ["Erik Satie"], 185.0)
    assert f["pochette"].endswith("600x600bb.jpg") and "Preview" in f["capacites"]
    apercu = next(a for a in f["actions"] if a["id"] == "apercu")
    assert apercu["libelle"] == "Aperçu de 30 s" and apercu["dureeS"] == 30 and apercu["lectureSeulement"] is True
    assert "pas le morceau complet" in apercu["note"] and apercu["mention"] == "Aperçu fourni par iTunes"
    assert "importer" not in [a["id"] for a in f["actions"]] and f["etat"] == "identifie"
    # the preview itself is never fetched by the server (streamed by the device from Apple)
    assert web.hosts() == {"itunes.apple.com"}
    r = client.post("/music/imports", json={"url": "https://music.apple.com/fr/album/x/1440833098?i=1440833103"}, headers=AUTH)
    assert r.status_code == 403


def test_apple_previews_can_be_switched_off(mk: Callable[..., tuple[TestClient, FakeWeb]]) -> None:
    client, web = mk(music_apple_previews=False)
    web.add("itunes.apple.com", "/lookup", jreply(itunes_song()))
    f = analyse(client, "https://music.apple.com/fr/song/x/1440833103").json()["fiche"]
    assert "Preview" not in f["capacites"] and all(a["id"] != "apercu" for a in f["actions"])


def test_apple_metadata_absent(mc: tuple[TestClient, FakeWeb]) -> None:
    client, web = mc
    web.add("itunes.apple.com", "/lookup", jreply({"resultCount": 0, "results": []}))
    f = analyse(client, "https://music.apple.com/fr/song/x/999").json()["fiche"]
    assert f["etat"] == "lien_reconnu" and any("Métadonnées absentes" in m for m in f["manque"])
    f = analyse(client, "https://music.apple.com/fr/playlist/chill/pl.u-abc123").json()["fiche"]
    assert f["etat"] == "lien_reconnu" and any("Apple Developer Program payant" in m for m in f["manque"])


def test_soundcloud_metadata_and_widget_never_a_download(mc: tuple[TestClient, FakeWeb]) -> None:
    client, web = mc
    web.add("soundcloud.com", "/oembed", jreply({"title": "Nuit claire by Artiste Libre", "author_name": "Artiste Libre",
                                                  "thumbnail_url": "https://i1.sndcdn.com/artworks-x.jpg"}))
    url = "https://soundcloud.com/artiste-libre/nuit-claire"
    f = analyse(client, url).json()["fiche"]
    assert (f["titre"], f["artistes"]) == ("Nuit claire", ["Artiste Libre"])
    assert f["capacites"] == ["Metadata", "Playback"] and f["etat"] == "identifie"
    assert any("même pour une piste que son auteur rend téléchargeable" in t for t in f["restrictions"])
    assert f["actions"][1]["embed"].startswith("https://w.soundcloud.com/player/?url=")
    r = client.post("/music/imports", json={"url": url}, headers=AUTH)
    assert r.status_code == 403 and r.json()["error"] == "telechargement_non_autorise"
    r = client.post("/music/imports", json={"url": "https://cf-media.sndcdn.com/x.mp3", "type": "fichier",
                                            "attestation": True}, headers=AUTH)
    assert r.status_code == 403  # the CDN itself is refused as a "direct file"
    assert "cf-media.sndcdn.com" not in web.hosts()


def test_deezer_default_makes_no_api_call(mk: Callable[..., tuple[TestClient, FakeWeb]]) -> None:
    client, web = mk()
    f = analyse(client, "https://www.deezer.com/fr/track/3135556").json()["fiche"]
    assert web.calls == [] and f["etat"] == "lien_reconnu" and f["capacites"] == ["Playback"]
    assert f["actions"][1]["embed"] == "https://widget.deezer.com/widget/dark/track/3135556"
    assert any("non commercial" in m for m in f["manque"])
    client, web = mk(music_deezer_api=True)
    web.add("api.deezer.com", "/track/3135556", jreply({"title": "Harder", "duration": 224, "isrc": "GBDUW0000059",
                                                        "artist": {"name": "Daft"}, "album": {"title": "D", "cover_xl": "https://e-cdns-images.dzcdn.net/x.jpg"},
                                                        "preview": "https://cdnt-preview.dzcdn.net/x.mp3"}))
    f = analyse(client, "https://www.deezer.com/fr/track/3135556").json()["fiche"]
    assert f["titre"] == "Harder" and f["isrc"] == "GBDUW0000059" and "Preview" in f["capacites"]
    assert "AuthorizedDownload" not in f["capacites"] and "dzcdn.net" not in "".join(web.hosts())


# --- legal sources: Internet Archive ------------------------------------------------------------------------------

def archive_setup(web: FakeWeb, data: bytes, licenseurl: str | None, ident: str = "gymnopedie-libre",
                  md5: str | None = None, **md: Any) -> None:
    files = [{"name": "01 Gymnopedie.mp3", "source": "original", "format": "VBR MP3", "size": str(len(data)),
              "length": "2.03", "md5": md5 or md5_hex(data), "title": "Gymnopédie n° 1", "track": "1"},
             {"name": "cover.jpg", "source": "original", "format": "JPEG", "size": "10"}]
    web.add("archive.org", f"/metadata/{ident}", jreply(archive_metadata(ident, licenseurl, files, **md)))
    web.add("archive.org", f"/download/{ident}/01%20Gymnopedie.mp3",
            (302, {"location": f"https://ia800001.us.archive.org/1/items/{ident}/01%20Gymnopedie.mp3"}, b""))
    web.add("ia800001.us.archive.org", f"/1/items/{ident}/01%20Gymnopedie.mp3", (200, {"content-type": "audio/mpeg"}, data))


def test_archive_public_domain_is_really_downloadable(mc: tuple[TestClient, FakeWeb], sounds: Path) -> None:
    client, web = mc
    data = make_audio(sounds, "mp3").read_bytes()
    archive_setup(web, data, "http://creativecommons.org/publicdomain/zero/1.0/")
    f = analyse(client, "https://archive.org/details/gymnopedie-libre").json()["fiche"]
    assert f["etat"] == "telechargeable" and f["licence"]["code"] == "cc0" and f["licence"]["libre"] is True
    assert {"AuthorizedDownload", "Import"} <= set(f["capacites"])
    assert len(f["pistes"]) == 1 and f["pistes"][0]["fichiers"][0]["empreintePubliee"] is True
    assert "md5" not in f["pistes"][0]["fichiers"][0]
    imp = next(a for a in f["actions"] if a["id"] == "importer")
    r = client.post("/music/imports", json=imp["requete"]["corps"], headers=AUTH)
    assert r.status_code == 202, r.text
    view = wait_import(client, r.json()["import"]["id"])
    assert view["etat"] == "termine", view
    assert view["progression"]["octets"] == len(data) and view["progression"]["pourcentage"] == 100.0
    assert view["fichier"]["audio"]["codec"] == "mp3" and 1.5 < view["fichier"]["audio"]["dureeS"] < 2.5
    assert view["fichier"]["etiquetage"] == "ok" and view["licence"]["code"] == "cc0"
    assert view["cloud"] is None  # admin token: no account behind it, no cloud
    got = client.get(view["fichier"]["url"], headers=AUTH)
    assert got.status_code == 200 and got.headers["content-type"] == "audio/mpeg"
    assert "attachment" in got.headers["content-disposition"]
    out = sounds / "importe.mp3"
    out.write_bytes(got.content)
    tags = tags_of(out)
    assert tags["title"] == "Gymnopédie n° 1" and "CC0" in tags["copyright"]
    assert "creativecommons.org/publicdomain/zero" in tags["copyright"] and "archive.org/details" in tags["comment"]
    assert web.hosts() == {"archive.org", "ia800001.us.archive.org"}


@pytest.mark.parametrize(("licenseurl", "extra"), [
    ("https://creativecommons.org/licenses/by-nc/4.0/", {}),
    ("https://creativecommons.org/licenses/by-nd/3.0/", {}),
    (None, {}),
    ("https://creativecommons.org/licenses/by/4.0/", {"access-restricted-item": "true"}),
    ("https://creativecommons.org/publicdomain/mark/1.0/", {"collection": ["georgeblood"]}),
])
def test_archive_without_free_licence_is_not_downloadable(mc: tuple[TestClient, FakeWeb], sounds: Path,
                                                          licenseurl: str | None, extra: dict[str, Any]) -> None:
    client, web = mc
    data = make_audio(sounds, "mp3").read_bytes()
    archive_setup(web, data, licenseurl, **extra)
    f = analyse(client, "https://archive.org/details/gymnopedie-libre").json()["fiche"]
    assert f["etat"] == "identifie" and "AuthorizedDownload" not in f["capacites"]
    assert all(a["id"] != "importer" for a in f["actions"]) and f["restrictions"]
    r = client.post("/music/imports", json={"url": "https://archive.org/details/gymnopedie-libre"}, headers=AUTH)
    assert r.status_code == 403 and r.json()["error"] == "telechargement_non_autorise"
    assert not any("/download/" in u for _, u in web.calls)


def test_archive_integrity_is_checked(mc: tuple[TestClient, FakeWeb], sounds: Path) -> None:
    client, web = mc
    data = make_audio(sounds, "mp3").read_bytes()
    archive_setup(web, data, "https://creativecommons.org/licenses/by/4.0/", md5="0" * 32)
    r = client.post("/music/imports", json={"url": "https://archive.org/details/gymnopedie-libre",
                                            "fichier": "01 Gymnopedie.mp3"}, headers=AUTH)
    view = wait_import(client, r.json()["import"]["id"])
    assert view["etat"] == "echec" and view["erreur"]["code"] == "integrite" and view["fichier"] is None


def test_archive_redirect_to_a_streaming_cdn_is_refused(mc: tuple[TestClient, FakeWeb], sounds: Path) -> None:
    client, web = mc
    data = make_audio(sounds, "mp3").read_bytes()
    archive_setup(web, data, "https://creativecommons.org/licenses/by/4.0/")
    web.add("archive.org", "/download/gymnopedie-libre/01%20Gymnopedie.mp3",
            (302, {"location": "https://cf-media.sndcdn.com/stream.mp3"}, b""))
    r = client.post("/music/imports", json={"url": "https://archive.org/details/gymnopedie-libre"}, headers=AUTH)
    view = wait_import(client, r.json()["import"]["id"])
    assert view["etat"] == "echec" and view["erreur"]["code"] == "telechargement_non_autorise"
    assert "cf-media.sndcdn.com" not in web.hosts() and web.refused == ["https://cf-media.sndcdn.com/stream.mp3"]


def test_archive_unavailable_and_unknown(mc: tuple[TestClient, FakeWeb]) -> None:
    client, web = mc
    web.add("archive.org", "/metadata/inconnu", jreply({}))
    assert analyse(client, "https://archive.org/details/inconnu").status_code == 404
    web.add("archive.org", "/metadata/panne", jreply({"error": "x"}, 502))
    r = analyse(client, "https://archive.org/details/panne")
    assert r.status_code == 503 and r.json()["error"] == "source_indisponible"


# --- Wikimedia Commons, podcasts, direct files --------------------------------------------------------------------

def test_commons_free_file_import_with_attribution(mc: tuple[TestClient, FakeWeb], sounds: Path) -> None:
    client, web = mc
    data = make_audio(sounds, "ogg").read_bytes()
    web.add("commons.wikimedia.org", "/w/api.php", jreply(commons_info("Chant_oiseau.ogg", data)))
    web.add("upload.wikimedia.org", "/wikipedia/commons/a/ab/Chant_oiseau.ogg", (200, {"content-type": "audio/ogg"}, data))
    f = analyse(client, "https://commons.wikimedia.org/wiki/File:Chant_oiseau.ogg").json()["fiche"]
    assert f["etat"] == "telechargeable" and f["licence"]["code"] == "cc-by-sa" and f["artistes"] == ["Exemple"]
    assert "Wikimedia Commons" in f["attribution"] and "CC BY-SA 4.0" in f["attribution"]
    r = client.post("/music/imports", json={"url": "https://commons.wikimedia.org/wiki/File:Chant_oiseau.ogg"}, headers=AUTH)
    view = wait_import(client, r.json()["import"]["id"])
    assert view["etat"] == "termine" and view["fichier"]["type"] == "audio/ogg", view
    assert view["attribution"] == f["attribution"]
    assert all(c[1].startswith("https://commons.wikimedia.org/") or c[1].startswith("https://upload.wikimedia.org/")
               for c in web.calls)


def test_commons_non_audio_or_wrong_sha1(mc: tuple[TestClient, FakeWeb], sounds: Path) -> None:
    client, web = mc
    data = make_audio(sounds, "ogg").read_bytes()
    web.add("commons.wikimedia.org", "/w/api.php", jreply(commons_info("Video.ogg", data, mediatype="VIDEO")))
    f = analyse(client, "https://commons.wikimedia.org/wiki/File:Video.ogg").json()["fiche"]
    assert f["etat"] == "identifie" and "AuthorizedDownload" not in f["capacites"]
    info = commons_info("Chant.ogg", data)
    info["query"]["pages"][0]["imageinfo"][0]["sha1"] = "f" * 40
    music = client.app.state.music  # type: ignore[attr-defined]
    music.cache.prune()
    web.add("commons.wikimedia.org", "/w/api.php", jreply(info))
    web.add("upload.wikimedia.org", "/wikipedia/commons/a/ab/Chant.ogg", (200, {"content-type": "audio/ogg"}, data))
    r = client.post("/music/imports", json={"url": "https://commons.wikimedia.org/wiki/File:Chant.ogg"}, headers=AUTH)
    assert wait_import(client, r.json()["import"]["id"])["erreur"]["code"] == "integrite"


def test_podcast_episode_import(mc: tuple[TestClient, FakeWeb], sounds: Path) -> None:
    client, web = mc
    data = make_audio(sounds, "mp3").read_bytes()
    web.add("podcast.example.org", "/feed.xml", (200, {"content-type": "application/rss+xml"},
                                                 rss("https://tracking.example.net/r/cdn.example.org/ep1.mp3", len(data))))
    web.add("tracking.example.net", "/r/cdn.example.org/ep1.mp3", (302, {"location": "https://cdn.example.org/ep1.mp3"}, b""))
    web.add("cdn.example.org", "/ep1.mp3", (200, {"content-type": "audio/mpeg"}, data))
    f = analyse(client, "https://podcast.example.org/feed.xml").json()["fiche"]
    assert f["connecteur"] == "podcast" and f["titre"] == "Les Ondes Libres" and f["etat"] == "telechargeable"
    assert len(f["pistes"]) == 1  # the video episode is not listed
    assert f["licence"]["code"] == "editeur"
    ep = f["pistes"][0]["id"]
    r = client.post("/music/imports", json={"url": "https://podcast.example.org/feed.xml", "type": "podcast",
                                            "episode": ep}, headers=AUTH)
    view = wait_import(client, r.json()["import"]["id"])
    assert view["etat"] == "termine" and view["album"] == "Les Ondes Libres", view
    assert client.post("/music/imports", json={"url": "https://podcast.example.org/feed.xml", "type": "podcast"},
                       headers=AUTH).json()["error"] == "episode_requis"


def test_apple_podcast_link_uses_the_public_feed(mc: tuple[TestClient, FakeWeb], sounds: Path) -> None:
    client, web = mc
    data = make_audio(sounds, "mp3").read_bytes()
    web.add("itunes.apple.com", "/lookup", jreply({"resultCount": 1, "results": [
        {"wrapperType": "track", "kind": "podcast", "feedUrl": "https://podcast.example.org/feed.xml"}]}))
    web.add("podcast.example.org", "/feed.xml", (200, {"content-type": "text/xml"}, rss("https://cdn.example.org/ep1.mp3", len(data))))
    f = analyse(client, "https://podcasts.apple.com/fr/podcast/les-ondes/id1234567").json()["fiche"]
    assert f["connecteur"] == "podcast" and f["via"] == "apple_podcasts" and f["etat"] == "telechargeable"


def test_podcast_feed_with_entities_is_refused(mc: tuple[TestClient, FakeWeb]) -> None:
    client, web = mc
    bomb = b'<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><rss version="2.0"><channel><title>&lol2;</title></channel></rss>'
    web.add("feeds.example.org", "/bomb", (200, {"content-type": "application/xml"}, bomb))
    r = analyse(client, "https://feeds.example.org/bomb", type="podcast")
    assert r.status_code == 422 and r.json()["error"] == "flux_invalide"
    web.add("feeds.example.org", "/html", (200, {"content-type": "text/html"}, b"<html><body>no</body></html>"))
    assert analyse(client, "https://feeds.example.org/html", type="podcast").status_code == 422


def test_podcast_enclosure_on_a_streaming_host_is_refused(mc: tuple[TestClient, FakeWeb]) -> None:
    client, web = mc
    web.add("podcast.example.org", "/feed.xml", (200, {"content-type": "application/rss+xml"},
                                                 rss("https://p.scdn.co/mp3-preview/abc", 1000)))
    f = analyse(client, "https://podcast.example.org/feed.xml").json()["fiche"]
    r = client.post("/music/imports", json={"url": "https://podcast.example.org/feed.xml", "type": "podcast",
                                            "episode": f["pistes"][0]["id"]}, headers=AUTH)
    assert r.status_code == 202
    view = wait_import(client, r.json()["import"]["id"])
    assert view["etat"] == "echec" and view["erreur"]["code"] == "telechargement_non_autorise"
    assert "p.scdn.co" not in web.hosts()


def test_direct_file_needs_the_declaration_of_rights(mc: tuple[TestClient, FakeWeb], sounds: Path) -> None:
    client, web = mc
    data = make_audio(sounds, "flac").read_bytes()
    web.add("files.example.org", "/mes-sons/demo.flac", (200, {"content-type": "audio/flac", "content-length": str(len(data))}, data))
    f = analyse(client, "https://files.example.org/mes-sons/demo.flac").json()["fiche"]
    assert f["connecteur"] == "fichier" and f["licence"]["code"] == "declaree"
    imp = next(a for a in f["actions"] if a["id"] == "importer")
    assert imp["attestationRequise"] is True and "droits nécessaires" in imp["attestation"]
    r = client.post("/music/imports", json={"url": "https://files.example.org/mes-sons/demo.flac"}, headers=AUTH)
    assert r.status_code == 400 and r.json()["error"] == "attestation_requise"
    r = client.post("/music/imports", json=imp["requete"]["corps"], headers=AUTH)
    assert r.status_code == 400 and r.json()["error"] == "attestation_requise"  # corps proposé tel quel : refusé
    r = client.post("/music/imports", json={**imp["requete"]["corps"], "attestation": True}, headers=AUTH)
    view = wait_import(client, r.json()["import"]["id"])
    assert view["etat"] == "termine" and view["attestation"] is True and view["fichier"]["audio"]["sansPerte"] is True


def test_direct_file_type_size_and_switch(mk: Callable[..., tuple[TestClient, FakeWeb]], sounds: Path) -> None:
    client, web = mk(music_max_file_mb=1)
    web.add("files.example.org", "/page.mp3", (200, {"content-type": "text/html"}, b"<html>pas un son</html>"))
    r = analyse(client, "https://files.example.org/page.mp3")
    assert r.status_code == 415 and r.json()["error"] == "type_refuse"
    big = b"ID3" + b"\0" * 64
    web.add("files.example.org", "/gros.mp3", (206, {"content-type": "audio/mpeg", "content-range": "bytes 0-63/5000000"}, big))
    r = client.post("/music/imports", json={"url": "https://files.example.org/gros.mp3", "type": "fichier",
                                            "attestation": True}, headers=AUTH)
    assert r.status_code == 413 and r.json()["error"] == "fichier_trop_volumineux"
    web.add("files.example.org", "/liste.m3u8", (200, {"content-type": "application/vnd.apple.mpegurl"}, b"#EXTM3U"))
    r = analyse(client, "https://files.example.org/liste.m3u8", type="fichier")
    assert r.status_code == 403 and r.json()["error"] == "telechargement_non_autorise"
    off, _ = mk(music_direct_files=False)
    install(off)
    r = analyse(off, "https://files.example.org/demo.flac")
    assert r.status_code == 403 and r.json()["error"] == "connecteur_coupe"


def test_duration_limit_and_temporary_disk_budget(mk: Callable[..., tuple[TestClient, FakeWeb]], sounds: Path) -> None:
    client, web = mk(music_max_duration_s=1)
    data = make_audio(sounds, "mp3").read_bytes()
    web.add("files.example.org", "/long.mp3", (200, {"content-type": "audio/mpeg"}, data))
    r = client.post("/music/imports", json={"url": "https://files.example.org/long.mp3", "attestation": True}, headers=AUTH)
    view = wait_import(client, r.json()["import"]["id"])
    assert view["etat"] == "echec" and view["erreur"]["code"] == "duree_trop_longue"
    client, web = mk(music_disk_max_mb=1, music_max_file_mb=1)
    web.add("files.example.org", "/inconnu.mp3", (200, {"content-type": "audio/mpeg"}, data))
    r = client.post("/music/imports", json={"url": "https://files.example.org/inconnu.mp3", "attestation": True}, headers=AUTH)
    assert r.status_code == 503 and r.json()["error"] == "espace_temporaire_plein"  # 2 x 1 Mo > budget of 1 Mo


# --- user keys, isolation, cloud ----------------------------------------------------------------------------------

@pytest.fixture
def cloud_music(make_client: Callable[..., TestClient], tmp_path: Path) -> Iterator[tuple[TestClient, FakeWeb, CloudAccount]]:
    storage = FakeStorage()
    account = CloudAccount(storage)
    account.url = account.start()  # type: ignore[attr-defined]
    token_file = tmp_path / "account_internal_token"
    token_file.write_text(INTERNAL)
    client = make_client(user_keys_enabled=True, account_internal_url=account.url,  # type: ignore[attr-defined]
                         account_internal_token_file=token_file, user_key_cache_s=0.0, cloud_sync=True,
                         cloud_sync_allow_http=True, music_enabled=True)
    yield client, install(client), account
    account.stop()
    storage.stop()


def test_admin_import_is_backed_up_with_its_record_and_others_are_isolated(
        cloud_music: tuple[TestClient, FakeWeb, CloudAccount], sounds: Path) -> None:
    client, web, account = cloud_music
    data = make_audio(sounds, "mp3").read_bytes()
    archive_setup(web, data, "https://creativecommons.org/licenses/by/4.0/")
    r = client.post("/music/imports", json={"url": "https://archive.org/details/gymnopedie-libre"}, headers=bearer(KEY_A))
    assert r.status_code == 202, r.text
    job_id = r.json()["import"]["id"]
    view = wait_import(client, job_id, bearer(KEY_A))
    assert view["etat"] == "termine"
    deadline = time.time() + 10
    while time.time() < deadline and (view.get("cloud") or {}).get("etat") != "sauvegarde":
        time.sleep(0.05)
        view = client.get(f"/music/imports/{job_id}", headers=bearer(KEY_A)).json()["import"]
    assert view["cloud"] == {"etat": "sauvegarde", "libelle": "Sauvegardé", "raison": None}
    offer = next(iter(account.offers.values()))
    assert offer["job_id"] == job_id and offer["plateforme"] == "archive" and offer["type"] == "audio/mpeg"
    rec = offer["meta"]["musique"]
    assert rec["licence"]["code"] == "cc-by" and rec["sourceUrl"] == "https://archive.org/details/gymnopedie-libre"
    assert rec["titre"] == "Gymnopédie n° 1" and rec["audio"]["codec"] == "mp3" and "Internet Archive" in rec["attribution"]
    stored = next(iter(account.storage.objects.values()))
    assert hashlib.sha256(stored).hexdigest() == offer["sha256"]
    # another user never sees (nor cancels, nor downloads) this import
    assert client.get(f"/music/imports/{job_id}", headers=bearer(KEY_B)).status_code == 404
    assert client.get(f"/music/imports/{job_id}/fichier", headers=bearer(KEY_B)).status_code == 404
    assert client.delete(f"/music/imports/{job_id}", headers=bearer(KEY_B)).status_code == 404
    assert client.get("/music/imports", headers=bearer(KEY_B)).json()["imports"] == []
    # user B (not an administrator): imported, never sent to the cloud, no cloud line shown
    r = client.post("/music/imports", json={"url": "https://archive.org/details/gymnopedie-libre"}, headers=bearer(KEY_B))
    vb = wait_import(client, r.json()["import"]["id"], bearer(KEY_B))
    time.sleep(0.3)
    vb = client.get(f"/music/imports/{vb['id']}", headers=bearer(KEY_B)).json()["import"]
    assert vb["etat"] == "termine" and vb["cloud"] is None and len(account.offers) == 1


def test_cloud_quota_reached_keeps_the_import(cloud_music: tuple[TestClient, FakeWeb, CloudAccount], sounds: Path) -> None:
    client, web, account = cloud_music
    original = account.handle

    def full(path: str, token: str | None, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        if path == "/internal/v1/cloud/offre":
            return 200, {"sauvegarder": False, "raison": "quota_atteint"}
        return original(path, token, body)
    account.handle = full  # type: ignore[method-assign]
    data = make_audio(sounds, "mp3").read_bytes()
    archive_setup(web, data, "https://creativecommons.org/publicdomain/zero/1.0/")
    r = client.post("/music/imports", json={"url": "https://archive.org/details/gymnopedie-libre"}, headers=bearer(KEY_A))
    job_id = r.json()["import"]["id"]
    wait_import(client, job_id, bearer(KEY_A))
    deadline = time.time() + 5
    view: dict[str, Any] = {}
    while time.time() < deadline:
        view = client.get(f"/music/imports/{job_id}", headers=bearer(KEY_A)).json()["import"]
        if (view.get("cloud") or {}).get("etat") == "non_sauvegarde":
            break
        time.sleep(0.05)
    assert view["etat"] == "termine" and view["cloud"]["raison"] == "quota_atteint"
    assert client.get(view["fichier"]["url"], headers=bearer(KEY_A)).status_code == 200


def test_cancel_a_queued_import_and_delete_a_finished_one(mk: Callable[..., tuple[TestClient, FakeWeb]], sounds: Path) -> None:
    client, web = mk(music_max_concurrent=1)
    data = make_audio(sounds, "mp3").read_bytes()
    gate = {"open": False}

    def slow(method: str, path: str, headers: dict[str, str]) -> Any:
        deadline = time.time() + 5
        while not gate["open"] and time.time() < deadline:
            time.sleep(0.02)
        return 200, {"content-type": "audio/mpeg"}, data
    web.add("files.example.org", "/lent.mp3", slow)
    first = client.post("/music/imports", json={"url": "https://files.example.org/lent.mp3", "attestation": True}, headers=AUTH)
    second = client.post("/music/imports", json={"url": "https://files.example.org/lent.mp3", "attestation": True}, headers=AUTH)
    sid = second.json()["import"]["id"]
    assert client.get(f"/music/imports/{sid}", headers=AUTH).json()["import"]["etat"] == "en_file"
    r = client.delete(f"/music/imports/{sid}", headers=AUTH)
    assert r.status_code == 200
    assert wait_import(client, sid)["etat"] == "annule"
    gate["open"] = True
    fid = first.json()["import"]["id"]
    assert wait_import(client, fid)["etat"] == "termine"
    music = client.app.state.music  # type: ignore[attr-defined]
    workdir = music.imports.jobs[fid].workdir
    assert workdir.exists() and not music.imports.jobs[sid].workdir.exists()
    assert client.delete(f"/music/imports/{fid}", headers=AUTH).json()["supprime"] is True
    assert not workdir.exists() and client.get(f"/music/imports/{fid}", headers=AUTH).status_code == 404
    assert music.imports.reserved == 0


# --- matching ------------------------------------------------------------------------------------------------------

def test_matching_rules() -> None:
    cands = [Candidat.parse(c) for c in [
        {"ref": "a", "titre": "Clair de lune", "artistes": ["Claude Debussy"], "dureeS": 300, "isrc": "FRAAA0000001"},
        {"ref": "b", "titre": "Gymnopédie n°1", "artistes": ["Erik Satie"], "dureeS": 185},
        {"ref": "c", "titre": "Nocturne", "artistes": ["Chopin"], "dureeS": 250, "isrc": "PLAAA0000009"},
    ]]
    rows = match([
        {"titre": "Totalement autre", "artistes": ["X"], "dureeS": 100, "isrc": "FRAAA0000001"},  # same ISRC
        {"titre": "Gymnopedie No. 1 (Remastered 2011)", "artistes": ["Erik Satie"], "dureeS": 186, "isrc": None},
        {"titre": "Nocturne", "artistes": ["Chopin"], "dureeS": 251, "isrc": "PLBBB0000001"},  # other recording
        {"titre": "Inconnu au bataillon", "artistes": ["Personne"], "dureeS": 120, "isrc": None},
    ], [c for c in cands if c])
    assert rows[0]["correspondance"]["ref"] == "a" and rows[0]["correspondance"]["methode"] == "isrc"
    assert rows[1]["correspondance"]["ref"] == "b" and rows[1]["correspondance"]["confiance"] == "sure"
    assert rows[2]["correspondance"]["confiance"] == "probable"
    assert rows[3]["etat"] == "identifie" and rows[3]["correspondance"] is None
    assert Candidat.parse({"ref": "", "titre": "x"}) is None and Candidat.parse({"ref": "x"}) is None


def test_correspondances_route_and_body_limit(mc: tuple[TestClient, FakeWeb]) -> None:
    client, web = mc
    cands = [{"ref": f"bib:{i}", "titre": f"Titre numéro {i}", "artistes": ["Artiste"], "dureeS": 200} for i in range(5000)]
    r = client.post("/music/correspondances", json={"pistes": [{"titre": "Titre numéro 4242", "artistes": ["Artiste"],
                                                                 "dureeS": 201}], "candidats": cands}, headers=AUTH)
    assert r.status_code == 200, r.text  # > 64 Ko of library listing accepted on this route
    assert r.json()["pistes"][0]["correspondance"]["ref"] == "bib:4242" and r.json()["telechargements"] == 0
    huge = "x" * (3 * 1024 * 1024)
    r = client.post("/music/correspondances", content=huge, headers={**AUTH, "content-type": "application/json"})
    assert r.status_code == 413
    r = client.post("/music/analyser", content="x" * (100 * 1024), headers={**AUTH, "content-type": "application/json"})
    assert r.status_code == 413  # the other routes keep the 64 Ko limit
    assert web.calls == []


# --- the guarantee: no path downloads from a commercial catalogue -------------------------------------------------

def test_no_download_path_reaches_a_commercial_catalogue(mc: tuple[TestClient, FakeWeb]) -> None:
    client, web = mc
    music = client.app.state.music  # type: ignore[attr-defined]
    catalogue_hosts = ["open.spotify.com", "p.scdn.co", "audio-ssl.itunes.apple.com", "music.apple.com",
                       "is1-ssl.mzstatic.com", "soundcloud.com", "cf-media.sndcdn.com", "cf-hls-media.sndcdn.com",
                       "www.deezer.com", "cdnt-preview.dzcdn.net", "music.youtube.com", "rr1---sn-a.googlevideo.com",
                       "www.youtube.com", "bcbits.com", "t4.bcbits.com"]
    # 1. every download policy (archive, commons, podcast/direct) refuses them
    for policy in (ARCHIVE_FILES, COMMONS_FILES, ANY_PUBLIC):
        for host in catalogue_hosts:
            with pytest.raises(ApiError):
                check_url(f"https://{host}/a.mp3", policy)
    # 2. catalogue connectors have no import path at all
    for cid in ("spotify", "apple", "soundcloud", "deezer"):
        c = music.by_id[cid]
        assert c.famille == "catalogue"
        assert type(c).plan_import is Connector.plan_import  # the base one: always 403
    # 3. even a forged plan pointing at a CDN fails at the first hop
    plan = ImportPlan("fichier", Fichier("x.mp3", "https://p.scdn.co/mp3-preview/x", "mp3", "audio/mpeg"), ANY_PUBLIC,
                      licences.DECLARED, "x")
    job = client.portal.call(music.imports.create, Principal(kind="admin", label="t"), plan)  # type: ignore[union-attr]
    view = wait_import(client, job.id)
    assert view["etat"] == "echec" and view["erreur"]["code"] == "telechargement_non_autorise"
    # 4. streaming manifests are refused whatever the host
    for path in ("/live.m3u8", "/manifest.mpd", "/radio.pls"):
        with pytest.raises(ApiError):
            check_url(f"https://cdn.example.org{path}", ANY_PUBLIC)
    assert web.calls == [] or all(not any(h in u for h in catalogue_hosts) for _, u in web.calls)
    # 5. the music package never imports yt-dlp, the worker or a subprocess downloader
    for src in Path("app/music").glob("*.py"):
        tree = ast.parse(src.read_text())
        names = {a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names} | \
                {n.module or "" for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
        assert not any(m and (m.startswith("yt_dlp") or m.endswith("worker") or m.endswith("runner") or "spotdl" in m
                              or "spotipy" in m) for m in names), src
    assert {"spotify.com", "scdn.co", "apple.com", "mzstatic.com", "soundcloud.com", "sndcdn.com", "deezer.com",
            "dzcdn.net", "music.youtube.com", "googlevideo.com"} <= set(BLOCKED_SUFFIXES)


@pytest.mark.parametrize("address", ["127.0.0.1", "10.1.2.3", "192.168.1.10", "172.18.0.5", "169.254.169.254",
                                     "100.64.0.1", "::1", "fd00::1", "0.0.0.0"])
def test_private_addresses_are_refused(address: str) -> None:
    with pytest.raises(ApiError) as err:
        public_address(address, 443)
    assert err.value.code == "source_refusee"


def test_url_policy_rules() -> None:
    for url in ("http://cdn.example.org/a.mp3", "https://cdn.example.org:8443/a.mp3", "https://u:p@cdn.example.org/a.mp3",
                "file:///etc/passwd", "gopher://x/a"):
        with pytest.raises(ApiError):
            check_url(url, ANY_PUBLIC)
    assert check_url("https://cdn.example.org/a.mp3", ANY_PUBLIC)[1] == "cdn.example.org"
    only_archive = HostPolicy.api("archive.org", suffixes=(".archive.org",))
    assert check_url("https://ia600.us.archive.org/x.mp3", only_archive)
    with pytest.raises(ApiError):
        check_url("https://cdn.example.org/a.mp3", only_archive)
