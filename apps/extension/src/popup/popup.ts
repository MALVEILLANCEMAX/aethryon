// Popup AETHRYON : quota du jour en haut, vidéo détectée dans l'onglet actif, choix MP4/MP3, téléchargement
// réel suivi en direct, compte. Le popup ne parle QU'AU service worker (chrome.runtime.sendMessage) : il ne
// lit ni les onglets ni le jeton. Tout texte issu des données est posé par textContent (jamais innerHTML).
// Honnêteté :
// - « Enregistré dans Téléchargements » n'apparaît que pour l'état done (fichier écrit sur le disque) ;
// - « Connecté » seulement si le compte répond : service injoignable ou en erreur → état dégradé expliqué ;
// - clé refusée, expirée, déconnexion faite ailleurs : le popup ouvert l'apprend AUSSITÔT (auth.changed) et
//   dit pourquoi, avec « Se connecter » ;
// - tant que la notice sur les données n'est pas acceptée : ni connexion ni téléchargement, lien vers elle.
// La mascotte (src/mascot, frontière de module) suit les états RÉELS reçus du service worker.
import { ACTIVITY_URL, DASHBOARD_URL, HELP_URL, TOOLS_URL, VERSION, versionLine } from "../shared/config.ts";
import { timecode } from "../shared/clip.ts";
import { toSeconds, type ClipFormat, type RangeMs } from "../shared/extrait.ts";
import { parseLimits, type LimitsView } from "../shared/limites.ts";
import { EXTRAIT_CSS } from "../extrait/css.ts";
import { ClipEditor, type PlayerLink, type PlayerSnapshot } from "../extrait/editor.ts";
import { setApostrophe } from "../extrait/dom.ts";
import type { ExportView } from "../extrait/progress.ts";
import { RIGHTS_NOTICE } from "../shared/consent.ts";
import type { BgRequest, PopupInit, StartJob } from "../shared/messages.ts";
import {
  BITRATES, QUALITIES, type AccountView, type AuthChangeReason, type AuthNotice, type Bitrate, type ClipAnchor,
  type ClipLength, type Destination, type DetectedMedia, type Fmt, type JobError, type JobView, type Quality, type UpdateNotice,
} from "../shared/types.ts";
import { premiereReencodes } from "../shared/premiere.ts";
import { saveSettings } from "../shared/storage.ts";
import { askDesktopLink, hasDesktopLink } from "../shared/desktop.ts";
import { BUILD_PLATFORMS, PLATFORMS_OR } from "../shared/platforms.ts";
import { parseMediaUrl, PLATFORM_LABEL, safeThumbnail } from "../shared/urls.ts";
import { createMascot, type Mascot, type MascotState } from "../mascot/mascot.ts";
import { consentGate, identity, loginControl, logoutControl } from "./account-ui.ts";
import { cleanAccount, isAccountView, isJobView, onPageEvents, parseInit, send } from "./bg.ts";
import {
  DESKTOP_ASK, DESKTOP_MISSING, DEST_LABEL, DEST_TITLE, KIND_LABEL, NB, PREMIERE_HINT, PREMIERE_REENCODE, QUALITY_LABEL, RECENT_STATE, SIGNED_OUT_TEXT, WITHDRAWN_TEXT, bitrateLabel, clockTime, companionLine, degradedText,
  itemLabel, jobStatusText, knownPlatform, percent, platformLabel, plural, quotaParts, quotaRatio, relativeTime, resetText, shortUrl,
} from "./text.ts";
import { $, bindSiteLink, brandLogo, button, emptyIllustration, fill, h, icon, platformLogo, setBusy, siteLink, type IconName } from "./ui.ts";
import { loadHintCard, onUpdateProgress, updateCard } from "./update-ui.ts";

const ACTIVE = new Set<string>(["queued", "converting", "downloading"]);
const WORKING = new Set<string>(["converting", "downloading"]);
/** Une réussite ou une erreur « récente » reste exprimée par la chouette (comme sur le site). */
const RECENT_MS = 15 * 60_000;
/** Téléchargements terminés gardés dans la liste (l'historique complet est sur le site). */
const MAX_FINISHED = 5;

const state = {
  init: null as PopupInit | null,
  jobs: new Map<string, JobView>(),
  loadedOnce: false,
  fmt: "mp4" as Fmt,
  quality: "best" as Quality,
  bitrate: 192 as Bitrate,
  /** 3.5.1 : destination de « Télécharger » (vidéo ou audio entiers) ; réglage commun avec le menu des pages. */
  dest: "downloads" as Destination,
  premiereHintSeen: false,
  /** 3.5.2 : lien local avec AETHRYON Desktop autorisé (permission facultative) ; null : pas encore lu. */
  desktopGranted: null as boolean | null,
  /** Repeint la destination (lien Desktop lu ou accordé après la construction du formulaire). */
  repaintDest: null as (() => void) | null,
  index: 1,
  starting: false,
  mascot: null as Mascot | null,
  /** Déconnexion lancée depuis CE popup (l'annonce auth.changed qui suit ne doit rien rejouer). */
  loggingOut: false,
  // V3 : onglet de la carte (télécharger la vidéo ou en faire un extrait), réglages de l'extrait, lien collé.
  tab: "download" as "download" | "clip",
  clipLength: 30 as ClipLength,
  clipAnchor: "after" as ClipAnchor,
  clipOut: "mp4" as "mp4" | "mp3" | "gif",
  pasted: null as DetectedMedia | null,
  // 3.6.0 : éditeur d'extrait (gardé pendant toute la vie du popup : le passage réglé survit aux rafraîchissements),
  // l'extrait qu'il suit, et les limites annoncées par le serveur.
  editor: null as ClipEditor | null,
  editorFor: null as string | null,
  clipJobKey: null as string | null,
  limits: null as LimitsView | null,
  /** Lecteur de l'onglet (un seul : la file des demandes de position lui appartient). */
  remote: null as PlayerLink | null,
};

// ---- cadre fixe : en-tête, pied -----------------------------------------------------------------
function wireFrame(): void {
  // 3.6.0 : styles de l'éditeur d'extrait, partagés avec le menu des pages (src/extrait/css.ts) ; apostrophe droite,
  // comme tout le popup.
  setApostrophe("'");
  const style = document.createElement("style");
  style.textContent = EXTRAIT_CSS;
  document.head.append(style);
  $("brand").append(brandLogo(28, 10));
  const settings = $("open-settings");
  settings.append(icon("settings", 19));
  settings.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage().catch(() => undefined);
  });
  bindSiteLink($("help-link") as HTMLAnchorElement, HELP_URL);
  $("rights").textContent = RIGHTS_NOTICE;
  setVersion(VERSION);
}

function setVersion(v: string): void {
  $("version").textContent = versionLine(v);
}

type ConnState = "on" | "off" | "warn" | null;
function setConn(s: ConnState, label = ""): void {
  const el = $("conn");
  el.hidden = s === null;
  if (s === null) return;
  el.dataset.state = s;
  $("conn-label").textContent = label;
}

function connFor(a: AccountView): [ConnState, string] {
  if (!a.connected) return ["off", "Non connecté"];
  if (a.degraded) return ["warn", degradedText(a.degraded).pill];
  return ["on", "Connecté"];
}

// ---- chargement -----------------------------------------------------------------------------------
/** « lost » : la liaison vient de tomber (clé refusée, déconnexion ailleurs) pendant que le popup était ouvert. */
type After = "connected" | "disconnected" | "retry" | "lost";

/** job.update reçus PENDANT un chargement : peut-être plus récents que l'instantané de popup.init. */
const pushedWhileLoading = new Map<string, JobView>();
let loading = false;
/** Phrase montrée une fois après une déconnexion faite ailleurs (pas de motif serveur à garder). */
let transientNotice: string | null = null;

