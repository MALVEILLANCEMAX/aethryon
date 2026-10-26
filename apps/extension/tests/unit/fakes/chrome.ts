// Faux navigateur en mémoire : juste les API Chrome utilisées par le service worker.
// L'état « navigateur » (stockages, téléchargements, alarmes, permissions) survit à restartWorker(),
// qui recrée un objet `chrome` neuf (écouteurs perdus), comme un redémarrage du service worker.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const EXT_ID = "dnllfjakdgmgfiompaheickmbjjlgjdc";
const NO_RECEIVER = "Could not establish connection. Receiving end does not exist.";

type Listener = (...args: any[]) => any;

export class FakeEvent {
  listeners: Listener[] = [];
  addListener(f: Listener): void { this.listeners.push(f); }
  removeListener(f: Listener): void { this.listeners = this.listeners.filter((x) => x !== f); }
  hasListener(f: Listener): boolean { return this.listeners.includes(f); }
  hasListeners(): boolean { return this.listeners.length > 0; }
  dispatch(...args: unknown[]): unknown[] { return this.listeners.map((l) => l(...args)); }
}

export interface FakeDownload {
  id: number;
  url: string;
  state: "in_progress" | "interrupted" | "complete";
  error?: string;
  bytesReceived: number;
  totalBytes: number;
  fileSize: number;
  filename: string;
  canResume: boolean;
  paused: boolean;
  /** Extension qui a lancé le téléchargement (absent : un site). */
  byExtensionId?: string;
}

/** Proposition de nom reçue d'un écouteur onDeterminingFilename (null : nom de Chrome gardé). */
export type Suggestion = { filename?: string; conflictAction?: string } | null;

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

export class FakeBrowser {
  readonly id = EXT_ID;
  store: Record<"local" | "session" | "sync", Map<string, unknown>> = { local: new Map(), session: new Map(), sync: new Map() };
  accessLevel: Record<string, string> = {};
  downloads = new Map<number, FakeDownload>();
  nextDownloadId = 1;
  downloadCalls: chrome.downloads.DownloadOptions[] = [];
  cancelCalls: number[] = [];
  /** Prochain downloads.download() rejeté avec ce message (ex. « SERVER_FAILED »). */
  downloadReject: string | null = null;
  /** Appelé juste après la création d'un téléchargement (ex. le terminer « tout de suite »). */
  onDownloadCreated: ((id: number) => void) | null = null;
  defaultTotal = 1000;
  alarms = new Map<string, chrome.alarms.Alarm>();
  activeTab: { id: number } | null = { id: 7 };
  /** Réponse d'un content script à tabs.sendMessage ; undefined = aucun destinataire. */
  tabResponder: (tabId: number, msg: any) => unknown = () => undefined;
  tabMessages: { tabId: number; msg: any; options: unknown }[] = [];
  pageMessages: any[] = [];
  pageListening = true;
  authFlows: chrome.identity.WebAuthFlowDetails[] = [];
  /** URL de retour de la fenêtre de connexion ; null = fenêtre fermée par l'utilisateur. */
  authFlow: ((url: string) => string | Promise<string>) | null = null;
  granted = new Set<string>();
  notifications: { id: string; options: any }[] = [];
  /**
   * 3.5.2 : hôte Native Messaging « fr.aethryon.desktop » (AETHRYON Desktop). « ok » : répond { ok, id, etat } à
   * chaque transfert ; « refuse » : { ok: false } ; « absent » : non installé (déconnexion « host not found ») ;
   * « exit » : accepte, puis s'arrête de lui-même après `nativeExitAfter` messages ; « ancien » : hôte d'un Desktop
   * d'avant la 1.1.0-beta.3, qui répond « Type de message inconnu. » à `envoyer-premiere` et `etat-envoi`.
   */
  nativeHost: "ok" | "refuse" | "absent" | "exit" | "ancien" = "ok";
  /** 3.8.1 : réponses de l'hôte à `etat-envoi` (une par question ; la dernière se répète). */
  nativeRelay: any[] = [{ ok: true, etat: "conversion", progression: 0.4 }, { ok: true, etat: "telechargement", progression: 0.5 }, { ok: true, etat: "import" }, { ok: true, etat: "importe" }];
  nativeExitAfter = 1;
  /** Tout ce que le worker a posté vers l'hôte (même perdu), dans l'ordre. */
  nativeMessages: any[] = [];
  nativeNames: string[] = [];
  /** Ports ouverts (processus hôte vivants) et fermés par l'extension. */
  nativeLive = 0;
  nativeMaxLive = 0;
  nativeClosedByExtension = 0;
  /** Version installée (manifeste) : comparée à latest.json par l'avis de nouvelle version. */
  manifestVersion = "1.0.0";
  /** 3.6.1 : chrome.runtime.reload() appelés. */
  reloads = 0;
  /** 3.6.1 : réponse de l'hôte à « mettre-a-jour-extension » (« ancien » : Desktop 1.0.0-beta.3, message inconnu). */
  nativeUpdate: "ok" | "deja" | "ancien" | "refus" = "ok";
  nativeUpdateFolder = "C:\\Users\\Élodie\\AppData\\Local\\AETHRYON\\extension";
  /** Onglets ouverts par l'extension (page d'accueil, chrome.tabs.create). */
  createdTabs: string[] = [];
  /** V3 : downloads.show (« Afficher dans le dossier ») et capture de l'onglet visible (data: PNG, ou erreur). */
  showCalls: number[] = [];
  captureResult: string | Error = new Error("Cannot access contents of the page");
  captureCalls = 0;
  chrome: typeof chrome;
  private ev: Record<string, FakeEvent> = {};

