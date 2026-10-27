// Racine Shadow DOM Égide (menu injecté de l'extension, toute interface posée dans une page tierce). La feuille est
// ADOPTÉE (feuille construite par CSSOM : permise par une CSP stricte « style-src 'self' », là où un élément <style>
// en ligne est refusé ; essai navigateur à l'appui), avec repli <style> si adoptedStyleSheets manque. Les jetons
// sont portés par .eg-racine, élément interne que la page hôte ne peut pas cibler (voir feuille.ts, versShadow).
import { EGIDE_CSS_SHADOW } from "../genere/css-shadow.ts";
import { appliquerTheme, type EntreeTheme } from "../appliquer.ts";
import type { ThemeResolu } from "../moteur.ts";

const feuilles = new WeakMap<Document, CSSStyleSheet>();

/** Pose la feuille Égide (ou `css`) dans une racine Shadow DOM. Une seule feuille construite par document. */
export function poserFeuilleOmbre(racine: ShadowRoot, css: string = EGIDE_CSS_SHADOW): "adoptee" | "style" {
  const doc = racine.ownerDocument;
  try {
    if ("adoptedStyleSheets" in racine && typeof CSSStyleSheet === "function" && "replaceSync" in CSSStyleSheet.prototype) {
      const partagee = css === EGIDE_CSS_SHADOW;
      let f = partagee ? feuilles.get(doc) : undefined;
      if (!f) {
        f = new CSSStyleSheet();
        f.replaceSync(css);
        if (partagee) feuilles.set(doc, f);
      }
      racine.adoptedStyleSheets = [...racine.adoptedStyleSheets, f];
      return "adoptee";
    }
  } catch {
    // navigateur ancien ou contexte qui refuse les feuilles construites : repli ci-dessous
  }
  const s = doc.createElement("style");
  s.textContent = css;
  racine.prepend(s);
  return "style";
}

export interface RacineOmbre {
  /** La racine Shadow DOM (fermée par défaut : la page ne peut pas y lire). */
  racine: ShadowRoot;
  /** L'élément .eg-racine : y mettre l'interface ; menus et infobulles s'y insèrent. */
  enveloppe: HTMLDivElement;
  theme: ThemeResolu;
}

/** Crée l'ombre d'un élément hôte, y pose la feuille et une enveloppe .eg-racine au thème donné (Obsidian par défaut). */
export function creerRacineOmbre(hote: HTMLElement, o: { mode?: ShadowRootMode; theme?: EntreeTheme; css?: string } = {}): RacineOmbre {
  const racine = hote.attachShadow({ mode: o.mode ?? "closed" });
  poserFeuilleOmbre(racine, o.css);
  const enveloppe = hote.ownerDocument.createElement("div");
  enveloppe.className = "eg-racine";
  racine.append(enveloppe);
  const theme = appliquerTheme(enveloppe, o.theme ?? "obsidian");
  return { racine, enveloppe, theme };
}
