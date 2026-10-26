// Journal JSON sur stdout. Ne jamais y passer de cookie, de jeton, de secret ni d'adresse e-mail :
// les champs sont filtrés et les chaînes ressemblant à un jeton sont masquées par sécurité.
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;

const FORBIDDEN_KEYS = /^(cookie|authorization|secret|token|key|password|email|set-cookie)$/i;
const TOKENISH = /(ytc_[A-Za-z0-9]{8,}|Bearer\s+\S+|[A-Za-z0-9_-]{40,})/g;
const EMAIL = /[^\s@"]+@[^\s@"]+\.[^\s@"]+/g;

export function scrub(value: unknown): unknown {
  if (typeof value === "string") return value.replace(TOKENISH, "[masqué]").replace(EMAIL, "[e-mail]");
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = FORBIDDEN_KEYS.test(k) ? "[masqué]" : scrub(v);
    return out;
  }
  return value;
}

let sink: (line: string) => void = (line) => process.stdout.write(line + "\n");
/** Pour les tests : capture des lignes de journal. */
export function setLogSink(fn: (line: string) => void): void { sink = fn; }

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < threshold) return;
  const line = { ts: new Date().toISOString(), level, msg: scrub(msg), ...(scrub(fields) as object) };
  sink(JSON.stringify(line));
}
