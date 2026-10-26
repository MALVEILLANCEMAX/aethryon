// Éditeur d'extrait — TimeLens (3.8.0), partagé par le menu des pages (racine Shadow DOM fermée) et le popup.
// Parcours en quatre temps, dans l'ordre de l'écran (C-PLAN §D, D-SPEC §A) :
//   1. choisir l'instant : lecteur de la page, « Début ici » / « Fin ici » (instant FRAIS du lecteur), préréglages ;
//   2. ajuster : UNE réglette (reglette.ts) avec sa bulle de durée ; la lentille (lentille.ts) n'apparaît que pendant
//      le geste, ou posée dans le mode précis (« Ajuster finement » : borne, ±1 image, champs Début, Fin et Durée) ;
//   3. choisir le format (MP4, MP3, GIF) ;
//   4. exporter : « Exporter 0:30 en MP4 », toujours visible (collé en bas du popup).
// État d'intention et état exporté : `range` est le passage VOULU (normalisé avec la seule limite générale G du
// serveur) ; le passage EXPORTÉ est effectiveRange(range, F), F = limite du format (GIF : seul le début est exporté,
// le passage est gardé ; revenir en MP4 le retrouve entier). Aucune limite écrite ici : tout vient de GET /limites.
// L'API publique (ClipEditor, PlayerLink, EditorHooks, EditorOpen) est celle de 3.6 : content/common/control.ts et le
// popup ne changent pas.
import { menuIcon } from "../content/common/menu-icons.ts";
import { checkRange, initialRange, moveEdge, normalize, type Bounds, type ClipFormat, type Edge, type RangeMs } from "../shared/extrait.ts";
import { maxClipMs, quotaExhausted, type LimitsView } from "../shared/limites.ts";
import { owlSvg } from "../shared/owl.ts";
import { applyPreset, dragEdge, effectiveRange, hint, HINT_LIFE_MS, presetBlock, presetChecked, PRESETS_MS, type EditorEvent, type EditorEventType, type HintId, type HintMemory } from "../shared/timelens.ts";
import { formatLength, formatTimecode, HOUR_MS, MAX_TIMECODE_MS, parseTimecode, timecodeErrorText } from "../shared/timecode.ts";
import { el, morph, reducedMotion, setAttr, setData, setText, textEl } from "./dom.ts";
import { PREF_HINTS, PREF_HINTS_OFF, PREF_LENS_VIEWS, readPrefs, writePref } from "./prefs.ts";
import { ExportProgress, type ExportView } from "./progress.ts";
import { Reglette } from "./reglette.ts";
import { ADJUST, FORMAT_LABEL, TL, X, formatNote } from "./texts.ts";

/** Instantané du lecteur de la vidéo (secondes, à la milliseconde). */
export interface PlayerSnapshot { currentTime?: number; duration?: number; paused?: boolean; previewing?: boolean }

/** Lecteur piloté : celui de la page (menu) ou celui de l'onglet actif, par le service worker (popup). */
export interface PlayerLink {
  snapshot(): Promise<PlayerSnapshot>;
  seek(t: number): void;
  /** Lit [start, end] puis s'arrête à la fin ; false si la lecture n'a pas pu commencer. */
  preview(start: number, end: number): Promise<boolean>;
  stop(): void;
  /** Durée d'une image (ms) quand la cadence est connue. */
  frameMs?(): number | null;
  /** Période de lecture de l'instant courant (ms). */
  readonly pollMs: number;
}

export interface EditorHooks {
  player(): PlayerLink | null;
  export(range: RangeMs, format: ClipFormat): void;
  tools?(range: RangeMs): void;
  cancel(): void;
  show(): void;
  retry(): void;
  /** La hauteur a changé (fin d'animation) : repositionner un menu. */
  resized?(): void;
  formatChanged?(f: ClipFormat): void;
}

export interface EditorOpen {
  /** Durée de la vidéo (ms) ; null : inconnue (lien collé) — champs seuls, le serveur vérifie. */
  durationMs: number | null;
  currentMs: number | null;
  lengthMs: number;
  anchor: "before" | "around" | "after";
  format: ClipFormat;
  /** « 1080p », « Auto »… pour la note du format vidéo (infobulle). */
  quality?: string;
  /** Garder le passage déjà réglé (même vidéo, menu rouvert). */
  keep?: boolean;
}

type Msg = { tone: "bad" | "info"; text: string; field?: Field } | null;
type Field = Edge | "len";
const FIELDS: readonly Field[] = ["start", "end", "len"];
const PRESET_CUSTOM = -1;

let seq = 0;

