// TimeLens (3.8.0) : modèle pur de l'écran « Extrait » — préréglages, passage exporté (GIF non destructif), glisser
// avec butée à la limite du serveur (l'autre borne ne bouge jamais), élastique, fenêtre de la lentille ancrée au
// pointeur (aucun recentrage), défilement aux bords, crans, détecteur d'hésitation des astuces.
// AUCUNE limite écrite ici : G (générale) et F (du format) viennent toujours du serveur (shared/limites.ts) ; null =
// inconnue, et rien n'est inventé. Pur (aucun DOM, aucune API Chrome) ; testé par tests/unit/timelens.test.ts.
import { MIN_CLIP_MS, type Bounds, type Edge, type RangeMs } from "./extrait.ts";

/** Durées proposées en un clic (« Personnalisé » vient après). */
export const PRESETS_MS = [15_000, 30_000, 60_000, 120_000] as const;
/** Largeur de la lentille : 4 s (ou la vidéo entière si elle est plus courte). */
export const LENS_SPAN_MAX_MS = 4_000;
/** Déport visuel maximal de la poignée au-delà d'une butée. */
export const RUBBER_MAX_PX = 18;
/** Zone de défilement à chaque bord de la lentille. */
export const LENS_EDGE_PX = 24;
/** Mouvement du pointeur avant que la lentille flottante n'apparaisse. */
export const LENS_SHOW_PX = 3;
/** Hystérésis d'entrée et de sortie de l'affinage (sous le haut de la lentille). */
export const LENS_ENTER_PX = 8;
export const LENS_EXIT_PX = 4;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const int = (v: number): number => (Number.isFinite(v) ? Math.round(v) : 0);

/** Passage réellement exporté : le début du passage voulu, limité à `formatMaxMs` (GIF : N premières secondes). */
export function effectiveRange(r: RangeMs, formatMaxMs: number | null): RangeMs {
  if (formatMaxMs !== null && formatMaxMs > 0 && r.endMs - r.startMs > formatMaxMs) return { startMs: r.startMs, endMs: r.startMs + formatMaxMs };
  return { startMs: r.startMs, endMs: r.endMs };
}

/** Pourquoi un préréglage est indisponible : plus long que la vidéo, ou que la limite du format ; null : disponible. */
export function presetBlock(lenMs: number, durationMs: number | null, formatMaxMs: number | null): "video" | "format" | null {
  if (durationMs !== null && durationMs > 0 && lenMs > durationMs) return "video";
  if (formatMaxMs !== null && lenMs > formatMaxMs) return "format";
  return null;
}

/**
 * Préréglage : `lenMs` à partir du début actuel du passage ; recul si la fin dépasse la vidéo. null : désactivé (plus
 * long que la vidéo, ou que la limite du format `formatMaxMs`).
 */
export function applyPreset(r: RangeMs, lenMs: number, b: Bounds, formatMaxMs: number | null): RangeMs | null {
  const d = int(b.durationMs);
  if (presetBlock(lenMs, d, formatMaxMs) !== null) return null;
  let s = clamp(int(r.startMs), 0, d);
  let e = s + int(lenMs);
  if (e > d) {
    s = d - int(lenMs);
    e = d;
  }
  return { startMs: Math.max(0, s), endMs: e };
}

/** Le préréglage `lenMs` correspond-il au passage (à 1 ms près) ? */
export function presetChecked(r: RangeMs, lenMs: number): boolean {
  return Math.abs((r.endMs - r.startMs) - lenMs) <= 1;
}

/**
 * Glisser d'une borne (pointeur, clavier) avec BUTÉE : la borne s'arrête à MIN_CLIP_MS de l'autre, aux bords de la
 * vidéo et à la limite générale du serveur (`b.maxMs`) ; l'autre borne NE BOUGE JAMAIS. `overMs` : dépassement de la
 * limite du serveur demandé par le geste (0 sinon), pour l'élastique et l'annonce.
 */
export function dragEdge(r: RangeMs, edge: Edge, valueMs: number, b: Bounds): { range: RangeMs; overMs: number } {
  const d = Math.max(0, int(b.durationMs));
  const min = Math.min(Math.max(1, b.minMs ?? MIN_CLIP_MS), d);
  const G = b.maxMs !== null && b.maxMs > 0 ? Math.max(b.maxMs, min) : null;
  const v = int(valueMs);
  const s = r.startMs;
  const e = r.endMs;
  if (edge === "end") {
    let e2 = clamp(v, s + min, d);
    let over = 0;
    if (G !== null && e2 - s > G) {
      over = e2 - (s + G);
      e2 = s + G;
    }
    return { range: { startMs: s, endMs: e2 }, overMs: over };
  }
  let s2 = clamp(v, 0, e - min);
  let over = 0;
  if (G !== null && e - s2 > G) {
    over = (e - G) - s2;
    s2 = e - G;
  }
  return { range: { startMs: s2, endMs: e }, overMs: over };
}

/** Élastique : c·(1 − 1/(overPx/c + 1)) ; 0 pour 0, c/2 pour c, tend vers c. */
export function rubber(overPx: number, c = RUBBER_MAX_PX): number {
  if (!(overPx > 0)) return 0;
  return c * (1 - 1 / (overPx / c + 1));
}

