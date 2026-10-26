// Page de réglages AETHRYON (ouverte dans un onglet). Chaque changement est enregistré aussitôt
// (saveSettings → storage.sync) et confirmé discrètement : « Enregistré », annoncé poliment.
// Le compte vient du service worker (popup.init) ; les notifications demandent la permission facultative
// au moment du clic (geste de l'utilisateur, exigé par Chrome) et la rendent quand on les coupe.
// « Données et confidentialité » affiche la MÊME notice que la page d'accueil (src/shared/consent.ts) et
// permet de retirer son accord (déconnexion, puis plus aucune requête).
import { HELP_URL, KEYS_URL, PRIVACY_URL, VERSION, versionLine } from "../shared/config.ts";
import { DISCLOSURE, RIGHTS_NOTICE } from "../shared/consent.ts";
import { askDesktopLink, hasDesktopLink } from "../shared/desktop.ts";
import { getSettings, mergeSettings, onSettingsChanged, saveSettings } from "../shared/storage.ts";
import type { PopupInit } from "../shared/messages.ts";
import { BITRATES, QUALITIES, type AccountView, type Bitrate, type ConsentView, type Fmt, type Quality, type Settings } from "../shared/types.ts";
import { BUILD_PLATFORMS } from "../shared/platforms.ts";
import type { Platform } from "../shared/urls.ts";
import { consentGate, identity, loginControl, logoutControl, openWelcome } from "../popup/account-ui.ts";
import { onPageEvents, parseInit, send } from "../popup/bg.ts";
import { DESKTOP_ASK, DESKTOP_ALLOWED, NB, QUALITY_LABEL, SIGNED_OUT_TEXT, WITHDRAWN_TEXT, bitrateLabel, degradedText, quotaText, resetText } from "../popup/text.ts";
import { $, bindSiteLink, brandLogo, button, fill, h, icon, platformLogo, setBusy } from "../popup/ui.ts";
import { loadHintCard, onUpdateProgress, updateCard } from "../popup/update-ui.ts";

/** Plateformes prises en charge (une ligne de réglage chacune). */
const PLATFORMS: readonly Platform[] = BUILD_PLATFORMS;
const NOTIF: chrome.permissions.Permissions = { permissions: ["notifications"] };

let current: Settings = mergeSettings(undefined);

const ui = {
  inline: $("inline-buttons") as HTMLInputElement,
  quality: $("quality") as HTMLSelectElement,
  bitrate: $("bitrate") as HTMLSelectElement,
  panel: $("floating-panel") as HTMLInputElement,
  panelPos: $("panel-pos"),
  panelReset: $("panel-reset") as HTMLButtonElement,
  notif: $("notifications") as HTMLInputElement,
  pageTools: $("page-tools") as HTMLInputElement,
  notifMsg: $("notif-msg"),
  status: $("save-status"),
  destLinkRow: $("dest-link-row"),
  destLinkText: $("d-dest-link"),
  destAllow: $("dest-allow") as HTMLButtonElement,
};
/** 3.5.2 : lien local avec AETHRYON Desktop autorisé (permission facultative nativeMessaging) ; null : pas encore lu. */
let desktopGranted: boolean | null = null;
const platformSwitch = (p: Platform) => $(`pf-${p}`) as HTMLInputElement;
const fmtRadios = () => [...document.querySelectorAll<HTMLInputElement>('input[name="default-fmt"]')];
const radios = (name: string) => [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];

// ---- affichage des réglages ---------------------------------------------------------------------
function apply(s: Settings): void {
  ui.inline.checked = s.inlineButtons;
  for (const p of PLATFORMS) {
    const sw = platformSwitch(p);
    sw.checked = s.platforms[p];
    sw.disabled = !s.inlineButtons; // sans effet tant que les boutons sont coupés
  }
  for (const r of fmtRadios()) r.checked = r.value === s.defaultFmt;
  for (const r of radios("clip-length")) r.checked = Number(r.value) === s.clipLength;
  for (const r of radios("clip-anchor")) r.checked = r.value === s.clipAnchor;
  for (const r of radios("destination")) r.checked = r.value === s.destination;
  ui.pageTools.checked = s.pageTools;
  ui.quality.value = s.quality;
  ui.bitrate.value = String(s.bitrate);
  ui.panel.checked = s.floatingPanel;
  ui.panelPos.textContent = s.panelPosition ? "Position choisie en déplaçant le panneau." : "Position par défaut.";
  // aria-disabled (et non disabled) : le bouton garde le focus juste après la réinitialisation.
  if (s.panelPosition) ui.panelReset.removeAttribute("aria-disabled");
  else ui.panelReset.setAttribute("aria-disabled", "true");
  if (ui.notif.getAttribute("aria-busy") !== "true") ui.notif.checked = s.notifications;
  renderDesktopLink();
}

