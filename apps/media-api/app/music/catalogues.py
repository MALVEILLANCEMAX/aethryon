"""Commercial catalogues: Spotify, Apple Music, SoundCloud, Deezer. METADATA AND OFFICIAL PLAYERS ONLY.

None of these connectors has (or can get) the AuthorizedDownload or Import capability: their terms forbid copying
or capturing the audio (MUSIC-RAPPORT.md, ARCHITECTURE.md §1.2), and app/music/web.py refuses every download from
their hosts and CDNs anyway. Metadata comes from the official APIs only:
- Spotify: Web API with the OWNER's app credentials (client credentials; his account's refresh token for the items
  of his own playlists), else the public oEmbed endpoint (title + cover only);
- Apple Music: public iTunes Lookup / Search API (no key), 30 s previews streamed by the client from Apple;
- SoundCloud: public oEmbed + official widget (the API proper needs a registered app);
- Deezer: link + official widget; the API (non-commercial use only) is off unless MUSIC_DEEZER_API=true.
"""

from __future__ import annotations

import asyncio
import base64
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import SplitResult, parse_qs, quote, urlencode

from ..errors import ApiError
from .base import Connector, Ctx, Ref, https_or_none, invalid_link, not_found, number, text, unavailable
from .model import (ACTION_ENREGISTRER, Fiche, Identifiant, InfoConnecteur, Piste, action_lecteur, action_ouvrir,
                    ajouter_apercu)
from .web import HostPolicy

SPOTIFY_ID = re.compile(r"^[A-Za-z0-9]{22}$")
SPOTIFY_TYPES = {"track": "titre", "album": "album", "playlist": "playlist", "artist": "artiste",
                 "episode": "episode", "show": "podcast"}
NO_DOWNLOAD_SPOTIFY = ("Aucun téléchargement : les conditions développeur de Spotify interdisent la copie et la "
                       "capture des flux (« stream ripping », Developer Terms IV.2.2.3).")


class SpotifyAuth:
    """Tokens of the OWNER's Spotify developer app (files 0400, deploy/music-secrets.sh). Never spotDL's or anyone
    else's credentials. Client-credentials token cached until 60 s before its expiry; a refusal (401/400
    invalid_client) is remembered 10 min (metadata then falls back to oEmbed)."""

    TOKEN_URL = "https://accounts.spotify.com/api/token"
    POLICY = HostPolicy.api("accounts.spotify.com", label="Spotify (jetons)")

    def __init__(self, ctx: Ctx, id_file: Path | None, secret_file: Path | None, refresh_file: Path | None) -> None:
        self.ctx = ctx
        self.id_file, self.secret_file, self.refresh_file = id_file, secret_file, refresh_file
        self._app: tuple[float, str] | None = None
        self._user: tuple[float, str] | None = None
        self.refused_until = 0.0
        self.user_refused_until = 0.0
        self.rotated_refresh: str | None = None  # Spotify sent a new refresh token: kept in memory (see log)

    @staticmethod
    def _read(path: Path | None) -> str | None:
        if path is None:
            return None
        try:
            value = path.read_text(encoding="utf-8").strip()
        except OSError:
            return None
        return value or None

    def configured(self) -> bool:
        return bool(self._read(self.id_file) and self._read(self.secret_file))

    def user_configured(self) -> bool:
        return self.configured() and bool(self.rotated_refresh or self._read(self.refresh_file))

    def _token(self, form: dict[str, str]) -> tuple[int, dict[str, Any]]:
        import json

        cid, secret = self._read(self.id_file), self._read(self.secret_file)
        if not cid or not secret:
            return 0, {}
        basic = base64.b64encode(f"{cid}:{secret}".encode()).decode()
        resp = self.ctx.web.request("POST", self.TOKEN_URL, self.POLICY, body=urlencode(form).encode(),
                                    headers={"Authorization": f"Basic {basic}",
                                             "Content-Type": "application/x-www-form-urlencoded"},
                                    max_bytes=64 * 1024, deadline_s=10.0, accept_status=(200,))
        try:
            data = json.loads(resp.body.decode("utf-8")) if resp.body else {}
        except ValueError:
            data = {}
        return resp.status, data if isinstance(data, dict) else {}

    def app_token(self) -> str | None:
        """Client-credentials token, None when not configured or refused (caller falls back)."""
        now = time.monotonic()
        if self._app and self._app[0] > now:
            return self._app[1]
        if now < self.refused_until or not self.configured():
            return None
        status, data = self._token({"grant_type": "client_credentials"})
        if status == 200 and isinstance(data.get("access_token"), str):
            self._app = (now + max(60, int(data.get("expires_in") or 3600) - 60), data["access_token"])
            return self._app[1]
        if status in (400, 401, 403):
            self.refused_until = now + 600
            return None
        raise unavailable("Spotify", status or None)

    def user_token(self) -> str | None:
        now = time.monotonic()
        if self._user and self._user[0] > now:
            return self._user[1]
        refresh = self.rotated_refresh or self._read(self.refresh_file)
        if not refresh or now < self.user_refused_until or not self.configured():
            return None
        status, data = self._token({"grant_type": "refresh_token", "refresh_token": refresh})
        if status == 200 and isinstance(data.get("access_token"), str):
            if isinstance(data.get("refresh_token"), str) and data["refresh_token"] != refresh:
                self.rotated_refresh = data["refresh_token"]  # never logged; re-run the authorisation script to persist
            self._user = (now + max(60, int(data.get("expires_in") or 3600) - 60), data["access_token"])
            return self._user[1]
        if status in (400, 401, 403):
            self.user_refused_until = now + 600
            return None
        raise unavailable("Spotify", status or None)


