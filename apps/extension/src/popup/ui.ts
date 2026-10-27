// Petits outils d'interface partagés par le popup, la page de réglages et la page d'accueil, en Égide (3.9.0) : création
// d'éléments sans innerHTML (tout texte passe par des nœuds texte), icônes du jeu Égide (grille 24, trait 1,6, aucune
// marque dessinée), chouette maître (fichier design/assets/aethryon-master.svg servi tel quel par l'extension, dans un
// <img>), logotype en Marcellus, ouverture de liens dans un nouvel onglet.
import { platformIcon } from "../shared/icons.ts";
import { chouette, icone, type NomIcone } from "../shared/egide.ts";
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

// ---- icônes : noms de l'extension → jeu Égide (une seule source, design/src/icones.ts) ------------------------------
const ICONS = {
  settings: "reglages", download: "convertir", folder: "dossier", retry: "retour", close: "croix", external: "ouvrir", check: "ok",
  alert: "alerte", info: "info", logout: "partager", film: "video", music: "son", chevron: "bas", clock: "horloge", stop: "interdit",
  user: "compte", lock: "cadenas", puzzle: "extension", pin: "plus", eye: "oeil", shield: "droits", spark: "plus", wifi: "flux",
  cut: "ciseaux", camera: "image", image: "grille", gif: "gif", studio: "fenetre", link: "lien", theme: "theme", premiere: "chutier",
  owl: "compte", fil: "fil", list: "liste", paste: "coller", copy: "copier", import: "importer", export: "exporter", forbidden: "interdit",
  grid: "grille", archive: "archive", wave: "onde", vertical: "vertical", post: "post", live: "direct", back: "chevron", plus: "plus",
  start: "debut", end: "fin", play: "lecture", pause: "pause", search: "cherche", browser: "navigateur",
} as const satisfies Record<string, NomIcone>;
export type IconName = keyof typeof ICONS;

/** Icône décorative (aria-hidden) du jeu Égide, couleur héritée. */
export function icon(name: IconName, size = 18, className?: string): SVGElement {
  const svg = icone(ICONS[name]);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.style.setProperty("width", `${size}px`);
  svg.style.setProperty("height", `${size}px`);
  if (className) svg.classList.add(...className.split(" ").filter(Boolean));
  return svg;
}

/** La chouette maître (fichier tel quel), décorative. */
export function owl(size: number): HTMLImageElement {
  const img = chouette({ taille: size });
  img.classList.add("owl");
  return img;
}

/** Logo AETHRYON : la chouette maître et le nom en Marcellus (nom accessible : « AETHRYON »). */
export function brandLogo(markPx: number, _capPx?: number): HTMLElement {
  return h("span", { class: "brand-mark" }, owl(markPx), h("span", null, "AETHRYON"));
}

/** Pictogramme neutre de plateforme (décoratif : le nom est toujours écrit à côté). */
export function platformLogo(platform: Platform, size = 16): SVGSVGElement {
  const svg = platformIcon(document, platform, size);
  svg.setAttribute("class", "pf-logo");
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
