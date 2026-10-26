// Panneau flottant de secours : affiché quand l'ancrage de la vidéo courante est introuvable (après un
// court délai) ou quand le réglage « panneau flottant » est actif. Petit, déplaçable à la souris, au
// doigt (événements pointer) et au clavier (flèches ; Début pour le replacer), position mémorisée dans
// settings.panelPosition et réinitialisée si elle sort de la fenêtre. Le popup reste utilisable dans
// tous les cas.
import { platformIcon } from "../../shared/icons.ts";
import { PLATFORM_LABEL } from "../../shared/urls.ts";
import type { Target } from "./adapter.ts";
import { Control, type ControlHooks } from "./control.ts";
import { h, isolateEvents, setAttr, setText } from "./dom.ts";
import { clampToViewport, defaultPanelPosition, isOffscreen, resolvePanelPosition, type Point, type Size } from "./geometry.ts";
import { PANEL_CSS } from "./styles.ts";
import { T } from "./strings.ts";
import type { Theme } from "./theme.ts";

export const PANEL_TAG = "aethryon-panel";

export interface PanelHooks extends ControlHooks {
  savePosition(p: Point | null): void;
}

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  origin: Point;
  el: Element;
}

export class FloatingPanel {
  readonly host: HTMLElement;
  private readonly hooks: PanelHooks;
  private readonly wrap: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly grip: HTMLButtonElement;
  private readonly info: HTMLDivElement;
  private readonly titleEl: HTMLSpanElement;
  private readonly slot: HTMLDivElement;
  private control: Control | null = null;
  private theme: Theme;
  private pos: Point | null = null;
  private drag: Drag | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private hiddenByFullscreen = false;
  private readonly onResize = () => this.keepInside();

  constructor(hooks: PanelHooks, theme: Theme) {
    this.hooks = hooks;
    this.theme = theme;
    const d = hooks.doc;
    this.host = d.createElement(PANEL_TAG);
    const root = this.host.attachShadow({ mode: "closed" });
    this.grip = h(d, "button", { class: "grip", attrs: { type: "button", "aria-label": T.panelMove, title: T.panelMove } });
    this.titleEl = h(d, "span", { class: "ptitle" });
    this.info = h(d, "div", { class: "info" }, [
      h(d, "span", { class: "kicker" }, [h(d, "span", { text: T.brand }), platformIcon(d, hooks.platform, 11, PLATFORM_LABEL[hooks.platform])]),
      this.titleEl,
    ]);
    this.slot = h(d, "div", { class: "slot" });
    this.panel = h(d, "div", { class: "panel", attrs: { role: "region", "aria-label": T.panelRegion } }, [this.grip, this.info, this.slot]);
    this.wrap = h(d, "div", { class: "aeth", attrs: { "data-theme": theme } }, [this.panel]);
    this.wrap.style.setProperty("--font", hooks.fontFamily);
    root.append(h(d, "style", { text: PANEL_CSS }), this.wrap);
    isolateEvents(this.host);

    // Déplacement (souris, stylet, doigt)
    const handles: HTMLElement[] = [this.grip, this.info];
    for (const el of handles) {
      el.addEventListener("pointerdown", (e) => this.onPointerDown(e, el));
      el.addEventListener("pointermove", (e) => this.onPointerMove(e));
      el.addEventListener("pointerup", (e) => this.onPointerUp(e));
      el.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    }
    // Déplacement au clavier
    this.grip.addEventListener("keydown", (e) => this.onKey(e));
  }

  /** Affiche le panneau pour cette vidéo (crée ou relie sa commande). */
  show(t: Target): void {
    if (!this.control || this.control.key !== t.key) {
      this.control?.destroy();
      this.control = new Control(this.hooks, t, "panel", this.theme);
      this.slot.replaceChildren(this.control.el);
    } else {
      this.control.setTarget(t);
    }
    setText(this.titleEl, t.media.title || t.context || T.panelFallbackTitle);
    if (!this.host.isConnected) {
      this.host.style.setProperty("visibility", "hidden", "important");
      this.hooks.doc.documentElement.appendChild(this.host);
      this.hooks.win.addEventListener("resize", this.onResize, { passive: true });
      this.applySaved(true);
      this.host.style.removeProperty("visibility");
    }
    this.syncHidden();
  }

