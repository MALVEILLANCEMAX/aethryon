// Repères des plateformes en SVG intégré (aucun fichier distant, aucune ressource web exposée aux pages).
// AUCUN logo de marque : les règles de YouTube, TikTok et X l'interdisent pour un service de conversion
// (docs/MARQUES.md). Mêmes pictogrammes que le site (web/src/ui/brand/PlatformGlyph.tsx) : la FORME dit le
// format (lecteur paysage, cartes portrait empilées, publication avec média), un seul accent or (classe
// glyph-acc, couleur var(--gold) dans popup.css et styles.ts). Le nom de la plateforme est toujours écrit à côté.
// La tête de chouette AETHRYON n'est PAS ici : src/shared/owl.ts la dessine depuis brand-head.ts (généré
// depuis brand/master).

type Shape = { tag: "rect" | "path" | "circle"; a: Record<string, string>; acc?: boolean };
const GLYPHS: Record<"youtube" | "tiktok" | "twitter", Shape[]> = {
  youtube: [
    { tag: "rect", a: { x: "2.5", y: "5.25", width: "19", height: "13.5", rx: "3.2" } },
    { tag: "path", a: { d: "M6.2 15h11.6", opacity: "0.3" } },
    { tag: "path", a: { d: "M6.2 15h6", "stroke-width": "2.2" }, acc: true },
    { tag: "circle", a: { cx: "12.6", cy: "15", r: "1.5", fill: "currentColor", stroke: "none" } },
  ],
  tiktok: [
    { tag: "path", a: { d: "M5.1 16.4V7.3a2.6 2.6 0 0 1 2.6-2.6", "stroke-width": "1.8" }, acc: true },
    { tag: "rect", a: { x: "8", y: "2.75", width: "10.75", height: "18.5", rx: "2.9" } },
    { tag: "path", a: { d: "M10.9 16.6h3.4", opacity: "0.45" } },
  ],
  twitter: [
    { tag: "rect", a: { x: "3.5", y: "3.5", width: "17", height: "17", rx: "3.4" } },
    { tag: "circle", a: { cx: "7.7", cy: "7.9", r: "1.5", fill: "currentColor", stroke: "none" } },
    { tag: "path", a: { d: "M10.7 7.9h5.6", opacity: "0.55" } },
    { tag: "rect", a: { x: "6.5", y: "11.1", width: "11", height: "6.4", rx: "1.5", fill: "currentColor", opacity: "0.45", stroke: "none" }, acc: true },
  ],
};

const SVG_NS = "http://www.w3.org/2000/svg";

/** Pictogramme neutre d'une plateforme (trait = currentColor, accent or). Décoratif si aucun libellé. */
export function platformIcon(doc: Document, platform: keyof typeof GLYPHS, size: number, label?: string): SVGSVGElement {
  const svg = base(doc, "0 0 24 24", size, label);
  for (const [k, v] of Object.entries({ fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round" })) svg.setAttribute(k, v);
  svg.setAttribute("data-glyph", platform);
  for (const shape of GLYPHS[platform]) {
    const el = doc.createElementNS(SVG_NS, shape.tag);
    for (const [k, v] of Object.entries(shape.a)) el.setAttribute(k, v);
    if (shape.acc) el.setAttribute("class", "glyph-acc");
    svg.appendChild(el);
  }
  return svg;
}

function base(doc: Document, viewBox: string, size: number, label?: string): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("focusable", "false");
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }
  return svg;
}
