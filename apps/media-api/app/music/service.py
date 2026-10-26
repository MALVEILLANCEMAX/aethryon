"""AETHRYON Music: registry of connectors, link detection, analysis cache, imports, playlist matching."""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

from ..errors import ApiError
from .base import Connector, Ctx, Ref, TtlCache
from .catalogues import Apple, Deezer, SoundCloud, Spotify
from .imports import MusicImports, MusicJob
from .matching import MAX_CANDIDATS, MAX_PISTES, Candidat, match
from .model import Fiche, ext_of
from .sources import Commons, DirectFile, InternetArchive, Podcast
from .web import Web

if TYPE_CHECKING:
    from ..config import Settings
    from ..userkeys import Principal

# Services recognised but deliberately NOT supported (commercial catalogues without an authorised path).
UNSUPPORTED = {
    "music.youtube.com": "YouTube Music", "youtube.com": "YouTube", "youtu.be": "YouTube", "tidal.com": "Tidal",
    "qobuz.com": "Qobuz", "bandcamp.com": "Bandcamp", "music.amazon.com": "Amazon Music",
    "music.amazon.fr": "Amazon Music", "audiomack.com": "Audiomack", "mixcloud.com": "Mixcloud",
    "napster.com": "Napster", "anghami.com": "Anghami", "boomplay.com": "Boomplay",
}
FEED_HINT = re.compile(r"(\.rss|\.xml|/rss/?|/feed/?|/podcast/?|/feeds?/)$|/feed\b|/rss\b", re.I)


