// Avancement d'un export d'extrait (3.6.0) : étapes RÉELLES du serveur (analyse, récupération, conversion,
// finalisation, terminé), pourcentage seulement quand il est mesuré, sinon animation indéterminée et phrase qui dit ce
// qui se passe. Égide (3.9.0) : la chouette maître (dessin du fichier maître, src/shared/owl.ts) sur sa médaille reste
// IMMOBILE ; un fil tourne autour pendant le travail (la veille), puis la médaille se frappe une fois quand le fichier est
// prêt (le sceau). Mouvement réduit : rien ne bouge.
import { ETAPES, ETAPE_LABEL, ETAPE_SHORT, etapeDetail, etapeRank, type Etape } from "../shared/etapes.ts";
import type { ClipFormat } from "../shared/extrait.ts";
import { owlSvg } from "../shared/owl.ts";
import { el, setAttr, setText } from "./dom.ts";
import { NBSP, X, progressAria, stepAria } from "./texts.ts";

export type ExportPhase = "sending" | "queued" | "converting" | "downloading" | "done" | "error" | "cancelled";

/** Ce que l'éditeur sait d'un export (menu des pages : SafeJob ; popup : JobView). */
export interface ExportView {
  phase: ExportPhase;
  etape: Etape | null;
  /** Pourcentage MESURÉ (serveur ou octets reçus par le navigateur), sinon null. */
  progress: number | null;
  format: ClipFormat;
  error?: { code: string; message: string; retryable: boolean } | null;
  canCancel: boolean;
  canShow: boolean;
}

export interface ProgressHooks {
  cancel(): void;
  show(): void;
  retry(): void;
}

const BUSY = new Set<ExportPhase>(["sending", "queued", "converting", "downloading"]);

/** Étape montrée : celle du serveur ; avant la première réponse, l'analyse ; enregistrement par le navigateur : finalisation. */
export function shownEtape(v: ExportView): Etape {
  if (v.phase === "done") return "termine";
  if (v.etape) return v.etape;
  if (v.phase === "downloading") return "finalisation";
  return "analyse";
}

/**
 * Titre, phrase et pourcentage de l'état (pur : testé). `pct` : « 42 % » seulement quand l'avancement est MESURÉ ;
 * sinon null (barre indéterminée, la phrase dit ce qui se passe).
 */
export function describeExport(v: ExportView): { title: string; detail: string; tone: "busy" | "ok" | "bad" | "neutral"; pct: string | null } {
  if (v.phase === "sending") return { title: X.sending, detail: "La demande part avec le début et la fin exacts du passage.", tone: "busy", pct: null };
  if (v.phase === "error") {
    const code = v.error?.code ?? "";
    const title = code === "extrait_partiel_impossible" ? X.partialTitle
      : code === "quota_exceeded" ? X.quotaTitle
        : code === "network" || code === "no_answer" ? X.networkTitle
          : X.failed;
    return { title, detail: v.error?.message ?? "L’export a échoué.", tone: "bad", pct: null };
  }
  if (v.phase === "cancelled") return { title: X.cancelled, detail: X.cancelledDetail, tone: "neutral", pct: null };
  const e = shownEtape(v);
  if (v.phase === "done") return { title: X.done, detail: etapeDetail("termine", v.format), tone: "ok", pct: null };
  // Job en file sur le serveur (étape « attente » du contrat) : rien n'a encore commencé, on le dit.
  if (v.phase === "queued" && !v.etape) return { title: X.waiting, detail: X.waitingDetail, tone: "busy", pct: null };
  return { title: ETAPE_LABEL[e], detail: etapeDetail(e, v.format, v.phase === "downloading"), tone: "busy", pct: v.progress === null ? null : `${v.progress}${NBSP}%` };
}

