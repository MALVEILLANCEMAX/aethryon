// Moteur commun des content scripts (YouTube, TikTok, X).
// - Lit la page via l'adaptateur de la plateforme, décide de l'affichage (policy.ts) et écrit dans le
//   DOM : un hôte Shadow DOM par vidéo (bouton intégré) ou le panneau flottant.
// - Observateurs CIBLÉS (conteneurs fournis par la plateforme), travail regroupé dans un
//   requestAnimationFrame, navigation SPA (API Navigation, popstate, événements de la plateforme,
//   vérification périodique), thème, plein écran, réglages en direct.
// - Messages : uniquement de notre extension (job.update, detect.request) ; jamais window.postMessage.
// - Jamais de lecture du jeton (storage.local « auth ») : seuls les réglages (storage.sync) sont lus, et
//   leurs changements arrivent par chrome.storage.sync.onChanged (voir settings.ts).
// - Contexte d'extension invalidé (extension rechargée) : démontage complet et silencieux.
import { grabFrame, mainVideo, videoTimes } from "./video.ts";
import type { BgRequest, DetectResponse, FrameGrab, StartJob } from "../../shared/messages.ts";
import { clipAt, parseClip } from "../../shared/clip.ts";
import type { LimitsView } from "../../shared/limites.ts";
import { parseLimits } from "../../shared/limites.ts";
import type { Clip } from "../../shared/types.ts";
import { getSettings, mergeSettings, saveSettings } from "../../shared/storage.ts";
import type { Settings } from "../../shared/types.ts";
import { PLATFORM_LABEL, mediaKey, parseMediaUrl } from "../../shared/urls.ts";
import { EMPTY_SCAN, type ObserveSpec, type PlatformAdapter, type ScanContext, type ScanResult, type Target } from "./adapter.ts";
import { DEFAULT_CAPS, HOST_TAG, InlineHost, type Caps, type QuickAction } from "./control.ts";
import { PagePlayer } from "./player.ts";
import { buildStartJob, describeFailure, describeJob, describeNoticeOpened, describeSending, describeSignedIn, describeSigningIn, describeSignInFailure, type SafeJob } from "./job.ts";
import { M, T } from "./strings.ts";
import { createLifecycle, extensionContextValid } from "./lifecycle.ts";
import { FloatingPanel, PANEL_TAG, type PanelHooks } from "./panel.ts";
import { displayMode, planDisplay, type Missing } from "./policy.ts";
import { interpretLoginResponse, interpretSendFailure, interpretStartResponse, isTrustedSender, parseTabMessage } from "./protocol.ts";
import { createScheduler } from "./scheduler.ts";
import { watchSyncSettings } from "./settings.ts";
import { chargerApparence, chargerPolice, definirPolicePage } from "./apparence.ts";
import { JobStore } from "./store.ts";
import type { Theme } from "./theme.ts";
import { eventSource, navigationApiSource, watchUrl } from "./url-watcher.ts";
import { VisibilityTrigger } from "./visibility.ts";

/** Délai avant le panneau de secours quand l'ancrage de la vidéo courante reste introuvable. */
const FALLBACK_DELAY_MS = 2500;
/** Vérification périodique : contexte de l'extension, URL (repli), thème. */
const TICK_MS = 1000;
/** Garde-fou : si la page retire notre bouton à chaque image (lutte avec son rendu), pause. */
const MAX_FIGHT_STREAK = 25;
const PAUSE_MS = 2000;
/** Attributs de <html>/<body> qui portent le thème selon les plateformes. */
const THEME_ATTRS = ["class", "style", "dark", "data-theme", "data-color-mode", "theme"];

function debug(...args: unknown[]): void {
  try {
    if (typeof __AETHRYON_TARGET__ !== "undefined" && __AETHRYON_TARGET__ === "dev") console.debug("[AETHRYON]", ...args);
  } catch {
    /* jamais d'erreur visible dans la page */
  }
}

const optKey = (o: MutationObserverInit) => JSON.stringify([o.childList, o.subtree, o.attributes, o.attributeFilter, o.characterData]);

