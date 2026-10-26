// Pictogrammes du menu de la page (V3.5) : traits de 1,6 px sur une grille de 16, dessinés ici (aucune police
// d'icônes, aucune ressource distante). Construits avec createElementNS : jamais d'innerHTML dans une page.

const SVG_NS = "http://www.w3.org/2000/svg";

const PATHS = {
  download: ["M8 2.5v7.5", "M4.6 6.8 8 10.2l3.4-3.4", "M3 13.2h10"],
  audio: ["M6.2 11.6V3.9l6.3-1.4v7.6", "M6.2 11.6a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0Z", "M12.5 10.1a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0Z"],
  scissors: ["M5.6 5.4 13 12", "M5.6 10.6 13 4", "M5.6 4.2a1.7 1.7 0 1 1-3.4 0 1.7 1.7 0 0 1 3.4 0Z", "M5.6 11.8a1.7 1.7 0 1 1-3.4 0 1.7 1.7 0 0 1 3.4 0Z"],
  image: ["M2.5 3.5h11v9h-11z", "m2.8 11.2 3.3-3.3 2.4 2.4 1.6-1.6 3.1 3.1", "M10.6 6.2a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"],
  thumb: ["M2.5 4h11v8h-11z", "M6.8 6.2v3.6L9.9 8z"],
  tools: ["M9.2 2.8h4v4", "M13.2 2.8 7.6 8.4", "M11.8 9.2v4H2.8V4.2h4"],
  chevronRight: ["M6.2 3.6 10.6 8l-4.4 4.4"],
  chevronLeft: ["M9.8 3.6 5.4 8l4.4 4.4"],
  chevronUp: ["M3.6 9.8 8 5.4l4.4 4.4"],
  chevronDown: ["M3.6 6.2 8 10.6l4.4-4.4"],
  check: ["M3 8.6 6.4 12 13 4.6"],
  close: ["M4.2 4.2l7.6 7.6", "M11.8 4.2l-7.6 7.6"],
  folder: ["M2.5 4.2h3.9l1.4 1.4h5.7v6.6h-11z"],
  markIn: ["M6.6 3.2H4.4v9.6h2.2", "M9 8h3.6", "M11 6.4 12.6 8 11 9.6"],
  markOut: ["M9.4 3.2h2.2v9.6H9.4", "M7 8H3.4", "M5 6.4 3.4 8 5 9.6"],
  gif: ["M2.5 3.5h11v9h-11z", "M6.4 6.6H5.2v2.8h1.4V8.2", "M8 6.6v2.8", "M9.6 9.4V6.6h1.6", "M9.6 8h1.2"],
  alert: ["M8 4.4v4.4", "M8 11.2v.2"],
} as const;

const FILLED = {
  play: "M5 3.4v9.2L12.4 8z",
  pause: "M4.6 3.4h2.4v9.2H4.6zM9 3.4h2.4v9.2H9z",
} as const;

export type MenuIcon = keyof typeof PATHS | keyof typeof FILLED;

export function menuIcon(doc: Document, name: MenuIcon, size = 16): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", `ico ico-${name}`);
  if (name in FILLED) {
    const p = doc.createElementNS(SVG_NS, "path");
    p.setAttribute("d", FILLED[name as keyof typeof FILLED]);
    p.setAttribute("fill", "currentColor");
    svg.appendChild(p);
    return svg;
  }
  for (const d of PATHS[name as keyof typeof PATHS]) {
    const p = doc.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "1.6");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    svg.appendChild(p);
  }
  return svg;
}
