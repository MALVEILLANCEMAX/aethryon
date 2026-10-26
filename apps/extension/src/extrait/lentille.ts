// Lentille de TimeLens (3.8.0) : la correction de la loupe. UNE seule instance, créée à la construction ; pendant un
// geste, AUCUN nœud n'est créé ni retiré : les graduations sont un fond (repeating-linear-gradient) sur une bande trois
// fois plus large que la lentille, déplacée par transform ; les libellés sont un jeu FIXE de 7 éléments recyclés (seuls
// leur texte — nœud texte réutilisé — et leur transform changent).
// Régimes (D-SPEC §A.5) :
// - « suivi » : la poignée est tirée sur la réglette ; l'aiguille est verticalement sous le pointeur, les graduations
//   sont immobiles et sans libellés (aucun chiffre ne défile), l'en-tête donne l'instant exact de la borne ;
// - « affinage » : le pointeur est descendu dans la lentille ; la fenêtre est FIGÉE à l'entrée (l'instant est sous le
//   pointeur : aucun saut), l'aiguille suit le pointeur au pixel près, la fenêtre défile aux bords ;
// - « posée » (« Ajuster finement ») : la même lentille, dans le mode précis.
// Jamais de recentrage. Aria-hidden : l'information passe par les curseurs et les annonces.
import { LENS_EDGE_PX, keepVisible, lensSpan } from "../shared/timelens.ts";
import { formatInstantCourt, formatLentille } from "../shared/timecode.ts";
import type { Edge } from "../shared/extrait.ts";
import { el, reducedMotion, setAttr, setData, textEl } from "./dom.ts";
import { X } from "./texts.ts";

export type LensMode = "suivi" | "affinage" | "pose";

const LABELS = 7;
/** Rembourrage horizontal de la bande dans la lentille (px), comme la piste de la réglette. */
export const LENS_PAD_PX = 16;
/** Courbe du ressort « doux » (C-PLAN §B.3) ramenée à 240 ms, et courbe « out ». */
const DOUX = [0, 0.082, 0.247, 0.424, 0.58, 0.705, 0.8, 0.869, 0.916, 0.948, 0.969, 0.982, 1];
const OUT = (t: number): number => 1 - (1 - t) ** 3;
const doux = (t: number): number => {
  const f = Math.min(1, Math.max(0, t)) * (DOUX.length - 1);
  const i = Math.floor(f);
  return i >= DOUX.length - 1 ? 1 : DOUX[i]! + (DOUX[i + 1]! - DOUX[i]!) * (f - i);
};

export class Lens {
  readonly el: HTMLDivElement;
  readonly #doc: Document;
  readonly #edgeEl: HTMLSpanElement;
  readonly #valEl: HTMLSpanElement;
  readonly #band: HTMLDivElement;
  readonly #strip: HTMLDivElement;
  readonly #labels: HTMLSpanElement[];
  readonly #labelText: string[];
  readonly #needle: HTMLDivElement;
  readonly #outL: HTMLDivElement;
  readonly #outR: HTMLDivElement;
  readonly #tip: HTMLSpanElement;
  #durationMs = 0;
  #hours = false;
  #frameMs: number | null = null;
  #span = 4_000;
  #bandW = 0;
  #msPerPx = 1;
  #minorMs = 100;
  /** Début de la fenêtre (ms) ; null en « suivi » (graduations immobiles, sans temps). */
  #w0: number | null = null;
  #edge: Edge = "start";
  #mode: LensMode | null = null;
  #visible = false;
  #hideTimer: ReturnType<typeof setTimeout> | null = null;
  #tweenRaf = 0;
  #lastNeedle = 0;
  #hovered = false;
  #onHidden: (() => void) | null = null;
  /** Centrage demandé avant que la largeur de la bande ne soit connue. */
  #pendingCenter: number | null = null;

