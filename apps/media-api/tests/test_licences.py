"""Attribution des médias sous licence libre (Wikimedia Commons) : API de Commons, refus des licences inconnues ou non
libres, étiquettes du fichier, champs de /info, /preview et du job. Aucun réseau : réponses RÉELLES de l'API
enregistrées le 2026-10-26 (deux fichiers du banc de bout en bout)."""

from __future__ import annotations

import copy
import io
import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

import app.worker as worker
from app import licences
from app.errors import USER_TEXT, ApiError
from app.main import preview_view
from tests.conftest import run_ffmpeg

TEMPERATURE = "File:Die Temperaturkurve der Erde (ZDF, Terra X) 720p HD 50FPS.webm"
URL_TEMPERATURE = "https://commons.wikimedia.org/wiki/File:Die_Temperaturkurve_der_Erde_(ZDF,_Terra_X)_720p_HD_50FPS.webm"
NASA = "File:NASA-BuildingMars2020Rover-TimeLapse-20190712.webm"

# Réponses réelles de l'API (prop=imageinfo, iiprop=url|extmetadata, formatversion=2), champs utiles seulement.
PAGE_CC_BY = {
    "title": TEMPERATURE,
    "imageinfo": [{"descriptionurl": URL_TEMPERATURE, "extmetadata": {
        "Artist": {"value": "ZDF/Terra X/Gruppe 5/Luise Wagner, Jonas Sichert, Andreas Hougardy"},
        "Credit": {"value": '<a rel="nofollow" class="external free" href="https://schule.zdf.de/video/die-temperaturkurve'
                            '-der-erde-erklaerclip-klimawandel-100">https://schule.zdf.de/video/…</a>'},
        "LicenseShortName": {"value": "CC BY 4.0"}, "LicenseUrl": {"value": "https://creativecommons.org/licenses/by/4.0"},
        "License": {"value": "cc-by-4.0"}, "AttributionRequired": {"value": "true"}, "Copyrighted": {"value": "True"}}}],
}
PAGE_PD = {
    "title": NASA,
    "imageinfo": [{"descriptionurl": "https://commons.wikimedia.org/wiki/File:NASA-BuildingMars2020Rover-TimeLapse-20190712.webm",
                   "extmetadata": {
        "Artist": {"value": '<a rel="nofollow" class="external text" href="https://www.youtube.com/@NASAJPL">NASA Jet '
                            'Propulsion Laboratory</a>'},
        "Credit": {"value": '<bdi lang="fr" dir="ltr"><a href="//commons.wikimedia.org/wiki/Commons:YouTube_files" '
                            'title="Commons:YouTube files">YouTube</a> : <a rel="nofollow" class="external text" '
                            'href="https://www.youtube.com/watch?v=eDh2Jz3hKjU"><bdi lang="">Pit Crew for Mars</bdi></a>'
                            '</bdi>'},
        "LicenseShortName": {"value": "Public domain"}, "License": {"value": "pd"},
        "AttributionRequired": {"value": "false"}, "Copyrighted": {"value": "False"}}}],
}


def _rep(page: dict[str, Any]) -> dict[str, Any]:
    return {"query": {"pages": [copy.deepcopy(page)]}}


def _meta(page: dict[str, Any]) -> dict[str, Any]:
    return page["imageinfo"][0]["extmetadata"]


def test_cc_by_attribution_ready_to_display() -> None:
    a = licences.attribution_depuis(_rep(PAGE_CC_BY), TEMPERATURE)
    assert a["auteur"] == "ZDF/Terra X/Gruppe 5/Luise Wagner, Jonas Sichert, Andreas Hougardy"
    assert (a["licence"], a["licence_code"]) == ("CC BY 4.0", "cc-by-4.0")
    assert a["licence_url"] == "https://creativecommons.org/licenses/by/4.0"
    assert a["source_url"] == URL_TEMPERATURE and a["attribution_requise"] is True
    assert a["origine_url"].startswith("https://schule.zdf.de/")
    assert a["texte"] == ("« Die Temperaturkurve der Erde (ZDF, Terra X) 720p HD 50FPS », ZDF/Terra X/Gruppe 5/Luise "
                          "Wagner, Jonas Sichert, Andreas Hougardy, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0), "
                          f"via Wikimedia Commons : {URL_TEMPERATURE}")