/** Ligne « Suivi par AETHRYON Desktop » : seulement avec « Premiere Pro » ; « Autoriser » tant que ce n'est pas fait. */
function renderDesktopLink(): void {
  const show = current.destination === "premiere" && desktopGranted !== null;
  ui.destLinkRow.hidden = !show;
  ui.destLinkText.textContent = desktopGranted ? DESKTOP_ALLOWED : DESKTOP_ASK;
  ui.destAllow.hidden = desktopGranted === true;
}

/** Demande DANS le geste (clic sur « Premiere Pro » ou « Autoriser ») ; refus : rien de plus, le dossier suffit. */
function askDesktop(): void {
  if (desktopGranted === true || ui.destAllow.getAttribute("aria-busy") === "true") return;
  ui.destAllow.setAttribute("aria-busy", "true");
  void askDesktopLink().then((granted) => {
    ui.destAllow.removeAttribute("aria-busy");
    desktopGranted = granted;
    renderDesktopLink();
  });
}

let hideTimer: ReturnType<typeof setTimeout> | undefined;
/** Confirmation discrète (zone role="status") : vidée puis remplie pour être annoncée à chaque fois. */
function flash(text: string, tone: "ok" | "bad" = "ok"): void {
  const s = ui.status;
  clearTimeout(hideTimer);
  s.textContent = "";
  s.dataset.tone = tone;
  requestAnimationFrame(() => {
    fill(s, icon(tone === "ok" ? "check" : "alert", 15), text);
    s.dataset.show = "true";
  });
  hideTimer = setTimeout(() => {
    s.dataset.show = "false";
    hideTimer = setTimeout(() => { s.textContent = ""; }, 400);
  }, tone === "ok" ? 1800 : 6000);
}

async function save(patch: Partial<Settings>): Promise<boolean> {
  try {
    current = await saveSettings(patch);
    apply(current);
    flash("Enregistré");
    return true;
  } catch {
    apply(current); // l'interface revient à ce qui est réellement enregistré
    flash(`Impossible d'enregistrer${NB}: réessaie.`, "bad");
    return false;
  }
}

function notifMessage(text: string, tone: "ok" | "bad" = "ok"): void {
  ui.notifMsg.textContent = text;
  ui.notifMsg.dataset.tone = tone;
}

