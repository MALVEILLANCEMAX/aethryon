// Popup AETHRYON v2 (Égide, 3.9.0) : visuel, peu de texte, sans défilement à 360 px dans ses états nominaux.
// - La vidéo d'abord (vignette, titre, plateforme, durée, instant de lecture), puis « Vidéo / Passage », les formats en
//   tuiles, la destination, et UNE action principale (l'or) qui devient la progression, puis le sceau quand le fichier
//   est prêt. Le compte, l'apparence (six thèmes) et le catalogue des plateformes sont des vues ouvertes depuis la barre.
// - Le popup ne parle QU'AU service worker (chrome.runtime.sendMessage) : il ne lit ni les onglets ni le jeton. Tout
//   texte issu des données est posé par textContent (jamais innerHTML).
// Honnêteté (inchangée) :
// - « Enregistré dans Téléchargements » n'apparaît que pour l'état done (fichier écrit sur le disque) ;
// - « Connecté » seulement si le compte répond : service injoignable ou en erreur → état dégradé expliqué ;
// - clé refusée, expirée, déconnexion faite ailleurs : le popup ouvert l'apprend AUSSITÔT (auth.changed) et dit pourquoi ;
// - tant que la notice sur les données n'est pas acceptée : ni connexion, ni téléchargement, ni requête, lien vers elle.
// La chouette maître (fichier tel quel) signe les moments qui comptent : médaille des états vides, veille du chargement,
// sceau du fichier prêt ; au plus une par vue, jamais dans une liste, jamais animée elle-même.
import { ACTIVITY_URL, DASHBOARD_URL, HELP_URL, SITE_BASE, TOOLS_URL, VERSION, versionLine } from "../shared/config.ts";
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
import { demarrerApparence, NOMS_THEMES } from "../shared/apparence.ts";
import {
  CATEGORIES, LIBELLES_ETAT, NOMS_FORMATS, PLATEFORMES, etatAffiche, lireDisponibilites, plateformeDuLien, raisonPlateforme,
  type Categorie, type Disponibilites, type Fonction,
} from "../shared/catalogue.ts";
import { ORDRE_THEMES, appliquerTheme, entreeDePreference, frapperSceau, icone, medaille, noeud, pastille, sceau, veille, type ThemeId } from "../shared/egide.ts";
import { consentGate, identity, loginControl, logoutControl } from "./account-ui.ts";
import { cleanAccount, isAccountView, isJobView, onPageEvents, parseInit, send } from "./bg.ts";
import {
  DESKTOP_ASK, DESKTOP_MISSING, DEST_LABEL, DEST_TITLE, KIND_LABEL, NB, PREMIERE_HINT, PREMIERE_REENCODE, QUALITY_LABEL, RECENT_STATE, SIGNED_OUT_TEXT, WITHDRAWN_TEXT, bitrateLabel, clockTime, companionLine, degradedText,
  itemLabel, jobStatusText, knownPlatform, percent, platformLabel, plural, quotaParts, quotaRatio, relativeTime, resetText, shortUrl,
} from "./text.ts";
import { $, bindSiteLink, button, fill, h, icon, openTab, owl, platformLogo, setBusy, siteLink, type IconName } from "./ui.ts";
import { loadHintCard, onUpdateProgress, updateCard } from "./update-ui.ts";

// Égide : préférence d'apparence appliquée avant tout rendu (theme-boot.js l'a déjà posée depuis le miroir local ; ici la
// même, puis celle de storage.sync si elle a changé ailleurs). Chouette maître servie par l'extension.
const apparence = demarrerApparence(document.documentElement);

const ACTIVE = new Set<string>(["queued", "converting", "downloading"]);
const WORKING = new Set<string>(["converting", "downloading"]);
/** Une réussite récente garde son sceau à la réouverture du popup. */
const RECENT_MS = 15 * 60_000;
/** Lignes du fil montrées d'emblée (popup sans défilement) ; « Tout afficher » pour le reste de la session. */
const MAX_ROWS = 3;
/** Téléchargements terminés gardés dans la liste (l'historique complet est sur le site). */
const MAX_FINISHED = 5;
/** Page du site pour installer ou mettre à jour AETHRYON Desktop. */
const DESKTOP_URL = `${SITE_BASE}/installer`;

type View = "main" | "compte" | "apparence" | "plateformes";

const state = {
  init: null as PopupInit | null,
  jobs: new Map<string, JobView>(),
  loadedOnce: false,
  view: "main" as View,
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
  /** Déconnexion lancée depuis CE popup (l'annonce auth.changed qui suit ne doit rien rejouer). */
  loggingOut: false,
  tab: "download" as "download" | "clip",
  clipLength: 30 as ClipLength,
  clipAnchor: "after" as ClipAnchor,
  clipOut: "mp4" as "mp4" | "mp3" | "gif",
  pasted: null as DetectedMedia | null,
  editor: null as ClipEditor | null,
  editorFor: null as string | null,
  clipJobKey: null as string | null,
  limits: null as LimitsView | null,
  remote: null as PlayerLink | null,
  /** Travail montré à la place du bouton (« le bouton devient la progression »), jusqu'à « Nouveau ». */
  heroKey: null as string | null,
  /** Résultats déjà vus (« Nouveau ») : ils rejoignent le fil. */
  heroSeen: new Set<string>(),
  allRows: false,
  /** Disponibilité réelle des plateformes (GET /platforms par le service worker), null tant qu'inconnue. */
  dispo: null as Disponibilites,
  categorie: "populaires" as Categorie,
};

// ---- cadre fixe : barre, pied ------------------------------------------------------------------------
function wireFrame(): void {
  // Éditeur d'extrait (TimeLens), partagé avec le menu des pages : ses alias --ce-* lisent les jetons Égide.
  setApostrophe("'");
  const style = document.createElement("style");
  style.textContent = EXTRAIT_CSS;
  document.head.append(style);
  $("brand").append(owl(24), h("span", { class: "sr-only" }, "AETHRYON"));
  const settings = $("open-settings");
  settings.append(icon("settings", 19));
  settings.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage().catch(() => undefined);
  });
  const theme = $("open-theme");
  theme.append(icon("theme", 18));
  theme.addEventListener("click", () => showView(state.view === "apparence" ? "main" : "apparence"));
  $("open-account").addEventListener("click", () => showView(state.view === "compte" ? "main" : "compte"));
  bindSiteLink($("help-link") as HTMLAnchorElement, HELP_URL);
  const rights = $("rights");
  rights.textContent = RIGHTS_NOTICE;
  const toggle = $("rights-toggle");
  toggle.addEventListener("click", () => {
    rights.hidden = !rights.hidden;
    toggle.setAttribute("aria-expanded", String(!rights.hidden));
  });
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

/** Barre : anneau du quota (restant du jour) et bouton du compte (initiale), seulement une fois lié. */
function paintBar(init: PopupInit): void {
  const a = init.account;
  const linked = a.connected && init.consent.accepted;
  const btn = $("open-account") as HTMLButtonElement;
  btn.hidden = !linked;
  if (linked) {
    const name = a.name?.trim() || a.email?.trim() || "Compte AETHRYON";
    const initial = (/[\p{L}\p{N}]/u.exec(name)?.[0] ?? "A").toLocaleUpperCase("fr-FR");
    fill(btn, h("span", { class: "avatar", "aria-hidden": "true" }, initial));
    btn.setAttribute("aria-label", "Compte");
    btn.title = "Compte";
  }
  const ring = $("quota-ring");
  ring.hidden = !(linked && a.today && !a.degraded);
  if (!ring.hidden && a.today) fill(ring, ...quotaRing(a.today, ring));
}

