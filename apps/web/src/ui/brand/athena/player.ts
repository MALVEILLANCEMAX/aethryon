// Animation de la chouette vectorielle — sans React (utilisé par AthenaOwl.tsx et par les pages statiques
// de la marque). Ne modifie QUE des attributs transform et opacity des groupes [data-rig] du SVG, calculés
// par rigTransforms (geometry.ts) : une seule géométrie, un seul calcul, partout.
//
// Comportements :
//  - changement d'expression : ressort Motion presque critique (aucun rebond visible) ;
//  - clignements à intervalles humains (2,8 à 6,5 s, parfois doubles) : fermeture 70 ms, pause 35 ms,
//    ouverture 100 ms ; jamais pendant le sommeil (« closed ») ;
//  - respiration lente (4,2 s) ; petit saut et étincelle pour « success » (une fois) ;
//  - regard : cible imposée (look) ou pointeur (follow, souris uniquement) — tête ±22° et yeux ;
//  - en pause hors écran et onglet masqué ; IMMOBILE si l'utilisateur réduit les animations (état final
//    appliqué directement, ni clignement, ni respiration, ni suivi).
import { animate } from "motion";
import { rigTransforms, stateFor, type Expression, type Pose, type RigKey, type RigState } from "./geometry.ts";

export interface PlayerOptions {
  pose: Pose;
  expression?: Expression;
  /** Regard imposé, −1 → 1 (x : gauche → droite, y : haut → bas) : la tête et les yeux s'y tournent. */
  look?: { x: number; y: number } | null;
  /** Les yeux (et un peu la tête) suivent le pointeur (pointeur fin seulement). */
  follow?: boolean;
  blink?: boolean;
  breathe?: boolean;
  /** Mouvement réduit : aucune animation, état final immédiat. */
  reduced?: boolean;
}

type Num = Exclude<keyof RigState, never>;
const KEYS: Num[] = ["yaw", "pitch", "roll", "lookX", "lookY", "lid", "lidTilt", "lower", "cheek", "pupil", "ears", "wing", "breath", "hop", "sparkle"];
const SPRING = { type: "spring", stiffness: 190, damping: 27, mass: 1 } as const;

export class OwlPlayer {
  private readonly els = new Map<RigKey, Element[]>();
  private readonly written = new WeakMap<Element, string>();
  private state: RigState;
  private from: RigState;
  private to: RigState;
  private readonly fx = { blink: 0, hop: 0, breath: 0, fy: 0, fx: 0, gy: 0, gx: 0 };
  private raf = 0;
  private running = false;
  private onScreen = true;
  private blinkTimer = 0;
  private stopTransition?: () => void;
  private readonly cleanups: (() => void)[] = [];
  private readonly t0 = typeof performance !== "undefined" ? performance.now() : 0;