def test_public_domain_html_author_and_external_origin() -> None:
    a = licences.attribution_depuis(_rep(PAGE_PD), NASA)
    assert a["auteur"] == "NASA Jet Propulsion Laboratory"  # HTML retiré
    assert a["licence"] == "Public domain" and a["licence_url"] is None and a["attribution_requise"] is False
    assert a["origine_url"] == "https://www.youtube.com/watch?v=eDh2Jz3hKjU"  # premier lien EXTERNE du crédit


@pytest.mark.parametrize(("change", "morceau"), [
    ({"LicenseShortName": None, "License": None}, "licence inconnue"),
    ({"LicenseShortName": {"value": "CC BY-NC 4.0"}, "License": {"value": "cc-by-nc-4.0"}}, "non libre"),
    ({"LicenseShortName": {"value": "CC BY-ND 3.0"}, "License": {"value": "cc-by-nd-3.0"}}, "non libre"),
    ({"NonFree": {"value": "true"}}, "non libre"),
    ({"LicenseShortName": {"value": "Fair use"}, "License": {"value": "fairuse"}}, "inconnue ou non libre"),
    ({"Artist": None}, "auteur est inconnu"),
])
def test_unknown_or_non_free_licence_is_refused(change: dict[str, Any], morceau: str) -> None:
    page = copy.deepcopy(PAGE_CC_BY)
    meta = _meta(page)
    for key, value in change.items():
        meta.pop(key, None) if value is None else meta.__setitem__(key, value)
    with pytest.raises(ApiError) as exc:
        licences.attribution_depuis(_rep(page), TEMPERATURE)
    assert (exc.value.status, exc.value.code) == (400, "license_not_free") and morceau in exc.value.detail
    assert "license_not_free" in USER_TEXT


def test_missing_file_is_refused() -> None:
    with pytest.raises(ApiError) as exc:
        licences.attribution_depuis({"query": {"pages": [{"title": TEMPERATURE, "missing": True}]}}, TEMPERATURE)
    assert exc.value.code == "license_not_free"


@pytest.mark.parametrize(("url", "titre"), [
    (URL_TEMPERATURE, TEMPERATURE),
    ("https://commons.wikimedia.org/wiki/Fichier:A%C3%A9_b.webm", "File:Aé b.webm"),
    ("https://commons.wikimedia.org/wiki/Main_Page", None),
    ("https://commons.wikimedia.org/wiki/Category:Videos", None),
    ("https://example.org/wiki/File:x.webm", None),
])
def test_commons_title_from_url(url: str, titre: str | None) -> None:
    assert licences.titre_commons(url) == titre


class _Ydl:
    def __init__(self, body: bytes) -> None:
        self.body, self.urls = body, []

    def urlopen(self, request: Any) -> io.BytesIO:
        self.urls.append(request.url)
        return io.BytesIO(self.body)


def test_one_api_request_through_yt_dlp_and_only_for_wikimedia() -> None:
    ydl = _Ydl(json.dumps(_rep(PAGE_CC_BY)).encode())
    assert licences.attribution(ydl, "bluesky", "https://bsky.app/profile/a/post/b") is None
    assert licences.attribution(ydl, "youtube", "https://www.youtube.com/watch?v=x") is None
    a = licences.attribution(ydl, "wikimedia", URL_TEMPERATURE)
    assert a["licence"] == "CC BY 4.0" and len(ydl.urls) == 1
    assert ydl.urls[0].startswith("https://commons.wikimedia.org/w/api.php?action=query")
    assert "iiprop=url%7Cextmetadata" in ydl.urls[0]
    with pytest.raises(ApiError) as exc:  # pas une page de fichier : licence inconnue
        licences.attribution(ydl, "wikimedia", "https://commons.wikimedia.org/wiki/Main_Page")
    assert exc.value.code == "license_not_free" and len(ydl.urls) == 1


