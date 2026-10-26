// Avis de nouvelle version (popup et réglages), 3.6.1 : « Mettre à jour » en un clic par AETHRYON Desktop.
// - Le clic demande d'abord la permission FACULTATIVE « nativeMessaging » DANS le geste (shared/desktop.ts) ; déjà
//   accordée, Chrome répond tout de suite, sans fenêtre.
// - Puis le service worker demande la mise à jour à Desktop (background/desktop-update.ts) : les étapes RÉELLES
//   annoncées par Desktop (téléchargement, vérification, installation) s'affichent, puis l'extension se recharge.
// - Desktop absent, trop ancien, refus, permission refusée : la page de téléchargement, comme avant (repli).
// - Après le rechargement, si la version n'a pas changé : explication du chargement UNIQUE depuis le dossier géré,
//   avec le chemin exact donné par Desktop (loadHintCard).
import { askDesktopLink } from "../shared/desktop.ts";
import type { LoadHint, UpdateNotice, UpdateProgress, UpdateStep } from "../shared/types.ts";
import { parseInstallResult, send } from "./bg.ts";
import { NB } from "./text.ts";
import { button, h, icon, openTab, setBusy } from "./ui.ts";

const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function released(iso?: string): string | null {
  const t = iso ? Date.parse(`${iso}T00:00:00Z`) : NaN;
  return Number.isFinite(t) ? DATE.format(new Date(t)) : null;
}

const STEPS: [UpdateStep, string][] = [
  ["telechargement", "Téléchargement"],
  ["verification", "Vérification (taille, SHA-256, contenu)"],
  ["installation", "Installation dans le dossier AETHRYON"],
  ["redemarrage", "Redémarrage de l'extension"],
];

const pct = (p: UpdateProgress) => (p.total ? Math.min(100, Math.floor(((p.done ?? 0) / p.total) * 100)) : null);

/** Listes d'étapes affichées (popup ou réglages) : mises à jour par les annonces du service worker. */
const live = new Set<(p: UpdateProgress | null) => void>();
export function onUpdateProgress(p: UpdateProgress | null): void {
  for (const f of live) f(p);
}

function stepsList(): { el: HTMLOListElement; show: (p: UpdateProgress, failedAt?: UpdateStep) => void } {
  const items = STEPS.map(([id, label]) => {
    const detail = h("span", { class: "update-step-detail" });
    const li = h("li", { class: "update-step", "data-step": id, "data-state": "attente" }, h("span", { class: "update-step-dot", "aria-hidden": "true" }), h("span", null, label), detail);
    return { id, li, detail };
  });
  const el = h("ol", { class: "update-steps", "aria-label": "Étapes de la mise à jour", "aria-live": "polite" }, ...items.map((x) => x.li));
  const show = (p: UpdateProgress, failedAt?: UpdateStep) => {
    const at = STEPS.findIndex(([id]) => id === (failedAt ?? p.step));
    items.forEach((x, i) => {
      const state = i < at ? "fait" : i === at ? (failedAt ? "erreur" : "en-cours") : "attente";
      x.li.dataset.state = state;
      x.detail.textContent = i === at && !failedAt && x.id === "telechargement" && pct(p) !== null ? ` · ${pct(p)}${NB}%` : "";
    });
  };
  return { el, show };
}