async function load(after?: After): Promise<void> {
  loading = true;
  pushedWhileLoading.clear();
  const res = await send<unknown>({ type: "popup.init" }, 10_000);
  loading = false;
  const init = res.ok ? parseInit(res.data) : null;
  if (!init) {
    renderFailure(res.ok ? { code: "bad_response", message: "Réponse inattendue du service de l'extension.", retryable: true } : res.error, after === "retry");
    return;
  }
  state.init = init;
  // L'instantané fait foi (jobs retirés ou effacés compris), sauf messages plus récents arrivés entre-temps.
  const next = new Map(init.jobs.map((j) => [j.key, j] as const));
  for (const j of pushedWhileLoading.values()) {
    const fresh = next.get(j.key);
    if (fresh && fresh.updatedAt < j.updatedAt) next.set(j.key, j);
  }
  pushedWhileLoading.clear();
  state.jobs = next;
  if (!state.loadedOnce) {
    state.fmt = init.settings.defaultFmt;
    state.quality = init.settings.quality;
    state.bitrate = init.settings.bitrate;
    state.dest = init.settings.destination;
    state.premiereHintSeen = init.settings.premiereHintSeen;
    state.clipLength = init.settings.clipLength;
    state.clipAnchor = init.settings.clipAnchor;
    state.loadedOnce = true;
  }
  render(init);
  if (after === "connected") focusFirst("[data-action=start]:not(:disabled)", "#media-title");
  else if (after === "disconnected" || after === "lost") focusFirst("[data-action=login]:not(:disabled)", "[data-action=open-notice]");
  else if (after === "retry") focusFirst("[data-action=start]:not(:disabled)", "[data-action=login]:not(:disabled)", "[data-action=reload]", "#media-title");
}

function focusFirst(...selectors: string[]): void {
  for (const s of selectors) {
    const el = document.querySelector<HTMLElement>(s);
    if (el) {
      el.focus();
      return;
    }
  }
}

function newMascot(size: number, s: MascotState): Mascot {
  state.mascot?.destroy();
  state.mascot = createMascot(document, { size, state: s });
  return state.mascot;
}

function render(init: PopupInit): void {
  const a = init.account;
  const gated = !init.consent.accepted;
  const connected = a.connected && !gated;
  const [conn, label] = gated ? (["off", init.consent.outdated ? "Notice à relire" : "Non connecté"] as [ConnState, string]) : connFor(a);
  setConn(conn, label);
  setVersion(init.version || VERSION);
  const notice = !a.connected ? a.notice : undefined;
  const mascot = newMascot(connected ? 60 : 84, gated ? "idle" : !connected && notice ? "curious" : "idle");
  const main = $("main");
  // Trois états (V3) : un travail en cours s'affiche en premier (le popup rouvert retrouve sa progression) ; sinon
  // la vidéo de l'onglet (télécharger, extrait, outils), ou l'invitation à coller un lien.
  const busy = [...state.jobs.values()].some((j) => ACTIVE.has(j.state));
  const jobs = jobsSection(connected ? mascot : null);
  main.dataset.view = busy ? "progress" : (init.detected ?? state.pasted) ? "media" : "empty";
  fill(main,
    updateSlot(init),
    gated ? gateCard(mascot, init.consent.outdated ? { linked: a.connected } : null) : !connected ? connectCard(mascot, notice) : null,
    // Quota visible sans défiler, en haut (exigence de la V1, vérifiée par les essais du popup).
    connected ? (a.degraded ? degradedCard(a) : quotaStrip(a)) : null,
    busy ? jobs : null,
    mediaCard(init),
    busy ? null : jobs,
    connected ? accountCard(a) : null);
  main.removeAttribute("aria-busy");
  renderJobs();
  updateCompanion(null);
}

function renderFailure(error: JobError, focusRetry = false): void {
  setConn(null);
  const mascot = newMascot(72, "error");
  const retry = button("Réessayer", { variant: "primary", icon: "retry", action: "reload" });
  retry.addEventListener("click", () => {
    setBusy(retry, true, "Chargement…");
    void load("retry");
  });
  const main = $("main");
  fill(main, h("section", { class: "card failure", "aria-labelledby": "failure-title" },
    mascot.el,
    h("h2", { id: "failure-title", class: "display" }, "Chargement impossible"),
    h("p", { class: "failure-text", role: "alert", "data-raw": "" }, error.message),
    retry));
  main.removeAttribute("aria-busy");
  if (focusRetry) retry.focus(); // nouvel échec après « Réessayer » : le focus ne se perd pas
}

// ---- notice sur les données (pas encore acceptée) -------------------------------------------------
// `changed` : notice acceptée dans une version plus ancienne (mise à jour) ; la liaison au compte, si elle existe, est gardée.
function gateCard(mascot: Mascot, changed: { linked: boolean } | null): HTMLElement {
  const text = changed
    ? `Cette version fait plus de choses (extraits, GIF, image de la vidéo, AETHRYON Tools)${NB}: relis ce que l'extension fait de tes données, puis accepte-le. ${changed.linked ? `Ta connexion est gardée${NB}; rien` : "Rien"} ne part vers un serveur avant.`
    : `Avant ta première connexion, lis ce que l'extension fait de tes données, puis accepte-le${NB}: rien ne part vers un serveur avant.`;
  return h("section", { class: "card hero", id: "gate", "aria-labelledby": "hero-title" },
    h("div", { class: "hero-top" },
      mascot.el,
      h("div", null,
        h("h2", { id: "hero-title", class: "display" }, changed ? "La notice a changé" : "Bienvenue"),
        h("p", { class: "hero-text" }, text))),
    consentGate());
}

// ---- connexion (non connecté) --------------------------------------------------------------------
/**
 * Carte de connexion. Après un refus du serveur (clé révoquée, expirée…) ou une déconnexion faite ailleurs,
 * le MOTIF est dit au-dessus du bouton, qui le référence (aria-describedby) : il est lu au focus du bouton.
 */
function connectCard(mascot: Mascot, notice?: AuthNotice): HTMLElement {
  const text = notice?.message ?? transientNotice;
  transientNotice = null;
  const login = loginControl({ block: true, describedBy: text ? "auth-notice" : undefined, onSuccess: () => load("connected"), onError: () => mascot.setState("error") });
  return h("section", { class: "card hero", "aria-labelledby": "hero-title" },
    h("div", { class: "hero-top" },
      mascot.el,
      h("div", null,
        h("h2", { id: "hero-title", class: "display" }, notice ? "Reconnecte-toi" : "Connecte-toi"),
        h("p", { class: "hero-text" }, `Connecte l'extension à ton compte AETHRYON${NB}: même compte et même quota que le raccourci iPhone.`))),
    text ? h("p", { class: "notice", id: "auth-notice", role: notice ? null : "status" }, icon("alert", 15), h("span", null, text)) : null,
    login);
}

// ---- quota du jour (en haut, visible sans défiler) -------------------------------------------------
/** Quota du jour épuisé, d'après des infos À JOUR (hors ligne ou dégradé, le serveur reste seul juge). */
function quotaReached(a: AccountView): boolean {
  if (!a.connected || a.stale || a.degraded || !a.today || a.today.limit === null) return false;
  return (a.today.remaining ?? Math.max(0, a.today.limit - a.today.used)) <= 0;
}

function quotaStrip(a: AccountView): HTMLElement | null {
  if (a.suspended) {
    return h("section", { class: "card strip", id: "quota", "data-tone": "bad", "aria-labelledby": "quota-title" },
      h("h2", { id: "quota-title", class: "eyebrow" }, "Compte"),
      h("p", { class: "notice", "data-tone": "bad" }, icon("alert", 15), h("span", null, `Ton compte AETHRYON est suspendu par un administrateur${NB}: les conversions sont refusées.`)));
  }
  if (!a.today) {
    return h("section", { class: "card strip", id: "quota", "aria-labelledby": "quota-title" },
      h("h2", { id: "quota-title", class: "eyebrow" }, "Aujourd'hui"),
      h("p", { class: "strip-empty" }, "Quota pas encore connu."));
  }
  const q = quotaParts(a.today);
  const ratio = quotaRatio(a.today);
  const meter = ratio === null ? null : h("div", { class: "meter", "aria-hidden": "true" }, h("span"));
  if (meter) (meter.firstElementChild as HTMLElement).style.transform = `scaleX(${ratio})`;
  return h("section", { class: "card strip", id: "quota", "data-tone": q.exhausted ? "bad" : q.unlimited ? "gold" : "ok", "aria-labelledby": "quota-title" },
    h("div", { class: "strip-head" },
      h("h2", { id: "quota-title", class: "eyebrow" }, "Aujourd'hui"),
      q.unlimited ? null : h("p", { class: "strip-reset", id: "quota-reset" }, resetText(a.today))),
    h("p", { class: "strip-main", id: "quota-text" }, h("span", { class: "strip-num tabular" }, q.num), " ", h("span", { class: "strip-rest" }, q.rest)),
    meter,
    q.exhausted ? h("p", { class: "strip-note", id: "quota-note" }, `Quota du jour atteint${NB}: nouvelles conversions à ${clockTime(a.today.resetAt) ?? "minuit (heure de Paris)"}.`) : null);
}

