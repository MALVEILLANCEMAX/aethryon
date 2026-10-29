// Textures des objets rétro, dessinées au pixel dans un canvas de 64 × 64 (filtrage au plus proche, comme sur
// PlayStation). Couleurs de la planche AETHRYON (ivoire, sable, obsidienne, graphite, or) et, pour le seul disque,
// un reflet de prisme très atténué. Bruit déterministe : la même image à chaque rendu (affiches statiques comprises).
// Rangée du bas (y 56 à 63) : palette d'aplats de 8 px, adressée par `swatch(i)`.
export const TEX = 64;

export const swatch = (i: number): readonly [number, number] => [(i * 8 + 4) / TEX, 60 / TEX];

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

function canvas(): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = c.height = TEX;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  return [c, g];
}

/** Aplat bruité (grain de matière) sur une zone. */
function grain(g: Ctx, x: number, y: number, w: number, h: number, base: readonly [number, number, number], amp: number, seed: number) {
  const r = rng(seed);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = (r() - 0.5) * amp;
    g.fillStyle = `rgb(${Math.round(base[0] + k)},${Math.round(base[1] + k)},${Math.round(base[2] + k)})`;
    g.fillRect(x + i, y + j, 1, 1);
  }
}

function palette(g: Ctx, colors: readonly string[]) {
  colors.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 8, 56, 8, 8); });
}

// Police bitmap 3 × 5 (seulement les signes utilisés).
const GLYPHS: Record<string, string> = {
  A: "010101111101101", E: "111100110100111", T: "111010010010010", H: "101101111101101", R: "110101110101101",
  Y: "101101010010010", O: "010101101101010", N: "110101101101101", M: "101111111101101", P: "110101110100100",
  "3": "111001011001111", "4": "101101111001001", ".": "000000000000010", "·": "000000010000000", K: "101110100110101",
  B: "110101110101110",
};

function text(g: Ctx, s: string, x: number, y: number, color: string) {
  g.fillStyle = color;
  let cx = x;
  for (const ch of s) {
    const bits = GLYPHS[ch];
    if (bits) for (let k = 0; k < 15; k++) if (bits[k] === "1") g.fillRect(cx + (k % 3), y + Math.floor(k / 3), 1, 1);
    cx += ch === " " ? 2 : 4;
  }
}

const IVORY = [244, 239, 231] as const;
const SAND = [226, 214, 194] as const;
const NIGHT = [24, 24, 26] as const;

/** Cube grec : pierre ivoire, frise de méandre incrustée d'or, au centre un sceau au « A » d'AETHRYON — jamais une
 *  chouette redessinée (la mascotte officielle ne se décline pas en 3D). */
export function stoneTexture(): HTMLCanvasElement {
  const [c, g] = canvas();
  grain(g, 0, 0, 56, 56, SAND, 16, 7);
  const gold = "#b8925c", goldLight = "#e3cda6", groove = "#8f7b5e";
  // cadre gravé : sillon sombre + filet or
  g.fillStyle = groove; g.fillRect(2, 2, 52, 1); g.fillRect(2, 53, 52, 1); g.fillRect(2, 2, 1, 52); g.fillRect(53, 2, 1, 52);
  g.fillStyle = gold; g.fillRect(3, 3, 50, 1); g.fillRect(3, 52, 50, 1); g.fillRect(3, 3, 1, 50); g.fillRect(52, 3, 1, 50);
  // méandre (clé grecque) sur le pourtour : motifs de 8 px
  const key = (x: number, y: number, rot: number) => {
    const pts: readonly (readonly [number, number])[] = [[0, 6], [0, 0], [6, 0], [6, 4], [2, 4], [2, 2], [4, 2]];
    g.fillStyle = gold;
    for (let k = 0; k < pts.length - 1; k++) {
      const [x0, y0] = pts[k]!, [x1, y1] = pts[k + 1]!;
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let s = 0; s <= n; s++) {
        let px = x0 + Math.sign(x1 - x0) * s, py = y0 + Math.sign(y1 - y0) * s;
        for (let r = 0; r < rot; r++) [px, py] = [6 - py, px];
        g.fillRect(x + px, y + py, 1, 1);
      }
    }
  };
  for (let i = 0; i < 5; i++) {
    key(7 + i * 9, 6, 0);
    key(7 + i * 9, 43, 2);
  }
  for (let i = 1; i < 4; i++) {
    key(6, 6 + i * 9, 3);
    key(43, 6 + i * 9, 1);
  }
  // sceau : disque graphite cerclé d'or, « A » d'AETHRYON en relief (7 × 7 px)
  for (let y = 16; y < 40; y++) for (let x = 16; x < 40; x++) {
    const d = Math.hypot(x - 27.5, y - 27.5);
    if (d < 11.6) { g.fillStyle = d > 10.4 ? gold : d > 9.6 ? groove : "#2a2a2e"; g.fillRect(x, y, 1, 1); }
  }
  const A = ["0011100", "0110110", "1100011", "1100011", "1111111", "1100011", "1100011"];
  A.forEach((row, j) => [...row].forEach((bit, i) => {
    if (bit === "1") { g.fillStyle = j === 0 || i === 0 ? goldLight : gold; g.fillRect(24 + i, 24 + j, 1, 1); }
  }));
  palette(g, [gold, "#5b4a33", goldLight, "#2a2a2e"]);
  return c;
}

