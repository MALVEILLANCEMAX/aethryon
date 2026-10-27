// Outils DOM communs aux composants Égide : création d'éléments SANS innerHTML (les textes sont toujours des nœuds
// texte), icônes SVG construites forme par forme, réglages de la plateforme (adresse de la chouette maître).
// Fonctionne dans un document, une page d'extension et une racine Shadow DOM fermée (le document à utiliser est
// passé par l'option `doc`, par défaut `document`). Aucun style en ligne écrit en HTML : seulement CSSOM (CSP).
import { ICONES, type NomIcone } from "../icones.ts";

export type Enfant = Node | string | null | undefined | false;
export type Attributs = Record<string, string | number | boolean | null | undefined>;

export interface OptionsElement {
  class?: string;
  attrs?: Attributs;
  text?: string;
  /** Variables CSS posées par CSSOM (jamais d'attribut style). */
  vars?: Record<string, string>;
  doc?: Document;
}

const SVG = "http://www.w3.org/2000/svg";

/** Réglages par plateforme, posés une fois au démarrage (configurerEgide). */
const reglages: { chouette: string } = { chouette: "" };

/**
 * Adresse du fichier maître de la chouette (assets/aethryon-master.svg, servi tel quel par la plateforme : import
 * Vite `?url`, chrome.runtime.getURL, etc.). Sans elle, la médaille reste un disque sans chouette.
 */
export function configurerEgide(options: { chouette?: string }): void {
  if (typeof options.chouette === "string") reglages.chouette = options.chouette;
}
export const adresseChouette = (): string => reglages.chouette;

export function poserAttributs(el: Element, attrs: Attributs = {}): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) el.removeAttribute(k);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
}

/** Crée un élément HTML : classes, attributs, texte, variables CSS (CSSOM) et enfants. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, o: OptionsElement = {}, enfants: Enfant[] = []): HTMLElementTagNameMap[K] {
  const d = o.doc ?? document;
  const el = d.createElement(tag);
  if (o.class) el.className = o.class;
  poserAttributs(el, o.attrs);
  if (o.text !== undefined) el.textContent = o.text;
  if (o.vars) for (const [k, v] of Object.entries(o.vars)) el.style.setProperty(k, v);
  for (const e of enfants) if (e !== null && e !== undefined && e !== false) el.append(typeof e === "string" ? d.createTextNode(e) : e);
  return el;
}

/** Élément SVG (espace de noms SVG). */
export function s(tag: string, attrs: Attributs = {}, enfants: Element[] = [], doc: Document = document): SVGElement {
  const el = doc.createElementNS(SVG, tag) as SVGElement;
  poserAttributs(el, attrs);
  for (const e of enfants) el.append(e);
  return el;
}

export interface OptionsIcone {
  /** « s » 15 px, défaut 18 px, « l » 22 px (classes eg-i--s / eg-i--l). */
  taille?: "s" | "l";
  class?: string;
  /** Nom accessible : seulement pour une icône SEULE porteuse de sens ; sinon l'icône est décorative. */
  titre?: string;
  doc?: Document;
}

/** Icône du jeu Égide, en SVG construit forme par forme (aucun innerHTML, aucune référence externe). */
export function icone(nom: NomIcone, o: OptionsIcone = {}): SVGElement {
  const d = o.doc ?? document;
  const cls = ["eg-i", o.taille ? `eg-i--${o.taille}` : "", o.class ?? ""].filter(Boolean).join(" ");
  const formes = (ICONES[nom] as readonly (readonly [string, Readonly<Record<string, string>>])[]).map(([tag, a]) => s(tag, a, [], d));
  const el = s("svg", { class: cls, viewBox: "0 0 24 24", focusable: "false", "aria-hidden": o.titre ? null : "true", role: o.titre ? "img" : null }, formes, d);
  if (o.titre) el.setAttribute("aria-label", o.titre);
  return el;
}

/** Identifiant unique dans le document (liens label / aide / infobulle). */
let compteur = 0;
export const idUnique = (prefixe = "eg"): string => `${prefixe}-${(++compteur).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Nœud racine où insérer une couche (infobulle, menu) : la racine Shadow DOM de l'élément, sinon le body. */
export function coucheDe(el: Element): ParentNode {
  const r = el.getRootNode();
  if (r instanceof ShadowRoot) return (r.querySelector(".eg-racine") as ParentNode | null) ?? r;
  return el.ownerDocument.body;
}

/** Mouvement actif pour un élément (thème + système) : 0 = aucun. */
export function echelleMouvement(el: Element): number {
  const v = parseFloat(getComputedStyle(el).getPropertyValue("--eg-motion-scale"));
  return Number.isFinite(v) ? v : 1;
}
