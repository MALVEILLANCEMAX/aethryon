// Page d'accueil de l'extension (ouverte au premier lancement par chrome.runtime.onInstalled, et depuis le
// popup, les réglages ou le bouton d'une page pour lire la notice). Dans l'ordre :
//   1. installation confirmée (version réelle du manifeste) et épinglage de l'icône — l'état « épinglée » est
//      LU dans Chrome (chrome.action.getUserSettings), jamais supposé ;
//   2. notice sur les données (src/shared/consent.ts, la même que dans les réglages) et « Accepter » : rien
//      ne part vers un serveur avant ;
//   3. « Se connecter à AETHRYON » (vraie connexion par le service worker), possible seulement après l'accord.
// Rappel des droits, honnête : l'installation hors store ne change rien aux conditions des plateformes.
import { HELP_URL, PRIVACY_URL, VERSION, versionLine } from "../shared/config.ts";
import { CONSENT_VERSION, DISCLOSURE, RIGHTS_NOTICE } from "../shared/consent.ts";
import type { PopupInit } from "../shared/messages.ts";
import type { ConsentView } from "../shared/types.ts";
import { loginControl } from "../popup/account-ui.ts";
import { onPageEvents, parseInit, send } from "../popup/bg.ts";
import { NB } from "../popup/text.ts";
import { $, bindSiteLink, brandLogo, button, fill, h, icon, owl, platformLogo, setBusy, type IconName } from "../popup/ui.ts";
import { PLATFORM_LABEL, type Platform } from "../shared/urls.ts";
import { demarrerApparence } from "../shared/apparence.ts";
import { medaille, sceau } from "../shared/egide.ts";

type StepState = "done" | "current" | "todo";
const STATE_TEXT: Record<StepState, string> = { done: " (fait)", current: " (étape en cours)", todo: " (à faire)" };
const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

// Égide (3.9.0) : la chouette maître sur sa médaille, immobile ; quand les trois étapes sont faites, le sceau se frappe
// une fois (moment rare : délice permis ; aucun mouvement en mouvement réduit). Plus de mascotte animée.
const apparence = demarrerApparence(document.documentElement);
void apparence;
const mascot = (() => {
  const host = h("span", { class: "p-chouette", "data-state": "idle" }, medaille({ taille: 96 }));
  let done = false;
  return {
    el: host,
    setState(s: "success" | "error" | "idle", _o?: { replay?: boolean }) {
      host.dataset.state = s;
      if (s !== "success" || done || !allDone()) return;
      done = true;
      host.replaceChildren(sceau({ taille: 96 }));
    },
  };
})();
const allDone = () => [...document.querySelectorAll<HTMLElement>(".w-step")].every((li) => li.dataset.state === "done");
const PLATFORMS: readonly Platform[] = ["youtube", "tiktok", "twitter"];
let pinned: boolean | null = null;

function setStep(id: string, s: StepState): void {
  const li = $(id);
  li.dataset.state = s;
  const sr = li.querySelector(".w-state");
  if (sr) sr.textContent = STATE_TEXT[s];
}

function manifestVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return VERSION;
  }
}

// ---- 1. installation et épinglage ------------------------------------------------------------------
function isEdge(): boolean {
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands ?? [];
  return brands.some((b) => b.brand === "Microsoft Edge") || /\bEdg\//.test(navigator.userAgent);
}

