// Décisions d'affichage (pures, tests/unit/content-policy.test.ts) :
// - mode selon les réglages : rien, boutons intégrés, ou panneau flottant ;
// - UNE seule commande par vidéo (clé mediaKey) : dédoublonnage, et la vidéo affichée dans le panneau
//   n'a jamais aussi un bouton intégré ;
// - panneau de secours seulement si l'ancrage de la vidéo courante manque depuis un certain délai
//   (évite un clignotement panneau → bouton pendant le chargement de la page).
import type { Settings } from "../../shared/types.ts";
import type { Platform } from "../../shared/urls.ts";

export type Mode = "off" | "inline" | "panel";

export function displayMode(settings: Pick<Settings, "platforms" | "inlineButtons" | "floatingPanel"> | null, platform: Platform): Mode {
  if (!settings || settings.platforms[platform] !== true) return "off";
  if (settings.floatingPanel) return "panel";
  return settings.inlineButtons ? "inline" : "off";
}

export interface Placeable {
  key: string;
  anchor: unknown;
}

export interface Missing {
  key: string;
  since: number;
}

export interface DisplayPlan<T extends Placeable> {
  inline: T[];
  panel: T | null;
  missing: Missing | null;
  /** Instant auquel réexaminer la page (fin du délai avant le panneau de secours). */
  recheckAt: number | null;
}

export function planDisplay<T extends Placeable>(mode: Mode, targets: readonly T[], primary: T | null, missing: Missing | null, now: number, delayMs: number): DisplayPlan<T> {
  if (mode === "off") return { inline: [], panel: null, missing: null, recheckAt: null };
  const seen = new Set<string>();
  let inline: T[] = [];
  if (mode === "inline") {
    for (const t of targets) {
      if (!t.anchor || seen.has(t.key)) continue;
      seen.add(t.key);
      inline.push(t);
    }
  }
  let panel: T | null = null;
  let nextMissing: Missing | null = null;
  let recheckAt: number | null = null;
  if (mode === "panel") {
    panel = primary;
  } else if (primary && !primary.anchor) {
    const since = missing && missing.key === primary.key ? missing.since : now;
    nextMissing = { key: primary.key, since };
    if (now - since >= delayMs) panel = primary;
    else recheckAt = since + delayMs;
  }
  if (panel) {
    const k = panel.key;
    inline = inline.filter((t) => t.key !== k);
  }
  return { inline, panel, missing: nextMissing, recheckAt };
}
