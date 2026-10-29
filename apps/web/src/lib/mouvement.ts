// Réglage « Mouvement » d'Égide (thème choisi dans Apparence) et demande du système, lus ensemble : UNE règle pour le
// récit de la scène de l'accueil et pour les objets 3D (ui/retro), qui ne bougent que si le mouvement est complet.
import { useSyncExternalStore } from "react";

/** Mouvement « complet » : pas de demande du système (sauf choix explicite d'un thème personnel), intensité complète ou douce. */
export function mouvementComplet(): boolean {
  const h = document.documentElement;
  const m = h.getAttribute("data-eg-motion") ?? "complete";
  if (m === "reduite" || m === "aucune") return false;
  const explicite = h.getAttribute("data-eg-motion-explicite") === "1";
  return explicite || !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function suivre(rappel: () => void): () => void {
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  const mo = new MutationObserver(rappel);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-eg-motion", "data-eg-motion-explicite"] });
  mq.addEventListener("change", rappel);
  return () => { mo.disconnect(); mq.removeEventListener("change", rappel); };
}

/** La même règle, suivie en direct (thème changé dans Apparence, réglage du système). Pré-rendu : non (image fixe). */
export function useMouvementComplet(): boolean {
  return useSyncExternalStore(suivre, mouvementComplet, () => false);
}
