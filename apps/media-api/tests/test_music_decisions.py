"""AETHRYON Music — décisions du propriétaire du 2026-10-23 (MUSIC-RAPPORT.md, « Décisions du propriétaire ») :

2. les aperçus Apple Music de 30 s sont gardés, toujours présentés comme aperçu et TOUJOURS accompagnés du lien
   « Ouvrir dans Apple Music » : un aperçu ne sort jamais de l'API sans son lien ;
3. l'import d'un fichier audio direct est ouvert à TOUS les comptes connectés, avec la déclaration de droits obligatoire
   (refus sans elle) ; la sauvegarde Cloud reste réservée à l'administrateur.
(La décision 1, YouTube Music fermé au convertisseur, est dans tests/test_youtube_music_closed.py.)
"""

from __future__ import annotations

import hashlib
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.music.model import Fiche, action_apercu, action_ouvrir, ajouter_apercu, garantir_lien_apercu, lien_ouvrir
from tests.music_fakes import FakeWeb, jreply, make_audio
from tests.test_cloud_sync import CloudAccount
from tests.test_music import AUTH, analyse, cloud_music, itunes_song, mc, mk, sounds, wait_import  # noqa: F401 - fixtures
from tests.test_user_keys import KEY_A, KEY_B, bearer

OUVRIR_APPLE = "Ouvrir dans Apple Music"
SONG_URL = "https://music.apple.com/fr/album/gymnopedies/1440833098?i=1440833103"


def assert_preview_has_its_link(fiche: dict[str, Any], service: str = "Apple Music") -> None:
    """L'invariant de la décision 2, sur une fiche telle que l'API la renvoie."""
    actions = {a["id"]: a for a in fiche["actions"]}
    if "apercu" not in actions:
        assert "Preview" not in fiche["capacites"], "capacité Preview annoncée sans aperçu"
        return
    ouvrir, apercu = actions.get("ouvrir"), actions["apercu"]
    assert ouvrir is not None, "aperçu renvoyé sans le bouton « Ouvrir dans … »"
    assert ouvrir["libelle"] == f"Ouvrir dans {service}" and ouvrir["url"].startswith("https://")
    assert apercu["lien"] == {"libelle": ouvrir["libelle"], "url": ouvrir["url"]}  # champ lien obligatoire, même adresse
    assert "Preview" in fiche["capacites"]
    assert apercu["libelle"] == "Aperçu de 30 s" and apercu["dureeS"] == 30 and apercu["lectureSeulement"] is True
    assert "pas le morceau complet" in apercu["note"] and ouvrir["libelle"] in apercu["note"]
    ids = [a["id"] for a in fiche["actions"]]
    assert ids.index("ouvrir") < ids.index("apercu"), "le lien vient avant l'aperçu"


# --- décision 2 : l'aperçu Apple de 30 s ne sort jamais sans « Ouvrir dans Apple Music » ----------------------------

def test_apple_preview_always_comes_with_the_open_in_apple_music_button(mc: tuple[TestClient, FakeWeb]) -> None:
    client, web = mc
    web.add("itunes.apple.com", "/lookup", jreply(itunes_song()))
    f = analyse(client, SONG_URL).json()["fiche"]
    assert_preview_has_its_link(f)
    canonical = "https://music.apple.com/fr/album/1440833098?i=1440833103"  # lien canonique du morceau (sans le nom dans l'adresse)
    ouvrir = next(a for a in f["actions"] if a["id"] == "ouvrir")
    assert f["url"] == canonical and ouvrir["libelle"] == OUVRIR_APPLE and ouvrir["url"] == canonical
    apercu = next(a for a in f["actions"] if a["id"] == "apercu")
    assert apercu["lien"] == {"libelle": OUVRIR_APPLE, "url": canonical}
    assert apercu["mention"] == "Aperçu fourni par iTunes" and apercu["fournisseur"] == "Apple (iTunes)"
    # même fiche par un autre lien Apple du même morceau (?i= d'un album, /song/) : toujours accompagnée
    web.add("itunes.apple.com", "/lookup", jreply(itunes_song()))
    assert_preview_has_its_link(analyse(client, "https://music.apple.com/fr/song/gymnopedie/1440833103").json()["fiche"])


