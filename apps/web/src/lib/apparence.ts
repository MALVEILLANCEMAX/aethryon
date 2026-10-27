// Apparence (Égide) côté site : quel thème est posé, et en changer. Le thème est déjà en place AVANT le premier rendu
// (theme-boot.js, externe, lit « aethryon.apparence.v1 » ; Obsidian par défaut, déclaré sur <html>) : le site n'a
// donc pas besoin du moteur pour s'afficher. Le moteur (résolution, contrastes, persistance) n'est chargé qu'au premier
// choix d'un thème ou à l'ouverture de l'éditeur (code séparé, téléchargé à la demande).
import { useSyncExternalStore } from "react";

export type ThemeId = "obsidian" | "ivory" | "oled" | "midnight" | "minimal" | "custom";

/** Les six thèmes, dans l'ordre du socle (design/src/themes.ts, ORDRE_THEMES). */
export const THEMES: readonly { id: ThemeId; nom: string; texte: string; mode: "sombre" | "clair" }[] = [
  { id: "obsidian", nom: "Obsidian", texte: "Sombre, arêtes claires", mode: "sombre" },
  { id: "ivory", nom: "Ivory", texte: "Papier ivoire et encre", mode: "clair" },
  { id: "oled", nom: "OLED", texte: "Noir absolu", mode: "sombre" },
  { id: "midnight", nom: "Midnight", texte: "L'heure de la chouette", mode: "sombre" },
  { id: "minimal", nom: "Minimal", texte: "Rien que l'outil", mode: "clair" },
  { id: "custom", nom: "Custom", texte: "Le tien, en quelques réglages", mode: "sombre" },
];

const IDS = new Set<string>(THEMES.map((t) => t.id));
const EVENEMENT = "eg-theme"; // EVENEMENT_THEME du socle (émis sur <html> à chaque application)

function lireActif(): ThemeId {
  if (typeof document === "undefined") return "obsidian";
  const t = document.documentElement.getAttribute("data-eg-theme") ?? "obsidian";
  return IDS.has(t) ? (t as ThemeId) : "obsidian";
}

function abonner(rappel: () => void): () => void {
  const el = document.documentElement;
  el.addEventListener(EVENEMENT, rappel);
  // Un autre onglet a changé de thème : on le suit (le cache est déjà écrit par l'autre onglet).
  const stockage = (e: StorageEvent) => { if (e.key === "aethryon.apparence.v1") void appliquerDepuisStockage(); };
  window.addEventListener("storage", stockage);
  return () => { el.removeEventListener(EVENEMENT, rappel); window.removeEventListener("storage", stockage); };
}

/** Thème posé sur le document (suit les changements, y compris depuis un autre onglet). */
export function useThemeActif(): ThemeId {
  return useSyncExternalStore(abonner, lireActif, () => "obsidian");
}

/** Le socle complet, chargé une seule fois et à la demande. */
let socle: Promise<typeof import("./egide.ts")> | null = null;
export function chargerSocle(): Promise<typeof import("./egide.ts")> {
  socle ??= import("./egide.ts").then((m) => {
    m.configurerEgide({ chouette: CHOUETTE });
    return m;
  });
  return socle;
}

/** La chouette maître (fichier identique à brand/master et design/assets, servi tel quel). */
export const CHOUETTE = "/brand/aethryon/icons/owl-head.svg";

/** Choisit un des six thèmes : appliqué tout de suite (fondu croisé de 200 ms, coupé en mouvement réduit) et gardé. */
export async function choisirThemeSite(id: ThemeId): Promise<boolean> {
  const m = await chargerSocle();
  const p = m.creerPersistance();
  const { garde } = m.choisirTheme(document.documentElement, { actif: id }, p);
  majCouleurNavigateur();
  return garde;
}

async function appliquerDepuisStockage(): Promise<void> {
  const m = await chargerSocle();
  m.demarrerTheme(document.documentElement, m.creerPersistance());
  majCouleurNavigateur();
}

/** <meta name="theme-color"> suit le fond du thème (barre du navigateur sur téléphone). */
export function majCouleurNavigateur(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  const fond = getComputedStyle(document.documentElement).getPropertyValue("--eg-c-canvas").trim();
  if (/^#[0-9a-f]{6}$/i.test(fond)) meta.content = fond;
}
