// Avis de nouvelle version (docs/EXTENSION.md §8). L'extension est installée hors store (ZIP chargé en mode
// développeur) : aucune mise à jour automatique n'existe pour elle, et elle ne télécharge ni n'installe JAMAIS
// rien elle-même. Elle lit seulement le fichier public latest.json du site (UPDATE_URL, figé à la
// construction), au démarrage du navigateur, par une alarme toutes les 12 h, et à l'ouverture du popup si la
// dernière vérification date de plus de 12 h — jamais plus d'une requête par 12 h, et seulement après
// l'accord à la notice sur les données. Sans clé, sans cookie, sans donnée de compte. Échecs silencieux :
// aucun message à l'utilisateur, aucun journal.
import { DOWNLOAD_PAGE_URL, UPDATE_URL } from "../shared/config.ts";
import { cleanText } from "../shared/messages.ts";
import type { UpdateNotice } from "../shared/types.ts";
import { isObj } from "./errors.ts";
import type { FetchFn } from "./http.ts";

export const UPDATE_ALARM = "aethryon-update";
export const UPDATE_KEY = "update";
export const CHECK_INTERVAL_MS = 12 * 3_600_000;
/** Une alarme de 12 h qui sonne un peu tôt ne doit pas sauter son tour. */
const SLACK_MS = 5 * 60_000;
const MAX_BODY = 64 * 1024;

/** Contenu de latest.json (extension/scripts/zip.mjs l'écrit avec exactement ce schéma). */
export interface LatestInfo {
  version: string;
  file: string;
  sha256: string;
  size: number;
  released: string;
  minChrome: number;
  notes: string[];
}

export interface UpdateState {
  /** Dernier ESSAI de vérification (réussi ou non) : jamais plus d'une requête par 12 h. */
  checkedAt: number;
  latest?: { version: string; notes: string[]; released: string; minChrome: number };
  /** Version dont l'avis a été masqué par l'utilisateur (une nouvelle version le refait apparaître). */
  dismissed?: string;
}

const VERSION_RE = /^\d{1,5}(\.\d{1,5}){0,3}$/;

/** Compare deux versions de manifeste (« 1.2.3 », 1 à 4 nombres) : -1, 0 ou 1 ; null si l'une est invalide. */
export function compareVersions(a: string, b: string): number | null {
  if (typeof a !== "string" || typeof b !== "string" || !VERSION_RE.test(a) || !VERSION_RE.test(b)) return null;
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** latest.json → informations vérifiées champ par champ (schéma exact), sinon null. */
export function parseLatest(body: unknown): LatestInfo | null {
  if (!isObj(body)) return null;
  const { version, file, sha256, size, released, minChrome, notes } = body;
  if (typeof version !== "string" || !VERSION_RE.test(version)) return null;
  if (file !== `aethryon-extension-${version}.zip`) return null;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0 || size > 200 * 1024 * 1024) return null;
  if (typeof released !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(released) || !Number.isFinite(Date.parse(released))) return null;
  if (typeof minChrome !== "number" || !Number.isInteger(minChrome) || minChrome < 1 || minChrome > 9999) return null;
  if (!Array.isArray(notes) || notes.length > 30 || !notes.every((n) => typeof n === "string")) return null;
  return { version, file, sha256, size, released, minChrome, notes: notes.map((n) => cleanText(n, 240)).filter(Boolean).slice(0, 8) };
}

/** Une vérification est-elle due ? (jamais faite, plus de 12 h, ou horloge revenue en arrière) */
export function isDue(s: UpdateState | null, now = Date.now()): boolean {
  if (!s || !Number.isFinite(s.checkedAt)) return true;
  if (s.checkedAt > now + 60_000) return true;
  return now - s.checkedAt >= CHECK_INTERVAL_MS - SLACK_MS;
}

/** Version majeure du navigateur (« Chrome/153.0… »), ou null. */
export function chromeMajor(ua: string = globalThis.navigator?.userAgent ?? ""): number | null {
  const m = /\bChrom(?:e|ium)\/(\d{2,4})\./.exec(ua);
  return m ? Number(m[1]) : null;
}