def test_every_apple_search_result_with_a_preview_has_its_link(mc: tuple[TestClient, FakeWeb]) -> None:
    client, web = mc
    results = []
    for n in range(1, 8):
        song = itunes_song(preview=n % 2 == 1)["results"][0] | {"trackId": 1000 + n, "collectionId": 2000 + n, "trackName": f"Titre {n}"}
        results.append(song)
    web.add("itunes.apple.com", "/search", jreply({"resultCount": len(results), "results": results}))
    r = client.get("/music/rechercher", params={"q": "satie", "source": "apple"}, headers=AUTH)
    assert r.status_code == 200
    fiches = r.json()["resultats"]
    assert len(fiches) == 7
    with_preview = [f for f in fiches if any(a["id"] == "apercu" for a in f["actions"])]
    assert len(with_preview) == 4 and len(fiches) - len(with_preview) == 3  # impairs : aperçu ; pairs : aucun
    for f in fiches:
        assert_preview_has_its_link(f)
        ouvrir = next(a for a in f["actions"] if a["id"] == "ouvrir")
        assert ouvrir["url"] == f"https://music.apple.com/fr/album/{f['url'].split('/album/')[1]}"  # lien de CE morceau


def test_apple_previews_switched_off_never_return_a_preview_nor_the_capability(mk: Callable[..., tuple[TestClient, FakeWeb]]) -> None:
    client, web = mk(music_apple_previews=False)
    web.add("itunes.apple.com", "/lookup", jreply(itunes_song()))
    f = analyse(client, SONG_URL).json()["fiche"]
    assert all(a["id"] != "apercu" for a in f["actions"]) and "Preview" not in f["capacites"]
    assert any(a["id"] == "ouvrir" for a in f["actions"])  # le bouton reste, c'est le lien officiel
    web.add("itunes.apple.com", "/search", jreply(itunes_song()))
    for fiche in client.get("/music/rechercher", params={"q": "x", "source": "apple"}, headers=AUTH).json()["resultats"]:
        assert_preview_has_its_link(fiche)
        assert all(a["id"] != "apercu" for a in fiche["actions"])
    info = {c["id"]: c for c in client.get("/music/connecteurs", headers=AUTH).json()["connecteurs"]}["apple"]
    assert "Preview" not in info["capacites"]


def test_deezer_preview_has_the_same_guarantee(mk: Callable[..., tuple[TestClient, FakeWeb]]) -> None:
    client, web = mk(music_deezer_api=True)
    web.add("api.deezer.com", "/track/3135556", jreply({"title": "Harder", "duration": 224, "isrc": "GBDUW0000059",
                                                        "artist": {"name": "Daft"}, "album": {"title": "D", "cover_xl": "https://e-cdns-images.dzcdn.net/x.jpg"},
                                                        "preview": "https://cdnt-preview.dzcdn.net/x.mp3"}))
    f = analyse(client, "https://www.deezer.com/fr/track/3135556").json()["fiche"]
    assert_preview_has_its_link(f, "Deezer")