class Spotify(Connector):
    id = "spotify"
    nom = "Spotify"
    conditions = ["https://developer.spotify.com/terms", "https://developer.spotify.com/documentation/embeds/reference/oembed",
                  "https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide"]
    API = HostPolicy.api("api.spotify.com", label="Spotify Web API")
    OEMBED = HostPolicy.api("open.spotify.com", label="Spotify oEmbed")

    def __init__(self, ctx: Ctx) -> None:
        super().__init__(ctx)
        s = ctx.settings
        self.auth = SpotifyAuth(ctx, s.music_spotify_client_id_file, s.music_spotify_client_secret_file,
                                s.music_spotify_refresh_token_file)

    def recognizes(self, host: str) -> bool:
        return host in ("open.spotify.com", "play.spotify.com", "spotify.link", "spotify.app.link")

    def parse(self, url: str, parts: SplitResult) -> Ref:
        host = (parts.hostname or "").lower()
        if host in ("spotify.link", "spotify.app.link"):
            raise invalid_link("Lien court Spotify : ouvre-le, puis copie le lien complet (open.spotify.com/…).")
        segs = [s for s in parts.path.split("/") if s]
        if segs and re.fullmatch(r"intl-[a-z]{2}(-[a-z]{2})?", segs[0], re.I):
            segs = segs[1:]
        if segs[:1] == ["embed"]:
            segs = segs[1:]
        if len(segs) < 2 or segs[0] not in SPOTIFY_TYPES or not SPOTIFY_ID.match(segs[1]):
            raise invalid_link("Lien Spotify invalide : titre, album, playlist, artiste, épisode ou émission attendu "
                               "(open.spotify.com/track/…).")
        return Ref("spotify", SPOTIFY_TYPES[segs[0]], segs[1], f"https://open.spotify.com/{segs[0]}/{segs[1]}",
                   (("kind", segs[0]),))

    @staticmethod
    def parse_uri(uri: str) -> Ref | None:
        m = re.fullmatch(r"spotify:(track|album|playlist|artist|episode|show):([A-Za-z0-9]{22})", uri.strip())
        if not m:
            return None
        return Ref("spotify", SPOTIFY_TYPES[m.group(1)], m.group(2), f"https://open.spotify.com/{m.group(1)}/{m.group(2)}",
                   (("kind", m.group(1)),))

    def info(self) -> InfoConnecteur:
        app, user = self.auth.configured(), self.auth.user_configured()
        caps = ["Metadata", "Playback"] + (["Search"] if app else [])
        return InfoConnecteur(
            self.id, self.nom, "catalogue", True, caps, ["Metadata", "Search", "Playback"],
            [Identifiant("Client ID et Client Secret d'une application Spotify du propriétaire", app,
                         "métadonnées complètes (artistes, album, durée, ISRC, titres d'un album), recherche",
                         "developer.spotify.com → Dashboard → Create app (gratuit ; Spotify exige un abonnement "
                         "Premium du propriétaire de l'application) ; saisie : sudo bash deploy/music-secrets.sh"),
             Identifiant("Autorisation du compte Spotify du propriétaire (jeton de rafraîchissement)", user,
                         "titres de SES playlists (propriétaire ou collaborateur), synchronisation de playlists",
                         "sudo bash deploy/music-secrets.sh --autoriser-spotify (une fois)")],
            ["Sans identifiants : oEmbed public, titre et pochette seulement (ni artiste, ni durée, ni ISRC, ni "
             "playlists).",
             "Titres d'une playlist : seulement pour les playlists dont le compte autorisé est propriétaire ou "
             "collaborateur (règle Spotify de février 2026).",
             "Recherche : 10 résultats au plus par page (règle Spotify de février 2026).",
             NO_DOWNLOAD_SPOTIFY],
            self.conditions)

    def _base(self, ref: Ref) -> Fiche:
        kind = ref.get("kind") or "track"
        fiche = Fiche("spotify", ref.type, ref.id, ref.url)
        fiche.actions = [action_ouvrir("dans Spotify", ref.url),
                         action_lecteur("Spotify", f"https://open.spotify.com/embed/{kind}/{ref.id}",
                                        152 if kind in ("track", "episode") else 352,
                                        "Extraits ou morceaux complets selon le compte Spotify de l'auditeur."),
                         dict(ACTION_ENREGISTRER)]
        fiche.capacites = ["Metadata", "Playback"] + (["Search"] if self.auth.configured() else [])
        fiche.restrictions = [NO_DOWNLOAD_SPOTIFY]
        return fiche

    async def _api(self, path: str, token: str) -> tuple[int, Any]:
        return await self.ctx.json("spotify", 120, f"https://api.spotify.com/v1{path}", self.API,
                                   headers={"Authorization": f"Bearer {token}"}, max_bytes=4 * 1024 * 1024)

    async def analyse(self, ref: Ref) -> Fiche:
        fiche = self._base(ref)
        token = None
        try:
            token = await asyncio.to_thread(self.auth.app_token)
        except ApiError:
            fiche.avertissements.append("Spotify Web API indisponible : métadonnées publiques limitées (oEmbed).")
        if token is None and self.auth.configured() and time.monotonic() < self.auth.refused_until:
            fiche.avertissements.append("Identifiants Spotify refusés par Spotify : métadonnées publiques limitées "
                                        "(oEmbed). Vérifie le Client ID/Secret (deploy/music-secrets.sh).")
        if token is not None:
            try:
                if await self._from_web_api(fiche, ref, token):
                    return fiche
            except ApiError as exc:
                if exc.status == 404:
                    raise
                fiche.avertissements.append("Spotify Web API indisponible : métadonnées publiques limitées (oEmbed).")
        await self._from_oembed(fiche, ref)
        return fiche

    async def _from_web_api(self, fiche: Fiche, ref: Ref, token: str) -> bool:
        kind = ref.get("kind")
        market = "&market=FR" if kind in ("episode", "show", "track", "album") else ""
        if kind == "playlist":
            user = await asyncio.to_thread(self.auth.user_token)
            status, data = await self._api(f"/playlists/{ref.id}?fields=name,owner(display_name),images,snapshot_id,"
                                           "items(total)", user or token)
        else:
            status, data = await self._api(f"/{kind}s/{ref.id}?{market.lstrip('&')}", token)
        if status == 404 or status == 400:
            raise not_found("Spotify")
        if status in (401, 403):
            self.auth._app = None
            fiche.avertissements.append("Spotify a refusé l'accès à cette ressource avec les identifiants configurés.")
            return False
        if status != 200 or not isinstance(data, dict):
            raise unavailable("Spotify", status)
        fiche.source_metadonnees = "api_web"
        images = data.get("images") or (data.get("album") or {}).get("images") or []
        fiche.pochette = https_or_none(images[0].get("url")) if images and isinstance(images[0], dict) else None
        fiche.titre = text(data.get("name"))
        fiche.artistes = [a for a in (text(x.get("name"), 200) for x in data.get("artists") or [] if isinstance(x, dict)) if a]
        if kind == "track":
            fiche.album = text((data.get("album") or {}).get("name"))
            fiche.duree_s = (number(data.get("duration_ms")) or 0) / 1000 or None
            fiche.isrc = _isrc((data.get("external_ids") or {}).get("isrc"))
            fiche.date = text((data.get("album") or {}).get("release_date"), 20)
        elif kind == "album":
            fiche.date = text(data.get("release_date"), 20)
            tracks = (data.get("tracks") or {})
            fiche.pistes_total = int(number(tracks.get("total")) or 0) or None
            for t in tracks.get("items") or []:
                if isinstance(t, dict):
                    fiche.pistes.append(_spotify_piste(t, fiche.titre, fiche.pochette))
            if fiche.pistes and all(p.isrc is None for p in fiche.pistes):
                fiche.manque.append("ISRC des titres d'un album : Spotify ne les donne que titre par titre.")
        elif kind == "playlist":
            fiche.artistes = [a for a in [text((data.get("owner") or {}).get("display_name"), 200)] if a]
            fiche.snapshot = text(data.get("snapshot_id"), 200)
            fiche.pistes_total = int(number((data.get("items") or {}).get("total")) or 0) or None
            fiche.manque.append("Titres de la playlist : voir POST /music/playlists/synchroniser (autorisation du "
                                "compte propriétaire de la playlist requise par Spotify).")
        elif kind in ("episode", "show"):
            fiche.duree_s = (number(data.get("duration_ms")) or 0) / 1000 or None
            fiche.album = text((data.get("show") or {}).get("name"))
            fiche.date = text(data.get("release_date"), 20)
            fiche.restrictions.append("Épisode Spotify : pas de téléchargement par AETHRYON. Si l'émission publie un "
                                      "flux RSS public, colle ce flux (type « podcast »).")
        return True

    async def _from_oembed(self, fiche: Fiche, ref: Ref) -> None:
        missing = ("identifiants Spotify non configurés" if not self.auth.configured()
                   else "Spotify Web API non utilisable pour l'instant")
        if ref.type == "playlist":
            fiche.source_metadonnees = "aucune"
            fiche.manque.append(f"Nom et titres de la playlist : {missing} (l'oEmbed public ne couvre pas les playlists).")
            return
        status, data = await self.ctx.json("spotify-oembed", 60, f"https://open.spotify.com/oembed?url={quote(ref.url, safe='')}",
                                           self.OEMBED, max_bytes=256 * 1024)
        if status == 404:
            raise not_found("Spotify")
        if status != 200 or not isinstance(data, dict):
            raise unavailable("Spotify", status)
        fiche.source_metadonnees = "oembed"
        fiche.titre = text(data.get("title"))
        fiche.pochette = https_or_none(data.get("thumbnail_url"))
        fiche.manque.append(f"Artistes, album, durée et ISRC : {missing} (l'oEmbed public ne donne que le titre et la "
                            "pochette).")

    async def search(self, q: str) -> list[Fiche]:
        token = await asyncio.to_thread(self.auth.app_token)
        if token is None:
            raise ApiError(409, "identifiants_requis", "Recherche Spotify indisponible : identifiants Spotify du "
                                                       "propriétaire non configurés (ou refusés).")
        status, data = await self._api(f"/search?type=track&limit=10&q={quote(q[:200])}", token)
        if status != 200 or not isinstance(data, dict):
            raise unavailable("Spotify", status)
        out = []
        for t in ((data.get("tracks") or {}).get("items") or [])[:10]:
            if isinstance(t, dict) and isinstance(t.get("id"), str) and SPOTIFY_ID.match(t["id"]):
                ref = Ref("spotify", "titre", t["id"], f"https://open.spotify.com/track/{t['id']}", (("kind", "track"),))
                fiche = self._base(ref)
                fiche.source_metadonnees = "api_web"
                p = _spotify_piste(t, None, None)
                fiche.titre, fiche.artistes, fiche.duree_s, fiche.isrc = p.titre, p.artistes, p.duree_s, p.isrc
                fiche.album = text((t.get("album") or {}).get("name"))
                imgs = (t.get("album") or {}).get("images") or []
                fiche.pochette = https_or_none(imgs[0].get("url")) if imgs and isinstance(imgs[0], dict) else None
                out.append(fiche)
        return out

    async def playlist_items(self, ref: Ref, limit: int = 500) -> tuple[Fiche, list[Piste]]:
        """Items of a playlist OWNED (or co-edited) by the authorised account. 409 when the authorisation is missing."""
        if ref.type != "playlist":
            raise invalid_link("Un lien de playlist Spotify est attendu (open.spotify.com/playlist/…).")
        user = await asyncio.to_thread(self.auth.user_token)
        if user is None:
            raise ApiError(409, "autorisation_spotify_requise",
                           "Synchronisation impossible : Spotify ne donne les titres d'une playlist qu'au compte qui "
                           "en est propriétaire ou collaborateur. Autorise le compte Spotify du propriétaire "
                           "(deploy/music-secrets.sh --autoriser-spotify).")
        fiche = self._base(ref)
        await self._from_web_api(fiche, ref, user)
        fiche.manque = []
        pistes: list[Piste] = []
        offset = 0
        while offset < limit:
            status, data = await self._api(f"/playlists/{ref.id}/items?limit=50&offset={offset}", user)
            if status in (401, 403):
                raise ApiError(403, "playlist_non_accessible",
                               "Spotify refuse les titres de cette playlist : le compte autorisé n'en est ni "
                               "propriétaire ni collaborateur.")
            if status == 404:
                raise not_found("Spotify")
            if status != 200 or not isinstance(data, dict):
                raise unavailable("Spotify", status)
            items = data.get("items") or []
            for it in items:
                track = (it or {}).get("item") or (it or {}).get("track") if isinstance(it, dict) else None
                if isinstance(track, dict) and track.get("type", "track") == "track":
                    pistes.append(_spotify_piste(track, None, None))
            if not data.get("next") or not items:
                break
            offset += 50
        return fiche, pistes[:limit]