  constructor(svg: SVGSVGElement, private o: PlayerOptions) {
    svg.querySelectorAll("[data-rig]").forEach((el) => {
      const k = el.getAttribute("data-rig") as RigKey;
      const list = this.els.get(k) ?? [];
      list.push(el);
      this.els.set(k, list);
    });
    this.to = this.target();
    this.from = { ...this.to };
    this.state = { ...this.to };
    this.apply();
    if (o.reduced) return;
    // Pause hors écran et onglet masqué.
    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver(([e]) => { this.onScreen = !!e?.isIntersecting; this.sync(); }, { threshold: 0 });
      io.observe(svg);
      this.cleanups.push(() => io.disconnect());
    }
    const vis = () => this.sync();
    document.addEventListener("visibilitychange", vis);
    this.cleanups.push(() => document.removeEventListener("visibilitychange", vis));
    if (o.follow && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) {
      const move = (e: PointerEvent) => {
        const r = svg.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * 0.32);
        const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 420);
        this.fx.gx = (dx / d) * k;
        this.fx.gy = (dy / d) * k;
      };
      window.addEventListener("pointermove", move, { passive: true });
      this.cleanups.push(() => window.removeEventListener("pointermove", move));
    }
    this.scheduleBlink();
    this.sync();
  }

  /** État visé : expression + regard imposé. */
  private target(): RigState {
    const s = stateFor(this.o.expression ?? "neutral");
    const l = this.o.look;
    if (l) {
      s.yaw += l.x * 22;
      s.pitch += l.y * 9;
      s.lookX = Math.max(-1, Math.min(1, s.lookX + l.x * 0.9));
      s.lookY = Math.max(-1, Math.min(1, s.lookY + l.y * 0.9));
    }
    return s;
  }

  update(next: Partial<PlayerOptions>) {
    const prevExpr = this.o.expression;
    this.o = { ...this.o, ...next };
    if (next.expression === undefined && next.look === undefined) return;
    this.to = this.target();
    if (this.o.reduced) { this.state = { ...this.to }; this.apply(); return; }
    this.from = { ...this.state };
    this.stopTransition?.();
    const ctrl = animate(0, 1, { ...SPRING, onUpdate: (p: number) => {
      for (const k of KEYS) this.state[k] = this.from[k] + (this.to[k] - this.from[k]) * p;
    } });
    this.stopTransition = () => ctrl.stop();
    if (this.o.expression === "success" && prevExpr !== "success") {
      animate(0, [0, 1, 0], { duration: 0.56, times: [0, 0.42, 1], ease: ["easeOut", "easeIn"], onUpdate: (v: number) => { this.fx.hop = v * 9; } });
    }
    this.sync();
  }

  private scheduleBlink() {
    if (this.o.blink === false) return;
    const wait = 2800 + Math.random() * 3700;
    this.blinkTimer = window.setTimeout(() => {
      if (this.running && this.o.expression !== "closed") {
        this.blinkOnce();
        if (Math.random() < 0.18) window.setTimeout(() => this.blinkOnce(), 260);
      }
      this.scheduleBlink();
    }, wait);
  }
  /** Clignement unique demandé par la page (vrai événement, ex. première conversion) ; aucun en mouvement réduit. */
  wink() {
    if (!this.o.reduced) this.blinkOnce();
  }
  private blinkOnce() {
    animate(0, [0, 1, 1, 0], { duration: 0.205, times: [0, 0.34, 0.51, 1], ease: "easeInOut", onUpdate: (v: number) => { this.fx.blink = v; } });
  }

  private sync() {
    const run = !this.o.reduced && this.onScreen && !document.hidden;
    if (run && !this.running) { this.running = true; this.raf = requestAnimationFrame(this.tick); }
    if (!run && this.running) { this.running = false; cancelAnimationFrame(this.raf); }
  }
  private readonly tick = (now: number) => {
    if (!this.running) return;
    if (this.o.breathe !== false) this.fx.breath = (1 - Math.cos(((now - this.t0) / 4200) * Math.PI * 2)) / 2;
    // Suivi du pointeur : lissage exponentiel (τ ≈ 180 ms).
    const k = 1 - Math.exp(-16 / 180);
    this.fx.fx += (this.fx.gx - this.fx.fx) * k;
    this.fx.fy += (this.fx.gy - this.fx.fy) * k;
    this.apply();
    this.raf = requestAnimationFrame(this.tick);
  };

  private apply() {
    const s: RigState = { ...this.state };
    s.lid = Math.max(s.lid, this.fx.blink);
    s.lower = Math.max(s.lower, this.fx.blink);
    s.breath = this.fx.breath;
    s.hop = this.fx.hop;
    if (this.o.follow && !this.o.look) {
      s.yaw += this.fx.fx * 8;
      s.pitch += this.fx.fy * 4;
      s.lookX = Math.max(-1, Math.min(1, s.lookX + this.fx.fx * 0.85));
      s.lookY = Math.max(-1, Math.min(1, s.lookY + this.fx.fy * 0.85));
    }
    const out = rigTransforms(this.o.pose, s);
    for (const [key, list] of this.els) {
      const r = out[key];
      const tf = r?.transform ?? "";
      const op = r?.opacity === undefined ? "" : String(Math.round(r.opacity * 1000) / 1000);
      const sig = `${tf}|${op}`;
      for (const el of list) {
        if (this.written.get(el) === sig) continue;
        this.written.set(el, sig);
        if (tf) el.setAttribute("transform", tf); else el.removeAttribute("transform");
        if (op) el.setAttribute("opacity", op); else el.removeAttribute("opacity");
      }
    }
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.blinkTimer);
    this.stopTransition?.();
    for (const c of this.cleanups) c();
  }
}
