#!/usr/bin/env python3
"""Déclinaisons officielles d'AETHRYON, toutes dérivées des tracés du SVG maître (aucune tête redessinée).

    python3 brand/master/tools/build_variants.py

Lit  brand/master/aethryon-master.svg (géométrie et couleurs de référence)
     brand/master/tools/wordmarks.json (logotype vectorisé, voir wordmark.py)
Écrit brand/master/variantes/*.svg et brand/master/png/*.png (rendus Chromium via render.mjs)

Règles appliquées partout :
- la tête est insérée telle quelle (mêmes tracés), seulement déplacée et mise à l'échelle ;
- les seules modifications de dessin sont les corrections optiques documentées ci-dessous (petit logo,
  monochromes, liseré pour fond ivoire), chacune limitée à son usage.
"""
import json
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]           # brand/master
TOOLS = ROOT / "tools"
OUT = ROOT / "variantes"
PNG = ROOT / "png"
SVG_NS = "http://www.w3.org/2000/svg"

OBSIDIENNE = "#0F0F10"
IVOIRE = "#FAF8F3"
CHAMPAGNE = "#D7C2A5"
HALO = "#D4AF7C"   # rgb(212 175 124), halo du site (bloc final)

# ------------------------------------------------------------------ géométrie du maître
master_src = (ROOT / "aethryon-master.svg").read_text(encoding="utf-8")
_root = ET.fromstring(master_src)
EL = {}
for el in _root.iter():
    tag = el.tag.split("}")[-1]
    if tag in ("path", "circle") and el.get("id"):
        EL[el.get("id")] = {"tag": tag, **{k: v for k, v in el.attrib.items() if k != "id"}}


def el(i, **over):
    """Élément du maître, attributs éventuellement remplacés (couleur, transformation…)."""
    a = {**EL[i], **over}
    tag = a.pop("tag")
    attrs = " ".join(f'{k}="{v}"' for k, v in a.items() if v is not None)
    return f"<{tag} {attrs}/>"


def d(i):
    return EL[i]["d"]


HEAD_INNER = master_src[master_src.index('<g id="aethryon-head">'):master_src.rindex("</g>") + 4]


def head(prefix=""):
    """La tête maître telle quelle (ids préfixés pour pouvoir en mettre plusieurs dans un même fichier)."""
    if not prefix:
        return HEAD_INNER
    return re.sub(r'id="([^"]+)"', lambda m: f'id="{prefix}{m.group(1)}"', HEAD_INNER)


# Boîte de la tête dans la grille de 64 : aigrettes (3, 5) et (61, 5), pointe de l'écusson (32, 61)
HX0, HY0, HX1, HY1 = 3.0, 5.0, 61.0, 61.0
HW, HH = HX1 - HX0, HY1 - HY0


def place(inner, cx, cy, height):
    """Tête de hauteur `height` (aigrettes → pointe) centrée sur (cx, cy)."""
    k = height / HH
    tx = cx - (HX0 + HW / 2) * k
    ty = cy - (HY0 + HH / 2) * k
    return f'<g transform="translate({tx:.4f} {ty:.4f}) scale({k:.6f})">{inner}</g>'


def svg(w, h, body, title, desc="", defs=""):
    t = f"<title>{title}</title>" + (f"<desc>{desc}</desc>" if desc else "")
    df = f"<defs>{defs}</defs>" if defs else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" width="{w:g}" height="{h:g}" '
            f'role="img">{t}{df}{body}</svg>\n')


# ------------------------------------------------------------------ petit logo (16 / 24 px)
# Corrections optiques, et seulement celles-ci (même silhouette, mêmes couleurs) :
# 1. amandes des yeux agrandies de 6 % autour de leur centre : à 16 px elles couvrent 4 px pleins au lieu de
#    3,8 px grisés ;
# 2. reflets carrés de 4 unités alignés sur la grille de 16 px (1 pixel net), décalés vers la droite comme
#    dans le maître (regard légèrement asymétrique) ;
# 3. ligne du front supprimée (1,4 unité = 0,35 px à 16 px : elle ne ferait que griser les sourcils).
EYE_C = {"eye-left": (20.46, 32.25), "eye-right": (43.54, 32.25)}
SMALL_EYE_SCALE = 1.06
SMALL_GLINTS = {"glint-left": (20, 28, 4, 4), "glint-right": (44, 28, 4, 4)}   # x, y, largeur, hauteur
SMALL_MAX_PX = 24