export class ExportProgress {
  readonly el: HTMLDivElement;
  private readonly owl: HTMLSpanElement;
  private readonly title: HTMLParagraphElement;
  private readonly pct: HTMLSpanElement;
  private readonly detail: HTMLParagraphElement;
  private readonly steps: HTMLLIElement[];
  private readonly bar: HTMLDivElement;
  private readonly fill: HTMLElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly showBtn: HTMLButtonElement;
  private readonly retryBtn: HTMLButtonElement;
  private view: ExportView | null = null;
  private launchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(doc: Document, hooks: ProgressHooks) {
    const svg = owlSvg(doc, { size: 22, surface: "dark", maitre: true, className: "xp-owl-svg" });
    this.owl = el(doc, "span", { class: "xp-owl", attrs: { "aria-hidden": "true" } }, [el(doc, "span", { class: "xp-ring" }), svg]);
    this.title = el(doc, "p", { class: "xp-title" });
    this.pct = el(doc, "span", { class: "xp-pct" });
    this.detail = el(doc, "p", { class: "xp-detail" });
    const btn = (cls: string, text: string) => el(doc, "button", { class: `xp-btn ${cls}`, text, attrs: { type: "button", hidden: true } });
    this.cancelBtn = btn("xp-cancel", X.cancel);
    this.showBtn = btn("xp-show", X.show);
    this.retryBtn = btn("xp-retry", X.retry);
    this.steps = ETAPES.map((e) => el(doc, "li", { class: "xp-step", attrs: { "data-etape": e } }, [
      el(doc, "span", { class: "xp-dot", attrs: { "aria-hidden": "true" } }),
      el(doc, "span", { class: "xp-slabel", text: ETAPE_SHORT[e] }),
    ]));
    this.fill = el(doc, "i");
    this.bar = el(doc, "div", { class: "xp-bar", attrs: { role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100 } }, [this.fill]);
    this.el = el(doc, "div", { class: "xp", attrs: { role: "status", "aria-live": "polite", hidden: true } }, [
      el(doc, "div", { class: "xp-top" }, [
        this.owl,
        el(doc, "div", { class: "xp-txt" }, [el(doc, "div", { class: "xp-head" }, [this.title, this.pct]), this.detail]),
      ]),
      el(doc, "ol", { class: "xp-steps", attrs: { "aria-label": "Étapes de l’export" } }, this.steps),
      el(doc, "div", { class: "xp-foot" }, [this.bar, el(doc, "div", { class: "xp-acts" }, [this.cancelBtn, this.showBtn, this.retryBtn])]),
    ]);
    this.cancelBtn.addEventListener("click", (e) => { if (e.isTrusted) hooks.cancel(); });
    this.showBtn.addEventListener("click", (e) => { if (e.isTrusted) hooks.show(); });
    this.retryBtn.addEventListener("click", (e) => { if (e.isTrusted) hooks.retry(); });
  }

  get shown(): boolean {
    return !this.el.hidden;
  }

  /** null : rien à montrer (aucun export pour ce média). */
  set(v: ExportView | null): void {
    const prev = this.view;
    this.view = v;
    if (!v) {
      this.el.hidden = true;
      setAttr(this.el, "data-mood", null);
      return;
    }
    this.el.hidden = false;
    const busy = BUSY.has(v.phase);
    const d = describeExport(v);
    setAttr(this.el, "data-phase", v.phase);
    setAttr(this.el, "data-tone", d.tone);
    setAttr(this.el, "role", v.phase === "error" ? "alert" : "status");
    setText(this.title, d.title);
    setText(this.pct, d.pct ?? "");
    setText(this.detail, d.detail);
    // Chouette : réaction au lancement (une fois), anneau pendant le travail, retour au repos à la fin.
    const wasBusy = !!prev && BUSY.has(prev.phase);
    if (busy && !wasBusy) {
      setAttr(this.el, "data-mood", "launch");
      if (this.launchTimer) clearTimeout(this.launchTimer);
      this.launchTimer = setTimeout(() => {
        this.launchTimer = null;
        if (this.view && BUSY.has(this.view.phase)) setAttr(this.el, "data-mood", "busy");
      }, 640);
    } else if (busy) {
      if (this.el.getAttribute("data-mood") !== "launch") setAttr(this.el, "data-mood", "busy");
    } else {
      if (this.launchTimer) clearTimeout(this.launchTimer);
      this.launchTimer = null;
      setAttr(this.el, "data-mood", v.phase === "done" ? "done" : v.phase === "error" ? "error" : "rest");
    }
    // Étapes.
    const cur = shownEtape(v);
    const rank = etapeRank(cur);
    this.steps.forEach((li, i) => {
      const e = ETAPES[i]!;
      let st: "fait" | "en cours" | "à venir" | "en échec";
      if (v.phase === "done") st = "fait";
      else if (i < rank) st = "fait";
      else if (i === rank) st = v.phase === "error" ? "en échec" : v.phase === "cancelled" ? "à venir" : "en cours";
      else st = "à venir";
      setAttr(li, "data-state", st === "fait" ? "done" : st === "en cours" ? "current" : st === "en échec" ? "failed" : "todo");
      setAttr(li, "aria-current", st === "en cours" ? "step" : null);
      setAttr(li, "aria-label", stepAria(i, e, st));
    });
    // Barre : pourcentage mesuré, sinon indéterminée (aucune valeur inventée) ; cachée hors travail.
    this.bar.hidden = !busy;
    const measured = busy && v.progress !== null && v.phase !== "sending";
    setAttr(this.bar, "data-indeterminate", busy && !measured ? "" : null);
    setAttr(this.bar, "aria-valuenow", measured ? String(v.progress) : null);
    setAttr(this.bar, "aria-valuetext", progressAria(v.phase === "sending" ? null : cur, measured ? v.progress : null));
    this.fill.style.transform = measured ? `scaleX(${(v.progress ?? 0) / 100})` : "";
    this.cancelBtn.hidden = !(busy && v.canCancel);
    this.showBtn.hidden = !(v.phase === "done" && v.canShow);
    this.retryBtn.hidden = !(v.phase === "error" && v.error?.retryable);
  }

  destroy(): void {
    if (this.launchTimer) clearTimeout(this.launchTimer);
  }
}
