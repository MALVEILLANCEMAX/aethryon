"""Per-platform health, YouTube circuit breaker and YouTube request limiter.

- State per platform (GET /status): ok / bot_check / upstream_rate_limited / unknown, since when,
  last success, last error code.
- Circuit breaker (YouTube only): after a bot check or a rate limit, YouTube is not contacted
  for YT_COOLDOWN_MIN minutes; requests fail fast with 503 + Retry-After instead of making the
  block worse. Consecutive blocks (no success in between) double the pause, up to
  YT_COOLDOWN_MAX_MIN: a lasting block is probed by one real request every hour at most, never
  by an automatic retry loop. The first success closes the breaker and resets the backoff.
- Circuit breaker of the other platforms (registry, app/plateformes.json): after `breaker_failures` consecutive
  failures of the platform itself (BREAKER_CODES: errors that are not about one given video), the platform is paused
  `breaker_min` minutes; requests fail fast with 503 platform_unavailable + Retry-After (clear French message).
  After the pause, the next request is the probe: a success closes the breaker, a failure reopens it at once for
  twice as long (up to `breaker_max_min`). Off when breaker_failures is 0.
- Limiter (YouTube only): at most YT_CONCURRENCY extractions at a time and YT_MIN_INTERVAL_S
  seconds between two extraction starts. The slot is released as soon as the worker reports
  that extraction is over (the media download itself hits the CDN, not the YouTube API).
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from .errors import ApiError
from .registre import registre

log = logging.getLogger("ytapi.platforms")

PLATFORMS = ("youtube", "tiktok", "twitter")
BLOCKING_CODES = {"bot_check", "upstream_rate_limited"}
# Failures of the platform itself (never of one video: private, removed, login, too long... do not count).
BREAKER_CODES = BLOCKING_CODES | {"upstream_unavailable", "upstream_timeout", "extractor_broken", "upstream_error"}
PAUSED_STATE = "platform_unavailable"
CancelCheck = Callable[[], Awaitable[bool]]


def _iso(ts: float | None) -> str | None:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)) if ts else None


@dataclass
class PlatformState:
    state: str = "unknown"
    since: float | None = None
    last_success: float | None = None
    last_error: str | None = None
    last_error_at: float | None = None
    cooldown_until: float | None = None  # wall clock
    blocks: int = 0  # consecutive blocks without a success in between (YouTube backoff, other platforms' pauses)
    failures: int = 0  # consecutive platform failures (other platforms' breaker)

    def public(self, now: float) -> dict[str, Any]:
        cooling = bool(self.cooldown_until and self.cooldown_until > now)
        return {
            "state": self.state,
            "since": _iso(self.since),
            "last_success": _iso(self.last_success),
            "last_error": self.last_error,
            "last_error_at": _iso(self.last_error_at),
            "cooldown_until": _iso(self.cooldown_until) if cooling else None,
            "consecutive_blocks": self.blocks,
            "consecutive_failures": self.failures,
        }


class Gate:
    """Held while a YouTube extraction runs; release() is idempotent."""

    def __init__(self, sem: asyncio.Semaphore | None) -> None:
        self._sem = sem
        self.released = sem is None

    def release(self) -> None:
        if not self.released and self._sem is not None:
            self.released = True
            self._sem.release()


def _name(platform: str) -> str:
    found = registre().get(platform)
    return found.nom if found is not None else platform


def _cooldown_detail(code: str, wait_s: int) -> str:
    minutes = max(1, round(wait_s / 60))
    if code == "bot_check":
        return (f"YouTube demande de prouver qu'on n'est pas un robot (IP du serveur signalée). "
                f"Pause automatique, réessayez dans ~{minutes} min ; des cookies règlent souvent le problème.")
    return f"YouTube limite le serveur. Pause automatique, réessayez dans ~{minutes} min."


class PlatformMonitor:
    def __init__(self, cooldown_min: int, concurrency: int, min_interval_s: float,
                 cooldown_max_min: int | None = None, platforms: tuple[str, ...] = PLATFORMS,
                 breaker_failures: int = 0, breaker_min: int = 10, breaker_max_min: int = 60) -> None:
        self.cooldown_s = cooldown_min * 60
        self.cooldown_max_s = max(self.cooldown_s, (cooldown_max_min if cooldown_max_min is not None else cooldown_min) * 60)
        self.min_interval_s = min_interval_s
        self.breaker_failures = breaker_failures
        self.breaker_s = breaker_min * 60
        self.breaker_max_s = max(self.breaker_s, breaker_max_min * 60)
        self.states = {p: PlatformState() for p in platforms}
        self._yt_sem = asyncio.Semaphore(concurrency)
        self._yt_last_start = 0.0  # monotonic

    # --- circuit breaker -----------------------------------------------------------------------

    def check_available(self, platform: str) -> None:
        """Raise 503 at once while YouTube is cooling down after a bot check / rate limit, or while another platform
        is paused by its breaker (platform_unavailable)."""
        if platform != "youtube":
            other = self.states.get(platform)
            now = time.time()
            if other is not None and other.cooldown_until and other.cooldown_until > now:
                from .urls import platform_unavailable_error

                wait = int(other.cooldown_until - now) + 1
                log.info("platform paused: request refused", extra={"platform": platform, "retry_after_s": wait})
                raise platform_unavailable_error(_name(platform), wait)
            return
        state = self.states["youtube"]
        now = time.time()
        if state.cooldown_until and state.cooldown_until > now:
            wait = int(state.cooldown_until - now) + 1
            code = state.state if state.state in BLOCKING_CODES else "upstream_rate_limited"
            log.info("youtube paused: request refused", extra={"reason": code, "retry_after_s": wait})
            raise ApiError(503, code, _cooldown_detail(code, wait), {"Retry-After": str(wait)})

    def cooldown_for(self, blocks: int) -> int:
        """Pause after the `blocks`-th consecutive block: base, x2, x4... capped at the maximum."""
        return int(min(self.cooldown_s * 2 ** max(0, min(blocks - 1, 16)), self.cooldown_max_s))

    def record_success(self, platform: str, started_at: float | None = None) -> None:
        """`started_at`: when the task began. A task that started before the last block (e.g. a
        CDN download that outlived another request's bot check) must not close the breaker."""
        state = self.states.setdefault(platform, PlatformState())
        now = time.time()
        if (started_at is not None and state.state in BLOCKING_CODES and state.last_error_at
                and started_at < state.last_error_at):
            state.last_success = now
            return
        if platform != "youtube" and state.state == PAUSED_STATE:
            log.warning("platform circuit breaker closed", extra={"platform": platform, "consecutive_blocks": state.blocks})
        if platform == "youtube" and state.state in BLOCKING_CODES:
            log.warning("youtube circuit breaker closed", extra={
                "reason": state.state, "blocked_s": int(now - state.since) if state.since else None,
                "consecutive_blocks": state.blocks})
        if state.state != "ok":
            state.since = now
        state.state, state.last_success, state.cooldown_until, state.blocks = "ok", now, None, 0
        state.failures = 0

    def record_error(self, platform: str, error: ApiError, started_at: float | None = None,
                     cause: str | None = None) -> ApiError:
        """Update state; for YouTube blocks, open the breaker and add Retry-After. Returns the error.

        `started_at`: a task that began before the block that opened the current pause (concurrent
        extraction) belongs to the same episode: it neither extends the pause nor counts as a new
        block. `cause`: cleaned yt-dlp message (no URL), for the log line only."""
        state = self.states.setdefault(platform, PlatformState())
        now = time.time()
        if platform != "youtube":
            return self._record_other(platform, state, error, now, started_at, cause)
        if error.code in BLOCKING_CODES and platform == "youtube" and self.cooldown_s:
            same_episode = (started_at is not None and state.cooldown_until is not None and state.cooldown_until > now
                            and state.last_error_at is not None and started_at < state.last_error_at)
            if same_episode:
                wait = int(state.cooldown_until - now) + 1
                return ApiError(error.status, error.code, _cooldown_detail(error.code, wait),
                                {**error.headers, "Retry-After": str(wait)})
        state.last_error, state.last_error_at = error.code, now
        if error.code in BLOCKING_CODES:
            if state.state not in BLOCKING_CODES:
                state.since = now
            state.state = error.code
            if platform == "youtube" and self.cooldown_s:
                state.blocks += 1
                cooldown = self.cooldown_for(state.blocks)
                state.cooldown_until = now + cooldown
                log.warning("youtube circuit breaker open", extra={
                    "reason": error.code, "cooldown_s": cooldown, "consecutive_blocks": state.blocks,
                    "until": _iso(state.cooldown_until), "cause": cause})
                error = ApiError(error.status, error.code, _cooldown_detail(error.code, cooldown),
                                 {**error.headers, "Retry-After": str(cooldown)})
        return error

    def _record_other(self, platform: str, state: PlatformState, error: ApiError, now: float,
                      started_at: float | None, cause: str | None) -> ApiError:
        """Breaker of the platforms other than YouTube (see the module docstring)."""
        if error.code not in BREAKER_CODES:
            state.last_error, state.last_error_at = error.code, now
            return error
        opened_at = state.since if state.state == PAUSED_STATE else None
        if opened_at is not None and started_at is not None and started_at < opened_at:
            return error  # began before the pause: same episode, counted once
        state.last_error, state.last_error_at = error.code, now
        if error.code in BLOCKING_CODES and state.state != PAUSED_STATE:
            if state.state not in BLOCKING_CODES:
                state.since = now
            state.state = error.code
        state.failures += 1
        if self.breaker_failures and state.failures >= self.breaker_failures:
            state.blocks += 1
            pause = int(min(self.breaker_s * 2 ** max(0, min(state.blocks - 1, 16)), self.breaker_max_s))
            state.state, state.since, state.cooldown_until = PAUSED_STATE, now, now + pause
            log.warning("platform circuit breaker open", extra={
                "platform": platform, "reason": error.code, "cooldown_s": pause, "consecutive_blocks": state.blocks,
                "until": _iso(state.cooldown_until), "cause": cause})
        return error

    # --- limiter -------------------------------------------------------------------------------

    async def acquire(self, platform: str, cancel_check: CancelCheck | None = None) -> Gate:
        """Gate for one task. Non-YouTube platforms pass straight through."""
        if platform != "youtube":
            return Gate(None)
        self.check_available(platform)
        from .runner import _acquire  # FIFO wait with cancellation (shared helper)

        await _acquire(self._yt_sem, cancel_check)
        gate = Gate(self._yt_sem)
        try:
            # Reserve the start time before sleeping, so that concurrent waiters (YT_CONCURRENCY > 1)
            # are spaced out too. Callers take the gate right before extracting (after their slot).
            now = time.monotonic()
            start = max(now, self._yt_last_start + self.min_interval_s)
            self._yt_last_start = start
            if start > now:
                await asyncio.sleep(start - now)
            # The breaker may have opened while we were waiting.
            self.check_available(platform)
        except BaseException:
            gate.release()
            raise
        return gate

    def public(self) -> dict[str, Any]:
        now = time.time()
        return {name: state.public(now) for name, state in self.states.items()}
