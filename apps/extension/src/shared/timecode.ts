// Timecodes des extraits (3.6.0) : tout est en MILLISECONDES ENTIÈRES (contrat startMs / endMs du serveur), affiché
// au format HH:MM:SS.mmm. Pur (aucune API Chrome, aucun DOM) : partagé par le service worker, le popup et les
// content scripts ; testé par tests/unit/extraits-timecode.test.ts.
//
// Saisies acceptées (puis normalisées en HH:MM:SS.mmm) :
//   « 80 » (secondes), « 80,5 » ou « 80.5 », « 1:20 » (min:s), « 1:30:45.5 » (h:min:s), « 01:30:45.500 »,
//   « .5 », « 1 h 20 min », « 2h13m7.8s », « 90 s », « 500 ms » ; espaces autour des « : » tolérés.
// Refusées, avec une raison : vide, négative, illisible, minutes ou secondes ≥ 60 hors du premier champ, au-delà de 24 h.

const NBSP = " ";

/** Borne de sûreté : 24 h (une vidéo de 9 h passe largement ; au-delà, la saisie est sûrement une erreur). */
export const MAX_TIMECODE_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

/** Parties entières d'une durée en ms (négatif ramené à 0, arrondi à la milliseconde). */
function parts(ms: number): { h: number; m: number; s: number; f: number } {
  const t = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  return { h: Math.floor(t / HOUR_MS), m: Math.floor((t % HOUR_MS) / MINUTE_MS), s: Math.floor((t % MINUTE_MS) / 1000), f: t % 1000 };
}

