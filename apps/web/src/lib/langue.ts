// Langue de l'interface (2026-10-29) : français (par défaut), anglais ou espagnol, choisie par le visiteur et gardée sur
// CET appareil (localStorage). Jamais devinée : le site reste en français tant qu'on n'en change pas. Le rendu
// pré-calculé est en français ; la langue choisie s'applique juste après le démarrage (instantané serveur : « fr »),
// sans écart d'hydratation. Traduit : l'accueil, sa barre, son panneau et le pied de page ; les autres pages restent en
// français pour l'instant.
import { useSyncExternalStore } from "react";

export type Langue = "fr" | "en" | "es";
export const LANGUES: { id: Langue; nom: string; court: string }[] = [
  { id: "fr", nom: "Français", court: "FR" },
  { id: "en", nom: "English", court: "EN" },
  { id: "es", nom: "Español", court: "ES" },
];
const CLE = "aethryon:langue";

function lire(): Langue {
  try {
    const v = localStorage.getItem(CLE);
    return v === "en" || v === "es" ? v : "fr";
  } catch {
    return "fr";
  }
}

let actuelle: Langue = typeof window === "undefined" ? "fr" : lire();
const abonnes = new Set<() => void>();
if (typeof document !== "undefined") document.documentElement.lang = actuelle;

export function choisirLangue(l: Langue): void {
  actuelle = l;
  try { localStorage.setItem(CLE, l); } catch { /* stockage indisponible : le choix vaut pour cette visite */ }
  document.documentElement.lang = l;
  for (const f of abonnes) f();
}

export function useLangue(): Langue {
  return useSyncExternalStore(
    (f) => { abonnes.add(f); return () => { abonnes.delete(f); }; },
    () => actuelle,
    () => "fr",
  );
}
