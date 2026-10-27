#!/usr/bin/env python3
"""Exporte l'identité maître vers le site et l'extension (une seule source : brand/master).

    python3 brand/master/tools/export_web.py              tout (modules TypeScript + fichiers du site)
    python3 brand/master/tools/export_web.py --ts         modules TypeScript seulement (site + extension)
    python3 brand/master/tools/export_web.py --extension  module de l'extension seulement
    python3 brand/master/tools/export_web.py --check      vérifie que les modules TypeScript sont à jour (code 1 sinon)

Écrit :
- web/src/ui/brand/head.ts     géométrie et couleurs de la tête maître + petit logo + liseré (OwlMark) ;
- web/src/ui/brand/wordmark.ts logotype Marcellus vectorisé (référence commune avec l'extension, non chargée par le site) ;
- extension/src/shared/brand-head.ts  les mêmes valeurs (tête, petit logo, liseré, logotype) pour l'extension,
  qui dessine la tête sans React (src/shared/owl.ts) ; ses icônes sont lues dans brand/master/png par
  extension/scripts/build.mjs ;
- web/public : favicon.svg, favicon.ico (16 petit logo, 32 et 48 maître), apple-touch-icon.png,
  icônes d'application 192/512 et masquable, owl-head.svg (le maître), og-image.png (via og.mjs).
Prérequis : build_variants.py déjà exécuté (variantes/ et png/) pour les fichiers du site ; les modules
TypeScript (--ts, --extension, --check) n'ont besoin ni de Pillow ni de Node.
"""
import io
import json
import struct
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import build_variants as BV  # noqa: E402

M = BV.ROOT
REPO = M.parents[2]  # repository root (packages/brand/master)
WEB = REPO / "apps" / "web"
EXTENSION = REPO / "apps" / "extension"
ICONS = WEB / "public" / "brand" / "aethryon" / "icons"


def head_body() -> list[str]:
    """HEAD, SMALL et RIM (corps commun au site et à l'extension)."""
    E = BV.EL

    def path(i, extra=""):
        return f'  {key(i)}: {{ d: {json.dumps(E[i]["d"])}, fill: "{E[i].get("fill", "none")}"{extra} }},'

    def key(i):
        a, *b = i.split("-")
        return a + "".join(x.capitalize() for x in b)

    g = {i: E[i] for i in ("glint-left", "glint-right")}
    return [
        "export const HEAD = {",
        path("shell"), path("face-left"), path("face-right"), path("eye-left"), path("eye-right"),
        *[f'  {key(i)}: {{ cx: {v["cx"]}, cy: {v["cy"]}, r: {v["r"]}, fill: "{v["fill"]}" }},' for i, v in g.items()],
        path("brow-left"), path("brow-right"),
        f'  browLine: {{ d: {json.dumps(E["brow-line"]["d"])}, stroke: "{E["brow-line"]["stroke"]}", strokeWidth: {E["brow-line"]["stroke-width"]} }},',
        path("beak-left"), path("beak-right"),
        "} as const;",
        "",
        "/** Petit logo, de 16 à 24 px (corrections optiques validées le 2026-10-11) : amandes des yeux +6 % autour de",
        " *  leur centre, reflets carrés alignés sur la grille de 16 px, ligne du front retirée. */",
        "export const SMALL = {",
        f"  maxPx: {BV.SMALL_MAX_PX},",
        f"  eyeScale: {BV.SMALL_EYE_SCALE},",
        f'  eyeLeftCenter: [{BV.EYE_C["eye-left"][0]}, {BV.EYE_C["eye-left"][1]}],',
        f'  eyeRightCenter: [{BV.EYE_C["eye-right"][0]}, {BV.EYE_C["eye-right"][1]}],',
        *[f"  {key(i)}: {{ x: {x}, y: {y}, width: {w}, height: {h} }}," for i, (x, y, w, h) in BV.SMALL_GLINTS.items()],
        "} as const;",
        "",
        "/** Liseré champagne des fonds clairs (validé le 2026-10-11) : faces rognées de cette largeur le long de",
        " *  l'écusson, pour que la joue ivoire ne se fonde pas dans un fond ivoire. Silhouette inchangée. */",
        f"export const RIM = {BV.RIM};",
        "",
    ]


def ts_head() -> str:
    return "\n".join([
        "// Tête maître d'AETHRYON : GÉNÉRÉ depuis brand/master/aethryon-master.svg par",
        "// brand/master/tools/export_web.py. Ne pas modifier à la main : modifier le maître, puis régénérer.",
        "// Grille de 64 unités ; l'ordre de peinture fait partie du dessin (voir docs/IDENTITE-MAITRE.md).",
        *head_body(),
    ])


def wordmark_body() -> list[str]:
    """WORDMARK (corps commun au site et à l'extension)."""
    c = BV.WM["marcellus"]
    bb = c["bbox"]
    return [
        "export const WORDMARK = {",
        f"  d: {json.dumps(c['d'])},",
        f'  viewBox: "{bb["x"]:.1f} {bb["y"]:.1f} {bb["w"]:.1f} {bb["h"]:.1f}",',
        "  /** hauteur de la boîte / hauteur de capitale (débord des lettres rondes compris) */",
        f"  heightPerCap: {bb['h'] / c['capHeight']:.4f},",
        "  /** largeur / hauteur de la boîte */",
        f"  ratio: {bb['w'] / bb['h']:.4f},",
        "} as const;",
        "",
    ]


