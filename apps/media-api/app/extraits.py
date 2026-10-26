"""Extraits : récupération PARTIELLE de la plage demandée, puis découpe précise (docs : BACKEND.md des extraits).

Principe (mesuré sur le banc, voir banc/etude.py) :

1. yt-dlp extrait les formats (aucun octet du média) ; seuls les flux qu'on sait lire par morceaux sont gardés :
   fichiers HTTP(S) à accès direct (formats DASH de YouTube, MP4 progressifs de TikTok et X) et listes HLS.
2. Un relais HTTP local (127.0.0.1, dans le processus du traitement) sert ces flux à ffmpeg. Chaque requête Range de
   ffmpeg devient des requêtes BORNÉES vers la plateforme (64 Kio, puis le double à chaque morceau, plafonné) faites
   par le client réseau de yt-dlp (mêmes en-têtes, cookies, proxy YouTube, usurpation TLS que le téléchargement
   normal). Les listes HLS sont réécrites pour que chaque segment passe aussi par le relais. Le relais compte chaque
   octet reçu de la plateforme et coupe tout au-delà du budget : aucun téléchargement intégral silencieux possible.
3. ffmpeg « -ss avant -i » (-copyts, copie des flux) ne lit que l'index (sidx, Cues, moov, liste HLS) puis les
   morceaux de la fenêtre [début − marge, fin + marge] : une fenêtre locale, aux horodatages d'origine.
4. Conversion locale précise : trim/atrim sur les horodatages d'origine (image ou échantillon exact), H.264/AAC pour
   le MP4, MP3, GIF en deux passes.

Tout ce module tourne dans le processus enfant du traitement (app.runner) : l'annulation tue le groupe de
processus (ffmpeg, relais, connexions) ; le transfert s'arrête avec lui.
"""

from __future__ import annotations

import functools
import ipaddress
import json
import logging
import os
import queue
import re
import socket
import subprocess
import tempfile
import threading
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import unquote, urljoin, urlsplit

from .errors import ApiError

log = logging.getLogger("ytapi.extraits")

MIO = 1024 * 1024
# Marge autour de la plage demandée : la copie démarre à l'image clé qui précède (début − marge) ; la découpe précise
# se fait ensuite localement.
MARGE_S = 1.0
# Si la fenêtre ne couvre pas la plage (images clés espacées, ou recherche HLS qui démarre à l'image clé SUIVANTE),
# nouvel essai avec une marge plus large : 6 s, puis 20 s.
MARGES_S = (MARGE_S, 6.0, 20.0)
# Décalage ajouté aux horodatages de la fenêtre : aucun horodatage négatif (sinon le muxeur Matroska décalerait tout
# le flux, et la découpe ne tomberait plus sur la bonne image).
DECALAGE_S = 10.0
PAS_INITIAL = 64 * 1024
PAS_MAX = 8 * MIO
# Plafond d'un morceau : un quart de la fenêtre estimée, entre 1 Mio (les index d'un MP4 progressif de 9 h font
# ~12 Mio) et PAS_MAX.
PAS_PLANCHER = 1 * MIO
BLOC = 64 * 1024
LISTE_MAX = 16 * MIO  # une liste HLS de 9 h fait ~3 Mio
SILENCE_MAX_S = 90.0  # ffmpeg sans aucune nouvelle pendant ce temps : la plateforme ne répond plus
# Budget adaptatif : au-delà de 3 × l'estimation de la fenêtre + 64 Mio (index, morceaux entamés), la source ne se
# lit pas par morceaux (ex. fichier sans index : lecture linéaire depuis le début).
BUDGET_FACTEUR = 3
BUDGET_MARGE = 64 * MIO
PROTOCOLES_PARTIELS = ("http", "https", "m3u8", "m3u8_native")
# Adresses privées ou locales refusées par le relais. Seuls les tests (serveur de médias sur 127.0.0.1) l'ouvrent.
AUTORISER_PRIVE = False


class Depassement(Exception):
    """Le relais a reçu plus d'octets que le budget du traitement."""


class ErreurAmont(Exception):
    def __init__(self, statut: int | None, message: str) -> None:
        super().__init__(message)
        self.statut = statut


def partiel_impossible(detail: str) -> ApiError:
    return ApiError(422, "extrait_partiel_impossible", detail)


def hors_source(detail: str) -> ApiError:
    return ApiError(422, "extrait_hors_source", detail)


def mo(octets: float) -> str:
    """12,5 Mo (décimal, virgule française)."""
    valeur = octets / 1_000_000
    return f"{valeur:.0f} Mo" if valeur >= 10 else f"{valeur:.1f} Mo".replace(".", ",")