/** Quota en anneau : restant / limite ; l'or se vide au fil du jour, rouge quand il n'en reste plus. */
function quotaRing(today: NonNullable<AccountView["today"]>, host: HTMLElement): Node[] {
  const q = quotaParts(today);
  const ratio = quotaRatio(today);
  const label = q.unlimited ? "Conversions illimitées aujourd'hui" : `${q.num} ${q.rest} aujourd'hui. ${resetText(today)}.`;
  host.setAttribute("role", "img");
  host.setAttribute("aria-label", label);
  host.title = label;
  host.dataset.tone = q.exhausted ? "bad" : "ok";
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 30 30");
  svg.setAttribute("aria-hidden", "true");
  const c = (cls: string) => {
    const e = document.createElementNS(NS, "circle");
    for (const [k, v] of Object.entries({ cx: "15", cy: "15", r: "13", class: cls, pathLength: "100" })) e.setAttribute(k, v);
    return e;
  };
  const plein = c("q-plein");
  const reste = q.unlimited ? 100 : ratio === null ? 0 : Math.round((1 - ratio) * 100);
  plein.setAttribute("stroke-dasharray", "100 100");
  plein.setAttribute("stroke-dashoffset", String(100 - reste));
  svg.append(c("q-fond"), plein);
  return [svg, h("b", { "aria-hidden": "true" }, q.unlimited ? "∞" : q.num)];
}

// ---- vues ---------------------------------------------------------------------------------------------
function showView(v: View): void {
  const from = state.view;
  state.view = v;
  $("open-account").setAttribute("aria-pressed", String(v === "compte"));
  $("open-theme").setAttribute("aria-pressed", String(v === "apparence"));
  if (state.init) render(state.init);
  if (v === "plateformes") void loadPlatforms();
  // Le focus suit : le titre de la vue ouverte, ou le bouton qui l'avait ouverte au retour.
  if (v !== "main") document.querySelector<HTMLElement>(".view-title")?.focus();
  else if (from === "compte") $("open-account").focus();
  else if (from === "apparence") $("open-theme").focus();
  else focusFirst("[data-action=platforms]", "[data-action=start]:not(:disabled)", "#media-title");
}

function viewHead(title: string, id: string): HTMLElement {
  const back = button("Retour", { variant: "quiet", size: "sm", icon: "back", action: "back" });
  back.addEventListener("click", () => showView("main"));
  return h("div", { class: "view-head" }, back, h("h2", { id, class: "view-title", tabindex: "-1" }, title));
}

// ---- chargement ---------------------------------------------------------------------------------------
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
  // Rien pendant 400 ms ; ensuite seulement, la veille (la chouette attend, un fil tourne autour).
  const slow = state.init ? null : setTimeout(() => {
    const main = $("main");
    if (main.getAttribute("aria-busy") === "true") fill(main, h("div", { class: "loading" }, veille({ libelle: "Chargement" })));
  }, 400);
  const res = await send<unknown>({ type: "popup.init" }, 10_000);
  if (slow) clearTimeout(slow);
  loading = false;
  const init = res.ok ? parseInit(res.data) : null;
  if (!init) {
    renderFailure(res.ok ? { code: "bad_response", message: "Réponse inattendue du service de l'extension.", retryable: true } : res.error, after === "retry");
    return;
  }
  state.init = init;
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
  if (after === "lost" || after === "disconnected") state.view = "main";
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

/**
 * Disponibilité réelle des plateformes (catalogue) : demandée seulement quand elle sert (vue « Plateformes », lien d'une
 * autre plateforme collé), une fois par popup, et jamais avant l'accord sur la notice (le service worker refuse aussi).
 */
let platformsAsked: Promise<void> | null = null;
function loadPlatforms(): Promise<void> {
  if (!state.init?.consent.accepted) return Promise.resolve();
  platformsAsked ??= (async () => {
    const r = await send<unknown>({ type: "platforms.get" }, 8_000);
    if (!r.ok) return;
    state.dispo = lireDisponibilites(r.data);
    if (state.view === "plateformes" && state.init) render(state.init);
  })();
  return platformsAsked;
}

// ---- la chouette (une par vue) -----------------------------------------------------------------------
type OwlState = "idle" | "curious" | "processing" | "success" | "error";
/** Médaille (états vides, accueil), veille (attente), sceau (fichier prêt) ; data-state dit l'état réel. */
function owlState(s: OwlState, size = 56): HTMLElement {
  const el = s === "processing" ? veille({ libelle: "En cours" }) : s === "success" ? sceau({ taille: size }) : medaille({ taille: size });
  return h("span", { class: "p-chouette", "data-state": s, "aria-hidden": s === "processing" ? null : "true" }, el);
}

// ---- rendu --------------------------------------------------------------------------------------------
function render(init: PopupInit): void {
  const a = init.account;
  const gated = !init.consent.accepted;
  const connected = a.connected && !gated;
  const [conn, label] = gated ? (["off", init.consent.outdated ? "Notice à relire" : "Non connecté"] as [ConnState, string]) : connFor(a);
  setConn(conn, label);
  setVersion(init.version || VERSION);
  paintBar(init);
  if (!connected && state.view === "compte") state.view = "main";
  $("open-account").setAttribute("aria-pressed", String(state.view === "compte"));
  $("open-theme").setAttribute("aria-pressed", String(state.view === "apparence"));
  const main = $("main");
  main.dataset.vue = state.view;
  main.removeAttribute("aria-busy");
  if (state.view === "apparence") {
    fill(main, themesView());
    return;
  }
  if (state.view === "plateformes") {
    fill(main, platformsView());
    return;
  }
  if (state.view === "compte" && connected) {
    fill(main, accountCard(a));
    return;
  }
  const notice = !a.connected ? a.notice : undefined;
  const d = mediaOf(init);
  const busy = [...state.jobs.values()].some((j) => ACTIVE.has(j.state));
  main.dataset.view = busy ? "progress" : d ? "media" : "empty";
  fill(main,
    updateSlot(init),
    gated ? gateCard(init.consent.outdated ? { linked: a.connected } : null) : !connected ? connectCard(notice) : null,
    connected ? (a.degraded ? degradedCard(a) : accountStrip(a)) : null,
    d ? mediaCard(init, d) : (connected ? emptyCard(init) : null),
    jobsSection(connected));
  renderJobs();
  updateCompanion(null);
}

function renderFailure(error: JobError, focusRetry = false): void {
  setConn(null);
  const retry = button("Réessayer", { variant: "primary", icon: "retry", action: "reload" });
  retry.addEventListener("click", () => {
    setBusy(retry, true, "Chargement…");
    void load("retry");
  });
  const main = $("main");
  fill(main, h("section", { class: "failure", "aria-labelledby": "failure-title" },
    owlState("error", 56),
    h("h2", { id: "failure-title" }, "Chargement impossible"),
    h("p", { class: "failure-text", role: "alert", "data-raw": "" }, error.message),
    retry));
  main.removeAttribute("aria-busy");
  if (focusRetry) retry.focus(); // nouvel échec après « Réessayer » : le focus ne se perd pas
}

// ---- notice sur les données (pas encore acceptée) ----------------------------------------------------
function gateCard(changed: { linked: boolean } | null): HTMLElement {
  const text = changed
    ? `Elle couvre les nouvelles fonctions. ${changed.linked ? `Ta connexion est gardée${NB}; rien` : "Rien"} ne part avant ton accord.`
    : `Lis ce que l'extension fait de tes données, puis accepte${NB}: rien ne part avant.`;
  return h("section", { class: "hero", id: "gate", "aria-labelledby": "hero-title" },
    owlState("idle", 56),
    h("h2", { id: "hero-title" }, changed ? "La notice a changé" : "Bienvenue"),
    h("p", { class: "hero-text" }, text),
    consentGate());
}

// ---- connexion (non connecté) --------------------------------------------------------------------------
/** Après un refus du serveur (clé révoquée, expirée…) ou une déconnexion faite ailleurs, le MOTIF est dit au-dessus du
 *  bouton, qui le référence (aria-describedby) : il est lu au focus du bouton. */
function connectCard(notice?: AuthNotice): HTMLElement {
  const text = notice?.message ?? transientNotice;
  transientNotice = null;
  const owlEl = owlState(notice ? "curious" : "idle", 56);
  const login = loginControl({ block: true, describedBy: text ? "auth-notice" : undefined, onSuccess: () => load("connected"), onError: () => { owlEl.dataset.state = "error"; } });
  return h("section", { class: "hero", "aria-labelledby": "hero-title" },
    owlEl,
    h("h2", { id: "hero-title" }, notice ? "Reconnecte-toi" : "Connecte-toi"),
    h("p", { class: "hero-text" }, "Même compte et même quota que sur le site."),
    text ? h("p", { class: "notice", id: "auth-notice", role: notice ? null : "status" }, icon("alert", 15), h("span", null, text)) : null,
    login);
}

