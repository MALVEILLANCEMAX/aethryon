// Calculs de position (purs) : panneau flottant (bornage, hors écran, position par défaut) et popover
// (au-dessous ou au-dessus du bouton, sans sortir de la fenêtre). Testé par tests/unit/content-geometry.test.ts.

export interface Size {
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface Rect extends Point, Size {}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Le panneau dépasse-t-il de la fenêtre (même partiellement) ? */
export function isOffscreen(pos: Point, size: Size, viewport: Size): boolean {
  return !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || pos.x < 0 || pos.y < 0 || pos.x + size.width > viewport.width || pos.y + size.height > viewport.height;
}

export function clampToViewport(pos: Point, size: Size, viewport: Size, margin = 8): Point {
  return {
    x: Math.round(clamp(pos.x, margin, viewport.width - size.width - margin)),
    y: Math.round(clamp(pos.y, margin, viewport.height - size.height - margin)),
  };
}

/** Position par défaut : en bas à gauche, marge de 16 px. */
export function defaultPanelPosition(size: Size, viewport: Size, margin = 16): Point {
  return { x: margin, y: Math.round(Math.max(margin, viewport.height - size.height - margin)) };
}

/** Position enregistrée si elle tient entièrement dans la fenêtre, sinon position par défaut. */
export function resolvePanelPosition(saved: Point | null, size: Size, viewport: Size): { pos: Point; reset: boolean } {
  if (saved && !isOffscreen(saved, size, viewport)) return { pos: { x: Math.round(saved.x), y: Math.round(saved.y) }, reset: false };
  return { pos: defaultPanelPosition(size, viewport), reset: saved !== null };
}

export function placePopover(anchor: Rect, pop: Size, viewport: Size, gap = 8, margin = 12): Point & { side: "below" | "above" } {
  const below = anchor.y + anchor.height + gap;
  const above = anchor.y - gap - pop.height;
  let side: "below" | "above" = "below";
  let y = below;
  if (below + pop.height > viewport.height - margin) {
    if (above >= margin) {
      side = "above";
      y = above;
    } else {
      y = clamp(viewport.height - margin - pop.height, margin, viewport.height - margin - pop.height);
    }
  }
  const x = clamp(anchor.x + anchor.width / 2 - pop.width / 2, margin, viewport.width - margin - pop.width);
  return { x: Math.round(x), y: Math.round(y), side };
}