def _isrc(value: Any) -> str | None:
    if isinstance(value, str) and re.fullmatch(r"[A-Za-z]{2}[A-Za-z0-9]{3}\d{7}", value.replace("-", "").strip()):
        return value.replace("-", "").strip().upper()
    return None


def _spotify_piste(t: dict[str, Any], album: str | None, pochette: str | None) -> Piste:
    tid = t.get("id") if isinstance(t.get("id"), str) and SPOTIFY_ID.match(t.get("id") or "") else None
    imgs = (t.get("album") or {}).get("images") or []
    return Piste(
        titre=text(t.get("name")),
        artistes=[a for a in (text(x.get("name"), 200) for x in t.get("artists") or [] if isinstance(x, dict)) if a],
        album=album or text((t.get("album") or {}).get("name")),
        duree_s=(number(t.get("duration_ms")) or 0) / 1000 or None,
        isrc=_isrc((t.get("external_ids") or {}).get("isrc")),
        numero=int(number(t.get("track_number")) or 0) or None,
        url=f"https://open.spotify.com/track/{tid}" if tid else None, id=tid,
        pochette=pochette or (https_or_none(imgs[0].get("url")) if imgs and isinstance(imgs[0], dict) else None))


# --------------------------------------------------------------------------------------------------------------------

