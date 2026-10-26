// Réglette unique de TimeLens (3.8.0), remplace la piste principale + loupe de 3.6.
// - Bande réservée au-dessus de la piste : bulle de durée (centrée sur le passage exporté, bornée à la bande) et
//   instant survolé ; plus rien n'est dessiné hors de la bande (corrige L8).
// - Deux poignées en vrais curseurs (role="slider"), posées à l'extérieur du passage ; tête de lecture dont le point
//   s'efface et dont le filet passe sous une poignée proche (corrige L9) ; partie exclue hachurée (GIF).
// - Glisser d'une poignée : lentille (lentille.ts) en « suivi », puis « affinage » si le pointeur descend dedans ; rien
//   ne se recentre, ni pendant le geste ni au relâchement (corrige L1 à L5). Limite du serveur : butée douce, l'autre
//   borne ne bouge jamais (shared/timelens.ts, dragEdge ; corrige L12), élastique de 18 px au plus, retour en ressort.
// - Clavier : pas existants (shared/extrait.ts, keyStep) ; au-delà de la limite, pas de changement et annonce.
// Peinture une fois par image (requestAnimationFrame) ; aucun nœud créé ou retiré pendant un geste.
import { keyStep, MIN_CLIP_MS, shiftRange, type Bounds, type ClipFormat, type Edge, type RangeMs } from "../shared/extrait.ts";
import { dragEdge, edgePan, LENS_ENTER_PX, LENS_EXIT_PX, LENS_SHOW_PX, nearLimit, rubber, snap } from "../shared/timelens.ts";
import { formatDureeHorloge, formatInstantCourt, formatParle, HOUR_MS } from "../shared/timecode.ts";
import { el, reducedMotion, setAttr, setData, textEl } from "./dom.ts";
import { Lens, LENS_PAD_PX } from "./lentille.ts";
import { FORMAT_LABEL, TL, X } from "./texts.ts";

export interface RegletteHooks {
  /** Passage changé par l'utilisateur (poignée, passage entier, clavier) ; `final` : geste terminé. */
  onInput(r: RangeMs, moved: Edge | "both", final: boolean): void;
  /** Aller à cet instant dans le lecteur (appui ou glisser sur la piste, hors poignées). */
  onSeek(ms: number, final: boolean): void;
  /** Fin d'un geste du pointeur : annonce, astuces. */
  onGestureEnd?(g: { kind: Edge | "band" | "seek"; moved: boolean; bumped: boolean; fine: boolean }): void;
  /** Une poignée est saisie au pointeur : choix explicite de la borne (lentille posée). */
  onGrab?(edge: Edge): void;
  /** Butée de la limite au clavier : une fois par série de touches. */
  onKeyLimit?(): void;
  /** Lentille flottante montrée par un glisser (indication des trois premiers usages). */
  onLensShown?(): void;
}

type Grab = Edge | "band" | "seek";
const AREA_PAD = 16;
const HANDLE_W = 14;
/** Retour élastique à la limite : ressort « retour » (C-PLAN §B.3). */
const RETOUR = "linear(0, 0.114 8.3%, 0.342 16.7%, 0.574 25%, 0.761 33.3%, 0.89 41.7%, 0.969 50%, 1.01 58.3%, 1.026 66.7%, 1.028 75%, 1.023 83.3%, 1.016 91.7%, 1)";

interface Drag {
  id: number;
  grab: Grab;
  /** La lentille a été saisie directement (posée, ou flottante survolée après un relâchement). */
  fromLens: boolean;
  target: HTMLElement;
  left: number;
  width: number;
  /** Millisecondes par pixel de la réglette. */
  k: number;
  offset: number;
  origin: RangeMs;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
  regime: "suivi" | "affinage";
  lensTop: number;
  bandLeft: number;
  lastT: number;
  bumped: boolean;
  fine: boolean;
  rubberPx: number;
}

const pct = (v: number): string => `${Math.round(v * 100000) / 1000}%`;

