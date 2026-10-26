"""Registre UNIQUE des plateformes (app/plateformes.json) : nom, domaines, catégorie, extracteurs yt-dlp autorisés,
état (officielle / beta / indisponible / refusee), formats permis, icône neutre.

Tout le reste en dérive : domaines reconnus (app.urls), extracteurs autorisés par le worker (fermé par défaut),
domaines acceptés par défaut (app.config), vue publique GET /platforms, copie du site (scripts/sync-plateformes.py).

Règles :
- seule une plateforme TESTÉE réellement avec succès (banc/plateformes_reel.py --reel) passe en « officielle » ;
- une plateforme « beta » n'est acceptée que si le réglage PLATEFORMES_BETA la nomme (désactivée par défaut) ;
- « indisponible » : connue mais coupée, refus 503 `platform_unavailable` ;
- « refusee » : jamais téléchargée (DRM, streaming payant, catalogue musical, conditions), refus 400 avant tout travail ;
- jamais l'extracteur « generic », ni un extracteur de redirection, de liste, de chaîne ou de recherche.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

REGISTRY_PATH = Path(__file__).with_name("plateformes.json")

ETATS = ("officielle", "beta", "indisponible", "refusee")
CATEGORIES = ("populaires", "musique", "streaming", "autres")
FORMATS = ("mp4", "mp3", "gif", "extrait")
# Noms d'extracteurs qu'aucun motif du registre ne peut couvrir : le générique (n'importe quel site) et les
# redirections (une carte ou un lien court peut mener le serveur n'importe où). Les extracteurs de listes des nouvelles
# plateformes sont vérifiés par les essais (tests/test_plateformes.py, noms réels de yt-dlp).
AGENTS = ("identifie",)
AGENT_IDENTIFIE = "AETHRYON/1.0 (+https://raccourci.malvu.fr) yt-dlp"
FORBIDDEN_EXTRACTOR_NAMES = ("generic", "twitter:shortener", "facebookredirecturl", "generic:quoted-html")
_ID_RE = re.compile(r"[a-z][a-z0-9_]{1,30}")
_DOMAIN_RE = re.compile(r"[a-z0-9-]+(\.[a-z0-9-]+)+")


class RegistryError(ValueError):
    """Registre invalide : le service refuse de démarrer plutôt que d'ouvrir une plateforme par erreur."""


@dataclass(frozen=True)
class Plateforme:
    id: str
    nom: str
    categorie: str
    etat: str
    domaines: tuple[str, ...]
    icone: str
    extracteurs: tuple[str, ...] = ()
    formats: tuple[str, ...] = ()
    priorite: str | None = None
    conditions: str | None = None
    motif: str | None = None
    code: str | None = None  # code de refus propre (refusee), sinon platform_not_accepted
    essai: str | None = None  # dernier banc réel (banc/plateformes_reel.py) : date et résultat
    # « identifie » : yt-dlp s'annonce avec AGENT_IDENTIFIE (contact) au lieu d'un navigateur. Exigé par la politique
    # User-Agent de Wikimedia (un robot qui imite un navigateur peut être bloqué sans préavis).
    agent: str | None = None

    @property
    def telechargeable(self) -> bool:
        """Peut faire tourner yt-dlp (avec ses propres extracteurs) si elle est activée."""
        return self.etat in ("officielle", "beta") and bool(self.extracteurs)

    def public(self) -> dict[str, Any]:
        out: dict[str, Any] = {"id": self.id, "nom": self.nom, "categorie": self.categorie, "etat": self.etat,
                               "icone": self.icone, "domaines": list(self.domaines)}
        if self.formats:
            out["formats"] = list(self.formats)
        if self.priorite:
            out["priorite"] = self.priorite
        if self.conditions:
            out["conditions"] = self.conditions
        if self.motif:
            out["motif"] = self.motif
        if self.essai:
            out["essai"] = self.essai
        return out


@dataclass(frozen=True)
class Registre:
    version: str
    ytdlp: str
    categories: tuple[dict[str, str], ...]
    icones: dict[str, str]
    plateformes: tuple[Plateforme, ...]
    _by_id: dict[str, Plateforme] = field(default_factory=dict, compare=False, repr=False)

    def get(self, pid: str) -> Plateforme | None:
        return self._by_id.get(pid)

    def ids(self, *etats: str) -> tuple[str, ...]:
        return tuple(p.id for p in self.plateformes if not etats or p.etat in etats)

    def for_host(self, host: str) -> Plateforme | None:
        """Plateforme dont un domaine est l'hôte ou l'un de ses parents (frontière d'étiquette). Le domaine le plus
        long gagne : music.youtube.com (refusé) avant youtube.com, music.apple.com sans toucher apple.com."""
        bare = host.strip().lower().rstrip(".")
        best: tuple[int, Plateforme] | None = None
        for p in self.plateformes:
            for d in p.domaines:
                if (bare == d or bare.endswith("." + d)) and (best is None or len(d) > best[0]):
                    best = (len(d), p)
        return best[1] if best else None

    def extractors(self, avec_indisponibles: bool = False) -> dict[str, list[str]]:
        """Extracteurs autorisés par plateforme téléchargeable (le worker n'en connaît pas d'autres). Avec
        `avec_indisponibles` : aussi ceux des plateformes coupées (contrôle de forme des liens, banc réel)."""
        return {p.id: list(p.extracteurs) for p in self.plateformes
                if p.telechargeable or (avec_indisponibles and p.etat == "indisponible" and p.extracteurs)}

    def domains(self, *etats: str) -> tuple[str, ...]:
        return tuple(d for p in self.plateformes if p.etat in etats for d in p.domaines)