export function startContentScript(adapter: PlatformAdapter): void {
  if (!extensionContextValid()) return;
  const doc = document;
  const win = window;

  // Restes d'une instance précédente (extension rechargée) : une seule interface AETHRYON par page.
  for (const el of Array.from(doc.querySelectorAll(`${HOST_TAG}, ${PANEL_TAG}`))) el.remove();

  const lc = createLifecycle(extensionContextValid, debug);
  const store = new JobStore();
  const controls = new Map<string, InlineHost>();
  const owned = new WeakSet<Node>();
  let settings: Settings | null = null;
  let theme: Theme = safeTheme();
  let fullscreen = isFullscreen();
  let missing: Missing | null = null;
  let observed: ObserveSpec[] = [];
  let fightStreak = 0;
  let pausedUntil = 0;
  /** Jobs remplacés par un plus récent pour la même vidéo : leurs mises à jour tardives sont ignorées. */
  const retired = new Set<string>();

  const ctx = (mode: ScanContext["mode"]): ScanContext => ({ doc, win, href: location.href, mode });

  const hooks: PanelHooks = {
    doc,
    win,
    platform: adapter.platform,
    fontFamily: adapter.fontFamily,
    settings: () => settings ?? mergeSettings(undefined),
    store,
    start: (key, payload) => {
      // Premiere Pro (3.5.1) : l'explication du dossier AETHRYON a servi, elle n'est plus montrée ensuite.
      if (payload.dest === "premiere" && settings && !settings.premiereHintSeen && lc.check()) saveSettings({ premiereHintSeen: true }).catch(() => {});
      void startJob(key, payload);
    },
    retry: (key) => void retryJob(key),
    fail: (key, message) => store.set(key, { display: describeFailure({ code: "invalid_url", message, retryable: false }) }),
    login: (key) => void loginFromPage(key),
    openNotice: (key) => void openNotice(key),
    quick: (key, action, near) => void quickAction(key, action, near),
    playback: (near) => videoTimes(mainVideo(doc, win, near)),
    caps: () => readCaps(),
    limits: () => readLimits(),
    player: (near) => playerFor(near),
    jobAction: (key, action) => void jobAction(key, action),
    saveToolbar: (collapsed) => {
      if (!lc.check()) return;
      saveSettings({ ytToolbar: collapsed ? "collapsed" : "open" }).catch(() => {});
    },
    saveDestination: (dest) => {
      if (!lc.check()) return;
      saveSettings({ destination: dest }).catch(() => {});
    },
    savePosition: (p) => {
      if (!lc.check()) return;
      saveSettings({ panelPosition: p }).catch(() => {});
    },
    // Égide : police d'interface du menu, demandée au service worker à la première ouverture (content/common/apparence.ts).
    police: () => {
      if (!lc.check()) return;
      chargerPolice(doc, async () => {
        try {
          const res = (await chrome.runtime.sendMessage({ type: "egide.police" })) as { ok?: boolean; data?: unknown } | undefined;
          return res?.ok === true && typeof res.data === "string" && res.data.length < 200_000 ? res.data : null;
        } catch {
          return null;
        }
      });
    },
  };
  definirPolicePage(adapter.fontFamily);

  // V3.5 : capacités du serveur et du compte (Tools ouvert, plateforme en pause), demandées au service worker à
  // l'ouverture d'un menu et gardées 30 s ; sans réponse : dernier état connu (au départ : tout permis, le serveur
  // reste juge).
  let caps: { at: number; value: Caps } | null = null;
  async function readCaps(): Promise<Caps> {
    if (caps && Date.now() - caps.at < 30_000) return caps.value;
    try {
      const res = (await chrome.runtime.sendMessage({ type: "caps.get" })) as { ok?: boolean; data?: { tools?: unknown; paused?: unknown } } | undefined;
      if (res?.ok && res.data) {
        const paused = Array.isArray(res.data.paused) && res.data.paused.includes(adapter.platform);
        caps = { at: Date.now(), value: { tools: res.data.tools !== false, paused: paused ? M.paused(PLATFORM_LABEL[adapter.platform]) : null } };
        return caps.value;
      }
    } catch (e) {
      const f = interpretSendFailure(e);
      if (f.invalidated || !lc.check()) lc.dispose();
    }
    return caps?.value ?? DEFAULT_CAPS;
  }

  // 3.6.0 : limites des extraits annoncées par le serveur et reste du quota du jour (service worker : GET /limites,
  // gardées 60 s ; ici 30 s). Sans réponse : null, l'éditeur le dit et le serveur reste juge.
  let limitsCache: { at: number; value: LimitsView } | null = null;
  async function readLimits(): Promise<LimitsView | null> {
    if (limitsCache && Date.now() - limitsCache.at < 30_000) return limitsCache.value;
    try {
      const res = (await chrome.runtime.sendMessage({ type: "limits.get" })) as { ok?: boolean; data?: Record<string, unknown> } | undefined;
      if (res?.ok && res.data && typeof res.data === "object") {
        const d = res.data;
        const q = d.quota && typeof d.quota === "object" ? d.quota as Record<string, unknown> : null;
        const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
        const value: LimitsView = {
          limits: parseLimits(d.limits),
          quota: q ? { used: num(q.used), limit: num(q.limit), remaining: num(q.remaining) } : null,
          source: d.source === "serveur" ? "serveur" : "indisponible",
        };
        limitsCache = { at: Date.now(), value };
        return value;
      }
    } catch (e) {
      const f = interpretSendFailure(e);
      if (f.invalidated || !lc.check()) lc.dispose();
    }
    return limitsCache?.value ?? null;
  }

  // 3.6.0 : lecteur de la vidéo principale piloté depuis le popup (relayé par le service worker).
  let popupPlayer: PagePlayer | null = null;
  async function playerCommand(m: Extract<ReturnType<typeof parseTabMessage>, { type: "player.cmd" }>): Promise<unknown> {
    popupPlayer ??= new PagePlayer(win, () => mainVideo(doc, win));
    const p = popupPlayer;
    if (m.op === "seek") p.seek(m.t);
    else if (m.op === "stop") p.stop();
    else if (m.op === "preview") await p.preview(m.start, m.end, () => undefined);
    return p.snapshot();
  }

  // V3.5 : le lecteur de la page sert de mini-lecteur à la vue « Extrait » (un par commande ; la vidéo est
  // cherchée de nouveau à chaque geste : les fils remplacent leurs éléments).
  const players = new WeakMap<Element, PagePlayer>();
  function playerFor(near: Element): PagePlayer {
    let p = players.get(near);
    if (!p) {
      p = new PagePlayer(win, () => mainVideo(doc, win, near));
      players.set(near, p);
    }
    return p;
  }

  /** « Annuler » (travail en cours sur le serveur) ou « Afficher » (fichier écrit) pour le média `key`. */
  async function jobAction(key: string, action: "cancel" | "show"): Promise<void> {
    if (!lc.check()) return;
    const slot = store.get(key);
    if (!slot.jobKey) return;
    try {
      await chrome.runtime.sendMessage({ type: action === "cancel" ? "job.cancel" : "download.show", key: slot.jobKey });
    } catch (e) {
      const f = interpretSendFailure(e);
      if (f.invalidated || !lc.check()) lc.dispose();
    }
  }

  const panel = new FloatingPanel(hooks, theme);
  owned.add(panel.host);
  panel.setFullscreen(fullscreen);

  const scheduler = createScheduler(lc.wrap(scan), win);
  lc.add(() => scheduler.cancel());

  // Observateur de la page : le rappel ne fait QUE demander un passage (regroupé par image).
  const isRelevant = (r: MutationRecord): boolean => {
    if (r.type !== "childList" || r.removedNodes.length > 0) return true;
    for (const n of Array.from(r.addedNodes)) if (!owned.has(n)) return true;
    return false;
  };
  const mo = new MutationObserver(lc.wrap((records: MutationRecord[]) => {
    if (records.some(isRelevant)) scheduler.request();
  }));
  lc.add(() => mo.disconnect());

  const vis = new VisibilityTrigger(lc.wrap(() => scheduler.request()));
  lc.add(() => vis.disconnect());

  // Thème : attributs de <html>/<body>, préférence système, et vérification périodique.
  const themeMo = new MutationObserver(lc.wrap(() => refreshTheme()));
  let themeBody: HTMLElement | null | undefined;
  const observeTheme = () => {
    if (doc.body === themeBody) return;
    themeMo.disconnect();
    themeMo.observe(doc.documentElement, { attributes: true, attributeFilter: THEME_ATTRS });
    if (doc.body) themeMo.observe(doc.body, { attributes: true, attributeFilter: THEME_ATTRS });
    themeBody = doc.body;
  };
  observeTheme();
  lc.add(() => themeMo.disconnect());
  try {
    const mql = win.matchMedia("(prefers-color-scheme: dark)");
    lc.listen(mql, "change", lc.wrap(() => refreshTheme()));
  } catch {
    /* matchMedia indisponible */
  }

  // Plein écran : interface masquée.
  for (const type of ["fullscreenchange", "webkitfullscreenchange"]) lc.listen(doc, type, lc.wrap(() => applyFullscreen()));

  // Navigation SPA.
  const watcher = watchUrl({
    read: () => location.href,
    onChange: lc.wrap(() => onNavigate()),
    sources: [navigationApiSource(win), eventSource(win, "popstate")],
  });
  lc.add(() => watcher.dispose());
  for (const type of adapter.navigationEvents ?? []) {
    lc.listen(win, type, lc.wrap(() => {
      watcher.check();
      refreshTheme();
      scheduler.request();
    }), true);
  }

  const tick = setInterval(lc.wrap(() => {
    // lc.wrap a déjà vérifié le contexte de l'extension (démontage s'il est perdu).
    if (doc.visibilityState !== "visible") return;
    watcher.check();
    observeTheme();
    refreshTheme();
    applyFullscreen();
  }), TICK_MS);
  lc.add(() => clearInterval(tick));

  // Messages de l'extension (service worker, popup) — et d'elle seule.
  const onMessage = (msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r?: unknown) => void): boolean => {
    if (lc.disposed || !lc.check()) return false;
    let id: string | undefined;
    try {
      id = chrome.runtime.id;
    } catch {
      id = undefined;
    }
    if (!isTrustedSender(sender, id)) return false;
    const m = parseTabMessage(msg);
    if (!m) return false;
    if (m.type === "detect.request") {
      let r: DetectResponse = { media: null, hint: null };
      try {
        r = adapter.detect(ctx("detect"));
        // V3 : instant de lecture et durée de la vidéo principale (extrait instantané depuis le popup).
        if (r.media) r = { ...r, media: { ...r.media, ...videoTimes(mainVideo(doc, win)) } };
      } catch (e) {
        debug(e);
      }
      sendResponse(r);
      return false;
    }
    if (m.type === "player.cmd") {
      playerCommand(m).then((r) => sendResponse(r), () => sendResponse(null));
      return true;
    }
    if (m.type === "frame.grab") {
      let g: FrameGrab = { ok: false, reason: "no_video" };
      try {
        g = grabFrame(doc, win, mainVideo(doc, win));
      } catch (e) {
        debug(e);
      }
      sendResponse(g);
      return false;
    }
    try {
      onJobUpdate(m.job);
    } catch (e) {
      debug(e);
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);
  lc.add(() => {
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      /* contexte déjà invalidé */
    }
  });

  // Réglages (storage.sync uniquement), en direct.
  try {
    const off = watchSyncSettings(lc.wrap((s: Settings) => {
      settings = s;
      settingsChanged();
    }));
    lc.add(() => {
      try {
        off();
      } catch {
        /* ignoré */
      }
    });
    // Égide : la préférence d'apparence est lue AVANT la première commande (aucun changement de thème sous les yeux).
    Promise.all([getSettings(), chargerApparence()]).then(
      lc.wrap(([s]: [Settings, void]) => {
        settings = s;
        settingsChanged();
      }),
      lc.wrap(() => {
        settings = mergeSettings(undefined);
        settingsChanged();
      }),
    );
  } catch {
    settings = mergeSettings(undefined);
  }

  // Démontage de l'interface (en dernier dans la liste : exécuté en premier).
  lc.add(() => {
    for (const c of controls.values()) c.destroy();
    controls.clear();
    panel.destroy();
    store.clear();
  });

  scheduler.request();

  // ---- examen de la page -----------------------------------------------------------------------
  function scan(): void {
    const now = Date.now();
    if (now < pausedUntil) {
      scheduler.at(pausedUntil + 10);
      return;
    }
    const mode = displayMode(settings, adapter.platform);
    let res: ScanResult = EMPTY_SCAN;
    if (mode !== "off") {
      try {
        res = adapter.scan(ctx(mode));
      } catch (e) {
        // Erreur inattendue d'une plateforme : on garde l'affichage actuel plutôt que de tout retirer.
        debug(e);
        return;
      }
    }
    const plan = planDisplay(mode, res.targets, res.primary, missing, now, FALLBACK_DELAY_MS);
    missing = plan.missing;
    if (plan.recheckAt !== null) scheduler.at(plan.recheckAt + 20);

    const fights = reconcile(plan.inline);
    if (plan.panel) panel.show(plan.panel);
    else panel.hide();
    syncObservers(mode === "off" ? [] : res.observe);
    vis.sync(mode === "off" ? [] : res.visibility ?? []);

    // Seules les RÉinsertions au même endroit comptent (la page retire le bouton à chaque rendu) ;
    // créer des boutons pendant un défilement rapide du fil est normal.
    fightStreak = fights > 0 ? fightStreak + 1 : 0;
    if (fightStreak > MAX_FIGHT_STREAK) {
      fightStreak = 0;
      pausedUntil = now + PAUSE_MS;
      scheduler.at(pausedUntil + 10);
      debug("pause : la page retire sans cesse le bouton");
    }
  }

  /**
   * Une commande par clé : création, déplacement si le nœud d'ancrage a changé, suppression sinon.
   * Renvoie le nombre de réinsertions forcées (la page avait retiré un bouton de son ancrage).
   */
  function reconcile(targets: Target[]): number {
    let fights = 0;
    const want = new Map(targets.map((t) => [t.key, t] as const));
    for (const [key, c] of controls) {
      if (!want.has(key)) {
        c.destroy();
        controls.delete(key);
      }
    }
    for (const [key, t] of want) {
      let c = controls.get(key);
      if (!c) {
        c = new InlineHost(hooks, t, theme);
        owned.add(c.host);
        controls.set(key, c);
        c.setHidden(fullscreen);
      } else {
        c.update(t);
      }
      if (c.place(t) === "reinserted") fights++;
    }
    // Hôte qui ne nous appartient plus (instance précédente, copie par la page) : retiré.
    for (const el of Array.from(doc.getElementsByTagName(HOST_TAG))) {
      if (!owned.has(el)) {
        el.remove();
        fights++;
      }
    }
    return fights;
  }

  function syncObservers(specs: ObserveSpec[]): void {
    const same = specs.length === observed.length && specs.every((s, i) => s.node === observed[i]?.node && optKey(s.options) === optKey(observed[i]!.options));
    if (same) return;
    mo.disconnect();
    for (const s of specs) {
      try {
        mo.observe(s.node, s.options);
      } catch {
        /* nœud invalide : ignoré */
      }
    }
    observed = specs;
  }

  function onNavigate(): void {
    for (const c of controls.values()) c.control.close();
    panel.closePopover();
    missing = null;
    refreshTheme();
    scheduler.request();
  }

  function safeTheme(): Theme {
    try {
      return adapter.theme(doc);
    } catch {
      return "light";
    }
  }

  function refreshTheme(): void {
    const t = safeTheme();
    if (t === theme) return;
    theme = t;
    for (const c of controls.values()) c.control.setTheme(t);
    panel.setTheme(t);
  }

  function isFullscreen(): boolean {
    return !!(doc.fullscreenElement || (doc as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement);
  }

  function applyFullscreen(): void {
    const fs = isFullscreen();
    if (fs === fullscreen) return;
    fullscreen = fs;
    for (const c of controls.values()) c.setHidden(fs);
    panel.setFullscreen(fs);
  }

  function settingsChanged(): void {
    for (const c of controls.values()) c.control.settingsChanged();
    panel.settingsChanged();
    scheduler.request();
  }

  // ---- téléchargements -----------------------------------------------------------------------
  function retire(jobKey: string): void {
    retired.add(jobKey);
    if (retired.size > 200) retired.delete(retired.values().next().value as string);
  }

  function onJobUpdate(job: SafeJob): void {
    if (retired.has(job.key)) return;
    let key = store.mediaKeyForJob(job.key);
    if (!key) {
      // Job inconnu de cette page (lancé depuis le popup, ou mise à jour arrivée avant la réponse) :
      // rattaché à la vidéo de même identifiant si elle n'a pas déjà son propre job en cours.
      const ref = parseMediaUrl(job.url);
      if (!ref) return;
      const k = mediaKey({ platform: ref.platform, id: ref.id });
      const slot = store.get(k);
      if (slot.jobKey && slot.jobKey !== job.key && slot.display.busy) return;
      key = k;
    }
    applyJob(key, job);
  }

  function applyJob(key: string, job: SafeJob): void {
    const slot = store.get(key);
    if (slot.jobKey && slot.jobKey !== job.key) retire(slot.jobKey);
    const prev = slot.job;
    if (prev && prev.key === job.key && job.updatedAt > 0 && prev.updatedAt > job.updatedAt) return; // mise à jour périmée
    store.set(key, { jobKey: job.key, job, display: describeJob(job) });
  }

  async function startJob(key: string, payload: StartJob): Promise<void> {
    const slot = store.get(key);
    if (!lc.check() || slot.display.busy) return;
    if (slot.jobKey) retire(slot.jobKey);
    store.set(key, { display: describeSending(), payload, job: null, jobKey: null });
    await send(key, payload);
  }

  async function retryJob(key: string): Promise<void> {
    if (!lc.check()) return;
    const slot = store.get(key);
    if (slot.display.busy) return;
    if (slot.jobKey) {
      // Le service worker reprend le même job (fichier encore sur le serveur : pas de nouvelle conversion).
      store.set(key, { display: describeSending() });
      await send(key, { type: "job.retry", key: slot.jobKey });
    } else if (slot.payload) {
      await startJob(key, slot.payload);
    }
  }

  /**
   * « Se connecter à AETHRYON » dans la page : la VRAIE connexion (le service worker ouvre la fenêtre du site,
   * launchWebAuthFlow + PKCE) ; la page n'apprend que « connecté » ou la cause d'un échec, jamais le compte.
   */
  async function loginFromPage(key: string): Promise<void> {
    if (!lc.check() || store.get(key).display.phase === "signing") return;
    store.set(key, { display: describeSigningIn() });
    let res: unknown;
    try {
      res = await chrome.runtime.sendMessage({ type: "auth.login" });
    } catch (e) {
      const f = interpretSendFailure(e);
      if (f.invalidated || !lc.check()) {
        lc.dispose();
        return;
      }
      store.set(key, { display: describeSignInFailure(f.error) });
      return;
    }
    if (lc.disposed) return;
    const r = interpretLoginResponse(res);
    store.set(key, { display: r.ok ? describeSignedIn() : describeSignInFailure(r.error) });
  }

  /** « Lire la notice » : la page d'accueil de l'extension s'ouvre sur la notice sur les données. */
  async function openNotice(key: string): Promise<void> {
    if (!lc.check()) return;
    try {
      await chrome.runtime.sendMessage({ type: "welcome.open", section: "donnees" });
    } catch (e) {
      const f = interpretSendFailure(e);
      if (f.invalidated || !lc.check()) {
        lc.dispose();
        return;
      }
      store.set(key, { display: describeFailure(f.error) });
      return;
    }
    if (!lc.disposed) store.set(key, { display: describeNoticeOpened() });
  }

  /**
   * V3 : outils rapides de la commande. Extrait : depuis l'instant de lecture de LA vidéo de la commande (lu au clic),
   * durée et placement des réglages, format choisi (MP4 ou MP3) ou GIF (durée maximale : celle du serveur). Image : lue dans la page (une
   * vidéo d'une autre origine ne se lit pas ici : le bouton de la barre d'outils le fait). Miniature, Tools : par le
   * service worker. Aucune donnée de compte ne vient ici ; le service worker revalide tout.
   */
  async function quickAction(key: string, action: QuickAction, near: Element): Promise<void> {
    if (!lc.check() || store.get(key).display.busy) return;
    const s = settings ?? mergeSettings(undefined);
    const fail = (message: string) => store.set(key, { display: describeFailure({ code: "quick", message, retryable: false }) });
    const media = action.media;
    if (action.kind === "clip") {
      const gif = action.output === "gif";
      let clip: Clip | null = null;
      if (action.range) {
        // V3.5 : passage réglé dans la vue « Extrait » (le service worker le revalide contre les bornes du format).
        clip = parseClip(action.range);
        if (!clip) return fail(T.clipNoTime);
      } else {
        const times = videoTimes(mainVideo(doc, win, near));
        if (times.currentTime === undefined) return fail(T.clipNoTime);
        clip = clipAt(times.currentTime, s.clipLength, s.clipAnchor, times.duration);
      }
      if (!clip) return fail(T.clipNoTime);
      const base = buildStartJob(media, { ...action.choice, fmt: action.output === "mp3" ? "mp3" : "mp4" });
      if (!base) return fail(T.errInvalidLink);
      const payload: StartJob = { ...base, clip, ...(gif ? { gif: true as const } : {}) };
      if (gif) delete payload.quality; // le service worker choisit la définition d'un GIF
      await startJob(key, payload);
      return;
    }
    if (action.kind === "frame") {
      const g = grabFrame(doc, win, mainVideo(doc, win, near));
      if (!g.ok) return fail(g.reason === "tainted" ? T.frameTainted : g.reason === "drm" ? T.frameDrm : g.reason === "not_ready" ? T.frameNotReady : T.frameNoVideo);
      store.set(key, { display: describeSending(), job: null, jobKey: null });
      await send(key, { type: "frame.save", url: media.url, dataUrl: g.dataUrl, at: g.at, ...(media.title ? { title: media.title } : {}) });
      return;
    }
    if (action.kind === "thumb") {
      if (!media.thumbnail) return fail(T.thumbMissing);
      store.set(key, { display: describeSending(), job: null, jobKey: null });
      await send(key, { type: "thumb.save", url: media.url, thumbnail: media.thumbnail, ...(media.title ? { title: media.title } : {}) });
      return;
    }
    let res: unknown;
    try {
      res = await chrome.runtime.sendMessage({ type: "tools.open", url: media.url, ...(action.kind === "tools" && action.range ? { clip: action.range } : {}) });
    } catch (e) {
      const f = interpretSendFailure(e);
      if (f.invalidated || !lc.check()) {
        lc.dispose();
        return;
      }
      store.set(key, { display: describeFailure(f.error) });
      return;
    }
    const r = interpretStartResponse(res);
    if (!r.ok) store.set(key, { display: describeFailure(r.error) });
    else for (const host of controls.values()) if (host.control.key === key) host.control.close(); // l'onglet de Tools s'ouvre
  }

  async function send(key: string, msg: StartJob | { type: "job.retry"; key: string } | Extract<BgRequest, { type: "frame.save" | "thumb.save" }>): Promise<void> {
    let res: unknown;
    try {
      res = await chrome.runtime.sendMessage(msg);
    } catch (e) {
      const f = interpretSendFailure(e);
      if (f.invalidated || !lc.check()) {
        lc.dispose();
        return;
      }
      store.set(key, { display: describeFailure(f.error) });
      return;
    }
    if (lc.disposed) return;
    const r = interpretStartResponse(res);
    if (!r.ok) {
      store.set(key, { display: describeFailure(r.error) });
      return;
    }
    if (r.job) applyJob(key, r.job);
    else if (store.get(key).display.phase === "sending") store.set(key, { display: describeJob({ state: "queued" }) });
  }
}