/** Disquette : plastique obsidienne, étiquette ivoire avec le nom et le format, filet or. */
export function floppyTexture(label: string): HTMLCanvasElement {
  const [c, g] = canvas();
  grain(g, 0, 0, 64, 56, NIGHT, 7, 3);
  // étiquette (moitié basse de la face avant, u 0..1 → x 0..56 de la zone)
  grain(g, 7, 24, 42, 26, IVORY, 9, 11);
  g.fillStyle = "#d4af7c"; g.fillRect(7, 24, 42, 2);
  g.fillStyle = "#e2d8c9"; for (let y = 34; y < 48; y += 4) g.fillRect(10, y, 36, 1);
  text(g, "AETHRYON", 12, 29, "#141413");
  text(g, label, 12, 38, "#7a5f38");
  // encoche de protection et repère
  g.fillStyle = "#0b0b0c"; g.fillRect(3, 50, 3, 3); g.fillRect(51, 50, 3, 3);
  // dos : moyeu métallique
  palette(g, ["#2a2a2e", "#b9b4ab", "#7d786f", "#d9d1c4", "#3b3a3d"]);
  return c;
}

/** Disque compact : reflet de prisme atténué (or, ivoire, lavande, menthe) en anneaux, étiquette « MP3 ». */
export function discTexture(label: string): HTMLCanvasElement {
  const [c, g] = canvas();
  const r = rng(5);
  const stops: readonly (readonly [number, number, number])[] = [[212, 175, 124], [236, 226, 210], [176, 160, 214], [140, 200, 188], [212, 175, 124], [226, 196, 158], [196, 150, 112], [212, 175, 124]];
  for (let y = 0; y < 56; y++) for (let x = 0; x < 56; x++) {
    const dx = x - 27.5, dy = y - 27.5, d = Math.hypot(dx, dy) / 28;
    let t = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) * 2 + d * 1.6;
    t = ((t % 1) + 1) % 1;
    const f = t * (stops.length - 1), k = Math.floor(f), m = f - k;
    const a = stops[k]!, b = stops[Math.min(k + 1, stops.length - 1)]!;
    const shade = d > 0.94 ? 0.7 : 0.94;
    const noise = (r() - 0.5) * 10;
    const col = [0, 1, 2].map((i) => Math.round((a[i]! + (b[i]! - a[i]!) * m) * shade + noise));
    g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    g.fillRect(x, y, 1, 1);
  }
  // étiquette annulaire près du trou
  g.fillStyle = "#faf8f3";
  for (let y = 0; y < 56; y++) for (let x = 0; x < 56; x++) {
    const d = Math.hypot(x - 27.5, y - 27.5);
    if (d > 7 && d < 13) g.fillRect(x, y, 1, 1);
  }
  text(g, label, 22, 15, "#7a5f38");
  g.fillStyle = "#d4af7c";
  for (let y = 0; y < 56; y++) for (let x = 0; x < 56; x++) { const d = Math.hypot(x - 27.5, y - 27.5); if (d > 12.4 && d < 13.4) g.fillRect(x, y, 1, 1); }
  palette(g, ["#c9c3b8", "#8c867c"]);
  return c;
}

/** Sablier : laiton champagne (montants et coupelles), sable or, verre ivoire translucide. */
export function hourglassTexture(): HTMLCanvasElement {
  const [c, g] = canvas();
  // coupelles : anneaux concentriques gravés
  for (let y = 0; y < 56; y++) for (let x = 0; x < 56; x++) {
    const d = Math.hypot(x - 27.5, y - 27.5);
    const ring = Math.floor(d / 4) % 2 === 0;
    g.fillStyle = d > 26 ? "#7a5f38" : ring ? "#d4af7c" : "#b8925c";
    g.fillRect(x, y, 1, 1);
  }
  palette(g, ["#18181a", "#e3cda6", "#f4efe7", "#a8834f", "#d4af7c"]);
  return c;
}

/** Cookie du consentement (V3.5) : pâte dorée au grain irrégulier, bords plus cuits, quelques craquelures ; les
 *  pépites sont des volumes à part (aplats de la palette). Palette : [0] chant cuit, [1] chocolat, [2] chocolat au
 *  reflet, [3] dessous plus clair. Seul objet « gourmand » du site : identité PS1, couleurs biscuit sobres. */
export function cookieTexture(): HTMLCanvasElement {
  const [c, g] = canvas();
  grain(g, 0, 0, 56, 56, [201, 146, 84], 30, 31);
  const r = rng(77);
  for (let j = 0; j < 56; j++) for (let i = 0; i < 56; i++) {
    const d = Math.hypot(i - 27.5, j - 27.5) / 28;
    // bord plus cuit, en anneau irrégulier
    if (d > 0.74) { g.fillStyle = `rgba(112,62,24,${Math.min(0.6, (d - 0.74) * 2.4 + r() * 0.08).toFixed(3)})`; g.fillRect(i, j, 1, 1); }
    // grains de cuisson
    if (r() < 0.04) { g.fillStyle = "rgba(124,74,32,.55)"; g.fillRect(i, j, 1, 1); }
    if (r() < 0.025) { g.fillStyle = "rgba(236,196,136,.6)"; g.fillRect(i, j, 1, 1); }
  }
  // craquelures : quelques traits sombres courts
  g.fillStyle = "rgba(118,70,30,.75)";
  for (const [x, y, w, hgt] of [[14, 20, 6, 1], [19, 21, 1, 3], [34, 14, 1, 5], [35, 18, 4, 1], [24, 38, 7, 1], [30, 39, 1, 3], [40, 32, 1, 4], [12, 33, 4, 1]] as const) g.fillRect(x, y, w, hgt);
  palette(g, ["#9a6232", "#3a2116", "#61392a", "#d7a96b", "#b47a40", "#2b1810", "#c08450", "#7a4a26"]);
  return c;
}