export class Reglette {
  readonly el: HTMLDivElement;
  readonly lens: Lens;
  readonly #doc: Document;
  readonly #hooks: RegletteHooks;
  readonly #lane: HTMLDivElement;
  readonly #bubble: HTMLSpanElement;
  readonly #bubbleText: HTMLSpanElement;
  readonly #htip: HTMLSpanElement;
  readonly #track: HTMLDivElement;
  readonly #area: HTMLDivElement;
  readonly #excl: HTMLDivElement;
  readonly #ph: HTMLDivElement;
  readonly #hover: HTMLDivElement;
  readonly #handles: Record<Edge, HTMLDivElement>;
  readonly #scaleEnd: HTMLSpanElement;
  #bounds: Bounds = { durationMs: 0, maxMs: null };
  #formatMax: number | null = null;
  #format: ClipFormat = "mp4";
  #range: RangeMs = { startMs: 0, endMs: 0 };
  #playhead: number | null = null;
  #frame: number | null = null;
  #drag: Drag | null = null;
  #raf = 0;
  #disabled = false;
  #trackW = 0;
  #bubbleX = 0;
  #bubbleW = 0;
  readonly #widths = new Map<string, number>();
  #posedEdge: Edge = "start";
  #keyBumped = false;
  #keyTimer: ReturnType<typeof setTimeout> | null = null;
  #keyLens = false;

