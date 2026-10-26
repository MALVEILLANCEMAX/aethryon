"""Extraits (CONTRAT-EXTRAITS) : startMs/endMs, limites configurables, GET /limites, étapes du job, et la récupération
PARTIELLE de app/extraits.py (relais HTTP borné, garde d'octets, découpe précise).

Hors réseau : un serveur local joue le serveur de médias (requêtes Range, HTTP 403 d'un client YouTube, serveur qui
ignore Range) ; seule l'extraction de yt-dlp est simulée, le reste est réel (sélection des formats, client réseau de
yt-dlp, ffmpeg, conversion).
"""

from __future__ import annotations

import json
import multiprocessing
import os
import re
import signal
import subprocess
import threading
import time
from collections.abc import Callable, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
import yt_dlp
from fastapi.testclient import TestClient

import app.extraits as X
import app.worker as worker
from app.config import load_settings
from app.errors import ApiError
from app.params import DownloadParams, normalize_clip
from app.runner import WorkerConfig
from app.worker import Reporter
from tests.conftest import TOKEN, FakeWorker, run_ffmpeg
from tests.test_user_keys import KEY_A, FakeAccount, bearer
from tests.test_user_keys import account  # noqa: F401  (fixture)

YT = "https://www.youtube.com/watch?v=abcdefghijk"
TT = "https://www.tiktok.com/@nasa/video/7691727731800673549"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
DUREE = 120.0  # secondes de la source synthétique
IPS = 12
CFG = {"max_filesize_bytes": 10**9, "cache_dir": None, "max_duration_s": 60, "transcode_max_duration_s": 900,
       "gif_max_duration_s": 30, "extractor_args": {}, "yt_clients": ("visionos", "web_embedded"),
       "extrait_telechargement_max_bytes": 256 * 1024 * 1024, "extrait_sortie_max_bytes": 256 * 1024 * 1024}


# --- startMs / endMs et limites (sans réseau) ---------------------------------------------------------------------


def _norm(**kwargs: Any) -> DownloadParams:
    return normalize_clip(DownloadParams(url=YT, **kwargs), 600, 30)


def test_startms_endms_become_seconds() -> None:
    p = _norm(fmt="mp4", startMs=7987800, endMs=8063700)  # 02:13:07.800 -> 02:14:23.700 (75,9 s)
    assert (p.start_s, p.end_s, p.startMs, p.endMs, p.clip) == (7987.8, 8063.7, 7987800, 8063700, True)
    assert p.summary()["startMs"] == 7987800 and p.summary()["start_s"] == 7987.8
    assert _norm(fmt="mp3", startMs=1500.0, endMs="61500").endMs == 61500  # entier en flottant ou en texte (Raccourcis)
    assert "startMs" not in _norm(fmt="mp4").summary()  # pas d'extrait : rien de plus dans le résumé


@pytest.mark.parametrize("champs, morceau", [
    ({"startMs": 1.5, "endMs": 3000}, "nombre entier"),
    ({"startMs": True, "endMs": 3000}, "nombre entier"),
    ({"startMs": "1:15", "endMs": 3000}, "nombre entier"),
    ({"startMs": {"a": 1}, "endMs": 3000}, "nombre entier"),
    ({"startMs": -1, "endMs": 3000}, "négatif"),
    ({"startMs": 0, "endMs": 86_400_001}, "24 h"),
    ({"startMs": 5000}, "vont ensemble"),
    ({"startMs": 5000, "endMs": 5000}, "après son début"),
    ({"startMs": 9000, "endMs": 5000}, "après son début"),
    ({"startMs": 0, "endMs": 5000, "start_s": 0, "end_s": 5}, "pas les deux"),
])
def test_startms_endms_refusals_are_422_in_french(champs: dict[str, Any], morceau: str) -> None:
    with pytest.raises(ApiError) as caught:
        _norm(fmt="mp4", **champs)
    assert (caught.value.status, caught.value.code) == (422, "extrait_invalide")
    assert morceau in caught.value.detail


def test_clip_length_is_a_server_setting_never_the_source_length() -> None:
    assert _norm(fmt="mp4", startMs=0, endMs=600_000).clip  # 10 min : la limite par défaut
    assert _norm(fmt="mp4", startMs=32_000_000, endMs=32_015_000).clip  # 15 s au bout d'une source de 9 h
    with pytest.raises(ApiError) as long_mp4:
        _norm(fmt="mp4", startMs=0, endMs=600_001)
    assert (long_mp4.value.status, long_mp4.value.code) == (422, "extrait_trop_long")
    assert long_mp4.value.detail == ("Un extrait MP4 dure au plus 10 min sur ce serveur ; celui demandé dure "
                                     "10 min 00,001 s.")
    from app.params import _readable

    assert [_readable(v) for v in (600_000, 45_000, 1_500, 3_600_000, 3_900_000, 7_987_800)] == \
        ["10 min", "45 s", "1,5 s", "1 h", "1 h 05 min", "2 h 13 min 07,8 s"]
    with pytest.raises(ApiError) as long_gif:  # GIF : GIF_MAX_DURATION_S aussi
        _norm(fmt="gif", start_s=10, end_s=41)
    assert long_gif.value.code == "extrait_trop_long" and "30 s" in long_gif.value.detail
    assert normalize_clip(DownloadParams(url=YT, fmt="mp4", startMs=0, endMs=3_600_000), 3600, 30).clip  # réglable


