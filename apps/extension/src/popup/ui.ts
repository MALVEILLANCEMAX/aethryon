// Petits outils d'interface partagés par le popup, la page de réglages et la page d'accueil : création
// d'éléments sans innerHTML (tout texte passe par des nœuds texte), icônes au trait fin (1,6 px, comme le
// site), tête maître et logotype (src/shared/owl.ts), ouverture de liens dans un nouvel onglet.
import { platformIcon } from "../shared/icons.ts";
import { owlSvg, wordmarkSvg, type OwlSurface } from "../shared/owl.ts";
import type { Platform } from "../shared/urls.ts";

type Child = Node | string | number | null | undefined | false;
type Handler = (e: Event) => void;
export type Props = Record<string, string | number | boolean | null | undefined | Handler>;

/** Élément HTML : attributs, écouteurs « on… », enfants (les chaînes deviennent des nœuds texte). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = String(v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
}

/** Remplace le contenu d'un élément. */
export function fill(el: Element, ...children: Child[]): void {
  el.replaceChildren();
  append(el, children);
}

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`élément #${id} introuvable`);
  return el;
}

// ---- icônes --------------------------------------------------------------------------------------
const SVG_NS = "http://www.w3.org/2000/svg";
type Shape = [tag: "path" | "circle" | "rect", attrs: Record<string, string>];
const p = (d: string): Shape => ["path", { d }];

const ICONS = {
  settings: [p("M4 7h9M17 7h3M4 17h3M11 17h9"), ["circle", { cx: "15", cy: "7", r: "2" }], ["circle", { cx: "9", cy: "17", r: "2" }]],
  download: [p("M12 4v11m-5-5 5 5 5-5M5 20h14")],
  folder: [p("M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z")],
  retry: [p("M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4")],
  close: [p("M6 6l12 12M18 6L6 18")],
  external: [p("M7 17 17 7M8 7h9v9")],
  check: [p("M5 12.5l4.5 4.5L19 7.5")],
  alert: [p("M12 8v5M12 16.5v.5"), p("M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z")],
  info: [["circle", { cx: "12", cy: "12", r: "9" }], p("M12 11v5M12 7.5v.5")],
  logout: [p("M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4")],
  film: [["rect", { x: "3", y: "5", width: "18", height: "14", rx: "2.5" }], p("M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4")],
  music: [p("M9 18V5l11-2v13"), ["circle", { cx: "6.5", cy: "18", r: "2.5" }], ["circle", { cx: "17.5", cy: "16", r: "2.5" }]],
  chevron: [p("M6 9l6 6 6-6")],
  clock: [["circle", { cx: "12", cy: "12", r: "9" }], p("M12 7.5V12l3 2")],
  stop: [["rect", { x: "6.5", y: "6.5", width: "11", height: "11", rx: "2" }]],
  user: [["circle", { cx: "12", cy: "8.5", r: "3.5" }], p("M5 20a7 7 0 0 1 14 0")],
  lock: [["rect", { x: "5", y: "10.5", width: "14", height: "10", rx: "2.5" }], p("M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3")],
  // Pièce de puzzle (menu « Extensions » de Chrome) et punaise (épingler) : pour expliquer l'épinglage.
  puzzle: [p("M9 4.5a2 2 0 0 1 4 0V6h3.5A1.5 1.5 0 0 1 18 7.5V11h1.5a2 2 0 0 1 0 4H18v3.5a1.5 1.5 0 0 1-1.5 1.5H13v-1.5a2 2 0 0 0-4 0V20H5.5A1.5 1.5 0 0 1 4 18.5V15h1.5a2 2 0 0 0 0-4H4V7.5A1.5 1.5 0 0 1 5.5 6H9z")],
  pin: [p("M9 4h6l-1 6 3.5 3.5H6.5L10 10zM12 13.5V20")],
  eye: [p("M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"), ["circle", { cx: "12", cy: "12", r: "2.8" }]],
  shield: [p("M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z"), p("M9 12l2.2 2.2L15.5 10")],
  spark: [p("M12 3.5c.6 4.3 1.9 6.3 6.5 7.5-4.6 1.2-5.9 3.2-6.5 7.5-.6-4.3-1.9-6.3-6.5-7.5 4.6-1.2 5.9-3.2 6.5-7.5z")],
  wifi: [p("M3.5 9.5a12 12 0 0 1 17 0M6.5 12.5a7.5 7.5 0 0 1 11 0M9.5 15.5a3.2 3.2 0 0 1 5 0"), ["circle", { cx: "12", cy: "18.5", r: "1" }]],
  // V3 : extrait (crochets de montage, comme AETHRYON Tools), image de la vidéo, miniature, GIF, Tools, lien.
  cut: [p("M8 4H5v16h3M16 4h3v16h-3"), p("M9.5 9.5h5M9.5 14.5h5")],
  camera: [p("M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.2-2h5l1.2 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"), ["circle", { cx: "12", cy: "12.5", r: "3.3" }]],
  image: [["rect", { x: "3.5", y: "5", width: "17", height: "14", rx: "2.5" }], ["circle", { cx: "9", cy: "10", r: "1.6" }], p("M20.5 16.5 15.5 11.5l-8.5 7.5")],
  gif: [["rect", { x: "2.5", y: "5", width: "19", height: "14", rx: "3" }], p("M9.5 10.2a2 2 0 0 0-1.8-1.2C6.6 9 6 9.9 6 12s.6 3 1.8 3c1.1 0 1.7-.8 1.7-2.2H8M12.5 9v6M15.5 15V9h3M15.5 12h2.4")],
  studio: [p("M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z"), p("M13.5 6.5l3 3")],
  link: [p("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"), p("M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1")],
} satisfies Record<string, Shape[]>;
export type IconName = keyof typeof ICONS;