APPLE_HOSTS = ("music.apple.com", "geo.music.apple.com", "embed.music.apple.com", "itunes.apple.com",
               "podcasts.apple.com")
ITUNES = HostPolicy.api("itunes.apple.com", label="iTunes Search API")


class Apple(Connector):
    id = "apple"
    nom = "Apple Music"
    conditions = ["https://performance-partners.apple.com/search-api", "https://developer.apple.com/musickit/"]

    def __init__(self, ctx: Ctx, podcasts: Any) -> None:
        super().__init__(ctx)
        self.podcasts = podcasts  # Podcast connector (Apple Podcasts links -> the show's public RSS feed)

    def recognizes(self, host: str) -> bool:
        return host in APPLE_HOSTS

    def parse(self, url: str, parts: SplitResult) -> Ref:
        host = (parts.hostname or "").lower()
        segs = [s for s in parts.path.split("/") if s]
        query = parse_qs(parts.query)
        cc = segs[0].lower() if segs and re.fullmatch(r"[a-z]{2}", segs[0], re.I) else "us"
        if segs and re.fullmatch(r"[a-z]{2}", segs[0], re.I):
            segs = segs[1:]
        if host == "podcasts.apple.com":
            m = re.fullmatch(r"id(\d{1,15})", segs[-1]) if segs and segs[0] == "podcast" else None
            if not m:
                raise invalid_link("Lien Apple Podcasts invalide : podcasts.apple.com/…/podcast/…/id123 attendu.")
            return Ref("apple", "podcast", m.group(1), f"https://podcasts.apple.com/{cc}/podcast/id{m.group(1)}",
                       (("cc", cc),))
        if not segs or segs[0] not in ("album", "song", "artist", "playlist", "music-video"):
            raise invalid_link("Lien Apple Music invalide : morceau, album, artiste ou playlist attendu "
                               "(music.apple.com/fr/album/…).")
        kind, last = segs[0], segs[-1]
        track = (query.get("i") or [""])[0]
        if kind == "playlist":
            if not re.fullmatch(r"pl\.[A-Za-z0-9.-]{1,80}", last):
                raise invalid_link("Lien de playlist Apple Music invalide.")
            return Ref("apple", "playlist", last, f"https://music.apple.com/{cc}/playlist/{last}", (("cc", cc),))
        if not re.fullmatch(r"\d{1,15}", last):
            raise invalid_link("Lien Apple Music invalide (identifiant numérique manquant).")
        if kind == "album" and re.fullmatch(r"\d{1,15}", track):
            return Ref("apple", "titre", track, f"https://music.apple.com/{cc}/album/{last}?i={track}",
                       (("cc", cc), ("album", last)))
        types = {"album": "album", "song": "titre", "artist": "artiste", "music-video": "titre"}
        return Ref("apple", types[kind], last, f"https://music.apple.com/{cc}/{kind}/{last}", (("cc", cc),))

    def info(self) -> InfoConnecteur:
        caps = ["Metadata", "Search", "Playback"] + (["Preview"] if self.ctx.settings.music_apple_previews else [])
        return InfoConnecteur(
            self.id, self.nom, "catalogue", True, caps, caps,
            [Identifiant("Jeton développeur Apple Music (MusicKit)", False,
                         "playlists Apple Music, lecture complète pour un abonné",
                         "Apple Developer Program PAYANT : non souscrit (décision du propriétaire)")],
            ["Métadonnées par l'API publique iTunes Search/Lookup (sans clé, environ 20 appels par minute) : titres, "
             "albums, artistes, pochettes ; ni ISRC, ni playlists.",
             "Aperçus de 30 s : lus par l'appareil depuis les serveurs d'Apple, jamais téléchargés ni enregistrés, "
             "toujours avec le lien « Ouvrir dans Apple Music » et la mention « Aperçu fourni par iTunes ».",
             "Apple Podcasts : le flux RSS public de l'émission est lu (épisodes téléchargeables comme tout podcast).",
             "Aucun téléchargement de morceau (FairPlay, conditions d'Apple)."],
            self.conditions)

    def _base(self, ref: Ref) -> Fiche:
        fiche = Fiche("apple", ref.type, ref.id, ref.url)
        fiche.capacites = ["Metadata", "Search", "Playback"]
        embed = ref.url.replace("https://music.apple.com/", "https://embed.music.apple.com/", 1)
        fiche.actions = [action_ouvrir("dans Apple Music", ref.url),
                         action_lecteur("Apple Music", embed, 175 if ref.type == "titre" else 450,
                                        "Morceaux complets pour un abonné Apple Music connecté, aperçus sinon."),
                         dict(ACTION_ENREGISTRER)]
        fiche.restrictions = ["Aucun téléchargement : catalogue protégé (FairPlay) ; AETHRYON n'en copie rien."]
        return fiche

    async def _lookup(self, ident: str, cc: str, entity: str | None = None) -> list[dict[str, Any]]:
        q = {"id": ident, "country": cc, **({"entity": entity, "limit": "200"} if entity else {})}
        status, data = await self.ctx.json("itunes", 15, f"https://itunes.apple.com/lookup?{urlencode(q)}", ITUNES)
        if status != 200 or not isinstance(data, dict):
            raise unavailable("Apple (iTunes)", status)
        return [r for r in data.get("results") or [] if isinstance(r, dict)]

    def _fill(self, fiche: Fiche, r: dict[str, Any]) -> None:
        fiche.source_metadonnees = "itunes"
        fiche.titre = text(r.get("trackName") or r.get("collectionName") or r.get("artistName"))
        fiche.artistes = [a for a in [text(r.get("artistName"), 200)] if a]
        fiche.album = text(r.get("collectionName")) if r.get("trackName") else None
        fiche.duree_s = (number(r.get("trackTimeMillis")) or 0) / 1000 or None
        fiche.date = text(r.get("releaseDate"), 10)
        art = https_or_none(r.get("artworkUrl100"))
        fiche.pochette = art.replace("100x100bb", "600x600bb") if art else None
        preview = https_or_none(r.get("previewUrl"))
        if preview and self.ctx.settings.music_apple_previews:
            # Always with the button « Ouvrir dans Apple Music » (owner's decision, 2026-10-23): see ajouter_apercu.
            ajouter_apercu(fiche, preview, "Apple (iTunes)", "Aperçu fourni par iTunes")

    async def analyse(self, ref: Ref) -> Fiche:
        cc = ref.get("cc") or "us"
        if ref.type == "podcast":
            results = await self._lookup(ref.id, cc)
            feed = next((r.get("feedUrl") for r in results if isinstance(r.get("feedUrl"), str)), None)
            if not feed:
                raise ApiError(404, "flux_introuvable", "Apple ne publie pas le flux RSS de cette émission : elle "
                                                        "n'est pas importable.")
            fiche = await self.podcasts.analyse_feed(feed)
            fiche.via = "apple_podcasts"
            fiche.actions.insert(0, action_ouvrir("dans Apple Podcasts", ref.url))
            return fiche
        fiche = self._base(ref)
        if ref.type == "playlist":
            fiche.source_metadonnees = "aucune"
            fiche.manque.append("Nom et titres de la playlist : l'API Apple Music est nécessaire (Apple Developer "
                                "Program payant, non souscrit) ; l'API publique iTunes ne couvre pas les playlists.")
            return fiche
        entity = "song" if ref.type == "album" else None
        results = await self._lookup(ref.id, cc, entity)
        head = next((r for r in results if str(r.get("trackId") or r.get("collectionId") or r.get("artistId")) == ref.id
                     or r.get("wrapperType") in ("collection", "artist")), None)
        if head is None:
            fiche.source_metadonnees = "itunes"
            fiche.manque.append("Métadonnées absentes : l'API iTunes ne connaît pas ce contenu dans ce pays (retiré "
                                "ou réservé à Apple Music).")
            return fiche
        self._fill(fiche, head)
        if ref.type == "album":
            fiche.pistes_total = int(number(head.get("trackCount")) or 0) or None
            for r in results:
                if r.get("wrapperType") == "track" and r.get("kind") == "song":
                    fiche.pistes.append(Piste(text(r.get("trackName")), [a for a in [text(r.get("artistName"), 200)] if a],
                                              fiche.titre, (number(r.get("trackTimeMillis")) or 0) / 1000 or None, None,
                                              int(number(r.get("trackNumber")) or 0) or None,
                                              https_or_none(r.get("trackViewUrl")), str(r.get("trackId") or "") or None,
                                              None, fiche.pochette))
        fiche.manque.append("ISRC : non fourni par l'API publique iTunes.")
        return fiche

    async def search(self, q: str) -> list[Fiche]:
        query = urlencode({"term": q[:200], "media": "music", "entity": "song", "limit": "10", "country": "fr"})
        status, data = await self.ctx.json("itunes", 15, f"https://itunes.apple.com/search?{query}", ITUNES)
        if status != 200 or not isinstance(data, dict):
            raise unavailable("Apple (iTunes)", status)
        out = []
        for r in (data.get("results") or [])[:10]:
            if isinstance(r, dict) and r.get("trackId") and r.get("collectionId"):
                ref = Ref("apple", "titre", str(r["trackId"]),
                          f"https://music.apple.com/fr/album/{r['collectionId']}?i={r['trackId']}", (("cc", "fr"),))
                fiche = self._base(ref)
                self._fill(fiche, r)
                out.append(fiche)
        return out