/** Compte lié, service injoignable ou en erreur : jamais « Connecté » ni un quota présenté comme à jour. */
function degradedCard(a: AccountView): HTMLElement {
  const d = degradedText(a.degraded!);
  const retry = button("Réessayer", { variant: "secondary", size: "sm", icon: "retry", action: "reload" });
  retry.addEventListener("click", () => {
    setBusy(retry, true, "Vérification…");
    void load("retry");
  });
  const who = a.email || a.name;
  const last = a.today ? `Dernier quota connu${NB}: ${quotaParts(a.today).num} ${quotaParts(a.today).rest}.` : null;
  return h("section", { class: "card strip degraded", id: "quota", "data-tone": "warn", "aria-labelledby": "degraded-title" },
    h("h2", { id: "degraded-title", class: "strip-title" }, icon(a.degraded!.reason === "network" ? "wifi" : "alert", 16), h("span", null, d.title)),
    h("p", { class: "strip-text", role: "status" }, d.text),
    h("p", { class: "strip-hint" }, `L'extension reste liée à ton compte${who ? ` (${who})` : ""}${NB}; quota et activité ne sont pas à jour.`, last ? ` ${last}` : ""),
    retry);
}

// ---- vidéo de l'onglet et conversion -------------------------------------------------------------
/** Vidéo de la carte : celle de l'onglet, sinon un lien collé dans le popup (V3). */
const mediaOf = (init: PopupInit): DetectedMedia | null => init.detected ?? state.pasted;

function mediaCard(init: PopupInit): HTMLElement {
  const d = mediaOf(init);
  const card = h("section", { class: "card media", id: "media", "aria-labelledby": "media-title" },
    h("div", { class: "card-head" },
      h("h2", { id: "media-title", class: "eyebrow", tabindex: "-1" }, init.detected || !d ? "Sur cet onglet" : "Lien collé"),
      !init.detected && d ? clearPasted() : null));
  if (d) {
    // Notice pas encore acceptée : aucune miniature chargée (« rien ne part vers un serveur avant ton accord »,
    // pas même vers les serveurs d'images des plateformes) ; le pictogramme de la plateforme reste affiché.
    card.append(mediaRow(d, { thumbnail: init.consent.accepted }));
    const count = Math.min(d.videoCount ?? 0, 50);
    if (count > 1) card.append(videoPicker(count, canDownload(init)));
    card.append(modeTabs(), state.tab === "clip" ? clipForm(init, d) : convertForm(init), quickTools(init, d));
  } else {
    card.append(emptyMedia(init.pageHint), pasteForm(init));
  }
  return card;
}

function canDownload(init: PopupInit): boolean {
  const a = init.account;
  return init.consent.accepted && a.connected && !a.suspended && !quotaReached(a) && !!mediaOf(init);
}

/** Retour à l'état « aucune vidéo » après un lien collé. */
function clearPasted(): HTMLButtonElement {
  const b = button("Effacer le lien", { variant: "quiet", size: "sm", icon: "close", action: "clear-pasted" });
  b.addEventListener("click", () => {
    state.pasted = null;
    state.tab = "download";
    if (state.init) render(state.init);
    focusFirst("#paste-url");
  });
  return b;
}

/** Télécharger la vidéo entière, ou en faire un extrait (V3) : groupe radio, flèches au clavier. */
function modeTabs(): HTMLElement {
  const swap = (t: "download" | "clip") => {
    state.tab = t;
    const form = document.querySelector<HTMLElement>("#media form.convert, #media form.clip");
    const init = state.init;
    const d = init ? mediaOf(init) : null;
    if (!form || !init || !d) return;
    form.replaceWith(t === "clip" ? clipForm(init, d) : convertForm(init));
  };
  return h("fieldset", { class: "mode" },
    h("legend", { class: "sr-only" }, "Que faire de cette vidéo"),
    h("div", { class: "seg seg-mode" },
      segOption("mode", "download", "Vidéo entière", state.tab === "download", () => swap("download"), "download"),
      segOption("mode", "clip", "Extrait", state.tab === "clip", () => swap("clip"), "cut")));
}

/**
 * 3.6.0 : lecteur de la vidéo de l'onglet actif, piloté par le service worker (le popup ne parle qu'à lui). Une seule
 * demande de position à la fois : pendant un glisser, seule la dernière position part.
 */
function remotePlayer(): PlayerLink {
  let inflight = false;
  let queued: number | null = null;
  const seek = async (t: number): Promise<void> => {
    if (inflight) {
      queued = t;
      return;
    }
    inflight = true;
    await send<unknown>({ type: "player", op: "seek", t: Math.round(t * 1000) / 1000 }, 3_000);
    inflight = false;
    if (queued !== null) {
      const q = queued;
      queued = null;
      void seek(q);
    }
  };
  return {
    pollMs: 250,
    async snapshot(): Promise<PlayerSnapshot> {
      const r = await send<PlayerSnapshot>({ type: "player", op: "times" }, 3_000);
      if (!r.ok || typeof r.data !== "object" || r.data === null) throw new Error("lecteur injoignable");
      return r.data;
    },
    seek: (t) => void seek(t),
    async preview(start, end) {
      const r = await send<PlayerSnapshot>({ type: "player", op: "preview", start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 }, 4_000);
      return r.ok && !!r.data && r.data.previewing === true;
    },
    stop: () => void send<unknown>({ type: "player", op: "stop" }, 3_000),
  };
}

/** Avancement d'un extrait (JobView du service worker) pour l'éditeur. */
function exportViewOf(j: JobView): ExportView {
  const format: ClipFormat = j.kind === "gif" ? "gif" : j.fmt === "mp3" ? "mp3" : "mp4";
  return {
    phase: j.state, etape: j.etape ?? null, progress: j.state === "done" ? 100 : percent(j.progress), format,
    error: j.error ? { code: j.error.code, message: j.error.message, retryable: j.error.retryable } : null,
    canCancel: ACTIVE.has(j.state), canShow: j.state === "done" && typeof j.downloadId === "number",
  };
}

/** Pourquoi l'export ne peut pas partir d'ici (notice, connexion, compte, quota), ou null. */
function clipBlocked(init: PopupInit): string | null {
  if (canDownload(init)) return null;
  if (!init.consent.accepted) return `Accepte d'abord la notice sur les données${NB}: rien n'est envoyé avant.`;
  if (!init.account.connected) return "Connecte-toi pour exporter un extrait.";
  if (init.account.suspended) return `Ton compte AETHRYON est suspendu${NB}: les exports sont refusés.`;
  if (quotaReached(init.account)) return `Quota du jour atteint${NB}: nouveaux exports à ${clockTime(init.account.today?.resetAt) ?? "minuit (heure de Paris)"}.`;
  return null;
}

/**
 * Extrait (3.6.0) : la même réglette que le menu des pages (deux poignées, loupe, champs HH:MM:SS.mmm), synchronisée
 * avec le lecteur de l'onglet (instant courant, aller à, lecture du passage), limites annoncées par le serveur, export
 * en MP4, MP3 ou GIF et avancement réel. Lien collé : durée inconnue, champs seuls (le serveur vérifie le passage).
 */
