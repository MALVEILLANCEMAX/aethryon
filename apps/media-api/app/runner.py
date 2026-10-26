"""Parent side of the worker processes: concurrency slots, queue limit, timeouts, cancellation.

Each yt-dlp/ffmpeg task runs in its own process group (forkserver child). That makes the
global timeout and job cancellation real: we SIGKILL the whole group (yt-dlp + ffmpeg), which
is impossible with a thread.
"""

from __future__ import annotations

import asyncio
import logging
import multiprocessing
import os
import shutil
import signal
import time
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass, field
from multiprocessing.connection import Connection
from typing import Any, AsyncIterator, Literal

from .config import DEFAULT_YT_CLIENTS, Settings, enabled_platforms
from .errors import ApiError
from .platforms import Gate, PlatformMonitor

log = logging.getLogger("ytapi.runner")

ProgressCallback = Callable[[dict[str, Any]], None]
CancelCheck = Callable[[], Awaitable[bool]]


@dataclass(frozen=True)
class WorkerConfig:
    """Picklable snapshot of the settings the worker process needs."""

    max_duration_s: int
    max_filesize_bytes: int
    transcode_max_duration_s: int
    gif_max_duration_s: int
    cache_dir: str | None
    yt_proxy: str | None = None
    extractor_args: dict[str, dict[str, list[str]]] = field(default_factory=dict)
    log_level: str = "INFO"
    yt_clients: tuple[str, ...] = DEFAULT_YT_CLIENTS
    # Clips (app/extraits.py): most bytes received from the platform, largest output file.
    extrait_telechargement_max_bytes: int = 1024 * 1024 * 1024
    extrait_sortie_max_bytes: int = 1024 * 1024 * 1024

    @classmethod
    def from_settings(cls, settings: Settings) -> WorkerConfig:
        return cls(
            max_duration_s=settings.max_duration_s,
            max_filesize_bytes=settings.max_filesize_bytes,
            transcode_max_duration_s=settings.transcode_max_duration_s,
            gif_max_duration_s=settings.gif_max_duration_s,
            cache_dir=str(settings.cache_dir) if settings.cache_dir else None,
            yt_proxy=settings.yt_proxy,
            extractor_args=settings.ytdlp_extractor_args,
            log_level=settings.log_level,
            yt_clients=settings.yt_clients,
            extrait_telechargement_max_bytes=settings.extrait_telechargement_max_bytes,
            extrait_sortie_max_bytes=settings.extrait_sortie_max_bytes,
        )


@dataclass(frozen=True)
class Task:
    # derive: ffmpeg only, on the file of a finished job (compression, GIF, Tools edits): never contacts the platform.
    # upload: check of an imported file (AETHRYON Tools); assets: storyboard / waveform of a finished file.
    kind: Literal["info", "download", "derive", "upload", "assets"]
    url: str
    platform: str
    workdir: str
    params: dict[str, Any] | None = None  # DownloadParams.model_dump() for downloads
    cookies_file: str | None = None  # YouTube only, set by the parent once validated
    job_id: str = ""  # async jobs: added to every log record of the worker process


class Cancelled(Exception):
    """Raised when a task is cancelled (job deleted or HTTP client gone)."""


def error_cause(exc: BaseException) -> str | None:
    """Technical cause of a worker failure (cleaned yt-dlp message), for the server logs only.

    Never part of an HTTP response: ApiError.detail stays the user-facing text."""
    cause = getattr(exc, "cause", None)
    return cause if isinstance(cause, str) and cause else None


def _worker_error(message: dict[str, Any]) -> ApiError:
    error = ApiError.from_dict(message["error"])
    if message.get("cause"):  # absent from older workers / non yt-dlp failures
        error.cause = str(message["cause"])  # type: ignore[attr-defined]
    return error


