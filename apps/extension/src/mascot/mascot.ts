// MASCOTTE AETHRYON de l'extension — FRONTIÈRE DE MODULE.
// Tout ce qui dessine ou anime la mascotte vit ici ; le reste de l'extension ne connaît que cette API :
//   const m = createMascot(document, { size: 72 });   // m.el : élément à insérer
//   m.setState("processing");  m.setState("success", { replay: true });  m.destroy();
// Aujourd'hui la mascotte EST la tête maître (comme sur le site : web/src/ui/brand/AethryonMascot.tsx), animée
// par ses propres éléments — respiration, clignement, regard, inclinaison, petit rebond —, sans corps, sans
// ailes, sans autre expression. Le futur kit « Astra » du propriétaire remplacera ces illustrations en
// changeant CE module seulement (même API, mêmes états).
//
// États, décidés par l'appelant à partir d'événements RÉELS (job, réponse du service worker), jamais d'une
// minuterie :
//   idle        respiration lente, clignement occasionnel (4 à 7 s), regard qui suit la souris ;
//   curious     tête inclinée, regard levé de côté (on attend quelque chose de l'utilisateur) ;
//   processing  regard qui balaie lentement (concentration), sans clignement ;
//   success     clin d'œil et petit rebond, rejoués à chaque setState("success", { replay: true }) ;
//   error       regard baissé, inclinaison interrogative.
// Décorative (aria-hidden) : l'état est toujours écrit en texte à côté. En pause hors écran ou page masquée ;
// immobile si l'utilisateur réduit les animations (feuille de style + aucun clignement ni regard animé).
// Animations : feuille de style partagée (popup.css, « Mascotte »), mêmes images-clés que le site.
import { owlSvg, type OwlSurface } from "../shared/owl.ts";

export type MascotState = "idle" | "curious" | "processing" | "success" | "error";
export const MASCOT_STATES: readonly MascotState[] = ["idle", "curious", "processing", "success", "error"];

export interface MascotOptions {
  /** Côté du carré réservé, en px. */
  size: number;
  state?: MascotState;
  /** Côté vers lequel la tête s'incline et regarde : -1 à gauche, 1 à droite. */
  look?: -1 | 1;
  /** Fond : « auto » = liseré champagne en thème clair, dessin exact en thème sombre. */
  surface?: OwlSurface;
}

export interface Mascot {
  readonly el: HTMLElement;
  readonly state: MascotState;
  setState(state: MascotState, opts?: { replay?: boolean }): void;
  destroy(): void;
}

/** Marge intérieure (unités) : 64 / (64 + 2 × 12,4) ≈ 72 % du carré pour la tête (place pour bouger). */
const PAD = 12.4;
/** Regard : décalage de 1,4 unité au plus (sur 64), comme OwlMark. */
const GAZE = 1.4;

function lookOf(state: MascotState, side: -1 | 1): { x: number; y: number } | null {
  if (state === "curious") return { x: 0.6 * side, y: -0.7 };
  if (state === "success") return { x: 0, y: -0.35 };
  if (state === "error") return { x: 0.25 * side, y: 0.9 };
  return null;
}

export function createMascot(doc: Document, o: MascotOptions): Mascot {
  const win = doc.defaultView ?? window;
  const side = o.look ?? -1;
  let state: MascotState = o.state ?? "idle";
  const calm = (): boolean => {
    try {
      return win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  };

  const svg = owlSvg(doc, { size: o.size, pad: PAD, surface: o.surface ?? "auto", className: "mascot-owl-svg" });
  const eyes = svg.querySelector<SVGGElement>(".owl-eyes");
  const motion = doc.createElement("span");
  motion.className = "mascot-owl-motion";
  motion.append(svg);
  const el = doc.createElement("span");
  el.className = "mascot-owl";
  el.setAttribute("aria-hidden", "true");
  el.dataset.look = String(side);
  el.style.width = `${o.size}px`;
  el.style.height = `${o.size}px`;
  el.append(motion);

  // ---- pause hors écran / page masquée ------------------------------------------------------------
  let onScreen = true;
  const live = (): boolean => onScreen && !doc.hidden;
  const syncPaused = () => {
    if (live()) delete el.dataset.paused;
    else el.dataset.paused = "true";
  };
  const io = typeof IntersectionObserver === "function"
    ? new IntersectionObserver(([e]) => {
      onScreen = !!e?.isIntersecting;
      syncPaused();
    }, { threshold: 0.01 })
    : null;
  io?.observe(el);
  const onVisibility = () => syncPaused();
  doc.addEventListener("visibilitychange", onVisibility);

  // ---- clignement (vrai mouvement des yeux, jamais en mouvement réduit) ----------------------------
  let blinkTimer = 0;
  let blinkEnd = 0;
  let winkTimer = 0;
  const blink = () => {
    if (calm()) return;
    svg.dataset.blink = "true";
    win.clearTimeout(blinkEnd);
    blinkEnd = win.setTimeout(() => { delete svg.dataset.blink; }, 240);
  };
  const scheduleBlink = () => {
    win.clearTimeout(blinkTimer);
    if (calm() || (state !== "idle" && state !== "curious")) return;
    blinkTimer = win.setTimeout(() => {
      if (live()) blink();
      scheduleBlink();
    }, 4_000 + Math.random() * 3_000);
  };

  // ---- regard : cible imposée par l'état, sinon la souris (état « idle ») ---------------------------
  const setGaze = (x: number, y: number) => {
    if (eyes) eyes.style.translate = calm() ? "" : `${(x * GAZE).toFixed(2)}px ${(y * GAZE * 0.7).toFixed(2)}px`;
  };
  let frame = 0;
  const onPointer = (e: PointerEvent) => {
    if (frame || state !== "idle" || !live()) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      const r = svg.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 320);
      setGaze((dx / d) * k, (dy / d) * k);
    });
  };
  let following = false;
  const syncFollow = () => {
    let fine = false;
    try {
      fine = win.matchMedia("(hover: hover) and (pointer: fine)").matches;
    } catch { /* inconnu */ }
    const want = state === "idle" && !calm() && fine;
    if (want === following) return;
    following = want;
    if (want) win.addEventListener("pointermove", onPointer, { passive: true });
    else win.removeEventListener("pointermove", onPointer);
  };

  const apply = (replay: boolean) => {
    el.dataset.state = state;
    const target = lookOf(state, side);
    if (target) setGaze(target.x, target.y);
    else if (eyes) eyes.style.translate = "";
    if (replay) {
      // Rejoue l'animation de l'état (même état, nouvel événement réel : un autre fichier enregistré).
      motion.style.animation = "none";
      void motion.offsetWidth;
      motion.style.animation = "";
    }
    win.clearTimeout(winkTimer);
    if (state === "success" && !calm()) winkTimer = win.setTimeout(blink, 650);
    scheduleBlink();
    syncFollow();
  };
  apply(false);
  syncPaused();

  return {
    el,
    get state() {
      return state;
    },
    setState(next: MascotState, opts?: { replay?: boolean }) {
      if (next === state && !opts?.replay) return;
      state = next;
      apply(!!opts?.replay);
    },
    destroy() {
      win.clearTimeout(blinkTimer);
      win.clearTimeout(blinkEnd);
      win.clearTimeout(winkTimer);
      if (frame) win.cancelAnimationFrame(frame);
      win.removeEventListener("pointermove", onPointer);
      doc.removeEventListener("visibilitychange", onVisibility);
      io?.disconnect();
    },
  };
}
