"""In-memory async jobs (single uvicorn worker by design: state is lost on restart).

Identical requests (same media + same output parameters) are merged while a job is queued or
running, and served from the result cache once done (see app/cache.py). A merged job is shared:
each participant counts as a subscriber, and DELETE only cancels/removes the job when the last
subscriber leaves.
"""

from __future__ import annotations

import asyncio
import logging
import os
import secrets
import shutil
import time
from collections.abc import Awaitable, Callable
from contextlib import AsyncExitStack
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from .cache import CacheEntry, ResultCache, link_or_copy
from .config import Settings
from .errors import ApiError
from .params import TOOLS_OPS, DeriveParams, DownloadParams
from .runner import Cancelled, Runner, Task, error_cause
from .urls import MediaUrl, result_matches_media
from .userkeys import Principal

log = logging.getLogger("ytapi.jobs")

JobStatus = Literal["queued", "running", "done", "error"]
# Files derived from one finished job (compression, GIF), at most: the source's quota unit covers them.
# (Default of MAX_DERIVED_PER_SOURCE; the AETHRYON Tools raise it in production.)
MAX_DERIVED_PER_SOURCE = 6
# Imported files (AETHRYON Tools): pseudo link and platform of their jobs (never contacted, never cached).
UPLOAD_URL = "fichier:import"
UPLOAD_MEDIA = MediaUrl(url=UPLOAD_URL, host="fichier", platform="fichier")
CookiesFor = Callable[[str], str | None]
# usage_sink(usage_id, state, **fields): per-user usage events (USER_KEYS_ENABLED), never with URL/title.
UsageSink = Callable[..., None]
# cloud_sink(job): AETHRYON Cloud backup of a finished user job (app/cloud.py); must never raise nor block.
CloudSink = Callable[["Job"], None]


CHANGE_HOLD_S = 2.0  # GET /jobs/{id}?wait=N&change=true: shortest hold before answering on a change