// ---- interactions -------------------------------------------------------------------------------
function bind(): void {
  ui.inline.addEventListener("change", () => void save({ inlineButtons: ui.inline.checked }));
  for (const p of PLATFORMS) {
    const sw = platformSwitch(p);
    sw.addEventListener("change", () => void save({ platforms: { ...current.platforms, [p]: sw.checked } }));
  }
  for (const r of fmtRadios()) r.addEventListener("change", () => { if (r.checked) void save({ defaultFmt: r.value as Fmt }); });
  ui.quality.addEventListener("change", () => void save({ quality: ui.quality.value as Quality }));
  ui.bitrate.addEventListener("change", () => void save({ bitrate: Number(ui.bitrate.value) as Bitrate }));
  ui.panel.addEventListener("change", () => void save({ floatingPanel: ui.panel.checked }));
  for (const r of radios("clip-length")) r.addEventListener("change", () => { if (r.checked) void save({ clipLength: Number(r.value) as Settings["clipLength"] }); });
  for (const r of radios("clip-anchor")) r.addEventListener("change", () => { if (r.checked) void save({ clipAnchor: r.value as Settings["clipAnchor"] }); });
  ui.pageTools.addEventListener("change", () => void save({ pageTools: ui.pageTools.checked }));
  for (const r of radios("destination")) r.addEventListener("change", () => {
    if (!r.checked) return;
    // « Premiere Pro » : permission demandée tout de suite (geste de l'utilisateur), une seule fois si accordée.
    if (r.value === "premiere") askDesktop();
    void save({ destination: r.value as Settings["destination"] });
  });
  ui.destAllow.addEventListener("click", () => askDesktop());
  ui.panelReset.addEventListener("click", () => {
    if (ui.panelReset.getAttribute("aria-disabled") === "true") return;
    void save({ panelPosition: null });
  });

  ui.notif.addEventListener("change", () => {
    if (ui.notif.getAttribute("aria-busy") === "true") {
      ui.notif.checked = !ui.notif.checked; // demande en cours : on ignore
      return;
    }
    if (ui.notif.checked) {
      ui.notif.checked = false; // reste coupé tant que Chrome n'a pas accordé l'autorisation
      ui.notif.setAttribute("aria-busy", "true");
      notifMessage("");
      // Appel immédiat, DANS le geste de l'utilisateur (sinon Chrome refuse la demande).
      chrome.permissions.request(NOTIF).then(async (granted) => {
        ui.notif.removeAttribute("aria-busy");
        if (granted) {
          ui.notif.checked = true;
          if (await save({ notifications: true })) notifMessage("Notifications activées.");
        } else {
          notifMessage(`Autorisation refusée${NB}: les notifications restent désactivées. Tu peux réessayer quand tu veux.`, "bad");
        }
      }, () => {
        ui.notif.removeAttribute("aria-busy");
        notifMessage(`Chrome n'a pas pu demander l'autorisation${NB}: les notifications restent désactivées.`, "bad");
      });
      return;
    }
    notifMessage("");
    void chrome.permissions.remove(NOTIF).catch(() => false);
    void save({ notifications: false });
  });
}

/** Réglage « activé » mais permission retirée entre-temps (chrome://extensions) : on dit la vérité. */
async function reconcileNotifications(): Promise<void> {
  if (!current.notifications) return;
  const granted = await chrome.permissions.contains(NOTIF).catch(() => false);
  if (granted) return;
  try {
    current = await saveSettings({ notifications: false });
    apply(current);
  } catch { /* l'interface montre déjà l'état réel ci-dessous */ }
  ui.notif.checked = false;
  notifMessage(`L'autorisation des notifications n'est plus accordée${NB}: option désactivée.`, "bad");
}

// ---- compte -------------------------------------------------------------------------------------
let lastInit: PopupInit | null = null;
/** Phrase dite une fois après une déconnexion faite ailleurs (popup) ou un accord retiré. */
let transient: string | null = null;

async function loadAccount(focus = false): Promise<void> {
  const body = $("account-body");
  const res = await send<unknown>({ type: "popup.init" }, 10_000);
  const init = res.ok ? parseInit(res.data) : null;
  if (!init) {
    const retry = button("Réessayer", { variant: "secondary", size: "sm", icon: "retry", action: "account-retry" });
    retry.addEventListener("click", () => {
      setBusy(retry, true, "Chargement…");
      void loadAccount(true);
    });
    fill(body,
      h("p", { class: "form-error", role: "alert", "data-raw": "" }, res.ok ? "Réponse inattendue du service de l'extension." : res.error.message),
      h("div", null, retry));
    if (focus) retry.focus();
    return;
  }
  lastInit = init;
  renderAccount(init.account, init.consent, focus);
  renderConsent(init.consent);
  renderUpdate(init);
}