def hms_ms(secondes: float) -> str:
    """02:13:07.800 (format des champs de l'extension)."""
    ms = int(round(secondes * 1000))
    h, reste = divmod(ms, 3_600_000)
    m, reste = divmod(reste, 60_000)
    s, ms = divmod(reste, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


# --- compteur et garde ----------------------------------------------------------------------------------------------


class Compteur:
    """Octets reçus de la plateforme (corps HTTP lus par le relais), avec deux plafonds : `limite`
    (EXTRAIT_TELECHARGEMENT_MAX_MB) et `budget` (adaptatif, <= limite). Le premier dépassement fige la raison."""

    def __init__(self, limite: int, budget: int | None = None) -> None:
        self.limite = limite
        self.budget = min(limite, budget) if budget else limite
        self.total = 0
        self.requetes = 0
        # Somme des Content-Length annoncés par la plateforme : ce qu'elle aurait pu envoyer au plus (chaque requête est
        # bornée). total <= annonces ; l'écart = octets restés dans les tampons réseau quand ffmpeg a fini.
        self.annonces = 0
        self.raison: str | None = None  # "limite" ou "budget"
        self._verrou = threading.Lock()

    def ajouter(self, n: int) -> None:
        with self._verrou:
            self.total += n
            if self.raison is None and self.total > self.budget:
                self.raison = "limite" if self.budget >= self.limite else "budget"
            if self.raison is not None:
                raise Depassement()

    def requete(self) -> None:
        with self._verrou:
            if self.raison is not None:
                raise Depassement()
            self.requetes += 1

    def annonce(self, longueur: object) -> None:
        if isinstance(longueur, (str, int)) and str(longueur).isdigit():
            with self._verrou:
                self.annonces += int(longueur)


def lire(compteur: Compteur, reponse: Reponse, ecrire: Callable[[bytes], None] | None, maximum: int | None = None,
         compte: list[int] | None = None) -> int:
    """Lit le corps d'une réponse de la plateforme (compté, garde appliquée) et le passe à `ecrire` ; renvoie le nombre
    d'octets lus. `compte` (liste d'un entier) suit les octets transmis même si une coupure interrompt la lecture
    (reprise exacte). Une erreur de lecture côté plateforme devient ErreurAmont ; une erreur d'écriture (ffmpeg parti)
    reste OSError."""
    lus = 0
    while maximum is None or lus < maximum:
        try:
            bloc = reponse.read(BLOC if maximum is None else min(BLOC, maximum - lus))
        except Depassement:
            raise
        except Exception as exc:  # noqa: BLE001 - coupure TLS/TCP, corps tronqué : erreur de la plateforme
            raise ErreurAmont(None, f"lecture interrompue ({type(exc).__name__})") from None
        if not bloc:
            break
        compteur.ajouter(len(bloc))
        if ecrire is not None:
            ecrire(bloc)
        lus += len(bloc)
        if compte is not None:
            compte[0] += len(bloc)
    return lus


# --- relais HTTP local ----------------------------------------------------------------------------------------------


class Reponse(Protocol):
    status: int
    headers: Any
    url: str

    def read(self, amt: int | None = None) -> bytes: ...

    def close(self) -> None: ...


# ouvrir(url, en-têtes, extensions) -> réponse ; lève ErreurAmont pour un statut HTTP d'erreur ou un échec réseau.
Ouvrir = Callable[[str, dict[str, str], dict[str, Any]], Reponse]


def ouvrir_ytdlp(ydl: Any) -> Ouvrir:
    """Requêtes vers la plateforme par le client réseau de yt-dlp (en-têtes du format, cookies, proxy YouTube,
    usurpation TLS si le format la demande) : exactement le chemin du téléchargement normal."""
    from yt_dlp.networking import Request
    from yt_dlp.networking.exceptions import HTTPError, RequestError

    def ouvrir(url: str, entetes: dict[str, str], extensions: dict[str, Any]) -> Reponse:
        try:
            return ydl.urlopen(Request(url, headers=entetes, extensions=extensions or None))
        except HTTPError as exc:
            statut = exc.status
            try:
                exc.response.close()
            except Exception:  # noqa: BLE001
                pass
            raise ErreurAmont(statut, f"HTTP Error {statut}") from None
        except RequestError as exc:
            raise ErreurAmont(None, f"{type(exc).__name__}: {str(exc)[:200]}") from None

    return ouvrir


def hote_public(url: str) -> bool:
    """Défense en profondeur (une liste HLS désigne ses segments) : jamais d'adresse privée, locale ou de lien local."""
    try:
        parts = urlsplit(url)
        hote = (parts.hostname or "").lower().rstrip(".")
    except ValueError:
        return False
    if parts.scheme not in ("http", "https") or not hote or parts.username or parts.password:
        return False
    if hote == "localhost" or hote.endswith((".localhost", ".local", ".internal", ".lan", ".home.arpa")):
        return False
    return _adresses_publiques(hote, parts.port or 443)


@functools.lru_cache(maxsize=512)
def _adresses_publiques(hote: str, port: int) -> bool:
    """Une résolution par hôte (une liste HLS de 9 h désigne 5 400 segments, souvent sur le même hôte)."""
    try:
        return ipaddress.ip_address(hote).is_global
    except ValueError:
        pass
    try:
        adresses = {info[4][0] for info in socket.getaddrinfo(hote, port, proto=socket.IPPROTO_TCP)}
    except OSError:
        return True  # non résolu ici : la requête échouera de la même façon (ou passe par le proxy YouTube)
    return all(ipaddress.ip_address(a.split("%")[0]).is_global for a in adresses)


@dataclass
class Source:
    url: str
    entetes: dict[str, str]
    extensions: dict[str, Any]
    nature: str  # "fichier" (accès direct, lu par morceaux), "segment" (segment HLS), "liste" (liste HLS)
    partie: int  # index du format demandé (repli YouTube sur un 403)
    pas_max: int = PAS_MAX


@dataclass
class Incident:
    partie: int
    statut: int | None
    message: str


_PLAGE_RE = re.compile(r"bytes=(\d+)-(\d*)$")
_CONTENT_RANGE_RE = re.compile(r"bytes (\d+)-(\d+)/(\d+|\*)")
_URI_ATTR_RE = re.compile(r'URI="([^"]*)"')


class Relais:
    """Serveur HTTP sur 127.0.0.1 (port éphémère) que lit ffmpeg. /r/<id>/<nom> → la source enregistrée <id>."""

    def __init__(self, ouvrir: Ouvrir, compteur: Compteur, *, autoriser_prive: bool | None = None) -> None:
        self.ouvrir = ouvrir
        self.compteur = compteur
        self.autoriser_prive = AUTORISER_PRIVE if autoriser_prive is None else autoriser_prive
        self.sources: dict[str, Source] = {}
        self._par_url: dict[tuple[str, str], str] = {}
        self.incidents: list[Incident] = []
        self.journal: list[dict[str, Any]] = []  # une ligne par requête vers la plateforme (diagnostic, sans URL)
        self._verrou = threading.Lock()
        relais = self

        class Gestionnaire(_Gestionnaire):
            pass

        Gestionnaire.relais = relais
        self.serveur = _Serveur(("127.0.0.1", 0), Gestionnaire)
        self.serveur.daemon_threads = True
        self._fil: threading.Thread | None = None

    @property
    def port(self) -> int:
        return int(self.serveur.server_address[1])

    def __enter__(self) -> Relais:
        self._fil = threading.Thread(target=self.serveur.serve_forever, name="relais-extrait", daemon=True)
        self._fil.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self.serveur.shutdown()
        self.serveur.server_close()

    def ajouter(self, url: str, entetes: dict[str, str] | None = None, extensions: dict[str, Any] | None = None,
                nature: str = "fichier", partie: int = 0, pas_max: int = PAS_MAX) -> str:
        if not self.autoriser_prive and not hote_public(url):
            raise ErreurAmont(None, "adresse refusée (privée, locale ou invalide)")
        with self._verrou:
            cle = (url, nature)
            sid = self._par_url.get(cle)
            if sid is None:
                sid = str(len(self.sources) + 1)
                self.sources[sid] = Source(url, dict(entetes or {}), dict(extensions or {}), nature, partie, pas_max)
                self._par_url[cle] = sid
        nom = re.sub(r"[^A-Za-z0-9._-]", "_", unquote(urlsplit(url).path.rsplit("/", 1)[-1]))[-60:] or "media"
        return f"http://127.0.0.1:{self.port}/r/{sid}/{nom}"

    def noter(self, source: Source, statut: int | None, message: str) -> None:
        with self._verrou:
            self.incidents.append(Incident(source.partie, statut, message))

    def amont(self, source: Source, debut: int | None, fin: int | None) -> Reponse:
        """Une requête vers la plateforme, bornée [debut, fin] (octets inclus) ; fin None = jusqu'au bout."""
        entetes = dict(source.entetes)
        if debut is not None:
            entetes["Range"] = f"bytes={debut}-{'' if fin is None else fin}"
        self.compteur.requete()
        t0 = time.monotonic()
        try:
            reponse = self.ouvrir(source.url, entetes, source.extensions)
        except ErreurAmont as exc:
            self.journal.append({"source": source.nature, "partie": source.partie, "plage": entetes.get("Range"),
                                 "statut": exc.statut, "ms": round((time.monotonic() - t0) * 1000)})
            raise
        longueur = reponse.headers.get("Content-Length")
        self.compteur.annonce(longueur)
        self.journal.append({"source": source.nature, "partie": source.partie, "plage": entetes.get("Range"),
                             "statut": reponse.status, "octets": longueur, "ms": round((time.monotonic() - t0) * 1000)})
        return reponse

    def lire(self, reponse: Reponse, ecrire: Callable[[bytes], None] | None, maximum: int | None = None,
             compte: list[int] | None = None) -> int:
        return lire(self.compteur, reponse, ecrire, maximum, compte)

    def reecrire_liste(self, texte: str, base: str, partie: int) -> str:
        """Liste HLS dont chaque adresse (segments, clé, init, sous-listes) passe par le relais."""
        sortie: list[str] = []
        sous_liste = False
        for ligne in texte.splitlines():
            brute = ligne.strip()
            if not brute:
                sortie.append(ligne)
                continue
            if brute.startswith("#"):
                if brute.startswith("#EXT-X-STREAM-INF"):
                    sous_liste = True
                nature = "liste" if brute.startswith(("#EXT-X-MEDIA:", "#EXT-X-I-FRAME-STREAM-INF")) else "segment"

                def remplacer(m: re.Match[str], nature: str = nature) -> str:
                    return f'URI="{self.ajouter(urljoin(base, m.group(1)), self._entetes_de(partie), self._ext_de(partie), nature, partie)}"'

                sortie.append(_URI_ATTR_RE.sub(remplacer, ligne))
                continue
            nature = "liste" if sous_liste else "segment"
            sous_liste = False
            sortie.append(self.ajouter(urljoin(base, brute), self._entetes_de(partie), self._ext_de(partie), nature, partie))
        return "\n".join(sortie) + "\n"

    def _entetes_de(self, partie: int) -> dict[str, str]:
        return next((s.entetes for s in self.sources.values() if s.partie == partie), {})

    def _ext_de(self, partie: int) -> dict[str, Any]:
        return next((s.extensions for s in self.sources.values() if s.partie == partie), {})


class _Serveur(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request: Any, client_address: Any) -> None:
        # ffmpeg ferme ses connexions persistantes quand il a fini ou qu'il saute ailleurs : rien d'anormal.
        log.debug("relay connection closed by ffmpeg", exc_info=True)


class _Gestionnaire(BaseHTTPRequestHandler):
    relais: Relais
    protocol_version = "HTTP/1.1"
    server_version = "relais"
    sys_version = ""

    def setup(self) -> None:
        super().setup()
        # Petit tampon d'envoi : quand ffmpeg ne lit plus, le relais s'arrête aussitôt de demander la suite.
        try:
            self.connection.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 32 * 1024)
        except OSError:
            pass

    def log_message(self, *args: object) -> None:
        pass

    def _vide(self, code: int, entetes: Iterable[tuple[str, str]] = ()) -> None:
        self.send_response(code)
        for nom, valeur in entetes:
            self.send_header(nom, valeur)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self) -> None:  # noqa: N802 - ffmpeg n'en fait pas ; réponse neutre
        self._vide(405)

    def do_GET(self) -> None:  # noqa: N802
        m = re.fullmatch(r"/r/(\d+)/[^/]*", urlsplit(self.path).path)
        source = self.relais.sources.get(m.group(1)) if m else None
        if source is None:
            self._vide(404)
            return
        try:
            if source.nature == "liste":
                self._liste(source)
            else:
                self._fichier(source)
        except Depassement:
            self._couper()
        except ErreurAmont as exc:
            self.relais.noter(source, exc.statut, str(exc))
            self._couper()
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            self.close_connection = True  # ffmpeg a fermé (fin de la fenêtre, saut ailleurs) : on arrête là

    def _couper(self) -> None:
        """Erreur ou budget dépassé : la connexion de ffmpeg est fermée net (ffmpeg échoue, le parent explique)."""
        self.close_connection = True
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def _liste(self, source: Source) -> None:
        reponse = self.relais.amont(source, None, None)
        morceaux: list[bytes] = []
        try:
            self.relais.lire(reponse, morceaux.append, LISTE_MAX + 1)
        finally:
            reponse.close()
        brut = b"".join(morceaux)
        if len(brut) > LISTE_MAX:
            raise ErreurAmont(None, "liste HLS trop grande")
        texte = brut.decode("utf-8", "replace")
        if texte.lstrip("﻿").startswith("#EXTM3U"):
            corps = self.relais.reecrire_liste(texte, getattr(reponse, "url", None) or source.url, source.partie).encode()
        else:
            corps = brut
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.apple.mpegurl")
        self.send_header("Content-Length", str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)

    def _fichier(self, source: Source) -> None:
        plage = self.headers.get("Range")
        m = _PLAGE_RE.match((plage or "").strip())
        if plage and not m:
            self._vide(416)
            return
        debut = int(m.group(1)) if m else 0
        fin_demandee = int(m.group(2)) if m and m.group(2) else None
        if source.nature == "segment":
            # Segment HLS : ressource bornée que ffmpeg lit en entier (sauf le dernier) ; requête transmise telle quelle.
            pas = None if fin_demandee is None else fin_demandee - debut + 1
        else:
            pas = PAS_INITIAL if fin_demandee is None else min(PAS_INITIAL, fin_demandee - debut + 1)
        try:
            reponse = self.relais.amont(source, debut, None if pas is None else debut + pas - 1)
        except ErreurAmont as exc:
            if exc.statut == 416:
                self._vide(416)
                return
            raise
        try:
            statut = int(reponse.status)
            plage_amont = _CONTENT_RANGE_RE.match(str(reponse.headers.get("Content-Range") or ""))
            if statut == 200:
                if source.nature != "segment":
                    # Fichier servi en entier malgré la plage demandée : ffmpeg devrait le lire du début jusqu'au
                    # passage. Refus immédiat (extrait_partiel_impossible), jamais de lecture linéaire silencieuse.
                    raise ErreurAmont(200, "la source ignore les requêtes partielles (Range)")
                self._passer_tout(reponse)
                return
            if statut != 206 or plage_amont is None or int(plage_amont.group(1)) != debut:
                raise ErreurAmont(statut, f"réponse partielle inattendue ({statut})")
            total = None if plage_amont.group(3) == "*" else int(plage_amont.group(3))
            if total is None or pas is None:
                self._passer_tel_quel(reponse, debut, int(plage_amont.group(2)), total)
                return
            derniere = total - 1 if fin_demandee is None else min(fin_demandee, total - 1)
            if plage:
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {debut}-{derniere}/{total}")
            else:
                self.send_response(200)
            self.send_header("Content-Length", str(derniere - debut + 1))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Type", str(reponse.headers.get("Content-Type") or "application/octet-stream"))
            self.end_headers()
            position = debut + self._recopier(reponse, int(plage_amont.group(2)) - debut + 1)
        finally:
            reponse.close()
        # Morceaux suivants, à la demande : chacun ne part que si ffmpeg a absorbé le précédent (tampons réduits).
        while position <= derniere:
            pas = min(pas * 2, source.pas_max)
            position = self._morceau(source, position, min(position + pas - 1, derniere))

    def _morceau(self, source: Source, debut: int, fin: int) -> int:
        """Un morceau [debut, fin] ; deux nouvelles tentatives sur une coupure réseau (jamais sur un refus HTTP), qui
        reprennent exactement après le dernier octet transmis. Renvoie la position suivante."""
        transmis = [0]
        for essai in range(3):
            position = debut + transmis[0]
            try:
                reponse = self.relais.amont(source, position, fin)
            except ErreurAmont as exc:
                if exc.statut is not None or essai == 2:
                    raise
                continue
            try:
                plage_amont = _CONTENT_RANGE_RE.match(str(reponse.headers.get("Content-Range") or ""))
                if int(reponse.status) != 206 or plage_amont is None or int(plage_amont.group(1)) != position:
                    raise ErreurAmont(int(reponse.status), "réponse partielle inattendue")
                self.relais.lire(reponse, self.wfile.write, fin - position + 1, transmis)
            except ErreurAmont as exc:
                if exc.statut is not None or essai == 2:
                    raise
                continue
            finally:
                reponse.close()
            if debut + transmis[0] > fin:
                return debut + transmis[0]
            if essai == 2:
                break
        raise ErreurAmont(None, "morceau incomplet")

    def _recopier(self, reponse: Reponse, attendu: int) -> int:
        lus = self.relais.lire(reponse, self.wfile.write, attendu)
        if lus < attendu:
            raise ErreurAmont(None, f"corps tronqué ({lus}/{attendu} octets)")
        return lus

    def _passer_tel_quel(self, reponse: Reponse, debut: int, fin: int, total: int | None) -> None:
        self.send_response(206)
        self.send_header("Content-Range", f"bytes {debut}-{fin}/{'*' if total is None else total}")
        self.send_header("Content-Length", str(fin - debut + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        self._recopier(reponse, fin - debut + 1)

    def _passer_tout(self, reponse: Reponse) -> None:
        longueur = reponse.headers.get("Content-Length")
        self.send_response(200)
        if longueur and str(longueur).isdigit():
            self.send_header("Content-Length", str(longueur))
            self.end_headers()
            self._recopier(reponse, int(longueur))
        else:
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            self.relais.lire(reponse, self.wfile.write)


# --- fenêtre locale (ffmpeg, copie des flux) ------------------------------------------------------------------------


@dataclass
class Fenetre:
    chemin: Path
    t0: float  # « start » de la source selon ffmpeg (0 pour DASH, ~1,4 s pour un HLS en MPEG-TS)
    video: bool
    audio: bool
    debut_fichier: float = 0.0  # premier horodatage de la fenêtre (start_time du fichier local)
    bornes: dict[str, tuple[float, float]] = field(default_factory=dict)  # "video"/"audio" -> (premier, dernier) pts
    ips: str | None = None  # cadence de la vidéo (r_frame_rate, ex. "30000/1001")

    def absolu(self, secondes: float) -> float:
        """Horodatage, dans la fenêtre, de l'instant `secondes` de la vidéo (temps du lecteur)."""
        return self.t0 + secondes + DECALAGE_S

    def relatif(self, secondes: float) -> float:
        """Instant `secondes` de la vidéo, tel que ffmpeg le voit en relisant la fenêtre sans -copyts (il retranche le
        premier horodatage du fichier)."""
        return self.absolu(secondes) - self.debut_fichier


Progression = Callable[[float | None], None]
_START_RE = re.compile(r"Duration: [^,]*, start: (-?\d+(?:\.\d+)?)")


def ffmpeg_fenetre(url: str, liste: bool, debut_s: float, duree_s: float, flux: str, sortie: Path,
                   compteur: Compteur, progression: Progression | None = None,
                   arret: Callable[[], str | None] | None = None) -> Fenetre:
    """Copie de [debut_s, debut_s + duree_s] (temps du lecteur) de `url` (le relais) dans `sortie` (Matroska,
    horodatages d'origine + DECALAGE_S). flux : "va" (vidéo et son), "v" ou "a". Lève Depassement si le relais a coupé
    pour le budget ; ApiError pour un échec de ffmpeg."""
    carte = {"va": ["-map", "0:v:0?", "-map", "0:a:0?"], "v": ["-map", "0:v:0"], "a": ["-map", "0:a:0"]}[flux]
    entree = ["-protocol_whitelist", "http,tcp,crypto", "-rw_timeout", "60000000", "-recv_buffer_size", "65536"]
    if liste:
        entree += ["-http_multiple", "0", "-extension_picky", "0"]
    # Fenêtre au tout début : aucune recherche (« -ss 0 » sur un HLS saute la première image clé).
    recherche = ["-ss", f"{debut_s:.3f}"] if debut_s > 0 else []
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "info", "-y", "-nostats", "-progress", "pipe:1",
           "-stats_period", "0.5", *entree, *recherche, "-t", f"{duree_s:.3f}", "-i", url, *carte,
           "-c", "copy", "-copyts", "-output_ts_offset", str(DECALAGE_S), "-f", "matroska", str(sortie)]
    journal = sortie.with_suffix(".log")
    with journal.open("ab") as err:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=err)
    assert proc.stdout is not None
    lignes: queue.Queue[str | None] = queue.Queue()

    def lecteur() -> None:
        assert proc.stdout is not None
        for brute in proc.stdout:
            lignes.put(brute.decode("utf-8", "replace").strip())
        lignes.put(None)

    threading.Thread(target=lecteur, name="ffmpeg-progress", daemon=True).start()
    t0: float | None = None
    derniere_nouvelle = time.monotonic()
    dernier_total = -1
    try:
        while True:
            try:
                ligne = lignes.get(timeout=0.5)
            except queue.Empty:
                ligne = ""
            if ligne is None:
                break
            if compteur.raison is not None or (arret is not None and arret() is not None):
                proc.kill()
                raise Depassement()
            if compteur.total != dernier_total:
                dernier_total, derniere_nouvelle = compteur.total, time.monotonic()
            if time.monotonic() - derniere_nouvelle > SILENCE_MAX_S:
                proc.kill()
                raise ApiError(504, "upstream_timeout", "La plateforme n'a plus rien envoyé pendant "
                                                        f"{int(SILENCE_MAX_S)} s : extrait abandonné.")
            cle, _, valeur = ligne.partition("=")
            if cle == "out_time_us" and valeur.lstrip("-").isdigit():
                derniere_nouvelle = time.monotonic()
                if t0 is None:
                    t0 = _lire_t0(journal)
                if progression is not None and duree_s > 0:
                    # out_time : durée déjà écrite dans la fenêtre (mesurée sur les horodatages copiés).
                    progression(max(0.0, min(1.0, int(valeur) / 1e6 / duree_s)))
        code = proc.wait()
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
        proc.stdout.close()
    texte = journal.read_bytes()[-200_000:].decode("utf-8", "replace")
    journal.unlink(missing_ok=True)
    if compteur.raison is not None:
        raise Depassement()
    if code != 0:
        log.warning("ffmpeg window failed", extra={"returncode": code, "stderr": _sans_url(texte[-1500:])})
        if flux == "a" and "matches no streams" in texte:
            # Piste son annoncée inconnue par la plateforme (acodec absent, ex. film muet d'Internet Archive) et
            # absente du fichier : refus clair, pas un « échec de récupération » (banc plateformes 2026-10-26).
            raise ApiError(400, "no_audio", "Ce média n'a pas de piste son : extrait sonore impossible.")
        raise ApiError(502, "download_failed", "La récupération du passage a échoué (flux interrompu ou illisible).")
    if t0 is None:
        m = _START_RE.search(texte)
        t0 = float(m.group(1)) if m else None
    if t0 is None:
        log.warning("ffmpeg start time not found, assuming 0")
        t0 = 0.0
    meta = _sonder(sortie) if sortie.is_file() else {}
    try:
        duree_fenetre = float((meta.get("format") or {}).get("duration") or 0)
    except (TypeError, ValueError):
        duree_fenetre = 0.0
    types = {s.get("codec_type") for s in meta.get("streams") or []}
    if duree_fenetre <= 0 or not types & {"video", "audio"}:
        raise hors_source("Le passage demandé ne contient aucune image ni aucun son (au-delà de la fin de la vidéo ?).")
    try:
        debut_fichier = float((meta.get("format") or {}).get("start_time") or 0)
    except (TypeError, ValueError):
        debut_fichier = 0.0
    video = next((s for s in meta.get("streams") or [] if s.get("codec_type") == "video"), None)
    return Fenetre(sortie, t0, "video" in types, "audio" in types, debut_fichier, _bornes(sortie),
                   _cadence(video) if video else None)