  constructor() {
    this.chrome = this.restartWorker();
  }

  /** Nouveau contexte de service worker : nouvel objet chrome, écouteurs vides, même état navigateur. */
  restartWorker(): typeof chrome {
    const b = this;
    const ev = (this.ev = {
      message: new FakeEvent(), startup: new FakeEvent(), installed: new FakeEvent(), storage: new FakeEvent(),
      download: new FakeEvent(), alarm: new FakeEvent(), determining: new FakeEvent(),
    });
    const area = (name: "local" | "session" | "sync") => ({
      async get(keys?: string | string[] | Record<string, unknown> | null) {
        const map = b.store[name];
        const out: Record<string, unknown> = {};
        if (keys === undefined || keys === null) for (const [k, v] of map) out[k] = clone(v);
        else if (typeof keys === "string") { if (map.has(keys)) out[keys] = clone(map.get(keys)); }
        else if (Array.isArray(keys)) { for (const k of keys) if (map.has(k)) out[k] = clone(map.get(k)); }
        else for (const [k, d] of Object.entries(keys)) out[k] = map.has(k) ? clone(map.get(k)) : d;
        return out;
      },
      async set(items: Record<string, unknown>) {
        const changes: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(items)) {
          // Comme Chrome : sérialisation (les valeurs undefined disparaissent).
          const stored = v === undefined ? undefined : JSON.parse(JSON.stringify(v));
          changes[k] = { oldValue: clone(b.store[name].get(k)), newValue: clone(stored) };
          b.store[name].set(k, stored);
        }
        ev.storage.dispatch(changes, name);
      },
      async remove(keys: string | string[]) {
        for (const k of Array.isArray(keys) ? keys : [keys]) {
          if (!b.store[name].has(k)) continue;
          const old = b.store[name].get(k);
          b.store[name].delete(k);
          ev.storage.dispatch({ [k]: { oldValue: clone(old) } }, name);
        }
      },
      async clear() { b.store[name].clear(); },
      async setAccessLevel(o: { accessLevel: string }) { b.accessLevel[name] = o.accessLevel; },
    });
    const c: any = {
      runtime: {
        id: EXT_ID,
        getURL: (p: string) => `chrome-extension://${EXT_ID}/${p.replace(/^\//, "")}`,
        getManifest: () => ({ version: b.manifestVersion }),
        reload: () => { b.reloads++; },
        onMessage: ev.message,
        onStartup: ev.startup,
        onInstalled: ev.installed,
        async sendMessage(msg: unknown) {
          b.pageMessages.push(clone(msg));
          if (!b.pageListening) throw new Error(NO_RECEIVER);
          return undefined;
        },
      },
      storage: { local: area("local"), session: area("session"), sync: area("sync"), onChanged: ev.storage },
      tabs: {
        async create(p: { url: string }) {
          b.createdTabs.push(p.url);
          return { id: 100 + b.createdTabs.length, url: p.url };
        },
        async query(q: chrome.tabs.QueryInfo) {
          void q;
          return b.activeTab ? [{ ...b.activeTab, index: 0, active: true }] : [];
        },
        async sendMessage(tabId: number, msg: unknown, options?: unknown) {
          b.tabMessages.push({ tabId, msg: clone(msg), options });
          const r = await b.tabResponder(tabId, clone(msg));
          if (r === undefined) throw new Error(NO_RECEIVER);
          return clone(r);
        },
        async get(tabId: number) {
          return { id: tabId, windowId: 1 };
        },
        async captureVisibleTab() {
          b.captureCalls++;
          if (b.captureResult instanceof Error) throw b.captureResult;
          return b.captureResult;
        },
      },
      windows: { WINDOW_ID_CURRENT: -2 },
      downloads: {
        async download(o: chrome.downloads.DownloadOptions) {
          b.downloadCalls.push(clone(o));
          if (b.downloadReject) {
            const m = b.downloadReject;
            b.downloadReject = null;
            throw new Error(m);
          }
          const id = b.nextDownloadId++;
          b.downloads.set(id, {
            id, url: o.url, state: "in_progress", bytesReceived: 0, totalBytes: b.defaultTotal, fileSize: 0, filename: "",
            canResume: false, paused: false, byExtensionId: EXT_ID,
          });
          b.onDownloadCreated?.(id);
          return id;
        },
        async search(q: { id?: number }) {
          if (q.id === undefined) return [...b.downloads.values()].map(clone);
          const d = b.downloads.get(q.id);
          return d ? [clone(d)] : [];
        },
        show(id: number) {
          b.showCalls.push(id);
        },
        async cancel(id: number) {
          b.cancelCalls.push(id);
          const d = b.downloads.get(id);
          if (!d) throw new Error("Invalid download id");
          if (d.state === "in_progress") b.downloadInterrupt(id, "USER_CANCELED");
        },
        onChanged: ev.download,
        onDeterminingFilename: ev.determining,
      },
      alarms: {
        async create(name: string, info: chrome.alarms.AlarmCreateInfo) {
          b.alarms.set(name, { name, scheduledTime: Date.now() + 30_000, periodInMinutes: info.periodInMinutes, persistAcrossSessions: false } as chrome.alarms.Alarm);
        },
        async get(name: string) { return clone(b.alarms.get(name)); },
        async clear(name: string) { return b.alarms.delete(name); },
        onAlarm: ev.alarm,
      },
      identity: {
        getRedirectURL: (path = "") => `https://${EXT_ID}.chromiumapp.org/${path}`,
        async launchWebAuthFlow(details: chrome.identity.WebAuthFlowDetails) {
          b.authFlows.push(clone(details));
          if (!b.authFlow) throw new Error("The user did not approve access.");
          return b.authFlow(details.url);
        },
      },
      permissions: {
        async contains(p: { permissions?: string[] }) { return (p.permissions ?? []).every((x) => b.granted.has(x)); },
      },
    };
    if (this.granted.has("notifications")) c.notifications = this.notificationsApi();
    if (this.granted.has("nativeMessaging")) c.runtime.connectNative = this.connectNativeApi(c);
    this.chrome = c as typeof chrome;
    (globalThis as any).chrome = this.chrome;
    return this.chrome;
  }

  private notificationsApi() {
    return {
      create: async (id: string, options: unknown) => {
        this.notifications.push({ id, options: clone(options) });
        return id;
      },
    };
  }

  /**
   * Faux chrome.runtime.connectNative : un « processus » par port, réponses asynchrones dans l'ordre, fin du
   * processus quand l'extension ferme le port (comme la fin de l'entrée standard de l'hôte).
   */
  private connectNativeApi(c: any) {
    return (name: string) => {
      this.nativeNames.push(name);
      const onMessage = new FakeEvent();
      const onDisconnect = new FakeEvent();
      let open = true;
      let received = 0;
      const end = (message: string) => {
        if (!open) return;
        open = false;
        this.nativeLive--;
        c.runtime.lastError = { message };
        try {
          onDisconnect.dispatch(port);
        } finally {
          delete c.runtime.lastError;
        }
      };
      const port = {
        name, onMessage, onDisconnect,
        postMessage: (m: unknown) => {
          if (!open) throw new Error("Attempting to use a disconnected port object");
          this.nativeMessages.push(clone(m));
          received++;
          const mode = this.nativeHost;
          const n = received;
          const u = m as { type?: string; version?: string };
          if (u.type === "mettre-a-jour-extension" || u.type === "etat-extension") {
            // Hôte de Desktop 1.0.0-beta.4 (desktop/noyau/src/nm.rs) : étapes réelles, puis la réponse finale.
            const steps: [string, number, number][] = [["telechargement", 0, 900], ["telechargement", 900, 900], ["verification", 2, 2], ["installation", 12, 12]];
            setTimeout(() => {
              if (!open) return;
              if (this.nativeUpdate === "ancien") return onMessage.dispatch({ ok: false, erreur: "Type de message inconnu." });
              if (u.type === "etat-extension") return onMessage.dispatch({ ok: true, dossier: this.nativeUpdateFolder, version: "1.0.0", precedente: null });
              if (this.nativeUpdate === "refus") {
                onMessage.dispatch({ type: "avancement", etape: "telechargement", fait: 0, total: 900 });
                return onMessage.dispatch({ ok: false, erreur: "Empreinte SHA-256 différente de celle annoncée : archive altérée, rien n'est installé.", etape: "verification" });
              }
              if (this.nativeUpdate === "ok") for (const [etape, fait, total] of steps) onMessage.dispatch({ type: "avancement", etape, fait, total });
              onMessage.dispatch({ ok: true, version: u.version, dossier: this.nativeUpdateFolder, deja: this.nativeUpdate === "deja", precedente: null });
            }, 1);
            return;
          }
          if (u.type === "envoyer-premiere" || u.type === "etat-envoi") {
            // 3.8.1 : hôte de Desktop 1.1 (nm.rs) : l'envoi est accepté, puis l'état réel est rendu à chaque question.
            setTimeout(() => {
              if (!open) return;
              const id = (m as { id?: string }).id;
              if (mode === "refuse") onMessage.dispatch({ ok: false, erreur: "Champ non autorisé." });
              else if (mode === "ancien") onMessage.dispatch({ ok: false, erreur: "Type de message inconnu." });
              else if (u.type === "envoyer-premiere") onMessage.dispatch({ ok: true, id, etat: "envoye", desktop: true });
              else onMessage.dispatch({ id, ...(this.nativeRelay.length > 1 ? this.nativeRelay.shift() : this.nativeRelay[0]) });
              if (mode === "exit" && n >= this.nativeExitAfter) end("Native host has exited.");
            }, 1);
            return;
          }
          setTimeout(() => {
            if (!open) return;
            const t = m as { id?: string; etat?: string };
            if (mode === "ok" || mode === "exit") onMessage.dispatch({ ok: true, id: t.id, etat: t.etat });
            else if (mode === "refuse") onMessage.dispatch({ ok: false, erreur: "Champ non autorisé." });
            if (mode === "exit" && n >= this.nativeExitAfter) end("Native host has exited.");
          }, 1);
        },
        disconnect: () => {
          if (!open) return;
          open = false;
          this.nativeLive--;
          this.nativeClosedByExtension++;
        },
      };
      this.nativeLive++;
      this.nativeMaxLive = Math.max(this.nativeMaxLive, this.nativeLive);
      if (this.nativeHost === "absent") setTimeout(() => end("Specified native messaging host not found."), 1);
      return port;
    };
  }

  /** 3.5.2 : permission « nativeMessaging » accordée (popup ou réglages) : chrome.runtime.connectNative apparaît. */
  grantNative(): void {
    this.granted.add("nativeMessaging");
    (this.chrome as any).runtime.connectNative = this.connectNativeApi(this.chrome);
  }

  /** Permission retirée (chrome://extensions) : l'API disparaît. */
  revokeNative(): void {
    this.granted.delete("nativeMessaging");
    delete (this.chrome as any).runtime.connectNative;
  }

  /** Permission facultative accordée (par la page de réglages) : chrome.notifications apparaît. */
  grantNotifications(): void {
    this.granted.add("notifications");
    (this.chrome as any).notifications = this.notificationsApi();
  }

  // ---- messages entrants ---------------------------------------------------------------------------
  /** Message envoyé au worker ; résout la réponse, ou undefined si le worker ne répond pas (rejet). */
  send(msg: unknown, sender: chrome.runtime.MessageSender): Promise<any> {
    return new Promise((resolve) => {
      let isAsync = false;
      let done = false;
      const sendResponse = (r: unknown) => {
        if (done) return;
        done = true;
        resolve(clone(r));
      };
      for (const l of this.ev.message!.listeners) if (l(clone(msg), sender, sendResponse) === true) isAsync = true;
      if (!isAsync && !done) resolve(undefined);
    });
  }

  pageSender(path = "popup/popup.html"): chrome.runtime.MessageSender {
    return { id: EXT_ID, url: `chrome-extension://${EXT_ID}/${path}`, origin: `chrome-extension://${EXT_ID}` };
  }

  /** Page de l'extension ouverte dans un onglet (réglages : open_in_tab). */
  pageInTabSender(path = "options/options.html", tabId = 3): chrome.runtime.MessageSender {
    return { ...this.pageSender(path), tab: { id: tabId } as chrome.tabs.Tab, frameId: 0 };
  }

  contentSender(url: string, tabId = 7, extra: Partial<chrome.runtime.MessageSender> = {}): chrome.runtime.MessageSender {
    return { id: EXT_ID, url, origin: new URL(url).origin, tab: { id: tabId } as chrome.tabs.Tab, frameId: 0, ...extra };
  }

  // ---- événements du navigateur --------------------------------------------------------------------
  downloadProgress(id: number, received: number, total?: number): void {
    const d = this.downloads.get(id)!;
    d.bytesReceived = received;
    if (total !== undefined) d.totalBytes = total;
  }

  /** Écouteurs onDeterminingFilename posés en ce moment par le service worker. */
  get determiningListeners(): number {
    return this.ev.determining!.listeners.length;
  }

  /** Téléchargement lancé par une page web (pas par l'extension), connu du navigateur. */
  siteDownload(filename = "facture.pdf"): number {
    const id = this.nextDownloadId++;
    this.downloads.set(id, {
      id, url: "https://exemple.test/facture.pdf", state: "in_progress", bytesReceived: 0, totalBytes: this.defaultTotal, fileSize: 0, filename,
      canResume: false, paused: false,
    });
    return id;
  }

  /**
   * Chrome détermine le nom du téléchargement `id` (`name` : celui qu'il a tiré de Content-Disposition), comme le
   * vrai navigateur : chaque écouteur onDeterminingFilename reçoit l'élément et `suggest` ; réponse synchrone, ou
   * plus tard si l'écouteur a rendu true ; sans réponse synchrone ni true, le nom de Chrome est gardé.
   */
  async determineFilename(id: number, name: string): Promise<{ listeners: number; suggestions: Suggestion[]; sync: boolean[] }> {
    const d = this.downloads.get(id);
    const item = { id, filename: name, url: d?.url ?? "", state: "in_progress", ...(d?.byExtensionId ? { byExtensionId: d.byExtensionId } : {}) };
    const listeners = [...this.ev.determining!.listeners];
    const sync: boolean[] = [];
    const suggestions = await Promise.all(listeners.map((l) => new Promise<Suggestion>((resolve) => {
      let answered = false;
      const suggest = (s?: { filename?: string; conflictAction?: string }) => {
        if (answered) throw new Error("suggest appelé deux fois");
        answered = true;
        resolve(s ? clone(s) : null);
      };
      const r = l(clone(item), suggest);
      sync.push(answered);
      if (r !== true && !answered) {
        answered = true;
        resolve(null);
      }
    })));
    const chosen = suggestions.find((s) => s?.filename);
    if (d) d.filename = `/home/u/Téléchargements/${chosen?.filename ?? name}`;
    return { listeners: listeners.length, suggestions, sync };
  }

  downloadComplete(id: number, filename = "/home/u/Téléchargements/Vidéo [abc].mp4"): void {
    const d = this.downloads.get(id)!;
    const previous = d.state;
    d.state = "complete";
    d.filename = filename;
    d.bytesReceived = d.totalBytes;
    d.fileSize = d.totalBytes;
    this.ev.download!.dispatch({ id, state: { previous, current: "complete" }, filename: { previous: "", current: filename } });
  }

  downloadInterrupt(id: number, reason: string): void {
    const d = this.downloads.get(id)!;
    const previous = d.state;
    d.state = "interrupted";
    d.error = reason;
    d.canResume = reason !== "USER_CANCELED";
    this.ev.download!.dispatch({ id, state: { previous, current: "interrupted" }, error: { current: reason } });
  }

  fireAlarm(name: string): void {
    const a = this.alarms.get(name);
    if (a) this.ev.alarm!.dispatch(clone(a));
  }

  fireStartup(): void {
    this.ev.startup!.dispatch();
  }

  fireInstalled(reason: "install" | "update" | "chrome_update" = "install"): void {
    this.ev.installed!.dispatch({ reason });
  }

  get jobs(): any[] {
    return clone((this.store.session.get("jobs") as any[]) ?? []);
  }

  get auth(): any {
    return clone(this.store.local.get("auth"));
  }
}

/** Attend qu'une condition devienne vraie (sondage court) ; échoue après `ms`. */
export async function until(cond: () => boolean | Promise<boolean>, ms = 2000, what = "condition"): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    if (await cond()) return;
    if (Date.now() > end) throw new Error(`délai dépassé : ${what}`);
    await new Promise((r) => setTimeout(r, 2));
  }
}

export const tick = (ms = 15): Promise<void> => new Promise((r) => setTimeout(r, ms));
