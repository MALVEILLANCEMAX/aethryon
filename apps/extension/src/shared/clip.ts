// Extraits instantanés (V3) : calcul du passage autour de l'instant de lecture, validation d'un extrait reçu dans un
// message, libellés. Pur (aucune API Chrome) : partagé par le service worker, le popup et les content scripts.
// 3.6.0 : plus aucune durée maximale écrite ici (ni 30 s, ni 180 s, ni 600 s) : elle vient du serveur (GET /limites,
// src/shared/limites.ts) et le serveur revérifie chaque extrait (startMs / endMs, src/shared/extrait.ts).
import { MIN_CLIP_MS } from "./extrait.ts";
import type { Clip, ClipAnchor } from "./types.ts";

/** Plus court extrait accepté : un dixième de seconde (un passage non vide ; ce n'est pas une limite du service). */
export const CLIP_MIN_S = MIN_CLIP_MS / 1000;
/** Borne de sûreté d'un instant reçu dans un message : 24 h (une vidéo de 9 h passe largement). */
export const CLIP_MAX_INSTANT_S = 86_400;

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Passage de `length` secondes placé par rapport à l'instant de lecture `t` : avant (les secondes qui précèdent),
 * autour (centré) ou après (à partir d'ici). Borné à la vidéo ; s'il déborde d'un côté, il glisse de l'autre pour
 * garder sa durée quand la vidéo est assez longue. null si l'instant est inconnu ou le passage trop court.
 */
export function clipAt(t: number, length: number, anchor: ClipAnchor, duration?: number): Clip | null {
  if (!Number.isFinite(t) || t < 0 || !Number.isFinite(length) || length <= 0) return null;
  const total = duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  const now = Math.min(t, total);
  let start = anchor === "before" ? now - length : anchor === "around" ? now - length / 2 : now;
  let end = start + length;
  if (start < 0) { end -= start; start = 0; }
  if (end > total) { start = Math.max(0, start - (end - total)); end = total; }
  start = round1(start);
  end = round1(end);
  if (end - start < CLIP_MIN_S) return null;
  return { start, end };
}

export type ClipOutput = "mp4" | "mp3" | "gif";

/**
 * Extrait reçu dans un message (non fiable) → Clip arrondi à la milliseconde, ou null. Seule la forme est vérifiée
 * (0 ≤ début < fin ≤ 24 h, au moins un dixième de seconde) : la durée maximale est celle du serveur, qui la revérifie.
 */
export function parseClip(raw: unknown): Clip | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((k) => k !== "start" && k !== "end")) return null;
  const { start, end } = r;
  if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  const s = Math.round(start * 1000);
  const e = Math.round(end * 1000);
  if (s < 0 || e > CLIP_MAX_INSTANT_S * 1000 || e - s < MIN_CLIP_MS) return null;
  return { start: s / 1000, end: e / 1000 };
}

/** 83.4 → « 1:23 » ; 3723 → « 1:02:03 » (secondes entières, arrondi inférieur). */
export function timecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** « 1:23 → 1:53 » (flèche et espaces insécables : jamais coupé en fin de ligne). */
export function clipLabel(c: Clip): string {
  return `${timecode(c.start)} → ${timecode(c.end)}`;
}

/** Durée d'un extrait, pour un libellé : « 30 s », « 1 min 30 s ». */
export function clipLength(c: Clip): string {
  const s = Math.round(c.end - c.start);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}