function clipForm(init: PopupInit, d: DetectedMedia): HTMLElement {
  if (!state.editor) {
    const ed: ClipEditor = new ClipEditor(document, {
      player: () => (state.init?.detected && mediaOf(state.init) === state.init.detected ? (state.remote ??= remotePlayer()) : null),
      export: (r, f) => void startClip(r, f),
      tools: (r) => void send<unknown>({ type: "tools.open", url: (state.init && mediaOf(state.init)?.url) || d.url, clip: toSeconds(r) }, 20_000),
      cancel: () => { if (state.clipJobKey) void onClipAction("job.cancel"); },
      show: () => {
        const j = state.clipJobKey ? state.jobs.get(state.clipJobKey) : undefined;
        if (j && typeof j.downloadId === "number") {
          try {
            chrome.downloads.show(j.downloadId);
          } catch { /* fichier déplacé */ }
        }
      },
      retry: () => { if (state.clipJobKey) void onClipAction("job.retry"); },
      formatChanged: (f) => { state.clipOut = f; },
    }, "popup");
    state.editor = ed;
  }
  const ed = state.editor;
  const live = !!init.detected && d === init.detected;
  ed.open({
    durationMs: typeof d.duration === "number" && d.duration > 0 ? Math.round(d.duration * 1000) : null,
    currentMs: live && typeof d.currentTime === "number" ? Math.round(d.currentTime * 1000) : null,
    lengthMs: state.clipLength * 1000,
    anchor: state.clipAnchor,
    format: state.clipOut,
    quality: QUALITY_LABEL[state.quality],
    keep: state.editorFor === d.url,
  });
  state.editorFor = d.url;
  ed.setBlocked(clipBlocked(init));
  ed.setToolsVisible(!!(init.account.connected && init.account.tools && init.consent.accepted));
  ed.setLimits(state.limits);
  // Un extrait de cette vidéo déjà en cours (popup rouvert) : son avancement est montré.
  const mine = [...state.jobs.values()].filter((j) => j.clip && j.url === d.url).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (mine && (state.clipJobKey === null || state.clipJobKey === mine.key)) state.clipJobKey = mine.key;
  const followed = state.clipJobKey ? state.jobs.get(state.clipJobKey) : undefined;
  ed.setJob(followed ? exportViewOf(followed) : null);
  void loadLimits();
  const form = h("form", { class: "clip", "aria-label": "Extrait", novalidate: true }, ed.el);
  form.addEventListener("submit", (e) => e.preventDefault());
  return form;
}

/** Limites des extraits (GET /limites par le service worker) ; sans réponse, l'éditeur dit qu'elles sont inconnues. */
async function loadLimits(): Promise<void> {
  const res = await send<unknown>({ type: "limits.get" }, 8_000);
  let v: LimitsView = { limits: null, quota: null, source: "indisponible" };
  if (res.ok && typeof res.data === "object" && res.data !== null) {
    const d = res.data as Record<string, unknown>;
    const q = typeof d.quota === "object" && d.quota !== null ? d.quota as Record<string, unknown> : null;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    v = { limits: parseLimits(d.limits), quota: q ? { used: num(q.used), limit: num(q.limit), remaining: num(q.remaining) } : null, source: d.source === "serveur" ? "serveur" : "indisponible" };
  }
  state.limits = v;
  state.editor?.setLimits(v);
}

async function startClip(r: RangeMs, format: ClipFormat): Promise<void> {
  const init = state.init;
  const d = init ? mediaOf(init) : null;
  const ed = state.editor;
  if (!init || !d || !ed || !canDownload(init) || state.starting) return;
  const req: StartJob = { type: "job.start", url: d.url, fmt: format === "mp3" ? "mp3" : "mp4", clip: toSeconds(r) };
  if (format === "mp4") req.quality = state.quality;
  if (format === "mp3") req.bitrate = state.bitrate;
  if (format === "gif") req.gif = true;
  if ((d.videoCount ?? 0) > 1) req.index = state.index;
  const title = d.title?.trim();
  if (title) req.title = title.slice(0, 200);
  state.starting = true;
  state.clipJobKey = null;
  ed.setJob({ phase: "sending", etape: null, progress: null, format, canCancel: false, canShow: false });
  const res = await send<unknown>(req);
  state.starting = false;
  if (!res.ok) {
    ed.setJob({ phase: "error", etape: null, progress: null, format, error: res.error, canCancel: false, canShow: false });
    state.mascot?.setState("error");
    return;
  }
  if (isJobView(res.data)) {
    state.clipJobKey = res.data.key;
    upsertJob(res.data);
    ed.setJob(exportViewOf(res.data));
  } else {
    void refreshJobs();
  }
}

async function onClipAction(type: "job.cancel" | "job.retry"): Promise<void> {
  const key = state.clipJobKey;
  if (!key) return;
  const res = await send<unknown>({ type, key });
  if (!res.ok) {
    const j = state.jobs.get(key);
    state.editor?.setJob({ ...(j ? exportViewOf(j) : { phase: "error", etape: null, progress: null, format: state.clipOut, canCancel: false, canShow: false }), phase: "error", error: res.error });
    return;
  }
  if (isJobView(res.data)) upsertJob(res.data);
}

/**
 * Outils rapides (V3) : image de la vidéo (PNG, sur l'appareil), miniature de la plateforme, et AETHRYON Tools quand
 * le serveur l'a ouvert. Une image demande la vidéo de l'onglet (pas un lien collé).
 */
function quickTools(init: PopupInit, d: DetectedMedia): HTMLElement {
  const error = h("p", { class: "form-error", id: "tools-error", role: "alert" });
  const consent = init.consent.accepted;
  const run = async (b: HTMLButtonElement, msg: BgRequest, busyLabel: string) => {
    if (b.getAttribute("aria-busy") === "true") return;
    error.textContent = "";
    setBusy(b, true, busyLabel);
    const res = await send<unknown>(msg, 20_000);
    if (b.isConnected) setBusy(b, false);
    if (!res.ok) {
      error.textContent = res.error.message;
      return;
    }
    if (isJobView(res.data)) upsertJob(res.data);
  };
  const frame = button("Image", { variant: "secondary", size: "sm", icon: "camera", action: "frame", ariaLabel: "Enregistrer l'image affichée de la vidéo (PNG)" });
  frame.disabled = !consent || !init.detected;
  frame.addEventListener("click", () => void run(frame, { type: "frame.capture" }, "Capture…"));
  const thumbUrl = safeThumbnail(d.thumbnail);
  const thumb = button("Miniature", { variant: "secondary", size: "sm", icon: "image", action: "thumb", ariaLabel: "Enregistrer la miniature de la vidéo" });
  thumb.disabled = !consent || !thumbUrl;
  thumb.addEventListener("click", () => {
    if (thumbUrl) void run(thumb, { type: "thumb.save", url: d.url, thumbnail: thumbUrl, ...(d.title ? { title: d.title.slice(0, 200) } : {}) }, "Envoi…");
  });
  const tools = init.account.connected && init.account.tools && consent
    ? button("Tools", { variant: "secondary", size: "sm", icon: "studio", action: "tools", ariaLabel: "Ouvrir cette vidéo dans AETHRYON Tools (nouvel onglet)" })
    : null;
  tools?.addEventListener("click", () => void run(tools, { type: "tools.open", url: d.url }, "Ouverture…"));
  return h("div", { class: "quick", role: "group", "aria-label": "Outils rapides" },
    h("div", { class: "quick-row" }, frame, thumb, tools), error);
}

/** État « aucune vidéo » (V3) : coller un lien YouTube, TikTok ou X, ou ouvrir AETHRYON Tools. */
function pasteForm(init: PopupInit): HTMLElement {
  const input = h("input", { id: "paste-url", name: "url", type: "url", inputmode: "url", autocomplete: "off", spellcheck: false, placeholder: "Lien de la vidéo", class: "paste-input" });
  const error = h("p", { class: "form-error", id: "paste-error", role: "alert" });
  const use = button("Utiliser", { variant: "secondary", size: "sm", icon: "link", action: "paste" });
  use.type = "submit";
  const form = h("form", { class: "paste", novalidate: true, "aria-label": "Coller un lien" },
    h("label", { class: "field-label", for: "paste-url" }, `Ou colle le lien d'une vidéo ${PLATFORMS_OR}`),
    h("div", { class: "paste-row" }, input, use), error);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const ref = parseMediaUrl(input.value.trim());
    if (!ref) {
      error.textContent = `Ce lien n'est pas pris en charge${NB}: colle le lien d'une vidéo ${PLATFORMS_OR}.`;
      input.focus();
      return;
    }
    state.pasted = { platform: ref.platform, kind: ref.kind, url: ref.url, id: ref.id };
    state.tab = "download";
    render(init);
    focusFirst("[data-action=start]:not(:disabled)", "#media-title");
  });
  return h("div", { class: "paste-wrap" }, form,
    init.account.connected && init.account.tools ? siteLink("Ouvrir AETHRYON Tools", TOOLS_URL, { className: "btn btn-quiet btn-sm", icon: "studio" }) : null);
}

