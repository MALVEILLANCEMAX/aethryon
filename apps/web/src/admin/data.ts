// Accès aux données du Control Center : toujours via l'aide `api` du site (JSON, même origine, cookie de
// session ; l'origine des mutations est ajoutée par le navigateur, le serveur la contrôle).
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { invalidate, invalidatePrefix, useResource } from "../lib/store.ts";

export const ADMIN_API = "/api/admin";

/** Chaîne de requête sans les valeurs vides (ordre stable : sert aussi de clé de cache). */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Ressource d'administration. Pendant le chargement d'une nouvelle page ou d'un nouveau filtre, les
 *  données précédentes restent affichées (atténuées) : pas de saut de mise en page. */
export function useAdmin<T>(path: string | null, maxAgeMs = 15_000) {
  const r = useResource<T>(path ? `${ADMIN_API}${path}` : null, maxAgeMs);
  const status = r.error?.status;
  // Session expirée ou rôle retiré pendant la navigation : la coque revérifie le rôle (écran adapté).
  useEffect(() => { if (status === 401 || status === 403) recheckRole(); }, [status]);
  const last = useRef<T | undefined>(undefined);
  if (r.data !== undefined) last.current = r.data;
  const data = r.data ?? (r.error ? undefined : last.current);
  return { ...r, data, stale: r.data === undefined && data !== undefined };
}

/** Relit GET /api/admin/me : sans session ou sans rôle, la coque affiche l'écran « Connexion requise » ou
 *  « Accès réservé » (le serveur refuse de toute façon chaque appel). */
export function recheckRole() {
  invalidate(`${ADMIN_API}/me`);
}

/** Mutation d'administration, puis péremption des listes concernées (préfixes relatifs à /api/admin). */
export async function adminMutate<T = unknown>(method: "POST" | "PUT", path: string, body?: unknown, refresh: string[] = []): Promise<T> {
  let res: T;
  try {
    res = await api<T>(`${ADMIN_API}${path}`, { method, body: body ?? {} });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) recheckRole();
    throw e;
  }
  invalidatePrefix(...refresh.map((p) => `${ADMIN_API}${p}`));
  return res;
}

/** Rafraîchissement périodique, seulement quand l'onglet est visible. */
export function usePolling(reload: () => unknown, ms: number, enabled = true) {
  const fn = useRef(reload);
  fn.current = reload;
  useEffect(() => {
    if (!enabled) return;
    let t: number | undefined;
    const tick = () => { if (document.visibilityState === "visible") void fn.current(); };
    const start = () => { window.clearInterval(t); t = window.setInterval(tick, ms); };
    const onVis = () => { if (document.visibilityState === "visible") { tick(); start(); } else window.clearInterval(t); };
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [ms, enabled]);
}

/** Filtres dans l'URL (partageables, bouton Retour) : tout changement de filtre ramène à la page 1. */
export function useFilters<K extends string>(defaults: Record<K, string>) {
  const [sp, setSp] = useSearchParams();
  const defs = useRef(defaults);
  defs.current = defaults;
  const get = (k: K) => sp.get(k) ?? defaults[k];
  const values = Object.fromEntries(Object.keys(defaults).map((k) => [k, get(k as K)])) as Record<K, string>;
  const page = Math.max(1, Number.parseInt(sp.get("page") ?? "1", 10) || 1);
  const set = useCallback((patch: Partial<Record<string, string>>, opts: { replace?: boolean; keepPage?: boolean } = {}) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch) as [string, string | undefined][]) {
        const def = (defs.current as Record<string, string>)[k];
        if (v === undefined || v === "" || v === def || (k === "page" && v === "1")) next.delete(k);
        else next.set(k, v);
      }
      if (!("page" in patch) && !opts.keepPage) next.delete("page");
      return next;
    }, { replace: opts.replace ?? false });
  }, [setSp]);
  const extra = (k: string) => sp.get(k);
  return { values, page, set, extra, params: sp };
}

/** Champ de recherche relié à l'URL : saisie libre, envoi différé (300 ms), resynchronisé si l'URL change
 *  d'ailleurs (bouton Retour). */
export function useSearchInput(urlValue: string, push: (v: string) => void, ms = 300) {
  const [v, setV] = useState(urlValue);
  const pushed = useRef(urlValue);
  const pushRef = useRef(push);
  pushRef.current = push;
  useEffect(() => {
    if (urlValue !== pushed.current) { pushed.current = urlValue; setV(urlValue); }
  }, [urlValue]);
  useEffect(() => {
    if (v === pushed.current) return;
    const t = window.setTimeout(() => { pushed.current = v; pushRef.current(v); }, ms);
    return () => window.clearTimeout(t);
  }, [v, ms]);
  return [v, setV] as const;
}

/** Tri « champ:sens » ↔ { key, dir } ; un clic sur l'en-tête actif inverse le sens. */
export function nextSort(cur: { key: string; dir: "asc" | "desc" }, key: string, defaults: Record<string, "asc" | "desc"> = {}): { sort: string; dir: "asc" | "desc" } {
  if (cur.key === key) return { sort: key, dir: cur.dir === "asc" ? "desc" : "asc" };
  return { sort: key, dir: defaults[key] ?? "desc" };
}