def _bornes(chemin: Path) -> dict[str, tuple[float, float]]:
    """Premier et dernier horodatage (pts) de chaque type de flux de la fenêtre."""
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "packet=codec_type,pts_time", "-of", "csv=p=0",
                          str(chemin)], capture_output=True, encoding="utf-8", errors="replace", timeout=120, check=False)
    bornes: dict[str, tuple[float, float]] = {}
    for ligne in out.stdout.splitlines():
        genre, _, pts = ligne.partition(",")
        try:
            t = float(pts.strip().rstrip(","))
        except ValueError:
            continue
        bas, haut = bornes.get(genre, (t, t))
        bornes[genre] = (min(bas, t), max(haut, t))
    return bornes


def _cadence(flux: dict[str, Any]) -> str | None:
    for cle in ("r_frame_rate", "avg_frame_rate"):
        brut = str(flux.get(cle) or "")
        num, _, den = brut.partition("/")
        try:
            valeur = float(num) / float(den or 1)
        except (ValueError, ZeroDivisionError):
            continue
        if 1 <= valeur <= 120:
            return brut
    return None


def couverture(fenetre: Fenetre, debut_s: float, duree_s: float) -> tuple[bool, bool]:
    """(début couvert, fin couverte) : la fenêtre contient-elle bien l'image (et le son) des deux bornes ?"""
    a, b = fenetre.absolu(debut_s), fenetre.absolu(debut_s + duree_s)
    debut_ok = fin_ok = True
    for genre, (premier, dernier) in fenetre.bornes.items():
        tolerance = 0.002 if genre == "video" else 0.05
        if premier > a + tolerance:
            debut_ok = False
        if dernier < b - (0.25 if genre == "video" else 0.15):
            fin_ok = False
    return debut_ok, fin_ok


