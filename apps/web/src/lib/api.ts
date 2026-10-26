// Accès à l'API (même origine). Les erreurs portent le code et le message français du serveur.
export class ApiError extends Error {
  status: number;
  code: string;
  /** Corps JSON de la réponse d'erreur (ex. champ en cause d'une validation serveur), s'il existe. */
  data: Record<string, unknown> | null;
  constructor(status: number, code: string, message: string, data: Record<string, unknown> | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
  get isNetwork() { return this.status === 0; }
  get isServer() { return this.status >= 500 || this.status === 0; }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function api<T>(path: string, init: { method?: Method; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? "GET";
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: method === "GET" ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(init.body ?? {}),
      signal: init.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "network", "Connexion impossible. Vérifie ta connexion et réessaie.");
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string; code?: string };
    throw new ApiError(res.status, d.error ?? d.code ?? "error", d.message ?? "Une erreur est survenue.", data && typeof data === "object" ? (data as Record<string, unknown>) : null);
  }
  return data as T;
}