export function updateCard(u: UpdateNotice, opts: { onDismissed: () => void; compact?: boolean }): HTMLElement {
  const update = button("Mettre à jour", { variant: "primary", size: "sm", icon: "download", action: "update-install" });
  const open = button("Page de téléchargement", { variant: "secondary", size: "sm", icon: "external", action: "update-open" });
  open.addEventListener("click", () => openTab(u.url));
  const hide = button("Masquer", { variant: "quiet", size: "sm", action: "update-dismiss", ariaLabel: `Masquer l'avis de la version ${u.version}` });
  const error = h("p", { class: "form-error", role: "alert" });
  const status = h("p", { class: "update-how", "data-role": "update-status" }, `Mise à jour en un clic avec AETHRYON Desktop${NB}: il télécharge, vérifie et installe la nouvelle version, puis l'extension redémarre. Garde le « Mode développeur » activé dans la page des extensions${NB}: sans lui, le navigateur ne la recharge pas.`);
  const steps = stepsList();
  steps.el.hidden = true;
  let last: UpdateProgress = { version: u.version, step: "telechargement" };
  const listener = (p: UpdateProgress | null) => {
    if (!p || p.version !== u.version) return;
    last = p;
    steps.show(p);
    if (p.step === "redemarrage") status.textContent = `Version ${u.version} installée par AETHRYON Desktop${NB}: l'extension redémarre…`;
  };

  update.addEventListener("click", () => {
    // Dans le geste, avant tout await : sinon Chrome refuse la demande de permission.
    const granted = askDesktopLink();
    error.textContent = "";
    setBusy(update, true, "Mise à jour…");
    hide.disabled = true;
    void (async () => {
      if (!(await granted)) {
        fallback(`Sans l'autorisation de communiquer avec AETHRYON Desktop, la mise à jour passe par la page de téléchargement.`);
        return;
      }
      steps.el.hidden = false;
      steps.show(last);
      live.add(listener);
      const r = await send<unknown>({ type: "update.install", version: u.version }, 7 * 60_000);
      const res = r.ok ? parseInstallResult(r.data) : null;
      if (res?.ok) {
        steps.show({ version: u.version, step: "redemarrage" });
        status.textContent = res.already
          ? `La version ${res.version} était déjà dans le dossier AETHRYON${NB}: l'extension redémarre…`
          : `Version ${res.version} installée par AETHRYON Desktop${NB}: l'extension redémarre…`;
        return; // la page se ferme avec le rechargement
      }
      live.delete(listener);
      if (res && !res.ok) {
        if (res.step) steps.show(last, res.step);
        else steps.el.hidden = true;
        fallback(res.message);
      } else {
        steps.el.hidden = true;
        fallback(r.ok ? "Réponse inattendue du service de l'extension." : r.error.message);
      }
    })();
  });

  /** Repli : la page de téléchargement, comme avant la mise à jour en un clic. */
  function fallback(message: string): void {
    setBusy(update, false);
    hide.disabled = false;
    error.textContent = message;
    open.classList.remove("btn-secondary");
    open.classList.add("btn-primary");
    update.classList.remove("btn-primary");
    update.classList.add("btn-secondary");
    update.querySelector(".btn-label")!.textContent = "Réessayer";
  }

  hide.addEventListener("click", async () => {
    setBusy(hide, true);
    const r = await send<unknown>({ type: "update.dismiss", version: u.version }, 5_000);
    if (r.ok) {
      live.delete(listener);
      opts.onDismissed();
      return;
    }
    setBusy(hide, false);
    error.textContent = r.error.message;
  });
  const date = released(u.released);
  return h("section", { class: "card update", id: "update", "aria-labelledby": "update-title" },
    h("div", { class: "update-head" },
      h("span", { class: "update-icon", "aria-hidden": "true" }, icon("spark", 16)),
      h("div", null,
        h("h2", { id: "update-title", class: "update-title" }, `Nouvelle version ${u.version} disponible`),
        date ? h("p", { class: "update-date" }, `Publiée le ${date}`) : null)),
    u.notes.length ? h("ul", { class: "update-notes", "aria-label": `Nouveautés de la version ${u.version}` }, ...u.notes.map((n) => h("li", { "data-raw": "" }, n))) : null,
    u.needsChrome ? h("p", { class: "hint" }, icon("info", 15), h("span", null, `Cette version demande Chrome ${u.needsChrome} ou plus récent${NB}: mets d'abord ton navigateur à jour.`)) : null,
    status,
    steps.el,
    h("div", { class: "update-actions" }, update, open, hide),
    error);
}

/**
 * Explication montrée après une mise à jour par Desktop quand la version chargée n'a pas changé : ce navigateur
 * charge l'extension depuis un autre dossier. Une seule fois : charger le dossier géré ; ensuite, un clic suffit.
 */
export function loadHintCard(hint: LoadHint, opts: { onDismissed: () => void }): HTMLElement {
  const copied = h("span", { class: "update-copied", "aria-live": "polite" });
  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text).then(() => { copied.textContent = `${what} copié.`; }, () => { copied.textContent = ""; });
  };
  const path = h("code", { class: "update-path", "data-role": "load-folder" }, hint.folder);
  const copyPath = button("Copier le chemin", { variant: "primary", size: "sm", icon: "folder", action: "hint-copy" });
  copyPath.addEventListener("click", () => copy(hint.folder, "Chemin"));
  const openExt = button("Ouvrir la page des extensions", { variant: "secondary", size: "sm", icon: "puzzle", action: "hint-extensions" });
  openExt.addEventListener("click", () => {
    void chrome.tabs.create({ url: "chrome://extensions" }).catch(() => copy("chrome://extensions", "Adresse"));
  });
  const done = button("C'est fait", { variant: "quiet", size: "sm", action: "hint-dismiss" });
  done.addEventListener("click", async () => {
    setBusy(done, true);
    await send<unknown>({ type: "update.hint.dismiss" }, 5_000);
    opts.onDismissed();
  });
  return h("section", { class: "card update update-hint", id: "update-hint", "aria-labelledby": "update-hint-title" },
    h("div", { class: "update-head" },
      h("span", { class: "update-icon", "aria-hidden": "true" }, icon("folder", 16)),
      h("div", null,
        h("h2", { id: "update-hint-title", class: "update-title" }, "Charge l'extension depuis le dossier AETHRYON (une seule fois)"),
        h("p", { class: "update-date" }, `AETHRYON Desktop a installé la version ${hint.version}, mais ce navigateur utilise encore la ${hint.loaded}, chargée depuis un autre dossier.`))),
    h("ol", { class: "update-notes update-how-to" },
      h("li", null, "Ouvre la page des extensions (chrome://extensions) et active « Mode développeur »."),
      h("li", null, `Clique « Charger l'extension non empaquetée » et choisis ce dossier (même extension, elle remplace l'ancienne)${NB}:`),
      h("li", { class: "update-path-row" }, path)),
    h("p", { class: "update-how" }, "Ensuite, chaque mise à jour se fera en un clic, sans ZIP à télécharger."),
    h("div", { class: "update-actions" }, copyPath, openExt, done),
    copied);
}
