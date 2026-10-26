// Lien transmis par l'extension à AETHRYON Tools (/outils#lien=<adresse encodée>[&debut=<s>&fin=<s>]) : seul un lien
// reconnu sur l'appareil (YouTube, TikTok, X : mêmes règles que le service) est repris ; tout le reste est ignoré.
// V3.5 : le passage réglé dans la page (« Continuer dans Tools avec ce passage ») accompagne le lien ; Tools le
// présélectionne une fois le média ouvert (borné à sa durée).
import { probeLink } from "../lib/probe.ts";

export interface SharedLink { url: string; range: { start: number; end: number } | null }

const SECONDS = /^\d{1,5}(\.\d{1,3})?$/;

export function sharedFromHash(hash: string): SharedLink | null {
  const m = /^#lien=([^&]{1,4096})(?:&debut=([^&]{1,12})&fin=([^&]{1,12}))?$/.exec(hash);
  if (!m) return null;
  let raw: string;
  try { raw = decodeURIComponent(m[1]!); } catch { return null; }
  if (probeLink(raw).state !== "ok") return null;
  let range: SharedLink["range"] = null;
  if (m[2] !== undefined && m[3] !== undefined && SECONDS.test(m[2]) && SECONDS.test(m[3])) {
    const start = Number(m[2]);
    const end = Number(m[3]);
    if (end - start >= 0.5 && end <= 86_400) range = { start, end };
  }
  return { url: raw.trim(), range };
}

export function linkFromHash(hash: string): string | null {
  return sharedFromHash(hash)?.url ?? null;
}
