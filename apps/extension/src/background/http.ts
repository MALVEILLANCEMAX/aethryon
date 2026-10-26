// Requêtes vers ytapi et vers le compte AETHRYON. Le jeton ne voyage QUE dans l'en-tête Authorization
// (jamais dans une URL) ; aucun cookie (credentials: "omit"), aucune redirection suivie (le jeton ne peut
// pas être renvoyé ailleurs), pas de cache, pas de Referer.
import { parseRetryAfter } from "./errors.ts";

export type FetchFn = typeof fetch;

export class NetworkError extends Error {
  readonly timeout: boolean;
  readonly aborted: boolean;
  constructor(timeout: boolean, aborted: boolean) {
    super(aborted ? "aborted" : timeout ? "timeout" : "network");
    this.name = "NetworkError";
    this.timeout = timeout;
    this.aborted = aborted;
  }
}

export interface HttpResult {
  /** 0 = redirection refusée (réponse opaque). */
  status: number;
  /** Corps JSON s'il y en a un (sinon null : le flux est abandonné sans être lu). */
  body: unknown;
  retryAfterS: number | null;
}

export interface HttpOptions {
  method?: "GET" | "POST" | "DELETE";
  token?: string;
  json?: unknown;
  headers?: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
}

export async function http(fetchFn: FetchFn, url: string, o: HttpOptions): Promise<HttpResult> {
  const headers: Record<string, string> = { accept: "application/json", ...o.headers };
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  let body: string | undefined;
  if (o.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(o.json);
  }
  const timeout = AbortSignal.timeout(o.timeoutMs);
  const signal = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: o.method ?? "GET", headers, body, signal,
      credentials: "omit", cache: "no-store", redirect: "manual", referrerPolicy: "no-referrer",
    });
  } catch {
    throw new NetworkError(timeout.aborted, o.signal?.aborted === true);
  }
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    return { status: 0, body: null, retryAfterS: null };
  }
  const retryAfterS = parseRetryAfter(res.headers.get("retry-after"));
  const type = res.headers.get("content-type") ?? "";
  let data: unknown = null;
  if (type.includes("json")) {
    try {
      data = await res.json();
    } catch {
      if (signal.aborted) throw new NetworkError(timeout.aborted, o.signal?.aborted === true);
      data = null;
    }
  } else {
    // Fichier ou page HTML : jamais lu en mémoire.
    try { await res.body?.cancel(); } catch { /* déjà fermé */ }
  }
  return { status: res.status, body: data, retryAfterS };
}