def ts_wordmark() -> str:
    return "\n".join([
        "// Logotype AETHRYON en Marcellus (contours réels : aucune police chargée). GÉNÉRÉ depuis",
        "// brand/master/tools/wordmarks.json par brand/master/tools/export_web.py. Ne pas modifier à la main.",
        *wordmark_body(),
    ])


def ts_extension() -> str:
    """Module unique de l'extension : tête maître, petit logo, liseré et logotype (mêmes valeurs que le site)."""
    return "\n".join([
        "// GÉNÉRÉ — ne pas modifier. Identité maître d'AETHRYON pour l'extension, écrite par",
        "// brand/master/tools/export_web.py (python3 brand/master/tools/export_web.py --extension) depuis",
        "// brand/master/aethryon-master.svg et brand/master/tools/wordmarks.json : mêmes valeurs que",
        "// web/src/ui/brand/head.ts et wordmark.ts. Dessin : src/shared/owl.ts ; règles : docs/IDENTITE-MAITRE.md.",
        "// Grille de 64 unités ; l'ordre de peinture fait partie du dessin.",
        *head_body(),
        "/** Logotype AETHRYON en Marcellus (contours réels : aucune police chargée). */",
        *wordmark_body(),
    ])


TS_OUTPUTS = {
    "web": [(WEB / "src/ui/brand/head.ts", ts_head), (WEB / "src/ui/brand/wordmark.ts", ts_wordmark)],
    "extension": [(EXTENSION / "src/shared/brand-head.ts", ts_extension)],
}


def write_ts(groups) -> None:
    for g in groups:
        for path, make in TS_OUTPUTS[g]:
            path.write_text(make(), encoding="utf-8")


def check_ts() -> int:
    stale = [str(p.relative_to(REPO)) for g in TS_OUTPUTS for p, make in TS_OUTPUTS[g]
             if not p.exists() or p.read_text(encoding="utf-8") != make()]
    for p in stale:
        print(f"à régénérer : {p} (python3 brand/master/tools/export_web.py --ts)")
    if not stale:
        print("modules TypeScript de la marque : à jour (site et extension)")
    return 1 if stale else 0


def write_ico(dst: Path, pngs: list[Path]):
    """ICO à entrées PNG (lu par tous les navigateurs actuels)."""
    from PIL import Image  # seulement pour les fichiers du site (les modules TypeScript n'en ont pas besoin)
    datas = [p.read_bytes() for p in pngs]
    sizes = [Image.open(io.BytesIO(d)).size for d in datas]
    head = struct.pack("<HHH", 0, 1, len(datas))
    off = 6 + 16 * len(datas)
    entries = b""
    for (w, h), d in zip(sizes, datas):
        entries += struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(d), off)
        off += len(d)
    dst.write_bytes(head + entries + b"".join(datas))


def main():
    args = sys.argv[1:]
    if "--check" in args:
        sys.exit(check_ts())
    if "--extension" in args:
        write_ts(["extension"])
        print("export extension : src/shared/brand-head.ts")
        return
    write_ts(["web", "extension"])
    if "--ts" in args:
        print("export TypeScript : web/src/ui/brand/head.ts, wordmark.ts, extension/src/shared/brand-head.ts")
        return
    V, P = M / "variantes", M / "png"
    ICONS.mkdir(parents=True, exist_ok=True)
    (ICONS / "favicon.svg").write_bytes((V / "favicon.svg").read_bytes())
    (ICONS / "owl-head.svg").write_bytes((M / "aethryon-master.svg").read_bytes())
    for dst in (ICONS / "favicon.ico", WEB / "public/favicon.ico"):
        write_ico(dst, [P / "aethryon-petit-16.png", P / "aethryon-symbole-32.png", P / "aethryon-symbole-48.png"])
    (WEB / "public/apple-touch-icon.png").write_bytes((P / "apple-touch-icon.png").read_bytes())
    jobs = [{"in": str(V / "aethryon-app.svg"), "out": str(ICONS / f"app-icon-{n}.png"), "size": n, "bg": "transparent", "pad": 0} for n in (192, 512)]
    jobs.append({"in": str(V / "aethryon-app-masquable.svg"), "out": str(ICONS / "app-icon-maskable-512.png"), "size": 512, "bg": "transparent", "pad": 0})
    jf = M / "png" / "_web_jobs.json"
    jf.write_text(json.dumps(jobs), encoding="utf-8")
    subprocess.run(["node", str(M / "tools/render.mjs"), "--batch", str(jf)], check=True)
    jf.unlink()
    subprocess.run(["node", str(M / "tools/og.mjs"), str(WEB / "public/brand/aethryon/og-image.png")], check=True)
    print("export web : head.ts, wordmark.ts, brand-head.ts (extension), favicon.svg/.ico, apple-touch-icon, icônes 192/512/masquable, og-image")


if __name__ == "__main__":
    main()