@dataclass
class Job:
    id: str
    params: DownloadParams
    media: MediaUrl
    workdir: Path
    key: str = ""
    task_params: dict[str, Any] = field(default_factory=dict)
    status: JobStatus = "queued"
    stage: str = "queued"
    progress: float = 0.0
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    error: str | None = None
    error_status: int | None = None
    detail: str | None = None
    # Cleaned technical cause of a failure (app.runner.error_cause, no URL, <= 300 chars): logs and the
    # usage event sent to account only, never part of the job's public view.
    cause: str | None = None
    retry_at: float | None = None  # wall clock, from a Retry-After on the failure (YouTube pause, queue full)
    subscribers: int = 1
    result: dict[str, Any] | None = None
    cached: bool = False
    # Per-user keys: owner and quota unit; merge_key keeps a user's jobs apart from other callers'.
    owner_user_id: str | None = None
    usage_id: str | None = None
    merge_key: str = ""
    # Derived file (POST /jobs/{id}/derive): made by ffmpeg from the file of job `source_id`.
    # upload: file imported by its owner (AETHRYON Tools, POST /uploads): received in chunks, then checked.
    kind: Literal["download", "derive", "upload"] = "download"
    derive: dict[str, Any] | None = None
    source_id: str | None = None
    # AETHRYON Tools: kept past JOB_TTL_MIN while an editor uses it (POST /jobs/{id}/keep), never past the cap.
    keep_until: float | None = None
    # AETHRYON Cloud: files kept while their backup runs (app/cloud.py), never past the cap set by CloudSync.
    cloud_hold_until: float | None = None
    # The file comes from an import (directly or derived from one): ffmpeg reads it with the input whitelists.
    from_upload: bool = False
    # Import in progress: expected size, chunk size, received chunk indexes, last activity (monotonic clock).
    upload: dict[str, Any] | None = None
    reserved: bool = True  # holds a place in the runner's queue (released when the job ends)
    # Clips (CONTRAT-EXTRAITS): public stage (analyse, recuperation, conversion, finalisation), measured progress of
    # that stage (0..1, None when it cannot be measured) and bytes received from the platform so far.
    etape: str | None = None
    progression: float | None = None
    octets: int | None = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    finished: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task[None] | None = None

    def touch(self) -> None:
        self.updated_at = time.time()

    @property
    def active(self) -> bool:
        return self.status in ("queued", "running")

    def retry_after_s(self) -> int | None:
        if self.retry_at is None:
            return None
        return max(1, int(self.retry_at - time.time()) + 1)

    def expires_at(self, ttl_s: int) -> float | None:
        if self.finished_at is None:
            return None
        hold = self.cloud_hold_until or 0.0
        return max(self.finished_at + ttl_s, self.keep_until or 0.0, hold if hold > time.time() else 0.0)

    def error_headers(self) -> dict[str, str]:
        retry = self.retry_after_s()
        return {"Retry-After": str(retry)} if retry is not None and self.status == "error" else {}

    def internal(self) -> dict[str, Any]:
        """View of an active job for the internal admin API (Control Center): ids and progress only,
        never the URL, the title or the file name."""
        return {
            "job_id": self.id,
            "usage_id": self.usage_id,
            "user_id": self.owner_user_id,  # None: job of an admin token
            "platform": self.media.platform,
            "fmt": self.params.fmt,
            "quality": self.params.quality if self.params.fmt == "mp4" else None,  # as in params.summary()
            "stage": self.stage,
            "progress": round(self.progress, 1),
            "status": self.status,
            "created_at": _iso(self.created_at),
            "updated_at": _iso(self.updated_at),
        }

    @property
    def is_clip(self) -> bool:
        return self.kind == "download" and self.params.clip

    def clip_view(self) -> dict[str, Any]:
        """Fields of the clip contract: etape (attente, analyse, recuperation, conversion, finalisation, termine,
        erreur, annule), progression (only while measurable), octetsTelecharges, extrait (details once done)."""
        if self.status == "queued":
            etape = "attente"
        elif self.status == "done":
            etape = "termine"
        elif self.status == "error":
            etape = "annule" if self.error == "cancelled" else "erreur"
        else:
            etape = self.etape or "analyse"
        view: dict[str, Any] = {"etape": etape}
        if self.status == "running" and self.progression is not None:
            view["progression"] = round(self.progression, 3)
        details = dict((self.result or {}).get("extrait") or {})
        if self.cached:
            details["methode"] = "cache"  # nothing was fetched for this job: the file came from the result cache
            view["octetsTelecharges"] = 0
        else:
            view["octetsTelecharges"] = details.get("octetsTelecharges", self.octets or 0)
        if details:
            view["extrait"] = details
        return view

    def public(self, ttl_s: int) -> dict[str, Any]:
        data: dict[str, Any] = {
            "job_id": self.id,
            "status": self.status,
            "stage": self.stage,
            "progress": round(self.progress, 1),
            "platform": self.media.platform,
            "params": self.params.summary(),
            "cached": self.cached,
            "created_at": _iso(self.created_at),
            "updated_at": _iso(self.updated_at),
            "expires_at": _iso(self.expires_at(ttl_s)) if self.finished_at else None,  # type: ignore[arg-type]
        }
        if self.kind != "download":
            data["kind"] = self.kind
        if self.is_clip:
            data.update(self.clip_view())
        if self.derive is not None:
            data["derive"] = dict(self.derive, source_job_id=self.source_id)
        if self.upload is not None and self.status in ("queued", "running"):
            # name: the owner's own file name (cleaned), so that an interrupted import says which file to pick again.
            data["upload"] = {"size_bytes": self.upload["size"], "chunk_bytes": self.upload["chunk"],
                              "chunks": self.upload["chunks"], "received": sorted(self.upload["received"]),
                              "name": self.upload.get("name") or None}
        # Only present on failure, so that iOS Shortcuts can test "error has a value".
        if self.error:
            data.update(error=self.error, detail=self.detail)
            if self.retry_at is not None:
                data["retry_after_s"] = self.retry_after_s()
        if self.result:
            data.update(
                title=self.result.get("title"),
                filename=self.result.get("download_name"),
                size_bytes=self.result.get("size"),
                media_type=self.result.get("media_type"),
            )
            if self.result.get("notes"):
                data["notes"] = self.result["notes"]
            if self.result.get("media"):
                data["media"] = self.result["media"]
        return data