// ---- compte : bandeaux calmes (suspendu, quota atteint) ; le quota du jour vit dans l'anneau de la barre ---
/** Quota du jour épuisé, d'après des infos À JOUR (hors ligne ou dégradé, le serveur reste seul juge). */
function quotaReached(a: AccountView): boolean {
  if (!a.connected || a.stale || a.degraded || !a.today || a.today.limit === null) return false;
  return (a.today.remaining ?? Math.max(0, a.today.limit - a.today.used)) <= 0;
}

/** Texte du quota (barre et vue du compte) : « 3 conversions restantes sur 10 », remise à zéro. */
function quotaBlock(a: AccountView): HTMLElement {
  if (!a.today) {
    return h("div", { id: "quota" }, h("p", { class: "strip-empty", id: "quota-text" }, "Quota pas encore connu."));
  }
  const q = quotaParts(a.today);
  const ring = h("span", { class: "quota-ring" });
  ring.append(...quotaRing(a.today, ring));
  return h("div", { class: "account-quota", id: "quota", "data-tone": q.exhausted ? "bad" : q.unlimited ? "gold" : "ok" },
    ring,
    h("div", null,
      h("p", { class: "strip-main", id: "quota-text" }, h("span", { class: "strip-num tabular" }, q.num), " ", h("span", { class: "strip-rest" }, q.rest)),
      q.unlimited ? null : h("p", { class: "strip-reset", id: "quota-reset" }, resetText(a.today)),
      q.exhausted ? h("p", { class: "strip-note", id: "quota-note" }, `Quota du jour atteint${NB}: nouvelles conversions à ${clockTime(a.today.resetAt) ?? "minuit (heure de Paris)"}.`) : null));
}

/** Popup principal : seulement ce qui bloque (compte suspendu, quota atteint) ; sinon rien (l'anneau suffit). */
function accountStrip(a: AccountView): HTMLElement | null {
  if (a.suspended) {
    return h("section", { class: "strip", id: "quota", "data-tone": "bad", "aria-labelledby": "quota-title" },
      h("h2", { id: "quota-title", class: "strip-title" }, icon("alert", 16), h("span", null, "Compte suspendu")),
      h("p", { class: "notice", "data-tone": "bad" }, icon("alert", 15), h("span", null, `Ton compte AETHRYON est suspendu par un administrateur${NB}: les conversions sont refusées.`)));
  }
  if (!a.today) return null;
  const q = quotaParts(a.today);
  if (!q.exhausted) {
    // Quota lisible sans ouvrir le compte (et par un lecteur d'écran) : une ligne cachée, l'anneau la montre.
    return h("p", { class: "sr-only", id: "quota" }, h("span", { id: "quota-text" }, `${q.num} ${q.rest}`), q.unlimited ? null : ". ", q.unlimited ? null : h("span", { id: "quota-reset" }, resetText(a.today)));
  }
  return h("section", { class: "strip", id: "quota", "data-tone": "bad", "aria-labelledby": "quota-title" },
    h("h2", { id: "quota-title", class: "strip-title" }, icon("clock", 16), h("span", { id: "quota-text" }, h("span", { class: "strip-num tabular" }, q.num), " ", h("span", { class: "strip-rest" }, q.rest))),
    h("p", { class: "strip-note", id: "quota-note" }, `Quota du jour atteint${NB}: nouvelles conversions à ${clockTime(a.today.resetAt) ?? "minuit (heure de Paris)"}.`),
    h("p", { class: "sr-only", id: "quota-reset" }, resetText(a.today)));
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
  return h("section", { class: "strip degraded", id: "quota", "data-tone": "warn", "aria-labelledby": "degraded-title" },
    h("div", { class: "strip-line" },
      h("h2", { id: "degraded-title", class: "strip-title" }, icon(a.degraded!.reason === "network" ? "wifi" : "alert", 16), h("span", null, d.title)),
      retry),
    h("p", { class: "strip-text", role: "status" }, d.text),
    h("p", { class: "strip-hint" }, `L'extension reste liée à ton compte${who ? ` (${who})` : ""}${NB}; quota et activité ne sont pas à jour.`, last ? ` ${last}` : ""));
}

// ---- le média ---------------------------------------------------------------------------------------------
/** Vidéo de la carte : celle de l'onglet, sinon un lien collé dans le popup. */
const mediaOf = (init: PopupInit): DetectedMedia | null => init.detected ?? state.pasted;

function mediaCard(init: PopupInit, d: DetectedMedia): HTMLElement {
  const connected = init.account.connected && init.consent.accepted;
  const card = h("section", { class: "media", id: "media", "aria-labelledby": "media-title" });
  if (!init.detected) {
    card.append(h("div", { class: "media-head" }, h("p", { class: "eyebrow" }, "Lien collé"), clearPasted()));
  }
  // Notice pas encore acceptée : aucune miniature chargée (« rien ne part vers un serveur avant ton accord »).
  card.append(mediaRow(d, { thumbnail: init.consent.accepted }));
  if (!connected) return card;
  const count = Math.min(d.videoCount ?? 0, 50);
  if (count > 1) card.append(videoPicker(count, canDownload(init)));
  // Passage : l'éditeur a ses propres actions (export, Tools) ; image et miniature restent avec la vidéo entière.
  // Vidéo / Passage, et sur la même ligne les outils rapides en icônes (image, miniature, Tools) ; en Passage, l'éditeur a
  // ses propres actions (export, Tools) et les outils de la vidéo entière s'effacent.
  card.append(h("div", { class: "mode-row" }, modeTabs(), state.tab === "clip" ? null : quickTools(init, d)),
    state.tab === "clip" ? clipForm(init, d) : convertForm(init));
  return card;
}

function canDownload(init: PopupInit): boolean {
  const a = init.account;
  return init.consent.accepted && a.connected && !a.suspended && !quotaReached(a) && !!mediaOf(init);
}

/** Retour à l'état « aucune vidéo » après un lien collé. */
function clearPasted(): HTMLButtonElement {
  const b = button("Effacer", { variant: "quiet", size: "sm", icon: "close", action: "clear-pasted", ariaLabel: "Effacer le lien" });
  b.addEventListener("click", () => {
    state.pasted = null;
    state.tab = "download";
    if (state.init) render(state.init);
    focusFirst("#paste-url");
  });
  return b;
}

/** Toute la vidéo, ou un passage (TimeLens) : groupe radio, flèches au clavier. */
function modeTabs(): HTMLElement {
  const swap = (t: "download" | "clip") => {
    state.tab = t;
    if (state.init) render(state.init);
    focusFirst(`input[name=mode][value=${t}]`);
  };
  return h("fieldset", { class: "mode" },
    h("legend", { class: "sr-only" }, "Que faire de cette vidéo"),
    h("div", { class: "seg seg-mode" },
      segOption("mode", "download", "Vidéo", state.tab === "download", () => swap("download"), "film"),
      segOption("mode", "clip", "Passage", state.tab === "clip", () => swap("clip"), "cut")));
}

/** Lecteur de la vidéo de l'onglet actif, piloté par le service worker. Une seule demande de position à la fois. */
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
 * Passage (TimeLens) : la même réglette que le menu des pages (une réglette, butée de la limite, « Début ici / Fin ici »),
 * synchronisée avec le lecteur de l'onglet, limites annoncées par le serveur, export en MP4, MP3 ou GIF (le GIF garde le
 * passage : seul son début est exporté, et c'est dit), avancement réel. Lien collé : durée inconnue, champs seuls.
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
  const mine = [...state.jobs.values()].filter((j) => j.clip && j.url === d.url).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (mine && (state.clipJobKey === null || state.clipJobKey === mine.key)) state.clipJobKey = mine.key;
  const followed = state.clipJobKey ? state.jobs.get(state.clipJobKey) : undefined;
  ed.setJob(followed ? exportViewOf(followed) : null);
  void loadLimits();
  const form = h("form", { class: "clip", "aria-label": "Passage", novalidate: true }, ed.el);
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

