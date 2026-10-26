// Modèle d'un extrait (3.6.0), en millisecondes entières : passage initial, déplacement d'une borne (poignée,
// clavier, champ, « = position du lecteur »), déplacement du passage entier, pas du clavier, vérification avant
// l'envoi. AUCUNE durée maximale fixe ici : elle vient du serveur (GET /limites, src/shared/limites.ts) ; sans
// réponse du serveur, rien n'est inventé et le serveur reste seul juge. Pur ; testé par tests/unit/extraits-*.test.ts.
import { formatLimit, formatTimecode } from "./timecode.ts";

const NBSP = " ";

export type Edge = "start" | "end";
export interface RangeMs { startMs: number; endMs: number }
export type ClipFormat = "mp4" | "mp3" | "gif";
export const CLIP_FORMATS: readonly ClipFormat[] = ["mp4", "mp3", "gif"];

/**
 * Plus court extrait accepté : un dixième de seconde (un pas du clavier). Ce n'est pas une limite du service, seulement
 * un passage non vide ; le serveur garde sa propre règle (0 ≤ startMs < endMs).
 */
export const MIN_CLIP_MS = 100;

export interface Bounds {
  /** Durée de la vidéo (ms) ; le passage reste dans [0, durée]. */
  durationMs: number;
  /** Durée maximale de l'extrait donnée par le serveur ; null = inconnue (aucune borne inventée). */
  maxMs: number | null;
  minMs?: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const int = (v: number): number => (Number.isFinite(v) ? Math.round(v) : 0);

/** Passage remis dans les bornes ; `keep` : la borne qui garde sa place quand il faut en déplacer une. */
export function normalize(r: RangeMs, b: Bounds, keep: Edge = "start"): RangeMs {
  const d = Math.max(0, int(b.durationMs));
  const min = Math.min(Math.max(1, b.minMs ?? MIN_CLIP_MS), d);
  let s = clamp(int(r.startMs), 0, d);
  let e = clamp(int(r.endMs), 0, d);
  if (d === 0) return { startMs: 0, endMs: 0 };
  if (keep === "start") {
    s = Math.min(s, d - min);
    if (e < s + min) e = s + min;
  } else {
    e = Math.max(e, min);
    if (s > e - min) s = e - min;
  }
  const max = b.maxMs !== null && b.maxMs > 0 ? Math.max(b.maxMs, min) : null;
  if (max !== null && e - s > max) {
    if (keep === "start") e = s + max;
    else s = e - max;
  }
  return { startMs: s, endMs: e };
}

/**
 * Déplace une borne.
 * - « drag » (poignée, clavier) : la borne s'arrête à MIN_CLIP_MS de l'autre (les poignées ne se croisent jamais) ;
 * - « set » (champ saisi, « = position du lecteur ») : si la nouvelle valeur passe de l'autre côté, l'autre borne
 *   suit en gardant la durée du passage.
 * Dans les deux cas, au-delà de la durée maximale du serveur, l'autre borne suit (la borne déplacée garde sa place).
 */
export function moveEdge(r: RangeMs, edge: Edge, valueMs: number, b: Bounds, mode: "drag" | "set"): RangeMs {
  const d = Math.max(0, int(b.durationMs));
  const min = Math.min(Math.max(1, b.minMs ?? MIN_CLIP_MS), d);
  const v = clamp(int(valueMs), 0, d);
  const len = Math.max(min, r.endMs - r.startMs);
  let s = r.startMs;
  let e = r.endMs;
  if (edge === "start") {
    if (mode === "drag") s = Math.min(v, e - min);
    else if (v > e - min) {
      s = v;
      e = Math.min(d, v + len);
      if (e - s < min) s = e - min;
    } else s = v;
  } else if (mode === "drag") e = Math.max(v, s + min);
  else if (v < s + min) {
    e = v;
    s = Math.max(0, v - len);
    if (e - s < min) e = s + min;
  } else e = v;
  return normalize({ startMs: s, endMs: e }, b, edge);
}

/** Glisse le passage entier de `deltaMs` en gardant sa durée (arrêt aux bords de la vidéo). */
export function shiftRange(r: RangeMs, deltaMs: number, b: Bounds): RangeMs {
  const d = Math.max(0, int(b.durationMs));
  const len = r.endMs - r.startMs;
  const s = clamp(int(r.startMs + deltaMs), 0, Math.max(0, d - len));
  return normalize({ startMs: s, endMs: s + len }, b, "start");
}

/**
 * Passage proposé à l'ouverture : `lengthMs` placé avant, autour ou après l'instant de lecture (réglage de
 * l'extension, 30 s par défaut), borné à la vidéo et à la durée maximale du serveur si elle est connue.
 */
export function initialRange(currentMs: number | undefined, lengthMs: number, anchor: "before" | "around" | "after", b: Bounds): RangeMs {
  const d = Math.max(0, int(b.durationMs));
  const len = Math.min(Math.max(int(lengthMs), MIN_CLIP_MS), b.maxMs ?? Infinity, d);
  const now = clamp(int(currentMs ?? 0), 0, d);
  let s = anchor === "before" ? now - len : anchor === "around" ? now - len / 2 : now;
  s = clamp(int(s), 0, Math.max(0, d - len));
  return normalize({ startMs: s, endMs: s + len }, b, "start");
}

export interface KeyLike { key: string; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }

/** Pas du clavier par défaut quand la cadence de la vidéo n'est pas connue. */
export const KEY_STEP_MS = 100;
export const KEY_FINE_MS = 10;
export const KEY_COARSE_MS = 1000;
export const KEY_PAGE_MS = 10_000;

/**
 * Touche → déplacement d'une poignée : flèches = une image (si la cadence est connue) ou 100 ms ; Maj = 1 s ;
 * Alt = 10 ms ; Page haut/bas = 10 s ; Début/Fin = au plus loin. null : touche sans effet (laissée au navigateur).
 */
export function keyStep(e: KeyLike, frameMs: number | null = null): number | "home" | "end" | null {
  if (e.ctrlKey || e.metaKey) return null;
  const base = e.altKey ? KEY_FINE_MS : e.shiftKey ? KEY_COARSE_MS : frameMs && frameMs >= 5 && frameMs <= 200 ? frameMs : KEY_STEP_MS;
  switch (e.key) {
    case "ArrowRight":
    case "ArrowUp":
      return base;
    case "ArrowLeft":
    case "ArrowDown":
      return -base;
    case "PageUp":
      return KEY_PAGE_MS;
    case "PageDown":
      return -KEY_PAGE_MS;
    case "Home":
      return "home";
    case "End":
      return "end";
    default:
      return null;
  }
}

/** Bornes d'une poignée pour le clavier et les lecteurs d'écran (aria-valuemin / aria-valuemax). */
export function edgeLimits(r: RangeMs, edge: Edge, b: Bounds): { min: number; max: number } {
  const d = Math.max(0, int(b.durationMs));
  const min = Math.min(Math.max(1, b.minMs ?? MIN_CLIP_MS), d);
  return edge === "start" ? { min: 0, max: Math.max(0, r.endMs - min) } : { min: Math.min(d, r.startMs + min), max: d };
}

export type RangeProblem = "negative" | "order" | "too_short" | "beyond_duration" | "too_long";
export type RangeCheck = { ok: true } | { ok: false; problem: RangeProblem; message: string };

/**
 * Vérification avant l'envoi (le serveur revérifie tout, indépendamment) : 0 ≤ début < fin ≤ durée, durée maximale du
 * serveur si elle est connue. `durationMs` null : durée de la vidéo inconnue (le serveur la connaît).
 */
export function checkRange(r: RangeMs, b: { durationMs: number | null; maxMs: number | null; minMs?: number }): RangeCheck {
  const min = Math.max(1, b.minMs ?? MIN_CLIP_MS);
  if (!Number.isInteger(r.startMs) || !Number.isInteger(r.endMs)) return { ok: false, problem: "order", message: "Début ou fin illisible." };
  if (r.startMs < 0) return { ok: false, problem: "negative", message: `Le début ne peut pas être négatif.` };
  if (r.endMs <= r.startMs) return { ok: false, problem: "order", message: `La fin doit venir après le début.` };
  if (r.endMs - r.startMs < min) return { ok: false, problem: "too_short", message: `L’extrait doit durer au moins ${formatLimit(min)}.` };
  if (b.durationMs !== null && r.endMs > b.durationMs) {
    return { ok: false, problem: "beyond_duration", message: `La fin dépasse la durée de la vidéo (${formatTimecode(b.durationMs)}).` };
  }
  if (b.maxMs !== null && b.maxMs > 0 && r.endMs - r.startMs > b.maxMs) {
    return { ok: false, problem: "too_long", message: `Le serveur accepte des extraits de ${formatLimit(b.maxMs)} au plus${NBSP}: raccourcis le passage.` };
  }
  return { ok: true };
}

/** Passage en secondes (messages internes de l'extension, 3 décimales) ↔ millisecondes entières (contrat du serveur). */
export const toSeconds = (r: RangeMs): { start: number; end: number } => ({ start: r.startMs / 1000, end: r.endMs / 1000 });
export const toMs = (c: { start: number; end: number }): RangeMs => ({ startMs: Math.round(c.start * 1000), endMs: Math.round(c.end * 1000) });