  hide(): void {
    if (!this.host.isConnected && !this.control) return;
    this.control?.destroy();
    this.control = null;
    this.drag = null;
    this.hooks.win.removeEventListener("resize", this.onResize);
    this.host.remove();
  }

  closePopover(): void {
    this.control?.close();
  }

  setTheme(t: Theme): void {
    this.theme = t;
    setAttr(this.wrap, "data-theme", t);
    this.control?.setTheme(t);
  }

  setFullscreen(fs: boolean): void {
    this.hiddenByFullscreen = fs;
    this.syncHidden();
  }

  settingsChanged(): void {
    this.control?.settingsChanged();
    if (this.host.isConnected && !this.drag) this.applySaved(false);
  }

  destroy(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.hide();
  }

  // ---- position -------------------------------------------------------------------------------
  private size(): Size {
    const r = this.panel.getBoundingClientRect();
    return { width: Math.ceil(r.width) || 340, height: Math.ceil(r.height) || 58 };
  }

  private viewport(): Size {
    const doc = this.hooks.doc.documentElement;
    return { width: doc.clientWidth || this.hooks.win.innerWidth, height: doc.clientHeight || this.hooks.win.innerHeight };
  }

  private apply(p: Point): void {
    this.pos = p;
    this.host.style.setProperty("left", `${p.x}px`, "important");
    this.host.style.setProperty("top", `${p.y}px`, "important");
  }

  /** Position des réglages ; si elle sort de la fenêtre : position par défaut (et réglage effacé au premier affichage). */
  private applySaved(first: boolean): void {
    const saved = this.hooks.settings().panelPosition;
    if (!first && this.pos && saved && saved.x === this.pos.x && saved.y === this.pos.y) return;
    const { pos, reset } = resolvePanelPosition(saved, this.size(), this.viewport());
    this.apply(pos);
    if (reset && first) this.hooks.savePosition(null);
  }

  private keepInside(): void {
    if (!this.pos || this.drag) return;
    const size = this.size();
    const vp = this.viewport();
    if (isOffscreen(this.pos, size, vp)) this.apply(defaultPanelPosition(size, vp));
  }

  private scheduleSave(delay: number): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.pos) this.hooks.savePosition(this.pos);
    }, delay);
  }

  private onPointerDown(e: PointerEvent, el: Element): void {
    if (!e.isTrusted || e.button !== 0 || !this.pos) return;
    // Pas de preventDefault : il supprimerait le mousedown de compatibilité, donc la mise au point de la
    // poignée (le déplacement au clavier ne marcherait plus après un clic). La sélection de texte est
    // déjà empêchée en CSS (user-select: none) et le défilement tactile par touch-action: none.
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignoré */
    }
    this.drag = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origin: { ...this.pos }, el };
    this.panel.setAttribute("data-dragging", "");
  }

  private onPointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const next = { x: d.origin.x + (e.clientX - d.startX), y: d.origin.y + (e.clientY - d.startY) };
    this.apply(clampToViewport(next, this.size(), this.viewport()));
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null;
    this.panel.removeAttribute("data-dragging");
    try {
      d.el.releasePointerCapture(e.pointerId);
    } catch {
      /* ignoré */
    }
    if (this.pos && (this.pos.x !== d.origin.x || this.pos.y !== d.origin.y)) this.scheduleSave(0);
  }

  private onKey(e: KeyboardEvent): void {
    if (!e.isTrusted || !this.pos) return;
    const step = e.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      this.apply(clampToViewport({ x: this.pos.x + m[0], y: this.pos.y + m[1] }, this.size(), this.viewport()));
      this.scheduleSave(400);
    } else if (e.key === "Home") {
      e.preventDefault();
      this.apply(defaultPanelPosition(this.size(), this.viewport()));
      if (this.saveTimer !== null) clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.hooks.savePosition(null);
    }
  }

  private syncHidden(): void {
    if (this.host.hidden !== this.hiddenByFullscreen) this.host.hidden = this.hiddenByFullscreen;
    if (this.hiddenByFullscreen) this.control?.close();
  }
}
