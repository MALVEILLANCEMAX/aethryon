// Thème clair / sombre de la page hôte, pour accorder la commande AETHRYON à son environnement.
// Partie pure (couleurs CSS, luminance) testée par tests/unit/content-theme.test.ts ; la lecture du DOM
// (getComputedStyle) n'a lieu que dans detectPageTheme.

export type Theme = "light" | "dark";

export interface Rgba {
  r: number; // 0–255
  g: number;
  b: number;
  a: number; // 0–1
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function channel(token: string): number | null {
  const t = token.trim();
  if (t.endsWith("%")) {
    const v = Number.parseFloat(t);
    return Number.isFinite(v) ? clamp((v / 100) * 255, 0, 255) : null;
  }
  const v = Number(t);
  return t !== "" && Number.isFinite(v) ? clamp(v, 0, 255) : null;
}

function alpha(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const t = token.trim();
  if (t.endsWith("%")) {
    const v = Number.parseFloat(t);
    return Number.isFinite(v) ? clamp(v / 100, 0, 1) : null;
  }
  const v = Number(t);
  return t !== "" && Number.isFinite(v) ? clamp(v, 0, 1) : null;
}

/** Couleur CSS calculée (rgb()/rgba(), syntaxe moderne, #hex, transparent, color(srgb …)) ; null si inconnue. */
export function parseCssColor(input: string | null | undefined): Rgba | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (s === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (s === "black") return { r: 0, g: 0, b: 0, a: 1 };

  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    const h = hex[1] ?? "";
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = [...h].map((c) => Number.parseInt(c + c, 16));
      return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a: a === undefined ? 1 : a / 255 };
    }
    if (h.length === 6 || h.length === 8) {
      const v = (i: number) => Number.parseInt(h.slice(i, i + 2), 16);
      return { r: v(0), g: v(2), b: v(4), a: h.length === 8 ? v(6) / 255 : 1 };
    }
    return null;
  }

  const fn = /^(rgba?|color)\((.*)\)$/.exec(s);
  if (!fn) return null;
  const body = (fn[2] ?? "").trim();
  if (fn[1] === "color") {
    // color(srgb 0.1 0.2 0.3 / 0.5)
    const m = /^srgb\s+([^\s/]+)\s+([^\s/]+)\s+([^\s/]+)\s*(?:\/\s*([^\s]+))?$/.exec(body);
    if (!m) return null;
    const comp = [m[1], m[2], m[3]].map((x) => {
      const v = Number(x);
      return Number.isFinite(v) ? clamp(v * 255, 0, 255) : null;
    });
    const a = alpha(m[4]);
    if (comp.some((c) => c === null) || a === null) return null;
    return { r: comp[0]!, g: comp[1]!, b: comp[2]!, a };
  }
  // rgb(1, 2, 3) | rgba(1, 2, 3, .5) | rgb(1 2 3 / 50%)
  let parts: string[];
  let a: string | undefined;
  if (body.includes(",")) {
    parts = body.split(",");
    if (parts.length === 4) a = parts.pop();
  } else {
    const [main, al] = body.split("/");
    parts = (main ?? "").trim().split(/\s+/);
    a = al;
  }
  if (parts.length !== 3) return null;
  const [r, g, b] = parts.map(channel);
  const av = alpha(a);
  if (r === null || g === null || b === null || r === undefined || g === undefined || b === undefined || av === null) return null;
  return { r, g, b, a: av };
}

/** Luminance relative WCAG 2.x (0 = noir, 1 = blanc). */
export function relativeLuminance(c: Pick<Rgba, "r" | "g" | "b">): number {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** En dessous de ce seuil (≈ gris moyen perceptif, L* 50) le fond est considéré sombre. */
export const DARK_LUMINANCE = 0.18;

/**
 * Thème déduit d'une liste de couleurs de fond, de l'élément le plus proche au plus lointain
 * (ex. body puis html) : la première couleur suffisamment opaque décide.
 */
export function themeFromBackgrounds(colors: readonly (string | null | undefined)[], fallback: Theme = "light"): Theme {
  for (const raw of colors) {
    const c = parseCssColor(raw);
    if (!c || c.a < 0.5) continue;
    return relativeLuminance(c) < DARK_LUMINANCE ? "dark" : "light";
  }
  return fallback;
}

/** Thème de la page : attribut explicite (YouTube : html[dark]) sinon luminance du fond. */
export function detectPageTheme(doc: Document, opts: { darkAttribute?: string; extra?: (Element | null)[] } = {}): Theme {
  try {
    const html = doc.documentElement;
    if (opts.darkAttribute && html?.hasAttribute(opts.darkAttribute)) return "dark";
    const view = doc.defaultView;
    if (!view) return "light";
    const els = [doc.body, html, ...(opts.extra ?? [])].filter((e): e is Element => !!e);
    return themeFromBackgrounds(els.map((e) => view.getComputedStyle(e).backgroundColor));
  } catch {
    return "light";
  }
}