def test_clip_settings_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_TOKEN", "x" * 32)
    for name in ("EXTRAIT_DUREE_MAX_S", "EXTRAIT_SORTIE_MAX_MB", "EXTRAIT_TELECHARGEMENT_MAX_MB",
                 "EXTRAIT_TRAITEMENT_MAX_S", "EXTRAIT_SIMULTANES_MAX"):
        monkeypatch.delenv(name, raising=False)
    s = load_settings()
    assert (s.extrait_duree_max_s, s.extrait_sortie_max_mb, s.extrait_telechargement_max_mb,
            s.extrait_traitement_max_s, s.extrait_simultanes_max) == (600, 1024, 1024, 1800, 1)
    monkeypatch.setenv("EXTRAIT_DUREE_MAX_S", "1800")
    monkeypatch.setenv("EXTRAIT_TELECHARGEMENT_MAX_MB", "300")
    monkeypatch.setenv("EXTRAIT_SIMULTANES_MAX", "2")
    s = load_settings()
    assert (s.extrait_duree_max_s, s.extrait_telechargement_max_bytes, s.extrait_simultanes_max) == (1800, 300 << 20, 2)
    assert WorkerConfig.from_settings(s).extrait_telechargement_max_bytes == 300 << 20


def test_clip_bounds_against_the_source() -> None:
    assert worker.clip_bounds(10.0, 20.0, 32400.0, strict=True) == (10.0, 20.0, None)
    assert worker.clip_bounds(10.0, 120.6, 120.0, strict=True) == (10.0, 120.6, None)  # durée arrondie : 1 s de tolérance
    for start, end in ((120.0, 125.0), (100.0, 121.5)):
        with pytest.raises(ApiError) as caught:
            worker.clip_bounds(start, end, 120.0, strict=True)
        assert (caught.value.status, caught.value.code) == (422, "extrait_hors_source")
    start, end, note = worker.clip_bounds(100.0, 150.0, 120.0, strict=False)  # start_s/end_s : comportement d'avant
    assert (start, end) == (100.0, 120.0) and note and "jusqu'à la fin" in note


def test_clip_format_selection() -> None:
    mp4 = worker.clip_format_options({"fmt": "mp4", "quality": "best"}, "youtube")
    assert mp4 == {"format": "bv*+ba/b", "format_sort": ["res:1080", "vcodec:h264", "channels:2", "acodec:m4a"]}
    capped = worker.clip_format_options({"fmt": "mp4", "quality": "2160"}, "youtube")  # toujours réencodé : 1080p
    assert capped["format_sort"][0] == "res:1080" and "channels:2" in capped["format_sort"]
    assert worker.clip_format_options({"fmt": "mp4", "quality": "720"}, "tiktok")["format"] == "b/bv*+ba"
    assert worker.clip_format_options({"fmt": "mp3"}, "youtube") == {"format": "ba/b", "format_sort": ["channels:2"]}
    assert worker.clip_format_options({"fmt": "gif", "gif_width": 480}, "youtube")["format_sort"][0] == "res:360"
    assert worker.clip_format_options({"fmt": "gif", "gif_width": 1280}, "youtube")["format_sort"][0] == "res:720"


# --- API : POST /jobs, GET /limites, étapes -------------------------------------------------------------------------


@pytest.fixture
def clips(make_client: Callable[..., TestClient]) -> TestClient:
    return make_client(media_tools_enabled=True)


