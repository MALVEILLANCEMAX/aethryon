// /convert pour un compte lié (docs/DISCORD-BOT.md §5 et §17), sans discord.js (testable avec de faux clients) :
//   1. clé ytc_ « discord » de 15 min demandée à account (non lié → invitation à lier ; suspendu, pause… → refus) ;
//   2. POST /jobs à ytapi avec cette clé (ytapi réserve l'unité de quota du compte via account ; 401 : une
//      seule nouvelle clé, puis abandon) ;
//   3. suivi par long polling (GET /jobs/{id}?wait=20) et UN SEUL message modifié : seulement quand l'état
//      change ou que la progression RÉELLE franchit un palier de 25 %, et au plus une fois toutes les 5 s ;
//   4. terminé : lien de téléchargement à usage unique (10 min) créé par account ; le bot n'envoie jamais de
//      fichier dans Discord ; échec : texte du catalogue (docs/ERREURS.md) et code ;
//   5. vers 14 min (fenêtre de 15 min du jeton d'interaction), dernier message « La conversion continue… » ;
//   6. dans tous les cas, la clé est rendue à account (révoquée).
// Jamais journalisé ni affiché : le lien de la vidéo, son titre, le nom du fichier, la clé, le lien de téléchargement.
import { AccountError, type AccountClient, type SessionKey } from "./account.ts";
import { YtapiError, type DeriveParams, type Job, type JobParams, type YtapiClient } from "./ytapi.ts";
import { doneReply, errorReply, notLinkedReply, queuedReply, runningReply, windowClosedReply, type AnyReply } from "./replies.ts";

export const WINDOW_MS = 14 * 60_000;
export const MIN_EDIT_MS = 5000;
/** Le dernier message (terminé, échec) part vite : au plus une seconde après la modification précédente. */
export const FINAL_MIN_EDIT_MS = 1000;
export const POLL_WAIT_S = 20;
/** Échecs passagers d'affilée tolérés pendant le suivi (ytapi injoignable, limite de débit) avant d'abandonner. */
export const MAX_POLL_FAILURES = 6;

export type OutFmt = "mp3" | "mp4" | "gif";

export interface ConvertDeps {
  account: Pick<AccountClient, "session" | "release" | "download">;
  ytapi: Pick<YtapiClient, "createJob" | "job"> & Partial<Pick<YtapiClient, "derive">>;
  /** Modifie le message d'origine (réponse différée éphémère) ; une erreur de Discord n'arrête pas le suivi. */
  edit: (reply: AnyReply) => Promise<unknown>;
  /** Version 2 : rendu des étapes (cartes Components V2) ; par défaut, les embeds de replies.ts. */
  render?: Partial<Render>;
  /** Version 2 : livraison du résultat (pièce jointe, boutons) ; null → lien de téléchargement à usage unique. */
  deliver?: (job: Job, keyRef: { key: string }) => Promise<AnyReply | null>;
  siteUrl: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  windowMs?: number;
  minEditMs?: number;
  pollWaitS?: number;
  /** Erreur de modification du message (journal du bot, sans contenu). */
  onEditError?: (e: unknown) => void;
  /** Version 2 : carte de secours si Discord refuse la carte finale (ex. composant invalide, pièce jointe refusée). */
  fallback?: (job: Job) => Promise<AnyReply | null>;
}

export interface ConvertRequest {
  discordUserId: string; url: string; fmt: OutFmt; startedAt: number; params?: JobParams;
  /** Version 2 : fichier dérivé (compression, GIF), fait par ytapi APRÈS le job créé ici, ou à partir de `deriveFrom`. */
  derive?: DeriveParams;
  /** Version 2 : job MP4 déjà terminé du même compte (bouton « Compresser ») : ni nouveau job ni unité de quota. */
  deriveFrom?: string;
}
export interface Render {
  queued(fmt: OutFmt): AnyReply;
  running(fmt: OutFmt, progress: number | null, stage: string | null): AnyReply;
  notLinked(): AnyReply;
  /** `retryAfterS` : pause imposée par la plateforme (ytapi : Retry-After / retry_after_s), pour annoncer l'heure de reprise. */
  error(code: string, retryAfterS?: number | null): AnyReply;
  windowClosed(): AnyReply;
}
export interface Outcome { outcome: "done" | "error" | "refused" | "not_linked" | "window_closed"; code?: string; retryAfterS?: number | null; edits: number }

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const TRANSIENT: ReadonlySet<string> = new Set(["api_unreachable", "upstream_timeout_api", "rate_limited", "auth_unavailable", "server_busy"]);