function mediaRow(d: DetectedMedia, { thumbnail = true }: { thumbnail?: boolean } = {}): HTMLElement {
  // Boîte de taille fixe (16:9) : aucune variation de mise en page, image ou non.
  const thumb = h("div", { class: "thumb" }, platformLogo(d.platform, 22));
  const src = thumbnail ? safeThumbnail(d.thumbnail) : null;
  if (src) {
    const img = h("img", { class: "thumb-img", src, alt: "", width: 112, height: 63, decoding: "async", referrerpolicy: "no-referrer" });
    img.addEventListener("load", () => { thumb.dataset.loaded = "true"; }, { once: true });
    img.addEventListener("error", () => img.remove(), { once: true });
    thumb.append(img);
  }
  const title = d.title?.trim();
  return h("div", { class: "media-row" },
    thumb,
    h("div", { class: "media-meta" },
      h("p", { class: "media-platform" }, platformLogo(d.platform, 14), h("span", null, `${PLATFORM_LABEL[d.platform]} · ${KIND_LABEL[d.kind]}`)),
      title
        ? h("p", { class: "media-title", dir: "auto", title, "data-raw": "" }, title)
        : h("p", { class: "media-title", "data-missing": "true" }, "Titre indisponible"),
      timeLine(d) ?? h("p", { class: "media-url", title: d.url, "data-raw": "" }, shortUrl(d.url))));
}

/** « 12:34 · lecture à 1:23 » quand la page les connaît (V3), sinon null (l'adresse est montrée). */
function timeLine(d: DetectedMedia): HTMLElement | null {
  const parts = [d.duration ? timecode(d.duration) : null, typeof d.currentTime === "number" && d.currentTime > 0 ? `lecture à ${timecode(d.currentTime)}` : null].filter(Boolean);
  return parts.length ? h("p", { class: "media-url tabular", title: d.url, "data-raw": "" }, parts.join(" · ")) : null;
}

function emptyMedia(hint: string | null): HTMLElement {
  return h("div", { class: "empty" },
    emptyIllustration(),
    h("p", { class: "empty-title" }, "Aucune vidéo détectée"),
    hint
      ? h("p", { class: "empty-text", "data-raw": "" }, hint)
      : h("p", { class: "empty-text" }, `Ouvre une vidéo ${PLATFORMS_OR} dans cet onglet, puis clique à nouveau sur AETHRYON.`),
    h("div", { class: "pf-row", "aria-hidden": "true" }, ...BUILD_PLATFORMS.map((p) => platformLogo(p, 20))));
}

function segOption(name: string, value: string, label: string, checked: boolean, onSelect: () => void, ic?: IconName): HTMLLabelElement {
  const input = h("input", { type: "radio", name, value, checked });
  input.addEventListener("change", () => { if (input.checked) onSelect(); });
  return h("label", { class: "seg-opt" }, input, h("span", null, ic ? icon(ic, 15) : null, label));
}

function selectBox(select: HTMLSelectElement): HTMLElement {
  return h("span", { class: "select" }, select, icon("chevron", 16));
}

/** Publication X avec plusieurs vidéos : « Vidéo 1, 2… » (paramètre index de l'API). */
function videoPicker(count: number, enabled: boolean): HTMLElement {
  if (state.index > count) state.index = 1;
  const legend = `Cette publication contient ${count} vidéos`;
  if (count <= 4) {
    const seg = h("div", { class: "seg" });
    for (let i = 1; i <= count; i++) seg.append(segOption("video-index", String(i), `Vidéo ${i}`, i === state.index, () => { state.index = i; }));
    return h("fieldset", { class: "picker", disabled: !enabled }, h("legend", { class: "field-label" }, legend), seg);
  }
  const sel = h("select", { id: "video-index", disabled: !enabled },
    ...Array.from({ length: count }, (_, k) => h("option", { value: String(k + 1), selected: k + 1 === state.index }, `Vidéo ${k + 1} / ${count}`)));
  sel.addEventListener("change", () => { state.index = Number(sel.value) || 1; });
  return h("div", { class: "picker" }, h("label", { class: "field-label", for: "video-index" }, legend), selectBox(sel));
}

function convertForm(init: PopupInit): HTMLElement {
  const a = init.account;
  const gated = !init.consent.accepted;
  const connected = a.connected && !gated;
  const suspended = connected && a.suspended === true;
  const exhausted = quotaReached(a);
  const d = init.detected;
  const enabled = canDownload(init);

  const quality = h("select", { id: "quality", name: "quality" },
    ...QUALITIES.map((q) => h("option", { value: q, selected: q === state.quality }, QUALITY_LABEL[q])));
  const bitrate = h("select", { id: "bitrate", name: "bitrate" },
    ...BITRATES.map((b) => h("option", { value: String(b), selected: b === state.bitrate }, bitrateLabel(b))));
  bitrate.addEventListener("change", () => { state.bitrate = Number(bitrate.value) as Bitrate; });

  // Destination (3.5.1) : « Envoyer vers » › Téléchargements | Premiere Pro, mémorisée (même réglage que le menu
  // des pages). 3.5.2 : choisir « Premiere Pro » demande, dans le geste, la permission du lien avec AETHRYON Desktop.
  const destNote = h("p", { class: "hint dest-note", id: "dest-note" }, icon("info", 15), h("span"));
  const allow = button("Autoriser", { variant: "secondary", size: "sm", action: "desktop-allow", describedBy: "dest-link-text" });
  const destLink = h("div", { class: "hint dest-link", id: "dest-link" }, icon("info", 15),
    h("div", { class: "dest-link-body" }, h("span", { id: "dest-link-text" }, DESKTOP_ASK), allow));
  const paintDest = () => {
    const premiere = state.dest === "premiere";
    const text = !premiere ? "" : !state.premiereHintSeen ? PREMIERE_HINT : state.fmt === "mp4" && premiereReencodes(state.quality) ? PREMIERE_REENCODE : "";
    destNote.lastElementChild!.textContent = text;
    destNote.hidden = !text;
    destLink.hidden = !(premiere && state.desktopGranted === false);
    const auto = quality.querySelector<HTMLOptionElement>('option[value="best"]');
    if (auto) auto.textContent = premiere ? `${QUALITY_LABEL.best} (jusqu'à 1080p)` : QUALITY_LABEL.best;
  };
  state.repaintDest = paintDest;
  /** Demande DANS le geste (avant tout await) ; refus : la ligne « Autoriser » reste, le dossier suffit. */
  const askDesktop = () => {
    if (state.desktopGranted === true || allow.getAttribute("aria-busy") === "true") return;
    allow.setAttribute("aria-busy", "true");
    void askDesktopLink().then((granted) => {
      allow.removeAttribute("aria-busy");
      state.desktopGranted = granted;
      state.repaintDest?.();
    });
  };
  allow.addEventListener("click", askDesktop);
  const setDest = (v: Destination) => {
    if (v === "premiere") askDesktop();
    state.dest = v;
    paintDest();
    saveSettings({ destination: v }).catch(() => { /* gardé pour ce popup ; réessayé au prochain choix */ });
  };
  const destSeg = h("div", { class: "seg" },
    segOption("dest", "downloads", DEST_LABEL.downloads, state.dest === "downloads", () => setDest("downloads")),
    segOption("dest", "premiere", DEST_LABEL.premiere, state.dest === "premiere", () => setDest("premiere")));
  const dField = h("fieldset", { class: "field dest-field", "aria-describedby": "dest-note" }, h("legend", { class: "field-label" }, DEST_TITLE), destSeg, destNote, destLink);
  quality.addEventListener("change", () => { state.quality = quality.value as Quality; paintDest(); });

  const qField = h("div", { class: "field", hidden: state.fmt !== "mp4" }, h("label", { class: "field-label", for: "quality" }, "Qualité"), selectBox(quality));
  const bField = h("div", { class: "field", hidden: state.fmt !== "mp3" }, h("label", { class: "field-label", for: "bitrate" }, "Débit"), selectBox(bitrate));
  const setFmt = (f: Fmt) => {
    state.fmt = f;
    qField.hidden = f !== "mp4";
    bField.hidden = f !== "mp3";
    paintDest();
  };
  const fmtSeg = h("div", { class: "seg" },
    segOption("fmt", "mp4", "MP4", state.fmt === "mp4", () => setFmt("mp4"), "film"),
    segOption("fmt", "mp3", "MP3", state.fmt === "mp3", () => setFmt("mp3"), "music"));

  const grid = h("fieldset", { class: "convert-grid", disabled: !enabled },
    h("legend", { class: "sr-only" }, "Options de conversion"),
    h("fieldset", { class: "field" }, h("legend", { class: "field-label" }, "Format"), fmtSeg),
    qField, bField, dField);
  paintDest();

  const why = gated ? `Accepte d'abord la notice sur les données${NB}: rien n'est envoyé avant.`
    : !connected
      ? (d ? "Connecte-toi pour télécharger cette vidéo." : `Connecte-toi, puis ouvre une vidéo ${PLATFORMS_OR}.`)
      : suspended ? `Ton compte AETHRYON est suspendu${NB}: les conversions sont refusées.`
        : exhausted ? `Quota du jour atteint${NB}: nouvelles conversions possibles à ${clockTime(a.today?.resetAt) ?? "minuit (heure de Paris)"}.`
          : !d ? "Aucune vidéo à télécharger sur cet onglet." : null;
  const hint = why ? h("p", { class: "hint", id: "convert-hint" }, icon("info", 15), h("span", null, why)) : null;
  const btn = button("Télécharger", { variant: "primary", size: "lg", block: true, icon: "download", action: "start", describedBy: hint ? "convert-hint" : undefined });
  btn.type = "submit";
  btn.disabled = !enabled;
  const error = h("p", { class: "form-error", id: "convert-error", role: "alert" });
  const form = h("form", { class: "convert", "aria-label": "Téléchargement", novalidate: true }, grid, btn, hint, error);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void start(btn, error);
  });
  return form;
}