/** Outils rapides : image de la vidéo (PNG, sur l'appareil), miniature de la plateforme, AETHRYON Tools s'il est ouvert. */
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
  const frame = button("Image", { variant: "secondary", size: "sm", icon: "camera", action: "frame", ariaLabel: "Image de la vidéo (PNG)" });
  frame.title = "Enregistrer l'image affichée de la vidéo (PNG)";
  frame.disabled = !consent || !init.detected;
  frame.addEventListener("click", () => void run(frame, { type: "frame.capture" }, "Capture…"));
  const thumbUrl = safeThumbnail(d.thumbnail);
  const thumb = button("Miniature", { variant: "secondary", size: "sm", icon: "image", action: "thumb", ariaLabel: "Miniature de la vidéo" });
  thumb.title = "Enregistrer la miniature de la vidéo";
  thumb.disabled = !consent || !thumbUrl;
  thumb.addEventListener("click", () => {
    if (thumbUrl) void run(thumb, { type: "thumb.save", url: d.url, thumbnail: thumbUrl, ...(d.title ? { title: d.title.slice(0, 200) } : {}) }, "Envoi…");
  });
  const tools = init.account.connected && init.account.tools && consent
    ? button("Tools", { variant: "secondary", size: "sm", icon: "studio", action: "tools", ariaLabel: `Tools${NB}: ouvrir cette vidéo dans AETHRYON Tools (nouvel onglet)` })
    : null;
  if (tools) tools.title = "Ouvrir cette vidéo dans AETHRYON Tools";
  tools?.addEventListener("click", () => void run(tools, { type: "tools.open", url: d.url }, "Ouverture…"));
  for (const b of [frame, thumb, tools]) b?.classList.add("quick-btn");
  return h("div", { class: "quick", role: "group", "aria-label": "Outils rapides" },
    h("div", { class: "quick-row" }, frame, thumb, tools), error);
}

// ---- aucune vidéo : coller un lien, plateformes compatibles ----------------------------------------------
function emptyCard(init: PopupInit): HTMLElement {
  return h("section", { class: "empty-wrap", "aria-labelledby": "empty-title" },
    emptyMedia(init.pageHint),
    pasteForm(init));
}

function emptyMedia(hint: string | null): HTMLElement {
  return h("div", { class: "empty" },
    owlState("idle", 52),
    h("p", { class: "empty-title", id: "empty-title" }, "Aucune vidéo ici"),
    hint
      ? h("p", { class: "empty-text", "data-raw": "" }, hint)
      : h("p", { class: "empty-text" }, `Ouvre une vidéo ${PLATFORMS_OR}, ou colle un lien.`),
    h("div", { class: "pf-row", "aria-hidden": "true" }, ...BUILD_PLATFORMS.map((p) => platformLogo(p, 18))));
}

/** Coller un lien : YouTube, TikTok et X ; toute autre plateforme connue est dite avec son état réel (catalogue). */
function pasteForm(init: PopupInit): HTMLElement {
  const input = h("input", { id: "paste-url", name: "url", type: "url", inputmode: "url", autocomplete: "off", spellcheck: false, placeholder: "Colle un lien", class: "paste-input", "aria-describedby": "paste-error" });
  const error = h("p", { class: "form-error", id: "paste-error", role: "alert" });
  const encart = h("div", { role: "status" });
  const use = button("Utiliser", { variant: "secondary", size: "sm", icon: "link", action: "paste" });
  use.type = "submit";
  const form = h("form", { class: "paste", novalidate: true, "aria-label": "Coller un lien" },
    h("label", { class: "sr-only", for: "paste-url" }, `Lien d'une vidéo ${PLATFORMS_OR}`),
    h("div", { class: "eg-etabli" }, h("span", { class: "eg-etabli-lien", "aria-hidden": "true" }, icon("link", 18)), input, use), error);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    error.textContent = "";
    encart.replaceChildren();
    const raw = input.value.trim();
    const ref = parseMediaUrl(raw);
    if (!ref) {
      const pf = plateformeDuLien(raw);
      if (pf) {
        encart.append(platformEncart(pf.id));
        // État réel du serveur (s'il n'était pas encore connu) : l'encart est repeint, sans voler le focus.
        if (!state.dispo) void loadPlatforms().then(() => { if (state.dispo && encart.isConnected && encart.firstChild) encart.replaceChildren(platformEncart(pf.id)); });
        return;
      }
      error.textContent = `Ce lien n'est pas pris en charge${NB}: colle le lien d'une vidéo ${PLATFORMS_OR}.`;
      input.focus();
      return;
    }
    state.pasted = { platform: ref.platform, kind: ref.kind, url: ref.url, id: ref.id };
    state.tab = "download";
    render(init);
    focusFirst("[data-action=start]:not(:disabled)", "#media-title");
  });
  const catalogue = button("Plateformes compatibles", { variant: "quiet", size: "sm", icon: "grid", action: "platforms" });
  catalogue.addEventListener("click", () => showView("plateformes"));
  return h("div", { class: "paste-wrap" }, form, encart,
    h("div", { class: "links-row" }, catalogue,
      init.account.connected && init.account.tools ? siteLink("AETHRYON Tools", TOOLS_URL, { className: "btn btn-quiet btn-sm", icon: "studio" }) : null));
}

/** Encart d'une plateforme reconnue mais pas (encore) utilisable ici : son état réel et sa raison. */
function platformEncart(id: string): HTMLElement {
  const pf = PLATEFORMES.find((p) => p.id === id)!;
  const etat = etatAffiche(pf, state.dispo);
  const lib = LIBELLES_ETAT[etat];
  const see = button("Voir les plateformes", { variant: "secondary", size: "sm", icon: "grid", action: "platforms" });
  see.addEventListener("click", () => {
    state.categorie = pf.categorie;
    showView("plateformes");
  });
  const raison = raisonPlateforme(pf, etat);
  return h("div", { class: "encart" },
    h("p", { class: "encart-head" }, icone(pf.icone, { taille: "s" }), h("span", null, pf.nom), pastille({ libelle: lib.mot, ton: lib.ton })),
    h("p", null, raison),
    see);
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
  if (d.duration) thumb.append(h("span", { class: "thumb-time", "aria-hidden": "true" }, timecode(d.duration)));
  const title = d.title?.trim();
  return h("div", { class: "media-row" },
    thumb,
    h("div", { class: "media-meta" },
      h("p", { class: "media-platform" }, platformLogo(d.platform, 14), h("span", null, `${PLATFORM_LABEL[d.platform]} · ${KIND_LABEL[d.kind]}`)),
      title
        ? h("p", { class: "media-title", id: "media-title", tabindex: "-1", dir: "auto", title, "data-raw": "" }, title)
        : h("p", { class: "media-title", id: "media-title", tabindex: "-1", "data-missing": "true" }, "Titre indisponible"),
      timeLine(d) ?? h("p", { class: "media-url", title: d.url, "data-raw": "" }, shortUrl(d.url))));
}

/** « 12:34 · lecture à 1:23 » quand la page les connaît, sinon null (l'adresse est montrée). */
function timeLine(d: DetectedMedia): HTMLElement | null {
  const parts = [d.duration ? timecode(d.duration) : null, typeof d.currentTime === "number" && d.currentTime > 0 ? `lecture à ${timecode(d.currentTime)}` : null].filter(Boolean);
  return parts.length ? h("p", { class: "media-url tabular", title: d.url, "data-raw": "" }, parts.join(" · ")) : null;
}

function segOption(name: string, value: string, label: string, checked: boolean, onSelect: () => void, ic?: IconName): HTMLLabelElement {
  const input = h("input", { type: "radio", name, value, checked });
  input.addEventListener("change", () => { if (input.checked) onSelect(); });
  return h("label", { class: "seg-opt" }, input, h("span", null, ic ? icon(ic, 15) : null, label));
}