function wirePin(): void {
  const edge = isEdge();
  const steps: [string, IconName][] = edge
    ? [
      [`Clique sur le bouton «${NB}Extensions${NB}» (la pièce de puzzle), à droite de la barre d'adresse.`, "puzzle"],
      [`En face d'AETHRYON, clique sur l'œil «${NB}Afficher dans la barre d'outils${NB}».`, "eye"],
    ]
    : [
      [`Clique sur la pièce de puzzle «${NB}Extensions${NB}», à droite de la barre d'adresse.`, "puzzle"],
      [`En face d'AETHRYON, clique sur la punaise${NB}: l'icône de la chouette reste dans la barre.`, "pin"],
    ];
  fill($("pin-how"), ...steps.map(([t, ic]) => h("li", null, icon(ic, 18), h("span", null, t))));
  // Illustration : la vraie tête du logo (petit logo, comme l'icône de la barre) dans une barre schématique.
  fill($("pin-illus"),
    h("div", { class: "w-toolbar" },
      h("span", { class: "w-omnibox" }),
      h("span", { class: "w-tb-btn" }, icon("puzzle", 18)),
      h("span", { class: "w-tb-btn w-tb-owl" }, owl(18))),
    h("div", { class: "w-menu" },
      h("span", { class: "w-menu-owl" }, owl(16)),
      h("span", { class: "w-menu-name" }, "AETHRYON"),
      h("span", { class: "w-menu-pin" }, icon("pin", 16))));
  void refreshPinned();
  // Chrome 130 et plus : changement annoncé ; avant, vérification douce tant que la page est visible.
  const action = chrome.action as typeof chrome.action & { onUserSettingsChanged?: chrome.events.Event<(s: { isOnToolbar?: boolean }) => void> };
  if (action.onUserSettingsChanged) action.onUserSettingsChanged.addListener((s) => showPinned(s.isOnToolbar === true));
  else setInterval(() => { if (!document.hidden && pinned !== true) void refreshPinned(); }, 2_000);
}

async function refreshPinned(): Promise<void> {
  try {
    const s = await chrome.action.getUserSettings();
    showPinned(s.isOnToolbar === true);
  } catch {
    showPinned(null);
  }
}

function showPinned(on: boolean | null): void {
  if (on === pinned) return;
  pinned = on;
  setStep("epingler", on ? "done" : "current");
  $("pin-status").textContent = on === true
    ? `C'est fait${NB}: l'icône AETHRYON est épinglée dans la barre d'outils.`
    : on === false ? "L'icône n'est pas encore épinglée (tu peux aussi passer cette étape)." : "";
  ($("pin-status") as HTMLElement).dataset.tone = on ? "ok" : "";
  if (on) mascot.setState("success", { replay: true });
}

// ---- 2. notice sur les données ---------------------------------------------------------------------
function renderDisclosure(): void {
  fill($("disclosure"), ...DISCLOSURE.flatMap((d) => [h("dt", null, d.title), h("dd", null, d.text)]));
  $("rights").textContent = RIGHTS_NOTICE;
}

function renderConsent(c: ConsentView): void {
  const area = $("consent-area");
  setStep("donnees", c.accepted ? "done" : "current");
  if (c.accepted) {
    const t = c.at ? Date.parse(c.at) : NaN;
    fill(area, h("p", { class: "w-status", "data-tone": "ok", role: "status" }, icon("check", 16),
      h("span", null, `Accord enregistré${Number.isFinite(t) ? ` le ${DATE.format(new Date(t))}` : ""}. Tu pourras le retirer à tout moment dans les réglages de l'extension.`)));
    return;
  }
  const accept = button("Accepter", { variant: "primary", size: "lg", icon: "check", action: "consent-accept", describedBy: "consent-what" });
  const error = h("p", { class: "form-error", role: "alert" });
  accept.addEventListener("click", async () => {
    if (accept.getAttribute("aria-busy") === "true") return;
    error.textContent = "";
    setBusy(accept, true, "Enregistrement…");
    const r = await send<unknown>({ type: "consent.accept", version: CONSENT_VERSION }, 10_000);
    if (!r.ok) {
      setBusy(accept, false);
      error.textContent = r.error.message;
      mascot.setState("error");
      return;
    }
    mascot.setState("success", { replay: true });
    await load("login");
  });
  fill(area,
    c.outdated ? h("p", { class: "notice", role: "status" }, icon("info", 15), h("span", null, `Cette notice a changé depuis ton accord (nouvelles fonctions de la version ${manifestVersion()})${NB}: relis-la, puis accepte-la pour continuer.`)) : null,
    h("p", { class: "w-hint", id: "consent-what" }, `En acceptant, tu autorises l'extension à envoyer ces données quand tu te connectes, télécharges une vidéo, crées un extrait ou ouvres un fichier dans AETHRYON Tools${NB}; tu peux retirer ton accord à tout moment dans les réglages.`),
    h("div", { class: "w-actions" }, accept),
    error);
}

