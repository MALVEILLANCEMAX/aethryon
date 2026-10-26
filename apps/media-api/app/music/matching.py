"""Matching of identified tracks (Spotify playlist, album…) with files the user ALREADY OWNS (Desktop library, his
Cloud). Nothing is ever searched on a streaming service and nothing is downloaded: an unmatched track stays
"identifie" (« aucun fichier dans ta bibliothèque »).

Score in [0, 1]:
- same ISRC on both sides -> 1.0 ("isrc");
- otherwise 0.55 x title + 0.30 x artist + 0.15 x duration (weights of the missing fields are spread over the others),
  strings normalised (accents, case, "feat.", "remastered", brackets), similarity from difflib (stdlib);
- two DIFFERENT ISRCs: another recording of the same song -> at most 0.79 ("probable", never "sure").
"sure" >= 0.90, "probable" >= 0.78, below: no match. Candidates are indexed by ISRC and by title words, so a playlist of
500 tracks against a library of 10 000 files only compares plausible pairs.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

SURE = 0.90
PROBABLE = 0.78
MAX_PISTES = 500
MAX_CANDIDATS = 10_000
_NOISE = re.compile(r"\b(feat|ft|featuring|with|remaster(ed)?|\d{4} remaster(ed)?|radio edit|single version|"
                    r"album version|original mix|explicit|clean|live|version|edit|mono|stereo)\b")
_BRACKETS = re.compile(r"[\(\[\{][^\)\]\}]{0,80}[\)\]\}]")
_STOP = {"the", "a", "an", "le", "la", "les", "un", "une", "de", "des", "du", "et", "and", "of", "to", "in"}


def norm(value: str | None) -> str:
    if not value:
        return ""
    raw = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").lower()
    raw = _BRACKETS.sub(" ", raw)
    raw = re.split(r"\s[-–—]\s", raw)[0] if " - " in raw else raw  # "Song - 2011 Remaster" -> "Song"
    raw = _NOISE.sub(" ", raw)
    raw = re.sub(r"[^a-z0-9 ]+", " ", raw)
    return " ".join(raw.split())


def words(value: str) -> set[str]:
    return {w for w in value.split() if len(w) > 1 and w not in _STOP}


def sim(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    ratio = SequenceMatcher(None, a, b).ratio()
    wa, wb = words(a), words(b)
    overlap = len(wa & wb) / max(1, min(len(wa), len(wb))) if wa and wb else 0.0
    return max(ratio, 0.9) if overlap == 1.0 else ratio  # every word of the shorter title is in the other


def duration_score(a: float | None, b: float | None) -> float | None:
    if not a or not b:
        return None
    delta = abs(a - b)
    if delta <= 2:
        return 1.0
    if delta >= 10:
        return 0.0
    return 1 - (delta - 2) / 8


@dataclass
class Candidat:
    ref: str
    origine: str  # bibliotheque | cloud
    titre: str
    artistes: list[str]
    duree_s: float | None
    isrc: str | None
    disponible: bool  # cloud: audio still there (not expired)
    n_titre: str = ""
    n_artistes: str = ""

    @classmethod
    def parse(cls, raw: Any) -> Candidat | None:
        if not isinstance(raw, dict):
            return None
        ref = raw.get("ref")
        titre = raw.get("titre")
        if not isinstance(ref, str) or not 0 < len(ref) <= 200 or not isinstance(titre, str) or not titre.strip():
            return None
        origine = raw.get("origine") if raw.get("origine") in ("bibliotheque", "cloud") else "bibliotheque"
        artistes = raw.get("artistes") if isinstance(raw.get("artistes"), list) else []
        artistes = [a[:200] for a in artistes if isinstance(a, str)][:10]
        duree = raw.get("dureeS")
        duree = float(duree) if isinstance(duree, (int, float)) and 0 < duree < 1e6 else None
        isrc = raw.get("isrc") if isinstance(raw.get("isrc"), str) and re.fullmatch(r"[A-Za-z0-9]{12}", raw["isrc"]) else None
        c = cls(ref, origine, titre[:300], artistes, duree, isrc.upper() if isrc else None,
                raw.get("disponible") is not False)
        c.n_titre, c.n_artistes = norm(c.titre), norm(" ".join(c.artistes))
        return c


def score(titre: str | None, artistes: list[str], duree: float | None, isrc: str | None,
          c: Candidat) -> tuple[float, str]:
    if isrc and c.isrc and isrc == c.isrc:
        return 1.0, "isrc"
    parts: list[tuple[float, float]] = [(0.55, sim(norm(titre), c.n_titre))]
    a = norm(" ".join(artistes))
    if a and c.n_artistes:
        best = max([sim(a, c.n_artistes)] + [sim(norm(x), c.n_artistes) for x in artistes[:3]])
        parts.append((0.30, best))
    d = duration_score(duree, c.duree_s)
    if d is not None:
        parts.append((0.15, d))
    total_w = sum(w for w, _ in parts)
    value = sum(w * s for w, s in parts) / total_w
    if not a or not c.n_artistes:
        value *= 0.92  # title only: never as sure as title + artist
    if isrc and c.isrc and isrc != c.isrc:
        value = min(value, PROBABLE + 0.01)
    return round(value, 3), "titre_artiste_duree" if d is not None else "titre_artiste"


class Index:
    def __init__(self, candidats: list[Candidat]) -> None:
        self.by_isrc: dict[str, list[Candidat]] = {}
        self.by_word: dict[str, list[Candidat]] = {}
        for c in candidats:
            if c.isrc:
                self.by_isrc.setdefault(c.isrc, []).append(c)
            for w in words(c.n_titre) or {c.n_titre}:
                self.by_word.setdefault(w, []).append(c)

    def best(self, titre: str | None, artistes: list[str], duree: float | None, isrc: str | None) -> dict[str, Any] | None:
        pool: dict[int, Candidat] = {}
        if isrc:
            for c in self.by_isrc.get(isrc, []):
                pool[id(c)] = c
        n = norm(titre)
        for w in words(n) or {n}:
            bucket = self.by_word.get(w, [])
            if len(bucket) <= 2000:
                for c in bucket:
                    pool[id(c)] = c
        found: tuple[float, str, Candidat] | None = None
        best_key = -1.0
        for c in pool.values():
            s, how = score(titre, artistes, duree, isrc, c)
            key = s + (0.001 if c.disponible else 0.0)  # same score: prefer a file whose audio is still there
            if key > best_key:
                best_key, found = key, (s, how, c)
        if found is None or found[0] < PROBABLE:
            return None
        s, how, c = found
        return {"ref": c.ref, "origine": c.origine, "score": s, "methode": how,
                "confiance": "sure" if s >= SURE else "probable", "audioDisponible": c.disponible,
                "titre": c.titre, "artistes": c.artistes}


def match(pistes: list[dict[str, Any]], candidats: list[Candidat]) -> list[dict[str, Any]]:
    index = Index(candidats)
    out = []
    for i, p in enumerate(pistes):
        m = index.best(p.get("titre"), p.get("artistes") or [], p.get("dureeS"), p.get("isrc"))
        etat = "correspondance" if m else ("identifie" if p.get("titre") else "lien_reconnu")
        out.append({"position": i + 1, "piste": p, "etat": etat, "correspondance": m,
                    "note": None if m else "Aucun fichier de ta bibliothèque ou de ton cloud ne correspond : rien "
                                           "n'est téléchargé depuis un service de streaming."})
    return out