function renderAccount(a: AccountView, consent: ConsentView, focus: boolean): void {
  const body = $("account-body");
  if (!consent.accepted) {
    fill(body,
      h("div", { class: "account-head" },
        h("p", { class: "row-desc" }, consent.outdated
          ? `La notice sur les données a changé avec la mise à jour${NB}: relis-la et accepte-la. ${a.connected ? `Ta connexion est gardée${NB}; rien` : "Rien"} n'est envoyé à un serveur avant.`
          : `Avant de connecter l'extension, lis la notice sur les données et accepte-la${NB}: rien n'est envoyé à un serveur avant.`),
        h("span", { class: "badge" }, consent.outdated ? "Notice à relire" : "Non connecté")),
      consentGate({ compact: true }));
    if (focus) body.querySelector<HTMLElement>("[data-action=open-notice]")?.focus();
    return;
  }
  if (a.connected) {
    const d = a.degraded ? degradedText(a.degraded) : null;
    fill(body,
      h("div", { class: "account-head" },
        identity(a),
        d ? h("span", { class: "badge", "data-tone": "warn" }, d.pill) : h("span", { class: "badge", "data-tone": "ok" }, "Connecté")),
      d
        ? h("p", { class: "notice", role: "status" }, icon("alert", 15), h("span", null, `${d.title}. ${d.text}`))
        : h("p", { class: "account-quota tabular" }, `Aujourd'hui${NB}: ${quotaText(a.today)}${a.today && a.today.limit !== null ? ` · ${resetText(a.today)}` : ""}`),
      a.stale && !a.degraded ? h("p", { class: "note" }, icon("info", 14), "Infos du compte non actualisées") : null,
      a.suspended ? h("p", { class: "notice", "data-tone": "bad" }, icon("alert", 15), h("span", null, `Ton compte AETHRYON est suspendu par un administrateur${NB}: les conversions sont refusées.`)) : null,
      logoutControl(() => loadAccount(true)));
    if (focus) body.querySelector<HTMLElement>("[data-action=logout]")?.focus();
    return;
  }
  // Déconnexion imposée par le serveur (motif gardé) ou faite ailleurs (phrase dite une fois).
  const text = a.notice?.message ?? transient;
  transient = null;
  fill(body,
    h("div", { class: "account-head" },
      h("p", { class: "row-desc" }, `L'extension n'est pas connectée. Connecte-la à ton compte AETHRYON${NB}: même compte et même quota que le raccourci iPhone.`),
      h("span", { class: "badge" }, "Non connecté")),
    text ? h("p", { class: "notice", id: "auth-notice" }, icon("alert", 15), h("span", null, text)) : null,
    loginControl({ size: "md", describedBy: text ? "auth-notice" : undefined, onSuccess: () => loadAccount(true) }));
  if (focus) body.querySelector<HTMLElement>("[data-action=login]")?.focus();
}

// ---- données et confidentialité ------------------------------------------------------------------
const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

function renderDisclosure(): void {
  fill($("disclosure"), ...DISCLOSURE.flatMap((d) => [h("dt", null, d.title), h("dd", null, d.text)]));
  $("rights").textContent = RIGHTS_NOTICE;
}

function renderConsent(c: ConsentView): void {
  const status = $("consent-status");
  const actions = $("consent-actions");
  const t = c.at ? Date.parse(c.at) : NaN;
  status.textContent = c.accepted
    ? `Tu as accepté cette notice${Number.isFinite(t) ? ` le ${DATE.format(new Date(t))}` : ""}. Tu peux retirer ton accord à tout moment${NB}: l'extension se déconnecte et n'envoie plus rien.`
    : c.outdated
      ? `Cette notice a changé depuis ton accord (nouvelles fonctions de la version ${VERSION})${NB}: l'extension n'envoie rien tant que tu ne l'as pas relue et acceptée.`
      : `Tu n'as pas encore accepté cette notice${NB}: l'extension n'envoie rien tant que tu ne l'as pas fait.`;
  if (!c.accepted) {
    const read = button("Lire la notice et accepter", { variant: "primary", size: "sm", icon: "shield", action: "open-notice-full" });
    read.addEventListener("click", () => void openWelcome("donnees"));
    fill(actions, read);
    return;
  }
  const withdraw = button("Retirer mon accord", { variant: "secondary", size: "sm", action: "consent-withdraw" });
  withdraw.addEventListener("click", () => askWithdraw(actions, withdraw));
  fill(actions, withdraw);
}

function askWithdraw(area: HTMLElement, opener: HTMLButtonElement): void {
  const error = h("p", { class: "form-error", role: "alert" });
  const yes = button("Retirer mon accord", { variant: "danger", size: "sm", action: "consent-withdraw-confirm" });
  const no = button("Annuler", { variant: "secondary", size: "sm", action: "consent-withdraw-cancel" });
  const box = h("div", { class: "confirm", role: "group", "aria-labelledby": "withdraw-q", "aria-describedby": "withdraw-d" },
    h("p", { id: "withdraw-q", class: "confirm-q" }, `Retirer ton accord${NB}?`),
    h("p", { id: "withdraw-d", class: "hint" }, "L'extension se déconnecte (sa clé est révoquée), efface la liste des téléchargements et n'envoie plus rien jusqu'à un nouvel accord."),
    h("div", { class: "confirm-actions" }, yes, no),
    error);
  const back = () => {
    fill(area, opener);
    opener.focus();
  };
  no.addEventListener("click", back);
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && yes.getAttribute("aria-busy") !== "true") {
      e.preventDefault();
      back();
    }
  });
  yes.addEventListener("click", async () => {
    setBusy(yes, true, "Retrait…");
    no.disabled = true;
    const r = await send<unknown>({ type: "consent.withdraw" }, 20_000);
    if (!r.ok) {
      setBusy(yes, false);
      no.disabled = false;
      error.textContent = r.error.message;
      return;
    }
    transient = WITHDRAWN_TEXT;
    await loadAccount();
    $("consent-actions").querySelector<HTMLElement>("button")?.focus();
  });
  fill(area, box);
  no.focus();
}

