// Faux fetch : enregistre chaque requête (URL, méthode, en-têtes, corps) et la confie à un gestionnaire ;
// respecte AbortSignal (délai, annulation) comme le vrai.
export interface FakeRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  init: RequestInit;
}

export type FakeReply = Response | "network" | Promise<Response | "network">;
export type Handler = (req: FakeRequest) => FakeReply;

export function createFakeFetch(handler: Handler): { fetch: typeof fetch; calls: FakeRequest[] } {
  const calls: FakeRequest[] = [];
  const fn = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
    const req: FakeRequest = { url, method: (init.method ?? "GET").toUpperCase(), headers, body: typeof init.body === "string" ? init.body : null, init };
    calls.push(req);
    return new Promise<Response>((resolve, reject) => {
      const signal = init.signal;
      if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      Promise.resolve()
        .then(() => handler(req))
        .then((r) => (r === "network" ? reject(new TypeError("Failed to fetch")) : resolve(r)), reject);
    });
  };
  return { fetch: fn as typeof fetch, calls };
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function bytes(status: number, size: number, type = "video/mp4"): Response {
  return new Response(new Uint8Array(size), { status, headers: { "content-type": type } });
}
