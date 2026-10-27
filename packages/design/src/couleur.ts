// Couleur : sRGB <-> OKLCH, luminance et contraste WCAG 2.x, APCA (information), mélange, résolution d'une
// luminosité qui atteint un seuil. Fonctions pures, sans dépendance (portées de la démonstration Égide v2,
// docs/design/demo-egide/src/js/00-couleur.js, sans changer les règles).

export type Rgb = readonly [number, number, number];
export type Oklch = readonly [number, number, number];

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const delin = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const borne = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** Vrai pour une couleur « #RRGGBB » (le seul format de couleur accepté dans un thème). */
export const estHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9A-Fa-f]{6}$/.test(v);

export function hexVersRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

export function rgbVersHex(rgb: Rgb): string {
  return "#" + rgb.map((c) => Math.round(borne(c, 0, 1) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function rgbVersOklch(rgb: Rgb): Oklch {
  const r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, Math.hypot(A, B), H];
}

export const hexVersOklch = (hex: string): Oklch => rgbVersOklch(hexVersRgb(hex));

function oklchVersRgbBrut(L: number, C: number, H: number): Rgb {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    delin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    delin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    delin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const dansGamut = (rgb: Rgb): boolean => rgb.every((c) => c >= -0.0005 && c <= 1.0005);

/** OKLCH -> « #RRGGBB ». Hors gamut sRGB : L et H gardés, chroma réduite par dichotomie (jamais de teinte qui dérive). */
export function oklch(L: number, C: number, H: number): string {
  L = borne(L, 0, 1);
  let rgb = oklchVersRgbBrut(L, C, H);
  if (!dansGamut(rgb)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (dansGamut(oklchVersRgbBrut(L, mid, H))) lo = mid; else hi = mid;
    }
    rgb = oklchVersRgbBrut(L, lo, H);
  }
  return rgbVersHex(rgb);
}

/** Luminance relative WCAG 2.x. */
export function luminance(hex: string): number {
  const [r, g, b] = hexVersRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Rapport de contraste WCAG 2.x (1 à 21). */
export function contraste(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Mélange sRGB : `part` de `a` dans `b` (comme color-mix(in srgb, a part, b)). */
export function melange(a: string, b: string, part: number): string {
  const x = hexVersRgb(a), y = hexVersRgb(b);
  return rgbVersHex([x[0] * part + y[0] * (1 - part), x[1] * part + y[1] * (1 - part), x[2] * part + y[2] * (1 - part)]);
}

/**
 * Cherche la luminosité L la plus proche de celle de `hex` (en allant vers `sens` : +1 plus clair, -1 plus sombre)
 * telle que la couleur ait au moins `seuil` de contraste contre TOUS les `fonds`. Teinte et chroma gardées.
 */
export function resoudre(hex: string, fonds: readonly string[], seuil: number, sens: 1 | -1): string {
  const [L0, C, H] = hexVersOklch(hex);
  const ok = (L: number) => fonds.every((f) => contraste(oklch(L, C, H), f) >= seuil);
  if (ok(L0)) return hex.toUpperCase();
  const bout = sens > 0 ? 1 : 0;
  if (!ok(bout)) return oklch(bout, C, H);
  let a = L0, b = bout;
  for (let i = 0; i < 22; i++) {
    const m = (a + b) / 2;
    if (ok(m)) b = m; else a = m;
  }
  return oklch(b, C, H);
}

/**
 * APCA (W3, version 0.0.98G-4g), donné À TITRE D'INFORMATION (THEME_ENGINE.md § 11) : Lc signé, positif pour un
 * texte sombre sur fond clair, négatif pour un texte clair sur fond sombre. Les seuils bloquants restent WCAG 2.x.
 */
export function apca(texte: string, fond: string): number {
  const y = (hex: string) => {
    const [r, g, b] = hexVersRgb(hex);
    const v = 0.2126729 * r ** 2.4 + 0.7151522 * g ** 2.4 + 0.072175 * b ** 2.4;
    return v > 0.022 ? v : v + (0.022 - v) ** 1.414;
  };
  const yt = y(texte), yf = y(fond);
  if (Math.abs(yf - yt) < 0.0005) return 0;
  if (yf > yt) {
    const s = (yf ** 0.56 - yt ** 0.57) * 1.14;
    return s < 0.1 ? 0 : (s - 0.027) * 100;
  }
  const s = (yf ** 0.65 - yt ** 0.62) * 1.14;
  return s > -0.1 ? 0 : (s + 0.027) * 100;
}