def _lire_t0(journal: Path) -> float | None:
    try:
        with journal.open("rb") as f:
            texte = f.read(200_000).decode("utf-8", "replace")
    except OSError:
        return None
    m = _START_RE.search(texte)
    return float(m.group(1)) if m else None


def _sans_url(texte: str) -> str:
    return re.sub(r"https?://\S+", "<url>", texte)


def _sonder(chemin: Path) -> dict[str, Any]:
    out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", "--",
                          str(chemin)], capture_output=True, encoding="utf-8", errors="replace", timeout=60, check=False)
    try:
        return json.loads(out.stdout or "{}")
    except ValueError:
        return {}


# --- conversion précise (locale) ------------------------------------------------------------------------------------


def lancer_ffmpeg(args: list[str], duree_s: float, progression: Progression | None, etape: str) -> None:
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-nostats", "-progress", "pipe:1",
           "-stats_period", "0.5", *args]
    with tempfile.TemporaryFile() as err:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=err)
        assert proc.stdout is not None
        for brute in proc.stdout:
            cle, _, valeur = brute.decode("utf-8", "replace").strip().partition("=")
            if cle == "out_time_us" and valeur.isdigit() and progression is not None and duree_s > 0:
                progression(max(0.0, min(1.0, int(valeur) / 1e6 / duree_s)))
        if proc.wait() != 0:
            err.seek(max(0, err.seek(0, os.SEEK_END) - 1500))
            log.error("ffmpeg failed", extra={"stage": etape, "stderr": err.read().decode("utf-8", "replace")})
            raise ApiError(500, "conversion_failed", f"La conversion ffmpeg a échoué ({etape}).")


