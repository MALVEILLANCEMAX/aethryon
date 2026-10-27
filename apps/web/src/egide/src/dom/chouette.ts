// La chouette (signature) et ses états (DESIGN_SYSTEM.md § 9) : marque, médaille, VEILLE (chargement : un fil tourne
// autour, la chouette ne bouge pas), ÉTAT VIDE, SCEAU (succès : frappé une fois). Fichier maître
// assets/aethryon-master.svg UNIQUEMENT, affiché tel quel dans un <img> (jamais redessiné, recoloré ni déformé) ;
// la médaille autour (face, tranche) est du CSS. Au plus une chouette hors marque par vue ; jamais dans une liste.
import { adresseChouette, h, s, type Enfant } from "./base.ts";

type Taille = "s" | "m" | "l" | number;
const TAILLES: Record<"s" | "m" | "l", number> = { s: 40, m: 56, l: 72 };
const px = (t: Taille): number => (typeof t === "number" ? Math.max(14, Math.min(160, Math.round(t))) : TAILLES[t]);

/** La chouette seule (marque : barres, popup, menu, onglet), 14 à 26 px, sans mouvement. */
export function chouette(o: { taille?: number; doc?: Document } = {}): HTMLImageElement {
  const t = Math.round(o.taille ?? 24);
  return h("img", { doc: o.doc, class: "eg-chouette", attrs: { src: adresseChouette() || null, alt: "", width: t, height: t, draggable: "false", decoding: "async" } });
}

/** Médaille : la chouette sur une face frappée (taille en px ou s / m / l = 40 / 56 / 72). */
export function medaille(o: { taille?: Taille; class?: string; doc?: Document } = {}): HTMLSpanElement {
  const t = px(o.taille ?? "m");
  return h("span", { doc: o.doc, class: `eg-medaille ${o.class ?? ""}`.trim(), vars: { "--eg-taille": `${t}px` }, attrs: { "aria-hidden": "true" } },
    [chouette({ taille: Math.round(t * 0.58), doc: o.doc })]);
}

/** Veille (chargement > 400 ms) : la médaille immobile, un fil tourne autour ; arrêté en mouvement réduit. */
export function veille(o: { libelle?: string; doc?: Document } = {}): HTMLSpanElement {
  const anneau = s("svg", { class: "eg-veille-anneau", viewBox: "0 0 56 56", "aria-hidden": "true", focusable: "false" },
    [s("circle", { cx: "28", cy: "28", r: "26.5" }, [], o.doc)], o.doc);
  return h("span", { doc: o.doc, class: "eg-veille", attrs: { role: "img", "aria-label": o.libelle ?? "Chargement" } },
    [anneau, medaille({ taille: 44, doc: o.doc })]);
}

/** Sceau de succès (fichier prêt) : la médaille frappée une fois (420 ms + un reflet), sans mouvement si réduit. */
export function sceau(o: { taille?: Taille; frappe?: boolean; doc?: Document } = {}): HTMLSpanElement {
  return medaille({ taille: o.taille ?? 44, class: `eg-sceau${o.frappe === false ? "" : " eg-sceau--frappe"}`, doc: o.doc });
}

/** Relance la frappe du sceau (sans recréer l'élément). */
export function frapperSceau(el: HTMLElement): void {
  el.classList.remove("eg-sceau--frappe");
  void el.offsetWidth;
  el.classList.add("eg-sceau--frappe");
}

/** État vide : la médaille, une phrase, une action. */
export function etatVide(o: { titre: string; texte?: string; action?: Enfant; taille?: Taille; doc?: Document }): HTMLDivElement {
  return h("div", { doc: o.doc, class: "eg-vide" }, [
    medaille({ taille: o.taille ?? 64, doc: o.doc }),
    h("b", { doc: o.doc, text: o.titre }),
    o.texte ? h("p", { doc: o.doc, text: o.texte }) : null,
    o.action ?? null,
  ]);
}

/** Méandre : attente indéterminée SANS chouette (dans un bouton, une ligne). */
export function meandre(o: { doc?: Document } = {}): SVGElement {
  return s("svg", { class: "eg-meandre", viewBox: "0 0 22 14", "aria-hidden": "true", focusable: "false" },
    [s("path", { d: "M1 13V1h20v12H6V6h10v4h-5" }, [], o.doc)], o.doc);
}
