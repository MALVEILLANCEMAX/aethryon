// Transport de la sélection vers « Exporter », à la manière du Finder : la sélection se soulève, une carte (vignette,
// nom du média, début, fin, durée) naît sur elle puis suit EXACTEMENT le pointeur ; la cible (le bouton « Exporter »
// du haut) s'éclaire en or champagne à l'approche et attire la carte, qui rapetisse ; un dépôt dessus ouvre le panneau
// d'export préréglé sur ce passage — rien ne démarre avant « Exporter ». Lâcher ailleurs, Échap, fenêtre quittée : la
// carte revient sur la sélection et s'efface, rien ne change (les temps de la sélection ne sont jamais touchés ici).
// Aucun rendu React pendant le mouvement : position en valeurs Motion (transform), éclat de la cible en variable CSS.
// Souris, doigt et stylet (événements de pointeur). Mouvement réduit : ni envol ni ressort, des fondus.
import { animate, motion, useMotionValue } from "motion/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useCalm } from "../lib/hooks.ts";
import type { Storyboard } from "./api.ts";
import { spanLabel, timecode } from "./format.ts";
import { IconArrowRight } from "./icons.tsx";
import { drawTile, sprite as loadSprite } from "./thumbs.ts";

export interface DragStart { x: number; y: number; from: DOMRect; pointerId: number }

const W = 208, H = 154;
/** Rayon d'attraction autour de la cible (px) et distance où le dépôt est « armé ». */
const PULL_R = 190, ARM_R = 72;
/** Envol : la carte quitte la sélection et rejoint le pointeur en 120 ms, puis le suit sans délai. */
const LIFT_MS = 120;