def _trim(fenetre: Fenetre, debut_s: float, duree_s: float, audio: bool = False) -> str:
    a = fenetre.relatif(debut_s)
    if audio:
        return f"atrim=start={a:.6f}:end={a + duree_s:.6f},asetpts=PTS-STARTPTS"
    return f"trim=start={a:.6f}:end={a + duree_s:.6f},setpts=PTS-STARTPTS"


def convertir_mp4(video: Fenetre, son: Fenetre | None, debut_s: float, duree_s: float, sortie: Path,
                  threads: int, taille_max: int, progression: Progression | None) -> None:
    """H.264/AAC, image exacte : trim sur les horodatages d'origine, tout le passage réencodé (lecture partout)."""
    entrees = ["-i", str(video.chemin)]
    filtres = [f"[0:v:0]{_trim(video, debut_s, duree_s)},scale=trunc(iw/2)*2:trunc(ih/2)*2[v]"]
    cartes = ["-map", "[v]"]
    if son is not None and son.audio:
        if son.chemin == video.chemin:
            filtres.append(f"[0:a:0]{_trim(son, debut_s, duree_s, audio=True)}[a]")
        else:
            entrees += ["-i", str(son.chemin)]
            filtres.append(f"[1:a:0]{_trim(son, debut_s, duree_s, audio=True)}[a]")
        cartes += ["-map", "[a]"]
    # Cadence fixe = celle de la source : horodatages Matroska arrondis à la milliseconde remis sur la grille, et la
    # dernière image garde sa durée (sans cela le MP4 la plaçait hors de sa liste d'édition : une image en moins).
    cadence = ["-fps_mode:v", "cfr", "-r:v", video.ips] if video.ips else ["-fps_mode:v", "passthrough"]
    args = [*entrees, "-filter_complex", ";".join(filtres), *cartes, *cadence,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-profile:v", "high",
            "-threads", str(threads)]
    if len(cartes) > 2:
        args += ["-c:a", "aac", "-b:a", "160k", "-ac", "2"]  # stéréo : un son 5.1 (itag 258) se lit partout ainsi
    args += ["-movflags", "+faststart", "-fs", str(taille_max), str(sortie)]
    lancer_ffmpeg(args, duree_s, progression, "conversion:mp4")