async function start(btn: HTMLButtonElement, error: HTMLElement): Promise<void> {
  const init = state.init;
  const d = init ? mediaOf(init) : null;
  if (!init || !d || !canDownload(init) || state.starting) return;
  await startJob(btn, error, d, { fmt: state.fmt });
}

async function startJob(btn: HTMLButtonElement, error: HTMLElement, d: DetectedMedia, o: { fmt: Fmt; clip?: { start: number; end: number }; gif?: boolean }): Promise<void> {
  const req: StartJob = { type: "job.start", url: d.url, fmt: o.fmt };
  if (o.fmt === "mp4" && !o.gif) req.quality = state.quality;
  if (o.fmt === "mp3") req.bitrate = state.bitrate;
  if (o.clip) req.clip = o.clip;
  if (o.gif) req.gif = true;
  // Premiere Pro : vidéo ou audio entiers (« Télécharger ») ; un extrait ou un GIF reste dans Téléchargements.
  const premiere = state.dest === "premiere" && !o.clip && !o.gif;
  if (premiere) req.dest = "premiere";
  if ((d.videoCount ?? 0) > 1) req.index = state.index;
  const title = d.title?.trim();
  if (title) req.title = title.slice(0, 200);

  state.starting = true;
  error.textContent = "";
  setBusy(btn, true, "Envoi…");
  const res = await send<unknown>(req);
  state.starting = false;
  setBusy(btn, false);
  if (!res.ok) {
    error.textContent = res.error.message;
    state.mascot?.setState("error");
    return;
  }
  if (premiere && !state.premiereHintSeen) {
    state.premiereHintSeen = true; // l'explication a servi : plus montrée ensuite
    saveSettings({ premiereHintSeen: true }).catch(() => {});
  }
  if (isJobView(res.data)) {
    upsertJob(res.data);
    findJobItem(res.data.key)?.scrollIntoView({ block: "nearest" }); // la nouvelle ligne est visible
  } else {
    void refreshJobs();
  }
}

// ---- téléchargements ----------------------------------------------------------------------------
function jobsSection(mascot: Mascot | null): HTMLElement {
  const title = h("h2", { id: "jobs-title", class: "eyebrow", tabindex: "-1" }, "Téléchargements");
  const head = mascot
    ? h("div", { class: "companion" },
      mascot.el,
      h("div", { class: "companion-text" },
        title,
        // Annonce polie des CHANGEMENTS d'état (pas de chaque pourcentage, pour ne pas saturer la synthèse vocale).
        h("p", { id: "companion-line", class: "companion-line", role: "status", "aria-live": "polite" }, companionLine(latestJob()))))
    : title;
  return h("section", { class: "jobs", id: "jobs", "aria-labelledby": "jobs-title" }, head, h("div", { id: "job-slot" }));
}

function visibleJobs(): JobView[] {
  const all = [...state.jobs.values()];
  const active = all.filter((j) => ACTIVE.has(j.state)).sort((a, b) => b.createdAt - a.createdAt);
  const finished = all.filter((j) => !ACTIVE.has(j.state)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_FINISHED);
  return [...active, ...finished];
}

/** Le téléchargement que la chouette regarde : celui qui travaille, sinon le plus récemment mis à jour. */
function latestJob(): JobView | null {
  let best: JobView | null = null;
  for (const j of state.jobs.values()) {
    if (!best) { best = j; continue; }
    const jw = WORKING.has(j.state), bw = WORKING.has(best.state);
    if ((jw && !bw) || (jw === bw && j.updatedAt > best.updatedAt)) best = j;
  }
  return best;
}

function moodFor(job: JobView | null): MascotState {
  if (!job) return "idle";
  const recent = Date.now() - job.updatedAt < RECENT_MS;
  if (WORKING.has(job.state) || job.state === "queued") return "processing";
  if (job.state === "done") return recent ? "success" : "idle";
  if (job.state === "error") return recent ? "error" : "idle";
  return "idle";
}

/** Met à jour la phrase d'état (annoncée si elle change) et la chouette. changed : job qui vient de changer d'état. */
function updateCompanion(changed: JobView | null): void {
  const latest = latestJob();
  const line = document.getElementById("companion-line");
  const text = companionLine(latest);
  if (line && line.textContent !== text) line.textContent = text;
  const init = state.init;
  if (!init?.account.connected || !init.consent.accepted || !state.mascot) return;
  // Nouvelle fin réelle (fichier enregistré) : le clin d'œil et le rebond sont rejoués.
  const replay = !!changed && !!latest && changed.key === latest.key && latest.state === "done";
  state.mascot.setState(moodFor(latest), { replay });
}

function upsertJob(job: JobView): void {
  const prev = state.jobs.get(job.key);
  if (prev && prev.updatedAt > job.updatedAt) return; // message en retard : on garde le plus récent
  // Déconnecté : la liste a été vidée ; un état final tardif d'un job effacé ne la remplit pas de nouveau.
  if (!prev && state.init && !state.init.account.connected && !ACTIVE.has(job.state)) return;
  state.jobs.set(job.key, job);
  renderJobs();
  // 3.6.0 : l'extrait suivi par l'éditeur avance (étapes réelles, pourcentage seulement s'il est mesuré).
  if (state.editor && job.key === state.clipJobKey) state.editor.setJob(exportViewOf(job));
  const transition = !prev || prev.state !== job.state;
  updateCompanion(transition ? job : null);
  // Clé refusée par le serveur pendant que le popup est ouvert : retour immédiat à la connexion, avec le motif
  // (auth.changed arrive aussi ; le premier des deux suffit).
  if (transition && job.state === "error" && job.error?.code === "auth_required" && state.init?.account.connected) {
    lost();
    return;
  }
  if (transition && (job.state === "done" || job.state === "error")) scheduleAccountRefresh();
}

function removeJob(key: string): void {
  const li = findJobItem(key);
  const hadFocus = !!li && li.contains(document.activeElement);
  const neighbour = (li?.nextElementSibling ?? li?.previousElementSibling) as HTMLElement | null;
  state.jobs.delete(key);
  renderJobs();
  updateCompanion(null);
  if (hadFocus) {
    const target = neighbour?.isConnected ? (neighbour.querySelector<HTMLElement>("[data-action]") ?? neighbour) : document.getElementById("jobs-title");
    target?.focus();
  }
}

