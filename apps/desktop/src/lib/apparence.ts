// Apparence d'AETHRYON Desktop (Égide, lot 2) : les six thèmes et l'éditeur, préférence gardée, mouvement réduit.
//
// Où est gardée la préférence (choix documenté dans LOT2.md) : dans le stockage local de WebView2, par la persistance
// d'Égide (`creerPersistance`, clé « aethryon.apparence.v1 », enregistrement relu et revalidé à chaque lecture). C'est
// la seule source lisible AVANT la première image : `theme-boot.js` (script externe en tête de index.html et de
// zone-menu.html) pose le thème dès le premier rendu, écran de démarrage compris, sans attendre le cœur Rust ; la fenêtre
// et le menu de la zone de notification partagent le même profil WebView2, donc la même préférence. Le cœur Rust ne
// garde rien : il reçoit seulement la couleur de fond du thème appliqué (`fenetre_fond`) pour peindre le fond natif de
// la fenêtre pendant un redimensionnement. Profil WebView2 effacé : retour à Obsidian (jamais d'erreur).
//
// Mouvement : « Réduire les animations » (Paramètres, config.json : Système / Oui / Non) s'ajoute au réglage du thème :
// Oui → intensité « réduite » ; Non → le thème prime sur le réglage du système (choix explicite) ; Système → le thème
// et Windows décident. `data-d-reduit` (sur <html>) dit le résultat aux feuilles et au code du Desktop.
import { invoke } from "@tauri-apps/api/core";
import {
  creerPersistance, demarrerTheme, EVENEMENT_THEME, OFFICIELS, type DocTheme, type Persistance, type ThemeId, type ThemeResolu,
} from "./egide";
import type { Animations, Theme } from "./types";

export const persistance: Persistance = creerPersistance();
const CLE_REPRISE = "aethryon.desktop.ancien-theme-repris";
let animations: Animations = "systeme";
let theme: ThemeResolu | null = null;
let nom = "Obsidian";
const abonnes = new Set<() => void>();

/** Thème appliqué (résolu) et son nom affiché : pour Paramètres › Apparence. */
export const themeApplique = (): ThemeResolu | null => theme;
export const nomThemeApplique = (): string => nom;
export function surTheme(f: () => void): () => void {
  abonnes.add(f);
  return () => abonnes.delete(f);
}

/** Pose data-d-reduit d'après les variables calculées (thème + système + réglage du Desktop). */
function poserMouvement(): void {
  const el = document.documentElement;
  if (animations === "oui") {
    el.setAttribute("data-eg-motion", "reduite");
    el.removeAttribute("data-eg-motion-explicite");
  } else if (animations === "non") {
    el.setAttribute("data-eg-motion-explicite", "1");
  }
  const move = getComputedStyle(el).getPropertyValue("--eg-move").trim();
  el.setAttribute("data-d-reduit", move === "0" ? "1" : "0");
}

function apresTheme(r: ThemeResolu): void {
  theme = r;
  nom = nomTheme(r, r.officiel ? null : persistance.lire().perso);
  poserMouvement();
  // Fond natif de la fenêtre = fond du thème (redimensionnement sans bande d'une autre couleur). Hors Tauri : rien.
  invoke("fenetre_fond", { couleur: r.c.canvas }).catch(() => {});
  for (const f of abonnes) f();
}

/**
 * Démarrage (main.tsx, avant le premier rendu React) : applique la préférence (Obsidian si rien ou si abîmée), puis suit
 * chaque application de thème (éditeur, Annuler, réinitialisation) et le réglage « mouvement » de Windows.
 */
export function demarrerApparence(): void {
  const el = document.documentElement;
  el.addEventListener(EVENEMENT_THEME, (e) => apresTheme((e as CustomEvent<{ theme: ThemeResolu }>).detail.theme));
  apresTheme(demarrerTheme(el, persistance).theme);
  try { matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", poserMouvement); } catch { /* sans matchMedia */ }
}

/** Réglage « Réduire les animations » du Desktop (config.json), appliqué à chaque lecture de la configuration. */
export function appliquerAnimations(choix: Animations): void {
  if (choix === animations) return;
  animations = choix;
  // Revenir à « Système » : on repart des attributs du thème appliqué.
  if (choix === "systeme" && theme) {
    const el = document.documentElement;
    el.removeAttribute("data-eg-motion-explicite");
    el.setAttribute("data-eg-motion", theme.mouvement);
    if (theme.mouvementExplicite) el.setAttribute("data-eg-motion-explicite", "1");
  }
  poserMouvement();
}

/**
 * Passage depuis l'ancien réglage « Thème » (Système / Clair / Sombre de config.json) : une seule fois, et seulement si
 * aucune préférence Égide n'existe encore sur cet appareil. Clair → Ivory ; Sombre → Obsidian ; Système → Ivory si
 * Windows est en mode clair, sinon Obsidian. Rien n'est jamais écrasé.
 */
export function reprendreAncienTheme(ancien: Theme): ThemeId | null {
  // Une seule fois par appareil, même après « Tout réinitialiser » (qui efface la préférence et revient à Obsidian).
  try {
    if (localStorage.getItem(CLE_REPRISE)) return null;
    localStorage.setItem(CLE_REPRISE, "1");
  } catch { return null; }
  if (persistance.lire().maj) return null;
  const clair = ancien === "clair" || (ancien === "systeme" && typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches);
  const actif: ThemeId = clair ? "ivory" : "obsidian";
  if (actif === "obsidian" && ancien !== "sombre") return null;
  persistance.ecrire({ actif });
  demarrerTheme(document.documentElement, persistance);
  return actif;
}

/** Nom affiché du thème appliqué (« Obsidian », « Mon thème »…). */
export function nomTheme(r: ThemeResolu | null, perso: DocTheme | null): string {
  if (!r) return "Obsidian";
  return r.officiel ? OFFICIELS[r.base].nom : perso?.name ?? "Custom";
}