def convertir_mp3(son: Fenetre, debut_s: float, duree_s: float, sortie: Path, bitrate: int, titre: str | None,
                  artiste: str | None, pochette: Path | None, progression: Progression | None) -> bool:
    """MP3 au débit demandé, échantillon exact. Renvoie False si la pochette a dû être abandonnée."""
    base = ["-i", str(son.chemin)]
    filtre = ["-filter_complex", f"[0:a:0]{_trim(son, debut_s, duree_s, audio=True)}[a]", "-map", "[a]",
              "-c:a", "libmp3lame", "-b:a", f"{bitrate}k", "-ac", "2", "-id3v2_version", "3"]
    meta: list[str] = []
    if titre:
        meta += ["-metadata", f"title={titre[:200]}"]
    if artiste:
        meta += ["-metadata", f"artist={artiste[:200]}"]
    if pochette is not None:
        try:
            lancer_ffmpeg([*base, "-i", str(pochette), *filtre, "-map", "1:v:0", "-c:v", "copy",
                           "-disposition:v:0", "attached_pic", *meta, str(sortie)], duree_s, progression, "conversion:mp3")
            return True
        except ApiError:
            sortie.unlink(missing_ok=True)
    lancer_ffmpeg([*base, *filtre, *meta, str(sortie)], duree_s, progression, "conversion:mp3")
    return pochette is None


