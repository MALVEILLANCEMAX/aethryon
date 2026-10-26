"""Token authentication and in-memory sliding-window rate limiting."""

from __future__ import annotations

import secrets
import time
from collections import deque
from dataclasses import dataclass, field

from fastapi import Request

from .errors import ApiError
from .tokens import TokenStore
from .userkeys import AccountClient, AccountUnavailable, Principal


def client_ip(request: Request) -> str:
    # uvicorn --proxy-headers rewrites request.client from X-Forwarded-For when the
    # immediate peer is in --forwarded-allow-ips (the reverse proxy).
    return request.client.host if request.client else "unknown"


def extract_token(request: Request) -> str | None:
    return extract_token_source(request)[0]


def extract_token_source(request: Request) -> tuple[str | None, str | None]:
    """(token, "header" | "query" | None). The Authorization header wins over ?token=."""
    auth = request.headers.get("authorization", "")
    scheme, _, value = auth.partition(" ")
    if scheme.lower() == "bearer" and value.strip():
        return value.strip(), "header"
    token = request.query_params.get("token")
    return (token.strip(), "query") if token and token.strip() else (None, None)


def token_is_valid(candidate: str | None, expected: str) -> bool:
    if not candidate:
        return False
    return secrets.compare_digest(candidate.encode("utf-8"), expected.encode("utf-8"))


@dataclass
class SlidingWindowLimiter:
    """Allow at most `limit` events per `window_s` seconds per key."""

    limit: int
    window_s: float
    _events: dict[str, deque[float]] = field(default_factory=dict)

    def hit(self, key: str, now: float | None = None) -> float | None:
        """Record an event. Returns None if allowed, else seconds to wait before retrying."""
        now = time.monotonic() if now is None else now
        events = self._events.setdefault(key, deque())
        cutoff = now - self.window_s
        while events and events[0] <= cutoff:
            events.popleft()
        if len(events) >= self.limit:
            return max(0.0, events[0] + self.window_s - now)
        events.append(now)
        return None

    def blocked_for(self, key: str, now: float | None = None) -> float | None:
        """Like hit() but without recording an event."""
        now = time.monotonic() if now is None else now
        events = self._events.get(key)
        if not events:
            return None
        cutoff = now - self.window_s
        while events and events[0] <= cutoff:
            events.popleft()
        if len(events) >= self.limit:
            return max(0.0, events[0] + self.window_s - now)
        return None

    def prune(self, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        cutoff = now - self.window_s
        for key in list(self._events):
            events = self._events[key]
            while events and events[0] <= cutoff:
                events.popleft()
            if not events:
                del self._events[key]


def rate_limited(retry_after: float) -> ApiError:
    seconds = max(1, int(retry_after + 0.999))
    return ApiError(429, "rate_limited", f"Trop de requêtes, réessayez dans {seconds} s.", {"Retry-After": str(seconds)})


UNAUTHORIZED_DETAIL = "Jeton absent ou invalide (en-tête Authorization: Bearer <jeton>, ou ?token=)."


def unauthorized(detail: str = UNAUTHORIZED_DETAIL) -> ApiError:
    return ApiError(401, "unauthorized", detail, {"WWW-Authenticate": "Bearer"})


class Guard:
    """Auth + rate limits, used as a FastAPI dependency factory.

    check() is async (it runs on the event loop, never in the threadpool): the limiters are plain
    dicts/deques mutated by check() and by prune() (cleanup loop), so both must run on the loop.
    """

    def __init__(self, tokens: TokenStore, heavy_limit: tuple[int, int],
                 accounts: AccountClient | None = None, user_key_prefix: str = "ytc_") -> None:
        self.tokens = tokens
        # Per-user keys (USER_KEYS_ENABLED): None keeps the admin-only behaviour.
        self.accounts = accounts
        self.user_key_prefix = user_key_prefix
        self._in_flight: dict[str, int] = {}  # user-key verifications in progress, per IP
        count, window = heavy_limit
        # Downloads/info/job creation: configurable (RATE_LIMIT).
        self.heavy = SlidingWindowLimiter(count, window)
        # Status polling / file fetch / delete: generous, Shortcuts polls every few seconds.
        self.light = SlidingWindowLimiter(max(120, count * 10), 60)
        # Failed authentications per IP: slows down token guessing.
        self.auth_failures = SlidingWindowLimiter(10, 300)

    async def check(self, request: Request, heavy: bool) -> Principal:
        """Authenticate + rate-limit; returns the principal (also stored in request.state)."""
        ip = client_ip(request)
        wait = self.auth_failures.blocked_for(ip)
        if wait is not None:
            raise rate_limited(wait)
        token, source = extract_token_source(request)
        if self.accounts is not None and token is not None and token.startswith(self.user_key_prefix):
            principal = await self._check_user_key(token, source, ip)
        else:
            label = self.tokens.match(token)
            if label is None:
                self.auth_failures.hit(ip)
                raise unauthorized()
            principal = Principal(kind="admin", label=label)
        request.state.token_label = principal.label
        request.state.principal = principal
        limiter = self.heavy if heavy else self.light
        wait = None if principal.via_bot else limiter.hit(ip)
        if wait is None and principal.is_user:
            wait = limiter.hit(f"user:{principal.user_id}")
        if wait is not None:
            raise rate_limited(wait)
        return principal

    async def _check_user_key(self, token: str, source: str | None, ip: str) -> Principal:
        assert self.accounts is not None
        if source != "header":
            # User keys only travel in the Authorization header (never in URLs, logs or history).
            self.auth_failures.hit(ip)
            raise unauthorized("Jeton personnel accepté uniquement dans l'en-tête Authorization: Bearer <jeton>.")
        if self._in_flight.get(ip, 0) >= 4:  # floods of (fake) keys from one IP
            raise rate_limited(2)
        self._in_flight[ip] = self._in_flight.get(ip, 0) + 1
        try:
            decision = await self.accounts.authorize(token, "access")
        except AccountUnavailable:
            # Not the caller's fault: not counted as an authentication failure.
            raise ApiError(503, "auth_unavailable",
                           "Vérification du jeton momentanément impossible. Réessaie dans quelques secondes.",
                           {"Retry-After": "10"}) from None
        finally:
            left = self._in_flight.get(ip, 1) - 1
            if left > 0:
                self._in_flight[ip] = left
            else:
                self._in_flight.pop(ip, None)
        if not decision.get("allow"):
            reason = decision.get("reason")
            if reason == "user_suspended":
                raise ApiError(403, "account_suspended", "Ce compte est suspendu.")
            self.auth_failures.hit(ip)
            raise unauthorized(str(decision.get("message") or UNAUTHORIZED_DETAIL))
        user_id = str(decision.get("user_id"))
        key_id = str(decision.get("key_id"))
        limits = decision.get("limits") or {}
        daily, remaining = limits.get("daily"), decision.get("remaining_today")
        return Principal(kind="user", label=f"u:{key_id[:8]}", user_id=user_id, key_id=key_id,
                         max_active=int(limits.get("max_active") or 1),
                         via_bot=decision.get("key_kind") in ("discord", "outils"),
                         daily_limit=int(daily) if isinstance(daily, int) and not isinstance(daily, bool) else None,
                         remaining_today=int(remaining) if isinstance(remaining, int)
                         and not isinstance(remaining, bool) else None)

    def prune(self) -> None:
        for limiter in (self.heavy, self.light, self.auth_failures):
            limiter.prune()
        if self.accounts is not None:
            self.accounts.prune()