async function refreshJobs(): Promise<void> {
  const res = await send<unknown>({ type: "jobs.list" }, 10_000);
  if (!res.ok || !Array.isArray(res.data)) return;
  const fresh = res.data.filter(isJobView);
  const keys = new Set(fresh.map((j) => j.key));
  for (const key of [...state.jobs.keys()]) if (!keys.has(key)) state.jobs.delete(key);
  let changed: JobView | null = null;
  for (const j of fresh) {
    const prev = state.jobs.get(j.key);
    if (prev && prev.updatedAt > j.updatedAt) continue;
    if (!prev || prev.state !== j.state) changed = j;
    state.jobs.set(j.key, j);
  }
  renderJobs();
  updateCompanion(changed);
}

function findJobItem(key: string): HTMLLIElement | null {
  return document.querySelector<HTMLLIElement>(`li.job[data-key="${CSS.escape(key)}"]`);
}

function renderJobs(): void {
  const slot = document.getElementById("job-slot");
  const section = document.getElementById("jobs");
  if (!slot || !section) return;
  const jobs = visibleJobs();
  section.hidden = !(state.init?.account.connected && state.init.consent.accepted) && jobs.length === 0;
  let list = slot.querySelector<HTMLUListElement>("ul.job-list");
  if (!jobs.length) {
    list?.remove();
    return;
  }
  if (!list) {
    list = h("ul", { class: "job-list card", "aria-labelledby": "jobs-title" });
    slot.append(list);
  }
  const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement : null;
  const keep = new Set(jobs.map((j) => j.key));
  for (const li of [...list.querySelectorAll<HTMLLIElement>(":scope > li.job")]) if (!keep.has(li.dataset.key ?? "")) li.remove();
  let prev: Element | null = null;
  for (const job of jobs) {
    const li = findJobItem(job.key) ?? h("li", { class: "job", "data-key": job.key, tabindex: "-1" });
    updateJobItem(li, job);
    const want: Element | null = prev ? prev.nextElementSibling : list.firstElementChild;
    if (want !== li) list.insertBefore(li, want);
    prev = li;
  }
  // Un élément déplacé perd le focus : on le lui rend.
  if (focused && focused.isConnected && document.activeElement !== focused) focused.focus();
}

/** Signature de tout ce qui change la structure d'une ligne (la progression seule ne la reconstruit pas). */
function signature(j: JobView): string {
  return [j.state, j.platform, j.title ?? "", j.url, j.fmt, j.quality ?? "", j.bitrate ?? "", j.index ?? "", j.kind ?? "", j.jobId ?? "", j.desktop ?? "",
    j.clip ? `${j.clip.start}-${j.clip.end}` : "", typeof j.downloadId === "number", j.error?.message ?? "", j.error?.retryable ?? ""].join("|");
}

function updateJobItem(li: HTMLLIElement, job: JobView): void {
  li.dataset.state = job.state;
  const sig = signature(job);
  if (li.dataset.sig === sig) {
    // Même structure : seuls le texte d'état et la barre bougent.
    const text = li.querySelector(".job-status-text");
    if (text) text.textContent = jobStatusText(job);
    const bar = li.querySelector<HTMLElement>(".progress");
    if (bar) setProgress(bar, job);
    return;
  }
  const active = document.activeElement instanceof HTMLElement && li.contains(document.activeElement) ? document.activeElement : null;
  const action = active?.dataset.action ?? null;
  buildJobItem(li, job);
  li.dataset.sig = sig;
  if (active) {
    // L'action disparue (ex. « Annuler » une fois le fichier enregistré) : le focus va à l'action suivante.
    const target = (action && li.querySelector<HTMLElement>(`[data-action="${action}"]`)) || li.querySelector<HTMLElement>("[data-action]") || li;
    target.focus();
  }
}

function buildJobItem(li: HTMLLIElement, job: JobView): void {
  const titleId = `job-title-${job.key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const title = job.title?.trim();
  const meta = `${platformLabel(job.platform)} · ${itemLabel(job)}${job.index ? ` · Vidéo ${job.index}` : ""}${job.dest === "premiere" ? ` · ${DEST_LABEL.premiere}` : ""}`;
  fill(li,
    h("span", { class: "job-icon" }, platformLogo(job.platform, 16)),
    h("div", { class: "job-body" },
      h("p", { class: "job-title", id: titleId, dir: "auto", title: title || job.url, "data-raw": "" }, title || shortUrl(job.url)),
      h("p", { class: "job-meta" }, meta),
      statusLine(job),
      // 3.5.2 : envoi vers Premiere que l'hôte du Desktop n'a pas reçu : une ligne calme, jamais une erreur.
      job.dest === "premiere" && job.desktop === "absent" && job.state !== "error" && job.state !== "cancelled"
        ? h("p", { class: "job-note" }, DESKTOP_MISSING) : null,
      WORKING.has(job.state) ? progressBar(job, titleId) : null,
      jobActions(job, titleId)));
}

function statusLine(job: JobView): HTMLElement {
  const tone = job.state === "done" ? "ok" : job.state === "error" ? "bad" : "neutral";
  const mark = job.state === "done" ? icon("check", 15)
    : job.state === "error" ? icon("alert", 15)
      : job.state === "cancelled" ? icon("close", 15)
        : job.state === "queued" ? icon("clock", 15)
          : h("span", { class: "dot", "aria-hidden": "true" });
  return h("p", { class: "job-status", "data-tone": tone },
    mark,
    h("span", { class: "job-status-text", "data-raw": job.state === "error" ? "" : undefined }, jobStatusText(job)));
}

function progressBar(job: JobView, labelledBy: string): HTMLElement {
  const bar = h("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-labelledby": labelledBy },
    h("span", { class: "progress-fill" }));
  setProgress(bar, job);
  return bar;
}

function setProgress(bar: HTMLElement, job: JobView): void {
  const p = percent(job.progress);
  const fillEl = bar.firstElementChild as HTMLElement | null;
  bar.setAttribute("aria-valuetext", jobStatusText(job));
  if (p === null) {
    // Avancement inconnu : barre indéterminée (pas d'aria-valuenow), aucune valeur inventée.
    bar.dataset.indeterminate = "true";
    bar.removeAttribute("aria-valuenow");
    if (fillEl) fillEl.style.transform = "";
  } else {
    delete bar.dataset.indeterminate;
    bar.setAttribute("aria-valuenow", String(p));
    if (fillEl) fillEl.style.transform = `scaleX(${p / 100})`;
  }
}

function jobActions(job: JobView, titleId: string): HTMLElement | null {
  const btns: HTMLButtonElement[] = [];
  const add = (label: string, action: string, ic: IconName, variant: "secondary" | "quiet" = "secondary") => {
    const b = button(label, { variant, size: "sm", icon: ic, action, describedBy: titleId });
    b.addEventListener("click", () => void onJobAction(job.key, action, b));
    btns.push(b);
  };
  if (ACTIVE.has(job.state)) add("Annuler", "cancel", "stop");
  if (job.state === "done" && typeof job.downloadId === "number") add("Afficher", "show", "folder");
  // V3 : le média déjà récupéré par le serveur s'ouvre dans AETHRYON Tools (aucun nouveau téléchargement).
  if (state.init?.account.tools && job.jobId && !job.kind?.match(/^(frame|thumb)$/) && (job.state === "done" || job.state === "converting" || job.state === "downloading")) {
    add("Tools", "tools", "studio");
  }
  if (job.state === "error" && job.error?.retryable) add("Réessayer", "retry", "retry");
  if (job.state === "done" || job.state === "error" || job.state === "cancelled") add("Retirer", "dismiss", "close", "quiet");
  return btns.length ? h("div", { class: "job-actions" }, ...btns) : null;
}

function jobAlert(li: Element | null, message: string): void {
  const body = li?.querySelector(".job-body");
  if (!body) return;
  body.querySelector(":scope > .form-error")?.remove();
  body.append(h("p", { class: "form-error", role: "alert", "data-raw": "" }, message));
}

async function onJobAction(key: string, action: string, btn: HTMLButtonElement): Promise<void> {
  const job = state.jobs.get(key);
  if (!job || btn.getAttribute("aria-busy") === "true") return;
  const li = btn.closest("li.job");
  li?.querySelector(".job-body > .form-error")?.remove();
  if (action === "show") {
    if (typeof job.downloadId !== "number") return;
    try {
      chrome.downloads.show(job.downloadId);
    } catch {
      jobAlert(li, `Impossible d'afficher le fichier${NB}: il a peut-être été déplacé ou supprimé.`);
    }
    return;
  }
  if (action === "tools") {
    setBusy(btn, true);
    const res = await send<unknown>({ type: "tools.open", key }, 20_000);
    if (btn.isConnected) setBusy(btn, false);
    if (!res.ok) jobAlert(li, res.error.message);
    return;
  }
  const type = action === "cancel" ? "job.cancel" : action === "retry" ? "job.retry" : "job.dismiss";
  setBusy(btn, true);
  const res = await send<unknown>({ type, key });
  if (!res.ok) {
    if (btn.isConnected) setBusy(btn, false);
    jobAlert(li, res.error.message);
    return;
  }
  if (action === "dismiss") {
    removeJob(key);
    return;
  }
  if (isJobView(res.data)) upsertJob(res.data);
  else {
    if (btn.isConnected) setBusy(btn, false);
    void refreshJobs();
  }
}