def _iso(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


class JobManager:
    def __init__(self, settings: Settings, runner: Runner, cache: ResultCache | None = None,
                 cookies_for: CookiesFor | None = None, usage_sink: UsageSink | None = None,
                 cloud_sink: CloudSink | None = None) -> None:
        # cookies_for(platform): path of the validated cookies file (YouTube only) or None;
        # raises cookies_invalid when the file is broken.
        self.settings = settings
        self.runner = runner
        self.cache = cache
        self.cookies_for = cookies_for or (lambda _platform: None)
        self.usage_sink = usage_sink
        self.cloud_sink = cloud_sink
        self.jobs: dict[str, Job] = {}

    @property
    def ttl_s(self) -> int:
        return self.settings.job_ttl_min * 60

    def counts(self) -> dict[str, int]:
        counts = {"queued": 0, "running": 0, "done": 0, "error": 0}
        for job in self.jobs.values():
            counts[job.status] += 1
        return counts

    def find_active(self, key: str) -> Job | None:
        """A queued/running job producing the same file, if any (merging identical requests).

        `key` is a merge key: the cache key for admin tokens, the cache key + user id for user keys
        (a user never joins another caller's job, so job ids are never shared between users)."""
        if not key:
            return None
        for job in self.jobs.values():
            if (job.merge_key or job.key) == key and job.active:
                return job
        return None

    @staticmethod
    def user_merge_key(key: str, user_id: str) -> str:
        return f"{key}|user:{user_id}" if key else ""

    def active_for_user(self, user_id: str) -> list[Job]:
        """Jobs that use the server for this user (an import still receiving its chunks does not)."""
        return [job for job in self.jobs.values() if job.owner_user_id == user_id and job.active
                and not (job.kind == "upload" and job.stage == "uploading")]

    def pending_upload(self, user_id: str) -> Job | None:
        """The user's import still receiving chunks, if any (one at a time: it can be resumed or cancelled)."""
        return next((job for job in self.jobs.values() if job.owner_user_id == user_id and job.kind == "upload"
                     and job.stage == "uploading"), None)

    def active_jobs(self) -> list[Job]:
        """Queued and running jobs, oldest first."""
        return sorted((job for job in self.jobs.values() if job.active), key=lambda job: job.created_at)

    def create(self, params: DownloadParams, media: MediaUrl, task_params: dict[str, Any] | None = None,
               key: str = "", *, owner: Principal | None = None, usage_id: str | None = None) -> tuple[Job, bool]:
        """Return (job, merged). merged=True when an identical job was already queued/running.

        Merging and the cache come first: they never contact the platform, so they keep working
        while YouTube is paused or the cookies file is broken."""
        user_id = owner.user_id if owner is not None and owner.is_user else None
        merge_key = self.user_merge_key(key, user_id) if user_id else key
        if user_id and key:
            # Separate result-cache namespace for user jobs: they never receive a file produced for an
            # admin (possibly with the owner's YouTube cookies), and admins never get theirs.
            key = f"u|{key}"
        existing = self.find_active(merge_key)
        if existing is not None:
            existing.subscribers += 1
            log.info("job merged", extra={"job_id": existing.id, "subscribers": existing.subscribers})
            return existing, True
        entry = self.cache.get(key) if self.cache and key else None
        if entry is not None:
            try:
                job = self._create_cached(params, media, key, entry, merge_key, user_id, usage_id)
                self._usage(job, "done", size_bytes=(job.result or {}).get("size"))
                self._cloud(job)
                return job, False
            except OSError:
                log.warning("cache entry unusable, downloading again", extra={"key": key})
        self.runner.platforms.check_available(media.platform)  # 503 + Retry-After during a YouTube pause
        if self._uses_cookies(user_id):
            self.cookies_for(media.platform)  # 500 cookies_invalid before queueing anything
        self.runner.reserve()  # 503 when the queue or the disk is full
        try:
            job = self._new_job(params, media, key, task_params, merge_key, user_id, usage_id)
        except BaseException:
            self.runner.release()
            raise
        job.task = asyncio.create_task(self._run(job), name=f"job-{job.id}")
        log.info("job created", extra={**_log_ids(job), "platform": media.platform, **params.summary()})
        return job, False

    def _new_job(self, params: DownloadParams, media: MediaUrl, key: str,
                 task_params: dict[str, Any] | None, merge_key: str = "", owner_user_id: str | None = None,
                 usage_id: str | None = None) -> Job:
        job_id = secrets.token_urlsafe(12)
        workdir = self.settings.tmp_dir / f"job-{job_id}"
        workdir.mkdir(parents=True, exist_ok=False)
        job = Job(id=job_id, params=params, media=media, workdir=workdir, key=key,
                  task_params=task_params or params.model_dump(), merge_key=merge_key or key,
                  owner_user_id=owner_user_id, usage_id=usage_id)
        self.jobs[job_id] = job
        return job

    def find_derived(self, source: Job, dparams: DeriveParams) -> Job | None:
        """The same derivation of the same file, running or done with its file still there (idempotent retries)."""
        key = _derive_key(source, dparams)
        for job in self.jobs.values():
            if job.merge_key != key:
                continue
            if job.active or (job.status == "done" and job.result and Path(job.result["filepath"]).is_file()):
                return job
        return None

    def derive(self, source: Job, dparams: DeriveParams) -> tuple[Job, bool]:
        """New job making a file from the finished file of `source` (same owner, no quota unit, no platform
        access). Returns (job, joined): joined=True when the same derivation already exists."""
        existing = self.find_derived(source, dparams)
        if existing is not None:
            # A user's source is theirs alone: asking again for the same file (retry, double click, second tab) is the
            # same participant, so their « Supprimer » or « Annuler » really removes the file or stops the work (it
            # used to only detach one of several participants: the file came back on reload, the work went on).
            if existing.owner_user_id is None:
                existing.subscribers += 1
            return existing, True
        limit = self.settings.max_derived_per_source
        if sum(1 for job in self.jobs.values() if job.source_id == source.id) >= limit:
            raise ApiError(429, "derive_limit",
                           f"Au plus {limit} fichiers dérivés par conversion : relance une conversion.")
        assert source.result is not None
        self.runner.reserve()  # 503 when the queue or the disk is full
        try:
            job_id = secrets.token_urlsafe(12)
            workdir = self.settings.tmp_dir / f"job-{job_id}"
            workdir.mkdir(parents=True, exist_ok=False)
            try:
                # Own hard link: the source job may expire or be deleted while this one runs.
                own = link_or_copy(Path(source.result["filepath"]), workdir / "source")
            except OSError:
                _remove_dir(workdir)
                raise ApiError(410, "file_gone", "Le fichier a expiré ou a été supprimé : relancez le job.") from None
            fmt = {"gif": "gif", "audio": "mp3"}.get(dparams.op, "mp4")
            update: dict[str, Any] = {"fmt": fmt, "start_s": None, "end_s": None}
            if dparams.op == "gif":
                update.update(gif_width=dparams.gif_width, gif_fps=dparams.gif_fps)
            params = source.params.model_copy(update=update)
            tools = dparams.op in TOOLS_OPS or dparams.uses_tools_fields() or source.from_upload
            task_params = {**dparams.model_dump(), "source": str(own), "title": source.result.get("title"),
                           "media_id": source.result.get("id"), "tools": tools, "from_upload": source.from_upload}
            job = Job(id=job_id, params=params, media=source.media, workdir=workdir, task_params=task_params,
                      merge_key=_derive_key(source, dparams), owner_user_id=source.owner_user_id, kind="derive",
                      derive=dparams.summary(), source_id=source.id, from_upload=source.from_upload,
                      keep_until=source.keep_until)
            self.jobs[job_id] = job
        except BaseException:
            self.runner.release()
            raise
        job.task = asyncio.create_task(self._run(job), name=f"job-{job.id}")
        log.info("derived job created", extra={**_log_ids(job), "source_job_id": source.id, **dparams.summary()})
        return job, False

    # --- imported files (AETHRYON Tools) ------------------------------------------------------------------------

    def create_upload(self, owner_user_id: str, usage_id: str | None, name: str, size: int, audio: bool) -> Job:
        """Job of an import: an empty file of the announced size (disk space taken now, not halfway through), filled
        chunk by chunk (write_chunk), checked by complete_upload. No queue place: the check runs in an info slot."""
        chunk = self.settings.upload_chunk_bytes
        self.runner.check_space(size)
        job_id = secrets.token_urlsafe(12)
        workdir = self.settings.tmp_dir / f"job-{job_id}"
        workdir.mkdir(parents=True, exist_ok=False)
        try:
            fd = os.open(workdir / "source.bin", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            try:
                os.posix_fallocate(fd, 0, size)
            finally:
                os.close(fd)
        except OSError:
            _remove_dir(workdir)
            raise ApiError(503, "insufficient_storage", "Espace disque insuffisant pour ce fichier : réessaie plus tard.",
                           {"Retry-After": "300"}) from None
        params = DownloadParams(url=UPLOAD_URL, fmt="mp3" if audio else "mp4")
        job = Job(id=job_id, params=params, media=UPLOAD_MEDIA, workdir=workdir, owner_user_id=owner_user_id,
                  usage_id=usage_id, kind="upload", status="running", stage="uploading", from_upload=True,
                  reserved=False, merge_key=f"upload|{job_id}",
                  upload={"size": size, "chunk": chunk, "chunks": max(1, -(-size // chunk)), "received": set(),
                          "name": name, "last": time.monotonic()})
        self.jobs[job_id] = job
        self._usage(job, "running")
        log.info("upload created", extra={**_log_ids(job), "size": size, "chunks": job.upload["chunks"]})  # type: ignore[index]
        return job

    def chunk_span(self, job: Job, index: int) -> tuple[int, int]:
        """(offset, exact length) of chunk `index` of an import in progress; 409/416 otherwise."""
        up = job.upload
        if job.kind != "upload" or up is None or job.stage != "uploading":
            raise ApiError(409, "upload_closed", "Cet import n'attend plus de morceaux.")
        if not 0 <= index < up["chunks"]:
            raise ApiError(416, "chunk_out_of_range", "Numéro de morceau hors du fichier.")
        offset = index * up["chunk"]
        return offset, min(up["chunk"], up["size"] - offset)

    def chunk_written(self, job: Job, index: int) -> None:
        assert job.upload is not None
        job.upload["received"].add(index)
        job.upload["last"] = time.monotonic()
        job.progress = min(95.0, 95.0 * len(job.upload["received"]) / job.upload["chunks"])
        job.touch()

    def complete_upload(self, job: Job) -> None:
        """Every chunk is there: check the file in a worker (ffprobe/ffmpeg with the input whitelists)."""
        up = job.upload
        if job.kind != "upload" or up is None:
            raise ApiError(409, "upload_closed", "Cet import n'attend plus de morceaux.")
        if job.stage != "uploading":
            return  # already being checked (idempotent)
        missing = up["chunks"] - len(up["received"])
        if missing:
            raise ApiError(409, "upload_incomplete", f"Il manque {missing} morceau(x) du fichier.")
        job.stage, job.progress = "checking", 96.0
        job.task_params = {"source": str(job.workdir / "source.bin"), "name": up["name"]}
        job.task = asyncio.create_task(self._run(job), name=f"job-{job.id}")

    async def expire_stalled_uploads(self) -> int:
        """Imports without a new chunk for UPLOAD_IDLE_MIN: abandoned, their unit given back."""
        limit = self.settings.upload_idle_min * 60
        now = time.monotonic()
        stalled = [job for job in self.jobs.values()
                   if job.kind == "upload" and job.stage == "uploading" and job.upload is not None
                   and now - job.upload["last"] > limit]
        for job in stalled:
            self.jobs.pop(job.id, None)
            _remove_dir(job.workdir)
            self._usage(job, "refunded")
            log.info("upload abandoned", extra=_log_ids(job))
        return len(stalled)

    def list_for_user(self, user_id: str, limit: int = 50) -> list[Job]:
        """The caller's jobs still known (newest first): its imports, conversions and exports."""
        mine = [job for job in self.jobs.values() if job.owner_user_id == user_id]
        return sorted(mine, key=lambda job: job.created_at, reverse=True)[:limit]

    def keep(self, job: Job) -> float:
        """An editor uses this file: keep it (and what was made from it) TOOLS_KEEP_MIN more, within the cap."""
        now = time.time()
        cap = job.created_at + self.settings.tools_keep_max_min * 60
        until = max(job.keep_until or 0.0, min(now + self.settings.tools_keep_min * 60, cap))
        for other in [job, *(j for j in self.jobs.values() if j.source_id == job.id)]:
            other.keep_until = max(other.keep_until or 0.0, until)
        return job.expires_at(self.ttl_s) or until

    def _uses_cookies(self, owner_user_id: str | None) -> bool:
        return owner_user_id is None or self.settings.user_jobs_use_cookies

    def _usage(self, job: Job, state: str, **fields: Any) -> None:
        if job.usage_id and self.usage_sink is not None:
            try:
                self.usage_sink(job.usage_id, state, job_id=job.id, platform=job.media.platform, **fields)
            except Exception:  # accounting must never break a download
                log.exception("usage event failed", extra={"job_id": job.id})

    def _cloud(self, job: Job) -> None:
        """Offer a finished user job to the cloud backup: after the delivery is decided, never blocking it."""
        if self.cloud_sink is not None and job.owner_user_id and job.kind in ("download", "derive"):
            try:
                self.cloud_sink(job)
            except Exception:  # the backup must never turn a successful download into a failure
                log.exception("cloud sink failed", extra={"job_id": job.id})

    def _create_cached(self, params: DownloadParams, media: MediaUrl, key: str, entry: CacheEntry,
                       merge_key: str = "", owner_user_id: str | None = None, usage_id: str | None = None) -> Job:
        job = self._new_job(params, media, key, None, merge_key, owner_user_id, usage_id)
        assert self.cache is not None
        try:
            job.result = self.cache.materialize(entry, job.workdir)
        except BaseException:
            self.jobs.pop(job.id, None)
            _remove_dir(job.workdir)
            raise
        job.status, job.stage, job.progress, job.cached = "done", "done", 100.0, True
        job.finished_at = time.time()
        job.finished.set()
        log.info("job served from cache", extra={"job_id": job.id})
        return job

    def get(self, job_id: str, principal: Principal | None = None) -> Job:
        job = self.jobs.get(job_id)
        # A user key only sees its own jobs; same 404 as an unknown id (ids cannot be probed).
        if job is None or (principal is not None and principal.is_user and job.owner_user_id != principal.user_id):
            raise ApiError(404, "job_not_found", "Job inconnu ou expiré (le serveur a peut-être redémarré).")
        return job

    async def wait(self, job: Job, timeout_s: float, is_disconnected: Callable[[], Awaitable[bool]] | None,
                   on_change: bool = False) -> None:
        """Wait until the job finishes, the timeout expires or the client goes away. on_change: also return as soon
        as the status, the stage or the whole percent moved, but not before CHANGE_HOLD_S (a progress bar that
        follows the real work with at most one request every 2 s per watched job)."""
        start = time.monotonic()
        deadline = start + timeout_s
        seen = (job.status, job.stage, int(job.progress))
        while not job.finished.is_set():
            if on_change and time.monotonic() - start >= CHANGE_HOLD_S and (job.status, job.stage, int(job.progress)) != seen:
                return
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            try:
                await asyncio.wait_for(job.finished.wait(), timeout=min(0.5, remaining))
            except TimeoutError:
                if is_disconnected is not None and await is_disconnected():
                    return

    def subscribe(self, job: Job) -> None:
        job.subscribers += 1

    async def delete(self, job_id: str, principal: Principal | None = None, with_exports: bool = False) -> int:
        """DELETE: the caller leaves the job (the last one removes it). with_exports: the exports made from this
        file by the same owner go with it (AETHRYON Tools: « Supprimer » a media removes what was made of it).
        Returns the number of exports removed."""
        job = self.get(job_id, principal)
        derived = [j for j in self.jobs.values() if j.source_id == job.id
                   and (principal is None or not principal.is_user or j.owner_user_id == principal.user_id)] if with_exports else []
        await self.unsubscribe(job)
        for other in derived:
            other.subscribers = 1  # every participant of an export of this file leaves with it
            await self.unsubscribe(other)
        return len(derived)

    async def cancel(self, job_id: str) -> Job:
        """Cancellation by an administrator (internal API): stops a queued or running job whoever is
        waiting for it (merged requests included), with the same mechanism as the last DELETE
        (cancel event, then up to 15 s for the worker to be killed and the files removed).

        The job stays listed as failed with the code `cancelled` until JOB_TTL_MIN, so its owner reads
        « La conversion a été annulée. » instead of « Job inconnu » ; the usage event `cancelled`
        (with job_id) is sent by _run. Unknown id: 404; job already finished: 409 (nothing changes)."""
        job = self.jobs.get(job_id)
        if job is None:
            raise ApiError(404, "job_not_found", "Job inconnu ou expiré (le serveur a peut-être redémarré).")
        if not job.active:
            if job.error == "cancelled":
                raise ApiError(409, "job_already_cancelled", "Ce job est déjà annulé.")
            raise ApiError(409, "job_finished", f"Ce job est déjà terminé ({job.status}) : rien à annuler.")
        job.cancel_event.set()
        log.info("job cancel requested", extra={**_log_ids(job), "by": "internal"})
        if job.task is not None and not job.task.done():
            try:
                await asyncio.wait_for(asyncio.shield(job.task), timeout=15)
            except (TimeoutError, asyncio.CancelledError):
                job.task.cancel()
        if job.status == "done" or (job.status == "error" and job.error != "cancelled"):
            # Finished (or failed for another reason) just before the cancellation was seen: kept as is.
            raise ApiError(409, "job_finished", f"Ce job s'est terminé ({job.status}) avant l'annulation.")
        return job

    async def unsubscribe(self, job: Job) -> None:
        """One participant leaves; the last one cancels the job and removes its files."""
        job.subscribers -= 1
        if job.subscribers > 0:
            log.info("job detached", extra={"job_id": job.id, "subscribers": job.subscribers})
            return
        if self.jobs.get(job.id) is not job:
            return  # already expired / removed
        job_id = job.id
        self.jobs.pop(job_id, None)
        job.cancel_event.set()
        if job.kind == "upload" and job.stage == "uploading":
            self._usage(job, "refunded")  # import stopped before its check: nothing was used
        if job.task is not None and not job.task.done():
            try:
                await asyncio.wait_for(asyncio.shield(job.task), timeout=15)
            except (TimeoutError, asyncio.CancelledError):
                job.task.cancel()
        _remove_dir(job.workdir)
        log.info("job deleted", extra={"job_id": job_id})

    async def _run(self, job: Job) -> None:
        started = time.monotonic()

        async def cancelled() -> bool:
            return job.cancel_event.is_set()

        def on_progress(message: dict[str, Any]) -> None:
            job.stage = str(message.get("stage") or job.stage)
            percent = message.get("percent")
            if isinstance(percent, (int, float)):
                job.progress = max(job.progress, min(99.0, float(percent)))
            if "etape" in message:  # clips: the stage of the contract and its measured progress (or None)
                job.etape = str(message["etape"])
                fraction = message.get("progression")
                job.progression = float(fraction) if isinstance(fraction, (int, float)) else None
            if isinstance(message.get("octets"), int):
                job.octets = message["octets"]
            job.touch()

        gate = None
        try:
            async with AsyncExitStack() as slots:
                if job.is_clip:  # clips processed at once (EXTRAIT_SIMULTANES_MAX), before a download slot
                    await slots.enter_async_context(self.runner.clip_slot(cancelled))
                await slots.enter_async_context(
                    self.runner.info_slot(cancelled) if job.kind == "upload" else self.runner.download_slot(cancelled))
                # The slot and the gate below only look at the cancel flag on their own timeouts: a
                # job cancelled while it waited must not start (nor be reported as running).
                if job.cancel_event.is_set():
                    raise Cancelled()
                # An identical request may have finished while this one was queued.
                if self._finish_from_cache(job):
                    return
                if job.kind == "download":
                    # YouTube: breaker re-check + one extraction at a time, taken last so that the
                    # gate (and YT_MIN_INTERVAL_S) wraps the real extraction, not the queue wait.
                    gate = await self.runner.platforms.acquire(job.media.platform, cancelled)
                if job.cancel_event.is_set():
                    raise Cancelled()
                job.status = "running"
                job.stage = "checking" if job.kind == "upload" else "starting"
                job.touch()
                if job.kind != "upload":  # an import reported "running" when it began
                    self._usage(job, "running")
                uses_cookies = job.kind == "download" and self._uses_cookies(job.owner_user_id)
                task = Task(
                    kind=job.kind,
                    url=job.media.url,
                    platform=job.media.platform,
                    workdir=str(job.workdir),
                    params=job.task_params,
                    cookies_file=self.cookies_for(job.media.platform) if uses_cookies else None,
                    job_id=job.id,
                )
                timeout = self.settings.extrait_traitement_max_s if job.is_clip else self.settings.download_timeout_s
                result = await self.runner.run(task, timeout, on_progress, cancelled, gate)
            job.result = result
            job.status, job.stage, job.progress = "done", "done", 100.0
            if self.cache is not None and job.key and result_matches_media(job.media, result):
                self.cache.put(job.key, result)
            done = {**_log_ids(job), "size": result.get("size"), "duration_s": round(time.monotonic() - started, 1)}
            if job.owner_user_id is None:  # user jobs: no media id in the logs (privacy)
                done["media_id"] = result.get("id")
            log.info("job done", extra=done)
        except Cancelled:
            self._fail(job, 499, "cancelled", "Job annulé.")
        except ApiError as exc:
            self._fail(job, exc.status, exc.code, exc.detail)
            retry = exc.headers.get("Retry-After")
            if retry and retry.isdigit():
                job.retry_at = time.time() + int(retry)
            failed: dict[str, Any] = {**_log_ids(job), "error": exc.code}
            cause = error_cause(exc)
            if cause:  # cleaned yt-dlp message (no URL): logs and usage event, never in the job's public view
                failed["cause"] = job.cause = cause
            log.warning("job failed", extra=failed)
        except asyncio.CancelledError:
            self._fail(job, 499, "cancelled", "Job annulé.")
            raise
        except Exception as exc:
            log.exception("job crashed", extra=_log_ids(job))
            self._fail(job, 500, "internal_error", "Erreur interne du serveur (voir les logs).")
            job.cause = type(exc).__name__  # the class only: the message could quote the URL
        finally:
            if gate is not None:
                gate.release()
            if job.reserved:
                self.runner.release()
            job.finished_at = time.time()
            job.touch()
            job.finished.set()
            if job.status == "done":
                self._usage(job, "done", size_bytes=(job.result or {}).get("size"))
                self._cloud(job)
            elif job.error == "cancelled":
                self._usage(job, "refunded" if job.kind == "upload" else "cancelled")
            else:
                self._usage(job, "error", error_code=job.error, cause=job.cause)
            if job.status != "done":
                _remove_dir(job.workdir)

    def _finish_from_cache(self, job: Job) -> bool:
        entry = self.cache.get(job.key) if self.cache is not None and job.key else None
        if entry is None:
            return False
        try:
            job.result = self.cache.materialize(entry, job.workdir)
        except OSError:
            return False
        job.status, job.stage, job.progress, job.cached = "done", "done", 100.0, True
        log.info("job served from cache after queueing", extra={"job_id": job.id})
        return True

    @staticmethod
    def _fail(job: Job, status: int, code: str, detail: str) -> None:
        job.status, job.stage, job.error_status, job.error, job.detail = "error", "error", status, code, detail

    async def cleanup_expired(self) -> int:
        now = time.time()
        expired = [
            job_id
            for job_id, job in self.jobs.items()
            if job.finished_at is not None and now > (job.expires_at(self.ttl_s) or 0)
        ]
        for job_id in expired:
            job = self.jobs.pop(job_id, None)
            if job is not None:
                _remove_dir(job.workdir)
        if expired:
            log.info("expired jobs removed", extra={"count": len(expired)})
        return len(expired)

    async def shutdown(self) -> None:
        for job in list(self.jobs.values()):
            job.cancel_event.set()
            if job.task is not None and not job.task.done():
                job.task.cancel()
        tasks = [j.task for j in self.jobs.values() if j.task is not None]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


def _derive_key(source: Job, dparams: DeriveParams) -> str:
    return "derive|" + source.id + "|" + "|".join(f"{k}={v}" for k, v in sorted(dparams.summary().items()))


def _log_ids(job: Job) -> dict[str, str]:
    """Identifiers of a job in the logs: job_id, plus the usage id of user jobs (account history)."""
    ids = {"job_id": job.id}
    if job.usage_id:
        ids["usage_id"] = job.usage_id
    return ids


def _remove_dir(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)
