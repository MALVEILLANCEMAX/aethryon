"""Attribution des médias sous licence libre (Wikimedia Commons) : auteur, licence, source.

Source : API officielle de Commons, `prop=imageinfo&iiprop=url|extmetadata` (extension CommonsMetadata,
https://www.mediawiki.org/wiki/Extension:CommonsMetadata). Champs lus : Artist (HTML, auteur), Attribution (attribution
imposée, remplace Artist et Credit), Credit (HTML, source d'origine), LicenseShortName (« le plus fiable »), LicenseUrl,
License (code), AttributionRequired, Copyrighted (False = domaine public), NonFree (true = non libre).

Règle : un fichier n'est converti que si sa licence est CONNUE et LIBRE (domaine public, CC0, CC BY, CC BY-SA, GFDL,
Art libre) ; licence inconnue, non libre (NC, ND, NonFree) ou attribution exigée sans auteur connu → refus 400
`license_not_free` avant tout téléchargement. Une seule requête à l'API par média, par le client réseau de yt-dlp
(User-Agent identifié, politique de Wikimedia).
"""

from __future__ import annotations

import html
import json
import re
from html.parser import HTMLParser
from typing import Any
from urllib.parse import quote, unquote, urlsplit

from .errors import ApiError

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
CHAMPS = ("Artist", "Attribution", "Credit", "LicenseShortName", "LicenseUrl", "License", "AttributionRequired",
          "Copyrighted", "NonFree", "ObjectName")
# Codes « License » de CommonsMetadata (ou nom court) acceptés : licences libres au sens de Commons.
_LIBRE_RE = re.compile(r"(?:pd|public domain|domaine public|cc0|cc-zero|cc-by(?:-sa)?|cc by(?: sa|-sa)?|gfdl|fal|"
                       r"art libre|free art)(?:\b|[-_ .0-9a-z]*)$", re.I)
_NON_LIBRE_RE = re.compile(r"(?:^|[-_ ])(?:nc|nd)(?:$|[-_ .0-9])", re.I)
_MAX = 300


class _Liens(HTMLParser):
    """Texte d'un fragment HTML de Commons et ses liens externes (class « external »)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.texte: list[str] = []
        self.liens: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            a = dict(attrs)
            href = a.get("href") or ""
            if "external" in (a.get("class") or "") and href.startswith(("https://", "http://")):
                self.liens.append(href)

    def handle_data(self, data: str) -> None:
        self.texte.append(data)


def _html(fragment: Any) -> tuple[str, list[str]]:
    if not isinstance(fragment, str) or not fragment.strip():
        return "", []
    parser = _Liens()
    parser.feed(fragment)
    parser.close()
    texte = re.sub(r"\s+", " ", html.unescape("".join(parser.texte))).strip()
    return texte[:_MAX], parser.liens


def _valeur(meta: dict[str, Any], champ: str) -> Any:
    item = meta.get(champ)
    return item.get("value") if isinstance(item, dict) else None


def _vrai(valeur: Any) -> bool:
    return str(valeur).strip().lower() in ("true", "1", "yes", "oui")


def titre_commons(url: str | None) -> str | None:
    """« File:Nom.webm » d'une page de fichier Commons (https://commons.wikimedia.org/wiki/File:…), sinon None."""
    if not url:
        return None
    parts = urlsplit(url)
    if not (parts.hostname or "").endswith("commons.wikimedia.org") or not parts.path.startswith("/wiki/"):
        return None
    titre = unquote(parts.path[len("/wiki/"):]).replace("_", " ").strip()
    if ":" not in titre:
        return None
    espace, nom = titre.split(":", 1)
    if espace.lower() not in ("file", "fichier", "image") or not nom.strip():
        return None
    return "File:" + nom.strip()


def url_api(titre: str) -> str:
    return (f"{COMMONS_API}?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=url%7Cextmetadata"
            f"&iiextmetadatafilter={'%7C'.join(CHAMPS)}&iiextmetadatalanguage=fr&titles={quote(titre, safe='')}")


def refus(detail: str) -> ApiError:
    return ApiError(400, "license_not_free", f"Wikimedia Commons : {detail} Conversion refusée.")