class MusicService:
    def __init__(self, settings: Settings, cloud_sink: Callable[[Any], Any] | None = None) -> None:
        self.settings = settings
        self.web = Web(settings.music_user_agent, settings.music_allow_local_sources)
        self.ctx = Ctx(settings, self.web)
        self.podcast = Podcast(self.ctx)
        self.direct = DirectFile(self.ctx)
        self.spotify = Spotify(self.ctx)
        self.apple = Apple(self.ctx, self.podcast)
        self.connectors: list[Connector] = [self.spotify, self.apple, SoundCloud(self.ctx), Deezer(self.ctx),
                                            InternetArchive(self.ctx), Commons(self.ctx), self.podcast, self.direct]
        self.by_id = {c.id: c for c in self.connectors}
        self.cache = TtlCache(3600, 512)
        self.imports = MusicImports(settings, self.web, cloud_sink)

    # ---- detection ------------------------------------------------------------------------------------------

    def detect(self, url: Any, kind: Any = None) -> tuple[Connector, Ref]:
        if not isinstance(url, str) or not url.strip():
            raise ApiError(400, "lien_invalide", "Colle un lien (Spotify, Apple Music, SoundCloud, Deezer, Internet "
                                                 "Archive, Wikimedia Commons, flux de podcast ou fichier audio).")
        url = url.strip()
        if len(url) > 2048 or any(ord(c) < 33 for c in url):
            raise ApiError(400, "lien_invalide", "Lien invalide (trop long ou caractères interdits).")
        if kind is not None and kind not in ("podcast", "fichier"):
            raise ApiError(400, "type_invalide", "Type invalide : « podcast » ou « fichier ».")
        if url.lower().startswith("spotify:"):
            ref = Spotify.parse_uri(url)
            if ref is None:
                raise ApiError(400, "lien_invalide", "Identifiant Spotify invalide (spotify:track:…).")
            return self.spotify, ref
        try:
            parts = urlsplit(url)
            parts.port  # noqa: B018 - raises on an invalid port
        except ValueError:
            raise ApiError(400, "lien_invalide", "Lien illisible.") from None
        host = (parts.hostname or "").lower().rstrip(".")
        if parts.scheme.lower() not in ("http", "https") or not host or "." not in host:
            raise ApiError(400, "lien_invalide", "Lien invalide : une adresse complète https://… est attendue.")
        if parts.username or parts.password:
            raise ApiError(400, "lien_invalide", "Lien invalide (identifiants dans l'adresse).")
        if kind == "podcast":
            return self.podcast, self.podcast.parse(url, parts)
        if kind == "fichier":
            return self.direct, self.direct.parse(url, parts)
        for c in self.connectors:
            if c.recognizes(host):
                return c, c.parse(url, parts)
        bare = host[4:] if host.startswith("www.") else host
        if bare in UNSUPPORTED or bare.split(".", 1)[-1] in ("bandcamp.com",):
            name = UNSUPPORTED.get(bare, "Ce service")
            raise ApiError(400, "plateforme_non_prise_en_charge",
                           f"{name} n'est pas une source d'AETHRYON Music : catalogue commercial sans moyen autorisé "
                           "d'import. Rien n'est téléchargé depuis ce service.")
        if ext_of(parts.path):
            return self.direct, self.direct.parse(url, parts)
        if FEED_HINT.search(parts.path) or host.startswith(("feeds.", "feed.", "rss.")):
            return self.podcast, self.podcast.parse(url, parts)
        raise ApiError(400, "plateforme_inconnue",
                       "Plateforme non prise en charge. Sources reconnues : Spotify, Apple Music, SoundCloud, Deezer "
                       "(métadonnées et lecteurs officiels), Internet Archive, Wikimedia Commons, flux de podcast et "
                       "fichiers audio directs (imports). Pour un flux RSS ou un fichier, précise « type ».")

    # ---- operations -----------------------------------------------------------------------------------------

    async def analyse(self, url: Any, kind: Any = None) -> Fiche:
        connector, ref = self.detect(url, kind)
        key = f"{connector.id}|{ref.type}|{ref.url}"
        hit = self.cache.get(key)
        if hit is not None:
            return hit
        fiche = await connector.analyse(ref)
        self.cache.put(key, fiche)
        return fiche

    async def search(self, q: Any, source: Any) -> list[Fiche]:
        if not isinstance(q, str) or not q.strip() or len(q) > 200:
            raise ApiError(400, "recherche_vide", "Recherche vide ou trop longue (200 caractères au plus).")
        connector = self.by_id.get(str(source or ""))
        if connector is None or connector.id in ("podcast", "fichier", "soundcloud", "deezer"):
            raise ApiError(400, "source_invalide", "Source de recherche : spotify, apple, archive ou commons.")
        return await connector.search(q.strip())

    async def start_import(self, principal: Principal, body: dict[str, Any]) -> MusicJob:
        connector, ref = self.detect(body.get("url"), body.get("type"))
        if connector is self.apple and ref.type == "podcast":
            fiche = await self.apple.analyse(ref)  # the show's public RSS feed (Apple Podcasts directory)
            connector, ref = self.podcast, self.podcast.parse(fiche.url, urlsplit(fiche.url))
        if connector.famille != "source_libre":
            raise ApiError(403, "telechargement_non_autorise", connector.no_download_text())
        plan = await connector.plan_import(ref, body)
        return self.imports.create(principal, plan)

    def correspondances(self, pistes: Any, candidats: Any) -> list[dict[str, Any]]:
        if not isinstance(pistes, list) or not pistes or len(pistes) > MAX_PISTES:
            raise ApiError(400, "pistes_invalides", f"« pistes » : liste de 1 à {MAX_PISTES} titres attendue.")
        clean = []
        for p in pistes:
            if not isinstance(p, dict):
                raise ApiError(400, "pistes_invalides", "Chaque piste est un objet {titre, artistes, dureeS, isrc}.")
            arts = p.get("artistes") if isinstance(p.get("artistes"), list) else []
            dur = p.get("dureeS")
            isrc = p.get("isrc") if isinstance(p.get("isrc"), str) and re.fullmatch(r"[A-Za-z0-9]{12}", p["isrc"]) else None
            clean.append({"titre": str(p.get("titre") or "")[:300] or None,
                          "artistes": [str(a)[:200] for a in arts if isinstance(a, str)][:10],
                          "album": str(p.get("album") or "")[:300] or None,
                          "dureeS": float(dur) if isinstance(dur, (int, float)) and 0 < dur < 1e6 else None,
                          "isrc": isrc.upper() if isrc else None, "url": p.get("url") if isinstance(p.get("url"), str) else None})
        return match(clean, self._candidats(candidats))

    def _candidats(self, raw: Any) -> list[Candidat]:
        if raw is None:
            return []
        if not isinstance(raw, list) or len(raw) > MAX_CANDIDATS:
            raise ApiError(400, "candidats_invalides", f"« candidats » : liste de {MAX_CANDIDATS} fichiers au plus "
                                                       "(ta bibliothèque et ton cloud).")
        return [c for c in (Candidat.parse(x) for x in raw) if c is not None]

    async def synchroniser(self, url: Any, candidats: Any) -> dict[str, Any]:
        connector, ref = self.detect(url)
        if connector is self.spotify and ref.type == "playlist":
            fiche, pistes = await self.spotify.playlist_items(ref)
        else:
            fiche = await connector.analyse(ref)
            pistes = fiche.pistes
            if not pistes:
                raise ApiError(409, "liste_indisponible", "Liste des titres indisponible pour ce lien. " +
                               " ".join(fiche.manque))
        rows = self.correspondances([p.to_json() for p in pistes], candidats)
        sure = sum(1 for r in rows if r["correspondance"] and r["correspondance"]["confiance"] == "sure")
        prob = sum(1 for r in rows if r["correspondance"] and r["correspondance"]["confiance"] == "probable")
        return {
            "playlist": {"source": fiche.connecteur, "url": fiche.url, "titre": fiche.titre,
                         "proprietaire": fiche.artistes[0] if fiche.artistes else None, "pochette": fiche.pochette,
                         "snapshot": fiche.snapshot, "total": fiche.pistes_total or len(pistes), "pistes": rows},
            "stats": {"titres": len(rows), "correspondancesSures": sure, "correspondancesProbables": prob,
                      "sansFichier": len(rows) - sure - prob},
            "telechargements": 0,
            "note": "Playlist AETHRYON reliée aux fichiers que tu possèdes déjà ; aucun titre n'est téléchargé. Le "
                    "Desktop garde la playlist et relance la synchronisation (instantané « snapshot ») ; les "
                    "métadonnées du service sont relues à chaque synchronisation, pas gardées indéfiniment.",
        }

    def connecteurs(self) -> list[dict[str, Any]]:
        return [c.info().to_json() for c in self.connectors]