export function DragExport({ start, span, title, board, boardUrl, target, container, onDrop, onCancel }: {
  start: DragStart;
  span: { start: number; end: number };
  /** Nom du média (la carte le montre, comme le Finder montre le nom du fichier). */
  title: string;
  board: Storyboard | null;
  boardUrl: string | null;
  /** La cible (bouton « Exporter ») ; son rectangle est relu au départ et au redimensionnement. */
  target(): HTMLElement | null;
  container: HTMLElement | null;
  onDrop(): void;
  onCancel(): void;
}) {
  const calm = useCalm();
  const cv = useRef<HTMLCanvasElement>(null);
  const card = useRef<HTMLDivElement>(null);
  // Point de départ : le centre de la sélection (la carte naît sur elle).
  const homeX = start.from.left + start.from.width / 2 - W / 2;
  const homeY = start.from.top + start.from.height / 2 - H / 2;
  const x = useMotionValue(homeX);
  const y = useMotionValue(homeY);
  const scale = useMotionValue(calm ? 1 : 0.9);
  const done = useRef(false);

  useEffect(() => {
    loadSprite(boardUrl, (img) => { if (cv.current) drawTile(cv.current, board, img, (span.start + span.end) / 2, { w: 192, h: 108 }); });
    if (!calm) void animate(scale, 1, { duration: 0.16, ease: [0.2, 0.8, 0.2, 1] });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("is-xdrag");
    const t0 = performance.now();
    let tr = target()?.getBoundingClientRect() ?? null;
    const remeasure = () => { tr = target()?.getBoundingClientRect() ?? null; };
    // La cible s'agrandit pendant le transport (« Déposer pour exporter ») : sa zone est relue à la fin de sa transition.
    const tgt = target();
    tgt?.addEventListener("transitionend", remeasure);
    const settle = window.setTimeout(remeasure, 300);
    window.addEventListener("resize", remeasure);
    let armed = false;
    const setPull = (v: number, arm: boolean) => {
      const el = target();
      if (!el) return;
      el.style.setProperty("--pull", v.toFixed(3));
      if (arm !== armed) {
        armed = arm;
        if (arm) el.dataset.armed = ""; else delete el.dataset.armed;
        if (arm && navigator.vibrate) try { navigator.vibrate(10); } catch { /* sans vibreur */ }
      }
    };
    /** Place la carte : sous le pointeur pendant l'envol (court fondu de position), exactement dessus ensuite. */
    const put = (px: number, py: number) => {
      const left = LIFT_MS - (performance.now() - t0);
      if (!calm && left > 8) {
        void animate(x, px, { duration: left / 1000, ease: [0.2, 0.8, 0.2, 1] });
        void animate(y, py, { duration: left / 1000, ease: [0.2, 0.8, 0.2, 1] });
      } else { x.stop(); y.stop(); x.set(px); y.set(py); }
    };
    put(start.x - W / 2, start.y - H * 0.62);
    const move = (e: PointerEvent) => {
      if (e.pointerId !== start.pointerId || done.current) return;
      let px = e.clientX - W / 2, py = e.clientY - H * 0.62;
      if (tr) {
        const cx = tr.left + tr.width / 2, cy = tr.top + tr.height / 2;
        const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
        const pull = Math.max(0, 1 - dist / PULL_R);
        // Attraction : la carte est tirée vers un point JUSTE SOUS la cible (le bouton reste visible), de plus en plus
        // fort à l'approche, et rapetisse un peu.
        const k = calm ? 0 : Math.min(1, pull * pull * 1.15);
        const ax = Math.min(window.innerWidth - W - 8, Math.max(8, cx - W / 2)), ay = tr.bottom + 10;
        px += (ax - px) * k;
        py += (ay - py) * k;
        if (!calm) scale.set(1 - 0.22 * pull);
        setPull(pull, dist < ARM_R || (e.clientX >= tr.left - 8 && e.clientX <= tr.right + 8 && e.clientY >= tr.top - 8 && e.clientY <= tr.bottom + 8));
      }
      put(px, py);
    };
    const finish = (drop: boolean) => {
      if (done.current) return;
      done.current = true;
      const el = target();
      root.classList.remove("is-xdrag");
      x.stop(); y.stop();
      if (drop && tr) {
        // Absorbée par la cible : la carte s'y pose et s'y fond, puis le panneau s'ouvre depuis le bouton.
        const cx = tr.left + tr.width / 2, cy = tr.top + tr.height / 2;
        if (el) { el.dataset.absorb = ""; }
        const go = calm ? { duration: 0.12 } : { type: "spring" as const, stiffness: 600, damping: 42 };
        void animate(x, cx - W / 2, go); void animate(y, cy - H / 2, go);
        void animate(scale, 0.22, { duration: calm ? 0.12 : 0.24, ease: [0.32, 0, 0.67, 0] });
        void animate(card.current!, { opacity: 0 }, { duration: calm ? 0.12 : 0.22, delay: calm ? 0 : 0.06 }).then(() => {
          if (el) { delete el.dataset.absorb; delete el.dataset.armed; el.style.removeProperty("--pull"); }
          onDrop();
        });
      } else {
        // Retour sur la sélection d'où elle était partie, puis effacement.
        if (el) { delete el.dataset.armed; el.style.removeProperty("--pull"); }
        const back = calm ? { duration: 0.1 } : { type: "spring" as const, stiffness: 420, damping: 36 };
        void animate(x, homeX, back);
        void animate(y, homeY, back);
        void animate(scale, calm ? 1 : 0.8, { duration: 0.2 });
        void animate(card.current!, { opacity: 0 }, { duration: calm ? 0.1 : 0.2, delay: calm ? 0 : 0.1 }).then(onCancel);
      }
    };
    const up = (e: PointerEvent) => { if (e.pointerId === start.pointerId) finish(armed); };
    const cancel = (e: PointerEvent) => { if (e.pointerId === start.pointerId) finish(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } };
    // Fenêtre quittée pendant le transport (autre application) : rien n'est déposé.
    const blur = () => finish(false);
    window.addEventListener("blur", blur);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    return () => {
      root.classList.remove("is-xdrag");
      window.clearTimeout(settle);
      tgt?.removeEventListener("transitionend", remeasure);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <motion.div ref={card} className="xg" style={{ x, y, scale }} aria-hidden="true" data-drag-card="">
      <canvas ref={cv} className="xg-thumb" />
      <p className="xg-name">{title}</p>
      <div className="xg-meta tabular">
        <span className="xg-tc">{timecode(span.start, 2)}<IconArrowRight size={12} />{timecode(span.end, 2)}</span>
        <b>{spanLabel(span.end - span.start)}</b>
      </div>
    </motion.div>,
    container ?? document.body,
  );
}
