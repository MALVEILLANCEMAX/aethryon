"""Per-user API keys (YouTube Converter 2.0), validated by the internal account service.

Only used when USER_KEYS_ENABLED=true. Keys start with USER_KEY_PREFIX ("ytc_"); every other token
keeps the original admin path (app/tokens.py). The raw key never leaves this module except in the
body of the internal HTTP call, and is never logged: the decision cache is keyed by sha256(key).

The account service answers:
- POST /internal/v1/authorize {"key", "action": "access"|"create_job", "fmt"?, "platform"?}
  -> {"allow": true, "user_id", "key_id", "limits": {...}, "usage_id"?} | {"allow": false, "reason", "message"}
- POST /internal/v1/usage/<usage_id> {"state", "job_id"?, "error_code"?, "cause"?, "platform"?, "size_bytes"?}
  (job_id: ytapi job of this usage unit; cause: cleaned technical cause of a failure, <= 300 chars, no URL)

The same internal token authenticates account's calls to ytapi's own internal API (app/internal.py).
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

log = logging.getLogger("ytapi.userkeys")
# account's value for "no daily limit" (account/src/usage.ts UNLIMITED_DAILY).
UNLIMITED_DAILY = 1_000_000


@dataclass(frozen=True)
class Principal:
    """Who is calling: an admin token (label from the tokens file) or a user key."""

    kind: Literal["admin", "user"]
    label: str
    user_id: str | None = None
    key_id: str | None = None
    max_active: int = 1
    # Key issued by account for one user to a relay of AETHRYON (key_kind "discord": the Discord bot; "outils": the
    # site's Tools, relayed by account): every user arrives from the relay's single address, so only the per-user
    # limits apply to it (never the per-IP ones; account limits each visitor's address itself).
    # Every other kind ("shortcut", "extension", "premiere": the Premiere Pro panel) is an ordinary user key: per-IP AND
    # per-user limits, same quota as the account.
    via_bot: bool = False
    # Daily quota of the account and units left today, as account answered the "access" check (GET /limites).
    daily_limit: int | None = None
    remaining_today: int | None = None

    @property
    def is_user(self) -> bool:
        return self.kind == "user"


class AccountUnavailable(Exception):
    """The account service could not be reached or answered with an error."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:  # never follow: the token would travel
        return None


# Internal calls ignore HTTP(S)_PROXY and never follow redirects: the internal token and the user keys
# only ever go to ACCOUNT_INTERNAL_URL.
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
NEGATIVE_CACHE_S = 30.0


