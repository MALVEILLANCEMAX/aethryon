"""Connector interface, shared context and helpers."""

from __future__ import annotations

import asyncio
import html
import re
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any
from urllib.parse import SplitResult

from ..errors import ApiError
from ..security import SlidingWindowLimiter
from .licences import Licence
from .model import Fiche, Fichier, InfoConnecteur
from .web import HostPolicy, Web

if TYPE_CHECKING:
    from ..config import Settings


@dataclass(frozen=True)
class Ref:
    """A link understood by a connector: kind of object and its id at the source, canonical URL."""

    connecteur: str
    type: str
    id: str
    url: str
    extra: tuple[tuple[str, str], ...] = ()

    def get(self, key: str, default: str | None = None) -> str | None:
        return dict(self.extra).get(key, default)


@dataclass
class ImportPlan:
    """Everything an import job needs, decided by the connector from the source's OFFICIAL answer (never from a URL
    or a size sent by the client)."""

    connecteur: str
    fichier: Fichier
    policy: HostPolicy  # hosts the download (and its redirects) may reach
    licence: Licence
    titre: str
    artistes: list[str] = field(default_factory=list)
    album: str | None = None
    date: str | None = None
    attribution: str | None = None
    source_url: str = ""  # official page of the work
    pochette: str | None = None
    isrc: str | None = None
    attestation: bool = False  # the user declared his rights (direct files)

    def musique(self) -> dict[str, Any]:
        """Record kept apart from the audio (account: ytc_cloud_objet.meta.musique): survives the cloud expiration."""
        return {
            "connecteur": self.connecteur, "titre": self.titre[:300], "artistes": [a[:200] for a in self.artistes[:10]],
            "album": (self.album or "")[:300] or None, "date": (self.date or "")[:40] or None,
            "isrc": self.isrc, "licence": {"code": self.licence.code, "nom": self.licence.nom[:200],
                                           "url": self.licence.url},
            "attribution": (self.attribution or "")[:600] or None, "sourceUrl": self.source_url[:1000],
            "pochetteUrl": self.pochette if self.pochette and self.pochette.startswith("https://") else None,
            "attestation": self.attestation,
        }


class Ctx:
    """What every connector shares: settings, the HTTP client, rate limits per service."""

    def __init__(self, settings: Settings, web: Web) -> None:
        self.settings = settings
        self.web = web
        self._limiters: dict[str, SlidingWindowLimiter] = {}

    def throttle(self, service: str, per_minute: int) -> None:
        limiter = self._limiters.setdefault(service, SlidingWindowLimiter(per_minute, 60))
        wait = limiter.hit(service)
        if wait is not None:
            raise ApiError(429, "source_saturee",
                           f"Trop de demandes vers ce service en ce moment : réessaie dans {int(wait) + 1} s.",
                           {"Retry-After": str(int(wait) + 1)})

    async def json(self, service: str, per_minute: int, url: str, policy: HostPolicy, **kw: Any) -> tuple[int, Any]:
        self.throttle(service, per_minute)
        return await asyncio.to_thread(self.web.get_json, url, policy, **kw)


class Connector:
    id = ""
    nom = ""
    famille = "catalogue"  # "catalogue": never any download; "source_libre": downloads per licence
    conditions: list[str] = []

    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx

    @property
    def actif(self) -> bool:
        return True

    def recognizes(self, host: str) -> bool:
        raise NotImplementedError

    def parse(self, url: str, parts: SplitResult) -> Ref:
        raise NotImplementedError

    async def analyse(self, ref: Ref) -> Fiche:
        raise NotImplementedError

    def info(self) -> InfoConnecteur:
        raise NotImplementedError

    async def search(self, q: str) -> list[Fiche]:
        raise ApiError(400, "recherche_indisponible", f"Recherche non disponible pour {self.nom}.")

    async def plan_import(self, ref: Ref, body: dict[str, Any]) -> ImportPlan:
        raise ApiError(403, "telechargement_non_autorise", self.no_download_text())

    def no_download_text(self) -> str:
        return (f"{self.nom} n'autorise pas le téléchargement par une application tierce : AETHRYON Music ne "
                "télécharge rien depuis ce service (ni flux, ni extrait, ni conversion).")


def invalid_link(detail: str) -> ApiError:
    return ApiError(400, "lien_invalide", detail)


def not_found(service: str) -> ApiError:
    return ApiError(404, "introuvable", f"Contenu introuvable sur {service} (supprimé, privé ou lien erroné).")


def unavailable(service: str, status: int | None = None) -> ApiError:
    suffix = f" (réponse {status})" if status else ""
    return ApiError(503, "source_indisponible", f"{service} ne répond pas{suffix} : réessaie dans quelques minutes.",
                    {"Retry-After": "60"})


_TAG = re.compile(r"<[^>]{0,2000}>")


def text(value: Any, limit: int = 300) -> str | None:
    """Plain text from a source field (HTML stripped, entities decoded, one line)."""
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        value = ", ".join(str(v) for v in value if v)
    raw = html.unescape(_TAG.sub(" ", str(value)))
    clean = " ".join(raw.split())[:limit]
    return clean or None


def https_or_none(value: Any) -> str | None:
    if isinstance(value, str) and value.startswith("https://") and len(value) <= 2000 and " " not in value:
        return value
    return None


def number(value: Any) -> float | None:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n >= 0 and n == n and n < 1e9 else None


def seconds(value: Any) -> float | None:
    """'3:25', '01:02:03', '205', '205.3' -> seconds."""
    if isinstance(value, (int, float)):
        return number(value)
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if re.fullmatch(r"\d+(\.\d+)?", raw):
        return number(raw)
    m = re.fullmatch(r"(?:(\d+):)?(\d{1,2}):(\d{1,2})(\.\d+)?", raw)
    if not m:
        return None
    h, mi, s = int(m.group(1) or 0), int(m.group(2)), int(m.group(3))
    return float(h * 3600 + mi * 60 + s)


class TtlCache:
    def __init__(self, ttl_s: float, size: int) -> None:
        self.ttl_s, self.size = ttl_s, size
        self._items: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any:
        hit = self._items.get(key)
        if hit is None or time.monotonic() - hit[0] > self.ttl_s:
            self._items.pop(key, None)
            return None
        return hit[1]

    def put(self, key: str, value: Any) -> None:
        if len(self._items) >= self.size:
            for k in list(self._items)[: max(1, self.size // 4)]:
                self._items.pop(k, None)
        self._items[key] = (time.monotonic(), value)

    def prune(self) -> None:
        now = time.monotonic()
        for k, (at, _) in list(self._items.items()):
            if now - at > self.ttl_s:
                del self._items[k]
