// Tête maître d'AETHRYON et logotype, dessinés en SVG sans framework (popup, réglages, page d'accueil,
// boutons intégrés aux sites). Même dessin que web/src/ui/brand/OwlMark.tsx et BrandLogo.tsx, depuis les
// valeurs GÉNÉRÉES de brand-head.ts (une seule source : brand/master, docs/IDENTITE-MAITRE.md) :
// - surface "light" : liseré champagne de RIM unité le long de l'écusson (faces rognées), pour que la joue
//   ivoire ne se fonde pas dans un fond clair ; "dark" : dessin strictement identique au maître ;
//   "auto" : liseré seulement en thème clair — la feuille de style de la page coupe le masque en thème
//   sombre (`.owl-mark[data-surface="auto"] .owl-faces { mask: none }`, une propriété CSS l'emporte sur
//   l'attribut de présentation « mask »).
// - tête de 24 px ou moins (marge exclue) : petit logo (amandes des yeux +6 %, reflets carrés alignés sur la
//   grille de 16 px, ligne du front retirée).
// - les yeux sont un groupe à part (.owl-eyes) : clignement et regard sont de vrais mouvements, jamais une
//   déformation de la silhouette.
// Aucun innerHTML : chaque élément est créé un à un. Décoratif par défaut (aria-hidden).
import { HEAD, RIM, SMALL, WORDMARK } from "./brand-head.ts";

const NS = "http://www.w3.org/2000/svg";
let seq = 0;

export type OwlSurface = "light" | "dark" | "auto";

export interface OwlOptions {
  /** Côté du carré, en px. */
  size: number;
  surface?: OwlSurface;
  /** Marge intérieure, en unités de la grille de 64 (la mascotte réserve de la place pour bouger). */
  pad?: number;
  /** Nom accessible ; absent = décorative. */
  label?: string;
  className?: string;
}

type Attrs = Record<string, string | number | null | undefined>;

function el<K extends keyof SVGElementTagNameMap>(doc: Document, tag: K, attrs: Attrs = {}, ...children: Element[]): SVGElementTagNameMap[K] {
  const e = doc.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, String(v));
  for (const c of children) e.appendChild(c);
  return e;
}

/** La tête est-elle dessinée en « petit logo » à cette taille ? (tête réelle, marge exclue) */
export const isSmallOwl = (size: number, pad = 0): boolean => size * (64 / (64 + 2 * pad)) <= SMALL.maxPx;

/** Tête maître (OwlMark du site), en SVG. */
export function owlSvg(doc: Document, o: OwlOptions): SVGSVGElement {
  const pad = o.pad ?? 0;
  const surface = o.surface ?? "light";
  const small = isSmallOwl(o.size, pad);
  const span = 64 + 2 * pad;
  const svg = el(doc, "svg", {
    viewBox: `${-pad} ${-pad} ${span} ${span}`, width: o.size, height: o.size, fill: "none", focusable: "false",
    class: ["owl-mark", o.className].filter(Boolean).join(" "), "data-surface": surface, "data-small": small ? "" : null,
  });
  if (o.label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", o.label);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }
  let mask: string | null = null;
  if (surface !== "dark") {
    mask = `owl-rim-${++seq}`;
    svg.appendChild(el(doc, "defs", {},
      el(doc, "mask", { id: mask, maskUnits: "userSpaceOnUse", x: 0, y: 0, width: 64, height: 64 },
        el(doc, "path", { d: HEAD.shell.d, fill: "#fff" }),
        el(doc, "path", { d: HEAD.shell.d, fill: "none", stroke: "#000", "stroke-width": RIM * 2 }))));
  }
  const [elx, ely] = SMALL.eyeLeftCenter;
  const [erx, ery] = SMALL.eyeRightCenter;
  const k = SMALL.eyeScale;
  const scaled = (cx: number, cy: number) => `translate(${cx} ${cy}) scale(${k}) translate(${-cx} ${-cy})`;
  const eyes = small
    ? el(doc, "g", { class: "owl-eyes" },
      el(doc, "path", { d: HEAD.eyeLeft.d, fill: HEAD.eyeLeft.fill, transform: scaled(elx, ely) }),
      el(doc, "path", { d: HEAD.eyeRight.d, fill: HEAD.eyeRight.fill, transform: scaled(erx, ery) }),
      el(doc, "rect", { ...SMALL.glintLeft, fill: HEAD.glintLeft.fill }),
      el(doc, "rect", { ...SMALL.glintRight, fill: HEAD.glintRight.fill }))
    : el(doc, "g", { class: "owl-eyes" },
      el(doc, "path", { d: HEAD.eyeLeft.d, fill: HEAD.eyeLeft.fill }),
      el(doc, "path", { d: HEAD.eyeRight.d, fill: HEAD.eyeRight.fill }),
      el(doc, "circle", { cx: HEAD.glintLeft.cx, cy: HEAD.glintLeft.cy, r: HEAD.glintLeft.r, fill: HEAD.glintLeft.fill }),
      el(doc, "circle", { cx: HEAD.glintRight.cx, cy: HEAD.glintRight.cy, r: HEAD.glintRight.r, fill: HEAD.glintRight.fill }));
  const head = el(doc, "g", { class: "owl-head" },
    el(doc, "path", { d: HEAD.shell.d, fill: HEAD.shell.fill }),
    el(doc, "g", { class: "owl-faces", mask: mask ? `url(#${mask})` : null },
      el(doc, "path", { d: HEAD.faceLeft.d, fill: HEAD.faceLeft.fill }),
      el(doc, "path", { d: HEAD.faceRight.d, fill: HEAD.faceRight.fill })),
    eyes,
    el(doc, "path", { d: HEAD.browLeft.d, fill: HEAD.browLeft.fill }),
    el(doc, "path", { d: HEAD.browRight.d, fill: HEAD.browRight.fill }));
  if (!small) head.appendChild(el(doc, "path", { d: HEAD.browLine.d, stroke: HEAD.browLine.stroke, "stroke-width": HEAD.browLine.strokeWidth }));
  head.appendChild(el(doc, "path", { d: HEAD.beakLeft.d, fill: HEAD.beakLeft.fill }));
  head.appendChild(el(doc, "path", { d: HEAD.beakRight.d, fill: HEAD.beakRight.fill }));
  svg.appendChild(head);
  return svg;
}

/**
 * Logotype AETHRYON en Marcellus (contours vectoriels, aucune police chargée), comme BrandLogo du site.
 * capPx : hauteur des capitales (10 px au minimum, docs/IDENTITE-MAITRE.md §5). Couleur : currentColor.
 */
export function wordmarkSvg(doc: Document, capPx: number, label = "AETHRYON"): SVGSVGElement {
  const h = capPx * WORDMARK.heightPerCap;
  return el(doc, "svg", {
    viewBox: WORDMARK.viewBox, width: (h * WORDMARK.ratio).toFixed(2), height: h.toFixed(2), role: "img", "aria-label": label,
    focusable: "false", class: "wordmark-svg",
  }, el(doc, "path", { d: WORDMARK.d, fill: "currentColor" }));
}
