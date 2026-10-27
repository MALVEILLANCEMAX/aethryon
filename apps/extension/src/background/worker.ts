// Service worker AETHRYON : routeur des messages internes, connexion au compte, suivi des jobs, notice sur les
// données (accord avant toute requête), avis de nouvelle version, page d'accueil au premier lancement.
// Tout est créé par createWorker() (état en mémoire perdu à chaque arrêt du worker, reconstruit depuis
// storage.session au démarrage) ; index.ts l'installe au premier tour de boucle (exigence MV3).
import { API_BASE, AUTH_REDIRECT_PATH, SITE_BASE, VERSION, WELCOME_PATH } from "../shared/config.ts";
import { clearConsent, CONSENT_VERSION, consentOutdated, getConsent, setConsent } from "../shared/consent.ts";
import {
  FRAME_DATA_MAX, isExtensionPage, parseBgRequest, parsePlayerState, type BgRequest, type BgResponse, type FrameGrab, type FrameSave, type PageEvent,
  type PlayerRequest, type PlayerState, type PopupInit, type TabMessage, type ThumbSave, type ToolsOpen, type WelcomeSection,
} from "../shared/messages.ts";
import { parseLimits, type ClipLimits, type LimitsView } from "../shared/limites.ts";
import { clearAuth, clearNotice, getAuth, getNotice, getSettings, getStoredAuth, isExpired, setAuth, setNotice } from "../shared/storage.ts";
import type { AccountView, AuthNotice, ConsentView, Degraded, DesktopUpdateResult, JobError, JobView, LoadHint, UpdateNotice } from "../shared/types.ts";
import { DESKTOP_HOST } from "../shared/desktop.ts";
import { HINT_KEY, parseHint, parsePending, RELOAD_KEY, reloadOutcome, runDesktopUpdate } from "./desktop-update.ts";
import type { NativePort } from "./desktop.ts";
import { parseMediaUrl, platformOfHost, type Platform } from "../shared/urls.ts";
import { authorizeUrl, classifyWebAuthFlowError, deviceLabel, parseMe, parseRedirect, parseTokenResponse, randomB64url, s256, webAuthFlowError } from "./auth.ts";
import { captureRegion, isPngDataUrl } from "./capture.ts";
import { detectActiveTab } from "./detect.ts";
import {
  authRequired, BgError, consentRequired, isObj, jobError, loginPageError, lostMessage, lostReason, MSG, tokenExchangeError,
} from "./errors.ts";
import { http, type FetchFn, type HttpResult } from "./http.ts";
import { ALARM, createJobManager, thumbSources } from "./jobs.ts";
import { clearAccountCache, readAccountCache, writeAccountCache } from "./store.ts";
import { DEFAULT_TIMING, type Timing } from "./timing.ts";
import { checkForUpdate, CHECK_INTERVAL_MS, clearUpdateState, compareVersions, dismissUpdate, isDue, noticeFor, readUpdateState, UPDATE_ALARM } from "./update.ts";

export type Sender = { kind: "page" } | { kind: "content"; tabId: number; platform: Platform };

/**
 * Qui parle ? Une page de l'extension (popup ; réglages et accueil, ouverts DANS UN ONGLET), ou notre
 * content script dans le cadre principal d'un onglet d'une plateforme prise en charge (https). Tout le reste
 * (autre extension, autre site, sous-cadre) : null.
 */
export function classifySender(sender: chrome.runtime.MessageSender | undefined, extensionId: string): Sender | null {
  if (!sender || sender.id !== extensionId || typeof sender.url !== "string") return null;
  const extOrigin = `chrome-extension://${extensionId}`;
  // isExtensionPage accepte aussi les pages ouvertes dans un onglet ; l'origine, quand Chrome la fournit,
  // doit être la nôtre.
  if (isExtensionPage(sender, extensionId)) return sender.origin === undefined || sender.origin === extOrigin ? { kind: "page" } : null;
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number" || tabId < 0) return null;
  if (sender.frameId !== undefined && sender.frameId !== 0) return null;
  let u: URL;
  try {
    u = new URL(sender.url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const platform = platformOfHost(u.hostname);
  if (!platform) return null;
  if (sender.origin !== undefined && sender.origin !== u.origin) return null;
  return { kind: "content", tabId, platform };
}

/**
 * Ce qu'un content script peut demander : ses téléchargements, la connexion (bouton « Se connecter à
 * AETHRYON » de la page, réponse réduite à { connected }) et l'ouverture de la page d'accueil (notice).
 * Jamais : compte, déconnexion, accord, réglages.
 */
/** Police d'interface du menu injecté (Égide : Hanken Grotesk variable, OFL, copiée de design/fonts par la construction). */
export const POLICE_UI = "egide/fonts/hanken-grotesk-latin-wght-normal.woff2";

const CONTENT_ALLOWED: ReadonlySet<BgRequest["type"]> = new Set([
  "job.start", "job.retry", "job.cancel", "jobs.list", "auth.login", "welcome.open", "frame.save", "thumb.save", "tools.open",
  // V3.5 : capacités (Tools ouvert, plateformes en pause : rien du compte) ; « Afficher » d'un fichier de CET onglet.
  "caps.get", "download.show",
  // 3.6.0 : limites des extraits annoncées par le serveur, et le reste du quota du jour (deux nombres, rien d'autre).
  "limits.get",
  // 3.9.0 (Égide) : police d'interface du menu (fichier de l'extension, identique pour tous ; rien du compte).
  "egide.police",
]);

/** Réponse (non fiable) d'un content script à « frame.grab » → forme vérifiée, ou null. */
export function parseGrab(raw: unknown): FrameGrab | null {
  if (!isObj(raw)) return null;
  const num = (v: unknown, max = 100_000): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;
  const at = num(raw.at, 86_400) ? raw.at : undefined;
  if (raw.ok === true) {
    if (typeof raw.dataUrl !== "string" || raw.dataUrl.length > FRAME_DATA_MAX || !num(raw.width) || !num(raw.height)) return null;
    return { ok: true, dataUrl: raw.dataUrl, width: raw.width, height: raw.height, at: at ?? 0 };
  }
  if (raw.ok !== false || !["no_video", "not_ready", "tainted", "drm"].includes(String(raw.reason))) return null;
  const out: FrameGrab = { ok: false, reason: raw.reason as "no_video" | "not_ready" | "tainted" | "drm" };
  const r = raw.rect;
  if (isObj(r) && num(r.x) && num(r.y) && num(r.width) && num(r.height) && r.width > 0 && r.height > 0) out.rect = { x: r.x, y: r.y, width: r.width, height: r.height };
  const v = raw.viewport;
  if (isObj(v) && num(v.width) && num(v.height) && v.width > 0 && v.height > 0) out.viewport = { width: v.width, height: v.height };
  if (at !== undefined) out.at = at;
  return out;
}

export function isAllowed(type: BgRequest["type"], who: Sender): boolean {
  return who.kind === "page" || CONTENT_ALLOWED.has(type);
}

export interface WorkerOptions {
  fetch?: FetchFn;
  timing?: Partial<Timing>;
}

export type Worker = ReturnType<typeof createWorker>;

/** Version installée (manifeste) : seule référence pour l'avis de nouvelle version. */
function installedVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return VERSION;
  }
}

