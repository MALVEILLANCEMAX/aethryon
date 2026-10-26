// Petits outils HTTP partagés par l'API publique et l'API d'administration.
import type { Context } from "hono";

export interface SessionUser {
  id: string; email: string; name: string; role: string; status: string; createdAt: string; lastLoginAt: string | null;
}
/** `sessionId` : identifiant de la session Better Auth en cours (liaison Discord : le `state` OAuth y est lié). */
export type Vars = { user: SessionUser | null; sessionId: string | null };

/** Petit limiteur à fenêtre glissante, en mémoire (un seul processus). */
export class Limiter {
  private hits = new Map<string, number[]>();
  private max: number;
  private windowMs: number;
  constructor(max: number, windowMs: number) { this.max = max; this.windowMs = windowMs; }
  take(key: string): boolean {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) { this.hits.set(key, list); return false; }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
    return true;
  }
}

export const err = (c: Context, status: number, error: string, message: string) =>
  c.json({ error, message }, status as 400);

/** Date stockée (ISO, nombre de millisecondes ou texte numérique) → ISO 8601 UTC, ou null. */
export const toIso = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : (v as string));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Erreur HTTP lancée par un gestionnaire ; rendue `{ error, message }` par le onError de l'app. */
export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