/** Icône décorative (aria-hidden) au trait, couleur héritée. */
export function icon(name: IconName, size = 18, className?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: String(size), height: String(size), fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) {
    svg.setAttribute(k, v);
  }
  if (className) svg.setAttribute("class", className);
  for (const [tag, attrs] of ICONS[name] as Shape[]) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

/** Tête maître AETHRYON (décorative) ; « auto » : liseré champagne en thème clair, dessin exact en sombre. */
export function owl(size: number, surface: OwlSurface = "auto"): SVGSVGElement {
  return owlSvg(document, { size, surface, className: "owl" });
}

/**
 * Logo AETHRYON (comme BrandLogo du site) : tête maître + logotype Marcellus en contours. Le nom accessible
 * est porté par le logotype (role="img", « AETHRYON ») ; la tête est décorative.
 */
export function brandLogo(markPx: number, capPx: number): HTMLElement {
  return h("span", { class: "brand-logo" }, owl(markPx), wordmarkSvg(document, capPx));
}

/** Logo de plateforme (décoratif : le nom est toujours écrit à côté). */
export function platformLogo(platform: Platform, size = 16): SVGSVGElement {
  const svg = platformIcon(document, platform, size);
  svg.setAttribute("class", "pf-logo");
  return svg;
}

/** Illustration discrète « aucune vidéo » : cadre et lecture, traits atténués. */
export function emptyIllustration(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 120 76", width: "120", height: "76", fill: "none", "aria-hidden": "true", focusable: "false", class: "empty-art" })) svg.setAttribute(k, v);
  const shapes: Shape[] = [
    ["rect", { x: "8", y: "6", width: "104", height: "62", rx: "14", class: "ea-frame" }],
    ["rect", { x: "16", y: "14", width: "88", height: "46", rx: "9", class: "ea-screen" }],
    ["path", { d: "M54 29.5v15l13-7.5z", class: "ea-play" }],
    ["path", { d: "M96 4c.4 2.9 1.2 4.6 5.6 5.6-4.4 1-5.2 2.7-5.6 5.6-.4-2.9-1.2-4.6-5.6-5.6 4.4-1 5.2-2.7 5.6-5.6z", class: "ea-spark" }],
  ];
  for (const [tag, attrs] of shapes) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

/** Bouton : texte toujours visible ; icône décorative facultative. */
export function button(label: string, opts: { variant?: "primary" | "secondary" | "quiet" | "danger"; size?: "sm" | "md" | "lg"; icon?: IconName; action?: string; onClick?: Handler; block?: boolean; ariaLabel?: string; describedBy?: string } = {}): HTMLButtonElement {
  const cls = ["btn", `btn-${opts.variant ?? "secondary"}`, `btn-${opts.size ?? "md"}`];
  if (opts.block) cls.push("btn-block");
  const b = h("button", { type: "button", class: cls.join(" "), "data-action": opts.action, "aria-label": opts.ariaLabel, "aria-describedby": opts.describedBy, onclick: opts.onClick },
    opts.icon ? icon(opts.icon, opts.size === "sm" ? 15 : 17) : null,
    h("span", { class: "btn-label" }, label));
  return b;
}

/** Indique qu'une action est en cours sur un bouton (indicateur + aria-busy), et l'inverse. */
export function setBusy(b: HTMLButtonElement, busy: boolean, busyLabel?: string): void {
  const label = b.querySelector(".btn-label");
  if (busy) {
    if (label && busyLabel) {
      b.dataset.label = label.textContent ?? "";
      label.textContent = busyLabel;
    }
    b.setAttribute("aria-busy", "true");
    b.disabled = true;
    if (!b.querySelector(".spinner")) b.prepend(h("span", { class: "spinner", "aria-hidden": "true" }));
  } else {
    if (label && b.dataset.label !== undefined) {
      label.textContent = b.dataset.label;
      delete b.dataset.label;
    }
    b.removeAttribute("aria-busy");
    b.disabled = false;
    b.querySelector(".spinner")?.remove();
  }
}

/** Ouvre un lien du site AETHRYON dans un nouvel onglet (chrome.tabs.create : aucune permission requise). */
export function openTab(url: string): void {
  void chrome.tabs.create({ url }).catch(() => window.open(url, "_blank", "noopener"));
}

/** Un clic simple sur un lien du site l'ouvre par chrome.tabs.create (les clics modifiés gardent le comportement du navigateur). */
export function bindSiteLink(a: HTMLAnchorElement, url: string): void {
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  a.addEventListener("click", (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openTab(url);
  });
}

/** Lien vers le site : vrai <a href> (sémantique, copie du lien), ouvert dans un nouvel onglet. */
export function siteLink(label: string, url: string, opts: { className?: string; icon?: IconName } = {}): HTMLAnchorElement {
  const a = h("a", { class: opts.className ?? "link" },
    h("span", null, label), h("span", { class: "sr-only" }, " (nouvel onglet)"), opts.icon ? icon(opts.icon, 14) : null);
  bindSiteLink(a, url);
  return a;
}

/** L'utilisateur a-t-il demandé de réduire les animations ? */
export const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