def _kill(proc: multiprocessing.process.BaseProcess) -> None:
    """SIGKILL the task's whole process group, even if its leader already died.

    The group outlives a dead leader (e.g. worker OOM-killed while ffmpeg/deno still run), so
    killpg is always attempted. Before the child has called setpgrp there is no group yet: then
    the child itself is killed.
    """
    pid = proc.pid
    if not pid:
        return
    try:
        os.killpg(pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        if proc.is_alive():
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


class Runner:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.worker_config = WorkerConfig.from_settings(settings)
        self._ctx = multiprocessing.get_context("forkserver")
        # Children fork from a clean, single-threaded server that already imported yt-dlp.
        self._ctx.set_forkserver_preload(["app.worker"])
        self._download_slots = asyncio.Semaphore(settings.max_concurrent)
        self._info_slots = asyncio.Semaphore(max(2, settings.max_concurrent * 2))
        # Clips processed at once (EXTRAIT_SIMULTANES_MAX), taken BEFORE a download slot: a clip waiting for its turn
        # never holds a slot that a full download could use.
        self._clip_slots = asyncio.Semaphore(settings.extrait_simultanes_max)
        self.clips_running = 0
        self._pending = 0  # downloads waiting for a slot or running (sync + jobs)
        self._running = 0
        self._children: set[multiprocessing.process.BaseProcess] = set()
        self.platforms = PlatformMonitor(settings.yt_cooldown_min, settings.yt_concurrency, settings.yt_min_interval_s,
                                         settings.yt_cooldown_max_min, enabled_platforms(settings.allowed_domains),
                                         settings.platform_breaker_failures, settings.platform_breaker_min,
                                         settings.platform_breaker_max_min)

    # --- queue / slots ---------------------------------------------------------------------

    @property
    def pending(self) -> int:
        return self._pending

    @property
    def running(self) -> int:
        return self._running

    def disk_status(self) -> dict[str, int]:
        """Free space vs. what the admitted downloads may still write (worst case)."""
        try:
            free = shutil.disk_usage(self.settings.tmp_dir).free
        except OSError:
            free = -1
        return {"free_bytes": free, "reserved_bytes": self._pending * self.settings.max_filesize_bytes,
                "floor_bytes": 2 * self.settings.max_filesize_bytes + 512 * 1024 * 1024}

    def _check_disk(self, admitted: int) -> None:
        # Each admitted download may still write up to MAX_FILESIZE_MB; merging/transcoding a new
        # one needs about twice its size. Finished job and cache files are already counted in free.
        disk = self.disk_status()
        if disk["free_bytes"] < 0:
            return
        if disk["free_bytes"] - admitted * self.settings.max_filesize_bytes < disk["floor_bytes"]:
            raise ApiError(503, "insufficient_storage",
                           f"Espace disque insuffisant ({disk['free_bytes'] // 2**20} Mio libres), réessayez plus tard.",
                           {"Retry-After": "300"})

    def check_space(self, size: int) -> None:
        """An imported file of `size` bytes still leaves the floor free, with the admitted downloads counted."""
        disk = self.disk_status()
        if disk["free_bytes"] < 0:
            return
        if disk["free_bytes"] - self._pending * self.settings.max_filesize_bytes - size < disk["floor_bytes"]:
            raise ApiError(503, "insufficient_storage",
                           f"Espace disque insuffisant ({disk['free_bytes'] // 2**20} Mio libres), réessayez plus tard.",
                           {"Retry-After": "300"})

    def reserve(self) -> None:
        """Take a place in the download queue or fail fast with 503 (queue full / disk full)."""
        capacity = self.settings.max_concurrent + self.settings.max_queue
        if self._pending >= capacity:
            raise ApiError(503, "server_busy", "File d'attente pleine, réessayez dans un moment.", {"Retry-After": "30"})
        self._check_disk(admitted=self._pending)
        self._pending += 1

    def release(self) -> None:
        self._pending = max(0, self._pending - 1)

    @asynccontextmanager
    async def download_slot(self, cancel_check: CancelCheck | None = None) -> AsyncIterator[None]:
        await _acquire(self._download_slots, cancel_check)
        try:
            # Re-check once the download really starts: space may have shrunk while queued.
            self._check_disk(admitted=self._running)
        except ApiError:
            self._download_slots.release()
            raise
        self._running += 1
        try:
            yield
        finally:
            self._running -= 1
            self._download_slots.release()

    @asynccontextmanager
    async def clip_slot(self, cancel_check: CancelCheck | None = None) -> AsyncIterator[None]:
        await _acquire(self._clip_slots, cancel_check)
        self.clips_running += 1
        try:
            yield
        finally:
            self.clips_running -= 1
            self._clip_slots.release()

    @asynccontextmanager
    async def info_slot(self, cancel_check: CancelCheck | None = None) -> AsyncIterator[None]:
        await _acquire(self._info_slots, cancel_check)
        try:
            yield
        finally:
            self._info_slots.release()

    # --- process execution -----------------------------------------------------------------

    async def run(
        self,
        task: Task,
        timeout_s: float,
        on_progress: ProgressCallback | None = None,
        cancel_check: CancelCheck | None = None,
        gate: Gate | None = None,
    ) -> dict[str, Any]:
        """Run a task in a child process; updates platform health; releases `gate` after extraction.

        A derived file (kind "derive", "upload", "assets") never reached the platform: it neither trips nor resets its
        breaker."""
        started_at = time.time()
        if task.kind in ("derive", "upload", "assets"):
            try:
                return await self._run(task, timeout_s, on_progress, cancel_check, gate)
            finally:
                if gate is not None:
                    gate.release()
        try:
            result = await self._run(task, timeout_s, on_progress, cancel_check, gate)
        except ApiError as exc:
            error = self.platforms.record_error(task.platform, exc, started_at, error_cause(exc))
            if error is not exc and error_cause(exc):
                error.cause = error_cause(exc)  # type: ignore[attr-defined]  # breaker copy keeps the cause
            raise error from None
        finally:
            if gate is not None:
                gate.release()
        self.platforms.record_success(task.platform, started_at)
        return result

    async def _run(
        self,
        task: Task,
        timeout_s: float,
        on_progress: ProgressCallback | None,
        cancel_check: CancelCheck | None,
        gate: Gate | None,
    ) -> dict[str, Any]:
        from . import worker  # imported lazily: the parent never runs yt-dlp itself

        def handle(message: dict[str, Any]) -> None:
            if message.get("type") == "extracted":
                if gate is not None:
                    gate.release()
            elif on_progress is not None:
                on_progress(message)

        parent_conn, child_conn = self._ctx.Pipe(duplex=False)
        proc = self._ctx.Process(
            target=worker.child_main,
            args=(asdict(task), asdict(self.worker_config), child_conn),
            daemon=True,
            name=f"ytapi-{task.kind}",
        )
        proc.start()
        child_conn.close()
        self._children.add(proc)
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_s
        try:
            while True:
                message = _drain(parent_conn, handle)
                if message is not None:
                    if message["type"] == "result":
                        return message["data"]
                    raise _worker_error(message)
                if not proc.is_alive():
                    message = _drain(parent_conn, handle)
                    if message is not None:
                        if message["type"] == "result":
                            return message["data"]
                        raise _worker_error(message)
                    code = proc.exitcode
                    log.error("worker exited without result", extra={"exitcode": code, "kind": task.kind})
                    detail = "Le processus de téléchargement s'est arrêté"
                    if code == -signal.SIGKILL:
                        detail += " (tué, probablement par manque de mémoire : baissez la qualité ou MAX_CONCURRENT)"
                    raise ApiError(500, "worker_crashed", detail + ".")
                if loop.time() > deadline:
                    raise ApiError(504, "timeout", f"Traitement interrompu après {int(timeout_s)} s (limite atteinte).")
                if cancel_check is not None and await cancel_check():
                    raise Cancelled()
                await asyncio.sleep(0.25)
        finally:
            _kill(proc)
            await asyncio.to_thread(proc.join, 10)
            self._children.discard(proc)
            parent_conn.close()

    def kill_all(self) -> None:
        for proc in list(self._children):
            _kill(proc)


async def _acquire(sem: asyncio.Semaphore, cancel_check: CancelCheck | None) -> None:
    """Wait for a slot in arrival order (FIFO), checking for cancellation every second.

    The pending acquire is never cancelled while polling: cancelling and retrying would put
    the waiter back at the end of the semaphore's queue.
    """
    if cancel_check is None:
        await sem.acquire()
        return
    acquire = asyncio.ensure_future(sem.acquire())
    try:
        while True:
            done, _ = await asyncio.wait({acquire}, timeout=1.0)
            if done:
                acquire.result()
                return
            if await cancel_check():
                raise Cancelled()
    except BaseException:
        if acquire.done() and not acquire.cancelled() and acquire.exception() is None:
            sem.release()
        else:
            acquire.cancel()
        raise


def _drain(conn: Connection, handle: ProgressCallback) -> dict[str, Any] | None:
    """Read every pending message; return the terminal one (result/error) if any."""
    try:
        while conn.poll():
            message = conn.recv()
            if message.get("type") in ("progress", "extracted"):
                handle(message)
                continue
            return message
    except (EOFError, OSError):
        return None
    return None
