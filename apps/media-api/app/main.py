"""FastAPI entry point: routes, auth dependencies, ASGI middlewares, lifespan (cleanup loop)."""

import asyncio
import json
import logging
import os
import secrets
import shutil
import time
from collections.abc import AsyncIterator, Callable
from contextlib import AsyncExitStack, asynccontextmanager
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import quote

import re

import anyio
from fastapi import Body, Depends, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import ValidationError
from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import MalformedRangeHeader, RangeNotSatisfiable

from .cache import ResultCache, cache_key, link_or_copy
from .config import Settings, load_settings
from .cookies import CookieMonitor
from .errors import USER_TEXT, ApiError, error_response, install_handlers, user_text
from .filenames import content_disposition
from .internal import make_router as make_internal_router
from .jobs import Job, JobManager
from .logging_setup import setup_logging
from . import studio
from .params import TOOLS_OPS, DeriveParams, DownloadParams, PreviewParams, UploadParams, clip_max_s, normalize_clip
from .runner import Cancelled, Runner, Task
from .security import Guard, SlidingWindowLimiter, extract_token, rate_limited
from .thumbs import ThumbCache, fetch_image
from .tokens import TokenStore
from .urls import MediaUrl, media_key, result_matches_media, validate_media_url
from .cloud import CloudSync
from .music.routes import make_router as make_music_router
from .music.service import MusicService
from .userkeys import UNLIMITED_DAILY, AccountClient, AccountUnavailable, Principal, UsageEvents
from .versions import collect_versions

log = logging.getLogger("ytapi")

CLEANUP_INTERVAL_S = 60
MAX_BODY_BYTES = 64 * 1024  # POST /jobs bodies are a few hundred bytes
MUSIC_MATCH_BYTES = 2 * 1024 * 1024  # POST /music/correspondances|playlists/synchroniser: a library listing
MAX_WAIT_S = 25  # long-poll cap for GET /jobs/{id}?wait=N and POST /jobs?wait=N
CACHE_DIRNAME = "cache"
PREVIEW_TTL_S = 300  # POST /preview: same media within 5 min -> same answer, no new extraction
PREVIEW_CACHE_MAX = 512
THUMB_REF_TTL_S = 600  # a thumbnail id of POST /preview (Tools) is valid 10 min, for the user who asked
ASSET_TIMEOUT_S = 180


def dl_params(
    url: Annotated[str | None, Query(max_length=2048)] = None,
    fmt: str | None = None,
    quality: str | None = None,
    bitrate: str | None = None,
    gif_width: str | None = None,
    gif_fps: str | None = None,
    transcode: str | None = None,
    index: str | None = None,
    start_s: str | None = None,
    end_s: str | None = None,
    startMs: str | None = None,  # noqa: N803 - name of the contract (CONTRAT-EXTRAITS)
    endMs: str | None = None,  # noqa: N803
) -> DownloadParams:
    raw = {"fmt": fmt, "quality": quality, "bitrate": bitrate, "gif_width": gif_width, "gif_fps": gif_fps,
           "transcode": transcode, "index": index, "start_s": start_s, "end_s": end_s, "startMs": startMs,
           "endMs": endMs}
    # Only pass what the client sent, so model_fields_set tells explicit values from defaults.
    data = {"url": url or ""} | {k: v for k, v in raw.items() if v is not None}
    try:
        return DownloadParams.model_validate(data)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from None


def task_params(params: DownloadParams, media: MediaUrl) -> dict[str, Any]:
    """Worker parameters; an X /video/N suffix selects the media unless index= was given."""
    data = params.model_dump()
    data["index_from_url"] = False
    if "index" not in params.model_fields_set and media.media_index:
        data["index"] = media.media_index
        data["index_from_url"] = True
    return data