class AccountClient:
    """Small blocking-HTTP client run in a dedicated, bounded thread pool (stdlib only), with an
    optional cache of positive 'access' decisions (USER_KEY_CACHE_S, 0 by default: revocation is
    immediate) and a 30 s cache of refusals (floods of fake keys)."""

    def __init__(self, base_url: str, token_file: Path, timeout_s: float, cache_s: float) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self.cache_s = cache_s
        self._token = token_file.read_text(encoding="utf-8").strip()
        if len(self._token) < 32:
            raise ValueError("account internal token too short")
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._negative: dict[str, tuple[float, str]] = {}  # refus récents : (instant, message d'account)
        self._pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="account")

    async def _run(self, fn: Any, *args: Any) -> Any:
        return await asyncio.get_running_loop().run_in_executor(self._pool, fn, *args)

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        data = json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + path,
            data=data,
            method="POST",
            headers={"Content-Type": "application/json", "X-Internal-Token": self._token},
        )
        try:
            with _OPENER.open(request, timeout=self.timeout_s) as response:  # internal URL only
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 404 and path.startswith("/internal/v1/usage/"):
                return {"ok": False, "status": 404}
            raise AccountUnavailable(f"HTTP {exc.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            raise AccountUnavailable(type(exc).__name__) from None

    async def authorize(self, key: str, action: Literal["access", "create_job"], fmt: str | None = None,
                        platform: str | None = None) -> dict[str, Any]:
        """Decision for this key. Only positive 'access' decisions are cached (a few seconds)."""
        cache_key = hashlib.sha256(key.encode("utf-8")).hexdigest()
        now = time.monotonic()
        refused = self._negative.get(cache_key)
        if refused is not None and now - refused[0] < NEGATIVE_CACHE_S:
            # même message que la première réponse d'account (ex. « …expiré… »), sans le rappeler
            return {"allow": False, "reason": "invalid_key", "message": refused[1]}
        if action == "access" and self.cache_s > 0:
            hit = self._cache.get(cache_key)
            if hit is not None and now - hit[0] < self.cache_s:
                return hit[1]
        body: dict[str, Any] = {"key": key, "action": action}
        if fmt is not None:
            body["fmt"] = fmt
        if platform is not None:
            body["platform"] = platform
        decision = await self._run(self._post, "/internal/v1/authorize", body)
        if not isinstance(decision, dict) or "allow" not in decision:
            raise AccountUnavailable("bad answer")
        if not decision.get("allow") and decision.get("reason") in ("invalid_key", "expired"):
            self._negative[cache_key] = (now, str(decision.get("message") or "Jeton absent ou invalide."))
        if action == "access":
            if decision.get("allow") and self.cache_s > 0:
                self._cache[cache_key] = (now, decision)
            else:
                self._cache.pop(cache_key, None)
        return decision

    def token_matches(self, candidate: str | None) -> bool:
        """Constant-time check of a token presented to ytapi's internal API against the shared internal
        token (the one sent to account). Digests first: the comparison never depends on the length."""
        if not candidate:
            return False
        got = hashlib.sha256(candidate.encode("utf-8")).digest()
        return hmac.compare_digest(got, hashlib.sha256(self._token.encode("utf-8")).digest())

    def forget(self, key: str) -> None:
        self._cache.pop(hashlib.sha256(key.encode("utf-8")).hexdigest(), None)

    def prune(self) -> None:
        now = time.monotonic()
        for k, (at, _) in list(self._cache.items()):
            if now - at >= self.cache_s:
                del self._cache[k]
        for k, (at, _) in list(self._negative.items()):
            if now - at >= NEGATIVE_CACHE_S:
                del self._negative[k]

    def _call(self, path: str, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        """POST to the internal API of account; (status, JSON body) for any HTTP answer, AccountUnavailable otherwise."""
        request = urllib.request.Request(
            self.base_url + path, data=json.dumps(body).encode("utf-8"), method="POST",
            headers={"Content-Type": "application/json", "X-Internal-Token": self._token},
        )
        try:
            with _OPENER.open(request, timeout=max(self.timeout_s, 15.0)) as response:  # internal URL only
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                data = json.loads(exc.read().decode("utf-8"))
            except (ValueError, OSError):
                data = {}
            return exc.code, data if isinstance(data, dict) else {}
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            raise AccountUnavailable(type(exc).__name__) from None

    async def call(self, path: str, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        """Internal call that returns refusals instead of raising (AETHRYON Cloud: /internal/v1/cloud/*)."""
        return await self._run(self._call, path, body)

    async def report_usage(self, usage_id: str, payload: dict[str, Any]) -> None:
        await self._run(self._post, f"/internal/v1/usage/{usage_id}", payload)


CAUSE_MAX = 300
# Defence in depth: causes are already cleaned by the worker (app.worker.error_cause), account cleans
# them again before storing; anything still looking like a URL is masked here as well. Matches start at
# token boundaries only (lookbehind): linear time even on a long run of letters.
_CAUSE_URL_RE = re.compile(r"(?<![a-z0-9+.-])(?:[a-z][a-z0-9+.-]*://|www\.)[^\s'\"<>]*", re.I)


def clean_cause(cause: object) -> str | None:
    """Cause sent with an 'error' usage event: one line, URLs masked, at most CAUSE_MAX characters."""
    if not isinstance(cause, str):
        return None
    text = _CAUSE_URL_RE.sub("<url>", " ".join(cause[:4 * CAUSE_MAX].split()))[:CAUSE_MAX]
    return text or None


class UsageEvents:
    """Fire-and-forget queue of usage updates (3 attempts each). Never carries URL, title or file name."""

    ALLOWED = {"state", "job_id", "error_code", "cause", "platform", "size_bytes"}

    def __init__(self, client: AccountClient) -> None:
        self.client = client
        self.queue: asyncio.Queue[tuple[str, dict[str, Any]]] = asyncio.Queue(maxsize=10_000)
        self._task: asyncio.Task[None] | None = None
        self.sent = 0
        self.dropped = 0

    def emit(self, usage_id: str | None, state: str, **fields: Any) -> None:
        if not usage_id:
            return
        if "cause" in fields:
            fields["cause"] = clean_cause(fields["cause"])
        payload = {"state": state, **{k: v for k, v in fields.items() if k in self.ALLOWED and v is not None}}
        try:
            self.queue.put_nowait((usage_id, payload))
        except asyncio.QueueFull:
            self.dropped += 1
            log.warning("usage event dropped (queue full)", extra={"state": state})

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="usage-events")

    async def _loop(self) -> None:
        while True:
            usage_id, payload = await self.queue.get()
            try:
                for attempt, delay in enumerate((0.5, 2.0, 5.0), start=1):
                    try:
                        await self.client.report_usage(usage_id, payload)
                        self.sent += 1
                        break
                    except AccountUnavailable as exc:
                        if attempt == 3:
                            self.dropped += 1
                            log.warning("usage event not delivered", extra={"state": payload["state"], "reason": str(exc)})
                        else:
                            await asyncio.sleep(delay)
            finally:
                self.queue.task_done()

    async def flush(self, timeout_s: float = 3.0) -> None:
        try:
            await asyncio.wait_for(self.queue.join(), timeout=timeout_s)
        except TimeoutError:
            pass

    async def stop(self) -> None:
        await self.flush()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