def convertir_gif(video: Fenetre, debut_s: float, duree_s: float, sortie: Path, largeur: int, ips: int,
                  progression: Progression | None) -> None:
    palette = sortie.with_name("palette.png")
    echelle = f"{_trim(video, debut_s, duree_s)},fps={ips},scale='min({largeur},iw)':-2:flags=lanczos"
    lancer_ffmpeg(["-i", str(video.chemin), "-vf", f"{echelle},palettegen=stats_mode=diff", "-update", "1",
                   "-frames:v", "1", str(palette)], duree_s,
                  None if progression is None else (lambda f: progression(f * 0.4)), "conversion:gif-palette")
    lancer_ffmpeg(["-i", str(video.chemin), "-i", str(palette), "-lavfi",
                   f"[0:v:0]{echelle}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
                   "-loop", "0", str(sortie)], duree_s,
                  None if progression is None else (lambda f: progression(0.4 + f * 0.6)), "conversion:gif")
    palette.unlink(missing_ok=True)


# --- plan d'un extrait ----------------------------------------------------------------------------------------------


@dataclass
class Partie:
    """Un format demandé à yt-dlp (vidéo seule, son seul, ou les deux)."""

    url: str
    protocole: str
    entetes: dict[str, str]
    extensions: dict[str, Any]
    video: bool
    audio: bool
    tbr: float | None = None  # kbit/s
    taille: int | None = None  # fichier complet (filesize, ou approximatif)
    format_id: str = ""
    brut: dict[str, Any] = field(default_factory=dict)


def protocole_de(fmt: dict[str, Any]) -> str:
    from yt_dlp.utils import determine_protocol

    try:
        return str(fmt.get("protocol") or determine_protocol(fmt))
    except Exception:  # noqa: BLE001
        return str(fmt.get("protocol") or "")


def format_partiel(fmt: dict[str, Any]) -> bool:
    """Format lisible par morceaux : fichier HTTP(S) à accès direct ou liste HLS, sans DRM ni fragments pré-découpés
    (les formats « dashy » de YouTube : fragments de 10 Mio sans durée, que yt-dlp lui-même refuse de découper)."""
    if fmt.get("has_drm") or not fmt.get("url") or fmt.get("fragments"):
        return False
    return protocole_de(fmt) in PROTOCOLES_PARTIELS


def parties_de(info: dict[str, Any], impersonation: Callable[[Any], dict[str, Any]] | None = None) -> list[Partie]:
    parties = []
    duree = info.get("duration")
    for fmt in info.get("requested_formats") or [info]:
        video = (fmt.get("vcodec") or "none") != "none"
        audio = (fmt.get("acodec") or "none") != "none"
        if not video and not audio:  # codecs inconnus (X) : un format muxé
            video = audio = True
        tbr = fmt.get("tbr") or ((fmt.get("vbr") or 0) + (fmt.get("abr") or 0)) or None
        taille = fmt.get("filesize") or fmt.get("filesize_approx")
        if not taille and tbr and duree:
            taille = int(tbr * 1000 / 8 * duree)
        parties.append(Partie(
            url=str(fmt.get("url")), protocole=protocole_de(fmt),
            entetes={str(k): str(v) for k, v in (fmt.get("http_headers") or info.get("http_headers") or {}).items()},
            extensions=(impersonation(fmt.get("impersonate")) if impersonation and fmt.get("impersonate") else {}),
            video=video, audio=audio, tbr=float(tbr) if tbr else None, taille=int(taille) if taille else None,
            format_id=str(fmt.get("format_id") or ""), brut=fmt))
    return parties


def estimation_fenetre(parties: list[Partie], fenetre_s: float) -> int | None:
    """Octets de la fenêtre d'après le débit annoncé (None si un débit manque)."""
    if any(p.tbr is None for p in parties):
        return None
    return int(sum(p.tbr or 0 for p in parties) * 1000 / 8 * fenetre_s)