def attribution_depuis(reponse: dict[str, Any], titre: str) -> dict[str, Any]:
    """Attribution prête à afficher depuis la réponse de l'API ; ApiError license_not_free si la licence n'est pas
    connue et libre, ou si l'attribution est exigée sans auteur connu."""
    pages = ((reponse.get("query") or {}).get("pages")) or []
    page = pages[0] if pages and isinstance(pages[0], dict) else {}
    infos = page.get("imageinfo") or []
    if page.get("missing") or not infos:
        raise refus("fichier introuvable dans l'API de Commons : licence inconnue.")
    info = infos[0]
    meta = info.get("extmetadata") or {}
    nom_licence = re.sub(r"\s+", " ", html.unescape(str(_valeur(meta, "LicenseShortName") or ""))).strip()
    code = str(_valeur(meta, "License") or "").strip().lower()
    domaine_public = str(_valeur(meta, "Copyrighted") or "").strip().lower() == "false"
    if _vrai(_valeur(meta, "NonFree")):
        raise refus(f"licence non libre ({nom_licence or 'non précisée'}).")
    if not nom_licence:
        raise refus("licence inconnue.")
    candidats = [c for c in (code, nom_licence.lower()) if c]
    if any(_NON_LIBRE_RE.search(c) for c in candidats):
        raise refus(f"licence non libre ({nom_licence} : pas d'usage commercial ou de modification).")
    if not (domaine_public or any(_LIBRE_RE.match(c) for c in candidats)):
        raise refus(f"licence inconnue ou non libre ({nom_licence}).")
    auteur, liens_auteur = _html(_valeur(meta, "Attribution"))
    if not auteur:
        auteur, liens_auteur = _html(_valeur(meta, "Artist"))
    _, liens_credit = _html(_valeur(meta, "Credit"))
    requise = _vrai(_valeur(meta, "AttributionRequired"))
    if requise and not auteur:
        raise refus("l'attribution est exigée mais l'auteur est inconnu.")
    licence_url = str(_valeur(meta, "LicenseUrl") or "").strip() or None
    if licence_url and licence_url.startswith("//"):
        licence_url = "https:" + licence_url
    source = str(info.get("descriptionurl") or "") or f"https://commons.wikimedia.org/wiki/{quote(titre.replace(' ', '_'))}"
    origine = next((u for u in liens_credit + liens_auteur if "wikimedia.org" not in u and "wikipedia.org" not in u), None)
    oeuvre = titre.split(":", 1)[-1].rsplit(".", 1)[0]
    texte = f"« {oeuvre} »" + (f", {auteur}" if auteur else "") + f", {nom_licence}"
    texte += (f" ({licence_url})" if licence_url else "") + f", via Wikimedia Commons : {source}"
    return {
        "auteur": auteur or None,
        "licence": nom_licence,
        "licence_code": code or None,
        "licence_url": licence_url,
        "source_url": source,
        "origine_url": origine,
        "attribution_requise": requise,
        "texte": texte[:_MAX * 2],
    }


def attribution(ydl: Any, platform: str, url: str | None) -> dict[str, Any] | None:
    """Attribution du média (plateformes marquées « attribution » au registre : Wikimedia Commons ; sinon None). Une requête à l'API de Commons par le client
    réseau de yt-dlp (User-Agent identifié du registre)."""
    from .registre import registre

    found = registre().get(platform)
    if found is None or not found.attribution:
        return None
    titre = titre_commons(url)
    if titre is None:
        raise refus("ce lien n'est pas une page de fichier : licence inconnue.")
    from yt_dlp.networking import Request
    from yt_dlp.networking.exceptions import RequestError

    try:
        with ydl.urlopen(Request(url_api(titre))) as reponse:
            data = json.loads(reponse.read(2_000_000) or b"{}")
    except (RequestError, ValueError) as exc:
        raise ApiError(503, "upstream_unavailable", "Wikimedia Commons : licence illisible pour le moment "
                                                    "(API indisponible) : réessayez plus tard.") from exc
    return attribution_depuis(data, titre)


def etiquettes(attrib: dict[str, Any]) -> dict[str, str]:
    """Étiquettes du fichier (MP4, MP3, WebM) : artiste, copyright (licence + URL), commentaire (attribution + source)."""
    out = {"copyright": attrib["licence"] + (f" — {attrib['licence_url']}" if attrib.get("licence_url") else ""),
           "comment": attrib["texte"]}
    if attrib.get("auteur"):
        out["artist"] = attrib["auteur"]
    return out
