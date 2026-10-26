"""Import jobs of AETHRYON Music: asynchronous, real progress, cancellation, bounded size/duration/disk, cleanup.

A job only ever downloads the file named by an ImportPlan (decided by a "source_libre" connector from the source's
official answer) through app/music/web.py with the plan's host policy: catalogue hosts and streaming manifests are
refused at every hop. Steps: download (bytes counted) -> integrity (size, MD5/SHA-1 published by the source) -> magic
bytes -> ffprobe (one audio track, duration limit, real quality) -> tags (licence and source recorded in the file)
-> "termine" -> offered to AETHRYON Cloud (account decides: administrator only, same quota and 30-day expiry as the
videos; the music record travels in the object's metadata and survives the expiry of the audio).
Temporary disk: every job reserves twice its expected size (download + tagged copy) inside MUSIC_DISK_MAX_MB before
it starts; files are removed MUSIC_JOB_TTL_MIN after the end (later while their cloud upload runs).
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import secrets
import shutil
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any

from ..errors import ApiError
from ..filenames import sanitize_title
from . import audio
from .base import ImportPlan
from .model import AUDIO_TYPES
from .web import Cancelled, Web

if TYPE_CHECKING:
    from ..config import Settings
    from ..userkeys import Principal

log = logging.getLogger("ytapi.music")

LIBELLES = {"en_file": "En file d'attente", "telechargement": "Téléchargement", "verification": "Vérification",
            "etiquetage": "Étiquetage", "termine": "Importé", "echec": "Échec", "annule": "Annulé"}
ACTIFS = ("en_file", "telechargement", "verification", "etiquetage")
CLOUD_LIBELLES = {"en_file": ("en_attente", "En attente de sauvegarde cloud"),
                  "en_attente": ("en_attente", "En attente de sauvegarde cloud"),
                  "envoi_en_cours": ("envoi_en_cours", "Upload cloud en cours"),
                  "sauvegarde": ("sauvegarde", "Sauvegardé"), "echec": ("echec", "Échec de sauvegarde"),
                  "unknown": ("inconnu", "Sauvegarde cloud non confirmée")}
SPARE_DISK = 256 * 1024 * 1024  # free space always left on the volume


@dataclass
class MusicJob:
    id: str
    owner_user_id: str | None
    plan: ImportPlan
    workdir: Path
    kind: str = "music"
    usage_id: None = None
    etat: str = "en_file"
    received: int = 0
    total: int | None = None
    error: ApiError | None = None
    result: dict[str, Any] | None = None
    audio: dict[str, Any] | None = None
    etiquetage: str | None = None
    created_at: float = field(default_factory=time.time)
    ended_at: float | None = None
    reserved: int = 0
    cancel: threading.Event = field(default_factory=threading.Event)
    task: asyncio.Task[None] | None = None
    cloud_hold_until: float | None = None
    cloud_state: str | None = None
    cloud_meta: dict[str, Any] | None = None

    @property
    def media(self) -> SimpleNamespace:  # what app/cloud.py reads (job.media.platform)
        return SimpleNamespace(platform=self.plan.connecteur)


class MusicImports:
    def __init__(self, settings: Settings, web: Web, cloud_sink: Callable[[Any], Any] | None = None) -> None:
        self.settings = settings
        self.web = web
        self.cloud_sink = cloud_sink
        self.root = settings.tmp_dir / "music"
        self.jobs: dict[str, MusicJob] = {}
        self.reserved = 0
        self._sem = asyncio.Semaphore(settings.music_max_concurrent)
        self.ttl_s = settings.music_job_ttl_min * 60.0

    def start(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)  # leftovers of a previous process
        self.root.mkdir(parents=True, exist_ok=True)

    # ---- creation -------------------------------------------------------------------------------------------

    def create(self, principal: Principal, plan: ImportPlan) -> MusicJob:
        s = self.settings
        if plan.fichier.extension not in AUDIO_TYPES:
            raise ApiError(415, "type_refuse", "Format audio non pris en charge.")
        if plan.fichier.taille and plan.fichier.taille > s.music_max_file_bytes:
            raise ApiError(413, "fichier_trop_volumineux", f"Fichier trop volumineux ({plan.fichier.taille // 1048576} "
                                                           f"Mo ; {s.music_max_file_mb} Mo au plus).")
        if plan.fichier.duree_s and plan.fichier.duree_s > s.music_max_duration_s:
            raise ApiError(413, "duree_trop_longue", f"Fichier trop long ({int(plan.fichier.duree_s // 60)} min ; "
                                                     f"{s.music_max_duration_s // 60} min au plus).")
        active = [j for j in self.jobs.values() if j.etat in ACTIFS]
        if len(active) >= s.music_max_queue:
            raise ApiError(503, "file_pleine", "Trop d'imports en cours sur le serveur : réessaie dans une minute.",
                           {"Retry-After": "60"})
        owner = principal.user_id if principal.is_user else None
        if sum(1 for j in active if j.owner_user_id == owner) >= s.music_max_active_per_user:
            raise ApiError(429, "trop_d_imports", f"{s.music_max_active_per_user} imports au plus en même temps : "
                                                  "attends la fin de ceux en cours.", {"Retry-After": "15"})
        need = 2 * (plan.fichier.taille or s.music_max_file_bytes)
        if self.reserved + need > s.music_disk_max_bytes or self._free() < need + SPARE_DISK:
            raise ApiError(503, "espace_temporaire_plein", "Espace temporaire du serveur occupé par d'autres imports : "
                                                           "réessaie dans quelques minutes.", {"Retry-After": "120"})
        job_id = "mus_" + secrets.token_urlsafe(16)
        workdir = self.root / job_id
        workdir.mkdir(parents=True)
        job = MusicJob(job_id, owner, plan, workdir, reserved=need, total=plan.fichier.taille)
        self.reserved += need
        self.jobs[job_id] = job
        job.task = asyncio.create_task(self._run(job), name=f"music-{job_id}")
        log.info("music: import queued", extra={"job_id": job_id, "connecteur": plan.connecteur,
                                                "user": owner or principal.label})
        return job

    def _free(self) -> int:
        try:
            return shutil.disk_usage(self.root).free
        except OSError:
            return 0

    # ---- run ------------------------------------------------------------------------------------------------

    async def _run(self, job: MusicJob) -> None:
        try:
            async with self._sem:
                if job.cancel.is_set():
                    raise Cancelled()
                job.etat = "telechargement"
                raw = await asyncio.to_thread(self._download, job)
                job.etat = "verification"
                ext = await asyncio.to_thread(self._verify, job, raw)
                if job.cancel.is_set():
                    raise Cancelled()
                job.audio = await asyncio.to_thread(audio.probe, raw, self.settings.music_max_duration_s)
                job.etat = "etiquetage"
                final = await asyncio.to_thread(self._tag, job, raw, ext)
                if job.cancel.is_set():
                    raise Cancelled()
            size = final.stat().st_size
            job.result = {"filepath": str(final), "download_name": final.name, "media_type": AUDIO_TYPES[ext][0],
                          "ext": ext, "size": size}
            self._resize(job, size)
            job.etat = "termine"
            job.ended_at = time.time()
            log.info("music: import done", extra={"job_id": job.id, "connecteur": job.plan.connecteur, "size": size,
                                                  "tagged": job.etiquetage})
            if self.cloud_sink is not None and job.owner_user_id:
                job.cloud_meta = {"musique": {**job.plan.musique(), "audio": job.audio}}
                job.cloud_state = "en_file"
                try:
                    if self.cloud_sink(job) is False:
                        job.cloud_state = None
                except Exception:  # never let the backup disturb the import
                    job.cloud_state = None
                    log.exception("music: cloud offer failed", extra={"job_id": job.id})
        except Cancelled:
            self._fail(job, None, "annule")
        except ApiError as exc:
            self._fail(job, exc, "echec")
        except asyncio.CancelledError:
            self._fail(job, None, "annule")
            raise
        except Exception:
            log.exception("music: import crashed", extra={"job_id": job.id})
            self._fail(job, ApiError(500, "erreur_interne", "Import impossible (erreur interne)."), "echec")

    def _fail(self, job: MusicJob, exc: ApiError | None, etat: str) -> None:
        job.etat, job.error, job.ended_at = etat, exc, time.time()
        shutil.rmtree(job.workdir, ignore_errors=True)
        self._resize(job, 0)
        log.info("music: import ended", extra={"job_id": job.id, "etat": etat, "code": exc.code if exc else None})

    def _resize(self, job: MusicJob, size: int) -> None:
        self.reserved = max(0, self.reserved - job.reserved + size)
        job.reserved = size

    def _download(self, job: MusicJob) -> Path:
        f = job.plan.fichier
        part = job.workdir / f"source.{f.extension}"
        limit = f.taille or self.settings.music_max_file_bytes

        def progress(received: int, total: int | None) -> None:
            job.received = received
            if total is not None:
                job.total = total

        with part.open("wb") as sink:
            resp = self.web.request("GET", f.url, job.plan.policy, sink=sink, max_bytes=limit,
                                    deadline_s=self.settings.music_download_timeout_s, progress=progress,
                                    cancelled=job.cancel.is_set, accept_status=(200,))
        if resp.status in (404, 410):
            raise ApiError(404, "introuvable", "Le fichier n'est plus disponible à la source.")
        if resp.status in (401, 403):
            raise ApiError(403, "source_refusee", "La source refuse le téléchargement de ce fichier.")
        if resp.status != 200:
            raise ApiError(503, "source_indisponible", f"La source ne répond pas (réponse {resp.status}).",
                           {"Retry-After": "60"})
        ctype = resp.header("content-type").lower().split(";")[0].strip()
        if ctype.startswith(("text/", "image/", "video/")) or "html" in ctype or "json" in ctype:
            raise ApiError(415, "type_refuse", f"La source a envoyé autre chose qu'un fichier audio ({ctype[:40]}).")
        job.received = resp.received
        return part

    def _verify(self, job: MusicJob, raw: Path) -> str:
        f = job.plan.fichier
        size = raw.stat().st_size
        if size == 0:
            raise ApiError(422, "fichier_invalide", "Fichier vide.")
        if f.taille and size != f.taille:
            raise ApiError(422, "integrite", "Taille différente de celle publiée par la source : fichier refusé.")
        if f.md5 or f.sha1:
            h = hashlib.md5() if f.md5 else hashlib.sha1()  # noqa: S324 - integrity checks published by the source
            with raw.open("rb") as fh:
                while chunk := fh.read(1024 * 1024):
                    h.update(chunk)
            if h.hexdigest() != (f.md5 or f.sha1):
                raise ApiError(422, "integrite", "Empreinte différente de celle publiée par la source : fichier refusé.")
        with raw.open("rb") as fh:
            head = fh.read(64)
        sniffed = audio.sniff(head)
        if sniffed is None or not audio.same_family(f.extension, sniffed):
            raise ApiError(415, "type_refuse", "Le contenu du fichier ne correspond pas à un fichier audio "
                                               f"{f.extension.upper()} : fichier refusé.")
        return sniffed if sniffed != f.extension and sniffed in AUDIO_TYPES else f.extension

    def _tag(self, job: MusicJob, raw: Path, ext: str) -> Path:
        p = job.plan
        artist = ", ".join(p.artistes[:5])
        stem = sanitize_title(f"{artist} - {p.titre}" if artist else p.titre, fallback="morceau")[:150]
        final = job.workdir / f"{stem}.{ext}"
        lic = f"{p.licence.nom}" + (f" — {p.licence.url}" if p.licence.url else "")
        tags = {"title": p.titre, "artist": artist or None, "album": p.album, "date": p.date,
                "copyright": f"Licence : {lic}", "license": p.licence.url or p.licence.nom,
                "comment": f"{p.attribution or ''} Source : {p.source_url}. Importé par AETHRYON Music.".strip()}
        if audio.tag(raw, final, ext, tags):
            raw.unlink(missing_ok=True)
            job.etiquetage = "ok"
        else:
            raw.replace(final)
            job.etiquetage = "impossible"
        return final

    # ---- access ---------------------------------------------------------------------------------------------

    def get(self, job_id: str, principal: Principal) -> MusicJob:
        job = self.jobs.get(job_id)
        owner = principal.user_id if principal.is_user else None
        if job is None or job.owner_user_id != owner:
            raise ApiError(404, "import_introuvable", "Import introuvable (terminé depuis longtemps ou inconnu).")
        return job

    def list_for(self, principal: Principal) -> list[MusicJob]:
        owner = principal.user_id if principal.is_user else None
        return sorted((j for j in self.jobs.values() if j.owner_user_id == owner), key=lambda j: -j.created_at)

    def cancel(self, job: MusicJob) -> None:
        """Running: stops at the next chunk (state "annule", files removed). Finished: the local file is removed now
        (a cloud copy is never touched here)."""
        if job.etat in ACTIFS:
            job.cancel.set()
            if job.etat == "en_file" and job.task is not None:
                job.task.cancel()  # still waiting for a download slot
            return
        if job.cloud_hold_until and job.cloud_hold_until > time.time():
            raise ApiError(409, "sauvegarde_en_cours", "Sauvegarde cloud en cours : réessaie après sa fin.")
        shutil.rmtree(job.workdir, ignore_errors=True)
        self._resize(job, 0)
        self.jobs.pop(job.id, None)

    async def cleanup(self) -> None:
        now = time.time()
        for job in list(self.jobs.values()):
            if job.ended_at is None or now - job.ended_at < self.ttl_s:
                continue
            if job.cloud_hold_until and job.cloud_hold_until > now:
                continue
            shutil.rmtree(job.workdir, ignore_errors=True)
            self._resize(job, 0)
            self.jobs.pop(job.id, None)

    async def shutdown(self) -> None:
        for job in self.jobs.values():
            job.cancel.set()
        tasks = [j.task for j in self.jobs.values() if j.task and not j.task.done()]
        for t in tasks:
            t.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        shutil.rmtree(self.root, ignore_errors=True)

    # ---- view -----------------------------------------------------------------------------------------------

    def view(self, job: MusicJob, file_url: str | None = None) -> dict[str, Any]:
        p = job.plan
        pct = None
        if job.total:
            pct = round(min(100.0, 100.0 * job.received / job.total), 1)
        if job.etat == "termine":
            pct = 100.0
        out: dict[str, Any] = {
            "id": job.id, "etat": job.etat, "libelle": LIBELLES[job.etat], "connecteur": p.connecteur,
            "titre": p.titre, "artistes": p.artistes, "album": p.album,
            "progression": {"octets": job.received, "total": job.total, "pourcentage": pct},
            "erreur": {"code": job.error.code, "detail": job.error.detail} if job.error else None,
            "licence": p.licence.to_json(), "attribution": p.attribution, "sourceUrl": p.source_url,
            "attestation": p.attestation, "fichier": None, "cloud": None,
            "creeLe": _iso(job.created_at), "termineLe": _iso(job.ended_at) if job.ended_at else None,
            "disponibleJusquA": _iso(job.ended_at + self.ttl_s) if job.ended_at and job.etat == "termine" else None,
        }
        if job.etat == "termine" and job.result:
            out["fichier"] = {"nom": job.result["download_name"], "type": job.result["media_type"],
                              "taille": job.result["size"], "url": file_url, "audio": job.audio,
                              "etiquetage": job.etiquetage}
        if job.cloud_state and job.cloud_state != "skipped:non_admin":
            etat, libelle = CLOUD_LIBELLES.get(job.cloud_state, ("non_sauvegarde", "Non sauvegardé dans le cloud"))
            out["cloud"] = {"etat": etat, "libelle": libelle,
                            "raison": job.cloud_state.split(":", 1)[1] if job.cloud_state.startswith("skipped:") else None}
        return out


def _iso(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))
