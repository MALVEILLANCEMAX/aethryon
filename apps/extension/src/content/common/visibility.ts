// Vidéo « actuellement affichée » dans un fil (TikTok, X en mode panneau) : la plus visible.
// pickMostVisible est pur (tests/unit/content-visibility.test.ts) ; l'IntersectionObserver ne sert qu'à
// déclencher un nouvel examen quand la visibilité change (aucun travail à chaque événement scroll).

export interface VisibleSample {
  /** Surface visible dans la fenêtre (px²). */
  area: number;
  /** Distance entre le centre de l'élément et le centre de la fenêtre (départage). */
  centerDistance: number;
}

export function visibleSample(rect: { left: number; top: number; right: number; bottom: number }, viewport: { width: number; height: number }): VisibleSample {
  const w = Math.max(0, Math.min(rect.right, viewport.width) - Math.max(rect.left, 0));
  const h = Math.max(0, Math.min(rect.bottom, viewport.height) - Math.max(rect.top, 0));
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  return { area: w * h, centerDistance: Math.hypot(cx - viewport.width / 2, cy - viewport.height / 2) };
}

/** Élément le plus visible (surface), à égalité le plus proche du centre ; null si aucun n'est visible. */
export function pickMostVisible<T>(items: readonly T[], sample: (item: T) => VisibleSample, minArea = 1): T | null {
  let best: T | null = null;
  let bestS: VisibleSample | null = null;
  for (const it of items) {
    const s = sample(it);
    if (!(s.area >= minArea)) continue;
    if (!bestS) {
      best = it;
      bestS = s;
      continue;
    }
    const tol = Math.max(1, bestS.area * 0.001);
    if (s.area > bestS.area + tol || (Math.abs(s.area - bestS.area) <= tol && s.centerDistance < bestS.centerDistance)) {
      best = it;
      bestS = s;
    }
  }
  return best;
}

/** Plus visible parmi des éléments du DOM (lecture de getBoundingClientRect, appelée dans un rAF). */
export function mostVisibleElement<T extends Element>(els: readonly T[], win: Window): T | null {
  const vp = { width: win.innerWidth, height: win.innerHeight };
  return pickMostVisible(els, (el) => visibleSample(el.getBoundingClientRect(), vp));
}

/** Déclencheur : un IntersectionObserver qui signale les changements de visibilité des éléments suivis. */
export class VisibilityTrigger {
  private io: IntersectionObserver | null;
  private observed = new Set<Element>();

  constructor(onChange: () => void) {
    this.io = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(() => onChange(), { threshold: [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1] })
      : null;
  }

  sync(els: readonly Element[]): void {
    if (!this.io) return;
    const next = new Set(els);
    for (const e of this.observed) {
      if (!next.has(e)) {
        this.io.unobserve(e);
        this.observed.delete(e);
      }
    }
    for (const e of next) {
      if (!this.observed.has(e)) {
        this.io.observe(e);
        this.observed.add(e);
      }
    }
  }

  disconnect(): void {
    this.io?.disconnect();
    this.observed.clear();
  }
}