def small_head():
    parts = [el("shell"), el("face-left"), el("face-right")]
    for i, (cx, cy) in EYE_C.items():
        parts.append(el(i, transform=f"translate({cx} {cy}) scale({SMALL_EYE_SCALE}) translate({-cx} {-cy})"))
    for i, (x, y, w, h) in SMALL_GLINTS.items():
        parts.append(f'<rect id="{i}" x="{x}" y="{y}" width="{w}" height="{h}" fill="{IVOIRE}"/>')
    parts += [el("brow-left"), el("brow-right"), el("beak-left"), el("beak-right")]
    return '<g id="aethryon-head-small">' + "".join(parts) + "</g>"


# ------------------------------------------------------------------ monochromes
# Principe : les yeux restent toujours plus sombres que la face (c'est le regard de la chouette).
# - Mono foncé (encre obsidienne, fonds clairs) : même répartition des valeurs que la couleur sur fond clair :
#   écusson, yeux, sourcils et bec à l'encre ; faces, reflets et ligne du front en réserve (le fond).
# - Mono clair (encre ivoire, fonds sombres) : la tête claire, les yeux en réserve (le fond sombre),
#   reflets à l'encre ; la structure (ligne du front, bord inférieur des sourcils, bec, contour de la face)
#   est dessinée par de fins traits en réserve.
# Traits de séparation (0,9 unité) seulement là où deux zones d'encre se touchent ; ils ne touchent jamais
# le contour extérieur (masque « écusson rétréci »), donc la silhouette est strictement celle du maître.
KEY = 0.9


def eroded_shell_mask(mid, inset=1.2):
    return (f'<mask id="{mid}" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">'
            f'<path d="{d("shell")}" fill="#fff"/>'
            f'<path d="{d("shell")}" fill="none" stroke="#000" stroke-width="{inset * 2}"/></mask>')


def mono_dark_defs(ink, p):
    return (eroded_shell_mask(f"{p}inner")
            + f'<clipPath id="{p}eyes"><path d="{d("eye-left")}"/><path d="{d("eye-right")}"/></clipPath>'
            + f'<clipPath id="{p}brows"><path d="{d("brow-left")}"/><path d="{d("brow-right")}"/></clipPath>'
            + f'<mask id="{p}m" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">'
            + f'<path d="{d("shell")}" fill="#fff"/>'
            + f'<path d="{d("face-left")}" fill="#000"/><path d="{d("face-right")}" fill="#000"/>'
            + f'<path d="{d("eye-left")}" fill="#fff"/><path d="{d("eye-right")}" fill="#fff"/>'
            + el("glint-left", fill="#000") + el("glint-right", fill="#000")
            # séparation yeux / sourcils (dans les yeux uniquement)
            + f'<g clip-path="url(#{p}eyes)"><path d="{d("brow-left")}" fill="none" stroke="#000" stroke-width="{KEY * 2}"/>'
            + f'<path d="{d("brow-right")}" fill="none" stroke="#000" stroke-width="{KEY * 2}"/></g>'
            + f'<path d="{d("brow-left")}" fill="#fff"/><path d="{d("brow-right")}" fill="#fff"/>'
            + el("brow-line", stroke="#000")
            # séparation bec / sourcils (dans les sourcils uniquement)
            + f'<g clip-path="url(#{p}brows)"><path d="M32 36 27 42 32 51 37 42Z" fill="none" stroke="#000" stroke-width="{KEY * 2}"/></g>'
            + f'<path d="M32 36 27 42 32 51 37 42Z" fill="#fff"/>'
            + "</mask>")


def mono_dark(ink, p="md-"):
    return mono_dark_defs(ink, p), f'<rect x="0" y="0" width="64" height="64" fill="{ink}" mask="url(#{p}m)"/>'