def test_the_model_refuses_a_preview_without_its_link() -> None:
    lien = {"libelle": OUVRIR_APPLE, "url": SONG_URL}
    ok = action_apercu("https://audio-ssl.itunes.apple.com/x.m4a", "Apple (iTunes)", "Aperçu fourni par iTunes", lien)
    assert ok["lien"] == lien and ok["dureeS"] == 30
    for bad in ({}, {"libelle": OUVRIR_APPLE}, {"url": SONG_URL}, {"libelle": OUVRIR_APPLE, "url": "http://music.apple.com/x"},
                {"libelle": "", "url": SONG_URL}, None):
        with pytest.raises(ValueError):
            action_apercu("https://audio-ssl.itunes.apple.com/x.m4a", "Apple (iTunes)", "m", bad)  # type: ignore[arg-type]
    # ajouter_apercu : pas de lien officiel sur la fiche (ou lien non https) → aucun aperçu, aucune capacité
    for actions in ([], [{"id": "enregistrer_lien"}], [{"id": "ouvrir", "libelle": OUVRIR_APPLE}],
                    [action_ouvrir("dans Apple Music", "http://music.apple.com/x")], [action_ouvrir("dans Apple Music", "javascript:alert(1)")]):
        fiche = Fiche("apple", "titre", "1", SONG_URL, actions=list(actions), capacites=["Metadata"])
        assert ajouter_apercu(fiche, "https://audio-ssl.itunes.apple.com/x.m4a", "Apple (iTunes)", "m") is False
        assert fiche.actions == actions and fiche.capacites == ["Metadata"]
    fiche = Fiche("apple", "titre", "1", SONG_URL, actions=[action_ouvrir("dans Apple Music", SONG_URL)], capacites=["Metadata"])
    assert ajouter_apercu(fiche, "http://insecure.example/x.m4a", "Apple (iTunes)", "m") is False  # aperçu non https refusé
    assert ajouter_apercu(fiche, "https://audio-ssl.itunes.apple.com/x.m4a", "Apple (iTunes)", "m") is True
    assert [a["id"] for a in fiche.actions] == ["ouvrir", "apercu"] and fiche.capacites == ["Metadata", "Preview"]
    assert lien_ouvrir(fiche.actions) == {"libelle": OUVRIR_APPLE, "url": SONG_URL}


def test_the_last_guard_strips_any_preview_that_would_leave_without_its_link() -> None:
    lien = {"libelle": OUVRIR_APPLE, "url": SONG_URL}
    apercu = action_apercu("https://audio-ssl.itunes.apple.com/x.m4a", "Apple (iTunes)", "m", lien)
    ouvrir = action_ouvrir("dans Apple Music", SONG_URL)
    # sain : inchangé
    actions, caps = garantir_lien_apercu([ouvrir, apercu], ["Metadata", "Preview"])
    assert actions == [ouvrir, apercu] and caps == ["Metadata", "Preview"]
    # le bouton a disparu, le champ lien manque, ou il pointe ailleurs : l'aperçu et la capacité partent
    no_link = {k: v for k, v in apercu.items() if k != "lien"}
    elsewhere = apercu | {"lien": {"libelle": OUVRIR_APPLE, "url": "https://music.apple.com/fr/album/autre/1"}}
    for actions_in in ([apercu], [ouvrir, no_link], [ouvrir, elsewhere], [action_ouvrir("dans Apple Music", "http://x.example/"), apercu]):
        out, caps = garantir_lien_apercu(list(actions_in), ["Metadata", "Preview"])
        assert all(a["id"] != "apercu" for a in out) and caps == ["Metadata"], actions_in
    # et par la sérialisation de n'importe quelle fiche
    fiche = Fiche("apple", "titre", "1", SONG_URL, titre="X", capacites=["Metadata", "Preview"], actions=[no_link])
    j = fiche.to_json()
    assert j["actions"] == [] and "Preview" not in j["capacites"]


# --- décision 3 : fichier audio direct, tous les comptes connectés, déclaration de droits obligatoire ----------------

FILE_URL = "https://files.example.org/mes-sons/demo.flac"


def serve_file(web: FakeWeb, sounds: Path) -> bytes:
    data = make_audio(sounds, "flac").read_bytes()
    web.add("files.example.org", "/mes-sons/demo.flac",
            (200, {"content-type": "audio/flac", "content-length": str(len(data))}, data))
    return data


def settle_cloud(client: TestClient, job_id: str, headers: dict[str, str], wanted: str, timeout: float = 10.0) -> dict[str, Any]:
    deadline = time.time() + timeout
    view: dict[str, Any] = {}
    while time.time() < deadline:
        view = client.get(f"/music/imports/{job_id}", headers=headers).json()["import"]
        if (view.get("cloud") or {}).get("etat") == wanted:
            break
        time.sleep(0.05)
    return view