  constructor(doc: Document) {
    this.#doc = doc;
    this.#edgeEl = textEl(doc, "span", "tl-lens-edge", X.lensStart);
    this.#valEl = textEl(doc, "span", "tl-lens-val");
    this.#strip = el(doc, "div", { class: "tl-lens-strip" });
    this.#labels = [];
    this.#labelText = [];
    for (let i = 0; i < LABELS; i++) {
      this.#labels.push(textEl(doc, "span", "tl-lens-lab"));
      this.#labelText.push("");
    }
    this.#outL = el(doc, "div", { class: "tl-lens-out tl-lens-out-l" });
    this.#outR = el(doc, "div", { class: "tl-lens-out tl-lens-out-r" });
    this.#needle = el(doc, "div", { class: "tl-lens-needle" });
    this.#tip = el(doc, "span", { class: "tl-lens-tip", text: X.lensTip });
    const labs = el(doc, "div", { class: "tl-lens-labs" }, this.#labels);
    this.#band = el(doc, "div", { class: "tl-lens-band" }, [this.#strip, labs, this.#outL, this.#outR, this.#tip, this.#needle]);
    this.el = el(doc, "div", { class: "tl-lens", attrs: { "aria-hidden": "true", "data-floating": "" } }, [
      el(doc, "div", { class: "tl-lens-head" }, [this.#edgeEl, this.#valEl]),
      this.#band,
    ]);
    this.el.addEventListener("pointerenter", () => { this.#hovered = true; if (this.#visible && this.#mode !== "pose") this.#cancelHide(); });
    this.el.addEventListener("pointerleave", () => {
      this.#hovered = false;
      if (this.#visible && this.#mode !== "pose" && this.el.hasAttribute("data-floating") && !this.el.hasAttribute("data-held")) this.hideAfter(400);
    });
    try {
      // Largeur de la bande gardée à jour sans relire la mise en page pendant un geste.
      new ResizeObserver((entries) => {
        for (const e of entries) {
          const w = e.contentRect.width;
          if (w > 0 && Math.abs(w - this.#bandW) > 0.5) this.setBandWidth(w);
        }
      }).observe(this.#band);
    } catch {
      /* pas d'observateur : mesure à l'affichage */
    }
  }

  // ---- réglages ----------------------------------------------------------------------------------
  setVideo(durationMs: number): void {
    this.#durationMs = Math.max(0, durationMs);
    this.#hours = durationMs >= 3_600_000;
    this.#span = lensSpan(durationMs || 1);
    this.#applyScale();
  }

  setFrame(frameMs: number | null): void {
    if (frameMs === this.#frameMs) return;
    this.#frameMs = frameMs;
    this.#applyScale();
  }

  /** Largeur utile de la bande (px), mesurée par l'appelant ou l'observateur. */
  setBandWidth(w: number): void {
    if (!(w > 0)) return;
    this.#bandW = w;
    this.#applyScale();
    if (this.#pendingCenter !== null) {
      const v = this.#pendingCenter;
      this.#pendingCenter = null;
      this.center(v);
      this.setNeedle(this.xOf(v));
    } else if (this.#w0 !== null) this.#paintWindow();
  }

  /** Millisecondes par pixel dans la lentille. */
  get scale(): number {
    return this.#msPerPx;
  }

  get windowStart(): number | null {
    return this.#w0;
  }

  get width(): number {
    return this.#bandW;
  }

  get spanMs(): number {
    return this.#span;
  }

  get shownEdge(): Edge {
    return this.#edge;
  }

  get isVisible(): boolean {
    return this.#visible;
  }

  get isHovered(): boolean {
    return this.#hovered;
  }

  get currentMode(): LensMode | null {
    return this.#mode;
  }

  /** Abscisse de l'aiguille dans la bande (px). */
  get needleX(): number {
    return this.#lastNeedle;
  }

  #applyScale(): void {
    if (!(this.#bandW > 0)) return;
    this.#msPerPx = this.#span / this.#bandW;
    // Petites graduations : à chaque image si la cadence est connue et qu'une image fait au moins 4 px, sinon 100 ms.
    const f = this.#frameMs;
    this.#minorMs = f !== null && f >= 5 && f <= 200 && f / this.#msPerPx >= 4 ? f : 100;
    this.#strip.style.setProperty("--minor", `${(this.#minorMs / this.#msPerPx).toFixed(3)}px`);
    this.#strip.style.setProperty("--major", `${(1000 / this.#msPerPx).toFixed(3)}px`);
    this.#strip.style.width = `${Math.round(this.#bandW * 3)}px`;
  }

  // ---- affichage ---------------------------------------------------------------------------------
  /** Fait voir la lentille dans ce régime, pour cette borne. */
  show(mode: LensMode, edge: Edge, instant = false): void {
    this.#cancelHide();
    if (!this.#visible) setAttr(this.el, "data-instant", instant ? "" : null);
    this.#mode = mode;
    if (edge !== this.#edge) {
      this.#edge = edge;
      setData(this.#edgeEl, edge === "start" ? X.lensStart : X.lensEnd);
    }
    setAttr(this.el, "data-mode", mode);
    if (mode === "suivi") {
      this.#w0 = null;
      setAttr(this.el, "data-window", null);
    }
    if (!this.#visible) {
      this.#visible = true;
      setAttr(this.el, "data-on", "");
    }
  }

  /** Indication « Descends ici pour affiner » (trois premiers usages). */
  setTip(on: boolean): void {
    setAttr(this.el, "data-tip", on ? "" : null);
  }

  /** Lentille posée dans le mode précis (true) ou flottante sous la réglette (false). */
  setPosed(on: boolean): void {
    setAttr(this.el, "data-floating", on ? null : "");
    if (on) {
      this.#cancelHide();
      this.#mode = "pose";
      setAttr(this.el, "data-mode", "pose");
      this.#visible = true;
      setAttr(this.el, "data-on", "");
    }
  }

  get posed(): boolean {
    return !this.el.hasAttribute("data-floating");
  }

  /** Pointeur tenu dans la lentille (elle ne s'efface pas tant qu'il la tient). */
  setHeld(on: boolean): void {
    setAttr(this.el, "data-held", on ? "" : null);
  }

  /** Efface la lentille flottante après `ms` (fondu de 160 ms), sauf si le pointeur la survole. */
  hideAfter(ms: number, onHidden?: () => void): void {
    if (this.posed) return;
    this.#cancelHide();
    if (onHidden) this.#onHidden = onHidden;
    this.#hideTimer = setTimeout(() => {
      this.#hideTimer = null;
      if (this.#hovered && this.el.hasAttribute("data-floating") && this.#mode !== null) return; // reste saisissable
      this.hideNow();
    }, ms);
  }

  hideNow(): void {
    this.#cancelHide();
    this.cancelTween();
    if (this.posed) return;
    this.#visible = false;
    this.#mode = null;
    this.#w0 = null;
    setAttr(this.el, "data-on", null);
    setAttr(this.el, "data-window", null);
    setAttr(this.el, "data-held", null);
    const cb = this.#onHidden;
    this.#onHidden = null;
    cb?.();
  }

  #cancelHide(): void {
    if (this.#hideTimer !== null) clearTimeout(this.#hideTimer);
    this.#hideTimer = null;
  }

  // ---- peinture ----------------------------------------------------------------------------------
  /** Instant exact de la borne, dans l'en-tête. */
  setValue(ms: number): void {
    setData(this.#valEl, formatLentille(ms, { hours: this.#hours }));
  }

  /** Aiguille à l'abscisse `x` de la bande (px), bornée à la bande ; `extra` : déport élastique (px). */
  setNeedle(x: number, extra = 0): void {
    const w = this.#bandW || 1;
    const nx = Math.min(w, Math.max(0, x)) + extra;
    this.#lastNeedle = Math.min(w, Math.max(0, x));
    this.#needle.style.transform = `translateX(${nx.toFixed(2)}px)`;
  }

  /** Abscisse (px) de l'instant `ms` dans la fenêtre figée. */
  xOf(ms: number): number {
    return this.#w0 === null ? this.#lastNeedle : (ms - this.#w0) / this.#msPerPx;
  }

  /** Instant (ms) sous l'abscisse `x` de la bande, dans la fenêtre figée. */
  msAt(x: number): number {
    return (this.#w0 ?? 0) + x * this.#msPerPx;
  }

  /** Fige la fenêtre (entrée en affinage, lentille posée) : `valueMs` sous l'abscisse `x`. Aucun saut. */
  freeze(valueMs: number, x: number): void {
    this.cancelTween();
    this.#w0 = valueMs - Math.min(this.#bandW, Math.max(0, x)) * this.#msPerPx;
    setAttr(this.el, "data-window", "");
    this.#paintWindow();
  }

  /** Fenêtre posée de l'extérieur (défilement aux bords, molette, glissement animé). */
  setWindow(w0: number): void {
    this.#w0 = w0;
    setAttr(this.el, "data-window", "");
    this.#paintWindow();
  }

  /** Fenêtre centrée sur `valueMs` (ouverture du mode précis, premier réglage au clavier). */
  center(valueMs: number): void {
    this.cancelTween();
    if (!(this.#bandW > 0)) {
      this.#pendingCenter = valueMs;
      return;
    }
    this.setWindow(valueMs - this.#span / 2);
  }

  /** La fenêtre glisse juste assez pour garder `valueMs` visible (clavier, valeur posée de l'extérieur), en 120 ms. */
  reveal(valueMs: number, animate: boolean): void {
    if (this.#w0 === null) return this.center(valueMs);
    const to = keepVisible(this.#w0, valueMs, this.#msPerPx, this.#bandW, LENS_EDGE_PX);
    if (Math.abs(to - this.#w0) < 0.01) return;
    this.#glide(to, animate ? 120 : 0, OUT, valueMs);
  }

  /** Changement de borne, lentille posée : la bande glisse vers l'autre valeur (240 ms, ressort « doux »). */
  slideTo(valueMs: number, animate: boolean): void {
    const to = valueMs - this.#span / 2;
    if (this.#w0 === null) return this.setWindow(to);
    this.#glide(to, animate ? 240 : 0, doux, valueMs);
  }

  #glide(to: number, ms: number, ease: (t: number) => number, valueMs: number): void {
    this.cancelTween();
    const win = this.#doc.defaultView;
    if (!ms || !win || reducedMotion(win) || this.#w0 === null) {
      this.setWindow(to);
      this.setNeedle(this.xOf(valueMs));
      return;
    }
    const from = this.#w0;
    const t0 = win.performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      this.setWindow(from + (to - from) * ease(k));
      this.setNeedle(this.xOf(valueMs));
      this.#tweenRaf = k < 1 ? win.requestAnimationFrame(step) : 0;
    };
    this.#tweenRaf = win.requestAnimationFrame(step);
  }

  cancelTween(): void {
    if (this.#tweenRaf) this.#doc.defaultView?.cancelAnimationFrame(this.#tweenRaf);
    this.#tweenRaf = 0;
  }

  /** Graduations (fond déplacé), libellés recyclés, parties hors vidéo hachurées. */
  #paintWindow(): void {
    const w0 = this.#w0;
    if (w0 === null || !(this.#bandW > 0)) return;
    const k = this.#msPerPx;
    const t0 = Math.floor(w0 / 1000) * 1000;
    this.#strip.style.transform = `translateX(${((t0 - w0) / k).toFixed(2)}px)`;
    for (let i = 0; i < LABELS; i++) {
      const t = t0 + i * 1000;
      const x = (t - w0) / k;
      const lab = this.#labels[i]!;
      const inside = t >= 0 && t <= this.#durationMs && x >= -24 && x <= this.#bandW + 24;
      const text = inside ? formatInstantCourt(t, { hours: this.#hours }) : "";
      if (text !== this.#labelText[i]) {
        this.#labelText[i] = text;
        setData(lab, text);
      }
      lab.style.transform = `translateX(${x.toFixed(2)}px) translateX(-50%)`;
    }
    const x0 = (0 - w0) / k;
    const xd = (this.#durationMs - w0) / k;
    const w = this.#bandW;
    this.#outL.style.transform = `translateX(${(Math.min(w, Math.max(0, x0)) - w).toFixed(2)}px)`;
    this.#outR.style.transform = `translateX(${Math.min(w, Math.max(0, xd)).toFixed(2)}px)`;
  }
}