def test_post_jobs_with_startms_endms(clips: TestClient, fake_worker: FakeWorker) -> None:
    r = clips.post("/jobs?wait=5", json={"url": YT, "fmt": "mp4", "startMs": 7987800, "endMs": 8063700}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["params"]["startMs"] == 7987800 and body["params"]["start_s"] == 7987.8
    assert body["etape"] == "termine" and "progression" not in body
    task = fake_worker.calls[-1]
    assert (task.params["start_s"], task.params["end_s"], task.params["startMs"]) == (7987.8, 8063.7, 7987800)
    # Même passage en secondes (ancien contrat) : même fichier, donc même clé de cache que la demande en ms.
    from app.cache import cache_key

    legacy = DownloadParams(url=YT, fmt="mp4", start_s=7987.8, end_s=8063.7).model_dump()
    assert cache_key("youtube:abcdefghijk", task.params) == cache_key("youtube:abcdefghijk", legacy)


def test_post_jobs_clip_refusals(clips: TestClient, fake_worker: FakeWorker) -> None:
    r = clips.post("/jobs", json={"url": YT, "fmt": "mp4", "startMs": 2.5, "endMs": 9000}, headers=AUTH)
    assert r.status_code == 422 and r.json()["error"] == "extrait_invalide"
    r = clips.post("/jobs", json={"url": YT, "fmt": "gif", "startMs": 0, "endMs": 45_000}, headers=AUTH)
    assert r.status_code == 422 and r.json() == {"error": "extrait_trop_long",
                                                 "detail": "Un GIF dure au plus 30 s sur ce serveur ; celui demandé "
                                                           "dure 45 s."}
    # Ancien contrat : erreurs de structure inchangées (400), longueur selon la configuration (422).
    r = clips.post("/jobs", json={"url": YT, "fmt": "mp4", "start_s": 5}, headers=AUTH)
    assert r.status_code == 400 and r.json()["error"] == "invalid_parameter"
    r = clips.post("/jobs", json={"url": YT, "fmt": "mp4", "start_s": 0, "end_s": 900}, headers=AUTH)
    assert r.status_code == 422 and r.json()["error"] == "extrait_trop_long"
    assert fake_worker.calls == []  # rien n'a été lancé


def test_clips_off_without_media_tools(make_client: Callable[..., TestClient], fake_worker: FakeWorker) -> None:
    client = make_client()
    r = client.post("/jobs", json={"url": YT, "fmt": "mp4", "startMs": 0, "endMs": 5000}, headers=AUTH)
    assert r.status_code == 400 and "MEDIA_TOOLS_ENABLED" in r.json()["detail"]
    assert client.get("/limites", headers=AUTH).json()["extraitsActifs"] is False


def test_limites_for_an_admin_token(make_client: Callable[..., TestClient]) -> None:
    client = make_client(media_tools_enabled=True, extrait_duree_max_s=900, extrait_telechargement_max_mb=300,
                         extrait_sortie_max_mb=200, extrait_traitement_max_s=1200, extrait_simultanes_max=2,
                         gif_max_duration_s=45)
    assert client.get("/limites").status_code == 401
    body = client.get("/limites", headers=AUTH).json()
    assert body == {"extraitsActifs": True, "formats": ["mp4", "mp3", "gif"], "extraitDureeMaxMs": 900_000,
                    "dureeMaxParFormatMs": {"mp4": 900_000, "mp3": 900_000, "gif": 45_000}, "gifDureeMaxMs": 45_000,
                    "sortieTailleMaxOctets": 200 << 20, "telechargementMaxOctets": 300 << 20, "traitementMaxS": 1200,
                    "simultanesMax": 2, "quotaJour": None, "restantAujourdhui": None, "actifsMaxParCompte": None}


def test_limites_and_gif_clip_quota_for_a_user_key(make_client: Callable[..., TestClient], account: FakeAccount,  # noqa: F811
                                                   tmp_path: Path) -> None:
    token_file = tmp_path / "account_internal_token"
    from tests.test_user_keys import INTERNAL

    token_file.write_text(INTERNAL)
    client = make_client(user_keys_enabled=True, account_internal_url=account.url, account_internal_token_file=token_file,
                         media_tools_enabled=True)
    body = client.get("/limites", headers=bearer(KEY_A)).json()
    assert body["quotaJour"] == account.daily and body["restantAujourdhui"] == account.daily - account.creates()
    assert body["actifsMaxParCompte"] == 1
    r = client.post("/jobs?wait=5", json={"url": TT, "fmt": "gif", "startMs": 1000, "endMs": 4000}, headers=bearer(KEY_A))
    assert r.status_code == 200, r.text
    creations = [c for c in account.calls if c.get("action") == "create_job"]
    assert creations[-1]["fmt"] == "mp4"  # un GIF tiré d'un extrait compte comme une conversion vidéo


def test_clip_job_view_has_stage_progress_and_bytes(clips: TestClient, fake_worker: FakeWorker) -> None:
    fake_worker.delay_s = 0.6
    runner = clips.app.state.runner
    original = runner._run

    async def staged(task: Any, timeout: float, on_progress: Any = None, cancel: Any = None, gate: Any = None) -> Any:
        if on_progress is not None and task.params and task.params.get("start_s") is not None:
            on_progress({"type": "progress", "stage": "downloading", "percent": 30.0, "etape": "recuperation",
                         "progression": 0.42, "octets": 123456})
        return await original(task, timeout, None, cancel, gate)

    runner._run = staged
    r = clips.post("/jobs", json={"url": YT, "fmt": "mp3", "startMs": 0, "endMs": 60000}, headers=AUTH)
    job_id = r.json()["job_id"]
    seen: list[dict[str, Any]] = []
    for _ in range(200):
        body = clips.get(f"/jobs/{job_id}", headers=AUTH).json()
        seen.append(body)
        if body["status"] == "done":
            break
        time.sleep(0.02)
    running = next(b for b in seen if b["status"] == "running" and b.get("etape") == "recuperation")
    assert running["progression"] == 0.42 and running["octetsTelecharges"] == 123456
    assert seen[-1]["etape"] == "termine" and "progression" not in seen[-1]
    full = clips.post("/jobs?wait=5", json={"url": YT, "fmt": "mp3"}, headers=AUTH).json()
    assert "etape" not in full and "octetsTelecharges" not in full  # téléchargement complet : vue inchangée


# --- serveur de médias local ----------------------------------------------------------------------------------------


class MediaServer:
    """Fichiers servis avec Range (une plage) ; ?c=<client> refusé en 403 si le client est dans `refuse` ;
    /norange/... ignore Range ; `debit` octets/s limite l'envoi (annulation). Compte ce qui part vraiment."""

    def __init__(self, root: Path, debit: int = 0) -> None:
        self.root = root
        self.refuse: set[str] = set()
        self.requests: list[dict[str, Any]] = []
        self.sent = 0
        self.lock = threading.Lock()
        server = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args: Any) -> None:
                pass

            def do_GET(self) -> None:  # noqa: N802
                parts = urlsplit(self.path)
                client = parse_qs(parts.query).get("c", [""])[0]
                norange = parts.path.startswith("/norange/")
                name = parts.path.removeprefix("/norange/").lstrip("/")
                plage = None if norange else self.headers.get("Range")
                entry = {"path": name, "client": client, "range": plage, "sent": 0}
                with server.lock:
                    server.requests.append(entry)
                if client in server.refuse:
                    self.send_response(403)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                target = server.root / name
                if not target.is_file():
                    self.send_response(404)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                size = target.stat().st_size
                start, end, code = 0, size - 1, 200
                if plage:
                    m = re.match(r"bytes=(\d+)-(\d*)$", plage)
                    assert m, plage
                    start = int(m.group(1))
                    end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
                    if start >= size:
                        self.send_response(416)
                        self.send_header("Content-Range", f"bytes */{size}")
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return
                    code = 206
                self.send_response(code)
                self.send_header("Content-Length", str(end - start + 1))
                if code == 206:
                    self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                self.end_headers()
                with target.open("rb") as f:
                    f.seek(start)
                    left = end - start + 1
                    try:
                        while left > 0:
                            block = f.read(min(16384, left))
                            self.wfile.write(block)
                            left -= len(block)
                            entry["sent"] += len(block)
                            with server.lock:
                                server.sent += len(block)
                            if debit:
                                time.sleep(len(block) / debit)
                    except (BrokenPipeError, ConnectionResetError):
                        self.close_connection = True

        class Server(ThreadingHTTPServer):
            daemon_threads = True

            def handle_error(self, request: Any, client_address: Any) -> None:
                pass

        self.httpd = Server(("127.0.0.1", 0), Handler)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture(scope="module")
