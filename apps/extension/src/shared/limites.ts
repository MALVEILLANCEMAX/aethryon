// Limites des extraits annoncées par le serveur (3.6.0, contrat docs : GET <API>/limites). Valeurs de CONFIGURATION
// du serveur (variables d'environnement), jamais écrites en dur dans l'extension : sans réponse, l'interface le dit
// et le serveur reste seul juge. Pur ; testé par tests/unit/extraits-limites.test.ts.
import type { ClipFormat } from "./extrait.ts";
import { formatLimit } from "./timecode.ts";

const NBSP = " ";

export interface ClipLimits {
  /** Durée maximale d'un extrait (ms) ; null = non annoncée. */
  extraitDureeMaxMs: number | null;
  /** Durée maximale par format, si le serveur la précise (ex. un GIF plus court qu'un MP4). */
  parFormat: Partial<Record<ClipFormat, number>>;
  sortieTailleMaxOctets: number | null;
  telechargementMaxOctets: number | null;
  traitementMaxS: number | null;
  simultanesMax: number | null;
  /** Conversions par jour du compte appelant (null : illimité ou inconnu). */
  quotaJour: number | null;
  /** Reste du jour annoncé par le serveur pour le compte appelant (plus frais que le dernier état connu du compte). */
  restantAujourdhui: number | null;
  /** Extraits activés sur ce serveur (false : coupés par la configuration) ; null : non dit. */
  extraitsActifs: boolean | null;
}

/** Ce que reçoivent le popup et le menu des pages (« limits.get ») : limites, quota du compte, d'où elles viennent. */
export interface LimitsView {
  limits: ClipLimits | null;
  /** Reste du jour d'après le compte (dernier état connu) ; null = inconnu. remaining null = illimité. */
  quota: { used: number | null; limit: number | null; remaining: number | null } | null;
  /** « serveur » : réponse de GET /limites ; « indisponible » : pas de réponse exploitable (404, réseau, notice). */
  source: "serveur" | "indisponible";
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Entier positif raisonnable (≤ 10^13), sinon null. */
const pos = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1e13 ? Math.round(v) : null);
/** Entier positif ou nul (un reste du jour peut valoir 0). */
const nonNeg = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e9 ? Math.round(v) : null);

/**
 * Corps de GET /limites → limites vérifiées, ou null s'il n'y a rien d'exploitable. Forme de ytapi (branche
 * feat/extraits-backend) : extraitDureeMaxMs, dureeMaxParFormatMs {mp4, mp3, gif}, gifDureeMaxMs,
 * sortieTailleMaxOctets, telechargementMaxOctets, traitementMaxS, simultanesMax, quotaJour, restantAujourdhui,
 * extraitsActifs. Tolérant : champs sous « limites » / « extraits », durée par format sous « formats.<fmt> » ou
 * « extraitDureeMaxMsParFormat ».
 */
export function parseLimits(body: unknown): ClipLimits | null {
  if (!isObj(body)) return null;
  const src = isObj(body.limites) ? body.limites : isObj(body.extraits) ? body.extraits : body;
  const out: ClipLimits = {
    extraitDureeMaxMs: pos(src.extraitDureeMaxMs),
    parFormat: {},
    sortieTailleMaxOctets: pos(src.sortieTailleMaxOctets),
    telechargementMaxOctets: pos(src.telechargementMaxOctets),
    traitementMaxS: pos(src.traitementMaxS),
    simultanesMax: pos(src.simultanesMax),
    quotaJour: pos(src.quotaJour),
    restantAujourdhui: nonNeg(src.restantAujourdhui),
    extraitsActifs: typeof src.extraitsActifs === "boolean" ? src.extraitsActifs : null,
  };
  // « parFormat » : forme déjà analysée (le service worker transmet ClipLimits au menu des pages et au popup, qui la
  // relisent) ; sans elle, la limite par format (GIF) se perdait en route (corrigé en 3.8.0).
  const per = isObj(src.dureeMaxParFormatMs) ? src.dureeMaxParFormatMs : isObj(src.extraitDureeMaxMsParFormat) ? src.extraitDureeMaxMsParFormat : isObj(src.parFormat) ? src.parFormat : null;
  const formats = isObj(src.formats) ? src.formats : null;
  for (const f of ["mp4", "mp3", "gif"] as const) {
    const v = pos(per?.[f]) ?? (isObj(formats?.[f]) ? pos((formats![f] as Record<string, unknown>).extraitDureeMaxMs) : null) ?? (f === "gif" ? pos(src.gifDureeMaxMs) : null);
    if (v !== null) out.parFormat[f] = v;
  }
  const any = Object.entries(out).some(([k, v]) => (k === "parFormat" ? Object.keys(v as object).length > 0 : k !== "extraitsActifs" && v !== null)) || out.extraitsActifs !== null;
  return any ? out : null;
}

/** Durée maximale d'un extrait dans ce format (la plus stricte des deux quand le format en précise une). */
export function maxClipMs(l: ClipLimits | null, fmt: ClipFormat): number | null {
  if (!l) return null;
  const general = l.extraitDureeMaxMs;
  const own = l.parFormat[fmt] ?? null;
  if (general === null) return own;
  return own === null ? general : Math.min(general, own);
}

/** « 1,5 Go », « 800 Mo » (base 1024, typographie française). */
export function formatBytes(n: number): string {
  const units = ["octets", "Ko", "Mo", "Go", "To"];
  let v = Math.max(0, n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const r = v >= 10 || i === 0 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${String(r).replace(".", ",")}${NBSP}${units[i]}`;
}

/** Ligne des limites sous la réglette : « Jusqu’à 10 min par extrait », ou l'absence d'information, dite. */
export function limitText(view: LimitsView | null, fmt: ClipFormat): string {
  const max = maxClipMs(view?.limits ?? null, fmt);
  if (max !== null) return `Jusqu’à ${formatLimit(max)} par extrait`;
  if (!view) return "Limites du serveur en cours de lecture…";
  return `Limite de durée non communiquée${NBSP}: le serveur vérifiera l’extrait`;
}

/** Ligne du quota : « 7 exports restants aujourd’hui », « Illimité aujourd’hui », « 10 par jour », ou null. */
export function quotaText(view: LimitsView | null): string | null {
  const q = view?.quota;
  if (q && q.limit === null && q.remaining === null && q.used !== null) return "Exports illimités aujourd’hui";
  if (q && q.remaining !== null) {
    const r = Math.max(0, q.remaining);
    return r === 0 ? "Quota du jour atteint" : `${r} ${r > 1 ? "exports restants" : "export restant"} aujourd’hui`;
  }
  const perDay = view?.limits?.quotaJour ?? null;
  return perDay !== null ? `${perDay} ${perDay > 1 ? "exports" : "export"} par jour` : null;
}

/** Quota du jour épuisé, d'après le dernier état connu du compte (le serveur reste juge). */
export function quotaExhausted(view: LimitsView | null): boolean {
  const q = view?.quota;
  return !!q && q.remaining !== null && q.remaining <= 0;
}