/** Tuile de format (choix exclusif visuel : icône, nom, précision) sur un vrai bouton radio. */
function tileOption(name: string, value: string, label: string, sub: string, checked: boolean, onSelect: () => void, ic: IconName): HTMLLabelElement {
  const input = h("input", { type: "radio", name, value, checked, "aria-label": `${label}, ${sub}` });
  input.addEventListener("change", () => { if (input.checked) onSelect(); });
  return h("label", { class: "tuile-opt" }, input,
    h("span", { class: "eg-tuile", "aria-hidden": "true" },
      h("span", { class: "eg-tuile-coche" }, icon("check", 11)),
      icon(ic, 18),
      h("b", null, label),
      h("small", null, sub)));
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

/** Le travail de CE média qui occupe la place du bouton : en cours, ou terminé et pas encore vu. */
function heroJob(): JobView | null {
  const init = state.init;
  const d = init ? mediaOf(init) : null;
  if (!d) return null;
  const mine = [...state.jobs.values()]
    .filter((j) => j.url === d.url && !j.clip && j.kind !== "frame" && j.kind !== "thumb" && j.kind !== "gif")
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!mine || state.heroSeen.has(mine.key)) return null;
  if (ACTIVE.has(mine.state)) return mine;
  // Fini : gardé à la place du bouton s'il vient de finir dans ce popup, ou s'il a fini il y a peu.
  return state.heroKey === mine.key || Date.now() - mine.updatedAt < RECENT_MS ? mine : null;
}

function convertForm(init: PopupInit): HTMLElement {
  const a = init.account;
  const gated = !init.consent.accepted;
  const connected = a.connected && !gated;
  const suspended = connected && a.suspended === true;
  const exhausted = quotaReached(a);
  const d = mediaOf(init);
  const enabled = canDownload(init);

  const quality = h("select", { id: "quality", name: "quality", "aria-label": "Qualité" },
    ...QUALITIES.map((q) => h("option", { value: q, selected: q === state.quality }, QUALITY_LABEL[q])));
  const bitrate = h("select", { id: "bitrate", name: "bitrate", "aria-label": "Débit" },
    ...BITRATES.map((b) => h("option", { value: String(b), selected: b === state.bitrate }, bitrateLabel(b))));

  // Destination (3.5.1) : « Envoyer vers » › Téléchargements | Premiere Pro, mémorisée (même réglage que le menu des pages).
  // 3.5.2 : choisir « Premiere Pro » demande, dans le geste, la permission du lien avec AETHRYON Desktop ; 3.8.1 : c'est
  // AETHRYON Desktop qui convertit et importe (aucun téléchargement par le navigateur).
  const destNote = h("p", { class: "hint dest-note", id: "dest-note" }, icon("info", 15), h("span"));
  const allow = button("Autoriser", { variant: "secondary", size: "sm", action: "desktop-allow", describedBy: "dest-link-text" });
  const destLink = h("div", { class: "hint dest-link", id: "dest-link" }, icon("info", 15),
    h("div", { class: "dest-link-body" }, h("span", { id: "dest-link-text" }, DESKTOP_ASK), allow));
  const startLabel = () => (state.dest === "premiere" ? "Importer dans Premiere Pro" : "Télécharger");
  const btn = button(startLabel(), { variant: "primary", size: "lg", block: true, icon: state.dest === "premiere" ? "premiere" : "download", action: "start" });
  const paintDest = () => {
    const premiere = state.dest === "premiere";
    const text = !premiere ? "" : !state.premiereHintSeen ? PREMIERE_HINT : state.fmt === "mp4" && premiereReencodes(state.quality) ? PREMIERE_REENCODE : "";
    destNote.lastElementChild!.textContent = text;
    destNote.hidden = !text;
    destLink.hidden = !(premiere && state.desktopGranted === false);
    const auto = quality.querySelector<HTMLOptionElement>('option[value="best"]');
    if (auto) auto.textContent = premiere ? `${QUALITY_LABEL.best} (≤ 1080p)` : QUALITY_LABEL.best;
    const label = btn.querySelector(".btn-label");
    if (label && btn.getAttribute("aria-busy") !== "true") label.textContent = startLabel();
    btn.querySelector("svg")?.replaceWith(icon(premiere ? "premiere" : "download", 17));
  };
  state.repaintDest = paintDest;
  /** Demande DANS le geste (avant tout await) ; refus : la ligne « Autoriser » reste. */
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
  const destSeg = h("div", { class: "seg seg-dest" },
    segOption("dest", "downloads", DEST_LABEL.downloads, state.dest === "downloads", () => setDest("downloads"), "folder"),
    segOption("dest", "premiere", DEST_LABEL.premiere, state.dest === "premiere", () => setDest("premiere"), "premiere"));
  const dField = h("fieldset", { class: "field dest-field", "aria-describedby": "dest-note" }, h("legend", { class: "sr-only" }, DEST_TITLE), destSeg, destNote, destLink);
  quality.addEventListener("change", () => { state.quality = quality.value as Quality; paintDest(); });
  bitrate.addEventListener("change", () => { state.bitrate = Number(bitrate.value) as Bitrate; });

  // Formats en tuiles : MP4 (vidéo), MP3 (son), puis la tuile du réglage (qualité ou débit) ; le GIF est dans « Passage ».
  const settingLabel = h("span", { class: "field-label" }, state.fmt === "mp3" ? "Débit" : "Qualité");
  const settingBox = h("span", { class: "tuile-select-slot" }, selectBox(state.fmt === "mp3" ? bitrate : quality));
  const setting = h("label", { class: "tuile-select" }, settingLabel, settingBox);
  const setFmt = (f: Fmt) => {
    state.fmt = f;
    settingLabel.textContent = f === "mp3" ? "Débit" : "Qualité";
    settingBox.replaceChildren(selectBox(f === "mp3" ? bitrate : quality));
    paintDest();
  };
  const tiles = h("fieldset", { class: "formats" }, h("legend", { class: "sr-only" }, "Format"),
    tileOption("fmt", "mp4", "MP4", "Vidéo", state.fmt === "mp4", () => setFmt("mp4"), "film"),
    tileOption("fmt", "mp3", "MP3", "Son", state.fmt === "mp3", () => setFmt("mp3"), "music"),
    setting);

  const grid = h("fieldset", { class: "convert-grid", disabled: !enabled },
    h("legend", { class: "sr-only" }, "Options de conversion"), tiles, dField);
  paintDest();

  const why = gated ? `Accepte d'abord la notice sur les données${NB}: rien n'est envoyé avant.`
    : !connected
      ? (d ? "Connecte-toi pour télécharger cette vidéo." : `Connecte-toi, puis ouvre une vidéo ${PLATFORMS_OR}.`)
      : suspended ? `Ton compte AETHRYON est suspendu${NB}: les conversions sont refusées.`
        : exhausted ? `Quota du jour atteint${NB}: nouvelles conversions possibles à ${clockTime(a.today?.resetAt) ?? "minuit (heure de Paris)"}.`
          : !d ? "Aucune vidéo à télécharger sur cet onglet." : null;
  const hint = why ? h("p", { class: "hint", id: "convert-hint" }, icon("info", 15), h("span", null, why)) : null;
  if (hint) btn.setAttribute("aria-describedby", "convert-hint");
  btn.type = "submit";
  btn.disabled = !enabled;
  btn.classList.add("go");
  const error = h("p", { class: "form-error", id: "convert-error", role: "alert" });
  // « Le bouton devient la progression » : le travail de cette vidéo prend sa place (fil, étape, Annuler), puis le sceau.
  const heroSlot = h("ul", { class: "hero-list", id: "hero-slot", "aria-label": "Téléchargement de cette vidéo" });
  const summary = h("p", { class: "convert-summary" });
  const form = h("form", { class: "convert", "aria-label": "Téléchargement", novalidate: true }, grid, summary, heroSlot, btn, hint, error);
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
  // Premiere Pro : vidéo ou audio entiers ; un extrait ou un GIF reste dans Téléchargements.
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
    return;
  }
  if (premiere && !state.premiereHintSeen) {
    state.premiereHintSeen = true; // l'explication a servi : plus montrée ensuite
    saveSettings({ premiereHintSeen: true }).catch(() => {}); // plus montrée au prochain popup (pas sous les yeux)
  }
  if (isJobView(res.data)) {
    state.heroKey = res.data.key;
    upsertJob(res.data);
    findJobItem(res.data.key)?.scrollIntoView({ block: "nearest" });
  } else {
    void refreshJobs();
  }
}