# --------------------------------------------------------------------------------------------------------------------

SOUNDCLOUD_RESERVED = {"discover", "stream", "you", "search", "upload", "settings", "messages", "notifications",
                       "charts", "pages", "jobs", "terms-of-use", "pro", "mobile", "people", "tags", "imprint"}
NO_DOWNLOAD_SOUNDCLOUD = ("Téléchargement impossible par AETHRYON : les conditions de l'API SoundCloud interdisent toute "
                          "fonction d'enregistrement, même pour une piste que son auteur rend téléchargeable. Ouvre la "
                          "piste sur SoundCloud pour utiliser son propre bouton « Download » s'il existe.")


class SoundCloud(Connector):
    id = "soundcloud"
    nom = "SoundCloud"
    conditions = ["https://developers.soundcloud.com/docs/api/terms-of-use",
                  "https://developers.soundcloud.com/docs/oembed"]
    OEMBED = HostPolicy.api("soundcloud.com", label="SoundCloud oEmbed")

    def recognizes(self, host: str) -> bool:
        return host in ("soundcloud.com", "www.soundcloud.com", "m.soundcloud.com", "on.soundcloud.com")

    def parse(self, url: str, parts: SplitResult) -> Ref:
        host = (parts.hostname or "").lower()
        if host == "on.soundcloud.com":
            raise invalid_link("Lien court SoundCloud : ouvre-le, puis copie le lien complet (soundcloud.com/…).")
        segs = [s for s in parts.path.split("/") if s]
        slug = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
        if not segs or segs[0].lower() in SOUNDCLOUD_RESERVED or not all(slug.match(s) for s in segs[:3]):
            raise invalid_link("Lien SoundCloud invalide : soundcloud.com/artiste/piste attendu.")
        if len(segs) >= 3 and segs[1] == "sets":
            kind, ident = "playlist", f"{segs[0]}/sets/{segs[2]}"
        elif len(segs) >= 2 and segs[1] not in ("tracks", "albums", "sets", "reposts", "likes", "followers",
                                                "following", "popular-tracks", "comments"):
            kind, ident = "titre", f"{segs[0]}/{segs[1]}"
        elif len(segs) == 1:
            kind, ident = "artiste", segs[0]
        else:
            raise invalid_link("Lien SoundCloud non pris en charge (piste, playlist ou profil attendu).")
        return Ref("soundcloud", kind, ident.lower(), f"https://soundcloud.com/{ident}")

    def info(self) -> InfoConnecteur:
        return InfoConnecteur(
            self.id, self.nom, "catalogue", True, ["Metadata", "Playback"], ["Metadata", "Search", "Playback"],
            [Identifiant("Application SoundCloud enregistrée (client credentials)", False,
                         "durée, recherche, métadonnées complètes (API /resolve)",
                         "soundcloud.com/you/apps (inscription des applications : à vérifier par le propriétaire)")],
            ["Sans application : oEmbed public (titre, auteur, pochette) et lecteur officiel (widget).",
             "Attribution obligatoire : auteur, SoundCloud et lien vers la piste.", NO_DOWNLOAD_SOUNDCLOUD],
            self.conditions)

    async def analyse(self, ref: Ref) -> Fiche:
        fiche = Fiche("soundcloud", ref.type, ref.id, ref.url)
        fiche.capacites = ["Metadata", "Playback"]
        fiche.restrictions = [NO_DOWNLOAD_SOUNDCLOUD]
        widget = f"https://w.soundcloud.com/player/?url={quote(ref.url, safe='')}&visual=false"
        fiche.actions = [action_ouvrir("sur SoundCloud", ref.url),
                         action_lecteur("SoundCloud", widget, 166 if ref.type == "titre" else 450),
                         dict(ACTION_ENREGISTRER)]
        status, data = await self.ctx.json("soundcloud", 60, "https://soundcloud.com/oembed?" +
                                           urlencode({"format": "json", "url": ref.url}), self.OEMBED,
                                           max_bytes=256 * 1024)
        if status == 404 or status == 403:
            raise not_found("SoundCloud")
        if status != 200 or not isinstance(data, dict):
            raise unavailable("SoundCloud", status)
        fiche.source_metadonnees = "oembed"
        author = text(data.get("author_name"), 200)
        title = text(data.get("title"))
        if title and author and title.endswith(f" by {author}"):
            title = title[: -len(f" by {author}")]
        fiche.titre, fiche.artistes = title, [author] if author else []
        fiche.pochette = https_or_none(data.get("thumbnail_url"))
        fiche.attribution = f"« {title} » par {author} sur SoundCloud ({ref.url})" if title and author else None
        fiche.manque.append("Durée, ISRC et titres d'une playlist : l'API SoundCloud demande une application "
                            "enregistrée (non configurée) ; l'oEmbed public ne les donne pas.")
        return fiche


