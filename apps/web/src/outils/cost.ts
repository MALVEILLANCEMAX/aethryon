// Minutes d'export de Tools : le MÊME calcul que le serveur (account/src/plans.ts exportWeight / exportMinutes et
// account/src/outils.ts exportCost), pour dire AVANT l'export ce qu'il comptera. Le serveur reste seul juge : il refuse
// au-delà de la limite (429 export_quota), quoi qu'affiche cette page.
import type { MediaInfo } from "./api.ts";

/** Poids d'une minute exportée, relatif au 1080p « Standard » (coût mesuré, docs/COUTS.md §2). */
export function exportWeight(op: string, outHeight: number | null): number {
  if (op === "audio" || op === "apercu" || op === "echantillon") return 0;
  if (op === "gif") return 0.55;
  const h = outHeight ?? 1080;
  return h >= 1800 ? 3.5 : h <= 720 ? 0.65 : 1;
}

/** Minutes d'une demande d'export (corps envoyé à /exports) sur ce média : arrondi au dixième supérieur. */
export function exportCost(body: Record<string, unknown>, info: Pick<MediaInfo, "duration" | "width" | "height">): number {
  const op = String(body.op ?? "");
  if (!exportWeight(op, null)) return 0;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const start = Math.min(num(body.start_s) ?? 0, info.duration);
  const span = Math.max(0, Math.min(num(body.duration_s) ?? Infinity, info.duration - start));
  const speed = num(body.speed) ?? 1;
  const w = info.width ?? null, h = info.height ?? null;
  const ratio = w && h ? w / h : 16 / 9;
  const outH = num(body.height) ?? h;
  const short = outH ? Math.min(outH, outH * ratio) : null;
  const weight = exportWeight(op, short);
  const out = span / (speed >= 0.25 && speed <= 4 ? speed : 1);
  return out > 0 ? Math.ceil((out / 60) * weight * 10) / 10 : 0;
}