// ---- le fil : téléchargements de la session ---------------------------------------------------------------
function jobsSection(connected: boolean): HTMLElement {
  const title = h("h2", { id: "jobs-title", class: "eyebrow", tabindex: "-1" }, icon("fil", 14), h("span", null, "Le fil"));
  // Annonce polie des CHANGEMENTS d'état (pas de chaque pourcentage, pour ne pas saturer la synthèse vocale).
  const line = h("p", { id: "companion-line", class: "sr-only", role: "status", "aria-live": "polite" }, companionLine(latestJob()));
  const section = h("section", { class: "jobs", id: "jobs", "aria-labelledby": "jobs-title" },
    h("div", { class: "jobs-head" }, title), line, h("div", { id: "job-slot" }));
  section.hidden = !connected;
  return section;
}

function visibleJobs(): JobView[] {
  const all = [...state.jobs.values()];
  const active = all.filter((j) => ACTIVE.has(j.state)).sort((a, b) => b.createdAt - a.createdAt);
  const finished = all.filter((j) => !ACTIVE.has(j.state)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_FINISHED);
  return [...active, ...finished];
}

/** Le téléchargement le plus parlant : celui qui travaille, sinon le plus récemment mis à jour. */
function latestJob(): JobView | null {
  let best: JobView | null = null;
  for (const j of state.jobs.values()) {
    if (!best) { best = j; continue; }
    const jw = WORKING.has(j.state), bw = WORKING.has(best.state);
    if ((jw && !bw) || (jw === bw && j.updatedAt > best.updatedAt)) best = j;
  }
  return best;
}

/** Met à jour la phrase d'état annoncée (si elle change). */
function updateCompanion(_changed: JobView | null): void {
  const line = document.getElementById("companion-line");
  const text = companionLine(latestJob());
  if (line && line.textContent !== text) line.textContent = text;
}