function quiet(fn: () => unknown): void {
  try {
    const p = fn();
    if (p && typeof (p as Promise<unknown>).catch === "function") (p as Promise<unknown>).catch(() => undefined);
  } catch { /* aucun destinataire */ }
}

export function createWorker(opts: WorkerOptions = {}) {
  let alive = true;
  // Appel via globalThis (un fetch détaché de son objet lève « Illegal invocation »).
  const fetchFn: FetchFn = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const T: Timing = { ...DEFAULT_TIMING, ...opts.timing };

  let authChain: Promise<unknown> = Promise.resolve();
  function authLocked<R>(fn: () => Promise<R>): Promise<R> {
    const run = authChain.then(fn, fn);
    authChain = run.catch(() => undefined);
    return run;
  }

  /** Annonce aux pages ouvertes de l'extension (popup, réglages, accueil) ; jamais aux onglets des sites. */
  function pageEvent(e: PageEvent): void {
    if (alive) quiet(() => chrome.runtime.sendMessage(e));
  }

  const consented = async (): Promise<boolean> => !!(await getConsent());

  /**
   * Clé refusée (401) : la liaison est effacée — sauf si une nouvelle connexion l'a déjà remplacée —, la liste
   * des téléchargements et l'état du compte aussi, et le MOTIF est gardé pour être dit (popup, réglages,
   * erreur du job, bouton de la page) jusqu'à la prochaine connexion ; les pages ouvertes l'apprennent aussitôt.
   * `refusal` : corps du 401 de /api/extension/me quand il est connu ; sinon (401 de ytapi), le motif est
   * demandé à /me (une requête) : révoquée (par qui), expirée, inconnue. Si le compte accepte encore la
   * clé, la liaison est gardée (refus passager du service de conversion). Renvoie l'erreur à montrer.
   */
  async function onUnauthorized(token: string, refusal?: unknown): Promise<JobError> {
    if (!alive) return authRequired();
    const stored = await getStoredAuth();
    let reason = lostReason(refusal);
    if (!reason && stored?.token === token && isExpired(stored)) reason = "expired";
    if (!reason) {
      let res: HttpResult | null;
      try {
        res = await http(fetchFn, `${SITE_BASE}/api/extension/me`, { token, timeoutMs: T.accountTimeoutMs });
      } catch {
        res = null;
      }
      if (res?.status === 200) return jobError("unauthorized", MSG.tokenRefused, true);
      if (res?.status === 403 && isObj(res.body) && res.body.error === "account_suspended") return jobError("account_suspended", MSG.suspended, false);
      reason = (res && lostReason(res.body)) ?? "invalid";
    }
    const notice: AuthNotice = { reason, message: lostMessage(reason), at: Date.now() };
    const error = jobError("auth_required", notice.message, false);
    if (!alive) return error;
    const cleared = await authLocked(async () => {
      const current = await getStoredAuth();
      if (current && current.token !== token) return false;
      await clearAuth();
      await clearAccountCache();
      await setNotice(notice);
      return true;
    });
    if (cleared) {
      await jobs.signOut({ error });
      pageEvent({ type: "auth.changed", connected: false, reason, message: notice.message });
    }
    return error;
  }

  /** Aucune liaison utilisable : erreur avec le motif connu (liaison expirée, refus précédent), sinon « connecte-toi ». */
  async function authLost(): Promise<JobError> {
    const stored = await getStoredAuth();
    if (stored && isExpired(stored)) return onUnauthorized(stored.token, { error: "token_expired" });
    const n = await getNotice();
    return n ? jobError("auth_required", n.message, false) : authRequired();
  }

  /** Vue « non connecté », avec le motif de la dernière déconnexion imposée s'il y en a un. */
  async function disconnected(): Promise<AccountView> {
    const notice = await getNotice();
    return notice ? { connected: false, notice } : { connected: false };
  }

  const jobs = createJobManager({ fetch: fetchFn, timing: T, alive: () => alive, onUnauthorized: (t) => onUnauthorized(t), authLost, consented });

  // Dernière vidéo détectée par onglet (popup.init) : un job lancé du popup pour CETTE vidéo envoie aussi
  // sa progression au bouton de la page.
  const detected = new Map<number, string>();
  function rememberDetected(tabId: number, url: string): void {
    detected.delete(tabId);
    detected.set(tabId, url);
    while (detected.size > 20) detected.delete(detected.keys().next().value as number);
  }

  // ---- compte -------------------------------------------------------------------------------------
  /**
   * Vue du compte ; null = clé refusée à l'instant (401 ou expiration : liaison effacée, motif gardé).
   * `network: false` (notice pas encore acceptée) : seulement ce qui est connu localement, AUCUNE requête.
   * Service injoignable ou en erreur : `degraded` (jamais un « Connecté » trompeur), dernier état connu
   * marqué `stale` s'il existe.
   */
  async function account(timeoutMs: number, { network = true } = {}): Promise<AccountView | null> {
    const auth = await getStoredAuth();
    if (!auth) return disconnected();
    if (isExpired(auth)) {
      await onUnauthorized(auth.token, { error: "token_expired" });
      return null;
    }
    const base: AccountView = { connected: true };
    if (auth.email) base.email = auth.email;
    if (auth.name) base.name = auth.name;
    if (auth.expiresAt) base.expiresAt = auth.expiresAt;
    const cache = await readAccountCache(auth);
    const known = (): AccountView => ({ ...base, ...(cache ?? {}), connected: true, ...(cache ? { stale: true } : {}) });
    const degraded = (d: Degraded): AccountView => ({ ...known(), degraded: d });
    if (!network) return known();
    let res: HttpResult;
    try {
      res = await http(fetchFn, `${SITE_BASE}/api/extension/me`, { token: auth.token, timeoutMs });
    } catch {
      return degraded({ reason: "network" });
    }
    if (res.status === 401) {
      await onUnauthorized(auth.token, res.body);
      return null;
    }
    // Compte suspendu par un administrateur : la clé reste valable (réactivation = l'extension remarche).
    if (res.status === 403 && isObj(res.body) && res.body.error === "account_suspended") return { ...known(), suspended: true };
    if (res.status === 200) {
      const me = parseMe(res.body);
      if (me) {
        const view: AccountView = { ...base, ...me, connected: true };
        if (alive) await writeAccountCache(auth, view);
        return view;
      }
      return degraded({ reason: "unexpected", status: 200 });
    }
    // 404 : le service de l'extension n'existe pas (ou plus) sur ce serveur — pas encore déployé, retour arrière.
    if (res.status === 404) return degraded({ reason: "missing", status: 404 });
    if (res.status === 429 || res.status >= 500) return degraded({ reason: "unavailable", status: res.status });
    return degraded({ reason: "unexpected", ...(res.status ? { status: res.status } : {}) });
  }

  let loginInFlight: Promise<AccountView> | null = null;
  function login(): Promise<AccountView> {
    loginInFlight ??= doLogin().finally(() => {
      loginInFlight = null;
    });
    return loginInFlight;
  }

  /**
   * La connexion n'a pas abouti : la fenêtre n'a pas pu charger la page (Chrome donne le même message pour un
   * réseau coupé et pour une réponse HTTP en erreur), ou l'utilisateur l'a fermée — peut-être devant une page
   * d'erreur (hors ligne, serveur en panne). Une requête simple vers la page dit laquelle : rien (réseau),
   * 404 (service pas encore déployé), 5xx (indisponible). Aucune donnée envoyée.
   */
  async function probeLoginPage(): Promise<number | "network"> {
    try {
      const r = await http(fetchFn, `${SITE_BASE}/extension/autoriser`, { timeoutMs: T.accountTimeoutMs });
      return r.status === 0 ? 200 : r.status; // 0 : redirection (refusée) — la page répond
    } catch {
      return "network";
    }
  }

  /** Échec de launchWebAuthFlow → la cause à dire. */
  async function loginWindowError(e: unknown): Promise<JobError> {
    const kind = classifyWebAuthFlowError(e);
    if (kind === "other") return webAuthFlowError("other");
    const probe = await probeLoginPage();
    if (kind === "page") return loginPageError(probe);
    // Fenêtre fermée : « Connexion annulée. », sauf si la page ne pouvait de toute façon pas aboutir.
    return probe === "network" || probe === 404 || probe === 429 || probe >= 500 ? loginPageError(probe) : webAuthFlowError("cancelled");
  }

  async function doLogin(): Promise<AccountView> {
    if (!(await consented())) throw new BgError(consentRequired(await consentOutdated()));
    const redirectUri = chrome.identity.getRedirectURL(AUTH_REDIRECT_PATH);
    const state = randomB64url(32);
    const verifier = randomB64url(32);
    const challenge = await s256(verifier);
    const url = authorizeUrl(SITE_BASE, redirectUri, state, challenge, deviceLabel());
    let responseUrl: string | undefined;
    try {
      responseUrl = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    } catch (e) {
      throw new BgError(await loginWindowError(e));
    }
    const r = parseRedirect(responseUrl, redirectUri, state);
    if ("error" in r) throw new BgError(r.error);
    let res: HttpResult;
    try {
      res = await http(fetchFn, `${SITE_BASE}/api/extension/token`, {
        method: "POST", json: { code: r.code, code_verifier: verifier, redirect_uri: redirectUri }, timeoutMs: T.requestTimeoutMs,
      });
    } catch {
      throw new BgError(jobError("network", MSG.loginNetwork, true));
    }
    const grant = res.status === 200 ? parseTokenResponse(res.body) : null;
    if (!grant) throw new BgError(res.status === 200 ? jobError("auth_failed", MSG.loginFailed, true) : tokenExchangeError(res.status, res.body));
    if (!alive) throw new BgError(jobError("auth_failed", MSG.loginFailed, true));
    const previous = await authLocked(async () => {
      const old = await getAuth();
      await clearAccountCache();
      await setAuth({ token: grant.token, expiresAt: grant.expiresAt, email: grant.email, name: grant.name, linkedAt: new Date().toISOString() });
      await clearNotice();
      return old;
    });
    // Nouvelle liaison sur cet appareil : l'ancienne clé d'extension est révoquée (pas de clés oubliées).
    if (previous && previous.token !== grant.token) await revoke(previous.token);
    pageEvent({ type: "auth.changed", connected: true, reason: "linked" });
    return (await account(T.popupAccountTimeoutMs)) ?? { connected: false };
  }

  async function revoke(token: string): Promise<void> {
    try {
      await http(fetchFn, `${SITE_BASE}/api/extension/logout`, { method: "POST", token, timeoutMs: T.logoutTimeoutMs });
    } catch { /* hors ligne : la clé reste révocable depuis « Mes jetons » */ }
  }

  /** Déconnexion voulue : conversions arrêtées, clé révoquée, liaison, liste et état du compte effacés. */
  async function logout(reason: "signed_out" | "withdrawn" = "signed_out"): Promise<AccountView> {
    const auth = await getAuth();
    await jobs.signOut(auth ? { cancelWith: auth.token } : {});
    if (auth) await revoke(auth.token);
    await authLocked(async () => {
      await clearAuth();
      await clearAccountCache();
      await clearNotice(); // déconnexion voulue : aucun motif à montrer
    });
    pageEvent({ type: "auth.changed", connected: false, reason });
    return { connected: false };
  }

  // ---- notice sur les données ---------------------------------------------------------------------
  async function consentView(): Promise<ConsentView> {
    const c = await getConsent();
    if (c) return { accepted: true, version: CONSENT_VERSION, at: c.at };
    // Accord donné à une notice plus ancienne (mise à jour) : à relire, dit comme tel (pas « première connexion »).
    return (await consentOutdated()) ? { accepted: false, version: CONSENT_VERSION, outdated: true } : { accepted: false, version: CONSENT_VERSION };
  }

  async function acceptConsent(version: number): Promise<ConsentView> {
    // Accord donné à une AUTRE version de la notice (page restée ouverte pendant une mise à jour) : refusé.
    if (version !== CONSENT_VERSION) throw new BgError(jobError("consent_outdated", "La notice sur les données a changé : relis-la avant d'accepter.", false));
    const rec = await setConsent();
    void ensureUpdateAlarm();
    void updateCheck();
    return { accepted: true, version: CONSENT_VERSION, at: rec.at };
  }

  /** Accord retiré : déconnexion (clé révoquée), puis plus aucune requête ; état de mise à jour effacé. */
  async function withdrawConsent(): Promise<ConsentView> {
    await logout("withdrawn");
    await clearConsent();
    await clearUpdateState();
    return { accepted: false, version: CONSENT_VERSION };
  }

  // ---- page d'accueil -------------------------------------------------------------------------------
  let lastFromPage = 0;
  /** `fromContent` : demandé par le bouton d'une page web — un seul onglet par 1,5 s (page qui insisterait). */
  async function openWelcome(section?: WelcomeSection, fromContent = false): Promise<{ opened: boolean }> {
    if (fromContent) {
      const now = Date.now();
      if (now - lastFromPage < 1_500) return { opened: false };
      lastFromPage = now;
    }
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME_PATH) + (section ? `#${section}` : "") });
      return { opened: true };
    } catch {
      return { opened: false };
    }
  }

  // ---- avis de nouvelle version -------------------------------------------------------------------
  async function ensureUpdateAlarm(): Promise<void> {
    try {
      if (!(await chrome.alarms.get(UPDATE_ALARM))) {
        const minutes = CHECK_INTERVAL_MS / 60_000;
        await chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: minutes, periodInMinutes: minutes });
      }
    } catch { /* alarmes indisponibles : vérification au démarrage et à l'ouverture du popup */ }
  }

  let checking: Promise<void> | null = null;
  /** Vérification (seulement après l'accord, au plus une par 12 h) ; les pages ouvertes reçoivent l'avis. */
  function updateCheck(): Promise<void> {
    checking ??= (async () => {
      if (!alive || !(await consented())) return;
      const r = await checkForUpdate(fetchFn, installedVersion());
      if (r.checked) pageEvent({ type: "update.changed", update: r.notice });
    })().catch(() => undefined).finally(() => {
      checking = null;
    });
    return checking;
  }

  async function currentUpdate(): Promise<UpdateNotice | null> {
    const s = await readUpdateState();
    if (isDue(s, Date.now())) void updateCheck(); // popup ouvert : vérification si la dernière a plus de 12 h
    return noticeFor(s, installedVersion());
  }

  // ---- mise à jour en un clic par AETHRYON Desktop (desktop-update.ts) ------------------------------------
  async function readHint(): Promise<LoadHint | null> {
    try {
      return parseHint((await chrome.storage.local.get(HINT_KEY))[HINT_KEY]);
    } catch {
      return null;
    }
  }

  /** Au démarrage : rechargement demandé par une mise à jour → réussite, ou explication du chargement unique. */
  async function afterReload(): Promise<void> {
    try {
      const got = await chrome.storage.local.get([RELOAD_KEY, HINT_KEY]);
      const pending = parsePending(got[RELOAD_KEY]);
      const before = parseHint(got[HINT_KEY]);
      const r = reloadOutcome(pending, before, installedVersion());
      if (got[RELOAD_KEY] !== undefined) await chrome.storage.local.remove(RELOAD_KEY);
      if (r.hint) await chrome.storage.local.set({ [HINT_KEY]: r.hint });
      else if (got[HINT_KEY] !== undefined) await chrome.storage.local.remove(HINT_KEY);
      if (JSON.stringify(r.hint) !== JSON.stringify(before)) pageEvent({ type: "update.hint", hint: r.hint });
    } catch { /* stockage indisponible : rien à dire */ }
  }

  let installing: Promise<{ result: DesktopUpdateResult }> | null = null;
  /** Clic « Mettre à jour » (popup ou réglages, après la permission facultative) : Desktop fait le travail. */
  function installUpdate(version: string): Promise<{ result: DesktopUpdateResult }> {
    installing ??= (async () => {
      const current = installedVersion();
      if (compareVersions(version, current) !== 1) fail("update_none", "Cette version est déjà installée.");
      const step = (s: Parameters<NonNullable<Parameters<typeof runDesktopUpdate>[0]["onStep"]>>[0], done?: number, total?: number) =>
        pageEvent({ type: "update.progress", progress: { version, step: s, ...(done !== undefined ? { done } : {}), ...(total !== undefined ? { total } : {}) } });
      step("telechargement", 0);
      const rt = chrome.runtime as typeof chrome.runtime & { connectNative?: (n: string) => unknown };
      const result = await runDesktopUpdate({
        connect: () => (typeof rt.connectNative === "function" ? (rt.connectNative(DESKTOP_HOST) as NativePort) : null),
        version,
        onStep: (s, d, t) => step(s, d, t),
        lastError: () => chrome.runtime.lastError?.message,
        timeoutMs: T.updateTimeoutMs,
      });
      if (!result.ok) {
        pageEvent({ type: "update.progress", progress: null });
        return { result };
      }
      // Rechargement : la version attendue et le dossier sont notés pour le démarrage suivant (afterReload).
      await chrome.storage.local.set({ [RELOAD_KEY]: { from: current, to: result.version, folder: result.folder, at: Date.now() } });
      step("redemarrage");
      setTimeout(() => {
        try {
          chrome.runtime.reload();
        } catch { /* rechargement refusé : la page le dira au prochain démarrage */ }
      }, T.updateReloadDelayMs);
      return { result };
    })().finally(() => {
      installing = null;
    });
    return installing;
  }

  // ---- popup ----------------------------------------------------------------------------------------
  async function popupInit(): Promise<PopupInit> {
    const consent = await consentView();
    const [acc, det, list, settings, update, loadHint] = await Promise.all([
      account(T.popupAccountTimeoutMs, { network: consent.accepted }).then((a) => a ?? disconnected()),
      detectActiveTab(T.detectTimeoutMs),
      jobs.list(),
      getSettings(),
      consent.accepted ? currentUpdate() : Promise.resolve(null),
      readHint(),
    ]);
    if (det.tabId !== null && det.media) rememberDetected(det.tabId, det.media.url);
    return { account: acc, detected: det.media, pageHint: det.hint, jobs: list, settings, version: VERSION, consent, update, loadHint };
  }

  // ---- V3 : image de la vidéo, miniature, AETHRYON Tools ----------------------------------------------
  const fail = (code: string, message: string, retryable = false): never => { throw new BgError(jobError(code, message, retryable)); };

  function withTimeout<R>(p: Promise<R>, ms: number): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), ms);
      p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e); });
    });
  }

  /**
   * « Capturer l'image » (popup) : l'image courante de la vidéo de l'onglet actif, lue par la page à sa définition
   * réelle ; si la page ne peut pas la lire (vidéo d'une autre origine), capture de l'onglet recadrée sur la vidéo
   * (permise par le clic sur l'icône : « activeTab »). Vidéo protégée (DRM) : refus expliqué, jamais une image noire.
   */
  async function captureFrame(): Promise<JobView> {
    if (!(await consented())) throw new BgError(consentRequired(await consentOutdated()));
    const det = await detectActiveTab(T.detectTimeoutMs);
    if (det.tabId === null || !det.media) return fail("no_video", MSG.frameNoVideo);
    let raw: unknown = null;
    try {
      const msg: TabMessage = { type: "frame.grab" };
      raw = await withTimeout(chrome.tabs.sendMessage(det.tabId, msg, { frameId: 0 }), 10_000);
    } catch { /* pas de réponse : traité comme « aucune vidéo » */ }
    const g = parseGrab(raw);
    const media = { url: det.media.url, platform: det.media.platform, title: det.media.title, at: g?.at };
    if (g?.ok) {
      if (!isPngDataUrl(g.dataUrl)) return fail("frame_failed", MSG.frameFailed, true);
      return jobs.saveLocal("frame", { url: g.dataUrl }, media, { tabId: det.tabId });
    }
    if (!g || g.reason === "no_video") return fail("no_video", MSG.frameNoVideo);
    if (g.reason === "not_ready") return fail("not_ready", MSG.frameNotReady, true);
    if (g.reason === "drm") return fail("drm", MSG.frameBlack);
    if (!g.rect || !g.viewport) return fail("tainted", MSG.frameTainted);
    let windowId: number | undefined;
    try { windowId = (await chrome.tabs.get(det.tabId)).windowId; } catch { /* fenêtre courante */ }
    const shot = await captureRegion(windowId, g.rect, g.viewport).catch(() => null);
    if (shot === "black") return fail("drm", MSG.frameBlack);
    if (!shot) return fail("frame_failed", MSG.frameFailed, true);
    return jobs.saveLocal("frame", { url: shot }, media, { tabId: det.tabId });
  }

  /** Image envoyée par le bouton d'une page : PNG vérifié, vidéo de la plateforme de cette page seulement. */
  async function saveFrame(req: FrameSave, who: Extract<Sender, { kind: "content" }>): Promise<JobView> {
    const ref = parseMediaUrl(req.url);
    if (!ref || ref.platform !== who.platform) return fail("unsupported_url", MSG.wrongPage);
    if (!isPngDataUrl(req.dataUrl)) return fail("frame_failed", MSG.frameFailed, true);
    return jobs.saveLocal("frame", { url: req.dataUrl }, { url: ref.url, platform: ref.platform, title: req.title, at: req.at }, { tabId: who.tabId });
  }

  async function saveThumb(req: ThumbSave, who: Sender): Promise<JobView> {
    const ref = parseMediaUrl(req.url);
    if (!ref || (who.kind === "content" && ref.platform !== who.platform)) return fail("unsupported_url", MSG.unsupportedUrl);
    const src = thumbSources(req.thumbnail);
    if (!src) return fail("no_thumbnail", MSG.thumbMissing);
    return jobs.saveLocal("thumb", { url: src.primary, fallback: src.fallback }, { url: ref.url, platform: ref.platform, title: req.title },
      who.kind === "content" ? { tabId: who.tabId } : {});
  }

  /**
   * V3.5 : ce qu'un menu de page peut proposer, sans rien dire du compte. Tools : dernier état connu du compte
   * (inconnu → permis, le serveur reste juge) ; pauses : /api/status du site (public), relu au plus toutes les 60 s,
   * et seulement après l'accord sur la notice (aucune requête avant).
   */
  let pauses: { at: number; platforms: string[] } | null = null;
  /**
   * 3.9.0 (Égide) : police d'interface du menu injecté. Une racine Shadow DOM ne charge pas de @font-face, et un fichier
   * de l'extension n'est lisible par une page que s'il est exposé (web_accessible_resources, jamais ajouté : la page
   * pourrait alors détecter l'extension). Le service worker lit donc le fichier empaqueté et l'envoie en base 64 au
   * content script, qui le déclare par FontFace. Gardée en mémoire tant que le service worker vit.
   */
  let police: Promise<string> | null = null;
  function policeEgide(): Promise<string> {
    police ??= (async () => {
      const r = await fetchFn(chrome.runtime.getURL(POLICE_UI));
      if (!r.ok) throw new Error("police");
      const b = new Uint8Array(await r.arrayBuffer());
      let bin = "";
      for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return btoa(bin);
    })().catch((e: unknown) => { police = null; throw e; });
    return police;
  }

  /**
   * 3.9.0 : disponibilité RÉELLE des plateformes (GET <API>/platforms, route publique : aucune clé, rien du compte),
   * pour le catalogue du popup (une plateforme « prête à ouvrir » n'est utilisable que si le serveur la dit disponible).
   * Aucune requête avant l'accord sur la notice ; gardée 5 min ; sans réponse : null (le popup montre le catalogue seul).
   */
  let plateformesCache: { at: number; dispo: Record<string, boolean> } | null = null;
  async function plateformes(): Promise<Record<string, boolean> | null> {
    if (!(await consented())) return null;
    if (plateformesCache && Date.now() - plateformesCache.at < 5 * 60_000) return plateformesCache.dispo;
    try {
      const res = await http(fetchFn, `${API_BASE}/platforms`, { method: "GET", timeoutMs: 5_000 });
      const list = res.status === 200 && isObj(res.body) && Array.isArray(res.body.plateformes) ? res.body.plateformes : null;
      if (!list) return plateformesCache?.dispo ?? null;
      const dispo: Record<string, boolean> = {};
      for (const p of list.slice(0, 200)) {
        if (isObj(p) && typeof p.id === "string" && /^[a-z0-9_]{1,40}$/.test(p.id) && typeof p.disponible === "boolean") dispo[p.id] = p.disponible;
      }
      plateformesCache = { at: Date.now(), dispo };
      return dispo;
    } catch {
      return plateformesCache?.dispo ?? null;
    }
  }

  async function caps(): Promise<{ tools: boolean; paused: string[] }> {
    const auth = await getAuth();
    const cached = auth ? await readAccountCache(auth) : null;
    const tools = cached?.tools !== false;
    if (!(await consented())) return { tools, paused: [] };
    if (!pauses || Date.now() - pauses.at > 60_000) {
      try {
        const res = await http(fetchFn, `${SITE_BASE}/api/status`, { method: "GET", timeoutMs: 4_000 });
        const list = isObj(res.body) && Array.isArray(res.body.pauses) ? res.body.pauses : [];
        const platforms = list.flatMap((p: unknown) => (isObj(p) && typeof p.platform === "string" && typeof p.until === "string" && Date.parse(p.until) > Date.now() ? [p.platform] : []));
        pauses = { at: Date.now(), platforms: platforms.filter((p) => p === "youtube" || p === "tiktok" || p === "twitter").slice(0, 3) };
      } catch {
        pauses = { at: Date.now(), platforms: pauses?.platforms ?? [] };
      }
    }
    return { tools, paused: pauses.platforms };
  }

  /**
   * 3.6.0 : limites des extraits (GET <API>/limites, valeurs de configuration du serveur), gardées 60 s (15 s après un
   * échec), et le reste du quota du jour d'après le dernier état connu du compte. Aucune requête avant l'accord sur la
   * notice ; sans réponse exploitable (404 d'un serveur plus ancien, réseau), « indisponible » : rien n'est inventé.
   */
  let limitsCache: { at: number; limits: ClipLimits | null } | null = null;
  async function limits(): Promise<LimitsView> {
    if (!(await consented())) return { limits: null, quota: null, source: "indisponible" };
    const auth = await getAuth();
    const cached = auth ? await readAccountCache(auth) : null;
    const t = cached?.today;
    const quota = t ? {
      used: typeof t.used === "number" ? t.used : null,
      limit: typeof t.limit === "number" ? t.limit : null,
      remaining: typeof t.remaining === "number" ? t.remaining : typeof t.limit === "number" && typeof t.used === "number" ? Math.max(0, t.limit - t.used) : null,
    } : null;
    const fresh = limitsCache && Date.now() - limitsCache.at < (limitsCache.limits ? 60_000 : 15_000);
    if (!fresh) {
      let parsed: ClipLimits | null = null;
      try {
        const res = await http(fetchFn, `${API_BASE}/limites`, { method: "GET", token: auth?.token, timeoutMs: 5_000 });
        parsed = res.status === 200 ? parseLimits(res.body) : null;
      } catch {
        parsed = limitsCache?.limits ?? null; // hors ligne : dernières limites connues
      }
      limitsCache = { at: Date.now(), limits: parsed };
    }
    const l = limitsCache?.limits ?? null;
    // Reste du jour annoncé par le serveur (plus frais que le dernier état connu du compte) quand il le dit.
    const told = l && l.restantAujourdhui !== null ? { used: quota?.used ?? null, limit: l.quotaJour ?? quota?.limit ?? null, remaining: l.restantAujourdhui } : quota;
    return { limits: l, quota: told, source: l ? "serveur" : "indisponible" };
  }

  /**
   * 3.6.0 : lecteur de l'onglet actif piloté depuis le popup (instant de lecture, aller à, lire le passage, arrêter).
   * Le content script de l'onglet agit sur sa vidéo principale ; sa réponse est revalidée.
   */
  async function player(req: PlayerRequest): Promise<PlayerState> {
    let tabId: number | null = null;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (typeof tab?.id === "number" && tab.id >= 0) tabId = tab.id;
    } catch { /* pas de fenêtre */ }
    if (tabId === null) return fail("no_player", MSG.noPlayer);
    const { type: _t, ...op } = req;
    const msg = { type: "player.cmd", ...op } as TabMessage;
    let raw: unknown;
    try {
      raw = await Promise.race([
        chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2_500)),
      ]);
    } catch {
      return fail("no_player", MSG.noPlayer, true);
    }
    const st = parsePlayerState(raw);
    if (!st) return fail("no_player", MSG.noPlayer, true);
    return st;
  }

  let lastToolsTab = 0;
  /**
   * « Ouvrir dans AETHRYON Tools » : un fichier déjà converti → lien vers l'éditeur sur CE média (le serveur ne le
   * récupère pas une seconde fois) ; une vidéo pas encore convertie → /outils avec son lien prérempli (fragment).
   */
  async function openTools(req: ToolsOpen, who: Sender): Promise<{ opened: boolean }> {
    if (!(await consented())) throw new BgError(consentRequired(await consentOutdated()));
    if (who.kind === "content") {
      const now = Date.now();
      if (now - lastToolsTab < 1_500) return { opened: false };
      lastToolsTab = now;
    }
    let url: string;
    if ("key" in req) {
      const jobId = await jobs.serverJobOf(req.key, who.kind === "content" ? who.tabId : undefined);
      if (!jobId) return fail("no_media", MSG.toolsNoMedia);
      const auth = await getAuth();
      if (!auth) throw new BgError(await authLost());
      let res: HttpResult;
      try {
        res = await http(fetchFn, `${SITE_BASE}/api/extension/outils`, { method: "POST", token: auth.token, json: { job_id: jobId }, timeoutMs: T.requestTimeoutMs });
      } catch {
        return fail("network", MSG.network, true);
      }
      if (res.status === 401) throw new BgError(await onUnauthorized(auth.token, res.body));
      if (res.status === 404) return fail("tools_unavailable", MSG.toolsClosed);
      const link = isObj(res.body) && typeof res.body.url === "string" ? res.body.url : "";
      if (res.status !== 201 || !link.startsWith(`${SITE_BASE}/outils/studio#ref=`) || link.length > 400) return fail("tools_failed", MSG.toolsFailed, true);
      url = link;
    } else {
      const ref = parseMediaUrl(req.url);
      if (!ref) return fail("unsupported_url", MSG.unsupportedUrl);
      // V3.5 : passage réglé dans la page → Tools le présélectionne (fragment : jamais envoyé à un serveur).
      const range = req.clip ? `&debut=${req.clip.start}&fin=${req.clip.end}` : "";
      url = `${SITE_BASE}/outils#lien=${encodeURIComponent(ref.url)}${range}`;
    }
    try {
      await chrome.tabs.create({ url });
    } catch {
      return fail("tools_failed", MSG.toolsFailed, true);
    }
    return { opened: true };
  }

  // ---- routeur --------------------------------------------------------------------------------------
  async function handle(req: BgRequest, who: Sender): Promise<unknown> {
    const contentTab = who.kind === "content" ? who.tabId : undefined;
    switch (req.type) {
      case "job.start": {
        if (who.kind === "content") return jobs.start(req, { tabId: who.tabId, platform: who.platform });
        const url = parseMediaUrl(req.url)?.url;
        let tabId: number | undefined;
        for (const [t, u] of detected) if (u === url) tabId = t;
        return jobs.start(req, { tabId });
      }
      case "job.retry":
        return jobs.retry(req.key, contentTab);
      case "job.cancel":
        return jobs.cancel(req.key, contentTab);
      case "job.dismiss":
        return jobs.dismiss(req.key);
      case "download.show":
        return jobs.show(req.key, contentTab);
      case "caps.get":
        return caps();
      case "limits.get":
        return limits();
      case "egide.police":
        return policeEgide();
      case "platforms.get":
        return plateformes();
      case "player":
        if (who.kind !== "page") return fail("unsupported", MSG.internal);
        return player(req);
      case "frame.capture":
        return captureFrame();
      case "frame.save":
        if (who.kind !== "content") return fail("unsupported", MSG.internal);
        return saveFrame(req, who);
      case "thumb.save":
        return saveThumb(req, who);
      case "tools.open":
        return openTools(req, who);
      case "jobs.list":
        return jobs.list(contentTab);
      case "popup.init":
        return popupInit();
      case "account.refresh": {
        const a = await account(T.accountTimeoutMs, { network: await consented() });
        if (!a) throw new BgError(await authLost()); // motif qui vient d'être enregistré
        return a;
      }
      case "auth.login": {
        const a = await login();
        // Une page web (même par notre content script) n'apprend rien du compte : seulement « connecté ».
        return who.kind === "content" ? { connected: a.connected } : a;
      }
      case "auth.logout":
        return logout();
      case "consent.accept":
        return acceptConsent(req.version);
      case "consent.withdraw":
        return withdrawConsent();
      case "welcome.open":
        return openWelcome(req.section, who.kind === "content");
      case "update.dismiss": {
        await dismissUpdate(req.version);
        const notice = noticeFor(await readUpdateState(), installedVersion());
        pageEvent({ type: "update.changed", update: notice });
        return { update: notice };
      }
      case "update.install":
        return installUpdate(req.version);
      case "update.hint.dismiss": {
        await chrome.storage.local.remove(HINT_KEY);
        pageEvent({ type: "update.hint", hint: null });
        return { hint: null };
      }
    }
  }

  /** chrome.runtime.onMessage : rejet silencieux de tout message inattendu ou d'un expéditeur non admis. */
  function onMessage(msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r: BgResponse<unknown>) => void): boolean {
    if (!alive) return false;
    const req = parseBgRequest(msg);
    if (!req) return false;
    const who = classifySender(sender, chrome.runtime.id);
    if (!who || !isAllowed(req.type, who)) return false;
    handle(req, who).then(
      (data) => sendResponse({ ok: true, data }),
      (e: unknown) => sendResponse({ ok: false, error: e instanceof BgError ? e.error : jobError("internal", MSG.internal, true) }),
    );
    return true;
  }

  function resume(): Promise<void> {
    return jobs.resume();
  }

  /** Écouteurs enregistrés de façon synchrone au démarrage du worker (sinon Chrome perd les événements). */
  function install(): void {
    chrome.runtime.onMessage.addListener(onMessage);
    void afterReload();
    chrome.downloads.onChanged.addListener((delta) => void jobs.onDownloadChanged(delta));
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === ALARM) void resume();
      else if (alarm.name === UPDATE_ALARM) void updateCheck();
    });
    chrome.runtime.onStartup.addListener(() => {
      void resume();
      void ensureUpdateAlarm();
      void updateCheck();
    });
    chrome.runtime.onInstalled.addListener((details) => {
      void ensureUpdateAlarm();
      // Premier lancement : page d'accueil (installation confirmée, épinglage, notice, connexion).
      if (details.reason === "install") void openWelcome();
    });
    // Le jeton est dans storage.local : réservé aux contextes de confiance (pages et worker de
    // l'extension), illisible depuis un content script même si la page hôte est compromise. Pris en charge pour
    // storage.local depuis Chrome 140 seulement — d'où minimum_chrome_version 140 (scripts/build.mjs) : Chrome
    // refuse d'installer l'extension sur une version plus ancienne, où ce réglage échouerait.
    try {
      chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => undefined);
    } catch { /* API absente (navigateur hors norme) : le code des content scripts ne lit jamais storage.local */ }
  }

  /** Tests : simule l'arrêt du worker (plus aucune écriture, suivis interrompus). */
  function stop(): void {
    alive = false;
    jobs.stop();
  }

  return { install, resume, handle, onMessage, stop, updateCheck, afterReload };
}
