// Vérification de sécurité (anti-bot, docs/SECURITE-ANTIBOT.md). Le SERVEUR décide : une action sensible reçoit
// 403 « challenge_required » avec un ticket ; le navigateur résout le défi Cap (preuve de travail, widget officiel
// chargé seulement à ce moment-là), puis rejoue la MÊME action avec le ticket et le jeton. Le serveur vérifie le jeton
// auprès de Cap (usage unique) et l'indique par l'en-tête « X-Aethryon-Verification: ok » : l'interface ne montre la
// réussite (yeux de la chouette allumés) qu'avec cette confirmation. Aucune animation, aucun cookie posé ici ne
// prouve quoi que ce soit ; aucun délai artificiel : l'action reprend dès que le serveur l'a acceptée.
import { ApiError, type ApiInit } from "./api.ts";

export type VerifyPhase = "verifying" | "success" | "failed" | "expired" | "blocked" | "unavailable";
export interface VerifyState { phase: VerifyPhase; progress: number; slow: boolean; message: string | null; id: number }
export type VerifyInit = Pick<ApiInit, "headers" | "onResponse">;
interface Challenge { ticket: string; endpoint: string; action: string; expiresInSeconds: number }

// ---- petit magasin (lu par ui/VerificationHost.tsx) --------------------------------------------------------------

let state: VerifyState | null = null;
const listeners = new Set<() => void>();
let decide: ((retry: boolean) => void) | null = null;
let seq = 0;

function set(next: VerifyState | null) { state = next; for (const l of listeners) l(); }
export const verifyStore = {
  get: () => state,
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  /** Bouton « Réessayer » / « Recommencer » (true) ou « Fermer » / Échap (false). */
  answer(retry: boolean) { const d = decide; decide = null; d?.(retry); },
};

/** L'utilisateur a fermé la vérification : l'action est abandonnée sans message d'erreur. */
export class VerificationCancelled extends ApiError {
  // 499 (requête abandonnée par le client) : ni « réseau » (0) ni « serveur » (5xx) pour les messages des pages.
  constructor() { super(499, "verification_cancelled", "Vérification annulée\u00a0: tu peux réessayer quand tu veux."); }
}

// ---- résolution du défi (widget Cap officiel, @cap.js/widget, chargé à la demande) ---------------------------------

interface CapInstance {
  solve(): Promise<{ success: boolean; token: string } | undefined>;
  addEventListener(type: string, fn: (e: Event) => void): void;
  widget: HTMLElement;
}
type CapCtor = new (config: Record<string, string>) => CapInstance;

async function solve(endpoint: string, onProgress: (p: number) => void): Promise<string> {
  const w = window as unknown as Record<string, unknown>;
  // WebAssembly servi par le site (CSP : connect-src 'self'), jamais un CDN ; journal du widget coupé.
  w.CAP_CUSTOM_WASM_URL = "/cap/wasm/cap_wasm_bg.wasm";
  w.CAP_CUSTOM_HASHWX_URL = "/cap/wasm/hashwx.wasm";
  w.CAP_SILENT = true;
  await import("@cap.js/widget");
  const Cap = w.Cap as CapCtor | undefined;
  if (!Cap) throw new Error("widget indisponible");
  const cap = new Cap({ apiEndpoint: endpoint });
  cap.addEventListener("progress", (e) => onProgress(Number((e as CustomEvent<{ progress: number }>).detail?.progress) || 0));
  try {
    const r = await cap.solve();
    if (!r?.success || !r.token) throw new Error("défi non résolu");
    return r.token;
  } finally {
    cap.widget.remove();
  }
}

// ---- parcours ---------------------------------------------------------------------------------------------------

const challengeOf = (e: unknown): Challenge | null => {
  if (!(e instanceof ApiError) || e.code !== "challenge_required") return null;
  const c = (e.data?.challenge ?? null) as Challenge | null;
  return c && typeof c.ticket === "string" && typeof c.endpoint === "string" && c.endpoint.startsWith("/cap/") ? c : null;
};

const ask = () => new Promise<boolean>((resolve) => { decide = resolve; });

/**
 * Exécute une action du site ; si le serveur exige une vérification, la fait (interface AETHRYON) et rejoue l'action
 * avec la preuve. `run` reçoit les en-têtes à transmettre à api(). Renvoie le résultat de l'action, ou lève l'erreur
 * de l'action elle-même (ex. mot de passe incorrect) une fois la vérification acceptée.
 */
export async function verified<T>(run: (v: VerifyInit) => Promise<T>): Promise<T> {
  let challenge: Challenge | null;
  try {
    return await run({});
  } catch (e) {
    challenge = challengeOf(e);
    if (!challenge) throw e;
  }
  const id = ++seq;
  for (;;) {
    const started = Date.now();
    set({ phase: "verifying", progress: 0, slow: false, message: null, id });
    // « Un instant, notre gardienne veille. » seulement si la preuve prend réellement plus d'une seconde.
    const slowTimer = window.setTimeout(() => { if (state?.id === id && state.phase === "verifying") set({ ...state, slow: true }); }, 1000);
    let failure: unknown = null;
    let token: string | null = null;
    try {
      token = await solve(challenge.endpoint, (p) => { if (state?.id === id && state.phase === "verifying") set({ ...state, progress: p }); });
    } catch (e) { failure = e; }
    if (token && Date.now() - started > challenge.expiresInSeconds * 1000) failure = new ApiError(403, "challenge_expired", "");
    if (token && !failure) {
      let confirmed = false;
      try {
        const value = await run({
          headers: { "x-aethryon-challenge": challenge.ticket, "x-aethryon-verification": token },
          onResponse: (res) => { confirmed = res.headers.get("x-aethryon-verification") === "ok"; },
        });
        window.clearTimeout(slowTimer);
        // Réussite montrée SEULEMENT si le serveur l'a confirmée ; l'action continue sans attendre l'animation.
        set(confirmed ? { phase: "success", progress: 100, slow: false, message: null, id } : null);
        return value;
      } catch (e) {
        window.clearTimeout(slowTimer);
        if (confirmed) {
          // Vérification acceptée, l'action elle-même a échoué (ex. mot de passe incorrect) : la page l'affiche.
          set({ phase: "success", progress: 100, slow: false, message: null, id });
          throw e;
        }
        const next = challengeOf(e);
        if (next) { challenge = next; continue; } // le serveur demande un nouveau défi : on recommence aussitôt
        failure = e;
      }
    }
    window.clearTimeout(slowTimer);
    const code = failure instanceof ApiError ? failure.code : "solve_failed";
    const phase: VerifyPhase = code === "challenge_expired" ? "expired" : code === "temporarily_blocked" ? "blocked"
      : code === "verification_unavailable" || (failure instanceof ApiError && failure.isNetwork) || !navigator.onLine ? "unavailable" : "failed";
    set({ phase, progress: 0, slow: false, message: failure instanceof ApiError && failure.message ? failure.message : null, id });
    if (phase === "blocked") { await ask(); set(null); throw failure; }
    if (!(await ask())) { set(null); throw new VerificationCancelled(); }
    // Nouvelle tentative : l'action est rejouée sans preuve → le serveur émet un ticket neuf (ou n'exige plus rien).
    try {
      const value = await run({});
      set(null);
      return value;
    } catch (e) {
      const c = challengeOf(e);
      if (!c) { set(null); throw e; }
      challenge = c;
    }
  }
}

/** Fin de l'affichage de réussite (appelée par l'interface quand la transition de sortie est terminée). */
export function verifyDone(id: number) { if (state?.id === id) set(null); }