@dataclass
class Plan:
    fmt: str
    debut_s: float
    duree_s: float
    parties: list[Partie]

    @property
    def fenetre(self) -> tuple[float, float]:
        debut = max(0.0, self.debut_s - MARGE_S)
        return debut, self.debut_s + self.duree_s + MARGE_S - debut

    def flux_de(self, partie: Partie) -> str:
        if self.fmt == "mp3":
            return "a"
        if self.fmt == "gif":
            return "v"
        if partie.video and partie.audio:
            return "va"
        return "v" if partie.video else "a"


def recuperer(plan: Plan, relais: Relais, dossier: Path, progression: Progression | None = None,
              duree_source: float | None = None) -> list[Fenetre]:
    """Phase 1 : une fenêtre locale par format utile (vidéo puis son), par le relais. La progression mesurée est la
    part de la fenêtre déjà copiée par ffmpeg (durée écrite / durée de la fenêtre), formats pondérés par leur débit.

    Chaque fenêtre est contrôlée : si elle ne contient pas l'image (ou le son) du début demandé — images clés
    espacées, recherche HLS qui démarre à l'image clé suivante —, elle est refaite avec une marge plus large
    (MARGES_S) ; ces octets comptent aussi."""
    utiles = [(i, p) for i, p in enumerate(plan.parties)
              if not (plan.fmt == "gif" and not p.video) and not (plan.fmt == "mp3" and not p.audio)]
    poids = [max(p.tbr or 1.0, 1.0) for _, p in utiles]
    total_poids = sum(poids) or 1.0
    fait = 0.0
    fenetres = []
    for (i, partie), w in zip(utiles, poids):
        liste = partie.protocole.startswith("m3u8")
        part = w / total_poids
        fenetre: Fenetre | None = None
        for essai, marge in enumerate(MARGES_S):
            debut = max(0.0, plan.debut_s - marge)
            duree = plan.debut_s + plan.duree_s + MARGE_S - debut
            estimation = estimation_fenetre([partie], duree)
            pas_max = max(PAS_PLANCHER, min(PAS_MAX, estimation // 4)) if estimation else PAS_MAX
            url = relais.ajouter(partie.url, partie.entetes, partie.extensions, "liste" if liste else "fichier", i,
                                 pas_max)

            def suivre(f: float | None, base: float = fait, part: float = part) -> None:
                if progression is not None and f is not None:
                    progression(base + f * part)

            fenetre = ffmpeg_fenetre(url, liste, debut, duree, plan.flux_de(partie), dossier / f"fenetre{i}-{essai}.mkv",
                                     relais.compteur, suivre)
            debut_ok, fin_ok = couverture(fenetre, plan.debut_s, plan.duree_s)
            fin_source = duree_source is not None and plan.debut_s + plan.duree_s >= duree_source - 1.0
            if (debut_ok or debut == 0.0) and (fin_ok or fin_source):
                break
            log.info("clip window does not cover the range, widening", extra={
                "attempt": essai + 1, "margin_s": marge, "start_ok": debut_ok, "end_ok": fin_ok})
            if essai + 1 < len(MARGES_S):
                fenetre.chemin.unlink(missing_ok=True)
        assert fenetre is not None
        fenetres.append(fenetre)
        fait += part
        if progression is not None:
            progression(min(1.0, fait))
    return fenetres


def budget_pour(estimation: int | None, limite: int, marge: int | None = None) -> int:
    """Budget adaptatif d'un extrait : 3 × l'estimation de la fenêtre + une marge (index, morceaux entamés), jamais
    plus que la limite configurée ; sans estimation (débit inconnu), la limite seule."""
    if estimation is None:
        return limite
    return min(limite, BUDGET_FACTEUR * estimation + (BUDGET_MARGE if marge is None else marge))


def refus_403(relais: Relais) -> set[int]:
    """Parties dont un flux a été refusé par la plateforme (HTTP 403) : base du repli YouTube sur un autre client."""
    return {i.partie for i in relais.incidents if i.statut == 403}


def erreur_amont(relais: Relais, plateforme: str) -> ApiError | None:
    """Erreur de la plateforme vue par le relais, traduite (sinon None : échec de ffmpeg lui-même)."""
    if not relais.incidents:
        return None
    incident = relais.incidents[0]
    if incident.statut == 403:
        detail = ("La plateforme refuse le flux du média (HTTP 403), même après repli sur un autre client."
                  if plateforme == "youtube" else "La plateforme refuse le flux du média (HTTP 403).")
        return ApiError(502, "upstream_forbidden", detail)
    if incident.statut == 200:
        return partiel_impossible("Cette source ne permet pas de récupérer seulement le passage demandé (elle ignore "
                                  "les requêtes partielles) : rien de plus n'a été téléchargé.")
    if incident.statut in (404, 410):
        return ApiError(502, "download_failed", "Le flux du média a disparu pendant la récupération (HTTP "
                                                f"{incident.statut}) : réessayez.")
    if incident.statut == 429:
        return ApiError(503, "upstream_rate_limited", "La plateforme limite le serveur : réessayez plus tard.")
    if incident.statut is not None and incident.statut >= 500:
        return ApiError(503, "upstream_unavailable", "La plateforme a renvoyé une erreur serveur (HTTP "
                                                     f"{incident.statut}) : réessayez plus tard.")
    if "adresse refusée" in incident.message:
        return ApiError(502, "upstream_error", "Le flux désigne une adresse refusée par le serveur.")
    return ApiError(502, "download_failed", "La récupération du passage a été interrompue : réessayez.")


def erreur_depassement(compteur: Compteur) -> ApiError:
    if compteur.raison == "limite":
        return partiel_impossible(f"Récupérer ce passage demanderait plus de {mo(compteur.limite)} (limite du serveur "
                                  "par extrait) : le transfert a été arrêté. Choisis un passage plus court ou une "
                                  "qualité plus basse.")
    return partiel_impossible(f"Cette source ne permet pas de récupérer seulement le passage demandé : il aurait "
                              f"fallu télécharger bien plus que l'extrait (arrêt à {mo(compteur.total)}). Aucun "
                              "téléchargement complet n'est fait.")
