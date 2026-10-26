// « Réduire les animations » : Système (réglage Windows « Effets d'animation », relayé par prefers-reduced-motion),
// Oui ou Non. L'attribut data-motion de <html> porte le choix ; les jetons CSS raccourcissent les durées.
import type { Animations } from "./types";

export function appliquerMouvement(choix: Animations): void {
  const r = document.documentElement;
  if (choix === "oui") r.dataset.motion = "reduced";
  else if (choix === "non") r.dataset.motion = "full";
  else delete r.dataset.motion;
}

export function mouvementReduit(): boolean {
  if (typeof document === "undefined") return true;
  const m = document.documentElement.dataset.motion;
  if (m === "reduced") return true;
  if (m === "full") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Thème : « systeme » suit Windows (prefers-color-scheme), sinon clair ou sombre. */
export function appliquerTheme(theme: "systeme" | "clair" | "sombre"): void {
  const clair = theme === "clair" || (theme === "systeme" && typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.dataset.theme = clair ? "light" : "dark";
}
