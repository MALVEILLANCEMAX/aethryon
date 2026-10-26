#!/usr/bin/env python3
"""Logotype AETHRYON vectorisé (contours réels de la police : aucune dépendance à une police une fois exporté).

    python3 brand/master/tools/wordmark.py <dossier des polices> > brand/master/tools/wordmarks.json

Capitales espacées + crénage optique paire par paire (en millièmes de cadratin, ajouté à l'interlettrage).
Les contours sont exprimés en unités de la police, axe y vers le bas (prêts pour SVG), ligne de base à y = 0.
"""
import json
import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

# Candidats comparés. Interlettrage et crénage réglés à l'œil sur des rendus à 24, 48 et 160 px de hauteur
# de capitale, à côté du symbole (voir brand/master/comparaison).
CANDIDATES = {
    "geist-medium": {"file": "Geist-Medium.ttf", "label": "Geist Medium", "tracking": 0.20,
                     "pairs": {"AE": -14, "ET": -20, "TH": -18, "RY": -26, "YO": -24, "ON": -6}},
    "geist-regular": {"file": "Geist-Regular.ttf", "label": "Geist Regular", "tracking": 0.24,
                      "pairs": {"AE": -14, "ET": -20, "TH": -18, "RY": -26, "YO": -24, "ON": -6}},
    "marcellus": {"file": "marcellus-400.woff2", "label": "Marcellus", "tracking": 0.17,
                  "pairs": {"AE": -22, "ET": -26, "TH": -16, "HR": -4, "RY": -34, "YO": -30, "ON": -8}},
    "cormorant-semibold": {"file": "cormorant-garamond-600.woff2", "label": "Cormorant Garamond SemiBold", "tracking": 0.16,
                           "pairs": {"AE": -20, "ET": -24, "TH": -14, "RY": -34, "YO": -30, "ON": -8}},
}


def outline(font_path: Path, text: str, tracking: float, pairs: dict[str, int]) -> dict:
    f = TTFont(str(font_path))
    gs = f.getGlyphSet()
    cmap = f.getBestCmap()
    upm = f["head"].unitsPerEm
    hmtx = f["hmtx"]
    x = 0.0
    parts = []
    bounds = [float("inf"), float("inf"), float("-inf"), float("-inf")]
    glyphs = [cmap[ord(ch)] for ch in text]
    for i, g in enumerate(glyphs):
        pen = SVGPathPen(gs, ntos=lambda v: f"{v:.1f}".rstrip("0").rstrip("."))
        gs[g].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
        parts.append(pen.getCommands())
        bp = BoundsPen(gs)
        gs[g].draw(TransformPen(bp, (1, 0, 0, -1, x, 0)))
        if bp.bounds:
            b = bp.bounds
            bounds = [min(bounds[0], b[0]), min(bounds[1], b[1]), max(bounds[2], b[2]), max(bounds[3], b[3])]
        adv = hmtx[g][0]
        if i < len(glyphs) - 1:
            pair = text[i] + text[i + 1]
            x += adv + tracking * upm + pairs.get(pair, 0) / 1000 * upm
        else:
            x += adv
    cap = getattr(f["OS/2"], "sCapHeight", None) or upm * 0.7
    return {"d": "".join(parts), "upm": upm, "capHeight": cap,
            "bbox": {"x": bounds[0], "y": bounds[1], "w": bounds[2] - bounds[0], "h": bounds[3] - bounds[1]}}


def main():
    fonts = Path(sys.argv[1])
    out = {}
    for key, c in CANDIDATES.items():
        o = outline(fonts / c["file"], "AETHRYON", c["tracking"], c["pairs"])
        out[key] = {"label": c["label"], "tracking": c["tracking"], "pairs": c["pairs"], **o}
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