function upsertJob(job: JobView): void {
  const prev = state.jobs.get(job.key);
  if (prev && prev.updatedAt > job.updatedAt) return; // message en retard : on garde le plus récent
  // Déconnecté : la liste a été vidée ; un état final tardif d'un job effacé ne la remplit pas de nouveau.
  if (!prev && state.init && !state.init.account.connected && !ACTIVE.has(job.state)) return;
  state.jobs.set(job.key, job);
  const transition = !prev || prev.state !== job.state;
  if (transition && ACTIVE.has(job.state) && heroJob()?.key === job.key) state.heroKey = job.key;
  renderJobs();
  if (state.editor && job.key === state.clipJobKey) state.editor.setJob(exportViewOf(job));
  updateCompanion(transition ? job : null);
  // Clé refusée par le serveur pendant que le popup est ouvert : retour immédiat à la connexion, avec le motif.
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
    const target = neighbour?.isConnected ? (neighbour.querySelector<HTMLElement>("[data-action]") ?? neighbour) : document.querySelector<HTMLElement>("[data-action=start]:not(:disabled)") ?? document.getElementById("jobs-title");
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

/** Place chaque travail : celui de cette vidéo à la place du bouton, les autres dans le fil (3 lignes d'emblée). */
function renderJobs(): void {
  const slot = document.getElementById("job-slot");
  const section = document.getElementById("jobs");
  const heroSlot = document.getElementById("hero-slot");
  const startBtn = document.querySelector<HTMLButtonElement>("[data-action=start]");
  const hero = heroSlot ? heroJob() : null;
  // Le bouton cède sa place pendant le travail, et les choix se résument en une ligne (« MP4 · 1080p → Téléchargements ») ;
  // tout revient sous le résultat (« Télécharger » encore, autre format).
  const working = !!hero && ACTIVE.has(hero.state);
  if (startBtn) startBtn.hidden = working;
  const form = heroSlot?.closest<HTMLElement>("form.convert");
  if (form) {
    form.toggleAttribute("data-busy", working);
    const summary = form.querySelector<HTMLElement>(".convert-summary");
    if (summary) summary.textContent = working && hero ? `${itemLabel(hero)}${hero.dest === "premiere" ? ` → ${DEST_LABEL.premiere}` : ` → ${DEST_LABEL.downloads}`}` : "";
  }
  if (heroSlot) {
    const keep = heroSlot.querySelector<HTMLLIElement>(":scope > li.job");
    if (!hero) keep?.remove();
    else {
      const li = keep && keep.dataset.key === hero.key ? keep : h("li", { class: "job hero-job", "data-key": hero.key, tabindex: "-1" });
      updateJobItem(li, hero, true);
      if (li !== keep) {
        keep?.remove();
        heroSlot.append(li);
      }
    }
  }
  if (!slot || !section) return;
  const all = visibleJobs().filter((j) => j.key !== hero?.key);
  // Sans défilement : 3 lignes d'emblée, 2 quand le travail de cette vidéo occupe la place du bouton.
  const jobs = state.allRows ? all : all.slice(0, hero ? MAX_ROWS - 1 : MAX_ROWS);
  section.hidden = all.length === 0;
  let list = slot.querySelector<HTMLUListElement>("ul.job-list");
  if (!jobs.length) {
    list?.remove();
    slot.querySelector(".jobs-more")?.remove();
    return;
  }
  if (!list) {
    list = h("ul", { class: "job-list", "aria-labelledby": "jobs-title" });
    slot.prepend(list);
  }
  const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement : null;
  const keepKeys = new Set(jobs.map((j) => j.key));
  for (const li of [...list.querySelectorAll<HTMLLIElement>(":scope > li.job")]) if (!keepKeys.has(li.dataset.key ?? "")) li.remove();
  let prev: Element | null = null;
  for (const job of jobs) {
    const li = list.querySelector<HTMLLIElement>(`:scope > li.job[data-key="${CSS.escape(job.key)}"]`) ?? h("li", { class: "job", "data-key": job.key, tabindex: "-1" });
    updateJobItem(li, job, false);
    const want: Element | null = prev ? prev.nextElementSibling : list.firstElementChild;
    if (want !== li) list.insertBefore(li, want);
    prev = li;
  }
  // « Tout afficher » : le reste de la session (le popup peut alors défiler, à la demande).
  const rest = all.length - jobs.length;
  let more = slot.querySelector<HTMLButtonElement>(".jobs-more");
  if (rest > 0) {
    if (!more) {
      more = button("", { variant: "quiet", size: "sm", action: "jobs-more" });
      more.classList.add("jobs-more");
      more.addEventListener("click", () => {
        state.allRows = true;
        renderJobs();
      });
      slot.append(more);
    }
    more.querySelector(".btn-label")!.textContent = `Tout afficher (${rest} de plus)`;
  } else more?.remove();
  if (focused && focused.isConnected && document.activeElement !== focused) focused.focus();
}

/** Signature de tout ce qui change la structure d'une ligne (la progression seule ne la reconstruit pas). */
function signature(j: JobView, hero: boolean): string {
  return [hero ? "H" : "L", j.state, j.platform, j.title ?? "", j.url, j.fmt, j.quality ?? "", j.bitrate ?? "", j.index ?? "", j.kind ?? "", j.jobId ?? "", j.desktop ?? "",
    j.clip ? `${j.clip.start}-${j.clip.end}` : "", typeof j.downloadId === "number", j.error?.message ?? "", j.error?.retryable ?? "", j.error?.code ?? ""].join("|");
}

function updateJobItem(li: HTMLLIElement, job: JobView, hero: boolean): void {
  li.dataset.state = job.state;
  const sig = signature(job, hero);
  if (li.dataset.sig === sig) {
    const text = li.querySelector(".job-status-text");
    if (text) text.textContent = jobStatusText(job);
    const bar = li.querySelector<HTMLElement>(".progress");
    if (bar) setProgress(bar, job);
    return;
  }
  const active = document.activeElement instanceof HTMLElement && li.contains(document.activeElement) ? document.activeElement : null;
  const action = active?.dataset.action ?? null;
  const before = li.dataset.state && li.dataset.sig ? li.dataset.sig.split("|")[1] : null;
  buildJobItem(li, job, hero);
  li.dataset.sig = sig;
  // Le sceau se frappe une fois, quand le fichier devient prêt sous les yeux (pas à la réouverture du popup).
  if (hero && job.state === "done" && before && before !== "done") {
    const s = li.querySelector<HTMLElement>(".eg-sceau");
    if (s) frapperSceau(s);
  }
  if (active) {
    const target = (action && li.querySelector<HTMLElement>(`[data-action="${action}"]`)) || li.querySelector<HTMLElement>("[data-action]") || li;
    target.focus();
  }
}

function jobMark(job: JobView, hero: boolean): HTMLElement {
  if (hero && job.state === "done") {
    // Une seule chouette dans la vue : le sceau du fichier prêt (frappé au passage à « done »).
    return h("span", { class: "p-chouette", "data-state": "success", "aria-hidden": "true" }, sceau({ taille: 40, frappe: false }));
  }
  const etat = job.state === "done" ? "ok" : job.state === "error" ? "err" : job.state === "cancelled" ? "pause" : WORKING.has(job.state) ? "cours" : "attente";
  return h("span", { class: "job-icon" }, noeud(etat));
}

function buildJobItem(li: HTMLLIElement, job: JobView, hero: boolean): void {
  const titleId = `job-title-${job.key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const title = job.title?.trim();
  const meta = `${platformLabel(job.platform)} · ${itemLabel(job)}${job.index ? ` · Vidéo ${job.index}` : ""}${job.dest === "premiere" ? ` · ${DEST_LABEL.premiere}` : ""}`;
  li.className = hero ? "job hero-job" : "job";
  fill(li,
    jobMark(job, hero),
    h("div", { class: "job-body" },
      h("p", { class: "job-title", id: titleId, dir: "auto", title: `${title || job.url}\n${meta}`, "data-raw": "" }, title || shortUrl(job.url)),
      h("p", { class: "job-meta" }, meta),
      statusLine(job),
      job.dest === "premiere" && job.desktop === "absent" && job.state !== "error" && job.state !== "cancelled"
        ? h("p", { class: "job-note" }, DESKTOP_MISSING) : null,
      WORKING.has(job.state) || (hero && job.state === "queued") ? progressBar(job, titleId) : null),
    ...jobActions(job, titleId, hero));
}

function statusLine(job: JobView): HTMLElement {
  const tone = job.state === "done" ? "ok" : job.state === "error" ? "bad" : "neutral";
  const mark = job.state === "done" ? icon("check", 14)
    : job.state === "error" ? icon("alert", 14)
      : job.state === "cancelled" ? icon("close", 14)
        : job.state === "queued" ? icon("clock", 14)
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
  if (p === null || job.state === "queued") {
    // Avancement inconnu : fil indéterminé (pas d'aria-valuenow), aucune valeur inventée.
    bar.dataset.indeterminate = "true";
    bar.removeAttribute("aria-valuenow");
    if (fillEl) fillEl.style.transform = "";
  } else {
    delete bar.dataset.indeterminate;
    bar.setAttribute("aria-valuenow", String(p));
    if (fillEl) fillEl.style.transform = `scaleX(${p / 100})`;
  }
}

/** Actions d'un travail : icônes nommées (nom accessible + infobulle) à droite de la ligne ; liens utiles dessous. */
function jobActions(job: JobView, titleId: string, hero: boolean): HTMLElement[] {
  const btns: HTMLElement[] = [];
  const links: HTMLElement[] = [];
  const add = (label: string, action: string, ic: IconName, variant: "secondary" | "quiet" = "quiet") => {
    const b = button("", { variant, size: "sm", icon: ic, action, describedBy: titleId, ariaLabel: label });
    b.title = label;
    b.classList.add("job-act");
    b.addEventListener("click", () => void onJobAction(job.key, action, b));
    btns.push(b);
  };
  if (ACTIVE.has(job.state)) add("Annuler", "cancel", "stop");
  if (job.state === "done" && typeof job.downloadId === "number") add("Afficher", "show", "folder", "secondary");
  if (state.init?.account.tools && job.jobId && !job.kind?.match(/^(frame|thumb)$/) && (job.state === "done" || job.state === "converting" || job.state === "downloading")) {
    add("Tools", "tools", "studio");
  }
  if (job.state === "error" && job.error?.retryable) add("Réessayer", "retry", "retry", "secondary");
  if (job.state === "done" || job.state === "error" || job.state === "cancelled") add("Retirer", "dismiss", "close");
  // Desktop trop ancien pour l'envoi vers Premiere Pro : « Mets à jour AETHRYON Desktop » mène à sa page.
  if (job.state === "error" && job.error?.code === "desktop_outdated") {
    links.push(siteLink("Mettre à jour AETHRYON Desktop", DESKTOP_URL, { className: "btn btn-secondary btn-sm", icon: "external" }));
  }
  if (job.state === "error" && job.error?.code === "desktop_absent") {
    links.push(siteLink("Installer AETHRYON Desktop", DESKTOP_URL, { className: "btn btn-secondary btn-sm", icon: "external" }));
  }
  if (hero && job.state === "done") {
    // « Nouveau » : le résultat rejoint le fil, les choix reviennent (autre format, autre qualité).
    const again = button("", { variant: "quiet", size: "sm", icon: "plus", action: "hero-new", ariaLabel: "Nouveau téléchargement" });
    again.title = "Nouveau téléchargement";
    again.classList.add("job-act");
    again.addEventListener("click", () => {
      state.heroSeen.add(job.key);
      state.heroKey = null;
      renderJobs();
      focusFirst("[data-action=start]:not(:disabled)");
    });
    btns.push(again);
  }
  const out: HTMLElement[] = [];
  if (btns.length) out.push(h("div", { class: "job-actions" }, ...btns));
  if (links.length) out.push(h("div", { class: "job-links" }, ...links));
  return out;
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
    if (state.heroKey === key) state.heroKey = null;
    removeJob(key);
    return;
  }
  if (isJobView(res.data)) upsertJob(res.data);
  else {
    if (btn.isConnected) setBusy(btn, false);
    void refreshJobs();
  }
}

// ---- vue « Compte » -------------------------------------------------------------------------------------
function accountCard(a: AccountView): HTMLElement {
  const active = typeof a.activeJobs === "number" ? Math.max(0, Math.round(a.activeJobs)) : null;
  const recent = (a.recent ?? []).slice(0, 5);
  return h("section", { class: "account", id: "account", "aria-labelledby": "account-title" },
    viewHead("Compte", "account-title"),
    identity(a),
    a.degraded ? degradedCard(a) : quotaBlock(a),
    active === null || a.degraded ? null : h("p", { class: "stats" },
      h("span", { class: "stat-label" }, `En cours sur le serveur${NB}: `),
      h("span", { class: "stat-value tabular" }, active === 0 ? "aucune conversion" : `${active} ${plural(active, "conversion", "conversions")}`)),
    a.stale && !a.degraded ? h("p", { class: "note" }, icon("info", 14), "Infos du compte non actualisées") : null,
    h("div", { class: "links" },
      siteLink("Tableau de bord", DASHBOARD_URL, { className: "btn btn-secondary btn-sm", icon: "external" }),
      siteLink("Historique", ACTIVITY_URL, { className: "btn btn-secondary btn-sm", icon: "external" }),
      a.tools ? siteLink("Tools", TOOLS_URL, { className: "btn btn-secondary btn-sm", icon: "studio" }) : null),
    h("h3", { class: "subhead" }, a.degraded ? "Activité récente (dernière connue)" : "Activité récente"),
    recent.length
      ? h("ul", { class: "recent" }, ...recent.map((r) => {
        const st = RECENT_STATE[r.state] ?? { tone: "neutral" as const, label: r.state };
        const pf = knownPlatform(r.platform);
        return h("li", null,
          h("span", { class: "recent-main" }, pf ? platformLogo(pf, 13) : null,
            h("span", null, `${r.platform ? platformLabel(r.platform) : "Source inconnue"} · ${r.fmt.toUpperCase()}`)),
          h("span", { class: "recent-time" }, relativeTime(r.createdAt)),
          h("span", { class: "badge", "data-tone": st.tone }, st.label),
          r.errorMessage ? h("p", { class: "recent-error", "data-raw": "" }, r.errorMessage) : null);
      }))
      : h("p", { class: "recent-empty" }, a.degraded ? "Activité indisponible pour le moment." : "Aucune conversion récente."),
    logoutControl(async () => {
      state.loggingOut = true;
      state.jobs.clear();
      state.view = "main";
      await load("disconnected");
      state.loggingOut = false;
    }));
}

// ---- vue « Thème » : les six thèmes (préférence partagée avec les réglages et le menu des pages) ------------
function themesView(): HTMLElement {
  const actif = apparence.persistance.lire().actif;
  const group = h("fieldset", { class: "themes" }, h("legend", { class: "sr-only" }, "Thème de l'extension"));
  for (const id of ORDRE_THEMES as readonly ThemeId[]) {
    const input = h("input", { type: "radio", name: "theme", value: id, checked: id === actif });
    input.addEventListener("change", () => {
      if (!input.checked) return;
      apparence.choisir(id);
    });
    const card = h("span", { class: "theme-card eg-scope", "data-eg-theme": id, "aria-hidden": "true" },
      h("span", { class: "theme-preview" }, h("i"), h("i"), h("i")),
      h("span", { class: "theme-name" }, NOMS_THEMES[id], icon("check", 14, "tick")));
    // Custom : l'aperçu montre le thème personnel enregistré (sinon l'exemple Vert-de-gris), par CSSOM.
    if (id === "custom") appliquerTheme(card, entreeDePreference({ ...apparence.persistance.lire(), actif: "custom" }));
    group.append(h("label", { class: "theme-opt" }, input, card, h("span", { class: "sr-only" }, NOMS_THEMES[id])));
  }
  const editor = button("Éditeur de thèmes", { variant: "secondary", size: "sm", icon: "settings", action: "theme-editor" });
  editor.addEventListener("click", () => openTab(chrome.runtime.getURL("options/options.html#apparence")));
  return h("section", { class: "apparence", "aria-labelledby": "theme-title" },
    viewHead("Thème", "theme-title"),
    group,
    h("p", { class: "hint" }, icon("info", 15), h("span", null, "Le popup, les réglages et le bouton des sites suivent ce choix.")),
    editor);
}

// ---- vue « Plateformes » : le catalogue, états réels --------------------------------------------------------
function platformsView(): HTMLElement {
  // Liste défilante (catégorie longue) : focalisable, pour défiler au clavier.
  const list = h("ul", { class: "cat-list", "aria-labelledby": "platforms-title", tabindex: "0" });
  const paint = () => {
    list.replaceChildren(...PLATEFORMES.filter((p) => p.categorie === state.categorie).map((p) => {
      const etat = etatAffiche(p, state.dispo);
      const lib = LIBELLES_ETAT[etat];
      // Utilisable seulement si l'EXTENSION la convertit (« serveur » : ouverte ailleurs, formats barrés avec la raison).
      const usable = etat === "en_ligne";
      const formats = (["mp4", "mp3", "gif", "extrait"] as Fonction[]).map((f) => {
        const on = usable && p.formats.includes(f);
        const raison = etat === "serveur" && p.formats.includes(f) ? raisonPlateforme(p, etat) : p.indisponibles[f];
        return h("span", { class: "fmt-chip", "data-off": on ? undefined : "", title: on ? undefined : raison ?? raisonPlateforme(p, etat) },
          NOMS_FORMATS[f], on ? null : h("span", { class: "sr-only" }, ` indisponible${raison ? ` : ${raison}` : ""}`));
      });
      return h("li", { class: "cat-item" },
        icone(p.icone, { taille: "s" }),
        h("span", { class: "cat-name" }, h("b", null, p.nom),
          p.statut === "refusee" ? null : h("span", { class: "cat-formats" }, ...formats),
          p.attribution && usable ? h("span", { class: "sr-only" }, "Auteur, licence et source donnés avec le fichier.") : null),
        pastille({ libelle: lib.mot, ton: lib.ton }));
    }));
  };
  const seg = h("div", { class: "seg cat-tabs" },
    ...CATEGORIES.map((c) => segOption("categorie", c.id, c.nom, state.categorie === c.id, () => { state.categorie = c.id; paint(); })));
  paint();
  return h("section", { class: "catalogue", "aria-labelledby": "platforms-title" },
    viewHead("Plateformes", "platforms-title"),
    h("fieldset", { class: "mode" }, h("legend", { class: "sr-only" }, "Catégorie"), seg),
    list,
    h("p", { class: "hint" }, icon("info", 15), h("span", null, state.dispo
      ? "État réel du serveur AETHRYON. Aucun logo de marque : un pictogramme par type de contenu."
      : "État du catalogue (le serveur n'a pas encore répondu). Aucun logo de marque.")));
}

// ---- compte : rafraîchissement, liaison perdue ------------------------------------------------------------
let accountTimer: ReturnType<typeof setTimeout> | undefined;
/** Après une fin (réussie ou non), le quota a changé côté serveur : on redemande le compte. */
function scheduleAccountRefresh(): void {
  if (!state.init?.account.connected) return;
  clearTimeout(accountTimer);
  accountTimer = setTimeout(async () => {
    const res = await send<unknown>({ type: "account.refresh" }, 10_000);
    if (!res.ok) {
      if (res.error.code === "auth_required" && state.init?.account.connected) lost();
      return;
    }
    if (!isAccountView(res.data) || !state.init) return;
    const acc = cleanAccount(res.data);
    if (!acc.connected) {
      lost();
      return;
    }
    const before = state.init.account;
    if (acc.suspended !== before.suspended || quotaReached(acc) !== quotaReached(before) || !!acc.degraded !== !!before.degraded) {
      void load();
      return;
    }
    state.init.account = acc;
    paintBar(state.init);
    const strip = document.getElementById("quota");
    const fresh = state.view === "compte" ? quotaBlock(acc) : accountStrip(acc);
    if (strip && fresh && !strip.contains(document.activeElement)) strip.replaceWith(fresh);
    const old = document.getElementById("account");
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
    if (!state.init.account.connected) void load("connected");
    return;
  }
  if (state.loggingOut) return;
  const wasConnected = state.init.account.connected;
  if (!wasConnected && e.reason !== "withdrawn") return;
  lost(e.reason === "signed_out" ? SIGNED_OUT_TEXT : e.reason === "withdrawn" ? WITHDRAWN_TEXT : null);
}

/** Avis de mise à jour (compact : une ligne, les nouveautés repliées), ou l'explication du chargement unique. */
function updateSlot(init: PopupInit): HTMLElement | null {
  if (init.loadHint) return loadHintCard(init.loadHint, { onDismissed: () => { if (state.init) state.init.loadHint = null; document.getElementById("update-hint")?.remove(); if (state.init?.update) onUpdateChanged(state.init.update); } });
  return init.update ? updateCard(init.update, { onDismissed: () => document.getElementById("update")?.remove(), compact: true }) : null;
}

function onHintChanged(hint: PopupInit["loadHint"]): void {
  if (!state.init) return;
  state.init.loadHint = hint;
  document.getElementById("update-hint")?.remove();
  document.getElementById("update")?.remove();
  const card = state.view === "main" ? updateSlot(state.init) : null;
  if (card) $("main").prepend(card);
}

function onUpdateChanged(u: UpdateNotice | null): void {
  if (!state.init) return;
  state.init.update = u;
  if (state.init.loadHint) return;
  const old = document.getElementById("update");
  if (!u) {
    old?.remove();
    return;
  }
  const card = updateCard(u, { onDismissed: () => document.getElementById("update")?.remove(), compact: true });
  if (old) {
    if (!old.contains(document.activeElement)) old.replaceWith(card);
  } else if (state.view === "main") {
    $("main").prepend(card);
  }
}

// ---- démarrage ------------------------------------------------------------------------------------------
wireFrame();
apparence.surChangement(() => { if (state.view === "apparence" && state.init) render(state.init); });
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