// ---- avis de nouvelle version ----------------------------------------------------------------------
let updateNow: PopupInit["update"] = null;
let hintNow: PopupInit["loadHint"] = null;
/** Avis de mise à jour, ou (prioritaire) l'explication du chargement unique depuis le dossier AETHRYON. */
function paintUpdate(): void {
  const slot = $("update-slot");
  if (hintNow) {
    fill(slot, loadHintCard(hintNow, { onDismissed: () => { hintNow = null; paintUpdate(); } }));
    return;
  }
  fill(slot, updateNow ? updateCard(updateNow, { onDismissed: () => slot.replaceChildren() }) : null);
}
function renderUpdate(init: PopupInit): void {
  updateNow = init.update;
  hintNow = init.loadHint;
  paintUpdate();
}

// ---- démarrage ----------------------------------------------------------------------------------
function wireFrame(): void {
  $("brand").append(brandLogo(32, 11.5));
  for (const span of document.querySelectorAll<HTMLElement>(".pf-icon")) {
    const p = span.dataset.platform as Platform;
    if (PLATFORMS.includes(p)) span.append(platformLogo(p, 16));
  }
  for (const box of document.querySelectorAll(".select")) box.append(icon("chevron", 16));
  fill(ui.quality, ...QUALITIES.map((q) => h("option", { value: q }, QUALITY_LABEL[q])));
  fill(ui.bitrate, ...BITRATES.map((b) => h("option", { value: String(b) }, bitrateLabel(b))));
  $("keys-icon").append(icon("external", 14));
  bindSiteLink($("keys-link") as HTMLAnchorElement, KEYS_URL);
  bindSiteLink($("privacy-link") as HTMLAnchorElement, PRIVACY_URL);
  bindSiteLink($("help-link") as HTMLAnchorElement, HELP_URL);
  $("version").textContent = versionLine(VERSION);
  renderDisclosure();
}

async function boot(): Promise<void> {
  wireFrame();
  try {
    current = await getSettings();
  } catch { /* valeurs par défaut */ }
  apply(current);
  bind();
  onSettingsChanged((s) => {
    current = s;
    apply(s);
  });
  // Liaison changée ailleurs (popup, page d'accueil, clé refusée par le serveur) : la page suit aussitôt.
  onPageEvents({
    auth: (e) => {
      if (!e.connected && e.reason === "signed_out" && lastInit?.account.connected) transient = SIGNED_OUT_TEXT;
      if (!e.connected && e.reason === "withdrawn") transient = WITHDRAWN_TEXT;
      if ($("account-body").querySelector(".confirm")) return; // confirmation ouverte ici : elle se rechargera seule
      void loadAccount();
    },
    update: (u) => {
      updateNow = u;
      if (!$("update-slot").contains(document.activeElement)) paintUpdate();
    },
    progress: onUpdateProgress,
    hint: (h) => {
      hintNow = h;
      paintUpdate();
    },
  });
  void reconcileNotifications();
  // 3.5.2 : lien avec AETHRYON Desktop déjà autorisé ? (retiré ailleurs, dans chrome://extensions : la page le dit)
  void hasDesktopLink().then((g) => {
    desktopGranted = g;
    renderDesktopLink();
  });
  try {
    chrome.permissions?.onAdded?.addListener(() => void hasDesktopLink().then((g) => { desktopGranted = g; renderDesktopLink(); }));
    chrome.permissions?.onRemoved?.addListener(() => void hasDesktopLink().then((g) => { desktopGranted = g; renderDesktopLink(); }));
  } catch { /* événements absents : l'état lu au chargement reste affiché */ }
  void loadAccount();
}

void boot();