def sources(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Source synthétique de 2 min (mire 160×90 à 12 images/s, 400 kbit/s constants, image clé toutes les 2 s,
    images B ; bip AAC) sous les
    formes des plateformes : DASH (vidéo seule et son seul, MP4 fragmentés avec sidx), HLS (TS de 6 s), MP4
    progressif, et une Matroska sans index (lecture linéaire obligatoire)."""
    root = tmp_path_factory.mktemp("sources")
    master = root / "maitre.mp4"
    run_ffmpeg("-f", "lavfi", "-i", f"testsrc2=size=160x90:rate={IPS}", "-f", "lavfi",
               "-i", "sine=frequency=440:beep_factor=4:sample_rate=22050", "-t", str(DUREE),
               "-c:v", "libx264", "-preset", "veryfast", "-bf", "2", "-g", "24", "-keyint_min", "24", "-sc_threshold", "0",
               "-b:v", "400k", "-minrate", "400k", "-maxrate", "400k", "-bufsize", "400k",
               "-x264-params", "nal-hrd=cbr", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "24k", "-ac", "1", "-movflags", "+faststart",
               str(master))
    frag = "+frag_keyframe+empty_moov+default_base_moof+global_sidx"
    run_ffmpeg("-i", str(master), "-map", "0:v", "-c", "copy", "-f", "mp4", "-movflags", frag, str(root / "v.mp4"))
    run_ffmpeg("-i", str(master), "-map", "0:a", "-c", "copy", "-f", "mp4", "-frag_duration", "5000000",
               "-movflags", "+empty_moov+default_base_moof+global_sidx", str(root / "a.m4a"))
    (root / "hls").mkdir()
    run_ffmpeg("-i", str(master), "-c", "copy", "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod",
               "-hls_segment_filename", str(root / "hls" / "s%03d.ts"), str(root / "hls" / "index.m3u8"))
    with (root / "sansindex.mkv").open("wb") as out:
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(master), "-map", "0:v", "-c", "copy", "-f", "matroska",
                        "pipe:1"], stdout=out, check=True, timeout=120)
    run_ffmpeg("-f", "lavfi", "-i", "testsrc=size=64x64", "-frames:v", "1", str(root / "thumb.jpg"))
    return root


@pytest.fixture
def media(sources: Path) -> Iterator[MediaServer]:
    server = MediaServer(sources)
    yield server
    server.close()


@pytest.fixture(autouse=True)
def _private_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(X, "AUTORISER_PRIVE", True)  # le serveur de médias du test est sur 127.0.0.1


def _kbps(path: Path) -> float:
    return path.stat().st_size * 8 / DUREE / 1000


def _youtube_raw(base: str, sources: Path, clients: tuple[str, ...] = ("VISIONOS", "WEB_EMBEDDED_PLAYER")) -> dict[str, Any]:
    """Infos YouTube brutes (process=False) : 137 + 140 de deux clients, plus leurs copies « dashy »."""
    shorts = {"VISIONOS": "VISI", "WEB_EMBEDDED_PLAYER": "WEB-E"}
    formats = []
    for client in clients:
        q = f"c={client}"
        formats += [
            {"format_id": "137", "url": f"{base}/v.mp4?{q}&itag=137", "ext": "mp4", "vcodec": "avc1.64000c",
             "acodec": "none", "width": 160, "height": 90, "fps": IPS, "tbr": _kbps(sources / "v.mp4"),
             "filesize": (sources / "v.mp4").stat().st_size, "format_note": f"90p, {shorts[client]}",
             "source_preference": -1, "quality": 5, "container": "mp4_dash", "protocol": "https"},
            {"format_id": "140", "url": f"{base}/a.m4a?{q}&itag=140", "ext": "m4a", "vcodec": "none",
             "acodec": "mp4a.40.2", "abr": 24, "tbr": _kbps(sources / "a.m4a"),
             "filesize": (sources / "a.m4a").stat().st_size, "format_note": f"medium, {shorts[client]}",
             "source_preference": -1, "quality": 3, "container": "m4a_dash", "protocol": "https"},
        ]
    formats += [{**f, "format_id": f"{f['format_id']}-dashy", "protocol": "http_dash_segments",
                 "fragments": [{"url": f"{f['url']}&range=0-{f['filesize']}"}]} for f in list(formats)]
    return {"id": "abcdefghijk", "title": "Essai extrait", "duration": DUREE, "formats": formats,
            "thumbnail": "https://i.ytimg.com/vi/abcdefghijk/hq.jpg", "uploader": "Banc",
            "extractor": "youtube", "extractor_key": "Youtube", "webpage_url": YT, "original_url": YT,
            "webpage_url_basename": "watch", "webpage_url_domain": "youtube.com"}


def _hls_raw(base: str, sources: Path, path: str = "hls/index.m3u8") -> dict[str, Any]:
    size = sum(f.stat().st_size for f in (sources / "hls").iterdir())
    return {"id": "1883228395842023524", "title": "Essai HLS", "duration": DUREE,
            "formats": [{"format_id": "hls-300", "url": f"{base}/{path}", "ext": "mp4", "protocol": "m3u8_native",
                         "vcodec": "avc1.64000c", "acodec": "mp4a.40.2", "width": 160, "height": 90,
                         "tbr": size * 8 / DUREE / 1000}],
            "extractor": "TikTok", "extractor_key": "TikTok", "webpage_url": TT, "original_url": TT,
            "webpage_url_basename": "x", "webpage_url_domain": "tiktok.com"}


def _single_raw(base: str, path: str, tbr: float | None, vcodec: str = "avc1.64000c",
                acodec: str = "none") -> dict[str, Any]:
    return {"id": "7691727731800673549", "title": "Essai progressif", "duration": DUREE,
            "formats": [{"format_id": "h264", "url": f"{base}/{path}", "ext": "mp4", "protocol": "https",
                         "vcodec": vcodec, "acodec": acodec, "width": 160, "height": 90, "tbr": tbr}],
            "extractor": "TikTok", "extractor_key": "TikTok", "webpage_url": TT, "original_url": TT,
            "webpage_url_basename": "x", "webpage_url_domain": "tiktok.com"}


class _Conn:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    def send(self, message: dict[str, Any]) -> None:
        self.sent.append(message)


def _clip(raw: dict[str, Any], tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *, fmt: str = "mp4",
          platform: str = "youtube", start_ms: int = 61_500, end_ms: int = 76_500, cfg: dict[str, Any] | None = None,
          conn: _Conn | None = None, **extra: Any) -> dict[str, Any]:
    class Ydl(yt_dlp.YoutubeDL):
        extractions = 0

        def extract_info(self, url: str, download: bool = True, ie_key: Any = None, extra_info: Any = None,
                         process: bool = True, force_generic_extractor: bool = False) -> dict[str, Any]:
            assert process is False and download is False
            Ydl.extractions += 1
            return json.loads(json.dumps(raw))

    monkeypatch.setattr(worker.yt_dlp, "YoutubeDL", Ydl)
    work = tmp_path / "job"
    work.mkdir(parents=True, exist_ok=True)
    params = {"fmt": fmt, "quality": "best", "bitrate": 128, "transcode": False, "index": 1, "gif_width": 160,
              "gif_fps": 12, "start_s": start_ms / 1000, "end_s": end_ms / 1000, "startMs": start_ms, "endMs": end_ms,
              **extra}
    task = {"kind": "download", "url": YT if platform == "youtube" else TT, "platform": platform,
            "workdir": str(work), "params": params}
    return worker.run_download(task, cfg or CFG, work, Reporter(conn or _Conn()))  # type: ignore[arg-type]


def _probe(path: Path) -> dict[str, Any]:
    out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
                         capture_output=True, text=True, check=True, timeout=60)
    return json.loads(out.stdout)


def _gray_frames(path: Path, start: float, length: float) -> list[bytes]:
    out = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{start:.4f}", "-i", str(path), "-t", f"{length:.4f}",
                          "-map", "0:v:0", "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True)
    n = 160 * 90
    return [out.stdout[i:i + n] for i in range(0, len(out.stdout) - n + 1, n)]


def _frame_offset(master: Path, clip: Path, start: float) -> int:
    """Écart (en images) entre la première image de l'extrait et la première image d'instant >= start de la source."""
    first = _gray_frames(clip, 0, 0.5)[0]
    expected = -(-round(start * IPS * 1000) // 1000)
    low = max(0, expected - 6)
    candidates = _gray_frames(master, low / IPS, 13 / IPS)
    best = min(range(len(candidates)), key=lambda j: sum((a - b) ** 2 for a, b in zip(first[::5], candidates[j][::5])))
    return low + best - expected


# --- relais ---------------------------------------------------------------------------------------------------------


def _relay_get(relay: X.Relais, url: str, headers: dict[str, str] | None = None) -> tuple[int, bytes, dict[str, str]]:
    import urllib.request

    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:  # noqa: S310 - relais local
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, b"", dict(exc.headers)


def test_relay_serves_ranges_with_bounded_upstream_requests(media: MediaServer, sources: Path) -> None:
    data = (sources / "v.mp4").read_bytes()
    compteur = X.Compteur(1 << 30)
    with yt_dlp.YoutubeDL({"quiet": True}) as ydl, X.Relais(X.ouvrir_ytdlp(ydl), compteur) as relay:
        url = relay.ajouter(f"{media.base}/v.mp4", {"X-Essai": "1"}, nature="fichier", pas_max=256 * 1024)
        status, body, headers = _relay_get(relay, url, {"Range": "bytes=1000-"})
        assert status == 206 and body == data[1000:]
        assert headers["Content-Range"] == f"bytes 1000-{len(data) - 1}/{len(data)}"
        status, body, _ = _relay_get(relay, url, {"Range": "bytes=5-104"})
        assert status == 206 and body == data[5:105]
        status, _, _ = _relay_get(relay, url, {"Range": f"bytes={len(data) + 10}-"})
        assert status == 416
    ranges = [r["range"] for r in media.requests]
    sizes = [int(b) - int(a) + 1 for a, b in (re.match(r"bytes=(\d+)-(\d+)", r).groups() for r in ranges if r)]  # type: ignore[union-attr]
    assert all(r and re.match(r"bytes=\d+-\d+$", r) for r in ranges)  # jamais de plage ouverte vers la plateforme
    assert max(sizes) <= 256 * 1024 and sizes[0] == X.PAS_INITIAL  # 64 Kio, puis le double, plafonné
    assert compteur.total == len(data) - 1000 + 100 and compteur.annonces >= compteur.total


def test_relay_rewrites_hls_playlists(media: MediaServer) -> None:
    compteur = X.Compteur(1 << 30)
    with yt_dlp.YoutubeDL({"quiet": True}) as ydl, X.Relais(X.ouvrir_ytdlp(ydl), compteur) as relay:
        texte = relay.reecrire_liste(
            "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"cle.bin\"\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:6.0,\n"
            "s000.ts\n#EXTINF:6.0,\nhttps://cdn.example.org/autre/s001.ts?sig=1\n"
            "#EXT-X-STREAM-INF:BANDWIDTH=1\nsous/liste.m3u8\n", "https://media.example.org/a/b/index.m3u8", 0)
        lignes = texte.splitlines()
        assert all("example.org" not in ligne for ligne in lignes)
        locales = re.findall(r"http://127\.0\.0\.1:\d+/r/(\d+)/(\S+?)(?:\"|$)", texte, re.M)
        assert [nom for _, nom in locales] == ["cle.bin", "init.mp4", "s000.ts", "s001.ts", "liste.m3u8"]
        urls = {s.url: s.nature for s in relay.sources.values()}
        assert urls == {"https://media.example.org/a/b/cle.bin": "segment", "https://media.example.org/a/b/init.mp4": "segment",
                        "https://media.example.org/a/b/s000.ts": "segment",
                        "https://cdn.example.org/autre/s001.ts?sig=1": "segment",
                        "https://media.example.org/a/b/sous/liste.m3u8": "liste"}


def test_relay_refuses_private_addresses(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(X, "AUTORISER_PRIVE", False)
    for url in ("http://127.0.0.1:8000/x", "http://10.251.20.5/x", "http://localhost/x", "http://[::1]/x",
                "http://169.254.169.254/latest", "file:///etc/passwd", "http://user:pw@example.org/x"):
        assert not X.hote_public(url), url
    assert X.hote_public("https://93.184.215.14/videoplayback")
    calls: list[str] = []
    real = X.socket.getaddrinfo

    def counting(host: str, *args: Any, **kwargs: Any) -> Any:
        calls.append(host)
        return [(2, 1, 6, "", ("93.184.215.14", 443))]

    X._adresses_publiques.cache_clear()
    monkeypatch.setattr(X.socket, "getaddrinfo", counting)
    assert all(X.hote_public(f"https://cdn.example.org/seg{i}.ts") for i in range(500))
    assert calls == ["cdn.example.org"]  # une seule résolution pour tous les segments du même hôte
    monkeypatch.setattr(X.socket, "getaddrinfo", real)
    X._adresses_publiques.cache_clear()
    with yt_dlp.YoutubeDL({"quiet": True}) as ydl, X.Relais(X.ouvrir_ytdlp(ydl), X.Compteur(1 << 20)) as relay:
        with pytest.raises(X.ErreurAmont):
            relay.ajouter("http://10.0.0.1/segment.ts")


def test_relay_byte_guard(media: MediaServer, sources: Path) -> None:
    compteur = X.Compteur(10 * 1024 * 1024, budget=300 * 1024)
    with yt_dlp.YoutubeDL({"quiet": True}) as ydl, X.Relais(X.ouvrir_ytdlp(ydl), compteur) as relay:
        url = relay.ajouter(f"{media.base}/sansindex.mkv", nature="fichier")
        with pytest.raises(Exception):  # le relais coupe la connexion : réponse tronquée
            _relay_get(relay, url, {"Range": "bytes=0-"})
    assert compteur.raison == "budget" and compteur.total <= 300 * 1024 + X.BLOC
    assert media.sent <= 300 * 1024 + X.PAS_MAX  # la plateforme n'a pas envoyé plus qu'un morceau en trop
    assert "plus que l'extrait" in X.erreur_depassement(compteur).detail


# --- extrait de bout en bout (yt-dlp réel, extraction simulée, ffmpeg réel) ---------------------------------------------


def test_youtube_dash_clip_is_fetched_partially_and_cut_exactly(media: MediaServer, sources: Path, tmp_path: Path,
                                                                monkeypatch: pytest.MonkeyPatch) -> None:
    conn = _Conn()
    result = _clip(_youtube_raw(media.base, sources), tmp_path, monkeypatch, conn=conn)
    out = Path(result["filepath"])
    meta = _probe(out)
    assert {s["codec_type"]: s["codec_name"] for s in meta["streams"]} == {"video": "h264", "audio": "aac"}
    assert abs(float(meta["format"]["duration"]) - 15.0) < 0.1
    assert _frame_offset(sources / "maitre.mp4", out, 61.5) == 0  # image exacte
    details = result["extrait"]
    full = (sources / "v.mp4").stat().st_size + (sources / "a.m4a").stat().st_size
    assert details["methode"] == "partielle" and details["protocoles"] == ["https"]
    assert details["octetsSourceComplete"] == full
    # Reçus par le relais <= envoyés par le serveur (un bloc peut rester dans les tampons quand ffmpeg a fini)
    # <= annoncés (chaque requête est bornée).
    assert 0 < details["octetsTelecharges"] <= media.sent <= details["octetsAnnonces"]
    assert media.sent - details["octetsTelecharges"] <= 256 * 1024
    assert details["octetsTelecharges"] < full * 0.4  # 17 s sur 120 s, index et morceaux entamés compris
    assert (details["debutMs"], details["finMs"], details["dureeMs"]) == (61_500, 76_500, 15_000)
    assert all(r["range"] and re.match(r"bytes=\d+-\d+$", r["range"]) for r in media.requests)
    assert not [r for r in media.requests if "dashy" in r["path"] or "range=" in r["path"]]
    etapes = [m.get("etape") for m in conn.sent if m.get("type") == "progress"]
    assert etapes[0] == "analyse" and etapes[-1] == "finalisation"
    assert [e for i, e in enumerate(etapes) if i == 0 or etapes[i - 1] != e] == \
        ["analyse", "recuperation", "conversion", "finalisation"]
    mesurees = [m["progression"] for m in conn.sent if m.get("etape") == "recuperation" and m.get("progression")]
    assert mesurees and max(mesurees) == 1.0
    assert all(m.get("progression") is None for m in conn.sent if m.get("etape") in ("analyse", "finalisation"))
    assert result["download_name"].startswith("Essai extrait (extrait 1m02s-1m16s)")


def test_hls_clip_mp3_and_gif(media: MediaServer, sources: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    mp3 = _clip(_hls_raw(media.base, sources), tmp_path / "a", monkeypatch, fmt="mp3", platform="tiktok",
                start_ms=30_000, end_ms=90_000)
    meta = _probe(Path(mp3["filepath"]))
    assert [s["codec_name"] for s in meta["streams"]] == ["mp3"] and abs(float(meta["format"]["duration"]) - 60) < 0.1
    segments = [r for r in media.requests if r["path"].endswith(".ts")]
    assert 10 <= len(segments) <= 13  # 60 s + marges en segments de 6 s, plus le segment 0 lu pour l'analyse
    media.requests.clear()
    gif = _clip(_hls_raw(media.base, sources), tmp_path / "b", monkeypatch, fmt="gif", platform="tiktok",
                start_ms=100_250, end_ms=105_250)
    meta = _probe(Path(gif["filepath"]))
    assert meta["streams"][0]["codec_name"] == "gif" and abs(float(meta["format"]["duration"]) - 5.0) < 0.15
    assert _frame_offset(sources / "maitre.mp4", Path(gif["filepath"]), 100.25) == 0


def test_clip_at_the_very_start_and_end_of_the_source(media: MediaServer, sources: Path, tmp_path: Path,
                                                      monkeypatch: pytest.MonkeyPatch) -> None:
    first = _clip(_hls_raw(media.base, sources), tmp_path / "a", monkeypatch, platform="tiktok", start_ms=0, end_ms=4000)
    assert _frame_offset(sources / "maitre.mp4", Path(first["filepath"]), 0.0) == 0
    assert abs(float(_probe(Path(first["filepath"]))["format"]["duration"]) - 4.0) < 0.1
    last = _clip(_youtube_raw(media.base, sources), tmp_path / "b", monkeypatch, start_ms=110_000, end_ms=120_000)
    assert abs(float(_probe(Path(last["filepath"]))["format"]["duration"]) - 10.0) < 0.15


def test_youtube_403_falls_back_to_the_other_client(media: MediaServer, sources: Path, tmp_path: Path,
                                                    monkeypatch: pytest.MonkeyPatch,
                                                    caplog: pytest.LogCaptureFixture) -> None:
    import logging

    caplog.set_level(logging.INFO)
    media.refuse = {"VISIONOS"}
    result = _clip(_youtube_raw(media.base, sources), tmp_path, monkeypatch, fmt="mp3")
    assert _probe(Path(result["filepath"]))["streams"][0]["codec_name"] == "mp3"
    clients = [r["client"] for r in media.requests]
    assert clients[0] == "VISIONOS" and set(clients[1:]) == {"WEB_EMBEDDED_PLAYER"}
    assert "youtube stream refused, trying another client" in caplog.text and media.base not in caplog.text


def test_every_client_refused_is_upstream_forbidden(media: MediaServer, sources: Path, tmp_path: Path,
                                                    monkeypatch: pytest.MonkeyPatch) -> None:
    media.refuse = {"VISIONOS", "WEB_EMBEDDED_PLAYER"}
    with pytest.raises(ApiError) as caught:
        _clip(_youtube_raw(media.base, sources), tmp_path, monkeypatch)
    assert (caught.value.status, caught.value.code) == (502, "upstream_forbidden")


def test_source_without_index_trips_the_guard_instead_of_a_full_download(media: MediaServer, sources: Path,
                                                                        tmp_path: Path,
                                                                        monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(X, "BUDGET_MARGE", 200 * 1024)  # à l'échelle de la petite source du test
    full = (sources / "sansindex.mkv").stat().st_size
    with pytest.raises(ApiError) as caught:
        _clip(_single_raw(media.base, "sansindex.mkv", _kbps(sources / "sansindex.mkv")), tmp_path, monkeypatch,
              platform="tiktok", start_ms=100_000, end_ms=105_000)
    assert (caught.value.status, caught.value.code) == (422, "extrait_partiel_impossible")
    assert "Aucun téléchargement complet" in caught.value.detail
    assert media.sent < full * 0.8  # arrêté avant la fin du fichier


def test_hard_download_limit(media: MediaServer, sources: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    cfg = dict(CFG, extrait_telechargement_max_bytes=150 * 1024)
    with pytest.raises(ApiError) as caught:  # débit inconnu : seule la limite configurée s'applique
        _clip(_single_raw(media.base, "maitre.mp4", None, acodec="mp4a.40.2"), tmp_path, monkeypatch, platform="tiktok",
              start_ms=0, end_ms=100_000, cfg=cfg)
    assert caught.value.code == "extrait_partiel_impossible" and "limite du serveur" in caught.value.detail
    assert media.sent <= 150 * 1024 + X.PAS_MAX


def test_too_heavy_clip_is_refused_before_any_media_byte(media: MediaServer, sources: Path, tmp_path: Path,
                                                         monkeypatch: pytest.MonkeyPatch) -> None:
    cfg = dict(CFG, extrait_telechargement_max_bytes=1024 * 1024)
    with pytest.raises(ApiError) as caught:  # 15 s annoncées à 50 Mbit/s : ~100 Mo
        _clip(_single_raw(media.base, "maitre.mp4", 50_000.0, acodec="mp4a.40.2"), tmp_path, monkeypatch,
              platform="tiktok", cfg=cfg)
    assert (caught.value.status, caught.value.code) == (413, "extrait_trop_lourd")
    assert media.requests == []


def test_source_ignoring_range_is_refused(media: MediaServer, sources: Path, tmp_path: Path,
                                          monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ApiError) as caught:
        _clip(_single_raw(media.base, "norange/maitre.mp4", _kbps(sources / "maitre.mp4"), acodec="mp4a.40.2"),
              tmp_path, monkeypatch, platform="tiktok", start_ms=90_000, end_ms=95_000)
    assert caught.value.code == "extrait_partiel_impossible"
    assert media.sent < (sources / "maitre.mp4").stat().st_size  # le corps complet n'a pas été lu


def test_mp3_clip_of_a_silent_source_is_no_audio(media: MediaServer, sources: Path, tmp_path: Path,
                                                 monkeypatch: pytest.MonkeyPatch) -> None:
    """Codecs inconnus (traité comme muxé, comme Internet Archive) mais fichier muet : no_audio, pas download_failed."""
    raw = _single_raw(media.base, "v.mp4", _kbps(sources / "v.mp4"))
    raw["formats"][0].pop("acodec"), raw["formats"][0].pop("vcodec")
    with pytest.raises(ApiError) as caught:
        _clip(raw, tmp_path, monkeypatch, fmt="mp3", platform="archive", start_ms=10_000, end_ms=15_000)
    assert (caught.value.status, caught.value.code) == (400, "no_audio")


def test_only_dashy_formats_is_partial_impossible_without_any_request(media: MediaServer, sources: Path, tmp_path: Path,
                                                                      monkeypatch: pytest.MonkeyPatch) -> None:
    raw = _youtube_raw(media.base, sources)
    raw["formats"] = [f for f in raw["formats"] if "dashy" in f["format_id"]]
    with pytest.raises(ApiError) as caught:
        _clip(raw, tmp_path, monkeypatch)
    assert (caught.value.status, caught.value.code) == (422, "extrait_partiel_impossible")
    assert media.requests == []


def test_long_source_is_not_refused_for_a_clip(media: MediaServer, sources: Path, tmp_path: Path,
                                               monkeypatch: pytest.MonkeyPatch) -> None:
    raw = _youtube_raw(media.base, sources)
    cfg = dict(CFG, max_duration_s=60)  # la source (120 s) dépasse MAX_DURATION_S : sans effet sur un extrait
    result = _clip(raw, tmp_path, monkeypatch, cfg=cfg, start_ms=100_000, end_ms=102_000)
    assert Path(result["filepath"]).is_file()


def test_start_after_the_end_of_the_source(media: MediaServer, sources: Path, tmp_path: Path,
                                           monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ApiError) as caught:
        _clip(_youtube_raw(media.base, sources), tmp_path, monkeypatch, start_ms=125_000, end_ms=130_000)
    assert (caught.value.status, caught.value.code) == (422, "extrait_hors_source")
    assert media.requests == []


# --- annulation : le transfert s'arrête vraiment ----------------------------------------------------------------------


def _child_clip(raw: dict[str, Any], work: str, ready: Any) -> None:
    os.setpgrp()  # comme app.worker.child_main : le parent tue tout le groupe
    X.AUTORISER_PRIVE = True

    class Ydl(yt_dlp.YoutubeDL):
        def extract_info(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
            return json.loads(json.dumps(raw))

    worker.yt_dlp.YoutubeDL = Ydl  # type: ignore[misc]
    params = {"fmt": "mp4", "quality": "best", "bitrate": 128, "transcode": False, "index": 1, "start_s": 10.0,
              "end_s": 110.0, "startMs": 10_000, "endMs": 110_000}
    ready.set()
    worker.run_download({"kind": "download", "url": TT, "platform": "tiktok", "workdir": work, "params": params}, CFG,
                        Path(work), Reporter(_Conn()))  # type: ignore[arg-type]


def _group_members(pgid: int) -> list[int]:
    members = []
    for stat in Path("/proc").glob("[0-9]*/stat"):
        try:
            fields = stat.read_text().rsplit(")", 1)[1].split()
        except (OSError, IndexError):
            continue
        if int(fields[2]) == pgid and fields[0] != "Z":
            members.append(int(stat.parent.name))
    return members


def test_cancellation_kills_the_transfer(sources: Path, tmp_path: Path) -> None:
    from app.runner import _kill

    server = MediaServer(sources, debit=40_000)  # ~40 ko/s : le passage met longtemps à venir
    try:
        work = tmp_path / "job"
        work.mkdir()
        ctx = multiprocessing.get_context("spawn")  # processus neuf, comme les enfants du runner (forkserver)
        ready = ctx.Event()
        proc = ctx.Process(target=_child_clip, args=(_hls_raw(server.base, sources), str(work), ready), daemon=True)
        proc.start()
        assert ready.wait(10)
        deadline = time.monotonic() + 30
        while server.sent < 60_000 and time.monotonic() < deadline:
            time.sleep(0.1)
        assert server.sent >= 60_000, "le transfert n'a pas commencé"
        _kill(proc)  # ce que fait le runner sur DELETE /jobs/{id}
        proc.join(10)
        time.sleep(1.0)
        after_kill = server.sent
        time.sleep(2.0)
        assert server.sent == after_kill  # plus rien ne part : connexions fermées avec le processus
        assert _group_members(proc.pid) == []  # ni ffmpeg ni relais survivants
    finally:
        server.close()
    total = sum(f.stat().st_size for f in (sources / "hls").iterdir())
    assert after_kill < total / 2