export class ClipEditor {
  readonly el: HTMLDivElement;
  readonly #doc: Document;
  readonly #hooks: EditorHooks;
  readonly #uid = `ce${++seq}`;
  readonly #reglette: Reglette;
  readonly #playBtn: HTMLButtonElement;
  readonly #rangeEl: HTMLSpanElement;
  readonly #fineBtn: HTMLButtonElement;
  readonly #precis: HTMLDivElement;
  readonly #lensSlot: HTMLDivElement;
  readonly #keysEl: HTMLParagraphElement;
  readonly #edgeOpts: Record<Edge, HTMLButtonElement>;
  readonly #stepBtns: { back: HTMLButtonElement; fwd: HTMLButtonElement };
  readonly #nowEl: HTMLSpanElement;
  readonly #inputs: Record<Field, HTMLInputElement>;
  readonly #hereBtns: Record<Edge, HTMLButtonElement>;
  readonly #note: HTMLDivElement;
  readonly #msgEl: HTMLParagraphElement;
  readonly #liveEl: HTMLParagraphElement;
  readonly #presetSeg: HTMLDivElement;
  readonly #presetOpts: HTMLButtonElement[];
  readonly #fmtSeg: HTMLDivElement;
  readonly #fline: HTMLParagraphElement;
  readonly #foot: HTMLDivElement;
  readonly #goWrap: HTMLDivElement;
  readonly #goBtn: HTMLButtonElement;
  readonly #goText: HTMLSpanElement;
  readonly #whyEl: HTMLParagraphElement;
  readonly #toolsBtn: HTMLButtonElement;
  readonly #quotaEl: HTMLParagraphElement;
  readonly #progress: ExportProgress;
  #range: RangeMs = { startMs: 0, endMs: 0 };
  #duration: number | null = null;
  #format: ClipFormat = "mp4";
  #quality = "Auto";
  #limits: LimitsView | null = null;
  #blocked: string | null = null;
  #busy = false;
  #dirty: Record<Field, boolean> = { start: false, end: false, len: false };
  #invalid: Record<Field, boolean> = { start: false, end: false, len: false };
  #msg: Msg = null;
  #now: number | null = null;
  #frame: number | null = null;
  #previewing = false;
  #poll: ReturnType<typeof setInterval> | null = null;
  #polling = false;
  #seekRaf = 0;
  #pendingSeek: number | null = null;
  #jobView: ExportView | null = null;
  #dismissed = false;
  #opened = false;
  #visible = false;
  /** Mode précis ouvert : mémorisé pour la session de l'éditeur. */
  #precisOpen = false;
  /** Borne de la lentille posée : la dernière poignée saisie, sinon « Début ». */
  #posedEdge: Edge = "start";
  // astuces
  #events: EditorEvent[] = [];
  #hintMem: HintMemory = { off: false, last: {}, shownThisOpen: false };
  #hintTimer: ReturnType<typeof setInterval> | null = null;
  #hintEl: HTMLDivElement | null = null;
  #hintShownAt = 0;
  #lensViews = 0;
  #liveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(doc: Document, hooks: EditorHooks, variant: "menu" | "popup") {
    this.#doc = doc;
    this.#hooks = hooks;
    const id = this.#uid;
    this.#reglette = new Reglette(doc, {
      onInput: (r, moved, final) => this.#onReglette(r, moved, final),
      onSeek: (ms, final) => this.#seek(ms, final),
      onGestureEnd: (g) => this.#onGestureEnd(g),
      onGrab: (edge) => this.#setPosedEdge(edge, false),
      onKeyLimit: () => {
        const G = this.#generalMax();
        if (G !== null) this.#announce(TL.limitReached(G));
        this.#event("limit-bump");
      },
      onLensShown: () => this.#lensShown(),
    });

    // ---- rangée du haut : lire le passage, plage, « Ajuster finement » ---------------------------
    this.#playBtn = el(doc, "button", { class: "ce-play", attrs: { type: "button", "aria-label": X.previewAria, "aria-pressed": "false" } }, [menuIcon(doc, "play", 14)]);
    this.#rangeEl = textEl(doc, "span", "ce-range");
    this.#fineBtn = el(doc, "button", { class: "ce-fine", attrs: { type: "button", "aria-expanded": "false", "aria-controls": `${id}-precis` } }, [
      el(doc, "span", { text: X.fine }), menuIcon(doc, "chevronDown", 12),
    ]);
    const top = el(doc, "div", { class: "ce-top" }, [this.#playBtn, this.#rangeEl, this.#fineBtn]);

    // ---- mode précis : borne, ±1 image, lentille posée, champs Début, Fin, Durée, aide du clavier -----
    const edgeOpt = (edge: Edge) => el(doc, "button", {
      class: "ce-eopt", text: edge === "start" ? X.lensStart : X.lensEnd,
      attrs: { type: "button", role: "radio", "aria-checked": edge === "start" ? "true" : "false", tabindex: edge === "start" ? 0 : -1, "data-edge": edge },
    });
    this.#edgeOpts = { start: edgeOpt("start"), end: edgeOpt("end") };
    const edgeSeg = el(doc, "div", { class: "ce-eseg", attrs: { role: "radiogroup", "aria-label": X.edgeGroup } }, [this.#edgeOpts.start, this.#edgeOpts.end]);
    const stepBtn = (dir: -1 | 1) => el(doc, "button", { class: "ce-step", attrs: { type: "button", "data-dir": dir } }, [""]);
    this.#stepBtns = { back: stepBtn(-1), fwd: stepBtn(1) };
    this.#lensSlot = el(doc, "div", { class: "ce-lensslot" });
    const msgId = `${id}-msg`;
    const field = (f: Field) => {
      const label = f === "start" ? X.startField : f === "end" ? X.endField : X.durationField;
      const aria = f === "start" ? X.startFieldAria : f === "end" ? X.endFieldAria : X.durationFieldAria;
      const input = el(doc, "input", {
        class: "ce-input",
        attrs: {
          type: "text", id: `${id}-${f}`, inputmode: "text", autocomplete: "off", spellcheck: "false", maxlength: 24,
          "aria-label": aria, "aria-describedby": msgId, placeholder: X.fieldHint,
          // Timecode (donnée), pas du texte rédigé : exclu des essais de typographie.
          "data-raw": true,
        },
      });
      const lab = el(doc, "label", { class: "ce-flabel", text: label, attrs: { for: `${id}-${f}` } });
      return { box: el(doc, "div", { class: `ce-field ce-f-${f}` }, [lab, input]), input };
    };
    const fs = field("start");
    const fe = field("end");
    const fl = field("len");
    this.#inputs = { start: fs.input, end: fe.input, len: fl.input };
    this.#precis = el(doc, "div", { class: "ce-precis", attrs: { id: `${id}-precis`, hidden: true } }, [
      el(doc, "div", { class: "ce-prow" }, [edgeSeg, el(doc, "div", { class: "ce-steps" }, [this.#stepBtns.back, this.#stepBtns.fwd])]),
      this.#lensSlot,
      el(doc, "div", { class: "ce-fields" }, [fs.box, fe.box, fl.box]),
      this.#keysEl = el(doc, "p", { class: "ce-keys", text: X.keysHelp }),
    ]);

    // ---- marques : instant du lecteur, « Début ici », « Fin ici » ------------------------------------
    this.#nowEl = textEl(doc, "span", "ce-now");
    setAttr(this.#nowEl, "aria-live", "off");
    const here = (edge: Edge) => el(doc, "button", {
      class: `ce-mark ce-mark-${edge}`,
      attrs: { type: "button", title: edge === "start" ? X.startHereAria : X.endHereAria, "aria-label": edge === "start" ? X.startHereAria : X.endHereAria },
    }, edge === "start"
      ? [menuIcon(doc, "markIn", 14), el(doc, "span", { text: X.startHere })]
      : [el(doc, "span", { text: X.endHere }), menuIcon(doc, "markOut", 14)]);
    this.#hereBtns = { start: here("start"), end: here("end") };
    const marks = el(doc, "div", { class: "ce-marks" }, [this.#nowEl, this.#hereBtns.start, this.#hereBtns.end]);

    // ---- note : message, astuce ; région d'annonces (fin des gestes seulement) ----------------------
    this.#msgEl = el(doc, "p", { class: "ce-msg", attrs: { id: msgId, "aria-live": "polite" } });
    this.#liveEl = el(doc, "p", { class: "ce-live", attrs: { "aria-live": "polite", "data-raw": true } });
    this.#note = el(doc, "div", { class: "ce-note" }, [this.#msgEl]);

    // ---- préréglages, format ----------------------------------------------------------------------
    this.#presetSeg = el(doc, "div", { class: "ce-seg ce-pseg", attrs: { role: "radiogroup", "aria-labelledby": `${id}-dur` } });
    this.#presetOpts = [...PRESETS_MS, PRESET_CUSTOM].map((L) => {
      const b = el(doc, "button", {
        class: "ce-opt ce-popt", text: L === PRESET_CUSTOM ? X.custom : TL.preset(L),
        attrs: { type: "button", role: "radio", "aria-checked": "false", tabindex: -1, "data-len": L },
      });
      b.addEventListener("click", (e) => { if (e.isTrusted) this.#pickPreset(L, "click"); });
      b.addEventListener("keydown", (e) => this.#presetKey(e));
      this.#presetSeg.append(b);
      return b;
    });
    const presets = el(doc, "div", { class: "ce-presets" }, [el(doc, "span", { class: "ce-legend", text: X.durationLegend, attrs: { id: `${id}-dur` } }), this.#presetSeg]);
    this.#fmtSeg = el(doc, "div", { class: "ce-seg", attrs: { role: "radiogroup", "aria-labelledby": `${id}-fmt` } });
    const fmt = el(doc, "div", { class: "ce-fmt" }, [el(doc, "span", { class: "ce-legend", text: X.format, attrs: { id: `${id}-fmt` } }), this.#fmtSeg]);
    this.#fline = textEl(doc, "p", "ce-fline");
    this.#fline.hidden = true;

    // ---- export et avancement ----------------------------------------------------------------------
    this.#goText = textEl(doc, "span", "ce-go-t", X.exportLabel);
    this.#goBtn = el(doc, "button", { class: "ce-go", attrs: { type: "button", "aria-describedby": `${id}-why` } }, [menuIcon(doc, "download", 16), this.#goText]);
    this.#whyEl = el(doc, "p", { class: "ce-why", attrs: { id: `${id}-why` } });
    this.#toolsBtn = el(doc, "button", { class: "ce-tools", attrs: { type: "button", hidden: true } }, [menuIcon(doc, "tools", 13), el(doc, "span", { text: X.tools })]);
    this.#quotaEl = textEl(doc, "p", "ce-quota");
    this.#quotaEl.hidden = true;
    this.#goWrap = el(doc, "div", { class: "ce-gowrap" }, [this.#goBtn, this.#whyEl, this.#toolsBtn, this.#quotaEl]);
    this.#progress = new ExportProgress(doc, { cancel: () => hooks.cancel(), show: () => hooks.show(), retry: () => hooks.retry() });
    this.#foot = el(doc, "div", { class: "ce-foot" }, [this.#progress.el, this.#goWrap]);

    // Ordre du DOM = ordre de tabulation (D-SPEC §A.9) ; l'ordre visuel place le mode précis sous la réglette (CSS).
    this.el = el(doc, "div", { class: "ce", attrs: { "data-variant": variant, role: "group", "aria-label": X.region } }, [
      top, this.#precis, this.#reglette.el, marks, this.#note, presets, fmt, this.#fline, this.#foot, this.#liveEl,
    ]);

    // ---- événements --------------------------------------------------------------------------------
    for (const f of FIELDS) {
      const input = this.#inputs[f];
      input.addEventListener("input", () => {
        this.#dirty[f] = true;
        this.#dropHint();
        const p = parseTimecode(input.value);
        // Pendant la frappe : seulement l'indication visuelle ; la valeur s'applique à Entrée ou en quittant le champ.
        setAttr(input, "data-pending", p.ok ? null : "");
      });
      input.addEventListener("keydown", (e) => this.#fieldKey(e, f));
      input.addEventListener("change", () => this.#commit(f));
      input.addEventListener("blur", () => { if (this.#dirty[f]) this.#commit(f); });
    }
    for (const edge of ["start", "end"] as const) {
      this.#hereBtns[edge].addEventListener("click", (e) => { if (e.isTrusted) void this.#toPlayer(edge); });
      this.#edgeOpts[edge].addEventListener("click", (e) => { if (e.isTrusted) this.#setPosedEdge(edge, true); });
      this.#edgeOpts[edge].addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        e.stopPropagation();
        const other: Edge = this.#posedEdge === "start" ? "end" : "start";
        this.#setPosedEdge(other, true);
        this.#edgeOpts[other].focus({ preventScroll: true });
      });
    }
    for (const b of [this.#stepBtns.back, this.#stepBtns.fwd]) {
      b.addEventListener("click", (e) => { if (e.isTrusted) this.#stepFrame(b === this.#stepBtns.back ? -1 : 1); });
    }
    this.#playBtn.addEventListener("click", (e) => { if (e.isTrusted) void this.#togglePreview(); });
    this.#fineBtn.addEventListener("click", (e) => { if (e.isTrusted) this.#setPrecis(!this.#precisOpen, true); });
    this.#goBtn.addEventListener("click", (e) => { if (e.isTrusted) this.#doExport(); });
    this.#toolsBtn.addEventListener("click", (e) => { if (e.isTrusted && this.#hooks.tools) this.#hooks.tools({ ...this.#range }); });
    // Échap (hors d'un champ en cours de saisie) ferme le mode précis, PAS le menu de la page.
    this.el.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !this.#precisOpen || this.#duration === null) return;
      const t = e.target as HTMLElement | null;
      const f = FIELDS.find((x) => this.#inputs[x] === t);
      if (f && (this.#dirty[f] || this.#invalid[f])) return;
      e.preventDefault();
      e.stopPropagation();
      this.#setPrecis(false, true);
      this.#fineBtn.focus({ preventScroll: true });
    });
    // Toute interaction dans l'éditeur efface l'astuce (et compte pour le détecteur d'hésitation).
    this.el.addEventListener("pointerdown", (e) => {
      if (this.#hintEl?.contains(e.target as Node)) return;
      this.#dropHint();
      this.#event("pointer");
    }, true);
    this.el.addEventListener("keydown", (e) => {
      if (this.#hintEl?.contains(e.target as Node) || e.key === "Tab" || e.key === "Shift") return;
      this.#dropHint();
      this.#event("key");
    }, true);
    this.#renderFormats();
    void this.#loadPrefs();
  }

  // ---- ouverture, fermeture ----------------------------------------------------------------------
  open(o: EditorOpen): void {
    const keep = o.keep && this.#opened && this.#duration === o.durationMs && this.#range.endMs > this.#range.startMs;
    this.#opened = true;
    this.#visible = true;
    this.#duration = o.durationMs;
    this.#format = o.format;
    this.#quality = o.quality ?? "Auto";
    this.#dirty = { start: false, end: false, len: false };
    this.#invalid = { start: false, end: false, len: false };
    this.#msg = null;
    const known = o.durationMs !== null && o.durationMs > 0;
    setAttr(this.el, "data-duration", known ? null : "unknown");
    // Durée inconnue (lien collé, vidéo pas encore chargée) : on le dit à la place de l'aide du clavier.
    setText(this.#keysEl, known ? X.keysHelp : X.durationUnknown);
    this.#reglette.el.hidden = !known;
    this.#reglette.setBounds(this.#bounds());
    if (!keep) {
      this.#range = known
        ? initialRange(o.currentMs ?? 0, o.lengthMs, o.anchor, this.#bounds())
        : { startMs: Math.max(0, Math.round(o.currentMs ?? 0)), endMs: Math.max(0, Math.round(o.currentMs ?? 0)) + Math.round(o.lengthMs) };
    } else {
      this.#range = normalize(this.#range, this.#bounds(), "start");
    }
    this.#now = o.currentMs;
    this.#reglette.setRange(this.#range);
    this.#reglette.setPlayhead(this.#now);
    this.#renderFormats();
    // Durée inconnue : le mode précis est ouvert d'office (champs seuls, pas de lentille). Sinon : dernier état.
    this.#setPrecis(known ? this.#precisOpen : true, false, !known);
    this.#paint();
    this.#startPolling();
    this.#hintMem.shownThisOpen = false;
    this.#dropHint();
    this.#events = [{ type: "open", at: Date.now() }];
    this.#startHints();
  }

  /** Menu fermé ou vue quittée : plus de lecture de l'instant, aperçu arrêté, lentille effacée. */
  close(): void {
    this.#visible = false;
    this.#stopPolling();
    this.#stopHints();
    this.#dropHint();
    this.#reglette.hideLensNow();
    if (this.#previewing) this.#hooks.player()?.stop();
    this.#setPreviewing(false);
  }

  destroy(): void {
    this.close();
    this.#progress.destroy();
  }

  /** Passage voulu (l'export porte sur sa partie permise par le format). */
  get value(): RangeMs {
    return { ...this.#range };
  }

  get currentFormat(): ClipFormat {
    return this.#format;
  }

  /** Pied de l'éditeur (avancement ou bouton d'export), à faire voir dans un menu qui défile. */
  get footEl(): HTMLElement {
    return this.#foot;
  }

  focusFirst(): void {
    if (!this.#reglette.el.hidden) this.#reglette.focus("start");
    else this.#inputs.start.focus({ preventScroll: true });
  }

  // ---- état venu de l'extérieur ------------------------------------------------------------------
  setLimits(v: LimitsView | null): void {
    this.#limits = v;
    setAttr(this.el, "data-limits", v === null ? "attente" : v.source);
    const before = this.#range;
    this.#range = normalize(this.#range, this.#bounds(), "start");
    if (this.#opened && (before.startMs !== this.#range.startMs || before.endMs !== this.#range.endMs)) {
      const max = this.#generalMax();
      if (max !== null) this.#msg = { tone: "info", text: ADJUST.maxApplied(formatLength(max)) };
      this.#reglette.setRange(this.#range);
    }
    this.#reglette.setBounds(this.#bounds());
    this.#renderFormats();
    this.#paint();
  }

  /** Raison qui empêche d'exporter (plateforme en pause, notice…) ; null : rien. */
  setBlocked(reason: string | null): void {
    this.#blocked = reason;
    this.#paintGo();
  }

  setToolsVisible(on: boolean): void {
    this.#toolsBtn.hidden = !on;
  }

  setQuality(label: string): void {
    this.#quality = label;
    this.#renderFormats();
  }

  /** Avancement de l'export de ce média (null : aucun). */
  setJob(v: ExportView | null): void {
    const busy = !!v && (v.phase === "sending" || v.phase === "queued" || v.phase === "converting" || v.phase === "downloading");
    if (busy) this.#dismissed = false;
    const show = v && !this.#dismissed ? v : null;
    const changed = (show === null) !== (this.#jobView === null) || busy !== this.#busy;
    this.#jobView = show;
    // Une seule chouette visible : l'astuce s'efface dès que l'avancement s'affiche.
    if (show) this.#dropHint();
    const apply = () => {
      this.#busy = busy;
      this.#progress.set(show);
      this.#goWrap.hidden = busy;
      setAttr(this.el, "data-busy", busy ? "" : null);
      this.#reglette.setDisabled(busy);
      for (const f of FIELDS) this.#inputs[f].disabled = busy;
      for (const b of this.el.querySelectorAll<HTMLButtonElement>(".ce-opt, .ce-eopt, .ce-step")) b.disabled = busy;
      this.#paintPresets();
      this.#paintNow();
      this.#paintGo();
    };
    if (changed && this.#opened) morph(this.#foot, apply, () => this.#hooks.resized?.());
    else apply();
  }

  // ---- limites ------------------------------------------------------------------------------------
  /** G : limite générale du serveur (extraitDureeMaxMs), ou null. */
  #generalMax(): number | null {
    return this.#limits?.limits?.extraitDureeMaxMs ?? null;
  }

  /** F : limite du format, la plus stricte (GIF par exemple), ou null. */
  #formatMax(): number | null {
    return maxClipMs(this.#limits?.limits ?? null, this.#format);
  }

  /** Bornes de l'état d'intention : la vidéo et la seule limite générale G. */
  #bounds(): Bounds {
    return { durationMs: this.#duration && this.#duration > 0 ? this.#duration : MAX_TIMECODE_MS, maxMs: this.#generalMax() };
  }

  #exported(): RangeMs {
    return effectiveRange(this.#range, this.#formatMax());
  }

  #hours(): boolean {
    return (this.#duration ?? 0) >= HOUR_MS;
  }

  // ---- réglette, champs, lecteur -----------------------------------------------------------------
  /** L'utilisateur reprend la main après un export fini : l'ancien état s'efface (nouvel export en vue). */
  #touched(): void {
    if (this.#busy || !this.#jobView || this.#dismissed) return;
    this.#dismissed = true;
    morph(this.#foot, () => this.#progress.set(null), () => this.#hooks.resized?.());
    this.#jobView = null;
  }

  #onReglette(r: RangeMs, moved: Edge | "both", final: boolean): void {
    this.#range = r;
    this.#touched();
    this.#dirty = { start: false, end: false, len: false };
    this.#invalid = { start: false, end: false, len: false };
    if (final && this.#msg?.tone === "info") this.#msg = null;
    this.#paint(!final);
    // On fait voir l'image de la borne déplacée (ou du début du passage glissé). La réglette n'appelle qu'une fois par
    // image (dans son requestAnimationFrame) : la position part tout de suite, sans attendre l'image suivante.
    this.#seek(moved === "end" ? r.endMs : r.startMs, true);
  }

  /** Fin d'un geste du pointeur : UNE annonce (jamais pendant le geste), événements des astuces. */
  #onGestureEnd(g: { kind: Edge | "band" | "seek"; moved: boolean; bumped: boolean; fine: boolean }): void {
    if (!g.moved) return;
    const G = this.#generalMax();
    if (g.bumped && G !== null) {
      this.#announce(TL.limitReached(G));
      this.#event("limit-bump");
    } else {
      this.#announce(TL.passage(this.#range.startMs, this.#range.endMs));
    }
    if (g.kind === "start" || g.kind === "end") this.#event(g.fine ? "fine-used" : "coarse-drag-end");
  }

  #seek(ms: number, final: boolean): void {
    const p = this.#hooks.player();
    if (!p) return;
    this.#now = ms;
    this.#reglette.setPlayhead(ms);
    this.#paintNow();
    if (this.#previewing) this.#setPreviewing(false);
    // Une demande de position par image au plus (le popup passe par le service worker).
    this.#pendingSeek = ms;
    if (final) {
      this.#flushSeek();
      return;
    }
    if (this.#seekRaf) return;
    const win = this.#doc.defaultView;
    if (!win) return this.#flushSeek();
    this.#seekRaf = win.requestAnimationFrame(() => {
      this.#seekRaf = 0;
      this.#flushSeek();
    });
  }

  #flushSeek(): void {
    if (this.#seekRaf) this.#doc.defaultView?.cancelAnimationFrame(this.#seekRaf);
    this.#seekRaf = 0;
    const ms = this.#pendingSeek;
    this.#pendingSeek = null;
    if (ms !== null) this.#hooks.player()?.seek(ms / 1000);
  }

  #fieldValue(f: Field): number {
    return f === "start" ? this.#range.startMs : f === "end" ? this.#range.endMs : this.#range.endMs - this.#range.startMs;
  }

  #fieldKey(e: KeyboardEvent, f: Field): void {
    const input = this.#inputs[f];
    if (e.key === "Enter") {
      e.preventDefault();
      this.#commit(f);
      return;
    }
    if (e.key === "Escape" && (this.#dirty[f] || this.#invalid[f])) {
      // Échap : la valeur en cours revient (ni le mode précis ni le menu ne se ferment pour autant).
      e.preventDefault();
      e.stopPropagation();
      this.#dirty[f] = false;
      this.#invalid[f] = false;
      if (this.#msg?.field === f) this.#msg = null;
      this.#paint();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // Flèches dans un champ : comme sur la réglette (100 ms ; Maj 1 s ; Alt 10 ms), avec butée.
      e.preventDefault();
      e.stopPropagation();
      if (this.#dirty[f]) this.#commit(f);
      if (this.#invalid[f]) return;
      const step = (e.altKey ? 10 : e.shiftKey ? 1000 : 100) * (e.key === "ArrowUp" ? 1 : -1);
      const edge: Edge = f === "start" ? "start" : "end";
      const res = dragEdge(this.#range, edge, (edge === "start" ? this.#range.startMs : this.#range.endMs) + step, this.#bounds());
      if (res.overMs > 0) {
        const G = this.#generalMax();
        if (G !== null) this.#announce(TL.limitReached(G));
      }
      this.#apply(res.range, edge);
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
  }

  /** Valide la saisie d'un champ : normalisée, bornée, synchronisée avec la réglette (et le lecteur). */
  #commit(f: Field): void {
    const input = this.#inputs[f];
    if (!this.#dirty[f] && !this.#invalid[f]) return;
    const p = parseTimecode(input.value);
    const label = f === "start" ? X.startField : f === "end" ? X.endField : X.durationField;
    if (!p.ok && p.error !== "negative") {
      this.#invalid[f] = true;
      this.#msg = { tone: "bad", text: `${label} : ${timecodeErrorText(p.error)}`, field: f };
      this.#paint();
      return;
    }
    const ms = p.ok ? p.ms : 0;
    const before = this.#range;
    const d = this.#duration && this.#duration > 0 ? this.#duration : null;
    const G = this.#generalMax();
    this.#dirty[f] = false;
    this.#invalid[f] = false;
    let note: string | null = null;
    let next: RangeMs;
    if (f === "len") {
      // Durée validée : fin = début + durée (mode « set »), plafonnée à la limite du serveur.
      const len = Math.max(100, G !== null ? Math.min(ms, G) : ms);
      next = moveEdge(this.#range, "end", before.startMs + len, this.#bounds(), "set");
      if (!p.ok || ms < 100) note = ADJUST.clampedZero("fin");
      else if (G !== null && ms > G) note = ADJUST.maxApplied(formatLength(G));
      else if (d !== null && before.startMs + len > d) note = ADJUST.clampedEnd(formatTimecode(d));
    } else {
      next = moveEdge(this.#range, f, ms, this.#bounds(), "set");
      // Ce qui a été corrigé est dit, sans être une erreur.
      if (!p.ok) note = ADJUST.clampedZero(f === "start" ? "début" : "fin");
      else if (d !== null && ms > d) note = ADJUST.clampedEnd(formatTimecode(d));
      else if (f === "start" && ms >= before.endMs) note = ADJUST.followedEnd();
      else if (f === "end" && ms <= before.startMs) note = ADJUST.followedStart();
      else if (G !== null && (next.endMs - next.startMs) < (f === "start" ? before.endMs - ms : ms - before.startMs)) note = ADJUST.maxApplied(formatLength(G));
    }
    this.#msg = note ? { tone: "info", text: note } : null;
    this.#apply(next, f === "start" ? "start" : "end");
  }

  #apply(r: RangeMs, edge: Edge): void {
    this.#range = r;
    this.#touched();
    this.#reglette.setRange(r);
    this.#paint();
    if (this.#duration) this.#seek(edge === "start" ? r.startMs : r.endMs, true);
  }

  /** « Début ici » / « Fin ici » : instant FRAIS du lecteur (relu à l'appui), l'autre borne suit si besoin (dit). */
  async #toPlayer(edge: Edge): Promise<void> {
    const p = this.#hooks.player();
    let t = this.#now;
    if (p) {
      try {
        const s = await p.snapshot();
        if (typeof s.currentTime === "number") t = Math.round(s.currentTime * 1000);
      } catch {
        /* dernier instant connu */
      }
    }
    if (t === null) return;
    if (this.#previewing) {
      p?.stop();
      this.#setPreviewing(false);
    }
    const before = this.#range;
    const next = moveEdge(this.#range, edge, t, this.#bounds(), "set");
    const G = this.#generalMax();
    const other: Edge = edge === "start" ? "end" : "start";
    const otherMoved = (other === "end" ? next.endMs !== before.endMs : next.startMs !== before.startMs);
    let text: string | null = null;
    if (edge === "start" && t >= before.endMs) text = ADJUST.followedEnd();
    else if (edge === "end" && t <= before.startMs) text = ADJUST.followedStart();
    else if (otherMoved && G !== null) text = TL.followLimit(other, G);
    this.#msg = text ? { tone: "info", text } : null;
    for (const f of FIELDS) {
      this.#dirty[f] = false;
      this.#invalid[f] = false;
    }
    this.#range = next;
    this.#now = t;
    this.#touched();
    this.#reglette.setRange(next);
    this.#reglette.setPlayhead(t);
    this.#paint();
    this.#announce(TL.placed(edge, edge === "start" ? next.startMs : next.endMs));
  }

  async #togglePreview(): Promise<void> {
    const p = this.#hooks.player();
    if (!p) return;
    if (this.#previewing) {
      p.stop();
      this.#setPreviewing(false);
      return;
    }
    const r = this.#exported();
    const ok = await p.preview(r.startMs / 1000, r.endMs / 1000);
    this.#setPreviewing(ok);
  }

  #setPreviewing(on: boolean): void {
    this.#previewing = on;
    this.#playBtn.replaceChildren(menuIcon(this.#doc, on ? "pause" : "play", 14));
    setAttr(this.#playBtn, "aria-pressed", on ? "true" : "false");
    setAttr(this.#playBtn, "aria-label", on ? X.previewStopAria : X.previewAria);
  }

  // ---- mode précis ---------------------------------------------------------------------------------
  /** Ouvre ou ferme « Ajuster finement » (hauteur animée, 220 ms) ; la lentille y est posée. */
  #setPrecis(open: boolean, animate: boolean, forced = false): void {
    const wasOpen = !this.#precis.hidden;
    if (!forced) this.#precisOpen = open;
    setAttr(this.#fineBtn, "aria-expanded", open ? "true" : "false");
    const lensOk = this.#duration !== null && this.#duration > 0;
    setAttr(this.#precis, "data-lens", lensOk ? "" : null);
    if (open === wasOpen) {
      if (open && lensOk && !this.#reglette.lens.posed) this.#poseLens(true);
      return;
    }
    const mutate = () => {
      this.#precis.hidden = !open;
      if (lensOk) this.#poseLens(open);
    };
    if (!animate || !this.#opened || reducedMotion(this.#doc.defaultView)) {
      mutate();
      this.#hooks.resized?.();
      return;
    }
    if (open) morph(this.#precis, mutate, () => this.#hooks.resized?.());
    else {
      // Fermeture : la hauteur se replie, puis le bloc disparaît.
      const box = this.#precis;
      const from = box.getBoundingClientRect().height;
      if (typeof box.animate !== "function" || from < 1) {
        mutate();
        this.#hooks.resized?.();
        return;
      }
      box.style.overflow = "hidden";
      const a = box.animate([{ height: `${from}px` }, { height: "0px" }], { duration: 220, easing: "cubic-bezier(.2, .8, .2, 1)" });
      a.addEventListener("finish", () => {
        box.style.overflow = "";
        mutate();
        this.#hooks.resized?.();
      }, { once: true });
    }
  }

  #poseLens(on: boolean): void {
    const lens = this.#reglette.lens;
    if (on) {
      if (lens.el.parentElement !== this.#lensSlot) this.#lensSlot.append(lens.el);
      this.#reglette.setPosed(true, this.#posedEdge);
    } else {
      if (lens.el.parentElement !== this.#reglette.el) this.#reglette.el.append(lens.el);
      this.#reglette.setPosed(false, this.#posedEdge);
    }
    this.#paintPrecis();
  }

  /** Borne de la lentille posée : changée SEULEMENT par le choix radio ou la saisie d'une poignée (jamais le focus). */
  #setPosedEdge(edge: Edge, animate: boolean): void {
    this.#posedEdge = edge;
    this.#reglette.setPosedEdge(edge, animate && !reducedMotion(this.#doc.defaultView));
    this.#paintPrecis();
  }

  /** « −1 image » / « +1 image » (ou ±0,1 s) sur la borne de la lentille posée. */
  #stepFrame(dir: -1 | 1): void {
    if (this.#busy) return;
    const edge = this.#posedEdge;
    const step = this.#frame !== null && this.#frame >= 5 && this.#frame <= 200 ? this.#frame : 100;
    const cur = edge === "start" ? this.#range.startMs : this.#range.endMs;
    const res = dragEdge(this.#range, edge, Math.round(cur + dir * step), this.#bounds());
    if (res.overMs > 0) {
      const G = this.#generalMax();
      if (G !== null) this.#announce(TL.limitReached(G));
      this.#event("limit-bump");
    }
    this.#event("fine-used");
    this.#apply(res.range, edge);
  }

  #paintPrecis(): void {
    for (const e of ["start", "end"] as const) {
      setAttr(this.#edgeOpts[e], "aria-checked", e === this.#posedEdge ? "true" : "false");
      setAttr(this.#edgeOpts[e], "tabindex", e === this.#posedEdge ? "0" : "-1");
    }
    const frames = this.#frame !== null && this.#frame >= 5 && this.#frame <= 200;
    setData(this.#stepBtns.back, frames ? X.frameBack : X.tenthBack);
    setData(this.#stepBtns.fwd, frames ? X.frameFwd : X.tenthFwd);
    // Nom accessible = texte visible ; la phrase complète en infobulle (WCAG 2.5.3).
    setAttr(this.#stepBtns.back, "title", frames ? X.frameBackAria : X.tenthBackAria);
    setAttr(this.#stepBtns.fwd, "title", frames ? X.frameFwdAria : X.tenthFwdAria);
  }

  // ---- préréglages ------------------------------------------------------------------------------------
  #pickPreset(L: number, how: "click" | "key"): void {
    if (this.#busy) return;
    if (L === PRESET_CUSTOM) {
      // « Personnalisé » : le mode précis s'ouvre, le focus va dans « Durée » (au clic).
      this.#setPrecis(true, true);
      this.#paintPresets(PRESET_CUSTOM);
      if (how === "click") this.#inputs.len.focus({ preventScroll: true });
      else this.#presetOpts[this.#presetOpts.length - 1]!.focus({ preventScroll: true });
      return;
    }
    const r = applyPreset(this.#range, L, { durationMs: this.#duration && this.#duration > 0 ? this.#duration : MAX_TIMECODE_MS, maxMs: this.#generalMax() }, this.#formatMax());
    if (!r) return;
    this.#msg = null;
    this.#event("preset");
    this.#range = r;
    for (const f of FIELDS) {
      this.#dirty[f] = false;
      this.#invalid[f] = false;
    }
    this.#touched();
    this.#reglette.setRange(r);
    this.#paint();
    if (this.#duration) this.#seek(r.startMs, true);
    this.#announce(TL.presetSaid(L, r.startMs));
    this.#presetOpts[[...PRESETS_MS].indexOf(L as (typeof PRESETS_MS)[number])]?.focus({ preventScroll: true });
  }

  #presetKey(e: KeyboardEvent): void {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    const opts = this.#presetOpts;
    const cur = Math.max(0, opts.findIndex((b) => b === (e.currentTarget as HTMLButtonElement)));
    for (let i = 1; i <= opts.length; i++) {
      const b = opts[(cur + dir * i + opts.length * 2) % opts.length]!;
      if (b.getAttribute("aria-disabled") === "true") continue; // option désactivée : sautée
      this.#pickPreset(Number(b.getAttribute("data-len")), "key");
      return;
    }
  }

  #paintPresets(forceCustom?: number): void {
    const F = this.#formatMax();
    const d = this.#duration && this.#duration > 0 ? this.#duration : null;
    let checked = -1;
    PRESETS_MS.forEach((L, i) => { if (checked < 0 && presetChecked(this.#range, L)) checked = i; });
    if (forceCustom === PRESET_CUSTOM || checked < 0) checked = this.#presetOpts.length - 1;
    this.#presetOpts.forEach((b, i) => {
      const L = Number(b.getAttribute("data-len"));
      const block = L === PRESET_CUSTOM ? null : presetBlock(L, d, F);
      const why = block === "video" ? X.presetVideo : block === "format" ? (this.#format === "gif" ? TL.presetGif(F!) : TL.presetMax(F!)) : null;
      setAttr(b, "aria-disabled", block ? "true" : null);
      setAttr(b, "title", why);
      setAttr(b, "aria-checked", i === checked ? "true" : "false");
      setAttr(b, "tabindex", i === checked ? "0" : "-1");
      if (L !== PRESET_CUSTOM) setAttr(b, "aria-label", TL.presetAria(L, this.#range.startMs));
      b.disabled = this.#busy;
    });
  }

  // ---- lecture de l'instant du lecteur -----------------------------------------------------------
  #startPolling(): void {
    this.#stopPolling();
    const p = this.#hooks.player();
    if (!p) {
      this.#paintNow();
      return;
    }
    const tick = async () => {
      if (this.#polling) return;
      this.#polling = true;
      try {
        const s = await p.snapshot();
        if (typeof s.currentTime === "number" && !this.#reglette.dragging && this.#pendingSeek === null) {
          this.#now = Math.round(s.currentTime * 1000);
          this.#reglette.setPlayhead(this.#now);
        }
        // Durée connue après coup (métadonnées chargées) : la réglette apparaît.
        if ((this.#duration === null || this.#duration <= 0) && typeof s.duration === "number" && s.duration > 0) {
          this.#duration = Math.round(s.duration * 1000);
          setAttr(this.el, "data-duration", null);
          setText(this.#keysEl, X.keysHelp);
          this.#reglette.el.hidden = false;
          this.#range = normalize(this.#range, this.#bounds(), "start");
          this.#reglette.setBounds(this.#bounds());
          this.#reglette.setRange(this.#range);
          this.#setPrecis(this.#precisOpen, false);
          this.#paint();
        }
        if (this.#previewing && s.previewing === false) this.#setPreviewing(false);
        const f = p.frameMs?.() ?? null;
        if (f !== this.#frame) {
          this.#frame = f;
          this.#reglette.setFrameMs(f);
          this.#paintPrecis();
        }
        this.#paintNow();
      } catch {
        /* lecteur momentanément injoignable */
      } finally {
        this.#polling = false;
      }
    };
    void tick();
    this.#poll = setInterval(() => void tick(), p.pollMs);
  }

  #stopPolling(): void {
    if (this.#poll !== null) clearInterval(this.#poll);
    this.#poll = null;
  }

  // ---- format ------------------------------------------------------------------------------------
  #renderFormats(): void {
    const doc = this.#doc;
    const opts: ClipFormat[] = ["mp4", "mp3", "gif"];
    const pick = (f: ClipFormat, focus: boolean) => {
      if (this.#busy) return;
      if (f !== this.#format) {
        // Le format ne modifie PLUS le passage voulu (corrige L11) : seul le passage exporté change.
        this.#format = f;
        this.#touched();
        this.#hooks.formatChanged?.(f);
        this.#event("format");
        this.#renderFormats();
        this.#paint();
        const F = this.#formatMax();
        if (F !== null && this.#range.endMs - this.#range.startMs > F) this.#announce(TL.gifLine(F));
      }
      if (focus) this.#fmtSeg.querySelector<HTMLButtonElement>("[aria-checked=true]")?.focus({ preventScroll: true });
    };
    this.#fmtSeg.replaceChildren(...opts.map((f) => {
      const on = f === this.#format;
      const b = el(doc, "button", {
        class: "ce-opt", text: FORMAT_LABEL[f],
        attrs: { type: "button", role: "radio", "aria-checked": on ? "true" : "false", tabindex: on ? 0 : -1, "data-format": f, disabled: this.#busy, title: formatNote(f, this.#quality) },
      });
      b.addEventListener("click", (e) => { if (e.isTrusted) pick(f, true); });
      b.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        e.stopPropagation();
        const i = opts.indexOf(this.#format);
        pick(opts[(i + (e.key === "ArrowRight" ? 1 : -1) + opts.length) % opts.length]!, true);
      });
      return b;
    }));
    this.#reglette.setFormat(this.#format, this.#formatMax());
  }

  // ---- peinture ----------------------------------------------------------------------------------
  /** `live` : pendant un geste (les champs du mode précis suivent, rien d'autre n'est réécrit qu'au besoin). */
  #paint(live = false): void {
    for (const f of FIELDS) {
      const input = this.#inputs[f];
      // Champ en cours de saisie : on ne réécrit pas sous les doigts de l'utilisateur.
      if (!this.#dirty[f] && !this.#invalid[f]) {
        const v = formatTimecode(this.#fieldValue(f));
        if (input.value !== v) input.value = v;
      }
      setAttr(input, "aria-invalid", this.#invalid[f] ? "true" : null);
      setAttr(input, "data-pending", null);
    }
    const h = this.#hours();
    const { startMs: s, endMs: e } = this.#range;
    setData(this.#rangeEl, TL.range(s, e, h));
    setAttr(this.#toolsBtn, "title", TL.toolsTitle(s, e, h));
    if (!live) {
      const m = this.#msg;
      setText(this.#msgEl, m?.text ?? "");
      setAttr(this.#msgEl, "data-tone", m?.tone ?? null);
    }
    // Ligne du GIF : seulement quand la limite du format coupe le passage.
    const F = this.#formatMax();
    const cut = F !== null && e - s > F;
    if (cut) setData(this.#fline, TL.gifLine(F!));
    if (this.#fline.hidden === cut) this.#fline.hidden = !cut;
    this.#paintPresets();
    this.#paintQuota();
    this.#paintNow();
    this.#paintGo();
  }

  #paintQuota(): void {
    const q = this.#limits?.quota;
    const left = q && q.remaining !== null ? q.remaining : this.#limits?.limits?.restantAujourdhui ?? null;
    const show = left !== null && left > 0 && left <= 3;
    if (show) setData(this.#quotaEl, TL.quota(left!));
    if (this.#quotaEl.hidden === show) this.#quotaEl.hidden = !show;
  }

  #paintNow(): void {
    const known = this.#hooks.player() !== null && this.#now !== null;
    const h = this.#hours();
    setData(this.#nowEl, known ? TL.now(this.#now!, h) : X.playerUnknown);
    this.#playBtn.disabled = !this.#hooks.player() || this.#busy || !this.#duration;
    for (const edge of ["start", "end"] as const) {
      const b = this.#hereBtns[edge];
      b.disabled = this.#busy || !known;
      setAttr(b, "aria-label", TL.hereAria(edge, known ? this.#now : null));
    }
  }

  /** Bouton « Exporter 0:30 en MP4 » : actif seulement si l'export peut partir ; sinon, la raison est écrite dessous. */
  #paintGo(): void {
    const r = this.#exported();
    const len = r.endMs - r.startMs;
    setData(this.#goText, TL.go(len, this.#format));
    setAttr(this.#goBtn, "aria-label", TL.goAria(len, this.#format));
    let why: string | null = null;
    if (FIELDS.some((f) => this.#invalid[f])) why = X.fixFields;
    else {
      const c = checkRange(r, { durationMs: this.#duration && this.#duration > 0 ? this.#duration : null, maxMs: this.#formatMax() });
      if (!c.ok) why = c.message;
      else if (this.#limits?.limits?.extraitsActifs === false) why = X.extractsOff;
      else if (quotaExhausted(this.#limits) || this.#limits?.limits?.restantAujourdhui === 0) why = X.quotaReached;
      else if (this.#blocked) why = this.#blocked;
    }
    this.#goBtn.disabled = this.#busy || why !== null;
    setText(this.#whyEl, this.#busy ? "" : why ?? "");
    setAttr(this.#whyEl, "data-tone", why ? "bad" : null);
  }

  #doExport(): void {
    for (const f of FIELDS) if (this.#dirty[f]) this.#commit(f);
    this.#paintGo();
    if (this.#goBtn.disabled || this.#busy) return;
    if (this.#previewing) {
      this.#hooks.player()?.stop();
      this.#setPreviewing(false);
    }
    this.#event("export");
    this.#dropHint();
    this.#reglette.hideLensNow();
    this.#hooks.export(this.#exported(), this.#format);
  }

  // ---- annonces ------------------------------------------------------------------------------------
  /** Région polie dédiée : seulement à la fin d'un geste, jamais pendant. Une même phrase est redite. */
  #announce(text: string): void {
    if (this.#liveTimer !== null) clearTimeout(this.#liveTimer);
    if (this.#liveEl.textContent === text) setText(this.#liveEl, "");
    this.#liveTimer = setTimeout(() => {
      this.#liveTimer = null;
      setText(this.#liveEl, text);
    }, 40);
  }

  // ---- astuces (Companion « Hint ») ---------------------------------------------------------------
  async #loadPrefs(): Promise<void> {
    const p = await readPrefs([PREF_HINTS, PREF_HINTS_OFF, PREF_LENS_VIEWS]);
    const last = p[PREF_HINTS];
    if (last && typeof last === "object") {
      for (const [k, v] of Object.entries(last as Record<string, unknown>)) if (typeof v === "number") this.#hintMem.last[k as HintId] = v;
    }
    this.#hintMem.off = p[PREF_HINTS_OFF] === true;
    this.#lensViews = typeof p[PREF_LENS_VIEWS] === "number" ? (p[PREF_LENS_VIEWS] as number) : 0;
  }

  /** Lentille flottante montrée par un glisser : indication « Descends ici pour affiner » les trois premières fois. */
  #lensShown(): void {
    const tip = this.#lensViews < 3;
    this.#reglette.lens.setTip(tip);
    if (tip) {
      this.#lensViews += 1;
      writePref(PREF_LENS_VIEWS, this.#lensViews);
    }
  }

  #event(type: EditorEventType): void {
    if (!this.#opened) return;
    this.#events.push({ type, at: Date.now() });
    if (this.#events.length > 60) this.#events.splice(1, this.#events.length - 60);
    this.#checkHint();
  }

  #startHints(): void {
    this.#stopHints();
    // Une minuterie unique de 1 s, seulement pendant que le menu est visible.
    this.#hintTimer = setInterval(() => this.#checkHint(), 1_000);
  }

  #stopHints(): void {
    if (this.#hintTimer !== null) clearInterval(this.#hintTimer);
    this.#hintTimer = null;
  }

  #checkHint(): void {
    if (this.#hintEl) {
      if (Date.now() - this.#hintShownAt >= HINT_LIFE_MS) this.#dropHint();
      return;
    }
    if (!this.#visible || this.#busy || this.#jobView || this.#reglette.dragging || this.#msg) return;
    if (FIELDS.some((f) => this.#dirty[f])) return;
    const id = hint(this.#events, Date.now(), this.#hintMem);
    if (id) this.#showHint(id);
  }

  #hintText(id: HintId): string {
    const G = this.#generalMax();
    if (id === "inaction") return TL.hintInaction();
    if (id === "hesitation") return TL.hintHesitation();
    if (id === "butee") return G !== null ? TL.hintButee(G) : TL.hintHesitation();
    return TL.hintPrecision();
  }

  #showHint(id: HintId): void {
    if (id === "butee" && this.#generalMax() === null) return;
    const doc = this.#doc;
    const close = el(doc, "button", { class: "ce-hint-x", text: "×", attrs: { type: "button", "aria-label": X.hintClose, title: X.hintClose } });
    const off = el(doc, "button", { class: "ce-hint-off", text: X.hintOff, attrs: { type: "button" } });
    const owl = el(doc, "span", { class: "ce-hint-owl", attrs: { "aria-hidden": "true" } }, [owlSvg(doc, { size: 20, surface: "dark", className: "ce-hint-svg" })]);
    const box = el(doc, "div", { class: "ce-hint", attrs: { role: "status", "data-hint": id } }, [
      owl, el(doc, "div", { class: "ce-hint-body" }, [el(doc, "p", { class: "ce-hint-t", text: this.#hintText(id) }), off]), close,
    ]);
    close.addEventListener("click", (e) => { if (e.isTrusted) this.#dropHint(); });
    off.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      this.#hintMem.off = true;
      writePref(PREF_HINTS_OFF, true);
      this.#dropHint();
    });
    this.#hintMem.shownThisOpen = true;
    this.#hintMem.last[id] = Date.now();
    writePref(PREF_HINTS, { ...this.#hintMem.last });
    this.#hintEl = box;
    this.#hintShownAt = Date.now();
    this.#note.append(box);
    this.#hooks.resized?.();
  }

  #dropHint(): void {
    if (!this.#hintEl) return;
    this.#hintEl.remove();
    this.#hintEl = null;
    this.#hooks.resized?.();
  }
}