def test_an_ordinary_account_imports_a_direct_file_with_its_declaration_and_gets_no_cloud(
        cloud_music: tuple[TestClient, FakeWeb, CloudAccount], sounds: Path) -> None:
    client, web, account = cloud_music
    data = serve_file(web, sounds)
    # analyse puis import avec la requête que la fiche propose (celle qu'enverra le Desktop)
    f = analyse(client, FILE_URL, bearer(KEY_B)).json()["fiche"]
    assert f["connecteur"] == "fichier" and f["etat"] == "telechargeable" and f["licence"]["code"] == "declaree"
    imp = next(a for a in f["actions"] if a["id"] == "importer")
    assert imp["attestationRequise"] is True and imp["requete"]["corps"] == {"url": FILE_URL, "type": "fichier"}
    # le corps proposé, renvoyé tel quel, ne vaut pas déclaration : refusé avant tout travail
    r = client.post("/music/imports", json=imp["requete"]["corps"], headers=bearer(KEY_B))
    assert r.status_code == 400 and r.json()["error"] == "attestation_requise", r.text
    r = client.post("/music/imports", json={**imp["requete"]["corps"], "attestation": True}, headers=bearer(KEY_B))
    assert r.status_code == 202, r.text
    job_id = r.json()["import"]["id"]
    view = wait_import(client, job_id, bearer(KEY_B))
    assert view["etat"] == "termine" and view["attestation"] is True and view["connecteur"] == "fichier"
    assert view["licence"]["code"] == "declaree" and view["fichier"]["audio"]["sansPerte"] is True
    time.sleep(0.4)  # laisse à ytapi le temps de proposer (et à account de refuser) la sauvegarde
    view = client.get(f"/music/imports/{job_id}", headers=bearer(KEY_B)).json()["import"]
    assert view["cloud"] is None, "aucune ligne cloud pour un compte ordinaire"
    assert account.offers == {}, "rien n'est envoyé au cloud pour un compte ordinaire"
    got = client.get(view["fichier"]["url"], headers=bearer(KEY_B))
    # le fichier est bien à lui (même audio, étiquettes en plus : donc pas les mêmes octets que la source)…
    assert got.status_code == 200 and got.content.startswith(b"fLaC") and len(got.content) == view["fichier"]["taille"]
    assert len(got.content) > len(data) // 2
    assert client.get(f"/music/imports/{job_id}/fichier", headers=bearer(KEY_A)).status_code == 404  # …et à lui seul


def test_the_declaration_of_rights_is_required_for_every_account(
        cloud_music: tuple[TestClient, FakeWeb, CloudAccount], sounds: Path) -> None:
    client, web, account = cloud_music
    serve_file(web, sounds)
    web.calls.clear()
    for who in (bearer(KEY_B), bearer(KEY_A), AUTH):  # compte ordinaire, administrateur du site, jeton d'administration d'ytapi
        for body in ({"url": FILE_URL, "type": "fichier"}, {"url": FILE_URL, "type": "fichier", "attestation": False},
                     {"url": FILE_URL, "type": "fichier", "attestation": None}, {"url": FILE_URL, "type": "fichier", "attestation": "true"},
                     {"url": FILE_URL, "type": "fichier", "attestation": 1}, {"url": FILE_URL, "type": "fichier", "attestation": "oui"},
                     {"url": FILE_URL, "type": "fichier", "attestation": ["true"]}):
            r = client.post("/music/imports", json=body, headers=who)
            assert r.status_code == 400 and r.json()["error"] == "attestation_requise", (who, body, r.text)
            assert "droits" in r.json()["detail"]
    assert web.calls == [], "refus avant toute requête vers le fichier"
    assert client.get("/music/imports", headers=bearer(KEY_B)).json()["imports"] == []
    assert client.get("/music/imports", headers=bearer(KEY_A)).json()["imports"] == []
    assert account.offers == {}
    # l'adresse devinée par son extension (sans « type ») est soumise à la même règle
    r = client.post("/music/imports", json={"url": FILE_URL}, headers=bearer(KEY_B))
    assert r.status_code == 400 and r.json()["error"] == "attestation_requise"


