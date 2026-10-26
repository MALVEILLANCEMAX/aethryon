// Petit cache de ressources JSON partagé entre composants (sans bibliothèque de requêtes).
import { useEffect, useSyncExternalStore } from "react";
import { api, ApiError } from "./api.ts";

interface Entry<T> { data?: T; error?: ApiError; loading: boolean; at: number; promise?: Promise<void> }

const entries = new Map<string, Entry<unknown>>();
const listeners = new Map<string, Set<() => void>>();
/** Rendu statique (pré-rendu à la construction) : aucune requête, chaque ressource est « pas encore
 *  chargée », exactement l'état du navigateur avant la réponse du serveur (jamais de donnée inventée). */
const NOT_LOADED: Entry<never> = Object.freeze({ loading: false, at: 0 });

function emit(key: string) { listeners.get(key)?.forEach((l) => l()); }
function get<T>(key: string): Entry<T> {
  let e = entries.get(key) as Entry<T> | undefined;
  if (!e) { e = { loading: false, at: 0 }; entries.set(key, e as Entry<unknown>); }
  return e;
}

export function load<T>(path: string, force = false): Promise<void> {
  const e = get<T>(path);
  if (e.promise && !force) return e.promise;
  entries.set(path, { ...e, loading: true });
  emit(path);
  const promise = api<T>(path)
    .then((data) => { entries.set(path, { data, loading: false, at: Date.now() }); })
    .catch((error: unknown) => {
      const err = error instanceof ApiError ? error : new ApiError(0, "network", "Connexion impossible.");
      // 401/403 : la session n'existe plus (déconnexion, expiration, suspension) → on oublie les données.
      // Erreur réseau ou serveur : on garde les dernières données connues.
      const drop = err.status === 401 || err.status === 403;
      entries.set(path, { ...get<T>(path), data: drop ? undefined : get<T>(path).data, error: err, loading: false, at: Date.now(), promise: undefined });
    })
    .finally(() => { const cur = get<T>(path); entries.set(path, { ...cur, promise: undefined }); emit(path); });
  entries.set(path, { ...get<T>(path), promise });
  return promise;
}

/** Oublie toutes les données mises en cache (déconnexion, suppression du compte) et prévient les composants. */
export function resetAll() {
  for (const key of [...entries.keys()]) {
    entries.set(key, { loading: false, at: 0 });
    emit(key);
  }
}

export function invalidate(...paths: string[]) {
  for (const p of paths) if (entries.has(p)) void load(p, true);
}

/** Périme toutes les ressources dont le chemin commence par l'un des préfixes : celles affichées en ce
 *  moment sont rechargées, les autres le seront à leur prochaine lecture (listes filtrées, pages). */
export function invalidatePrefix(...prefixes: string[]) {
  for (const key of [...entries.keys()]) {
    if (!prefixes.some((p) => key.startsWith(p))) continue;
    if (listeners.get(key)?.size) void load(key, true);
    else entries.set(key, { ...get(key), at: 0 });
  }
}

export function useResource<T>(path: string | null, maxAgeMs = 30_000) {
  const key = path ?? "__none__";
  const snap = useSyncExternalStore(
    (cb) => {
      let set = listeners.get(key);
      if (!set) { set = new Set(); listeners.set(key, set); }
      set.add(cb);
      return () => set!.delete(cb);
    },
    () => get<T>(key),
    () => NOT_LOADED as Entry<T>,
  );
  useEffect(() => {
    if (!path) return;
    const e = get<T>(path);
    if (!e.promise && (e.at === 0 || Date.now() - e.at > maxAgeMs)) void load<T>(path);
  }, [path, maxAgeMs]);
  return { data: snap.data, error: snap.error, loading: snap.loading || (!!path && snap.at === 0 && !snap.error), at: snap.at, reload: () => (path ? load<T>(path, true) : Promise.resolve()) };
}