# --------------------------------------------------------------------------------------------------------------------

DEEZER_TYPES = {"track": "titre", "album": "album", "playlist": "playlist", "artist": "artiste", "episode": "episode",
                "show": "podcast"}
DEEZER_API_HOSTS = HostPolicy.api("api.deezer.com", label="API Deezer")


class Deezer(Connector):
    id = "deezer"
    nom = "Deezer"
    conditions = ["https://developers.deezer.com/termsofuse"]

    def recognizes(self, host: str) -> bool:
        return host in ("deezer.com", "www.deezer.com", "link.deezer.com", "deezer.page.link")

    def parse(self, url: str, parts: SplitResult) -> Ref:
        host = (parts.hostname or "").lower()
        if host in ("link.deezer.com", "deezer.page.link"):
            raise invalid_link("Lien court Deezer : ouvre-le, puis copie le lien complet (www.deezer.com/…).")
        segs = [s for s in parts.path.split("/") if s]
        if segs and re.fullmatch(r"[a-z]{2}(-[a-z]{2})?", segs[0], re.I):
            segs = segs[1:]
        if len(segs) < 2 or segs[0] not in DEEZER_TYPES or not re.fullmatch(r"\d{1,15}", segs[1]):
            raise invalid_link("Lien Deezer invalide : www.deezer.com/fr/track/123 (titre, album, playlist, artiste…).")
        return Ref("deezer", DEEZER_TYPES[segs[0]], segs[1], f"https://www.deezer.com/{segs[0]}/{segs[1]}",
                   (("kind", segs[0]),))

    def info(self) -> InfoConnecteur:
        api = self.ctx.settings.music_deezer_api
        caps = ["Playback"] + (["Metadata", "Preview"] if api else [])
        return InfoConnecteur(
            self.id, self.nom, "catalogue", True, caps, ["Metadata", "Preview", "Playback"],
            [Identifiant("Accord commercial de Deezer (ou décision « usage non commercial »)", api,
                         "métadonnées par l'API Deezer (MUSIC_DEEZER_API)",
                         "les conditions de l'API Deezer limitent son usage à un cadre non commercial")],
            ["Par défaut : reconnaissance du lien, « Ouvrir dans Deezer » et lecteur officiel (widget), sans aucun "
             "appel à l'API : ses conditions la réservent à un usage non commercial et AETHRYON prépare des offres "
             "payantes.", "Aucun téléchargement (catalogue protégé)."],
            self.conditions)

    async def analyse(self, ref: Ref) -> Fiche:
        kind = ref.get("kind") or "track"
        fiche = Fiche("deezer", ref.type, ref.id, ref.url)
        fiche.capacites = ["Playback"]
        fiche.restrictions = ["Aucun téléchargement : catalogue protégé ; AETHRYON n'en copie rien."]
        fiche.actions = [action_ouvrir("dans Deezer", ref.url),
                         action_lecteur("Deezer", f"https://widget.deezer.com/widget/dark/{kind}/{ref.id}",
                                        150 if kind == "track" else 380,
                                        "Extraits de 30 s sans compte Deezer, morceaux complets pour un abonné."),
                         dict(ACTION_ENREGISTRER)]
        if not self.ctx.settings.music_deezer_api:
            fiche.source_metadonnees = "aucune"
            fiche.manque.append("Titre, artiste, album et durée : l'API Deezer n'est pas appelée (conditions : usage "
                                "non commercial seulement ; réglage MUSIC_DEEZER_API).")
            return fiche
        if kind not in ("track", "album", "playlist", "artist"):
            fiche.source_metadonnees = "aucune"
            return fiche
        status, data = await self.ctx.json("deezer", 50, f"https://api.deezer.com/{kind}/{ref.id}", DEEZER_API_HOSTS)
        if status != 200 or not isinstance(data, dict):
            raise unavailable("Deezer", status)
        if isinstance(data.get("error"), dict):
            if int(number(data["error"].get("code")) or 0) == 800:
                raise not_found("Deezer")
            raise unavailable("Deezer")
        fiche.capacites.append("Metadata")
        fiche.source_metadonnees = "api_deezer"
        fiche.titre = text(data.get("title") or data.get("name"))
        artist = data.get("artist") or {}
        fiche.artistes = [a for a in [text(artist.get("name"), 200)] if a] if isinstance(artist, dict) else []
        album = data.get("album") or {}
        fiche.album = text(album.get("title")) if isinstance(album, dict) else None
        fiche.duree_s = number(data.get("duration"))
        fiche.isrc = _isrc(data.get("isrc"))
        fiche.pochette = https_or_none((album if kind == "track" else data).get("cover_xl")
                                       or data.get("picture_xl"))
        preview = https_or_none(data.get("preview"))
        if preview:
            ajouter_apercu(fiche, preview, "Deezer", "Aperçu fourni par Deezer")
        for t in ((data.get("tracks") or {}).get("data") or [])[:500]:
            if isinstance(t, dict):
                a = t.get("artist") or {}
                fiche.pistes.append(Piste(text(t.get("title")), [x for x in [text(a.get("name"), 200)] if x],
                                          text((t.get("album") or {}).get("title")) or fiche.titre,
                                          number(t.get("duration")), _isrc(t.get("isrc")), None,
                                          https_or_none(t.get("link")), str(t.get("id") or "") or None))
        return fiche