/** Avis à montrer : version annoncée plus récente que celle installée, et pas masquée pour CETTE version. */
export function noticeFor(s: UpdateState | null, current: string, chrome: number | null = chromeMajor()): UpdateNotice | null {
  const l = s?.latest;
  if (!l) return null;
  const cmp = compareVersions(l.version, current);
  if (cmp === null || cmp <= 0 || s?.dismissed === l.version) return null;
  const n: UpdateNotice = { version: l.version, notes: [...l.notes], released: l.released, url: DOWNLOAD_PAGE_URL };
  if (chrome !== null && l.minChrome > chrome) n.needsChrome = l.minChrome;
  return n;
}

function validState(raw: unknown): UpdateState | null {
  if (!isObj(raw) || typeof raw.checkedAt !== "number") return null;
  const out: UpdateState = { checkedAt: raw.checkedAt };
  const l = raw.latest;
  if (isObj(l) && typeof l.version === "string" && VERSION_RE.test(l.version) && Array.isArray(l.notes) && typeof l.released === "string" && typeof l.minChrome === "number") {
    out.latest = { version: l.version, notes: l.notes.filter((n): n is string => typeof n === "string").slice(0, 8), released: l.released, minChrome: l.minChrome };
  }
  if (typeof raw.dismissed === "string" && VERSION_RE.test(raw.dismissed)) out.dismissed = raw.dismissed;
  return out;
}

export async function readUpdateState(): Promise<UpdateState | null> {
  try {
    return validState((await chrome.storage.local.get(UPDATE_KEY))[UPDATE_KEY]);
  } catch {
    return null;
  }
}

async function writeUpdateState(s: UpdateState): Promise<void> {
  await chrome.storage.local.set({ [UPDATE_KEY]: s });
}

export async function clearUpdateState(): Promise<void> {
  await chrome.storage.local.remove(UPDATE_KEY);
}

/** Lecture de latest.json : informations vérifiées, ou null (réseau, statut, type, taille, schéma). */
async function fetchLatest(fetchFn: FetchFn, timeoutMs: number): Promise<LatestInfo | null> {
  try {
    const res = await fetchFn(UPDATE_URL, {
      method: "GET", headers: { accept: "application/json" }, credentials: "omit", cache: "no-store",
      redirect: "error", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) {
      try { await res.body?.cancel(); } catch { /* déjà fermé */ }
      return null;
    }
    const text = await res.text();
    return text.length > MAX_BODY ? null : parseLatest(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Vérification, si elle est due (au plus une par 12 h, l'essai compte même s'il échoue). Ne lève jamais.
 * `checked` : une requête a été faite ; `notice` : l'avis à montrer après coup (ou null).
 */
export async function checkForUpdate(
  fetchFn: FetchFn, current: string, { now = Date.now(), timeoutMs = 8_000 }: { now?: number; timeoutMs?: number } = {},
): Promise<{ checked: boolean; notice: UpdateNotice | null }> {
  try {
    const prev = await readUpdateState();
    if (!isDue(prev, now)) return { checked: false, notice: noticeFor(prev, current) };
    const next: UpdateState = { checkedAt: now };
    if (prev?.latest) next.latest = prev.latest;
    if (prev?.dismissed) next.dismissed = prev.dismissed;
    await writeUpdateState(next);
    const latest = await fetchLatest(fetchFn, timeoutMs);
    if (latest) {
      next.latest = { version: latest.version, notes: latest.notes, released: latest.released, minChrome: latest.minChrome };
      await writeUpdateState(next);
    }
    return { checked: true, notice: noticeFor(next, current) };
  } catch {
    return { checked: false, notice: null };
  }
}

/** Masque l'avis de CETTE version (une version plus récente le refera apparaître). */
export async function dismissUpdate(version: string): Promise<void> {
  const s = (await readUpdateState()) ?? { checkedAt: 0 };
  await writeUpdateState({ ...s, dismissed: version });
}
