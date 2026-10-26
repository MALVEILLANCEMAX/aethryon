"""Data of AETHRYON Music: what a connector found (Fiche), what it can really do (capacités), what is downloadable.

Three states are kept apart everywhere (MUSIC-API.md):
- `identifie`       TITRE IDENTIFIÉ: metadata from the official API (title, artist…), nothing to download;
- `correspondance`  CORRESPONDANCE TROUVÉE: a file the user already owns (Desktop library, his Cloud) matches;
- `telechargeable`  FICHIER RÉELLEMENT TÉLÉCHARGEABLE: the source explicitly allows the download (free licence or
                    public domain, podcast enclosure, the user's own file).
plus `lien_reconnu` (the link is valid, but no metadata could be read: credentials missing, API closed…).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .licences import Licence

CAPACITES = ("Metadata", "Search", "Preview", "Playback", "AuthorizedDownload", "Import")
ETATS = ("lien_reconnu", "identifie", "correspondance", "telechargeable")

# Audio formats AETHRYON Music imports (extension -> (MIME type, ffmpeg demuxer)). Same list as the cloud of account
# (account/src/cloud/service.ts TYPES): an imported file can always be backed up.
AUDIO_TYPES: dict[str, tuple[str, str]] = {
    "mp3": ("audio/mpeg", "mp3"),
    "ogg": ("audio/ogg", "ogg"),
    "opus": ("audio/ogg", "ogg"),
    "flac": ("audio/flac", "flac"),
    "wav": ("audio/wav", "wav"),
    "m4a": ("audio/mp4", "mov,mp4,m4a,3gp,3g2,mj2"),
}
EXT_ALIASES = {"oga": "ogg", "wave": "wav", "mpga": "mp3"}
MIME_TO_EXT = {
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/ogg": "ogg", "application/ogg": "ogg", "audio/opus": "opus",
    "audio/flac": "flac", "audio/x-flac": "flac", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
    "audio/vnd.wave": "wav", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a", "audio/aac": "m4a",
}


def ext_of(name: str) -> str | None:
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    ext = EXT_ALIASES.get(ext, ext)
    return ext if ext in AUDIO_TYPES else None


@dataclass
class Fichier:
    """A file the source publishes for download (official URL from its API, never built from a stream)."""

    nom: str
    url: str
    extension: str
    type_mime: str
    taille: int | None = None
    format: str | None = None  # label given by the source ("VBR MP3", "Flac"…)
    duree_s: float | None = None
    md5: str | None = None  # hex, when the source publishes it (Internet Archive)
    sha1: str | None = None  # hex (Wikimedia Commons)
    original: bool = False

    def to_json(self) -> dict[str, Any]:
        return {"nom": self.nom, "url": self.url, "extension": self.extension, "type": self.type_mime,
                "taille": self.taille, "format": self.format, "dureeS": self.duree_s, "original": self.original,
                "empreintePubliee": bool(self.md5 or self.sha1)}


@dataclass
class Piste:
    titre: str | None
    artistes: list[str] = field(default_factory=list)
    album: str | None = None
    duree_s: float | None = None
    isrc: str | None = None
    numero: int | None = None
    url: str | None = None  # official page
    id: str | None = None  # id at the source (Spotify id, episode guid, file base name…)
    date: str | None = None
    pochette: str | None = None
    fichiers: list[Fichier] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return {"titre": self.titre, "artistes": self.artistes, "album": self.album, "dureeS": self.duree_s,
                "isrc": self.isrc, "numero": self.numero, "url": self.url, "id": self.id, "date": self.date,
                "pochette": self.pochette, "fichiers": [f.to_json() for f in self.fichiers]}


@dataclass
class Fiche:
    connecteur: str
    type: str  # titre | album | playlist | artiste | episode | podcast | element | fichier
    id: str
    url: str  # canonical official URL
    titre: str | None = None
    artistes: list[str] = field(default_factory=list)
    album: str | None = None
    duree_s: float | None = None
    isrc: str | None = None
    date: str | None = None
    pochette: str | None = None
    pistes: list[Piste] = field(default_factory=list)
    pistes_total: int | None = None  # announced by the source (the list may be truncated)
    licence: Licence | None = None
    attribution: str | None = None
    capacites: list[str] = field(default_factory=list)
    actions: list[dict[str, Any]] = field(default_factory=list)
    restrictions: list[str] = field(default_factory=list)
    manque: list[str] = field(default_factory=list)  # what is missing, and why
    avertissements: list[str] = field(default_factory=list)
    source_metadonnees: str | None = None  # api_web | oembed | itunes | archive | commons | rss | entetes | aucune
    snapshot: str | None = None  # Spotify playlist version
    via: str | None = None  # e.g. apple_podcasts -> podcast

    @property
    def etat(self) -> str:
        if "AuthorizedDownload" in self.capacites:
            return "telechargeable"
        return "identifie" if self.titre else "lien_reconnu"

    def to_json(self) -> dict[str, Any]:
        actions, capacites = garantir_lien_apercu(self.actions, self.capacites)
        return {
            "connecteur": self.connecteur, "type": self.type, "id": self.id, "url": self.url, "etat": self.etat,
            "titre": self.titre, "artistes": self.artistes, "album": self.album, "dureeS": self.duree_s,
            "isrc": self.isrc, "date": self.date, "pochette": self.pochette,
            "pistes": [p.to_json() for p in self.pistes], "pistesTotal": self.pistes_total,
            "licence": self.licence.to_json() if self.licence else None, "attribution": self.attribution,
            "capacites": [c for c in CAPACITES if c in capacites], "actions": actions,
            "restrictions": self.restrictions, "manque": self.manque, "avertissements": self.avertissements,
            "sourceMetadonnees": self.source_metadonnees, "snapshot": self.snapshot, "via": self.via,
        }


def action_ouvrir(nom_service: str, url: str) -> dict[str, Any]:
    return {"id": "ouvrir", "libelle": f"Ouvrir {nom_service}", "url": url}


def action_lecteur(fournisseur: str, embed: str, hauteur: int, note: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"id": "lecteur_officiel", "libelle": f"Écouter avec le lecteur officiel {fournisseur}",
                           "embed": embed, "hauteur": hauteur}
    if note:
        out["note"] = note
    return out


def lien_ouvrir(actions: list[dict[str, Any]]) -> dict[str, str] | None:
    """The official link of a fiche, {"libelle": "Ouvrir dans Apple Music", "url": "https://…"}, taken from its `ouvrir`
    action; None when the fiche has no usable one (https, no space)."""
    for a in actions:
        url, libelle = a.get("url"), a.get("libelle")
        if (a.get("id") == "ouvrir" and isinstance(url, str) and url.startswith("https://") and " " not in url
                and isinstance(libelle, str) and libelle):
            return {"libelle": libelle, "url": url}
    return None


def action_apercu(url: str, fournisseur: str, mention: str, lien: dict[str, str]) -> dict[str, Any]:
    """The 30 s preview action. `lien` is MANDATORY (decision of the owner, 2026-10-23): a preview never goes out without
    the link to the service, shown as the button « Ouvrir dans Apple Music » (the same link as the `ouvrir` action)."""
    if not (isinstance(lien, dict) and str(lien.get("url", "")).startswith("https://") and lien.get("libelle")):
        raise ValueError("an AETHRYON Music preview needs the link to the service (« Ouvrir dans … »)")
    return {"id": "apercu", "libelle": "Aperçu de 30 s", "url": url, "dureeS": 30, "fournisseur": fournisseur,
            "mention": mention, "lectureSeulement": True, "lien": {"libelle": lien["libelle"], "url": lien["url"]},
            "note": "Extrait de 30 secondes lu depuis les serveurs du fournisseur : ce n'est pas le morceau complet "
                    "et il n'est jamais enregistré. Le morceau complet : bouton « " + lien["libelle"] + " »."}


def ajouter_apercu(fiche: Fiche, url: str, fournisseur: str, mention: str) -> bool:
    """Adds the preview (and the `Preview` capability) to the fiche, ONLY if the fiche carries its official link: the
    preview and the button « Ouvrir dans … » always travel together. Returns whether the preview was added."""
    lien = lien_ouvrir(fiche.actions)
    if lien is None or not (isinstance(url, str) and url.startswith("https://") and " " not in url):
        return False
    if "Preview" not in fiche.capacites:
        fiche.capacites.append("Preview")
    fiche.actions.insert(1, action_apercu(url, fournisseur, mention, lien))
    return True


def garantir_lien_apercu(actions: list[dict[str, Any]], capacites: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
    """Last guard, applied to EVERY fiche before it leaves the API: a preview whose link is missing or differs from the
    `ouvrir` action is removed (with the `Preview` capability when none is left) — never returned without its button."""
    lien = lien_ouvrir(actions)
    kept = [a for a in actions if a.get("id") != "apercu" or (lien is not None and a.get("lien") == lien)]
    if any(a.get("id") == "apercu" for a in kept):
        return kept, capacites
    return kept, [c for c in capacites if c != "Preview"]


ACTION_ENREGISTRER = {"id": "enregistrer_lien", "libelle": "Enregistrer le lien dans ma bibliothèque",
                      "executePar": "client",
                      "note": "Le Desktop garde le lien et la fiche (aucun fichier audio)."}


def action_importer(requete: dict[str, Any], attestation: bool = False, libelle: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"id": "importer", "libelle": libelle or "Importer dans ma bibliothèque",
                           "requete": {"methode": "POST", "chemin": "/music/imports", "corps": requete}}
    if attestation:
        out["attestationRequise"] = True
        out["attestation"] = ("Je possède ce fichier ou je dispose des droits nécessaires pour le télécharger, et "
                              "la source le met à disposition pour le téléchargement.")
    return out


@dataclass
class Identifiant:
    nom: str
    configure: bool
    requis_pour: str
    obtention: str

    def to_json(self) -> dict[str, Any]:
        return {"nom": self.nom, "configure": self.configure, "requisPour": self.requis_pour,
                "obtention": self.obtention}


@dataclass
class InfoConnecteur:
    id: str
    nom: str
    famille: str  # catalogue (never any download) | source_libre
    actif: bool
    capacites: list[str]  # real capabilities in THIS configuration
    capacites_avec_identifiants: list[str]
    identifiants: list[Identifiant]
    limites: list[str]
    conditions: list[str]  # official terms read (URLs)

    def to_json(self) -> dict[str, Any]:
        return {"id": self.id, "nom": self.nom, "famille": self.famille, "actif": self.actif,
                "capacites": [c for c in CAPACITES if c in self.capacites],
                "capacitesAvecIdentifiants": [c for c in CAPACITES if c in self.capacites_avec_identifiants],
                "identifiants": [i.to_json() for i in self.identifiants], "limites": self.limites,
                "conditions": self.conditions}
