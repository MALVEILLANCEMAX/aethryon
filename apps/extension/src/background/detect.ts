// Détection de la vidéo de l'onglet actif pour le popup, SANS permission « tabs » : on ne lit jamais
// tab.url ; on demande au content script de l'onglet (s'il y en a un : pages prises en charge
// seulement) ce qu'il voit, et sa réponse est revalidée comme toute donnée venant d'une page.
import { cleanText, type TabMessage } from "../shared/messages.ts";
import type { DetectedMedia } from "../shared/types.ts";
import { PLATFORMS_OR } from "../shared/platforms.ts";
import { parseMediaUrl, safeThumbnail } from "../shared/urls.ts";
import { isObj, typo } from "./errors.ts";

// Pas de réponse : page non prise en charge, ou onglet ouvert avant une mise à jour de l'extension (son
// content script s'est arrêté et MV3 ne le réinjecte pas sans la permission « scripting ») : recharger.
export const DEFAULT_HINT = typo(`Ouvre une vidéo ${PLATFORMS_OR} pour la télécharger. Si elle est déjà ouverte, recharge la page.`);

/** Réponse (non fiable) d'un content script → média revalidé (URL canonique), ou null. */
export function sanitizeDetect(raw: unknown): { media: DetectedMedia | null; hint: string | null } {
  if (!isObj(raw)) return { media: null, hint: null };
  const hint = typeof raw.hint === "string" ? typo(cleanText(raw.hint, 200)) || null : null;
  const m = raw.media;
  if (!isObj(m) || typeof m.url !== "string") return { media: null, hint };
  const ref = parseMediaUrl(m.url);
  if (!ref) return { media: null, hint };
  const media: DetectedMedia = { platform: ref.platform, kind: ref.kind, url: ref.url, id: ref.id };
  if (typeof m.title === "string") {
    const title = cleanText(m.title, 200);
    if (title) media.title = title;
  }
  const thumbnail = safeThumbnail(m.thumbnail);
  if (thumbnail) media.thumbnail = thumbnail;
  if (ref.platform === "twitter" && typeof m.videoCount === "number" && Number.isInteger(m.videoCount) && m.videoCount >= 1 && m.videoCount <= 50) {
    media.videoCount = m.videoCount;
  }
  // V3 : instant de lecture et durée (secondes), bornés ; un instant au-delà de la durée est ramené à la fin.
  const sec = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 86_400 ? Math.round(v * 1000) / 1000 : undefined);
  const duration = sec(m.duration);
  if (duration !== undefined && duration > 0) media.duration = duration;
  const t = sec(m.currentTime);
  if (t !== undefined) media.currentTime = duration !== undefined ? Math.min(t, duration) : t;
  return { media, hint };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e); });
  });
}

export interface Detection { tabId: number | null; media: DetectedMedia | null; hint: string | null }

export async function detectActiveTab(timeoutMs: number): Promise<Detection> {
  let tabId: number | null = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id === "number" && tab.id >= 0) tabId = tab.id;
  } catch { /* pas de fenêtre */ }
  if (tabId === null) return { tabId, media: null, hint: DEFAULT_HINT };
  try {
    const request: TabMessage = { type: "detect.request" };
    const raw: unknown = await withTimeout(chrome.tabs.sendMessage(tabId, request, { frameId: 0 }), timeoutMs);
    const d = sanitizeDetect(raw);
    return { tabId, media: d.media, hint: d.media ? d.hint : (d.hint ?? DEFAULT_HINT) };
  } catch {
    // Aucun content script (site non pris en charge, page interne, onglet pas encore chargé) ou trop lent.
    return { tabId, media: null, hint: DEFAULT_HINT };
  }
}
