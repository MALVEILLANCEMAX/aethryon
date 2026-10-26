// Élément <video> de la page (V3) : la vidéo principale (la plus visible, de préférence en lecture), son instant de
// lecture et sa durée, et son image courante. Lecture seule : rien n'est modifié dans la page.
import type { FrameGrab } from "../../shared/messages.ts";

const MIN_SIDE = 40; // une vignette d'aperçu au survol n'est pas « la » vidéo

/** Partie visible de l'élément dans la fenêtre (pixels CSS), ou null s'il est caché ou trop petit. */
function visibleRect(el: Element, win: Window): { x: number; y: number; width: number; height: number } | null {
  const r = el.getBoundingClientRect();
  if (r.width < MIN_SIDE || r.height < MIN_SIDE) return null;
  const x = Math.max(0, r.left);
  const y = Math.max(0, r.top);
  const right = Math.min(win.innerWidth, r.right);
  const bottom = Math.min(win.innerHeight, r.bottom);
  if (right - x < 1 || bottom - y < 1) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Vidéo principale : parmi les <video> visibles, la plus grande surface visible, avec priorité à celle qui est en
 * lecture ; `near` (bouton d'une publication) : d'abord une vidéo de son conteneur le plus proche qui en a une.
 */
export function mainVideo(doc: Document, win: Window, near?: Element | null): HTMLVideoElement | null {
  if (near) {
    let el: Element | null = near;
    for (let depth = 0; el && depth < 14; depth++, el = el.parentElement) {
      const vids = [...el.querySelectorAll("video")].filter((v) => visibleRect(v, win));
      if (vids.length) return best(vids, win);
    }
  }
  const all = [...doc.querySelectorAll("video")].filter((v) => visibleRect(v, win));
  return all.length ? best(all, win) : null;
}

function best(list: HTMLVideoElement[], win: Window): HTMLVideoElement {
  let top = list[0]!;
  let score = -1;
  for (const v of list) {
    const r = visibleRect(v, win);
    const area = r ? r.width * r.height : 0;
    const s = area * (v.paused ? 1 : 4) * (v.currentTime > 0 ? 1.5 : 1);
    if (s > score) { score = s; top = v; }
  }
  return top;
}

const finite = (v: number): number | undefined => (Number.isFinite(v) && v >= 0 && v <= 86_400 ? Math.round(v * 1000) / 1000 : undefined);

/** Instant de lecture et durée (secondes) quand l'élément les connaît ; une durée infinie (direct) est ignorée. */
export function videoTimes(v: HTMLVideoElement | null): { currentTime?: number; duration?: number } {
  // Rien de chargé (pas même les métadonnées) : l'instant « 0 » ne dirait rien de vrai.
  if (!v || v.readyState < 1) return {};
  const out: { currentTime?: number; duration?: number } = {};
  const t = finite(v.currentTime);
  if (t !== undefined) out.currentTime = t;
  const d = finite(v.duration);
  if (d !== undefined && d > 0) out.duration = d;
  return out;
}

/**
 * Image courante de la vidéo, en PNG à sa définition réelle. Impossible : pas de vidéo, pas encore d'image, vidéo
 * protégée (DRM : clés de chiffrement en place), ou image d'une autre origine sans autorisation (le navigateur
 * « contamine » le canvas) — la place de la vidéo dans la fenêtre est alors jointe pour une capture de l'onglet.
 */
export function grabFrame(doc: Document, win: Window, v: HTMLVideoElement | null): FrameGrab {
  if (!v) return { ok: false, reason: "no_video" };
  const at = finite(v.currentTime);
  const rect = visibleRect(v, win) ?? undefined;
  const viewport = { width: win.innerWidth, height: win.innerHeight };
  const where = { ...(rect ? { rect } : {}), viewport, ...(at !== undefined ? { at } : {}) };
  if ((v as HTMLVideoElement & { mediaKeys?: unknown }).mediaKeys) return { ok: false, reason: "drm", ...where };
  if (v.readyState < 2 || !v.videoWidth || !v.videoHeight) return { ok: false, reason: "not_ready", ...where };
  const canvas = doc.createElement("canvas");
  canvas.width = v.videoWidth;
  canvas.height = v.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, reason: "not_ready", ...where };
  try {
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");
    if (!dataUrl.startsWith("data:image/png;base64,")) return { ok: false, reason: "not_ready", ...where };
    return { ok: true, dataUrl, width: canvas.width, height: canvas.height, at: at ?? 0 };
  } catch {
    return { ok: false, reason: "tainted", ...where };
  }
}
