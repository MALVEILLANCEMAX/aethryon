// Connexion au compte AETHRYON (docs/EXTENSION.md §3) : autorisation par code + PKCE (S256) dans une
// fenêtre du navigateur (chrome.identity.launchWebAuthFlow), puis échange du code contre un jeton
// d'extension (clé ytc_ de type « extension »). Fonctions pures ici ; le déroulé est dans worker.ts.
import { cleanText } from "../shared/messages.ts";
import type { AccountView } from "../shared/types.ts";
import { isObj, jobError, MSG } from "./errors.ts";
import type { JobError } from "../shared/types.ts";

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** n octets aléatoires (crypto.getRandomValues) en base64url : 32 octets → 43 caractères. */
export function randomB64url(n = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}

/** code_challenge = BASE64URL(SHA-256(ASCII(code_verifier))) (RFC 7636, méthode S256). */
export async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

interface UaData { brands?: { brand: string }[]; platform?: string }

/** Nom lisible de l'appareil, ex. « Chrome · Windows » (userAgentData, sinon userAgent). */
export function deviceLabel(nav: { userAgent?: string; userAgentData?: UaData } | undefined = globalThis.navigator as never): string {
  const ua = nav?.userAgent ?? "";
  const brands = (nav?.userAgentData?.brands ?? []).map((b) => b.brand);
  const has = (name: string) => brands.includes(name);
  const browser =
    has("Microsoft Edge") || /\bEdg\//.test(ua) ? "Edge"
      : has("Opera") || /\bOPR\//.test(ua) ? "Opera"
        : has("Brave") ? "Brave"
          : has("Google Chrome") ? "Chrome"
            : has("Chromium") ? "Chromium"
              : "Chrome";
  const p = (nav?.userAgentData?.platform ?? "").toLowerCase();
  const os =
    p === "windows" || (!p && /Windows/.test(ua)) ? "Windows"
      : p === "macos" || (!p && /Mac OS X|Macintosh/.test(ua)) ? "macOS"
        : p === "chrome os" || p === "chromeos" || (!p && /CrOS/.test(ua)) ? "ChromeOS"
          : p === "android" || (!p && /Android/.test(ua)) ? "Android"
            : p === "linux" || (!p && /Linux/.test(ua)) ? "Linux"
              : "";
  return os ? `${browser} · ${os}` : browser;
}

/** URL d'autorisation, exactement selon le contrat (docs/EXTENSION.md §3 et §7). */
export function authorizeUrl(siteBase: string, redirectUri: string, state: string, challenge: string, label: string): string {
  return `${siteBase}/extension/autoriser?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}` +
    `&code_challenge=${challenge}&code_challenge_method=S256&appareil=${encodeURIComponent(label)}`;
}

/**
 * Retour de launchWebAuthFlow → code, ou erreur. Le retour doit viser exactement l'URI de retour, et
 * `state` doit être identique à celui envoyé (vérifié avant toute autre lecture, même pour un refus).
 */
export function parseRedirect(responseUrl: string | undefined, redirectUri: string, state: string): { code: string } | { error: JobError } {
  const failed = { error: jobError("auth_failed", MSG.loginFailed, true) };
  if (typeof responseUrl !== "string") return failed;
  let u: URL;
  let expected: URL;
  try {
    u = new URL(responseUrl);
    expected = new URL(redirectUri);
  } catch {
    return failed;
  }
  if (u.origin !== expected.origin || u.pathname.replace(/\/$/, "") !== expected.pathname.replace(/\/$/, "")) return failed;
  const q = u.searchParams;
  if (q.get("state") !== state) return { error: jobError("auth_state", MSG.loginState, true) };
  const err = q.get("error");
  if (err === "access_denied") return { error: jobError("auth_denied", MSG.loginDenied, true) };
  if (err) return failed;
  const code = q.get("code");
  if (!code || !/^[A-Za-z0-9._~-]{16,512}$/.test(code)) return failed;
  return { code };
}

export interface TokenGrant { token: string; expiresAt: string | null; email: string; name: string }

/** {token, expiresAt, user:{email, name}} → jeton validé (clé ytc_), ou null. */
export function parseTokenResponse(body: unknown): TokenGrant | null {
  if (!isObj(body) || typeof body.token !== "string" || !/^ytc_[A-Za-z0-9]{16,256}$/.test(body.token)) return null;
  const user = isObj(body.user) ? body.user : {};
  let expiresAt: string | null = null;
  if (typeof body.expiresAt === "string" && Number.isFinite(Date.parse(body.expiresAt))) expiresAt = body.expiresAt;
  else if (body.expiresAt !== null && body.expiresAt !== undefined) return null;
  return {
    token: body.token,
    expiresAt,
    email: typeof user.email === "string" ? cleanText(user.email, 254) : "",
    name: typeof user.name === "string" ? cleanText(user.name, 120) : "",
  };
}

const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
const text = (v: unknown, max: number): string | null => (typeof v === "string" ? cleanText(v, max) : null);

/** GET /api/extension/me → éléments de l'AccountView (valeurs vérifiées, textes bornés). */
export function parseMe(body: unknown): Partial<AccountView> | null {
  if (!isObj(body) || !isObj(body.user) || !isObj(body.today)) return null;
  const used = count(body.today.used);
  if (used === null) return null;
  const out: Partial<AccountView> = {
    today: {
      used,
      limit: count(body.today.limit),
      remaining: count(body.today.remaining),
      ...(typeof body.today.resetAt === "string" ? { resetAt: cleanText(body.today.resetAt, 40) } : {}),
    },
  };
  const email = text(body.user.email, 254);
  if (email) out.email = email;
  const name = text(body.user.name, 120);
  if (name) out.name = name;
  const active = count(body.activeJobs);
  if (active !== null) out.activeJobs = active;
  // V3 : AETHRYON Tools ouvert sur ce serveur (absent d'un serveur plus ancien : fermé).
  if (isObj(body.features)) out.tools = body.features.tools === true;
  if (Array.isArray(body.recent)) {
    out.recent = body.recent.filter(isObj).slice(0, 10).map((r) => ({
      createdAt: text(r.createdAt, 40) ?? "",
      platform: text(r.platform, 20),
      fmt: text(r.fmt, 8) ?? "",
      state: text(r.state, 20) ?? "",
      errorMessage: text(r.errorMessage, 300),
    }));
  }
  return out;
}

/**
 * Échec de launchWebAuthFlow → cause : fenêtre fermée par l'utilisateur (« The user did not approve
 * access. »), page de connexion qui n'a pas pu se charger (« Authorization page could not be loaded. » :
 * réseau coupé OU réponse HTTP en erreur, Chrome ne les distingue pas — le service worker interroge alors la
 * page pour savoir laquelle), ou autre.
 */
export type FlowFailure = "cancelled" | "page" | "other";

export function classifyWebAuthFlowError(e: unknown): FlowFailure {
  const m = e instanceof Error ? e.message : String(e);
  if (/did not approve|cancel|closed/i.test(m)) return "cancelled";
  if (/could not be loaded|ERR_|network/i.test(m)) return "page";
  return "other";
}

/** Erreur à montrer pour une fenêtre fermée ou un échec non classé (la page injoignable est diagnostiquée à part). */
export function webAuthFlowError(kind: Exclude<FlowFailure, "page">): JobError {
  return kind === "cancelled" ? jobError("auth_cancelled", MSG.loginCancelled, true) : jobError("auth_failed", MSG.loginFailed, true);
}
