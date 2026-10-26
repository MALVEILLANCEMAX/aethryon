// Versions du site et anciens fichiers — incident du 2026-10-14 : « Failed to fetch dynamically imported module »
// (AdminLayout-YdrZktwS.js) dans un onglet ouvert AVANT un déploiement. Chaque construction renomme ses fichiers
// (noms hachés) ; un onglet resté sur l'ancienne version demandait, à la navigation suivante, un fichier qui
// n'existait plus. Le serveur garde désormais les anciens fichiers (deploy/web-assets-archive.sh) ; ici, côté
// navigateur, trois protections de plus :
// 1. Détection : /version.json (scripts/prerender.mjs : le nom haché du script d'entrée de la construction) est relu
//    quand l'onglet redevient visible et toutes les 5 minutes. Une version plus récente est NOTÉE ; la PROCHAINE
//    navigation se fait alors par un vrai chargement de la même adresse. Jamais de rechargement en pleine page :
//    seulement quand l'utilisateur la quitte de lui-même (rien de ce qu'il saisissait n'est perdu en plus).
// 2. Récupération : un code de page introuvable (import dynamique, préchargement CSS) recharge la page UNE fois, à la
//    même adresse, dès que le serveur répond (pendant un déploiement il peut ne pas répondre quelques secondes).
//    Garde dans sessionStorage : un rechargement automatique par adresse et par minute, trois par dix minutes ; sans
//    stockage disponible, aucun rechargement automatique (jamais de boucle).
// 3. Repli : si cela ne suffit pas, ou sans réseau, l'interface le dit (app/RouteError.tsx) ; jamais de trace technique.

const VERSION_URL = "/version.json";
const GUARD_KEY = "aethryon:rechargement";
const CHECK_EVERY_MS = 5 * 60_000;

/** Construction de CETTE page : le script d'entrée qui l'a démarrée (/assets/index-<hash>.js) ; null en développement. */
export function currentBuild(): string | null {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.getAttribute("src") ?? "";
  return /\/assets\/(index-[\w-]+\.js)$/.exec(src)?.[1] ?? null;
}

/** Construction servie MAINTENANT (null si le serveur ne répond pas, ou répond autre chose que la version). */
export async function serverBuild(timeoutMs = 4000, signal?: AbortSignal): Promise<string | null> {
  const ac = new AbortController();
  const stop = () => ac.abort();
  signal?.addEventListener("abort", stop);
  const t = window.setTimeout(stop, timeoutMs);
  try {
    const r = await fetch(VERSION_URL, { cache: "no-store", credentials: "omit", signal: ac.signal });
    if (!r.ok) return null;
    const body = (await r.json()) as { build?: unknown };
    return typeof body.build === "string" && /^index-[\w-]+\.js$/.test(body.build) ? body.build : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(t);
    signal?.removeEventListener("abort", stop);
  }
}

/** Échec de chargement d'un fichier de code (et non une erreur du code lui-même) — Chrome, Firefox, Safari, Vite. */
export function isChunkLoadError(error: unknown): boolean {
  const e = error as { name?: unknown; message?: unknown } | null;
  const text = `${typeof e?.name === "string" ? e.name : ""} ${typeof e?.message === "string" ? e.message : String(error ?? "")}`;
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to load module script|is not a valid JavaScript MIME type|ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed/i.test(text);
}

interface Guard { at: number; path: string }
const pathKey = () => location.pathname + location.search;

function readGuard(): Guard[] | null {
  try {
    const raw = sessionStorage.getItem(GUARD_KEY);
    const list = raw ? (JSON.parse(raw) as Guard[]) : [];
    return Array.isArray(list) ? list.filter((g) => typeof g?.at === "number" && Date.now() - g.at < 10 * 60_000) : [];
  } catch {
    return null; // stockage indisponible : pas de rechargement automatique
  }
}

/** Un rechargement automatique est-il encore permis ici ? (une fois par adresse et par minute, trois par dix minutes) */
export function canAutoReload(): boolean {
  const list = readGuard();
  if (list === null) return false;
  return list.length < 3 && !list.some((g) => g.path === pathKey() && Date.now() - g.at < 60_000);
}

/** Recharge la page à la même adresse (route, paramètres, ancre), en le notant ; `force` : demandé par l'utilisateur. */
export function reloadPage(force = false): boolean {
  const list = readGuard();
  if (!force && (list === null || !canAutoReload())) return false;
  try { sessionStorage.setItem(GUARD_KEY, JSON.stringify([...(list ?? []), { at: Date.now(), path: pathKey() }])); } catch { /* rien */ }
  location.reload();
  return true;
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  const t = window.setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { window.clearTimeout(t); resolve(); }, { once: true });
});

export type Recovery = "recharge" | "hors-ligne" | "echec";

/** Après un code introuvable : attend que le serveur réponde (jusqu'à ~30 s, le temps d'un déploiement), puis
 *  recharge une fois. Sans réseau : « hors-ligne » (on reprendra au retour du réseau) ; garde épuisée : « echec ». */
export async function recoverFromChunkError(signal?: AbortSignal): Promise<Recovery> {
  for (let attempt = 0; attempt < 8 && !signal?.aborted; attempt++) {
    // Le serveur d'abord : navigator.onLine peut se tromper ; « hors ligne » seulement s'il ne répond pas non plus.
    if ((await serverBuild(4000, signal)) !== null) return reloadPage() ? "recharge" : "echec";
    if (navigator.onLine === false) return "hors-ligne";
    await sleep(attempt < 3 ? 1500 : 4000, signal);
  }
  return navigator.onLine === false ? "hors-ligne" : "echec";
}

let stale = false;
/** Une version plus récente est servie : la prochaine navigation chargera la page en entier. */
export const isStale = () => stale;
function markStale() { stale = true; }

interface RouterLike { subscribe: (fn: (state: { location: { pathname: string; search: string } }) => void) => () => void }

/** Surveillance de la version (main.tsx). Sans construction identifiable (développement) : seule la récupération reste. */
export function watchVersion(router: RouterLike): void {
  const build = currentBuild();
  let lastCheck = Date.now();
  let checking = false;
  async function check() {
    if (!build || checking || stale) return;
    checking = true;
    lastCheck = Date.now();
    const served = await serverBuild();
    if (served !== null && served !== build) markStale();
    checking = false;
  }
  // Le code d'une page n'a pas pu être préchargé (fichier introuvable) : l'erreur suit son cours jusqu'à la page
  // d'erreur des routes (RouteError, rechargement contrôlé) ; on note seulement qu'une autre version peut être servie.
  window.addEventListener("vite:preloadError", () => { void check(); });
  if (!build) return;
  window.__aethryonVersionCheck = check; // essais navigateur : « retour sur l'onglet » sans attendre
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastCheck > 60_000) void check();
  });
  window.setInterval(() => { if (document.visibilityState === "visible") void check(); }, CHECK_EVERY_MS);
  // Changement de page (pas de simple ancre) avec une version périmée : vrai chargement de la NOUVELLE adresse,
  // déjà inscrite dans l'historique par le routeur (retour arrière intact).
  let here = location.pathname + location.search;
  router.subscribe((state) => {
    const next = state.location.pathname + state.location.search;
    if (next === here) return;
    here = next;
    if (stale) location.reload();
  });
}

declare global { interface Window { __aethryonVersionCheck?: () => Promise<void> } }