/** Message unique : signature d'état (état + palier de 25 %), au plus une modification par intervalle. */
class Editor {
  private last = -Infinity;
  private sig = "";
  edits = 0;
  private d: ConvertDeps;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private minMs: number;
  constructor(d: ConvertDeps) {
    this.d = d; this.now = d.now ?? Date.now; this.sleep = d.sleep ?? realSleep; this.minMs = d.minEditMs ?? MIN_EDIT_MS;
  }
  private async send(reply: AnyReply, sig: string): Promise<boolean> {
    let ok = true;
    try {
      await this.d.edit(reply);
      this.edits++;
    } catch (e) {
      ok = false;
      this.d.onEditError?.(e);
    }
    this.sig = sig;
    this.last = this.now();
    return ok;
  }
  /** État intermédiaire : ignoré s'il ne change rien de visible ou s'il arrive trop tôt. */
  async progress(reply: AnyReply, sig: string) {
    if (sig === this.sig || this.now() - this.last < this.minMs) return;
    await this.send(reply, sig);
  }
  /** État final : toujours envoyé, au plus tôt une seconde après la modification précédente ; false si Discord l'a refusé. */
  async final(reply: AnyReply, sig: string): Promise<boolean> {
    const gap = Math.min(FINAL_MIN_EDIT_MS, this.minMs);
    const wait = gap - (this.now() - this.last);
    if (wait > 0) await this.sleep(wait);
    return this.send(reply, sig);
  }
}

const bucket = (p: number | null) => (p === null ? -1 : Math.floor(p / 25));
function interim(job: Job, fmt: OutFmt, r: Render, step: string): { reply: AnyReply; sig: string } {
  return job.status === "queued"
    ? { reply: r.queued(fmt), sig: `${step}queued` }
    : { reply: r.running(fmt, job.progress, job.stage), sig: `${step}running:${bucket(job.progress)}` };
}