def mono_light(ink, p="ml-"):
    face_l = "M32 28C22 13 9 14 8 30 6 48 21 47 32 57"
    face_r = "M32 28C42 13 55 14 56 30 58 48 43 47 32 57"
    brow_l = "M32 39C26 21 8 24 3 5"
    brow_r = "M32 39C38 21 56 24 61 5"
    defs = (eroded_shell_mask(f"{p}inner")
            + f'<mask id="{p}m" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">'
            + f'<path d="{d("shell")}" fill="#fff"/><path d="{d("face-left")}" fill="#fff"/><path d="{d("face-right")}" fill="#fff"/>'
            # contour des faces (sauf l'axe central), estompé près du bord extérieur
            + f'<g mask="url(#{p}inner)"><path d="{face_l}" fill="none" stroke="#000" stroke-width="{KEY}"/>'
            + f'<path d="{face_r}" fill="none" stroke="#000" stroke-width="{KEY}"/></g>'
            + f'<path d="{d("eye-left")}" fill="#000"/><path d="{d("eye-right")}" fill="#000"/>'
            + el("glint-left", fill="#fff") + el("glint-right", fill="#fff")
            + f'<path d="{d("brow-left")}" fill="#fff"/><path d="{d("brow-right")}" fill="#fff"/>'
            # bord inférieur des sourcils (là où ils recouvrent la face), sans toucher les aigrettes extérieures
            + f'<g mask="url(#{p}inner)"><path d="{brow_l}" fill="none" stroke="#000" stroke-width="{KEY}"/>'
            + f'<path d="{brow_r}" fill="none" stroke="#000" stroke-width="{KEY}"/></g>'
            + el("brow-line", stroke="#000")
            + f'<path d="M32 36 27 42 32 51 37 42Z" fill="#fff" stroke="#000" stroke-width="{KEY}" stroke-linejoin="round"/>'
            + "</mask>")
    return defs, f'<rect x="0" y="0" width="64" height="64" fill="{ink}" mask="url(#{p}m)"/>'


# ------------------------------------------------------------------ liseré pour fonds ivoire
# Sur ivoire, la joue gauche (#FAF8F3, comme le fond) déborde de 0,17 unité de l'écusson : le contour
# disparaît sur ~7 unités. Correction : la face est rognée de 0,45 unité le long du bord de l'écusson,
# ce qui laisse apparaître un liseré champagne continu. La silhouette devient exactement celle de
# l'écusson (le débord de 0,17 unité est absorbé). Seulement pour les fonds clairs.
RIM = 0.45


def ivory_head(p="iv-"):
    defs = (f'<mask id="{p}faces" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">'
            f'<path d="{d("shell")}" fill="#fff"/>'
            f'<path d="{d("shell")}" fill="none" stroke="#000" stroke-width="{RIM * 2}"/></mask>')
    parts = [el("shell"), f'<g mask="url(#{p}faces)">{el("face-left")}{el("face-right")}</g>']
    inner = HEAD_INNER
    eyes_on = inner[inner.index('<g id="eyes">'):]
    eyes_on = eyes_on[:eyes_on.rindex("</g>")]
    body = '<g id="aethryon-head">' + "".join(parts) + eyes_on + "</g>"
    return defs, body


# ------------------------------------------------------------------ logotype
WM = json.loads((TOOLS / "wordmarks.json").read_text(encoding="utf-8"))
WORDMARK_FONT = "marcellus"   # recommandation ; Geist Medium en variante de comparaison


def wordmark(key, x, baseline, cap_px, fill):
    c = WM[key]
    k = cap_px / c["capHeight"]
    bb = c["bbox"]
    return (f'<g transform="translate({x - bb["x"] * k:.3f} {baseline:.3f}) scale({k:.6f})" fill="{fill}">'
            f'<path d="{c["d"]}"/></g>'), bb["w"] * k


def lockup_h(key, ink, sym_h=96.0):
    # capitales ≈ 0,31 × hauteur de la tête : le logotype accompagne la chouette sans prendre le dessus
    cap = sym_h / 3.2
    gap = cap * 0.95
    pad = cap * 0.6
    sym_w = HW * sym_h / HH
    c = WM[key]; k = cap / c["capHeight"]; wm_w = c["bbox"]["w"] * k
    W = pad + sym_w + gap + wm_w + pad
    H = sym_h + 2 * pad
    cy = pad + sym_h / 2
    sym = place(HEAD_INNER, pad + sym_w / 2, cy, sym_h)
    # capitales centrées sur l'axe des yeux (y = 32,9 dans la grille, centre optique de la tête)
    eye_axis = pad + (32.9 - HY0) / HH * sym_h
    wmk, _ = wordmark(key, pad + sym_w + gap, eye_axis + cap / 2, cap, ink)
    return W, H, sym + wmk


def lockup_v(key, ink, sym_h=128.0):
    cap = sym_h / 4.2
    gap = cap * 1.15
    pad = cap * 0.8
    c = WM[key]; k = cap / c["capHeight"]; wm_w = c["bbox"]["w"] * k
    sym_w = HW * sym_h / HH
    W = max(sym_w, wm_w) + 2 * pad
    H = pad + sym_h + gap + cap + pad
    sym = place(HEAD_INNER, W / 2, pad + sym_h / 2, sym_h)
    wmk, _ = wordmark(key, (W - wm_w) / 2, pad + sym_h + gap + cap, cap, ink)
    return W, H, sym + wmk