// ---- 3. connexion -------------------------------------------------------------------------------
function renderLogin(p: PopupInit): void {
  const area = $("login-area");
  const a = p.account;
  if (!p.consent.accepted) {
    setStep("connexion", "todo");
    fill(area, loginControl({ size: "lg", locked: true, onSuccess: () => load() }));
    return;
  }
  if (a.connected) {
    setStep("connexion", "done");
    const who = a.email || a.name || "ton compte AETHRYON";
    fill(area, h("p", { class: "w-status", "data-tone": "ok", role: "status" }, icon("check", 16), h("span", { "data-raw": "" }, `Connecté à ${who}.`)));
    const next = $("w-next");
    next.hidden = false;
    $("w-next-text").textContent = `Ouvre une vidéo YouTube, TikTok ou X${NB}: le bouton AETHRYON apparaît sous la vidéo. Tu peux aussi cliquer sur l'icône de la chouette dans la barre d'outils.`;
    // Mêmes pictogrammes neutres v3 que le popup et les pages (aucun logo de marque, docs/MARQUES.md).
    fill($("w-platforms"), ...PLATFORMS.map((pf) => h("li", null, platformLogo(pf, 18), h("span", null, PLATFORM_LABEL[pf]))));
    return;
  }
  setStep("connexion", "current");
  $("w-next").hidden = true;
  fill(area,
    a.notice ? h("p", { class: "notice", id: "auth-notice" }, icon("alert", 15), h("span", null, a.notice.message)) : null,
    loginControl({
      size: "lg", describedBy: a.notice ? "auth-notice" : undefined,
      onSuccess: async () => {
        mascot.setState("success", { replay: true });
        await load();
      },
      onError: () => mascot.setState("error"),
    }));
}

// ---- chargement -----------------------------------------------------------------------------------
async function load(focus?: "login"): Promise<void> {
  const res = await send<unknown>({ type: "popup.init" }, 10_000);
  const p = res.ok ? parseInit(res.data) : null;
  if (!p) {
    fill($("consent-area"), h("p", { class: "form-error", role: "alert", "data-raw": "" }, res.ok ? "Réponse inattendue du service de l'extension." : res.error.message));
    return;
  }
  renderConsent(p.consent);
  renderLogin(p);
  if (focus === "login") $("login-area").querySelector<HTMLElement>("[data-action=login]:not(:disabled)")?.focus();
}

function goToHash(): void {
  const id = location.hash.slice(1);
  if (id !== "donnees" && id !== "connexion") return;
  const title = $(id).querySelector<HTMLElement>(".w-step-title");
  const apply = () => {
    title?.scrollIntoView({ block: "start" });
    title?.focus({ preventScroll: true });
  };
  apply();
  // Onglet ouvert sans le focus (ouvert depuis le popup ou une page) : appliqué quand il le reçoit.
  if (!document.hasFocus()) window.addEventListener("focus", apply, { once: true });
}

function wireFrame(): void {
  const version = manifestVersion();
  $("brand").append(brandLogo(26));
  $("w-version").textContent = versionLine(version);
  $("version").textContent = versionLine(version);
  $("w-mascot").append(mascot.el);
  fill($("w-kicker"), icon("check", 16), h("span", null, "Installation réussie"));
  $("w-lead").textContent = `Version ${version}, chargée par ton navigateur. Encore trois étapes${NB}: épingle l'icône, lis ce que l'extension fait de tes données, puis connecte ton compte.`;
  bindSiteLink($("help-link") as HTMLAnchorElement, HELP_URL);
  bindSiteLink($("privacy-link") as HTMLAnchorElement, PRIVACY_URL);
  renderDisclosure();
  wirePin();
}

wireFrame();
onPageEvents({
  auth: () => void load(),
});
void load().then(goToHash);
window.addEventListener("hashchange", goToHash);