def test_api_failure_is_a_platform_error_not_a_licence_refusal() -> None:
    from yt_dlp.networking.exceptions import TransportError

    class Down(_Ydl):
        def urlopen(self, request: Any) -> io.BytesIO:
            raise TransportError("down")

    with pytest.raises(ApiError) as exc:
        licences.attribution(Down(b""), "wikimedia", URL_TEMPERATURE)
    assert (exc.value.status, exc.value.code) == (503, "upstream_unavailable")


@pytest.mark.parametrize("ext", ["mp4", "mp3", "webm"])
def test_tags_written_into_the_file(tmp_path: Path, ext: str) -> None:
    src = tmp_path / f"media.{ext}"
    video = [] if ext == "mp3" else ["-f", "lavfi", "-i", "testsrc2=size=64x36:rate=6"]
    codecs = {"mp4": ["-c:v", "libx264", "-c:a", "aac"], "mp3": ["-c:a", "libmp3lame"],
              "webm": ["-c:v", "libvpx-vp9", "-c:a", "libopus"]}[ext]
    run_ffmpeg(*video, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1", *codecs, str(src))
    a = licences.attribution_depuis(_rep(PAGE_CC_BY), TEMPERATURE)
    assert worker.tag_attribution(src, tmp_path, a) is True
    out = subprocess.run(["ffprobe", "-v", "error", "-of", "json", "-show_format", str(src)], capture_output=True,
                         text=True, check=True)
    tags = {k.lower(): v for k, v in json.loads(out.stdout)["format"].get("tags", {}).items()}
    assert tags["artist"].startswith("ZDF/Terra X")
    assert tags["copyright"] == "CC BY 4.0 — https://creativecommons.org/licenses/by/4.0"
    assert URL_TEMPERATURE in tags["comment"]
    assert not (tmp_path / f"attribution.{ext}").exists()


def test_tagging_failure_is_not_fatal(tmp_path: Path) -> None:
    bad = tmp_path / "media.mp4"
    bad.write_bytes(b"pas une video")
    a = licences.attribution_depuis(_rep(PAGE_PD), NASA)
    assert worker.tag_attribution(bad, tmp_path, a) is False and bad.read_bytes() == b"pas une video"


def test_info_preview_and_job_carry_the_attribution(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    a = licences.attribution_depuis(_rep(PAGE_CC_BY), TEMPERATURE)
    raw = {"id": "83227919", "title": "Die Temperaturkurve", "webpage_url": URL_TEMPERATURE, "duration": 45.3,
           "extractor_key": "Wikimedia", "formats": [{"format_id": "0", "url": "https://upload.wikimedia.org/x.webm",
                                                     "ext": "webm", "vcodec": "vp9", "acodec": "opus", "height": 480,
                                                     "width": 854}]}
    seen: list[tuple[str, str]] = []

    def fake_attribution(ydl: Any, platform: str, url: str | None) -> dict[str, Any] | None:
        seen.append((platform, str(url)))
        return a if platform == "wikimedia" else None

    class Ydl:
        def __init__(self, opts: dict[str, Any]) -> None:
            self.params = opts

        def __enter__(self) -> Ydl:
            return self

        def __exit__(self, *exc: object) -> None:
            return None

        def extract_info(self, url: str, download: bool = False, process: bool = True) -> dict[str, Any]:
            return copy.deepcopy(raw)

        def process_ie_result(self, info: dict[str, Any], download: bool = False) -> dict[str, Any]:
            return info

        def sanitize_info(self, info: dict[str, Any]) -> dict[str, Any]:
            return info

    monkeypatch.setattr(worker.yt_dlp, "YoutubeDL", Ydl)
    monkeypatch.setattr(worker.licences, "attribution", fake_attribution)
    cfg = {"max_filesize_bytes": 10**9, "cache_dir": None, "max_duration_s": 3600, "gif_max_duration_s": 30,
           "transcode_max_duration_s": 900, "extractor_args": {}}
    info = worker.run_info({"platform": "wikimedia", "url": URL_TEMPERATURE}, cfg, tmp_path)
    assert info["attribution"] == a and seen == [("wikimedia", URL_TEMPERATURE)]
    assert "extrait" not in info["proposes"]  # extraits fermés pour Wikimedia (banc du 2026-10-26)
    view = preview_view(info, "wikimedia")
    assert view["attribution"]["texte"] == a["texte"] and view["attribution"]["licence"] == "CC BY 4.0"
    assert view["proposes"] == ["mp4", "mp3", "gif"]

    def refuse(ydl: Any, platform: str, url: str | None) -> None:
        raise licences.refus("licence inconnue.")

    monkeypatch.setattr(worker.licences, "attribution", refuse)
    with pytest.raises(ApiError) as exc:
        worker.run_info({"platform": "wikimedia", "url": URL_TEMPERATURE}, cfg, tmp_path)
    assert exc.value.code == "license_not_free"


def test_job_view_exposes_the_attribution(make_client, fake_worker, auth: dict[str, str],  # noqa: ANN001
                                          monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import DEFAULT_ALLOWED_DOMAINS, parse_domains

    a = licences.attribution_depuis(_rep(PAGE_PD), NASA)
    original = type(fake_worker).__call__

    async def call(self: Any, task: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
        out = await original(self, task, *args, **kwargs)
        return dict(out, attribution=a) if task.kind == "download" else out

    monkeypatch.setattr(type(fake_worker), "__call__", call)
    c = make_client(allowed_domains=parse_domains(DEFAULT_ALLOWED_DOMAINS, ("wikimedia", "bluesky")),
                    plateformes_beta=("wikimedia", "bluesky"), media_tools_enabled=True)
    r = c.post("/jobs?wait=5", json={"url": URL_TEMPERATURE, "fmt": "mp4"}, headers=auth)
    assert r.status_code == 200, r.text
    assert r.json()["attribution"] == a
    job = c.get(f"/jobs/{r.json()['job_id']}", headers=auth).json()
    assert job["attribution"]["source_url"].startswith("https://commons.wikimedia.org/wiki/File:")
    r = c.post("/jobs", json={"url": "https://bsky.app/profile/bsky.app/post/3l3vgf77uco2g", "fmt": "mp4",
                              "startMs": 0, "endMs": 3000}, headers=auth)
    assert (r.status_code, r.json()["error"]) == (422, "format_unavailable")  # Bluesky : extraits désactivés


def test_registry_drives_attribution_and_closed_functions(client) -> None:  # noqa: ANN001
    from app.registre import parse_registry, registre
    from app.urls import check_platform_format

    reg = registre()
    assert [p.id for p in reg.plateformes if p.attribution] == ["wikimedia"]
    assert {p.id for p in reg.plateformes if p.valide} == {"wikimedia", "bluesky"}
    with pytest.raises(ApiError) as exc:
        check_platform_format("wikimedia", "mp4", clip=True)
    assert "HTTP 429" in exc.value.detail  # la raison du registre, telle quelle
    items = {p["id"]: p for p in client.get("/platforms").json()["plateformes"]}
    assert items["wikimedia"]["attribution"] is True and "extrait" in items["wikimedia"]["indisponibles"]
    base = {"version": "t", "ytdlp": "t", "categories": [{"id": c, "nom": c} for c in ("populaires", "musique",
            "streaming", "autres")], "icones": {"video": "v"}}
    entry = {"id": "demo", "nom": "Demo", "categorie": "autres", "etat": "beta", "icone": "video",
             "domaines": ["demo.example"], "extracteurs": ["demo"], "formats": ["mp4"]}
    with pytest.raises(ValueError, match="indisponibles"):  # un format ouvert ne peut pas être « indisponible »
        parse_registry(base | {"plateformes": [entry | {"indisponibles": {"mp4": "raison"}}]})
    with pytest.raises(ValueError, match="valide"):
        parse_registry(base | {"plateformes": [entry | {"etat": "indisponible", "valide": "2026-10-26"}]})