export async function runConversion(d: ConvertDeps, req: ConvertRequest): Promise<Outcome> {
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? realSleep;
  const deadline = req.startedAt + (d.windowMs ?? WINDOW_MS);
  const editor = new Editor(d);
  const site = d.siteUrl;
  const done = (o: Omit<Outcome, "edits">): Outcome => ({ ...o, edits: editor.edits });
  const r: Render = {
    queued: (fmt) => queuedReply(fmt === "gif" ? "mp4" : fmt),
    running: (fmt, p) => runningReply(fmt === "gif" ? "mp4" : fmt, p),
    notLinked: () => notLinkedReply(site),
    error: (code) => errorReply(code, site),
    windowClosed: () => windowClosedReply(site),
    ...d.render,
  };

  // 1. Clé de conversion du compte lié.
  const session = async (): Promise<SessionKey | Outcome> => {
    try {
      return await d.account.session(req.discordUserId);
    } catch (e) {
      const code = e instanceof AccountError ? e.code : "link_unavailable";
      if (code === "not_linked") { await editor.final(r.notLinked(), "not_linked"); return done({ outcome: "not_linked", code }); }
      await editor.final(r.error(code), `error:${code}`);
      return done({ outcome: "refused", code });
    }
  };
  const firstKey = await session();
  if ("outcome" in firstKey) return firstKey;
  let key: SessionKey = firstKey;
  const keys: SessionKey[] = [key];

  try {
    // 2. Création du job (une seule nouvelle clé si ytapi refuse la première, ex. révoquée entre-temps) : nouvelle
    //    conversion, ou fichier dérivé d'une conversion terminée (deriveFrom : compression, sans unité de quota).
    const derive = (k: string, from: string): Promise<Job> => {
      if (!d.ytapi.derive || !req.derive) return Promise.reject(new YtapiError("tools_unavailable", 0));
      return d.ytapi.derive(k, from, req.derive);
    };
    const create = (k: string) => (req.deriveFrom ? derive(k, req.deriveFrom) : d.ytapi.createJob(k, req.url, req.params ?? (req.fmt === "gif" ? "mp4" : req.fmt)));
    let job: Job;
    try {
      job = await create(key.key);
    } catch (e) {
      if (!(e instanceof YtapiError && e.code === "unauthorized")) throw e;
      await d.account.release(req.discordUserId, key.keyId);
      const again = await session();
      if ("outcome" in again) return again;
      key = again;
      keys.push(again);
      job = await create(key.key);
    }

    // 3. Suivi (deux étapes pour un GIF : la conversion MP4, puis le GIF tiré de son fichier).
    const follow = async (j: Job, step: string): Promise<Job | Outcome> => {
      let failures = 0;
      while (j.status === "queued" || j.status === "running") {
        const shown = interim(j, req.fmt, r, step);
        await editor.progress(shown.reply, shown.sig);
        const left = deadline - now();
        if (left <= 0) {
          await editor.final(r.windowClosed(), "window");
          return done({ outcome: "window_closed" });
        }
        try {
          j = await d.ytapi.job(key.key, j.id, Math.max(1, Math.min(d.pollWaitS ?? POLL_WAIT_S, Math.floor(left / 1000))));
          failures = 0;
        } catch (e) {
          const code = e instanceof YtapiError ? e.code : "api_unreachable";
          if (!TRANSIENT.has(code) || ++failures > MAX_POLL_FAILURES) throw e instanceof YtapiError ? e : new YtapiError(code, 0);
          const retry = e instanceof YtapiError && e.retryAfterS ? Math.min(e.retryAfterS, 30) * 1000 : 5000;
          await sleep(Math.min(retry, Math.max(0, deadline - now())));
        }
      }
      if (j.status === "error") {
        const code = j.error ?? "upstream_error";
        const retryAfterS = j.retryAfterS ?? null;
        await editor.final(r.error(code, retryAfterS), `error:${code}`);
        return done({ outcome: "error", code, retryAfterS });
      }
      return j;
    };
    const first = await follow(job, "");
    if ("outcome" in first) return first;
    job = first;
    if (req.derive && !req.deriveFrom) {
      const second = await follow(await derive(key.key, job.id), "derive:");
      if ("outcome" in second) return second;
      job = second;
    }

    // 4. Terminé. Version 2 : livraison par l'appelant (pièce jointe si elle tient, boutons) ; sinon, ou à défaut,
    //    lien de téléchargement à usage unique créé par account.
    if (d.deliver) {
      let delivered: AnyReply | null = null;
      try { delivered = await d.deliver(job, key); } catch { delivered = null; }
      if (delivered) {
        if (await editor.final(delivered, "done")) return done({ outcome: "done" });
        // Carte refusée par Discord : secours minimal (lien de téléchargement), pour que le fichier arrive quand même.
        const fb = d.fallback ? await d.fallback(job).catch(() => null) : null;
        if (fb && await editor.final(fb, "done:secours")) return done({ outcome: "done", code: "secours" });
        return done({ outcome: "error", code: "discord_refused" });
      }
    }
    let url: string;
    try {
      url = (await d.account.download(req.discordUserId, job.id)).url;
    } catch {
      await editor.final(r.error("link_not_created"), "error:link");
      return done({ outcome: "error", code: "link_not_created" });
    }
    await editor.final(doneReply(site, req.fmt === "gif" ? "mp4" : req.fmt, job.platform, url), "done");
    return done({ outcome: "done" });
  } catch (e) {
    const code = e instanceof YtapiError ? e.code : "internal_error";
    // Refus immédiat de ytapi pendant une pause YouTube (503 + Retry-After) : aucune requête vers YouTube, unité rendue.
    const retryAfterS = e instanceof YtapiError ? e.retryAfterS : null;
    await editor.final(r.error(code, retryAfterS), `error:${code}`);
    return done({ outcome: "error", code, retryAfterS });
  } finally {
    // 6. Toutes les clés demandées sont rendues (elles expireraient de toute façon en 15 min).
    for (const k of keys) await d.account.release(req.discordUserId, k.keyId);
  }
}
