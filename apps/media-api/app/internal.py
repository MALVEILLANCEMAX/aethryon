"""Internal admin API /internal/v1 (AETHRYON Control Center), called by the account service only.

Mounted only when USER_KEYS_ENABLED (account internal URL + token file) and INTERNAL_ALLOW_FROM are
set. Every request must, in this order:
1. carry no forwarding header (X-Forwarded-*, Forwarded, X-Real-IP): Traefik always adds them, so
   the API is never reachable from the Internet even though Traefik routes /media/* to ytapi;
2. come from an address inside INTERNAL_ALLOW_FROM (the ytc-internal network);
3. present X-Internal-Token, the token ytapi itself sends to account (constant-time comparison).
Any refusal is the same 403 {"error": "forbidden", "detail": ...}; the reason only goes to the logs
(never the token). The routes never return a URL, a title or a file name.

- GET  /internal/v1/status            : queue, platforms, cookies (public view), disk, cache, versions,
                                         job counters (the admin /status without the token labels)
- GET  /internal/v1/jobs              : active jobs [{job_id, usage_id, user_id, platform, fmt, quality,
                                         stage, progress, status, created_at, updated_at}]
- POST /internal/v1/jobs/{id}/cancel  : {job_id, cancelled: true}; 404 unknown, 409 already finished
"""

from __future__ import annotations

import ipaddress
import logging
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, Request

from .config import IpNetwork
from .errors import ApiError
from .jobs import JobManager
from .userkeys import AccountClient

log = logging.getLogger("ytapi.internal")

PREFIX = "/internal/v1"
FORBIDDEN_DETAIL = "Accès refusé : API interne réservée au service account (réseau interne et jeton interne)."
_ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]


def has_forwarding_header(request: Request) -> bool:
    """True when a proxy (Traefik) relayed the request: it always adds X-Forwarded-For / X-Real-IP."""
    for name in request.headers.keys():  # lower-cased by Starlette
        if name == "forwarded" or name == "x-real-ip" or name.startswith("x-forwarded-"):
            return True
    return False


def address_allowed(host: str | None, networks: tuple[IpNetwork, ...]) -> bool:
    if not host or not networks:
        return False
    try:
        address = ipaddress.ip_address(host.split("%", 1)[0])  # no IPv6 zone id
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped  # ::ffff:10.251.20.5 on a dual-stack socket
    return any(address.version == network.version and address in network for network in networks)


def make_router(networks: tuple[IpNetwork, ...], accounts: AccountClient, jobs: JobManager,
                status_body: Callable[[], dict[str, Any]]) -> APIRouter:
    def refuse(request: Request, reason: str, level: int) -> ApiError:
        client = request.client.host if request.client else "unknown"
        log.log(level, "internal access refused", extra={"reason": reason, "client": client,
                                                         "path": request.url.path})
        return ApiError(403, "forbidden", FORBIDDEN_DETAIL)

    async def internal_auth(request: Request) -> None:
        if has_forwarding_header(request):
            # Came through a proxy (Traefik, i.e. the Internet): never served, whatever the token.
            raise refuse(request, "forwarded", logging.INFO)
        if not address_allowed(request.client.host if request.client else None, networks):
            raise refuse(request, "network", logging.WARNING)
        if not accounts.token_matches(request.headers.get("x-internal-token")):
            raise refuse(request, "token", logging.WARNING)
        request.state.token_label = "internal"  # access log: label only, never the token

    router = APIRouter(prefix=PREFIX, dependencies=[Depends(internal_auth)], include_in_schema=False)

    @router.get("/status")
    async def internal_status() -> dict[str, Any]:
        return status_body()

    @router.get("/jobs")
    async def internal_jobs() -> list[dict[str, Any]]:
        return [job.internal() for job in jobs.active_jobs()]

    @router.post("/jobs/{job_id}/cancel")
    async def internal_cancel(job_id: str) -> dict[str, Any]:
        job = await jobs.cancel(job_id)
        return {"job_id": job.id, "cancelled": True}

    # Anything else under the prefix: same checks first (an outsider always gets the same 403), then 404.
    @router.api_route("/{rest:path}", methods=_ALL_METHODS)
    async def internal_unknown(rest: str) -> None:
        raise ApiError(404, "not_found", "Route inconnue.")

    return router
