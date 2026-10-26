"""AETHRYON Cloud V1: backup of a finished download to the object storage, decided and verified by account.

Flow (CLOUD_SYNC=true, USER_KEYS_ENABLED=true; account with CLOUD=on):
1. a user job ends "done" (download or derived file) -> `offer(job)` queues it (never blocks the job, never fails it);
2. the worker hashes the file (SHA-256 + MD5) and asks account POST /internal/v1/cloud/offre: account alone decides
   (administrator only, cloud on, automatic backup on, quota reserved atomically) and answers with a presigned PUT URL
   whose size, type, MD5 and SHA-256 are signed (ytapi holds NO storage credential);
3. the file is streamed to the storage (http.client: no proxy, no redirect, TLS verified); transient failures are
   retried with a fresh URL (POST .../url-envoi);
4. POST .../termine: account checks the object (HEAD: size, hash) before saying "Sauvegardé".
The job's files are kept while their upload runs (`cloud_hold_until`, at most CLOUD_HOLD_MAX_MIN past the TTL). Logs
carry ids and codes only: never the file name, the title, the URL or the presigned URL.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import http.client
import logging
import ssl
import time
from pathlib import Path
from typing import IO, TYPE_CHECKING, Any
from urllib.parse import urlsplit

from .userkeys import AccountClient, AccountUnavailable

if TYPE_CHECKING:
    from .jobs import Job

log = logging.getLogger("ytapi.cloud")

QUEUE_MAX = 50
CHUNK = 1024 * 1024
PUT_ATTEMPTS = 3
RETRY_DELAYS_S = (2.0, 10.0)
PUT_TIMEOUT_S = 60.0  # per socket operation
# Headers that the presigned URL signs and that must be sent unchanged (anything else is refused before sending).
ALLOWED_HEADERS = {"content-length", "content-type", "content-md5", "content-disposition", "x-amz-meta-sha256"}


class UploadError(Exception):
    def __init__(self, code: str, retry: bool) -> None:
        super().__init__(code)
        self.code = code
        self.retry = retry


def digests(handle: IO[bytes]) -> tuple[int, str, str]:
    """(size, SHA-256 hex, MD5 base64) of an open file, read in chunks from the start."""
    handle.seek(0)
    sha, md5, size = hashlib.sha256(), hashlib.md5(), 0  # noqa: S324 - MD5 is S3's Content-MD5 integrity check
    while chunk := handle.read(CHUNK):
        sha.update(chunk)
        md5.update(chunk)
        size += len(chunk)
    return size, sha.hexdigest(), base64.b64encode(md5.digest()).decode("ascii")


def put_file(envoi: dict[str, Any], handle: IO[bytes], size: int, allow_http: bool = False) -> None:
    """Stream the file to a presigned PUT URL. Raises UploadError (retry=True for network errors, 5xx, 429, 403
    from an expired URL)."""
    url = str(envoi.get("url") or "")
    parts = urlsplit(url)
    if parts.scheme != "https" and not (allow_http and parts.scheme == "http"):
        raise UploadError("url_refusee", retry=False)
    if not parts.hostname or parts.username or parts.password:
        raise UploadError("url_refusee", retry=False)
    raw_headers = envoi.get("entetes")
    if not isinstance(raw_headers, dict):
        raise UploadError("entetes_invalides", retry=False)
    headers = {str(k).lower(): str(v) for k, v in raw_headers.items()}
    if set(headers) - ALLOWED_HEADERS or any(c in v for v in headers.values() for c in "\r\n"):
        raise UploadError("entetes_invalides", retry=False)
    if headers.get("content-length") != str(size):
        raise UploadError("taille_differente", retry=False)
    path = parts.path + (f"?{parts.query}" if parts.query else "")
    if parts.scheme == "https":
        conn: http.client.HTTPConnection = http.client.HTTPSConnection(
            parts.hostname, parts.port or 443, timeout=PUT_TIMEOUT_S, context=ssl.create_default_context())
    else:
        conn = http.client.HTTPConnection(parts.hostname, parts.port or 80, timeout=PUT_TIMEOUT_S)
    try:
        conn.putrequest("PUT", path, skip_accept_encoding=True)
        for name, value in headers.items():
            conn.putheader(name, value)
        conn.endheaders()
        handle.seek(0)
        sent = 0
        while chunk := handle.read(CHUNK):
            conn.send(chunk)
            sent += len(chunk)
        if sent != size:
            raise UploadError("fichier_modifie", retry=False)
        response = conn.getresponse()
        response.read(64 * 1024)
        status = response.status
    except UploadError:
        raise
    except (OSError, http.client.HTTPException) as exc:
        raise UploadError(f"reseau_{type(exc).__name__}"[:40].lower(), retry=True) from None
    finally:
        conn.close()
    if 200 <= status < 300:
        return
    raise UploadError(f"http_{status}", retry=status >= 500 or status in (403, 408, 429))


class CloudSync:
    """Background queue of backups (one upload at a time, bounded queue)."""

    def __init__(self, client: AccountClient, allow_http: bool = False, hold_max_s: float = 7200.0,
                 retry_delays_s: tuple[float, ...] = RETRY_DELAYS_S) -> None:
        self.client = client
        self.allow_http = allow_http
        self.hold_max_s = hold_max_s
        self.retry_delays_s = retry_delays_s
        self.queue: asyncio.Queue[tuple[Job, IO[bytes]]] = asyncio.Queue(maxsize=QUEUE_MAX)
        self._task: asyncio.Task[None] | None = None
        self.stats = {"queued": 0, "skipped": 0, "saved": 0, "failed": 0, "dropped": 0}

    def offer(self, job: Job) -> bool:
        """Called when a user job ends "done" (a video/audio job, or an AETHRYON Music import: kind "music"). Opens the
        file at once (the open handle keeps it readable even if the job's folder is removed), then queues it. Never
        raises; True when the backup was queued."""
        try:
            if not job.owner_user_id or job.kind not in ("download", "derive", "music") or not job.result:
                return False
            path = Path(str(job.result.get("filepath") or ""))
            handle = path.open("rb")
        except OSError:
            log.warning("cloud: file not readable", extra={"job_id": job.id})
            return False
        except Exception:  # never let the backup disturb the job
            log.exception("cloud: offer failed", extra={"job_id": job.id})
            return False
        job.cloud_hold_until = time.time() + self.hold_max_s
        try:
            self.queue.put_nowait((job, handle))
            self.stats["queued"] += 1
            return True
        except asyncio.QueueFull:
            handle.close()
            job.cloud_hold_until = None
            self.stats["dropped"] += 1
            log.warning("cloud: queue full, backup skipped", extra={"job_id": job.id})
            return False

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="cloud-sync")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        while not self.queue.empty():
            job, handle = self.queue.get_nowait()
            handle.close()
            job.cloud_hold_until = None

    async def _loop(self) -> None:
        while True:
            job, handle = await self.queue.get()
            try:
                _mark(job, await self.process(job, handle))
            except asyncio.CancelledError:
                raise
            except Exception:  # never let the worker die
                log.exception("cloud: backup crashed", extra={"job_id": job.id})
            finally:
                handle.close()
                job.cloud_hold_until = None
                self.queue.task_done()

    async def process(self, job: Job, handle: IO[bytes]) -> str:
        """One backup; returns the final state seen by ytapi (skipped:<reason>, sauvegarde, en_attente, echec...)."""
        result = job.result or {}
        size, sha256, md5 = await asyncio.to_thread(digests, handle)
        body = {
            "user_id": job.owner_user_id, "job_id": job.id, "usage_id": job.usage_id,
            "nom": result.get("download_name") or f"{job.id}.{result.get('ext') or 'bin'}",
            "type": result.get("media_type"), "taille": size, "sha256": sha256, "md5": md5,
            "plateforme": job.media.platform,
        }
        if body["usage_id"] is None:
            del body["usage_id"]
        meta = getattr(job, "cloud_meta", None)
        if isinstance(meta, dict):
            body["meta"] = meta  # AETHRYON Music: the record of the track, kept by account apart from the audio
        try:
            status, offre = await self.client.call("/internal/v1/cloud/offre", body)
        except AccountUnavailable as exc:
            self.stats["skipped"] += 1
            log.warning("cloud: account unavailable, backup skipped", extra={"job_id": job.id, "reason": str(exc)})
            return "skipped:account_unavailable"
        if status != 200 or not offre.get("sauvegarder"):
            self.stats["skipped"] += 1
            reason = str(offre.get("raison") or offre.get("error") or f"http_{status}")[:40]
            log.info("cloud: backup not requested", extra={"job_id": job.id, "reason": reason})
            return f"skipped:{reason}"
        objet_id = str((offre.get("objet") or {}).get("id") or "")
        envoi = offre.get("envoi") or {}
        _mark(job, "envoi_en_cours")
        error = "envoi_impossible"
        for attempt in range(1, PUT_ATTEMPTS + 1):
            try:
                await asyncio.to_thread(put_file, envoi, handle, size, self.allow_http)
                error = ""
                break
            except UploadError as exc:
                error = exc.code
                log.warning("cloud: upload failed", extra={"job_id": job.id, "objet": objet_id, "code": exc.code,
                                                           "attempt": attempt})
                if not exc.retry or attempt == PUT_ATTEMPTS:
                    break
                await asyncio.sleep(self.retry_delays_s[min(attempt - 1, len(self.retry_delays_s) - 1)])
                try:  # a fresh URL for the same reservation (the previous one may have expired)
                    status, fresh = await self.client.call(f"/internal/v1/cloud/objets/{objet_id}/url-envoi",
                                                           {"user_id": job.owner_user_id})
                    if status == 200 and fresh.get("envoi"):
                        envoi = fresh["envoi"]
                except AccountUnavailable:
                    pass
        done = {"user_id": job.owner_user_id, "ok": not error}
        if error:
            done["erreur"] = error if error.replace("_", "").isalnum() and error.islower() else "envoi_impossible"
        try:
            status, fin = await self.client.call(f"/internal/v1/cloud/objets/{objet_id}/termine", done)
        except AccountUnavailable:
            # account will check the object itself when the reservation ends (kept if complete).
            log.warning("cloud: end of upload not reported", extra={"job_id": job.id, "objet": objet_id})
            return "unknown"
        state = str(fin.get("statut") or f"http_{status}")
        if state == "sauvegarde":
            self.stats["saved"] += 1
        elif state == "echec":
            self.stats["failed"] += 1
        log.info("cloud: backup finished", extra={"job_id": job.id, "objet": objet_id, "state": state})
        return state


def _mark(job: Any, state: str) -> None:
    """Last cloud state seen by ytapi, on the job (shown by /music/imports; ignored by the video jobs' views)."""
    try:
        job.cloud_state = state
    except AttributeError:
        pass