# ------------------------------------------------------------------ tuiles (icônes)
def tile(size, bg, head_inner, head_ratio, radius=None, glow=False, circle=False, ring=None, defs=""):
    r = size * radius if radius else 0
    shape = (f'<circle cx="{size / 2}" cy="{size / 2}" r="{size / 2}" fill="{bg}"/>' if circle
             else f'<rect width="{size}" height="{size}" rx="{r:.3f}" fill="{bg}"/>')
    g = ""
    if glow:
        defs += (f'<radialGradient id="halo" cx="50%" cy="52%" r="50%">'
                 f'<stop offset="0" stop-color="{HALO}" stop-opacity="0.22"/>'
                 f'<stop offset="1" stop-color="{HALO}" stop-opacity="0"/></radialGradient>')
        g = f'<rect width="{size}" height="{size}" rx="{r:.3f}" fill="url(#halo)"/>'
    rg = ""
    if ring:
        rg = (f'<circle cx="{size / 2}" cy="{size / 2}" r="{size / 2 - ring[1] / 2}" fill="none" '
              f'stroke="{ring[0]}" stroke-width="{ring[1]}"/>')
    # centre optique : légèrement sous le centre géométrique (les aigrettes allègent le haut)
    body = shape + g + rg + place(head_inner, size / 2, size * 0.515, size * head_ratio)
    return defs, body


def write(name, content):
    (OUT / name).write_text(content, encoding="utf-8")
    return OUT / name