def _plateforme(raw: dict[str, Any], icones: dict[str, str]) -> Plateforme:
    pid = raw.get("id")
    if not isinstance(pid, str) or not _ID_RE.fullmatch(pid):
        raise RegistryError(f"identifiant invalide : {pid!r}")
    etat, cat, icone = raw.get("etat"), raw.get("categorie"), raw.get("icone")
    if etat not in ETATS:
        raise RegistryError(f"{pid} : état inconnu {etat!r}")
    if cat not in CATEGORIES:
        raise RegistryError(f"{pid} : catégorie inconnue {cat!r}")
    if icone not in icones:
        raise RegistryError(f"{pid} : icône inconnue {icone!r}")
    domaines = tuple(raw.get("domaines") or ())
    if not domaines or not all(isinstance(d, str) and _DOMAIN_RE.fullmatch(d) for d in domaines):
        raise RegistryError(f"{pid} : domaines invalides")
    extracteurs = tuple(raw.get("extracteurs") or ())
    formats = tuple(raw.get("formats") or ())
    if etat in ("officielle", "beta"):
        if not extracteurs:
            raise RegistryError(f"{pid} : aucune liste d'extracteurs (fermé par défaut)")
        if not formats or any(f not in FORMATS for f in formats):
            raise RegistryError(f"{pid} : formats invalides")
    elif etat == "refusee" and extracteurs:
        raise RegistryError(f"{pid} : une plateforme refusée n'a pas d'extracteurs")
    agent = raw.get("agent")
    if agent is not None and agent not in AGENTS:
        raise RegistryError(f"{pid} : agent inconnu {agent!r}")
    for pattern in extracteurs:
        if not isinstance(pattern, str) or pattern != pattern.lower():
            raise RegistryError(f"{pid} : extracteur invalide {pattern!r}")
        re.compile(pattern)
        if any(re.fullmatch(pattern, name) for name in FORBIDDEN_EXTRACTOR_NAMES):
            raise RegistryError(f"{pid} : le motif {pattern!r} couvre un extracteur interdit")
    return Plateforme(id=pid, nom=str(raw["nom"]), categorie=cat, etat=etat, domaines=domaines, icone=icone,
                      extracteurs=extracteurs, formats=formats, priorite=raw.get("priorite"),
                      conditions=raw.get("conditions"), motif=raw.get("motif"), code=raw.get("code"),
                      essai=raw.get("essai"), agent=agent)


def parse_registry(data: dict[str, Any]) -> Registre:
    icones = data.get("icones") or {}
    plateformes = tuple(_plateforme(p, icones) for p in data.get("plateformes") or ())
    by_id: dict[str, Plateforme] = {}
    owner: dict[str, str] = {}
    for p in plateformes:
        if p.id in by_id:
            raise RegistryError(f"plateforme en double : {p.id}")
        by_id[p.id] = p
        for d in p.domaines:
            if d in owner:
                raise RegistryError(f"domaine {d} déclaré par {owner[d]} et {p.id}")
            owner[d] = p.id
    categories = tuple(data.get("categories") or ())
    if tuple(c.get("id") for c in categories) != CATEGORIES:
        raise RegistryError("catégories attendues : Populaires, Musique, Streaming, Autres")
    return Registre(version=str(data.get("version")), ytdlp=str(data.get("ytdlp")), categories=categories,
                    icones=dict(icones), plateformes=plateformes, _by_id=by_id)


@lru_cache(maxsize=1)
def registre() -> Registre:
    return parse_registry(json.loads(REGISTRY_PATH.read_text(encoding="utf-8")))


def formats_proposes(platform: str, *, video: bool, audio: bool, duration: float | None) -> list[str]:
    """Conversions offered for ONE media, from its REAL metadata (formats yt-dlp found), within what the registry
    permits for the platform: mp4 and gif need a video track, mp3 a sound track, a clip a known duration."""
    found = registre().get(platform)
    permis = found.formats if found is not None else FORMATS
    possible = {"mp4": video, "mp3": audio, "gif": video, "extrait": bool(duration) and (video or audio)}
    return [f for f in FORMATS if f in permis and possible[f]]


def public_view(enabled: tuple[str, ...], health: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    """Données pour l'interface (aucune requête réseau) : catégories, icônes, plateformes avec leur disponibilité.

    `disponible` : acceptée ET pas en pause (disjoncteur). Une plateforme beta non activée n'est pas listée comme
    disponible ; une refusée l'est avec son motif, pour un message clair."""
    reg = registre()
    health = health or {}
    items = []
    for p in reg.plateformes:
        item = p.public()
        state = health.get(p.id) or {}
        active = p.id in enabled
        paused = bool(state.get("cooldown_until"))
        item["active"] = active
        item["disponible"] = active and not paused and p.etat in ("officielle", "beta")
        if active and state:
            item["sante"] = {k: state.get(k) for k in ("state", "since", "last_success", "cooldown_until")}
        items.append(item)
    return {"version": reg.version, "ytdlp": reg.ytdlp, "categories": list(reg.categories),
            "icones": reg.icones, "plateformes": items}