def test_the_administrator_import_of_a_direct_file_goes_to_the_cloud_with_its_declaration(
        cloud_music: tuple[TestClient, FakeWeb, CloudAccount], sounds: Path) -> None:
    client, web, account = cloud_music
    serve_file(web, sounds)
    r = client.post("/music/imports", json={"url": FILE_URL, "type": "fichier", "attestation": True}, headers=bearer(KEY_A))
    assert r.status_code == 202, r.text
    job_id = r.json()["import"]["id"]
    wait_import(client, job_id, bearer(KEY_A))
    view = settle_cloud(client, job_id, bearer(KEY_A), "sauvegarde")
    assert view["cloud"] == {"etat": "sauvegarde", "libelle": "Sauvegardé", "raison": None}
    assert len(account.offers) == 1
    offer = next(iter(account.offers.values()))
    assert offer["job_id"] == job_id and offer["plateforme"] == "fichier" and offer["type"] == "audio/flac"
    rec = offer["meta"]["musique"]
    assert rec["connecteur"] == "fichier" and rec["attestation"] is True and rec["licence"]["code"] == "declaree"
    stored = next(iter(account.storage.objects.values()))
    assert hashlib.sha256(stored).hexdigest() == offer["sha256"] and stored.startswith(b"fLaC")  # ce que le cloud a reçu


def test_two_accounts_import_side_by_side_each_with_its_own_limits(
        cloud_music: tuple[TestClient, FakeWeb, CloudAccount], sounds: Path) -> None:
    client, web, account = cloud_music
    data = serve_file(web, sounds)
    gate = {"open": False}

    def slow(method: str, path: str, headers: dict[str, str]) -> tuple[int, dict[str, str], bytes]:
        deadline = time.time() + 10
        while "Range" not in headers and not gate["open"] and time.time() < deadline:  # la vérification passe, le transfert attend
            time.sleep(0.02)
        return 200, {"content-type": "audio/flac", "content-length": str(len(data))}, data
    web.add("files.example.org", "/mes-sons/demo.flac", slow)
    body = {"url": FILE_URL, "type": "fichier", "attestation": True}
    try:
        first = [client.post("/music/imports", json=body, headers=bearer(KEY_B)) for _ in range(2)]
        assert [r.status_code for r in first] == [202, 202]  # 2 imports simultanés par compte (MUSIC_MAX_ACTIVE_PER_USER)
        third = client.post("/music/imports", json=body, headers=bearer(KEY_B))
        assert third.status_code == 429 and third.json()["error"] == "trop_d_imports"
        other = client.post("/music/imports", json=body, headers=bearer(KEY_A))
        assert other.status_code == 202, "la limite est par compte : l'autre compte n'est pas bloqué"
    finally:
        gate["open"] = True
    for r in first:
        assert wait_import(client, r.json()["import"]["id"], bearer(KEY_B))["etat"] == "termine"


def test_the_direct_file_switch_closes_it_for_every_account(
        mk: Callable[..., tuple[TestClient, FakeWeb]], sounds: Path) -> None:
    client, web = mk(music_direct_files=False)
    serve_file(web, sounds)
    r = client.post("/music/imports", json={"url": FILE_URL, "type": "fichier", "attestation": True}, headers=AUTH)
    assert r.status_code == 403 and r.json()["error"] == "connecteur_coupe"
    assert analyse(client, FILE_URL).status_code == 403
    info = {c["id"]: c for c in client.get("/music/connecteurs", headers=AUTH).json()["connecteurs"]}["fichier"]
    assert info["actif"] is False and info["capacites"] == []


def test_the_proposed_import_body_never_carries_the_declaration(
        cloud_music: tuple[TestClient, FakeWeb, CloudAccount], sounds: Path) -> None:
    """Correctif 3.8 : ytapi ne pré-remplit plus « attestation » ; renvoyer le corps tel quel (ou avec false, "true", 1) est
    refusé, sans aucun téléchargement de la source."""
    client, web, _ = cloud_music
    serve_file(web, sounds)
    f = analyse(client, FILE_URL, bearer(KEY_B)).json()["fiche"]
    for a in f["actions"]:
        assert "attestation" not in ((a.get("requete") or {}).get("corps") or {}), a
    imp = next(a for a in f["actions"] if a["id"] == "importer")
    calls_before = len(web.calls)
    for extra in ({}, {"attestation": False}, {"attestation": "true"}, {"attestation": 1}, {"attestation": None}):
        r = client.post("/music/imports", json={**imp["requete"]["corps"], **extra}, headers=bearer(KEY_B))
        assert r.status_code == 400 and r.json()["error"] == "attestation_requise", (extra, r.text)
    assert len(web.calls) == calls_before, "aucune requête vers la source pour un import refusé"