  constructor(doc: Document, hooks: RegletteHooks) {
    this.#doc = doc;
    this.#hooks = hooks;
    this.lens = new Lens(doc);
    this.#bubbleText = textEl(doc, "span", "tl-bubble-t");
    this.#bubble = el(doc, "span", { class: "tl-bubble", attrs: { "aria-hidden": "true" } }, [this.#bubbleText]);
    this.#htip = textEl(doc, "span", "tl-htip");
    setAttr(this.#htip, "aria-hidden", "true");
    this.#lane = el(doc, "div", { class: "tl-lane", attrs: { "aria-hidden": "true" } }, [this.#bubble, this.#htip]);
    const handle = (edge: Edge) => el(doc, "div", {
      class: `tl-h tl-h-${edge}`,
      attrs: { role: "slider", tabindex: 0, "aria-label": edge === "start" ? X.startSlider : X.endSlider, "aria-orientation": "horizontal", "data-edge": edge },
    }, [el(doc, "span", { class: "tl-grip", attrs: { "aria-hidden": "true" } })]);
    this.#handles = { start: handle("start"), end: handle("end") };
    const sel = el(doc, "div", { class: "tl-sel", attrs: { "aria-hidden": "true" } });
    this.#excl = el(doc, "div", { class: "tl-excl", attrs: { "aria-hidden": "true" } });
    this.#ph = el(doc, "div", { class: "tl-ph", attrs: { "aria-hidden": "true" } });
    this.#hover = el(doc, "div", { class: "tl-hover", attrs: { "aria-hidden": "true" } });
    this.#area = el(doc, "div", { class: "tl-area" }, [sel, this.#excl, this.#ph, this.#hover, this.#handles.start, this.#handles.end]);
    this.#track = el(doc, "div", { class: "tl-track" }, [el(doc, "div", { class: "tl-rail", attrs: { "aria-hidden": "true" } }), this.#area]);
    this.#scaleEnd = textEl(doc, "span", "tl-scale-end");
    const scale = el(doc, "div", { class: "tl-scale", attrs: { "aria-hidden": "true" } }, [el(doc, "span", { text: "0:00" }), this.#scaleEnd]);
    this.el = el(doc, "div", { class: "tl", attrs: { role: "group", "aria-label": X.rangeGroup } }, [this.#lane, this.#track, scale, this.lens.el]);

    // ---- événements ----------------------------------------------------------------------------
    for (const t of [this.#track, this.lens.el]) {
      t.addEventListener("pointerdown", (e) => this.#down(e, t === this.lens.el));
      t.addEventListener("pointermove", (e) => this.#move(e, t === this.lens.el));
      t.addEventListener("pointerup", (e) => this.#up(e));
      t.addEventListener("pointercancel", (e) => this.#up(e, true));
      t.addEventListener("lostpointercapture", (e) => this.#up(e, true));
    }
    this.#track.addEventListener("pointerleave", () => { if (!this.#drag) this.#hideHover(); });
    this.lens.el.addEventListener("wheel", (e) => this.#wheel(e), { passive: false });
    for (const edge of ["start", "end"] as const) {
      const h = this.#handles[edge];
      h.addEventListener("keydown", (e) => this.#key(e, edge));
      // Perte du focus : la lentille ouverte au clavier s'efface aussitôt.
      h.addEventListener("blur", () => { if (this.#keyLens && !this.#drag) this.hideLensNow(); });
    }
    try {
      new ResizeObserver((entries) => {
        for (const e of entries) {
          const w = e.contentRect.width;
          if (w > 0 && Math.abs(w - this.#trackW) > 0.5) {
            this.#trackW = w;
            this.#paint();
          }
        }
      }).observe(this.#track);
    } catch {
      /* mesure au geste */
    }
  }

  // ---- API ---------------------------------------------------------------------------------------
  setBounds(b: Bounds): void {
    const changed = b.durationMs !== this.#bounds.durationMs;
    this.#bounds = { ...b };
    this.#readFont();
    if (changed) {
      setData(this.#scaleEnd, formatDureeHorloge(b.durationMs));
      this.lens.setVideo(b.durationMs);
    }
    this.#paint();
  }

  /** Limite du format (la plus stricte, GIF par exemple) : la partie au-delà est hachurée, non exportée. */
  setFormat(f: ClipFormat, formatMaxMs: number | null): void {
    this.#format = f;
    this.#formatMax = formatMaxMs;
    this.#paint();
  }

  get value(): RangeMs {
    return { ...this.#range };
  }

  get dragging(): boolean {
    return this.#drag !== null;
  }

  /** Passage posé de l'extérieur (champs, marques, préréglages) : repeint, sans rappeler onInput. */
  setRange(r: RangeMs): void {
    this.#range = { ...r };
    this.#paint();
    this.#syncLens(true);
  }

  setPlayhead(ms: number | null): void {
    if (ms === this.#playhead) return;
    this.#playhead = ms;
    this.#paintPlayhead();
  }

  setFrameMs(ms: number | null): void {
    this.#frame = ms;
    this.lens.setFrame(ms);
  }

  setDisabled(on: boolean): void {
    this.#disabled = on;
    setAttr(this.el, "data-disabled", on ? "" : null);
    for (const edge of ["start", "end"] as const) {
      setAttr(this.#handles[edge], "aria-disabled", on ? "true" : null);
      setAttr(this.#handles[edge], "tabindex", on ? "-1" : "0");
    }
    if (on) {
      this.#cancelDrag();
      this.hideLensNow();
    }
  }

  focus(edge: Edge): void {
    try {
      this.#handles[edge].focus({ preventScroll: true });
    } catch {
      /* ignoré */
    }
  }

  // ---- lentille posée (mode précis) --------------------------------------------------------------
  /** Lentille posée (mode précis) sur `edge`, ou rendue flottante. L'élément est placé par l'éditeur. */
  setPosed(on: boolean, edge: Edge): void {
    this.#posedEdge = edge;
    this.lens.setPosed(on);
    if (on) {
      this.lens.show("pose", edge);
      const v = this.#valueOf(edge);
      this.lens.setValue(v);
      this.lens.center(v);
      this.lens.setNeedle(this.lens.xOf(v));
    } else {
      this.lens.hideNow();
    }
  }

  /** Borne de la lentille posée changée (choix radio) : la bande glisse vers l'autre valeur. */
  setPosedEdge(edge: Edge, animate: boolean): void {
    if (edge === this.#posedEdge && this.lens.shownEdge === edge) return;
    this.#posedEdge = edge;
    if (!this.lens.posed) return;
    this.lens.show("pose", edge);
    const v = this.#valueOf(edge);
    this.lens.setValue(v);
    this.lens.slideTo(v, animate);
  }

  get lensEdge(): Edge {
    return this.#posedEdge;
  }

  #valueOf(edge: Edge): number {
    return edge === "start" ? this.#range.startMs : this.#range.endMs;
  }

  /** Lentille posée : la valeur de sa borne a changé hors d'un geste ; la fenêtre glisse juste assez. */
  #syncLens(animate: boolean): void {
    if (!this.lens.posed || this.#drag) return;
    const v = this.#valueOf(this.#posedEdge);
    this.lens.setValue(v);
    this.lens.reveal(v, animate && !reducedMotion(this.#doc.defaultView));
    this.lens.setNeedle(this.lens.xOf(v));
  }

  hideLensNow(): void {
    this.#keyLens = false;
    this.lens.hideNow();
  }

  // ---- pointeur ----------------------------------------------------------------------------------
  #msAt(x: number, d: { left: number; width: number }): number {
    const f = d.width > 0 ? (x - d.left) / d.width : 0;
    return f * this.#bounds.durationMs;
  }

  #down(e: PointerEvent, fromLens: boolean): void {
    if (!e.isTrusted || e.button !== 0 || this.#disabled || this.#bounds.durationMs <= 0 || this.#drag) return;
    const target = e.target as Element | null;
    const r = this.#area.getBoundingClientRect();
    const k = r.width > 0 ? this.#bounds.durationMs / r.width : 1;
    const lr = this.lens.el.getBoundingClientRect();
    const bandLeft = lr.left + LENS_PAD_PX;
    if (lr.width > 2 * LENS_PAD_PX) this.lens.setBandWidth(lr.width - 2 * LENS_PAD_PX);
    let grab: Grab;
    let offset = 0;
    if (fromLens) {
      // Lentille posée, ou flottante encore visible : un appui pose l'aiguille sous le pointeur (geste explicite).
      if (!this.lens.isVisible) return;
      grab = this.lens.shownEdge;
      if (this.lens.windowStart === null) this.lens.freeze(this.#valueOf(grab), this.lens.needleX);
    } else {
      const h = target?.closest<HTMLElement>(".tl-h");
      if (h) {
        grab = h.getAttribute("data-edge") === "end" ? "end" : "start";
        offset = this.#msAt(e.clientX, r) - this.#valueOf(grab);
        this.focus(grab);
      } else if (target?.closest(".tl-sel, .tl-excl")) {
        grab = "band";
        offset = this.#msAt(e.clientX, r);
      } else {
        grab = "seek";
      }
    }
    e.preventDefault();
    e.stopPropagation();
    this.#hideHover();
    this.#keyLens = false;
    const t = fromLens ? this.lens.el : this.#track;
    const win = this.#doc.defaultView;
    this.#drag = {
      id: e.pointerId, grab, fromLens, target: t, left: r.left, width: r.width, k, offset, origin: { ...this.#range },
      startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, moved: false, regime: fromLens ? "affinage" : "suivi",
      lensTop: lr.top, bandLeft, lastT: win?.performance.now() ?? 0, bumped: false, fine: fromLens, rubberPx: 0,
    };
    if (grab === "start" || grab === "end") {
      this.#hooks.onGrab?.(grab);
      this.#cancelRubber(grab);
      if (fromLens) {
        this.lens.setHeld(true);
        this.lens.show(this.lens.posed ? "pose" : "affinage", grab);
        this.#drag.moved = true;
      }
    }
    setAttr(this.el, "data-dragging", grab);
    try {
      t.setPointerCapture(e.pointerId);
    } catch {
      /* pointeur déjà relâché */
    }
    if (grab === "seek" || fromLens) this.#schedule();
  }

  #move(e: PointerEvent, overLens: boolean): void {
    const d = this.#drag;
    if (d && e.pointerId === d.id) {
      d.x = e.clientX;
      d.y = e.clientY;
      this.#schedule();
      return;
    }
    if (d || overLens || this.#disabled || e.pointerType === "touch" || this.#bounds.durationMs <= 0) return;
    this.#paintHover(e.clientX);
  }

  #schedule(): void {
    if (this.#raf) return;
    const win = this.#doc.defaultView;
    if (!win) return;
    this.#raf = win.requestAnimationFrame(() => {
      this.#raf = 0;
      this.#apply(false);
    });
  }

  /** Applique la position courante du pointeur (une fois par image). */
  #apply(final: boolean): void {
    const d = this.#drag;
    if (!d) return;
    const b = this.#bounds;
    if (d.grab === "seek") {
      const ms = Math.round(Math.min(Math.max(0, this.#msAt(d.x, d)), b.durationMs));
      this.setPlayhead(ms);
      this.#hooks.onSeek(ms, final);
      return;
    }
    if (Math.abs(d.x - d.startX) > LENS_SHOW_PX || Math.abs(d.y - d.startY) > LENS_SHOW_PX) {
      if (!d.moved && (d.grab === "start" || d.grab === "end")) {
        d.moved = true;
        // Premier mouvement de plus de 3 px : la lentille apparaît (fondu et montée de 4 px), en « suivi ».
        this.lens.show("suivi", d.grab);
        if (!this.lens.posed) this.#hooks.onLensShown?.();
      }
      d.moved = true;
    }
    if (d.grab === "band") {
      if (!d.moved) {
        if (final) {
          // Appui bref sur le passage : le lecteur va à cet instant.
          const ms = Math.round(Math.min(Math.max(0, this.#msAt(d.x, d)), b.durationMs));
          this.setPlayhead(ms);
          this.#hooks.onSeek(ms, true);
        }
        return;
      }
      this.#range = shiftRange(d.origin, Math.round(this.#msAt(d.x, d) - d.offset), b);
      this.#paint();
      this.#hooks.onInput(this.value, "both", final);
      return;
    }
    if (!d.moved) return;
    const edge = d.grab;
    const lens = this.lens;
    const bandW = lens.width;
    const xb = d.x - d.bandLeft;
    // Régime : affinage quand le pointeur descend dans la lentille (hystérésis de 12 px).
    if (d.regime === "suivi" && lens.isVisible && d.y >= d.lensTop + LENS_ENTER_PX) {
      d.regime = "affinage";
      d.fine = true;
      d.lastT = this.#doc.defaultView?.performance.now() ?? 0;
      lens.show(lens.posed ? "pose" : "affinage", edge);
      lens.freeze(this.#valueOf(edge), xb);
      lens.setTip(false);
    } else if (d.regime === "affinage" && d.y < d.lensTop - LENS_EXIT_PX) {
      // Retour sur la réglette : la valeur continue de la position courante (nouveau décalage de saisie gardé).
      d.regime = "suivi";
      d.offset = this.#msAt(d.x, d) - this.#valueOf(edge);
      lens.show("suivi", edge);
    }
    let raw: number;
    let res: { range: RangeMs; overMs: number };
    let needleExtra = 0;
    if (d.regime === "affinage") {
      const now = this.#doc.defaultView?.performance.now() ?? d.lastT;
      const dt = Math.min(64, Math.max(0, now - d.lastT));
      d.lastT = now;
      const xc = Math.min(bandW, Math.max(0, xb));
      const w0 = lens.windowStart ?? 0;
      const pan = final ? 0 : edgePan(d.x, d.bandLeft, bandW, lens.spanMs, dt);
      raw = snap(w0 + pan + xc * lens.scale, this.#frame);
      res = dragEdge(this.#range, edge, raw, b);
      const stopped = (edge === "start" ? res.range.startMs : res.range.endMs) !== raw;
      if (pan && !stopped) lens.setWindow(w0 + pan);
      else if (pan) {
        // Butée : le défilement s'arrête.
        raw = snap(w0 + xc * lens.scale, this.#frame);
        res = dragEdge(this.#range, edge, raw, b);
      }
      const v = edge === "start" ? res.range.startMs : res.range.endMs;
      if (v !== raw) {
        // L'aiguille se pose sur la butée, puis se décale (élastique) vers le pointeur.
        const over = xb - lens.xOf(v);
        needleExtra = Math.sign(over) * rubber(Math.abs(over));
      }
      d.rubberPx = 0;
    } else {
      raw = Math.round(this.#msAt(d.x, d) - d.offset);
      res = dragEdge(this.#range, edge, raw, b);
      const v = edge === "start" ? res.range.startMs : res.range.endMs;
      // Limite du serveur : la poignée s'arrête, puis résiste (élastique de 18 px au plus) dans le sens du pointeur.
      const overPx = res.overMs > 0 ? (raw - v) / d.k : 0;
      d.rubberPx = Math.sign(overPx) * rubber(Math.abs(overPx));
    }
    if (res.overMs > 0) d.bumped = true;
    this.#range = res.range;
    this.#handles[edge].style.translate = d.rubberPx ? `${d.rubberPx.toFixed(2)}px 0` : "";
    this.#paint();
    const v = this.#valueOf(edge);
    lens.setValue(v);
    if (d.regime === "affinage") lens.setNeedle(lens.xOf(v), needleExtra);
    else lens.setNeedle(xb);
    this.#hooks.onInput(this.value, edge, final);
    // Défilement continu tant que le pointeur reste dans une zone de bord.
    if (!final && d.regime === "affinage" && edgePan(d.x, d.bandLeft, bandW, lens.spanMs, 16) !== 0) this.#schedule();
  }

  #up(e: PointerEvent, cancelled = false): void {
    const d = this.#drag;
    if (!d || e.pointerId !== d.id) return;
    if (this.#raf) {
      this.#doc.defaultView?.cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    }
    if (!cancelled) {
      d.x = e.clientX;
      d.y = e.clientY;
    }
    this.#apply(true);
    this.#drag = null;
    setAttr(this.el, "data-dragging", null);
    this.lens.setHeld(false);
    if (d.grab === "start" || d.grab === "end") {
      if (d.rubberPx) this.#releaseRubber(d.grab, d.rubberPx);
      if (this.lens.posed) {
        // Lentille posée : la fenêtre se fige sous l'aiguille (rien ne bouge), les libellés reviennent.
        const v = this.#valueOf(d.grab);
        if (this.lens.windowStart === null) this.lens.freeze(v, this.lens.needleX);
        this.lens.show("pose", d.grab);
      } else if (d.moved || d.fromLens) {
        // Au relâchement, RIEN NE BOUGE : la lentille s'efface après 700 ms, sauf si le pointeur la survole.
        this.lens.hideAfter(700);
      }
    }
    try {
      d.target.releasePointerCapture(d.id);
    } catch {
      /* déjà relâché */
    }
    if (d.grab !== "seek") this.#hooks.onGestureEnd?.({ kind: d.grab, moved: d.moved, bumped: d.bumped, fine: d.fine });
  }

  #cancelDrag(): void {
    const d = this.#drag;
    if (!d) return;
    this.#drag = null;
    setAttr(this.el, "data-dragging", null);
    if (d.grab === "start" || d.grab === "end") this.#handles[d.grab].style.translate = "";
  }

  /** Retour de la poignée à la limite, en ressort « retour » (380 ms) ; immédiat en mouvement réduit. */
  #releaseRubber(edge: Edge, px: number): void {
    const h = this.#handles[edge];
    h.style.translate = "";
    if (reducedMotion(this.#doc.defaultView) || typeof h.animate !== "function") return;
    const a = h.animate([{ translate: `${px.toFixed(2)}px 0` }, { translate: "0px 0" }], { duration: 380, easing: RETOUR });
    (a as Animation & { id?: string }).id = "tl-retour";
  }

  #cancelRubber(edge: Edge): void {
    const h = this.#handles[edge];
    for (const a of h.getAnimations?.() ?? []) if ((a as Animation & { id?: string }).id === "tl-retour") a.cancel();
    h.style.translate = "";
  }

  /** Molette ou défilement horizontal dans la lentille posée : la fenêtre glisse, la valeur ne change pas. */
  #wheel(e: WheelEvent): void {
    if (!this.lens.posed || this.#drag || this.#disabled || this.lens.windowStart === null) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!delta) return;
    e.preventDefault();
    this.lens.cancelTween();
    this.lens.setWindow(this.lens.windowStart + delta * this.lens.scale);
    this.lens.setNeedle(this.lens.xOf(this.#valueOf(this.lens.shownEdge)));
  }

  // ---- survol ------------------------------------------------------------------------------------
  #paintHover(clientX: number): void {
    const r = this.#area.getBoundingClientRect();
    const d = this.#bounds.durationMs;
    const f = Math.min(1, Math.max(0, r.width > 0 ? (clientX - r.left) / r.width : 0));
    this.#hover.style.setProperty("--h", pct(f));
    setData(this.#htip, formatInstantCourt(f * d, { hours: d >= HOUR_MS }));
    const w = this.#textWidth(this.#htip);
    const laneW = r.width + 2 * AREA_PAD;
    const cx = AREA_PAD + f * r.width;
    const x = Math.min(Math.max(0, cx - w / 2), Math.max(0, laneW - w));
    this.#htip.style.transform = `translateX(${x.toFixed(1)}px)`;
    // L'instant survolé ne recouvre jamais la bulle de durée (marge de 4 px) : il s'efface.
    const hit = x < this.#bubbleX + this.#bubbleW + 4 && x + w > this.#bubbleX - 4;
    setAttr(this.#htip, "data-hidden", hit ? "" : null);
    setAttr(this.#track, "data-hover", "");
    setAttr(this.#lane, "data-hover", "");
  }

  #hideHover(): void {
    setAttr(this.#track, "data-hover", null);
    setAttr(this.#lane, "data-hover", null);
  }

  // ---- clavier -----------------------------------------------------------------------------------
  #key(e: KeyboardEvent, edge: Edge): void {
    if (this.#disabled) return;
    const step = keyStep(e, this.#frame);
    if (step === null) return;
    e.preventDefault();
    e.stopPropagation();
    const b = this.#bounds;
    const d = Math.max(0, b.durationMs);
    const cur = this.#valueOf(edge);
    const to = step === "home" ? (edge === "start" ? 0 : this.#range.startMs + MIN_CLIP_MS) : step === "end" ? (edge === "start" ? this.#range.endMs - MIN_CLIP_MS : d) : cur + step;
    const res = dragEdge(this.#range, edge, to, b);
    if (res.overMs > 0 && !this.#keyBumped) {
      this.#keyBumped = true;
      this.#hooks.onKeyLimit?.();
    }
    if (this.#keyTimer !== null) clearTimeout(this.#keyTimer);
    this.#keyTimer = setTimeout(() => { this.#keyTimer = null; this.#keyBumped = false; }, 1_200);
    this.#range = res.range;
    this.#paint();
    const v = this.#valueOf(edge);
    const lens = this.lens;
    const animate = !reducedMotion(this.#doc.defaultView);
    if (lens.posed) {
      if (lens.shownEdge === edge) {
        lens.setValue(v);
        lens.reveal(v, animate);
        lens.setNeedle(lens.xOf(v));
      }
    } else {
      // Au clavier : la lentille apparaît au premier réglage (fenêtre centrée, libellés visibles), puis la fenêtre
      // glisse juste assez ; elle s'efface 1 200 ms après la dernière touche.
      const first = !lens.isVisible || !this.#keyLens || lens.shownEdge !== edge;
      this.#keyLens = true;
      lens.show("affinage", edge, true);
      lens.setValue(v);
      if (first) lens.center(v);
      else lens.reveal(v, animate);
      lens.setNeedle(lens.xOf(v));
      lens.hideAfter(1_200, () => { this.#keyLens = false; });
    }
    setAttr(this.el, "data-keyed", edge);
    this.#hooks.onInput(this.value, edge, true);
  }

  // ---- peinture ----------------------------------------------------------------------------------
  /**
   * Largeur d'une étiquette (bulle, instant survolé) SANS lire la mise en page : texte mesuré au canevas avec la police
   * calculée de l'étiquette (lue hors des gestes, une fois), plus son rembourrage. Repli : offsetWidth, une fois par
   * forme de texte (« 0:00.0 », « 00:00 · max 00:00 »…).
   */
  #textWidth(e: HTMLElement): number {
    const text = e.textContent ?? "";
    const shape = `${e.className}|${text.replace(/\d/g, "0")}`;
    let w = this.#widths.get(shape);
    if (w !== undefined) return w;
    const ctx = this.#measure();
    if (ctx && this.#font) {
      ctx.font = this.#font;
      w = Math.ceil(ctx.measureText(text.replace(/\d/g, "0")).width) + 16;
    } else {
      w = e.offsetWidth;
    }
    if (w > 0) this.#widths.set(shape, w);
    return w;
  }

  #ctx: CanvasRenderingContext2D | null | undefined;
  #font = "";

  #measure(): CanvasRenderingContext2D | null {
    if (this.#ctx === undefined) {
      try {
        this.#ctx = this.#doc.createElement("canvas").getContext("2d");
      } catch {
        this.#ctx = null;
      }
    }
    return this.#ctx;
  }

  /** Police des étiquettes, lue hors des gestes (ouverture, changement de bornes). */
  #readFont(): void {
    if (this.#font || !this.#bubble.isConnected) return;
    try {
      const cs = this.#doc.defaultView?.getComputedStyle(this.#bubble);
      if (cs && cs.fontFamily) this.#font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    } catch {
      /* repli : offsetWidth */
    }
  }

  #paint(): void {
    const dur = this.#bounds.durationMs || 1;
    const { startMs: s, endMs: e } = this.#range;
    const a = this.#area.style;
    a.setProperty("--a", pct(s / dur));
    a.setProperty("--b", pct(e / dur));
    const F = this.#formatMax;
    const cut = F !== null && e - s > F;
    const xEnd = cut ? s + F! : e;
    setAttr(this.#excl, "data-on", cut ? "" : null);
    if (cut) a.setProperty("--x", pct(xEnd / dur));
    for (const edge of ["start", "end"] as const) {
      const v = edge === "start" ? s : e;
      const h = this.#handles[edge];
      setAttr(h, "aria-valuemin", String(edge === "start" ? 0 : Math.min(dur, s + MIN_CLIP_MS) / 1000));
      setAttr(h, "aria-valuemax", String((edge === "start" ? Math.max(0, e - MIN_CLIP_MS) : this.#bounds.durationMs) / 1000));
      setAttr(h, "aria-valuenow", String(v / 1000));
      setAttr(h, "aria-valuetext", formatParle(v));
    }
    this.#paintBubble(s, xEnd, cut);
    this.#paintPlayhead();
  }

  #paintBubble(s: number, xEnd: number, cut: boolean): void {
    const G = this.#bounds.maxMs;
    const len = xEnd - s;
    let text: string;
    let bronze = true;
    if (cut) text = this.#format === "gif" ? TL.bubbleGif(len) : `${formatDureeHorloge(len)} en ${FORMAT_LABEL[this.#format]}`;
    else if (G !== null && len >= G) text = TL.bubbleMax(G);
    else if (nearLimit(len, G)) text = TL.bubbleNear(len, G!);
    else {
      text = TL.bubble(len);
      bronze = false;
    }
    setData(this.#bubbleText, text);
    setAttr(this.#bubble, "data-tone", bronze ? "bronze" : null);
    const areaW = (this.#trackW || 0) - 2 * AREA_PAD;
    if (!(areaW > 0)) return;
    const dur = this.#bounds.durationMs || 1;
    const w = this.#textWidth(this.#bubble);
    const laneW = areaW + 2 * AREA_PAD;
    const cx = AREA_PAD + areaW * ((s + xEnd) / 2 / dur);
    const x = Math.min(Math.max(0, cx - w / 2), Math.max(0, laneW - w));
    this.#bubbleX = x;
    this.#bubbleW = w;
    this.#bubble.style.transform = `translateX(${x.toFixed(1)}px)`;
    this.#bubble.style.setProperty("--tip", `${Math.min(Math.max(8, cx - x), Math.max(8, w - 8)).toFixed(1)}px`);
  }

  #paintPlayhead(): void {
    const d = this.#bounds.durationMs;
    const t = this.#playhead;
    const show = t !== null && d > 0;
    setAttr(this.#ph, "data-on", show ? "" : null);
    if (!show) return;
    this.#ph.style.setProperty("--t", pct(Math.min(1, t / d)));
    // Tête de lecture à 6 px d'une poignée ou plus près : son point s'efface, son filet passe sous la poignée.
    const areaW = (this.#trackW || 0) - 2 * AREA_PAD;
    if (!(areaW > 0)) return;
    const px = (ms: number) => (ms / d) * areaW;
    const x = px(t);
    const xs = px(this.#range.startMs);
    const xe = px(this.#range.endMs);
    const near = (x >= xs - HANDLE_W - 6 && x <= xs + 6) || (x >= xe - 6 && x <= xe + HANDLE_W + 6);
    setAttr(this.#ph, "data-near", near ? "" : null);
  }
}
