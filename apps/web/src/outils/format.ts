// Formats d'affichage d'AETHRYON Tools (typographie française : virgule décimale, espace insécable).
const NB = " ";
const NNB = " ";

/** 83,5 → « 1:23,5 » ; avec heures « 1:02:03,0 » ; `digits` décimales (1 par défaut). */
export function timecode(seconds: number, digits = 1): string {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const factor = 10 ** digits;
  const total = Math.round(s * factor) / factor;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total - h * 3600 - m * 60;
  const whole = Math.floor(sec + 1e-9);
  const frac = digits ? `,${String(Math.round((sec - whole) * factor)).padStart(digits, "0")}` : "";
  const ss = String(whole).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}${frac}` : `${m}:${ss}${frac}`;
}

/** Durée lisible : « 17 s », « 2 min 05 s », « 1 h 02 min ». */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}${NB}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}${NB}h${NB}${String(m).padStart(2, "0")}${NB}min`;
  return r ? `${m}${NB}min${NB}${String(r).padStart(2, "0")}${NB}s` : `${m}${NB}min`;
}

/** Durée précise d'une sélection : « 17,0 s », « 1 min 23,4 s ». */
export function spanLabel(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 60) return `${s.toFixed(1).replace(".", ",")}${NB}s`;
  const m = Math.floor(s / 60);
  return `${m}${NB}min${NB}${(s - m * 60).toFixed(1).replace(".", ",").padStart(4, "0")}${NB}s`;
}

/** Taille : « 840 Ko », « 12,4 Mo », « 1,02 Go » (unités de 1 024). */
export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))}${NB}Ko`;
  if (n < 1024 ** 3) {
    const v = n / 1024 ** 2;
    return `${v < 10 ? v.toFixed(1).replace(".", ",") : Math.round(v)}${NB}Mo`;
  }
  return `${(n / 1024 ** 3).toFixed(2).replace(".", ",")}${NB}Go`;
}

/** « 3,8 à 15 Mo » : une fourchette, l'unité dite une fois quand elle est la même. */
export function bytesRange(a: number, b: number): string {
  const [na, ua] = bytes(a).split(NB);
  const B = bytes(b);
  return ua === B.split(NB)[1] ? `${na} à ${B}` : `${bytes(a)} à ${B}`;
}

/** « 1 280 × 720 » (espace fine insécable dans les milliers). */
export function dims(w?: number, h?: number): string {
  if (!w || !h) return "—";
  const g = (v: number) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, NNB);
  return `${g(w)}${NB}×${NB}${g(h)}`;
}

export const kbps = (bps: number | null | undefined) => (bps ? `${Math.round(bps / 1000)}${NB}kbit/s` : "—");

/**
 * Saisie d'un temps : « 83 », « 83,5 », « 1:23 », « 1:23,5 », « 01:02:03.25 » → secondes ; null si illisible.
 */
export function parseTime(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(text);
  if (!m) return null;
  const [, h, min, sec] = m;
  if (Number(sec) >= 60 || (h !== undefined && Number(min) >= 60)) return null;
  return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec);
}

/** Temps restant avant effacement : « encore 1 h 52 », « encore 8 min », « expire bientôt ». */
export function remaining(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return "";
  if (ms < 60_000) return "expire bientôt";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `encore ${min}${NB}min`;
  return `encore ${Math.floor(min / 60)}${NB}h${NB}${String(min % 60).padStart(2, "0")}`;
}

export const PLATFORM_NAME: Record<string, string> = { youtube: "YouTube", tiktok: "TikTok", twitter: "X", x: "X", fichier: "Fichier importé" };

/**
 * Nom de fichier long raccourci AU MILIEU : le titre est coupé (« … »), la fin — « (montage 6s-11s).mp4 » — reste
 * lisible. Le nom entier reste dans l'info-bulle (title). Un « … » déjà présent n'est jamais doublé.
 */
export function middleName(name: string, max = 64): string {
  if (name.length <= max) return name;
  const cut = name.lastIndexOf(" (");
  const tail = cut > 0 && name.length - cut <= max / 2 ? name.slice(cut) : name.slice(-Math.floor(max / 3));
  const head = name.slice(0, Math.max(8, max - tail.length - 1)).replace(/[\s.,…([-]+$/u, "");
  return `${head}…${tail.startsWith(" ") ? tail : ` ${tail}`}`.replace(/……/g, "…");
}
