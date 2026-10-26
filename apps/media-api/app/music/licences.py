"""Licences readable by AETHRYON Music. A download is offered ONLY for a free licence or the public domain:
CC0, Public Domain Mark / public domain, CC BY, CC BY-SA (any version). NC, ND, "all rights reserved", unknown or
absent licence: no download (metadata, "Open on …" and the official player only). The licence text and URL are
recorded with the imported file (tags, record, cloud metadata)."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass

FREE_CODES = frozenset({"cc0", "pdm", "pd", "cc-by", "cc-by-sa"})


@dataclass(frozen=True)
class Licence:
    code: str  # cc0 | pdm | pd | cc-by | cc-by-sa | non_libre | inconnue | editeur | declaree
    nom: str
    url: str | None = None
    libre: bool = False  # free licence or public domain: download allowed
    attribution_requise: bool = False

    def to_json(self) -> dict[str, object]:
        return asdict(self)


_CC_URL = re.compile(r"^https?://(?:www\.)?creativecommons\.org/(licenses|publicdomain)/([a-z-]+)/?([0-9.]+)?", re.I)


def from_url(url: str | None) -> Licence:
    """Internet Archive `licenseurl` (or any Creative Commons URL)."""
    if not url or not isinstance(url, str):
        return Licence("inconnue", "Licence non indiquée")
    clean = url.strip()[:300]
    m = _CC_URL.match(clean)
    if not m:
        return Licence("inconnue", "Licence non reconnue", clean)
    kind, name, version = m.group(1).lower(), m.group(2).lower(), (m.group(3) or "").strip(".")
    https = "https://creativecommons.org/" + clean.split("creativecommons.org/", 1)[1]
    suffix = f" {version}" if version else ""
    if kind == "publicdomain":
        if name == "zero":
            return Licence("cc0", f"CC0{suffix} (domaine public)", https, True, False)
        if name == "mark":
            return Licence("pdm", "Public Domain Mark (domaine public)", https, True, False)
        return Licence("non_libre", "Licence non reconnue", https)
    if name == "publicdomain":  # old "Public Domain Dedication" (licenses/publicdomain/)
        return Licence("pd", "Domaine public", https, True, False)
    if name == "by":
        return Licence("cc-by", f"CC BY{suffix}", https, True, True)
    if name == "by-sa":
        return Licence("cc-by-sa", f"CC BY-SA{suffix}", https, True, True)
    # by-nc, by-nd, by-nc-sa, by-nc-nd, sampling… : not free (no download in AETHRYON Music)
    return Licence("non_libre", f"CC {name.upper()}{suffix} (non libre : usage commercial ou modification interdits)",
                   https)


def from_commons(short: str | None, code: str | None, url: str | None) -> Licence:
    """Wikimedia Commons extmetadata: License (machine code, e.g. cc-by-sa-4.0, cc0, pd), LicenseShortName, LicenseUrl."""
    code = (code or "").strip().lower()
    name = (short or "").strip()[:100] or code or "Licence non indiquée"
    link = url.strip()[:300] if isinstance(url, str) and url.strip().startswith(("https://", "http://")) else None
    if link and link.startswith("http://"):
        link = "https://" + link[7:]
    if code == "cc0" or code.startswith("cc-zero"):
        return Licence("cc0", "CC0 (domaine public)", link, True, False)
    if code == "pd" or code.startswith("pd-") or code.startswith("pd "):
        return Licence("pd", name if "domaine" in name.lower() else f"Domaine public ({name})", link, True, False)
    if re.fullmatch(r"cc-by-sa(-[0-9.]+)?(-[a-z]{2,3})?", code):
        return Licence("cc-by-sa", name, link, True, True)
    if re.fullmatch(r"cc-by(-[0-9.]+)?(-[a-z]{2,3})?", code):
        return Licence("cc-by", name, link, True, True)
    if "nc" in code.split("-") or "nd" in code.split("-"):
        return Licence("non_libre", name, link)
    # GFDL, FAL, GPL… : free, but not supported by AETHRYON Music V1 (full licence text to ship, versions…)
    return Licence("inconnue", f"{name} (licence non prise en charge par AETHRYON Music)", link)


PUBLISHER = Licence("editeur", "Publié par l'éditeur du podcast pour le téléchargement (flux RSS) ; droits réservés "
                               "à l'éditeur : usage personnel", None, False, True)
DECLARED = Licence("declaree", "Droits déclarés par l'utilisateur (fichier personnel ou droits détenus)", None, False,
                   False)