def create_app(settings: Settings | None = None, runner: Runner | None = None) -> FastAPI:
    settings = settings or load_settings()
    setup_logging(settings.log_level)
    runner = runner or Runner(settings)
    cookies = CookieMonitor(settings.cookies_file)
    cache = ResultCache(settings.tmp_dir / CACHE_DIRNAME, settings.cache_ttl_min * 60, settings.max_cache_bytes)

    def cookies_for(platform: str) -> str | None:
        return cookies.for_youtube() if platform == "youtube" else None

    # Per-user keys (USER_KEYS_ENABLED, off by default): validated by the internal account service.
    accounts: AccountClient | None = None
    events: UsageEvents | None = None
    if settings.user_keys_enabled:
        assert settings.account_internal_url and settings.account_internal_token_file
        accounts = AccountClient(settings.account_internal_url, settings.account_internal_token_file,
                                 settings.account_timeout_s, settings.user_key_cache_s)
        events = UsageEvents(accounts)
    # AETHRYON Cloud (CLOUD_SYNC, off by default): backup of finished user jobs, decided and verified by account.
    cloud = (CloudSync(accounts, settings.cloud_sync_allow_http, settings.cloud_hold_max_min * 60.0)
             if settings.cloud_sync and accounts is not None else None)
    jobs = JobManager(settings, runner, cache, cookies_for, usage_sink=events.emit if events else None,
                      cloud_sink=cloud.offer if cloud else None)
    # AETHRYON Music (MUSIC_ENABLED, off by default): connectors and legal imports (app/music), same cloud sink.
    music = MusicService(settings, cloud_sink=cloud.offer if cloud else None) if settings.music_enabled else None
    tokens = TokenStore(settings.api_token, settings.tokens_file)
    guard = Guard(tokens, settings.rate_limit, accounts, settings.user_key_prefix)
    # Internal admin API (Control Center, via account): needs the shared internal token of the user keys
    # and the allowed source networks; absent otherwise (404 like any unknown route).
    internal_api = accounts is not None and bool(settings.internal_allow_from)
    active_dirs: set[Path] = set()  # temp dirs of in-flight synchronous requests
    user_locks: dict[str, asyncio.Lock] = {}  # one job creation at a time per user
    previews: dict[str, tuple[float, dict[str, Any]]] = {}  # POST /preview answers (PREVIEW_TTL_S)
    # Previews of a user key: each one is an extraction on the platform, without quota: 30 per 10 min.
    preview_limiter = SlidingWindowLimiter(30, 600)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        settings.tmp_dir.mkdir(parents=True, exist_ok=True)
        if settings.cache_dir:
            settings.cache_dir.mkdir(parents=True, exist_ok=True)
        removed = _remove_orphans(settings.tmp_dir, keep=set())  # includes the old result cache
        app.state.versions = await asyncio.to_thread(collect_versions)
        report = cookies.refresh()
        log.info("startup", extra={"versions": app.state.versions, "orphans_removed": removed,
                                   "max_concurrent": settings.max_concurrent, "token_labels": tokens.labels(),
                                   "cookies": report.state, "youtube_proxy": bool(settings.yt_proxy),
                                   "internal_api": internal_api})
        if not app.state.versions.get("impersonate_targets"):
            log.warning("no impersonation target available (curl_cffi missing?): TikTok will fail")
        if report.state in ("invalid", "unreadable", "expired", "no_youtube"):
            log.warning("cookies file problem", extra={"cookies": report.state, "reason": report.detail})
        if events is not None:
            events.start()
            log.info("user keys enabled", extra={"user_key_prefix": settings.user_key_prefix})
        if cloud is not None:
            cloud.start()
            log.info("cloud sync enabled")
        if music is not None:
            music.imports.start()
            log.info("music enabled", extra={"connecteurs": [c.id for c in music.connectors]})
        if internal_api:
            log.info("internal api enabled", extra={"allow_from": [str(n) for n in settings.internal_allow_from]})
        elif settings.internal_allow_from:
            log.warning("INTERNAL_ALLOW_FROM ignored: the internal api needs USER_KEYS_ENABLED=true")
        cleaner = asyncio.create_task(_cleanup_loop(), name="cleanup")
        try:
            yield
        finally:
            cleaner.cancel()
            await jobs.shutdown()
            if music is not None:
                await music.imports.shutdown()
            runner.kill_all()
            if cloud is not None:
                await cloud.stop()
            if events is not None:
                await events.stop()

    async def _cleanup_loop() -> None:
        while True:
            await asyncio.sleep(CLEANUP_INTERVAL_S)
            try:
                await jobs.cleanup_expired()
                if settings.tools_enabled:
                    await jobs.expire_stalled_uploads()
                    for tid in [t for t, (_, _, at) in thumb_refs.items() if time.time() - at > THUMB_REF_TTL_S]:
                        thumb_refs.pop(tid, None)
                cache.prune()
                guard.prune()
                preview_limiter.prune()
                for key in [k for k, (at, _) in previews.items() if time.time() - at > PREVIEW_TTL_S]:
                    previews.pop(key, None)
                for user_id, lock in list(user_locks.items()):
                    if not lock.locked():
                        del user_locks[user_id]
                if music is not None:
                    await music.imports.cleanup()
                    music.cache.prune()
                keep = {job.workdir for job in jobs.jobs.values()} | active_dirs | {cache.root}
                if music is not None:
                    keep.add(music.imports.root)  # its own files are removed by music.imports.cleanup()
                # Leftovers older than the TTL (e.g. after a crash of a request handler).
                _remove_orphans(settings.tmp_dir, keep=keep, older_than_s=jobs.ttl_s)
            except Exception:  # never let the janitor die
                log.exception("cleanup failed")

    app = FastAPI(
        title="ytapi",
        version="2.0.0",
        lifespan=lifespan,
        # No root_path here: behind Traefik StripPrefix(/media) the prefix is set with
        # `uvicorn --root-path /media` (entrypoint.sh), which also keeps request.url and
        # slash redirects correct. FastAPI(root_path=...) would only fix url_for().
        # DEBUG=true serves these without a token (schema only, no data): never in production.
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
        openapi_url="/openapi.json" if settings.debug else None,
    )
    app.state.settings, app.state.runner, app.state.jobs, app.state.guard = settings, runner, jobs, guard
    app.state.cache, app.state.cookies, app.state.tokens = cache, cookies, tokens
    app.state.versions = {}
    install_handlers(app)
    # Pure ASGI middlewares (not @app.middleware): BaseHTTPMiddleware would hide client
    # disconnects from request.is_disconnected(), so abandoned downloads would keep running.
    # Chunks of an import (AETHRYON Tools) are the only bodies larger than MAX_BODY_BYTES: up to UPLOAD_CHUNK_MB.
    chunk_limit = settings.upload_chunk_bytes if settings.tools_enabled else 0
    music_limit = MUSIC_MATCH_BYTES if settings.music_enabled else 0
    app.add_middleware(BodyLimit, max_bytes=MAX_BODY_BYTES, chunk_bytes=chunk_limit, music_bytes=music_limit)
    app.add_middleware(AccessLog, max_bytes=MAX_BODY_BYTES, chunk_bytes=chunk_limit, music_bytes=music_limit)

    async def heavy_auth(request: Request) -> None:
        await guard.check(request, heavy=True)

    async def light_auth(request: Request) -> None:
        await guard.check(request, heavy=False)

    def _refuse_user_keys(request: Request) -> None:
        principal: Principal = request.state.principal
        if principal.is_user:
            raise ApiError(403, "forbidden_for_user_keys",
                           "Cette route est réservée à l'administrateur ; un jeton personnel permet "
                           "seulement de créer et de suivre ses conversions (/jobs).")

    async def admin_heavy_auth(request: Request) -> None:
        await guard.check(request, heavy=True)
        _refuse_user_keys(request)

    async def admin_light_auth(request: Request) -> None:
        await guard.check(request, heavy=False)
        _refuse_user_keys(request)

    def principal_of(request: Request) -> Principal:
        return request.state.principal

    async def create_user_job(request: Request, principal: Principal, params: DownloadParams, media: MediaUrl,
                              tparams: dict[str, Any], key: str) -> tuple[Job, bool]:
        """Job creation for a user key: own active job joined for free, one active job, then quota."""
        assert accounts is not None and principal.user_id is not None
        lock = user_locks.setdefault(principal.user_id, asyncio.Lock())
        async with lock:
            merge_key = jobs.user_merge_key(key, principal.user_id)
            active = jobs.active_for_user(principal.user_id)
            same = next((job for job in active if job.merge_key == merge_key), None)
            if same is not None:
                # Relaunch of the same conversion while it runs: join it, no quota consumed.
                return jobs.create(params, media, tparams, key, owner=principal)
            if len(active) >= max(1, principal.max_active):
                raise ApiError(429, "active_job_limit",
                               "Une conversion est déjà en cours pour ton compte : attends qu'elle se termine.",
                               {"Retry-After": "15"})
            # A GIF clip counts as a video conversion (account knows the units "mp4" and "mp3" only).
            quota_fmt = "mp4" if params.fmt == "gif" and params.clip else params.fmt
            usage_id = await consume_unit(request, quota_fmt, media.platform)
            try:
                return jobs.create(params, media, tparams, key, owner=principal, usage_id=usage_id)
            except BaseException:
                # The job never existed (queue full, YouTube pause, broken cookies...): give the unit back.
                if events is not None and usage_id:
                    events.emit(str(usage_id), "refunded")
                raise

    async def consume_unit(request: Request, fmt: str, platform: str) -> str | None:
        """One unit of the user's quota (account, atomic): returns the usage id, or raises the refusal."""
        assert accounts is not None
        token = extract_token(request) or ""
        try:
            decision = await accounts.authorize(token, "create_job", fmt=fmt, platform=platform)
        except AccountUnavailable:
            raise ApiError(503, "auth_unavailable",
                           "Vérification du jeton momentanément impossible. Réessaie dans quelques secondes.",
                           {"Retry-After": "10"}) from None
        if not decision.get("allow"):
            reason = decision.get("reason")
            message = str(decision.get("message") or "Conversion refusée.")
            retry = decision.get("retry_after_s")
            retry_headers = {"Retry-After": str(int(retry))} if isinstance(retry, int) and retry > 0 else {}
            if reason == "quota_exceeded":
                raise ApiError(429, "quota_exceeded", message, retry_headers)
            if reason == "paused":
                raise ApiError(503, "service_paused", message, retry_headers or {"Retry-After": "300"})
            if reason == "format_not_allowed":
                raise ApiError(400, "invalid_parameter", message)
            if reason == "user_suspended":
                raise ApiError(403, "account_suspended", message)
            if reason == "platform_disabled":
                # Platform switched off in the Control Center: the key is fine, the service is not.
                raise ApiError(503, "platform_disabled", message, retry_headers)
            accounts.forget(token)
            raise ApiError(401, "unauthorized", message, {"WWW-Authenticate": "Bearer"})
        usage_id = decision.get("usage_id")
        return str(usage_id) if usage_id else None

    def prepare(params: DownloadParams) -> tuple[DownloadParams, MediaUrl, dict[str, Any], str]:
        """Validate the URL and the clip bounds (startMs/endMs become start_s/end_s); compute worker params and the
        cache/merge key.

        The YouTube pause and the cookies are only checked when a new download is needed:
        cached results and running jobs stay available while YouTube is paused."""
        if params.wants_clip and not settings.media_tools_enabled:
            raise ApiError(400, "invalid_parameter", "Paramètre invalide — start_s/end_s : les extraits ne sont pas "
                                                     "activés sur ce serveur (MEDIA_TOOLS_ENABLED).")
        params = normalize_clip(params, settings.extrait_duree_max_s, settings.gif_max_duration_s)
        media = validate_media_url(params.url, settings.allowed_domains)
        tparams = task_params(params, media)
        return params, media, tparams, cache_key(media_key(media), tparams)

    def serve_cached(key: str, serve: Callable[[dict[str, Any], Path, str], FileResponse]) -> FileResponse | None:
        entry = cache.get(key)
        if entry is None:
            return None
        hit_dir = _new_workdir(settings.tmp_dir, "dl")
        active_dirs.add(hit_dir)
        try:
            return serve(cache.materialize(entry, hit_dir), hit_dir, "hit")
        except OSError:
            _cleanup_dir(hit_dir, active_dirs)  # evicted meanwhile: download again
            return None
        except BaseException:
            _cleanup_dir(hit_dir, active_dirs)
            raise

    # --- routes ---------------------------------------------------------------------------

    @app.get("/health")
    async def health() -> dict[str, Any]:
        """Public and minimal: liveness + yt-dlp/ffmpeg versions. Diagnostics live in /status."""
        versions = app.state.versions
        return {"status": "ok", "versions": {"yt_dlp": versions.get("yt_dlp"), "ffmpeg": versions.get("ffmpeg")}}

    def status_body(with_tokens: bool) -> dict[str, Any]:
        body: dict[str, Any] = {
            "status": "ok",
            "platforms": runner.platforms.public(),
            "youtube_cooldown_min": settings.yt_cooldown_min,
            "youtube_cooldown_max_min": settings.yt_cooldown_max_min,
            "youtube_proxy": bool(settings.yt_proxy),
            "cookies": cookies.refresh().public(),
            "queue": {"pending": runner.pending, "running": runner.running,
                      "capacity": settings.max_concurrent + settings.max_queue, "jobs": jobs.counts()},
            "disk": runner.disk_status(),
            "cache": cache.stats(),
            "tokens": {"labels": tokens.labels(), "file": tokens.file_state},
            "versions": app.state.versions,
        }
        if not with_tokens:  # internal API: no token label leaves ytapi
            del body["tokens"]
            if events is not None:
                body["usage_events"] = {"sent": events.sent, "dropped": events.dropped,
                                        "pending": events.queue.qsize()}
        return body

    @app.get("/status", dependencies=[Depends(admin_light_auth)])
    async def status() -> dict[str, Any]:
        return status_body(with_tokens=True)

    @app.get("/info", dependencies=[Depends(admin_heavy_auth)])
    async def info(request: Request, url: Annotated[str | None, Query(max_length=2048)] = None) -> dict[str, Any]:
        media = validate_media_url(url, settings.allowed_domains)
        runner.platforms.check_available(media.platform)
        cookies_file = cookies_for(media.platform)
        workdir = _new_workdir(settings.tmp_dir, "info")
        active_dirs.add(workdir)
        gate = None
        try:
            async with runner.info_slot(request.is_disconnected):
                gate = await runner.platforms.acquire(media.platform, request.is_disconnected)
                task = Task(kind="info", url=media.url, platform=media.platform, workdir=str(workdir),
                            cookies_file=cookies_file)
                return await runner.run(task, settings.info_timeout_s, cancel_check=request.is_disconnected, gate=gate)
        except Cancelled:
            raise ApiError(499, "client_closed", "Client déconnecté.") from None
        finally:
            if gate is not None:
                gate.release()
            _cleanup_dir(workdir, active_dirs)

    @app.get("/dl", dependencies=[Depends(admin_heavy_auth)])
    async def download(request: Request, params: Annotated[DownloadParams, Depends(dl_params)]) -> FileResponse:
        params, media, tparams, key = prepare(params)

        def serve(result: dict[str, Any], workdir: Path, cache_state: str) -> FileResponse:
            return MediaFileResponse(
                result["filepath"],
                media_type=result["media_type"],
                headers={"Content-Disposition": content_disposition(result["download_name"]), "X-Cache": cache_state},
                cleanup=lambda: _cleanup_dir(workdir, active_dirs),
            )

        # 1. Same file produced recently: serve it again without downloading.
        cached = serve_cached(key, serve)
        if cached is not None:
            return cached
        # 2. Same file being produced by a job: wait for it instead of downloading twice.
        running = jobs.find_active(key)
        if running is not None:
            return await _serve_job(request, running, serve)

        # 3. Download now (fail fast while YouTube is paused or the cookies file is broken).
        runner.platforms.check_available(media.platform)
        cookies_file = cookies_for(media.platform)
        runner.reserve()
        workdir: Path | None = None
        handed_over = False
        gate = None
        try:
            async with AsyncExitStack() as slots:
                if params.clip:  # clips processed at once (EXTRAIT_SIMULTANES_MAX), before a download slot
                    await slots.enter_async_context(runner.clip_slot(request.is_disconnected))
                await slots.enter_async_context(runner.download_slot(request.is_disconnected))
                # An identical request may have filled the cache while this one was queued.
                cached = serve_cached(key, serve)
                if cached is not None:
                    return cached
                workdir = _new_workdir(settings.tmp_dir, "dl")
                active_dirs.add(workdir)
                # YouTube gate taken last: it (and YT_MIN_INTERVAL_S) wraps the real extraction.
                gate = await runner.platforms.acquire(media.platform, request.is_disconnected)
                task = Task(kind="download", url=media.url, platform=media.platform, workdir=str(workdir),
                            params=tparams, cookies_file=cookies_file)
                timeout = settings.extrait_traitement_max_s if params.clip else settings.download_timeout_s
                result = await runner.run(task, timeout, cancel_check=request.is_disconnected, gate=gate)
            if result_matches_media(media, result):
                cache.put(key, result)
            log.info("download done", extra={"platform": media.platform, "media_id": result.get("id"),
                                             "size": result.get("size"), **params.summary()})
            response = serve(result, workdir, "miss")
            handed_over = True
            return response
        except Cancelled:
            raise ApiError(499, "client_closed", "Client déconnecté.") from None
        finally:
            if gate is not None:
                gate.release()
            runner.release()
            if workdir is not None and not handed_over:
                _cleanup_dir(workdir, active_dirs)

    async def _serve_job(request: Request, job: Job,
                         serve: Callable[[dict[str, Any], Path, str], FileResponse]) -> FileResponse:
        # Subscribed while waiting: a DELETE from the job's creator then leaves the job running.
        jobs.subscribe(job)
        try:
            await jobs.wait(job, float(settings.download_timeout_s), request.is_disconnected)
            if not job.finished.is_set():
                if await request.is_disconnected():
                    raise ApiError(499, "client_closed", "Client déconnecté.")
                raise ApiError(504, "timeout", f"Traitement interrompu après {settings.download_timeout_s} s "
                                               "(limite atteinte).")
            if job.status != "done" or not job.result:
                raise ApiError(job.error_status or 502, job.error or "upstream_error", job.detail or "Échec du job.",
                               job.error_headers())
            workdir = _new_workdir(settings.tmp_dir, "dl")
            active_dirs.add(workdir)
            try:
                linked = link_or_copy(Path(job.result["filepath"]), workdir)
                return serve(dict(job.result, filepath=str(linked)), workdir, "merged")
            except BaseException:
                _cleanup_dir(workdir, active_dirs)
                raise
        finally:
            await jobs.unsubscribe(job)

    @app.post("/jobs", status_code=202, dependencies=[Depends(heavy_auth)])
    async def create_job(
        request: Request,
        params: Annotated[DownloadParams, Body()],
        wait: Annotated[int, Query(ge=0, le=MAX_WAIT_S)] = 0,
    ) -> JSONResponse:
        """Create (or join) a job. ?wait=N (<= 25 s): answer 200 with file_url if it finishes in time."""
        params, media, tparams, key = prepare(params)
        principal = principal_of(request)
        if principal.is_user:
            job, merged = await create_user_job(request, principal, params, media, tparams, key)
        else:
            job, merged = jobs.create(params, media, tparams, key)
        if wait and not job.finished.is_set():
            await jobs.wait(job, float(wait), request.is_disconnected)
        body = _user_view(request, _job_body(request, job.public(jobs.ttl_s)))
        body["merged"] = merged
        if job.status == "done":
            code = 200
        elif job.status == "error":
            code = job.error_status if job.error_status and job.error_status >= 400 else 502
        else:
            code = 202
        return JSONResponse(body, status_code=code, headers={"Location": body["status_url"], **job.error_headers()})

    @app.get("/limites", dependencies=[Depends(light_auth)])
    async def limites(request: Request) -> dict[str, Any]:
        """Limits of the clips, as configured on this server (CONTRAT-EXTRAITS): clients show them, never their own
        fixed values. Quotas: those of the caller's account (user key), none for an admin token."""
        principal = principal_of(request)
        per_format = {fmt: clip_max_s(fmt, settings.extrait_duree_max_s, settings.gif_max_duration_s) * 1000
                      for fmt in ("mp4", "mp3", "gif")}
        daily = principal.daily_limit if principal.is_user else None
        return {
            "extraitsActifs": settings.media_tools_enabled,
            "formats": ["mp4", "mp3", "gif"],
            "extraitDureeMaxMs": settings.extrait_duree_max_s * 1000,
            "dureeMaxParFormatMs": per_format,
            "gifDureeMaxMs": per_format["gif"],
            "sortieTailleMaxOctets": settings.extrait_sortie_max_bytes,
            "telechargementMaxOctets": settings.extrait_telechargement_max_bytes,
            "traitementMaxS": settings.extrait_traitement_max_s,
            "simultanesMax": settings.extrait_simultanes_max,
            "quotaJour": daily if daily is not None and daily < UNLIMITED_DAILY else None,
            "restantAujourdhui": principal.remaining_today if principal.is_user and daily is not None
            and daily < UNLIMITED_DAILY else None,
            "actifsMaxParCompte": principal.max_active if principal.is_user else None,
        }

    @app.get("/jobs/{job_id}", name="job_status", dependencies=[Depends(light_auth)])
    async def job_status(
        request: Request, job_id: str, wait: Annotated[int, Query(ge=0, le=MAX_WAIT_S)] = 0, change: bool = False
    ) -> dict[str, Any]:
        """Job status. ?wait=N (<= 25 s) holds the answer until the job finishes (long polling); with &change=true
        it also answers when the progress moves (at most every 2 s): live progress bars without busy polling."""
        job = jobs.get(job_id, principal_of(request))
        if wait and not job.finished.is_set():
            await jobs.wait(job, float(wait), request.is_disconnected, on_change=change)
        return _user_view(request, _job_body(request, job.public(jobs.ttl_s)))

    # The optional trailing file name only exists so that clients which name downloads after
    # the last URL segment (instead of Content-Disposition) still get "Title [id].ext".
    @app.get("/jobs/{job_id}/file", name="job_file", dependencies=[Depends(light_auth)])
    @app.get("/jobs/{job_id}/file/{filename}", name="job_file_named", dependencies=[Depends(light_auth)])
    async def job_file(request: Request, job_id: str, filename: str | None = None) -> FileResponse:
        job = jobs.get(job_id, principal_of(request))
        if job.status == "error":
            code = job.error or "upstream_error"
            if principal_of(request).is_user and code in USER_TEXT:
                raise ApiError(409, "job_failed", user_text(code))
            raise ApiError(409, "job_failed", f"Le job a échoué : {job.error} — {job.detail}")
        if job.status != "done" or not job.result:
            raise ApiError(409, "job_not_ready",
                           f"Job encore {job.status} ({job.progress:.0f} %), interrogez /jobs/{job_id}.")
        path = Path(job.result["filepath"])
        if not path.is_file():
            raise ApiError(410, "file_gone", "Le fichier a expiré ou a été supprimé : relancez le job.")
        headers = {"Content-Disposition": content_disposition(job.result["download_name"])}
        if not principal_of(request).is_user:  # users do not learn that someone else fetched it
            headers["X-Cache"] = "hit" if job.cached else "miss"
        return MediaFileResponse(path, media_type=job.result["media_type"], headers=headers)

    @app.delete("/jobs/{job_id}", dependencies=[Depends(light_auth)])
    async def delete_job(request: Request, job_id: str, with_exports: bool = False) -> dict[str, Any]:
        removed = await jobs.delete(job_id, principal_of(request), with_exports=with_exports)
        return {"job_id": job_id, "deleted": True, **({"exports_deleted": removed} if with_exports else {})}

    if settings.media_tools_enabled:
        @app.post("/preview", dependencies=[Depends(heavy_auth)])
        async def preview(request: Request, body: Annotated[PreviewParams, Body()]) -> dict[str, Any]:
            """What a link holds before converting it (title, author, duration, qualities, estimated sizes):
            one extraction, no download, no quota unit. The link travels in the body (never in an access log).
            User keys: no owner cookies (unless USER_JOBS_USE_COOKIES), 30 extractions per 10 min, and only
            the fields of preview_view (no stream URL, no media id)."""
            principal = principal_of(request)
            media = validate_media_url(body.url, settings.allowed_domains)
            use_cookies = not principal.is_user or settings.user_jobs_use_cookies
            key = ("c|" if use_cookies else "n|") + media_key(media)
            hit = previews.get(key)
            if hit is not None and time.time() - hit[0] <= PREVIEW_TTL_S:
                return with_thumb_ids(dict(hit[1]), principal)
            if principal.is_user:
                wait = preview_limiter.hit(f"user:{principal.user_id}")
                if wait is not None:
                    raise rate_limited(wait)
            runner.platforms.check_available(media.platform)
            cookies_file = cookies_for(media.platform) if use_cookies else None
            workdir = _new_workdir(settings.tmp_dir, "info")
            active_dirs.add(workdir)
            gate = None
            try:
                async with runner.info_slot(request.is_disconnected):
                    gate = await runner.platforms.acquire(media.platform, request.is_disconnected)
                    task = Task(kind="info", url=media.url, platform=media.platform, workdir=str(workdir),
                                cookies_file=cookies_file)
                    info = await runner.run(task, settings.info_timeout_s, cancel_check=request.is_disconnected,
                                            gate=gate)
            except Cancelled:
                raise ApiError(499, "client_closed", "Client déconnecté.") from None
            finally:
                if gate is not None:
                    gate.release()
                _cleanup_dir(workdir, active_dirs)
            view = preview_view(info, media.platform)
            if len(previews) >= PREVIEW_CACHE_MAX:
                previews.pop(min(previews, key=lambda k: previews[k][0]), None)
            previews[key] = (time.time(), view)
            return with_thumb_ids(dict(view), principal)

        @app.post("/jobs/{job_id}/derive", status_code=202, dependencies=[Depends(heavy_auth)])
        async def derive_job(
            request: Request,
            job_id: str,
            dparams: Annotated[DeriveParams, Body()],
            wait: Annotated[int, Query(ge=0, le=MAX_WAIT_S)] = 0,
        ) -> JSONResponse:
            """New file from a finished .mp4 job of the caller: compression under max_bytes, or GIF of a
            passage. No download, no quota unit (the source conversion counted), owner only, at most
            MAX_DERIVED_PER_SOURCE per source; the same request again joins the same job (idempotent)."""
            principal = principal_of(request)
            source = jobs.get(job_id, principal)
            # A file imported in the Tools always goes through the Tools pipeline (input whitelists), whatever the op.
            tools = dparams.op in TOOLS_OPS or dparams.uses_tools_fields() or source.from_upload
            if tools and not settings.tools_enabled:
                raise ApiError(400, "invalid_parameter", "Paramètre invalide — op : les retouches d'AETHRYON Tools ne "
                                                         "sont pas activées sur ce serveur (TOOLS_ENABLED).")
            if not tools and (source.kind != "download" or source.params.fmt != "mp4"):
                raise ApiError(400, "invalid_parameter", "Seule une conversion MP4 terminée peut être compressée "
                                                         "ou transformée en GIF.")
            if tools and (source.kind not in ("download", "upload")
                          or (source.kind == "download" and source.params.fmt not in ("mp4", "mp3"))):
                raise ApiError(400, "invalid_parameter", "Seule une conversion MP4 ou MP3, ou un fichier importé, se "
                                                         "retouche.")
            if source.status == "error":
                raise ApiError(409, "job_failed", "Cette conversion a échoué : rien à compresser.")
            if source.status != "done" or not source.result:
                raise ApiError(409, "job_not_ready", f"Job encore {source.status} ({source.progress:.0f} %), "
                                                     f"interrogez /jobs/{job_id}.")
            if not Path(source.result["filepath"]).is_file():
                raise ApiError(410, "file_gone", "Le fichier a expiré ou a été supprimé : relancez le job.")
            if dparams.op == "gif" and dparams.gif_duration_s / dparams.speed > settings.gif_max_duration_s:
                raise ApiError(400, "invalid_parameter",
                               f"Paramètre invalide — duration_s : un GIF dure au plus {settings.gif_max_duration_s} s.")
            if principal.is_user:
                assert principal.user_id is not None
                async with user_locks.setdefault(principal.user_id, asyncio.Lock()):
                    if jobs.find_derived(source, dparams) is None and \
                            len(jobs.active_for_user(principal.user_id)) >= max(1, principal.max_active):
                        raise ApiError(429, "active_job_limit",
                                       "Une conversion est déjà en cours pour ton compte : attends qu'elle se termine.",
                                       {"Retry-After": "15"})
                    job, merged = jobs.derive(source, dparams)
            else:
                job, merged = jobs.derive(source, dparams)
            if wait and not job.finished.is_set():
                await jobs.wait(job, float(wait), request.is_disconnected)
            body = _user_view(request, _job_body(request, job.public(jobs.ttl_s)))
            body["merged"] = merged
            if job.status == "done":
                code = 200
            elif job.status == "error":
                code = job.error_status if job.error_status and job.error_status >= 400 else 502
            else:
                code = 202
            return JSONResponse(body, status_code=code, headers={"Location": body["status_url"], **job.error_headers()})

    # --- AETHRYON Tools (TOOLS_ENABLED): imports, file list, retention, storyboard, waveform, thumbnails ----------

    thumb_cache = ThumbCache()
    thumb_refs: dict[str, tuple[str, str, float]] = {}  # id -> (user id, thumbnail address, created)
    asset_locks: dict[str, asyncio.Lock] = {}
    app.state.thumb_refs = thumb_refs

    def with_thumb_ids(view: dict[str, Any], principal: Principal) -> dict[str, Any]:
        """Tools: an opaque id per thumbnail, valid 10 min for this user (GET /preview/thumbnail/{id}). The platform
        address stays in the answer for the Discord bot (Discord fetches it itself)."""
        if not settings.tools_enabled or not principal.is_user or principal.user_id is None:
            return view

        def ref(url: Any) -> str | None:
            if not isinstance(url, str) or not url.startswith("https://"):
                return None
            tid = secrets.token_urlsafe(16)
            thumb_refs[tid] = (principal.user_id, url, time.time())  # type: ignore[assignment]
            while len(thumb_refs) > 2048:
                thumb_refs.pop(next(iter(thumb_refs)))
            return tid

        view["thumbnail_id"] = ref(view.get("thumbnail"))
        if isinstance(view.get("entries"), list):
            view["entries"] = [dict(e, thumbnail_id=ref(e.get("thumbnail"))) for e in view["entries"]]
        return view

    def owned_done(request: Request, job_id: str) -> Job:
        job = jobs.get(job_id, principal_of(request))
        if job.status == "error":
            raise ApiError(409, "job_failed", "Ce traitement a échoué.")
        if job.status != "done" or not job.result:
            raise ApiError(409, "job_not_ready", f"Job encore {job.status} ({job.progress:.0f} %).")
        if not Path(job.result["filepath"]).is_file():
            raise ApiError(410, "file_gone", "Le fichier a expiré ou a été supprimé.")
        return job

    def user_only(request: Request) -> Principal:
        principal = principal_of(request)
        if not principal.is_user or principal.user_id is None:
            raise ApiError(403, "forbidden_for_admin_tokens", "Route réservée aux comptes (jeton personnel).")
        return principal

    async def asset(request: Request, job: Job, what: str) -> dict[str, Any]:
        """Storyboard or waveform of a finished file, made once (worker process, info slot) then read from disk."""
        out_dir = job.workdir / "assets"
        made = out_dir / f"{what}.json"
        if made.is_file():
            return json.loads(made.read_text(encoding="utf-8"))
        lock = asset_locks.setdefault(f"{job.id}:{what}", asyncio.Lock())
        async with lock:
            if made.is_file():
                return json.loads(made.read_text(encoding="utf-8"))
            out_dir.mkdir(exist_ok=True)
            assert job.result is not None
            async with runner.info_slot(request.is_disconnected):
                task = Task(kind="assets", url=job.media.url, platform=job.media.platform, workdir=str(job.workdir),
                            params={"asset": what, "source": job.result["filepath"], "from_upload": job.from_upload,
                                    "out_dir": str(out_dir)}, job_id=job.id)
                try:
                    data = await runner.run(task, ASSET_TIMEOUT_S, cancel_check=request.is_disconnected)
                except Cancelled:
                    raise ApiError(499, "client_closed", "Client déconnecté.") from None
        asset_locks.pop(f"{job.id}:{what}", None)
        return data

    if settings.tools_enabled:
        @app.post("/uploads", status_code=201, dependencies=[Depends(heavy_auth)])
        async def create_upload(request: Request, body: Annotated[UploadParams, Body()]) -> JSONResponse:
            """Announce an import (owner = the account of the key): one unit of the quota, given back if the import
            is abandoned or refused. Then PUT /uploads/{id}/chunks/{n} for each chunk, then POST …/complete."""
            principal = user_only(request)
            assert principal.user_id is not None
            if body.size > settings.max_upload_bytes:
                raise ApiError(413, "too_large", f"Fichier plus gros que la limite de {settings.max_upload_mb} Mio.")
            lock = user_locks.setdefault(principal.user_id, asyncio.Lock())
            async with lock:
                if jobs.pending_upload(principal.user_id) is not None:
                    raise ApiError(409, "upload_pending", "Un import est déjà en cours : reprends-le ou annule-le avant "
                                                          "d'en commencer un autre.")
                usage_id = await consume_unit(request, "mp3" if body.is_audio else "mp4", "fichier")
                try:
                    job = jobs.create_upload(principal.user_id, usage_id, studio.clean_upload_name(body.name),
                                             body.size, body.is_audio)
                except BaseException:
                    if events is not None and usage_id:
                        events.emit(usage_id, "refunded")
                    raise
            view = _user_view(request, _job_body(request, job.public(jobs.ttl_s)))
            return JSONResponse(view, status_code=201, headers={"Location": view["status_url"]})

        @app.put("/uploads/{job_id}/chunks/{index}", dependencies=[Depends(light_auth)])
        async def upload_chunk(request: Request, job_id: str, index: int) -> dict[str, Any]:
            """One chunk, written at its place (re-sending a chunk is harmless): exactly the expected length."""
            job = jobs.get(job_id, user_only(request))
            offset, length = jobs.chunk_span(job, index)
            declared = request.headers.get("content-length", "")
            if not declared.isdigit() or int(declared) != length:
                raise ApiError(400, "invalid_chunk", f"Morceau {index} : {length} octets attendus.")
            data = bytearray()
            async for part in request.stream():
                data += part
                if len(data) > length:
                    raise ApiError(400, "invalid_chunk", f"Morceau {index} : {length} octets attendus.")
            if len(data) != length:
                raise ApiError(400, "invalid_chunk", f"Morceau {index} incomplet.")
            target = job.workdir / "source.bin"
            try:
                await anyio.to_thread.run_sync(_write_at, target, offset, bytes(data))
            except FileNotFoundError:
                raise ApiError(410, "upload_closed", "Cet import a été annulé ou a expiré.") from None
            if jobs.jobs.get(job.id) is job:
                jobs.chunk_written(job, index)
            assert job.upload is not None
            return {"job_id": job.id, "index": index, "received": len(job.upload["received"]),
                    "chunks": job.upload["chunks"], "progress": round(job.progress, 1)}

        @app.post("/uploads/{job_id}/complete", status_code=202, dependencies=[Depends(light_auth)])
        async def complete_upload(request: Request, job_id: str,
                                  wait: Annotated[int, Query(ge=0, le=MAX_WAIT_S)] = 0) -> JSONResponse:
            principal = user_only(request)
            assert principal.user_id is not None
            job = jobs.get(job_id, principal)
            async with user_locks.setdefault(principal.user_id, asyncio.Lock()):
                # The check of the file is the work of the import: it counts as the user's job in progress.
                if job.stage == "uploading" and \
                        len(jobs.active_for_user(principal.user_id)) >= max(1, principal.max_active):
                    raise ApiError(429, "active_job_limit",
                                   "Un traitement est déjà en cours pour ton compte : attends qu'il se termine.",
                                   {"Retry-After": "15"})
                jobs.complete_upload(job)
            if wait and not job.finished.is_set():
                await jobs.wait(job, float(wait), request.is_disconnected)
            body = _user_view(request, _job_body(request, job.public(jobs.ttl_s)))
            code = 200 if job.status == "done" else (job.error_status or 502) if job.status == "error" else 202
            return JSONResponse(body, status_code=code if code >= 200 else 502)

        @app.get("/jobs", dependencies=[Depends(light_auth)])
        async def list_jobs(request: Request) -> dict[str, Any]:
            """The caller's files still on the server (imports, conversions, exports), newest first."""
            principal = user_only(request)
            assert principal.user_id is not None
            items = [_user_view(request, _job_body(request, job.public(jobs.ttl_s)))
                     for job in jobs.list_for_user(principal.user_id)]
            return {"jobs": items, "ttl_min": settings.job_ttl_min, "keep_min": settings.tools_keep_min,
                    "keep_max_min": settings.tools_keep_max_min, "max_upload_mb": settings.max_upload_mb,
                    "chunk_mb": settings.upload_chunk_mb, "max_duration_s": settings.max_duration_s,
                    "video_max_s": settings.transcode_max_duration_s, "gif_max_s": settings.gif_max_duration_s}

        @app.post("/jobs/{job_id}/keep", dependencies=[Depends(light_auth)])
        async def keep_job(request: Request, job_id: str) -> dict[str, Any]:
            job = owned_done(request, job_id)
            until = jobs.keep(job)
            return {"job_id": job.id, "expires_at": _iso_ts(until)}

        @app.get("/jobs/{job_id}/media", dependencies=[Depends(light_auth)])
        async def job_media(request: Request, job_id: str) -> dict[str, Any]:
            """Duration, displayed size, codecs, sound, playability of a finished file (probed once)."""
            job = owned_done(request, job_id)
            assert job.result is not None
            if not job.result.get("media"):
                path = Path(job.result["filepath"])
                meta = await anyio.to_thread.run_sync(studio.probe_media, path, job.from_upload)
                job.result["media"] = studio.media_info(meta, path.stat().st_size)
            return dict(job.result["media"])

        @app.get("/jobs/{job_id}/storyboard", dependencies=[Depends(light_auth)])
        async def job_storyboard(request: Request, job_id: str) -> dict[str, Any]:
            job = owned_done(request, job_id)
            data = await asset(request, job, "storyboard")
            if data.get("count"):
                data["image_url"] = str(request.url_for("job_storyboard_image", job_id=job.id))
            return data

        @app.get("/jobs/{job_id}/storyboard.jpg", name="job_storyboard_image", dependencies=[Depends(light_auth)])
        async def job_storyboard_image(request: Request, job_id: str) -> FileResponse:
            job = owned_done(request, job_id)
            path = job.workdir / "assets" / "storyboard.jpg"
            if not path.is_file():
                raise ApiError(404, "not_ready", "Planche pas encore préparée : GET /jobs/{id}/storyboard d'abord.")
            return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})

        @app.get("/jobs/{job_id}/waveform", dependencies=[Depends(light_auth)])
        async def job_waveform(request: Request, job_id: str) -> dict[str, Any]:
            return await asset(request, owned_done(request, job_id), "waveform")

        @app.get("/preview/thumbnail/{tid}", dependencies=[Depends(light_auth)])
        async def preview_thumbnail(request: Request, tid: str) -> Response:
            principal = user_only(request)
            ref = thumb_refs.get(tid)
            if ref is None or ref[0] != principal.user_id or time.time() - ref[2] > THUMB_REF_TTL_S:
                raise ApiError(404, "thumbnail_unavailable", "Vignette indisponible.")
            hit = thumb_cache.get(ref[1])
            if hit is None:
                hit = await anyio.to_thread.run_sync(fetch_image, ref[1])
                thumb_cache.put(ref[1], *hit)
            return Response(hit[0], media_type=hit[1], headers={"Cache-Control": "private, max-age=600"})

    if music is not None:
        app.state.music = music
        app.include_router(make_music_router(music, light_auth, heavy_auth))

    if internal_api:
        assert accounts is not None
        app.include_router(make_internal_router(settings.internal_allow_from, accounts, jobs,
                                                lambda: status_body(with_tokens=False)))

    return app