def main():
    OUT.mkdir(exist_ok=True)
    PNG.mkdir(exist_ok=True)
    files = {}

    files["symbole"] = write("aethryon-symbole.svg", master_src)
    w = write
    files["symbole-obsidienne"] = w("aethryon-symbole-obsidienne.svg", svg(64, 64,
        f'<rect width="64" height="64" fill="{OBSIDIENNE}"/>' + place(HEAD_INNER, 32, 33, 46),
        "AETHRYON — symbole sur obsidienne"))
    idefs, ihead = ivory_head()
    files["symbole-ivoire"] = w("aethryon-symbole-ivoire.svg", svg(64, 64,
        f'<rect width="64" height="64" fill="{IVOIRE}"/>' + place(ihead, 32, 33, 46),
        "AETHRYON — symbole sur ivoire", "Liseré champagne de 0,45 unité le long de l'écusson (fonds clairs).", idefs))
    files["symbole-ivoire-sans-correction"] = w("aethryon-symbole-ivoire-sans-correction.svg", svg(64, 64,
        f'<rect width="64" height="64" fill="{IVOIRE}"/>' + place(HEAD_INNER, 32, 33, 46),
        "AETHRYON — symbole sur ivoire, sans correction (comparaison)"))
    files["symbole-fonds-clairs"] = w("aethryon-symbole-fonds-clairs.svg", svg(64, 64, ihead,
        "AETHRYON — symbole pour fonds clairs (transparent)", "Liseré champagne de 0,45 unité le long de l'écusson.", idefs))

    for key, label in (("marcellus", "marcellus"), ("geist-medium", "geist")):
        for ink_name, ink in (("ivoire", IVOIRE), ("obsidienne", OBSIDIENNE)):
            W, H, body = lockup_h(key, ink)
            files[f"horizontal-{label}-{ink_name}"] = w(f"aethryon-horizontal-{label}-encre-{ink_name}.svg",
                svg(round(W, 2), round(H, 2), body, f"AETHRYON — logo horizontal ({WM[key]['label']}, encre {ink_name})"))
            W, H, body = lockup_v(key, ink)
            files[f"vertical-{label}-{ink_name}"] = w(f"aethryon-vertical-{label}-encre-{ink_name}.svg",
                svg(round(W, 2), round(H, 2), body, f"AETHRYON — logo vertical ({WM[key]['label']}, encre {ink_name})"))

    defs, body = mono_light(IVOIRE)
    files["mono-clair"] = w("aethryon-mono-clair.svg", svg(64, 64, body, "AETHRYON — monochrome clair (encre ivoire, fonds sombres)", defs=defs))
    defs, body = mono_dark(OBSIDIENNE)
    files["mono-fonce"] = w("aethryon-mono-fonce.svg", svg(64, 64, body, "AETHRYON — monochrome foncé (encre obsidienne, fonds clairs)", defs=defs))

    sh = small_head()
    files["petit"] = w("aethryon-petit.svg", svg(64, 64, sh, "AETHRYON — petit logo (16 à 24 px)",
        "Corrections optiques : yeux +6 %, reflets alignés sur la grille de 16 px, ligne du front retirée."))
    files["favicon"] = w("favicon.svg", svg(64, 64, sh, "AETHRYON"))

    # icônes : extension (tuile obsidienne arrondie), Discord (carré plein, recadré en cercle), application
    for name, size, inner, ratio in (("extension-16", 16, sh, 0.86), ("extension-32", 32, sh, 0.82),
                                     ("extension-48", 48, HEAD_INNER, 0.78), ("extension-128", 128, HEAD_INNER, 0.75)):
        defs, body = tile(size, OBSIDIENNE, inner, ratio, radius=0.22)
        files[name] = w(f"aethryon-{name}.svg", svg(size, size, body, "AETHRYON — icône d'extension", defs=defs))
    defs, body = tile(512, OBSIDIENNE, HEAD_INNER, 0.6, glow=True)
    files["discord"] = w("aethryon-discord.svg", svg(512, 512, body, "AETHRYON — avatar Discord",
        "Carré plein : Discord le recadre en cercle ; la tête tient dans 60 % du diamètre.", defs))
    defs, body = tile(1024, OBSIDIENNE, HEAD_INNER, 0.62, glow=True)
    files["app"] = w("aethryon-app.svg", svg(1024, 1024, body, "AETHRYON — icône d'application",
        "Plein cadre, sans transparence (le système applique son propre masque arrondi).", defs))
    defs, body = tile(512, OBSIDIENNE, HEAD_INNER, 0.5, glow=True)
    files["app-masquable"] = w("aethryon-app-masquable.svg", svg(512, 512, body, "AETHRYON — icône masquable (PWA)",
        "La tête tient dans la zone sûre de 80 %.", defs))
    # composants du tableau de bord
    defs, body = tile(32, OBSIDIENNE, sh, 0.66, circle=True)
    files["pastille-obsidienne"] = w("aethryon-pastille-obsidienne.svg", svg(32, 32, body, "AETHRYON — pastille (32 px)", defs=defs))
    defs, body = tile(32, IVOIRE, sh, 0.66, circle=True, ring=("#D7BE98", 1))
    files["pastille-ivoire"] = w("aethryon-pastille-ivoire.svg", svg(32, 32, body, "AETHRYON — pastille claire (32 px)", defs=defs))

    (OUT / "index.json").write_text(json.dumps({k: str(v.relative_to(ROOT)) for k, v in files.items()},
                                               ensure_ascii=False, indent=2), encoding="utf-8")

    # PNG
    jobs = []
    def job(src, name, size, bg="transparent", pad=0.0):
        jobs.append({"in": str(src), "out": str(PNG / name), "size": size, "bg": bg, "pad": pad})
    for s in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
        job(files["symbole"], f"aethryon-symbole-{s}.png", s)
    for s in (16, 24, 32, 48):
        job(files["petit"], f"aethryon-petit-{s}.png", s)
    for s in (64, 256, 512):
        job(files["mono-clair"], f"aethryon-mono-clair-{s}.png", s)
        job(files["mono-fonce"], f"aethryon-mono-fonce-{s}.png", s)
        job(files["symbole-obsidienne"], f"aethryon-symbole-obsidienne-{s}.png", s)
        job(files["symbole-ivoire"], f"aethryon-symbole-ivoire-{s}.png", s)
    for s in (16, 32, 48, 128):
        job(files[f"extension-{s}"], f"aethryon-extension-{s}.png", s)
    job(files["discord"], "aethryon-discord-512.png", 512)
    job(files["app"], "aethryon-app-1024.png", 1024)
    job(files["app"], "apple-touch-icon.png", 180)
    job(files["app-masquable"], "aethryon-app-masquable-512.png", 512)
    for s in (16, 32, 48):
        job(files["favicon"], f"favicon-{s}.png", s)
    job(files["pastille-obsidienne"], "aethryon-pastille-obsidienne-64.png", 64)
    job(files["pastille-ivoire"], "aethryon-pastille-ivoire-64.png", 64)
    (PNG / "_jobs.json").write_text(json.dumps(jobs), encoding="utf-8")
    subprocess.run(["node", str(TOOLS / "render.mjs"), "--batch", str(PNG / "_jobs.json")], check=True)
    (PNG / "_jobs.json").unlink()
    print(f"{len(files)} SVG, {len(jobs)} PNG")


if __name__ == "__main__":
    main()