// ---- compte -------------------------------------------------------------------------------------
function accountCard(a: AccountView): HTMLElement {
  const active = typeof a.activeJobs === "number" ? Math.max(0, Math.round(a.activeJobs)) : null;
  const recent = (a.recent ?? []).slice(0, 5);
  return h("section", { class: "card account", id: "account", "aria-labelledby": "account-title" },
    h("h2", { id: "account-title", class: "eyebrow" }, "Compte"),
    identity(a),
    active === null || a.degraded ? null : h("div", { class: "stats" },
      h("div", { class: "stat" },
        h("p", { class: "stat-label" }, "En cours sur le serveur"),
        h("p", { class: "stat-value tabular" }, active === 0 ? "Aucune conversion" : `${active} ${plural(active, "conversion", "conversions")}`))),
    a.stale && !a.degraded ? h("p", { class: "note" }, icon("info", 14), "Infos du compte non actualisées") : null,
    h("div", { class: "links" },
      siteLink("Tableau de bord", DASHBOARD_URL, { className: "btn btn-secondary btn-sm", icon: "external" }),
      siteLink("Historique", ACTIVITY_URL, { className: "btn btn-secondary btn-sm", icon: "external" }),
      a.tools ? siteLink("AETHRYON Tools", TOOLS_URL, { className: "btn btn-secondary btn-sm", icon: "studio" }) : null),
    h("h3", { class: "subhead" }, a.degraded ? "Activité récente (dernière connue)" : "Activité récente"),
    recent.length
      ? h("ul", { class: "recent" }, ...recent.map((r) => {
        const st = RECENT_STATE[r.state] ?? { tone: "neutral" as const, label: r.state };
        // Pictogramme neutre v3 de la plateforme (le même que dans la liste des téléchargements), décoratif :
        // le nom est écrit à côté. Plateforme inconnue : texte seul.
        const pf = knownPlatform(r.platform);
        return h("li", null,
          h("span", { class: "recent-main" }, pf ? platformLogo(pf, 14) : null,
            h("span", null, `${r.platform ? platformLabel(r.platform) : "Source inconnue"} · ${r.fmt.toUpperCase()}`)),
          h("span", { class: "recent-time" }, relativeTime(r.createdAt)),
          h("span", { class: "badge", "data-tone": st.tone }, st.label),
          r.errorMessage ? h("p", { class: "recent-error", "data-raw": "" }, r.errorMessage) : null);
      }))
      : h("p", { class: "recent-empty" }, a.degraded ? "Activité indisponible pour le moment." : "Aucune conversion récente."),
    logoutControl(async () => {
      state.loggingOut = true;
      state.jobs.clear();
      await load("disconnected");
      state.loggingOut = false;
    }));
}

let accountTimer: ReturnType<typeof setTimeout> | undefined;
/** Après une fin (réussie ou non), le quota a changé côté serveur : on redemande le compte. */
function scheduleAccountRefresh(): void {
  if (!state.init?.account.connected) return;
  clearTimeout(accountTimer);
  accountTimer = setTimeout(async () => {
    const res = await send<unknown>({ type: "account.refresh" }, 10_000);
    if (!res.ok) {
      if (res.error.code === "auth_required" && state.init?.account.connected) lost(); // clé refusée à l'instant
      return;
    }
    if (!isAccountView(res.data) || !state.init) return;
    const acc = cleanAccount(res.data);
    if (!acc.connected) {
      lost(); // clé révoquée entre-temps : retour à l'écran de connexion, avec le motif
      return;
    }
    const before = state.init.account;
    if (acc.suspended !== before.suspended || quotaReached(acc) !== quotaReached(before) || !!acc.degraded !== !!before.degraded) {
      void load(); // suspension, réactivation, quota atteint, service tombé ou revenu : le popup change
      return;
    }
    state.init.account = acc;
    const strip = document.getElementById("quota");
    const fresh = acc.degraded ? degradedCard(acc) : quotaStrip(acc);
    if (strip && fresh && !strip.contains(document.activeElement)) strip.replaceWith(fresh);
    const old = document.getElementById("account");
    // Pas de remplacement sous les doigts de l'utilisateur (confirmation de déconnexion ouverte, focus).
    if (old && !old.contains(document.activeElement) && !old.querySelector(".confirm")) old.replaceWith(accountCard(acc));
  }, 800);
}

/** La liaison vient de tomber pendant que le popup est ouvert : liste vidée, connexion avec le motif. */
let lostPending = false;
function lost(message?: string | null): void {
  if (lostPending) return;
  lostPending = true;
  state.jobs.clear();
  if (message) transientNotice = message;
  void load("lost").finally(() => {
    lostPending = false;
  });
}

function onAuthChanged(e: { connected: boolean; reason: AuthChangeReason; message?: string }): void {
  if (!state.init) return;
  if (e.connected) {
    // Connexion faite ailleurs (page d'accueil, réglages) : le popup suit.
    if (!state.init.account.connected) void load("connected");
    return;
  }
  if (state.loggingOut) return; // déconnexion lancée ici : déjà en cours de rechargement
  const wasConnected = state.init.account.connected;
  if (!wasConnected && e.reason !== "withdrawn") return;
  // Motif serveur : popup.init le rend (storage) ; déconnexion voulue ailleurs : phrase dite une fois.
  lost(e.reason === "signed_out" ? SIGNED_OUT_TEXT : e.reason === "withdrawn" ? WITHDRAWN_TEXT : null);
}

/** Avis de mise à jour, ou (prioritaire) l'explication du chargement unique depuis le dossier AETHRYON. */
function updateSlot(init: PopupInit): HTMLElement | null {
  if (init.loadHint) return loadHintCard(init.loadHint, { onDismissed: () => { if (state.init) state.init.loadHint = null; document.getElementById("update-hint")?.remove(); if (state.init?.update) onUpdateChanged(state.init.update); } });
  return init.update ? updateCard(init.update, { onDismissed: () => document.getElementById("update")?.remove() }) : null;
}

function onHintChanged(hint: PopupInit["loadHint"]): void {
  if (!state.init) return;
  state.init.loadHint = hint;
  document.getElementById("update-hint")?.remove();
  document.getElementById("update")?.remove();
  const card = updateSlot(state.init);
  if (card) $("main").prepend(card);
}

function onUpdateChanged(u: UpdateNotice | null): void {
  if (!state.init) return;
  state.init.update = u;
  if (state.init.loadHint) return; // l'explication du chargement unique reste à sa place
  const old = document.getElementById("update");
  if (!u) {
    old?.remove();
    return;
  }
  const card = updateCard(u, { onDismissed: () => document.getElementById("update")?.remove() });
  if (old) {
    if (!old.contains(document.activeElement)) old.replaceWith(card);
  } else {
    $("main").prepend(card);
  }
}

// ---- démarrage ----------------------------------------------------------------------------------
wireFrame();
onPageEvents({
  job: (job) => {
    if (loading) pushedWhileLoading.set(job.key, job);
    upsertJob(job);
  },
  auth: onAuthChanged,
  update: onUpdateChanged,
  progress: onUpdateProgress,
  hint: onHintChanged,
});
void load();
// 3.5.2 : permission du lien avec AETHRYON Desktop (lue sans attendre le service worker).
void hasDesktopLink().then((g) => {
  state.desktopGranted = g;
  state.repaintDest?.();
});