class MediaFileResponse(FileResponse):
    """FileResponse with JSON range errors and an optional guaranteed cleanup.

    Starlette answers a bad Range header with text/plain 400/416; clients of this API always get
    {"error", "detail"}. The cleanup (temp dir of a /dl request) runs in try/finally, which a
    BackgroundTask does not guarantee (early returns, exceptions).
    """

    def __init__(self, *args: Any, cleanup: Callable[[], None] | None = None, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._cleanup = cleanup

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        try:
            error = self._range_error(scope)
            if error is not None:
                await error(scope, receive, send)
                return
            await super().__call__(scope, receive, send)
        finally:
            if self._cleanup is not None:
                await anyio.to_thread.run_sync(self._cleanup)

    def _range_error(self, scope: Any) -> JSONResponse | None:
        headers = Headers(scope=scope)
        http_range = headers.get("range")
        if http_range is None or self.status_code != 200:
            return None
        try:
            stat_result = os.stat(self.path)
        except OSError:
            return None
        size = stat_result.st_size
        if_range = headers.get("if-range")
        if if_range is not None:
            # Starlette sets ETag/Last-Modified only while sending (no stat_result given): comparing them
            # here first raised KeyError, i.e. a 500 whenever a browser resumed a partly cached file
            # (AETHRYON Tools player, resumed downloads). Set them now; setdefault keeps the second pass
            # in FileResponse.__call__ harmless.
            self.set_stat_headers(stat_result)
            if not self._should_use_range(if_range):
                return None
        try:
            self._parse_range_header(http_range, size)
        except MalformedRangeHeader:
            return error_response(400, "invalid_range", "En-tête Range invalide.")
        except RangeNotSatisfiable:
            return error_response(416, "range_not_satisfiable", "Plage demandée hors du fichier.",
                                  {"Content-Range": f"bytes */{size}"})
        except OSError:
            return None
        return None


_CHUNK_PATH_RE = re.compile(r"(?:^|/)uploads/[A-Za-z0-9_-]{1,64}/chunks/\d{1,6}$")


_MUSIC_MATCH_PATH_RE = re.compile(r"(?:^|/)music/(?:correspondances|playlists/synchroniser)$")


def _body_limit(scope: Any, max_bytes: int, chunk_bytes: int, music_bytes: int = 0) -> int:
    """MAX_BODY_BYTES, except a chunk of an import (PUT …/uploads/{id}/chunks/{n}, AETHRYON Tools) and the library
    listing sent to the music matching routes (POST /music/correspondances|playlists/synchroniser)."""
    if chunk_bytes and scope.get("method") == "PUT" and _CHUNK_PATH_RE.search(str(scope.get("path") or "")):
        return chunk_bytes
    if music_bytes and scope.get("method") == "POST" and _MUSIC_MATCH_PATH_RE.search(str(scope.get("path") or "")):
        return music_bytes
    return max_bytes


class AccessLog:
    """One JSON log line per request (path + token label only, never the query string).

    Also adds security headers, and answers requests announcing a body over `max_bytes` (a chunk of an import:
    `chunk_bytes`) with a JSON 413 before they reach the app.
    """

    def __init__(self, app: Any, max_bytes: int, chunk_bytes: int = 0, music_bytes: int = 0) -> None:
        self.app, self.max_bytes, self.chunk_bytes, self.music_bytes = app, max_bytes, chunk_bytes, music_bytes

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.monotonic()
        request_id = secrets.token_hex(6)
        status = 500

        async def send_with_headers(message: Any) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = MutableHeaders(scope=message)
                headers["X-Request-ID"] = request_id
                headers["X-Content-Type-Options"] = "nosniff"
                if "cache-control" not in headers:
                    headers["Cache-Control"] = "no-store"
            await send(message)

        try:
            length = dict(scope.get("headers") or []).get(b"content-length", b"")
            limit = _body_limit(scope, self.max_bytes, self.chunk_bytes, self.music_bytes)
            if length.isdigit() and int(length) > limit:
                response = error_response(413, "body_too_large",
                                          f"Corps de requête limité à {limit} octets.")
                await response(scope, receive, send_with_headers)
            else:
                await self.app(scope, receive, send_with_headers)
        finally:
            client = scope.get("client")
            state = scope.get("state") or {}
            label = state.get("token_label")
            path = scope.get("path")
            # Never log a media title: the readable file name after /file/ is cut for EVERY caller (user
            # keys, legacy tokens, refused requests), the job id stays.
            if isinstance(path, str) and "/file/" in path:
                path = path.split("/file/", 1)[0] + "/file"
            log.info("request", extra={"rid": request_id, "method": scope.get("method"), "path": path,
                                       "status": status, "ms": round((time.monotonic() - started) * 1000),
                                       "client": client[0] if client else "unknown", "token": label})


class BodyLimit:
    """Caps request bodies without Content-Length (chunked) while they are read.

    FastAPI turns the exception into a 400 "error parsing the body"; bodies that announce a
    too large Content-Length are rejected earlier with a JSON 413 by AccessLog.
    """

    def __init__(self, app: Any, max_bytes: int, chunk_bytes: int = 0, music_bytes: int = 0) -> None:
        self.app, self.max_bytes, self.chunk_bytes, self.music_bytes = app, max_bytes, chunk_bytes, music_bytes

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        received = 0
        limit = _body_limit(scope, self.max_bytes, self.chunk_bytes, self.music_bytes)

        async def limited_receive() -> Any:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise ValueError("request body too large")
            return message

        await self.app(scope, limited_receive, send)


def _text(value: Any, limit: int) -> str | None:
    return value.strip()[:limit] or None if isinstance(value, str) else None


def _number(value: Any) -> float | int | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0 else None


def _https(value: Any) -> str | None:
    return value[:2048] if isinstance(value, str) and value.startswith("https://") else None


def _preview_item(info: dict[str, Any]) -> dict[str, Any]:
    sizes = info.get("est_size_bytes") or {}
    limits = info.get("limits") or {}
    return {
        "title": _text(info.get("title"), 300),
        "uploader": _text(info.get("uploader"), 100),
        "duration": _number(info.get("duration")),
        "thumbnail": _https(info.get("thumbnail")),
        "is_gif": bool(info.get("is_gif")),
        "live": info.get("live_status") in ("is_live", "is_upcoming"),
        "best_h264_quality": _number(info.get("best_h264_quality")),
        # yes: the platform lists a sound track; no: an X "GIF" (always silent); unknown: the metadata do not say
        # (X lists no audio codec for its muxed formats): never claim "no sound" without knowing it.
        "audio": "yes" if info.get("audio_only_available") else "no" if info.get("is_gif") else "unknown",
        "qualities": [{"quality": _number(q.get("quality")), "est_size_bytes": _number(q.get("est_size_bytes")),
                       "h264": bool(q.get("h264"))}
                      for q in (info.get("qualities") or [])[:8] if isinstance(q, dict)],
        "est_size_bytes": {k: _number(sizes.get(k)) for k in ("audio_best", "mp3_128", "mp3_192", "mp3_320")
                           if _number(sizes.get(k)) is not None},
        "limits": {k: bool(limits.get(k)) for k in ("too_long", "gif_allowed", "transcode_allowed") if k in limits},
    }


def preview_view(info: dict[str, Any], platform: str) -> dict[str, Any]:
    """POST /preview answer: an allowlist of the /info fields (no stream URL, no media id, no extractor)."""
    if isinstance(info.get("entries"), list):
        items = [_preview_item(e) | {"index": int(e.get("index") or i)}
                 for i, e in enumerate(info["entries"][:10], start=1) if isinstance(e, dict)]
        return {"platform": platform, "title": _text(info.get("title"), 300), "uploader": _text(info.get("uploader"), 100),
                "media_count": int(info.get("media_count") or len(items)), "entries": items}
    return {"platform": platform, **_preview_item(info), "media_count": 1}


def _user_view(request: Request, data: dict[str, Any]) -> dict[str, Any]:
    """User keys do not see whether the file came from the shared result cache, and read the
    fixed text of docs/ERREURS.md for a failed job (admins keep the technical detail)."""
    principal = getattr(request.state, "principal", None)
    if principal is not None and principal.is_user:
        data.pop("cached", None)
        if data.get("error") in USER_TEXT:
            data["detail"] = user_text(data["error"])
    return data


def _job_body(request: Request, data: dict[str, Any]) -> dict[str, Any]:
    # url_for() honours the root path (/media) and X-Forwarded-Proto/Host from Traefik.
    data["status_url"] = str(request.url_for("job_status", job_id=data["job_id"]))
    data["file_url"] = None
    if data["status"] == "done":
        name = data.get("filename")
        base = str(request.url_for("job_file", job_id=data["job_id"]))
        # url_for() does not percent-encode path params: encode the (Unicode) name ourselves.
        data["file_url"] = f"{base}/{quote(name, safe='')}" if name else base
    return data


def _write_at(path: Path, offset: int, data: bytes) -> None:
    """Write a chunk of an import at its offset (the file was allocated to its full size at creation)."""
    fd = os.open(path, os.O_WRONLY)
    try:
        written = os.pwrite(fd, data, offset)
        if written != len(data):
            raise OSError("short write")
    finally:
        os.close(fd)


def _iso_ts(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def _new_workdir(tmp_dir: Path, prefix: str) -> Path:
    path = tmp_dir / f"{prefix}-{secrets.token_hex(8)}"
    path.mkdir(parents=True)
    return path


def _cleanup_dir(path: Path, active: set[Path]) -> None:
    active.discard(path)
    shutil.rmtree(path, ignore_errors=True)


def _remove_orphans(tmp_dir: Path, keep: set[Path], older_than_s: float = 0) -> int:
    removed = 0
    now = time.time()
    if not tmp_dir.is_dir():
        return 0
    for child in tmp_dir.iterdir():
        if child in keep:
            continue
        try:
            if older_than_s and now - child.stat().st_mtime < older_than_s:
                continue
        except FileNotFoundError:
            continue
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)
        else:
            child.unlink(missing_ok=True)
        removed += 1
    return removed


def __getattr__(name: str) -> Any:
    # `uvicorn app.main:app` builds the app lazily so tests can import this module freely.
    if name == "app":
        globals()["app"] = create_app()
        return globals()["app"]
    raise AttributeError(name)