/** Le passage approche de la limite générale (au moins 90 %). */
export function nearLimit(lenMs: number, maxMs: number | null): boolean {
  return maxMs !== null && maxMs > 0 && lenMs >= 0.9 * maxMs;
}

/** Cran : à l'image si la cadence est connue (5 à 200 ms), sinon aux 10 ms. */
export function snap(valueMs: number, frameMs: number | null): number {
  if (frameMs !== null && frameMs >= 5 && frameMs <= 200) return Math.round(Math.round(valueMs / frameMs) * frameMs);
  return Math.round(valueMs / 10) * 10;
}

/** Largeur de la lentille en temps : 4 s, ou la vidéo entière si elle est plus courte. */
export function lensSpan(durationMs: number): number {
  return Math.max(1, Math.min(LENS_SPAN_MAX_MS, Math.round(durationMs)));
}

/**
 * Fenêtre de la lentille FIGÉE à l'entrée en affinage : l'instant `valueMs` tombe exactement sous le pointeur (x), donc
 * aucun saut. AUCUN bornage à la vidéo : ce qui sort de [0, durée] est hachuré « hors vidéo ».
 */
export function lensWindowAt(valueMs: number, pointerX: number, bandLeft: number, msPerPx: number, spanMs: number): { w0: number; w1: number } {
  const w0 = valueMs - (pointerX - bandLeft) * msPerPx;
  return { w0, w1: w0 + spanMs };
}

/**
 * Défilement aux bords de la lentille, en ms de temps pour `dtMs` de temps réel : span × 0,75 × (p/24)² par seconde,
 * p = profondeur dans la zone du bord (24 hors de la bande). Négatif vers la gauche.
 */
export function edgePan(pointerX: number, bandLeft: number, bandWidth: number, spanMs: number, dtMs: number): number {
  const right = bandLeft + bandWidth;
  let p = 0;
  let dir = 0;
  if (pointerX < bandLeft + LENS_EDGE_PX) {
    p = Math.min(LENS_EDGE_PX, bandLeft + LENS_EDGE_PX - pointerX);
    dir = -1;
  } else if (pointerX > right - LENS_EDGE_PX) {
    p = Math.min(LENS_EDGE_PX, pointerX - (right - LENS_EDGE_PX));
    dir = 1;
  }
  if (!dir || p <= 0) return 0;
  return dir * spanMs * 0.75 * (p / LENS_EDGE_PX) ** 2 * (Math.max(0, dtMs) / 1000);
}

/**
 * Fenêtre qui glisse JUSTE ASSEZ pour garder l'aiguille à `marginPx` des bords (clavier, valeur posée de l'extérieur) ;
 * jamais de recentrage. Renvoie le nouveau w0.
 */
export function keepVisible(w0: number, valueMs: number, msPerPx: number, bandWidth: number, marginPx = LENS_EDGE_PX): number {
  const x = (valueMs - w0) / msPerPx;
  const m = Math.min(marginPx, bandWidth / 2);
  if (x < m) return valueMs - m * msPerPx;
  if (x > bandWidth - m) return valueMs - (bandWidth - m) * msPerPx;
  return w0;
}

// ---- astuces (Companion « Hint ») ---------------------------------------------------------------------------------

export type HintId = "inaction" | "hesitation" | "butee" | "precision";
export type EditorEventType = "open" | "pointer" | "key" | "preset" | "format" | "limit-bump" | "coarse-drag-end" | "fine-used" | "export";
export interface EditorEvent { type: EditorEventType; at: number }
/** Mémoire des astuces : désactivées, dernière apparition de chacune, déjà une astuce pendant cette ouverture. */
export interface HintMemory { off: boolean; last: Partial<Record<HintId, number>>; shownThisOpen: boolean }

export const HINT_INACTION_MS = 10_000;
export const HINT_HESITATION_MS = 8_000;
export const HINT_REPEAT_MS = 7 * 24 * 3_600_000;
export const HINT_LIFE_MS = 12_000;

/**
 * Astuce à montrer maintenant, ou null. Une par ouverture au plus, chacune au plus une fois tous les 7 jours, aucune si
 * l'utilisateur les a coupées. Ne regarde que les événements depuis la dernière ouverture.
 */
export function hint(evts: readonly EditorEvent[], now: number, mem: HintMemory): HintId | null {
  if (mem.off || mem.shownThisOpen) return null;
  let from = -1;
  for (let i = evts.length - 1; i >= 0; i--) if (evts[i]!.type === "open") { from = i; break; }
  if (from < 0) return null;
  const since = evts.slice(from);
  const open = since[0]!;
  const fresh = (id: HintId) => !(typeof mem.last[id] === "number" && now - mem.last[id]! < HINT_REPEAT_MS);
  if (since.some((e) => e.type === "export")) return null;
  if (fresh("butee") && since.some((e) => e.type === "limit-bump")) return "butee";
  const choices = since.filter((e) => e.type === "preset" || e.type === "format");
  if (fresh("hesitation")) {
    for (let i = 2; i < choices.length; i++) if (choices[i]!.at - choices[i - 2]!.at < HINT_HESITATION_MS) return "hesitation";
  }
  if (fresh("precision") && since.filter((e) => e.type === "coarse-drag-end").length >= 2 && !since.some((e) => e.type === "fine-used")) return "precision";
  if (fresh("inaction") && since.length === 1 && now - open.at >= HINT_INACTION_MS) return "inaction";
  return null;
}
