// Rendu statique des pages publiques (docs/ARCHITECTURE.md « Rendu statique ») : le HTML de l'accueil,
// de l'aide, de l'installation, de la confidentialité, de la connexion et de la page 404 est produit À LA
// CONSTRUCTION par les mêmes composants (src/entry-static.tsx, scripts/prerender.mjs), puis remplacé dans
// le navigateur par l'application (main.tsx). Ce module dit aux composants dans quel cas ils se trouvent.
import { createContext, useContext } from "react";

/** Rendu à la construction : présent seulement pendant le pré-rendu, jamais dans le navigateur. */
export interface PrerenderInfo {
  /** Origine publique du site (og:url de index.html), pour les adresses absolues (QR code). */
  origin: string;
  /** Titre de la page, relevé par useDocumentTitle pendant le rendu, écrit dans le HTML. */
  title?: string;
}

export const PrerenderContext = createContext<PrerenderInfo | null>(null);

/** Non nul pendant le pré-rendu : un composant peut alors écrire, masqué (attribut hidden), un contenu
 *  que le navigateur n'affiche qu'à la demande (réponses de la FAQ, autres solutions) : il est lisible par
 *  les robots et, grâce à la feuille sans-js.css, par les lecteurs sans JavaScript. */
export function usePrerender(): PrerenderInfo | null {
  return useContext(PrerenderContext);
}

/** Origine du site pour une adresse absolue (QR code) : celle de la page dans le navigateur ; au
 *  pré-rendu, l'origine publique (le HTML statique ne sait pas sur quelle adresse il sera affiché). */
export function useSiteOrigin(): string {
  const prerender = useContext(PrerenderContext);
  return prerender ? prerender.origin : window.location.origin;
}

/** Vrai pendant le PREMIER rendu dans le navigateur d'une page pré-rendue : son contenu est déjà à l'écran,
 *  il ne rejoue donc aucune entrée animée (titre du héros, révélations au défilement). Remis à faux après
 *  ce premier rendu (main.tsx) : une navigation ensuite garde ses animations. */
let staticBoot = false;
export const isStaticBoot = (): boolean => staticBoot;
export function setStaticBoot(on: boolean): void {
  staticBoot = on;
}

/** Révélations au défilement d'une page pré-rendue : les blocs ENTIÈREMENT sous la ligne de flottaison au
 *  démarrage (mesurés sur le HTML statique, AVANT le premier rendu, main.tsx) s'animeront à leur arrivée à
 *  l'écran ; ceux déjà visibles restent affichés tels quels (rien ne disparaît sous les yeux). Jamais en
 *  mouvement réduit ; sans JavaScript, rien ne change (le HTML statique reste affiché). */
const belowFold = new Set<string>();
export function captureFold(root: ParentNode): void {
  if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  for (const el of root.querySelectorAll<HTMLElement>("[data-reveal]")) {
    if (el.getBoundingClientRect().top > window.innerHeight && el.dataset.reveal) belowFold.add(el.dataset.reveal);
  }
}
export const isBelowFold = (key: string): boolean => belowFold.has(key);