/** 80 500 → « 00:01:20.500 » ; 8 000 000 → « 02:13:20.000 » (format des champs, toujours complet). */
export function formatTimecode(ms: number): string {
  const { h, m, s, f } = parts(ms);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(f, 3)}`;
}

/**
 * Forme courte pour les infobulles et la réglette : « 1:20.500 », « 2:13:07.800 » (heures dès que `hours` ou que la
 * valeur dépasse une heure). `digits` : 0, 1 ou 3 chiffres après la virgule décimale (point, comme les champs).
 */
export function formatShort(ms: number, { hours = false, digits = 3 }: { hours?: boolean; digits?: 0 | 1 | 3 } = {}): string {
  const { h, m, s, f } = parts(ms);
  const frac = digits === 0 ? "" : digits === 1 ? `.${Math.floor(f / 100)}` : `.${pad(f, 3)}`;
  return h > 0 || hours ? `${h}:${pad(m)}:${pad(s)}${frac}` : `${m}:${pad(s)}${frac}`;
}

/** Repère de graduation : « 0:00 », « 1:30 », « 2:00:00 », « 0:07.5 » (dixièmes seulement s'il y en a). */
export function formatTick(ms: number, { hours = false }: { hours?: boolean } = {}): string {
  const { f } = parts(ms);
  if (f === 0) return formatShort(ms, { hours, digits: 0 });
  if (f % 100 === 0) return formatShort(ms, { hours, digits: 1 });
  return formatShort(ms, { hours, digits: 3 });
}

/** Durée lisible, typographie française : « 0,5 s », « 15,9 s », « 1 min 15,9 s », « 10 min », « 2 h 05 min ». */
export function formatLength(ms: number): string {
  const t = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  // Arrondi au dixième de seconde d'abord : 59,99 s s'écrit « 1 min », jamais « 60 s ».
  if (Math.round(t / 100) * 100 < MINUTE_MS) {
    const tenths = Math.round(t / 100) / 10;
    return `${String(tenths).replace(".", ",")}${NBSP}s`;
  }
  if (t < HOUR_MS) {
    const m = Math.floor(t / MINUTE_MS);
    const rest = Math.round((t - m * MINUTE_MS) / 100) / 10;
    if (rest >= 60) return `${m + 1}${NBSP}min`;
    return rest ? `${m}${NBSP}min ${String(rest).replace(".", ",")}${NBSP}s` : `${m}${NBSP}min`;
  }
  const h = Math.floor(t / HOUR_MS);
  const m = Math.round((t - h * HOUR_MS) / MINUTE_MS);
  if (m >= 60) return `${h + 1}${NBSP}h`;
  return m ? `${h}${NBSP}h${NBSP}${pad(m)}${NBSP}min` : `${h}${NBSP}h`;
}

/** Durée maximale, dite simplement : « 30 s », « 10 min », « 1 h », « 1 h 30 min » (pas de décimale inutile). */
export function formatLimit(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  if (t < MINUTE_MS) {
    const s = Math.round(t / 100) / 10;
    return `${String(s).replace(".", ",")}${NBSP}s`;
  }
  if (t < HOUR_MS) {
    const m = Math.floor(t / MINUTE_MS);
    const s = Math.round((t % MINUTE_MS) / 1000);
    return s ? `${m}${NBSP}min ${s}${NBSP}s` : `${m}${NBSP}min`;
  }
  const h = Math.floor(t / HOUR_MS);
  const m = Math.round((t % HOUR_MS) / MINUTE_MS);
  return m ? `${h}${NBSP}h ${m}${NBSP}min` : `${h}${NBSP}h`;
}

export type TimecodeError = "empty" | "invalid" | "negative" | "range" | "too_long";
export type ParsedTimecode = { ok: true; ms: number } | { ok: false; error: TimecodeError };

/** Fraction décimale « 5 », « 50 », « 12345 » → millisecondes (arrondi à la ms). */
function fraction(digits: string): number {
  return digits ? Math.round(Number(`0.${digits}`) * 1000) : 0;
}

const UNIT_RE = /^(?:(\d+(?:[.,]\d*)?) ?h(?:eures?)?)? ?(?:(\d+(?:[.,]\d*)?) ?m(?:in(?:utes?)?)?)? ?(?:(\d+(?:[.,]\d*)?) ?s(?:ec(?:ondes?)?)?)? ?(?:(\d+) ?ms)?$/i;
const COLON_RE = /^(\d*)(?::(\d+))?(?::(\d+))?(?:[.,](\d*))?$/;

function unsigned(s: string): ParsedTimecode {
  if (!s) return { ok: false, error: "empty" };
  let ms: number;
  if (/[a-z]/i.test(s)) {
    const u = UNIT_RE.exec(s);
    if (!u || (!u[1] && !u[2] && !u[3] && !u[4])) return { ok: false, error: "invalid" };
    const num = (v?: string) => (v ? Number(v.replace(",", ".")) : 0);
    ms = Math.round(num(u[1]) * HOUR_MS + num(u[2]) * MINUTE_MS + num(u[3]) * 1000 + num(u[4]));
  } else {
    const c = COLON_RE.exec(s);
    if (!c) return { ok: false, error: "invalid" };
    const [, a = "", b, d, frac = ""] = c;
    // « » ou « . » seul : rien de lisible ; « .5 » : une demi-seconde.
    if (!a && !b && !frac) return { ok: false, error: "invalid" };
    if (!a && b !== undefined) return { ok: false, error: "invalid" }; // « :20 »
    if (frac.length > 9) return { ok: false, error: "invalid" };
    const fields = [a || "0", b, d].filter((x): x is string => x !== undefined).map(Number);
    // Seul le premier champ peut dépasser 59 (« 90:00 » = 90 minutes) ; les suivants sont des minutes ou secondes.
    if (fields.slice(1).some((x) => x >= 60)) return { ok: false, error: "range" };
    const [h, m, sec] = fields.length === 3 ? fields : fields.length === 2 ? [0, fields[0]!, fields[1]!] : [0, 0, fields[0]!];
    ms = h! * HOUR_MS + m! * MINUTE_MS + sec! * 1000 + fraction(frac);
  }
  if (!Number.isFinite(ms)) return { ok: false, error: "invalid" };
  if (ms > MAX_TIMECODE_MS) return { ok: false, error: "too_long" };
  return { ok: true, ms };
}

/** Saisie libre → millisecondes entières, ou la raison du refus (jamais d'exception). */
export function parseTimecode(raw: string): ParsedTimecode {
  if (typeof raw !== "string") return { ok: false, error: "invalid" };
  const s = raw.normalize("NFKC").replace(/[\s  ]+/g, " ").trim().replace(/ ?: ?/g, ":").replace(/ ?([.,]) ?/g, "$1");
  if (!s) return { ok: false, error: "empty" };
  const neg = /^[-−–]/.test(s);
  const r = unsigned(neg ? s.slice(1).trim() : s);
  if (neg) return r.ok && r.ms > 0 ? { ok: false, error: "negative" } : r.ok ? r : r.error === "empty" ? { ok: false, error: "invalid" } : r;
  return r;
}

/** Message (français, typographie soignée) d'une saisie refusée. */
export function timecodeErrorText(error: TimecodeError): string {
  switch (error) {
    case "empty":
      return `Saisis un instant, par exemple 01:20 ou 1:30:45.500.`;
    case "negative":
      return `Un instant ne peut pas être négatif${NBSP}: il est ramené au début de la vidéo.`;
    case "range":
      return `Minutes et secondes vont de 00 à 59, par exemple 01:30:45.500.`;
    case "too_long":
      return `Au-delà de 24${NBSP}h${NBSP}: vérifie l’instant saisi.`;
    case "invalid":
    default:
      return `Format attendu${NBSP}: HH:MM:SS.mmm, par exemple 02:13:07.800 (ou 1:20, ou 80).`;
  }
}

// ---- 3.8.0 (TimeLens) : horloge courte, instant court, lentille, forme parlée ------------------------------------

/** Horloge en dixièmes : « 0:30 », « 0:42.5 », « 1:02:03 » ; dixièmes seulement s'ils ne sont pas nuls. */
function horloge(ms: number, hours: boolean): string {
  const t = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 100)) : 0; // dixièmes de seconde
  const h = Math.floor(t / 36_000);
  const m = Math.floor((t % 36_000) / 600);
  const s = Math.floor((t % 600) / 10);
  const d = t % 10;
  const frac = d ? `.${d}` : "";
  return h > 0 || hours ? `${h}:${pad(m)}:${pad(s)}${frac}` : `${m}:${pad(s)}${frac}`;
}

/** Durée en horloge courte, sans unité (bulle, bouton) : 30 000 → « 0:30 », 75 900 → « 1:15.9 », 59 960 → « 1:00 ». */
export function formatDureeHorloge(ms: number): string {
  return horloge(ms, false);
}

/** Instant en horloge courte : 12 500 → « 0:12.5 » ; `hours` (vidéo d'une heure ou plus) : « 0:01:23 ». */
export function formatInstantCourt(ms: number, { hours = false }: { hours?: boolean } = {}): string {
  return horloge(ms, hours);
}

/** Instant exact de la lentille : 83 400 → « 1:23.400 ». */
export function formatLentille(ms: number, { hours = false }: { hours?: boolean } = {}): string {
  return formatShort(ms, { hours, digits: 3 });
}

const unit = (n: number, one: string, many: string): string => `${String(n).replace(".", ",")}${NBSP}${n < 2 ? one : many}`;

/**
 * Forme parlée (lecteurs d'écran), arrondie au dixième, singulier en dessous de 2 : « 12,5 secondes », « 1,5 seconde »,
 * « 1 minute 23,4 secondes », « 10 minutes », « 2 heures 13 minutes 7,8 secondes ».
 */
export function formatParle(ms: number): string {
  const t = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 100)) : 0;
  const h = Math.floor(t / 36_000);
  const m = Math.floor((t % 36_000) / 600);
  const s = (t % 600) / 10;
  const out: string[] = [];
  if (h) out.push(unit(h, "heure", "heures"));
  if (m) out.push(unit(m, "minute", "minutes"));
  if (s || out.length === 0) out.push(unit(s, "seconde", "secondes"));
  return out.join(" ");
}
