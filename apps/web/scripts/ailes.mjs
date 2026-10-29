#!/usr/bin/env node
// Les deux ailes de l'accueil (2026-10-29) : un dessin procédural ORIGINAL d'aile de chouette (rémiges en éventail aux
// pointes arrondies, secondaires au bord festonné, couvertures), rendu en trame de points le long de chaque plume.
// Sortie : web/src/landing/accueil/ailes.gen.ts (tracés SVG « M x y h0 » : un point par extrémité arrondie, trois tailles
// pour le modelé, une couche d'or sur la pointe de quelques rémiges). Déterministe : relancer donne le même fichier.
//   node web/scripts/ailes.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../src/landing/accueil/ailes.gen.ts", import.meta.url));

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const deg = (a) => (a * Math.PI) / 180;
const lerp = (a, b, t) => a + (b - a) * t;

/** Une plume : base, direction (degrés, repère SVG : 0 = droite, 90 = bas), longueur, largeur, courbure, profil. */
function plume({ x, y, angle, long, large, courbe = 0, pointe = 0.5, couche, type, etroit = 1 }) {
  const d = [Math.cos(deg(angle)), Math.sin(deg(angle))];
  const n = [-d[1], d[0]];
  // Axe courbé (rachis) : décalage latéral en parabole.
  const axe = (t) => { const b = courbe * long * t * t; return [x + d[0] * long * t + n[0] * b, y + d[1] * long * t + n[1] * b]; };
  const tangente = (t) => { const e = 0.001; const a = axe(Math.max(0, t - e)), b = axe(Math.min(1, t + e)); const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  // Demi-largeur : étroite au calamus, pleine vers le milieu, pointe arrondie (quart d'ellipse).
  const affine = (t) => (etroit >= 1 || t < 0.45 ? 1 : lerp(1, etroit, Math.min(1, (t - 0.45) / 0.3) ** 1.4));
  const demi = (t) => affine(t) * demiBase(t);
  const demiBase = (t) => {
    if (t < 0) return 0;
    if (t < 0.12) return large * 0.5 * lerp(0.18, 0.62, t / 0.12);
    if (t < pointe) return large * 0.5 * lerp(0.62, 1, Math.sin(((t - 0.12) / (pointe - 0.12)) * Math.PI / 2));
    if (t <= 1) { const u = (t - pointe) / (1 - pointe); return large * 0.5 * Math.sqrt(Math.max(0, 1 - u * u)); }
    return 0;
  };
  // Contour (polygone) pour l'occultation.
  const contour = [];
  for (let i = 0; i <= 40; i++) { const t = i / 40; const p = axe(t), g = tangente(t), w = demi(t); contour.push([p[0] - g[1] * w, p[1] + g[0] * w]); }
  for (let i = 40; i >= 0; i--) { const t = i / 40; const p = axe(t), g = tangente(t), w = demi(t); contour.push([p[0] + g[1] * w, p[1] - g[0] * w]); }
  return { axe, tangente, demi, contour, long, large, couche, type };
}

function dedans(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** Distance d'un point au contour (pour laisser un fil vide entre deux plumes superposées). */
function distBord(pt, poly) {
  let m = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    const vx = bx - ax, vy = by - ay; const l2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((pt[0] - ax) * vx + (pt[1] - ay) * vy) / l2));
    m = Math.min(m, Math.hypot(pt[0] - (ax + vx * t), pt[1] - (ay + vy * t)));
  }
  return m;
}

/** L'aile déployée, vue de dessus : épaule coupée par le bord droit, coude, poignet ; rémiges en éventail vers la gauche
 *  et le bas (les doigts), secondaires et tertiaires pendantes (bord de fuite festonné), couvertures en rangs sur le bras.
 *  Rendu : des rangées de points parallèles au bras traversent toute l'aile (une surface, comme une gravure en pointillé) ;
 *  la silhouette naît où elles s'arrêtent, et un fil vide suit le bord de chaque plume du dessus. */
function aile({ graine, w, h, S, E, W, prim, sec, tert, orPrim, pas = 7.8, ecart = 7.3, vide = 2.9 }) {
  const r = rng(graine);
  const plumes = [];
  const seg = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  for (let i = 0; i < prim.n; i++) {
    const t = i / (prim.n - 1);
    const a = lerp(prim.angles[0], prim.angles[1], t);
    const base = [W[0] + t * 22, W[1] + t * 10];
    const prof = [0.82, 0.96, 1, 0.98, 0.93, 0.87, 0.81, 0.76, 0.72, 0.69, 0.67][i] ?? 0.67;
    const p = plume({ x: base[0], y: base[1], angle: a + (r() - 0.5) * 1.5, long: prim.long * prof, large: prim.large * (i === 0 ? 0.8 : 1),
      courbe: 0.05, pointe: 0.7, couche: 40 + i, type: "prim", etroit: i < 6 ? 0.5 : 0.75 });
    p.rang = i; plumes.push(p);
  }
  for (let i = 0; i < sec.n; i++) {
    const t = (i + 0.5) / sec.n;
    const b = seg(E, W, t);
    plumes.push(plume({ x: b[0], y: b[1] + 6, angle: lerp(sec.angles[0], sec.angles[1], t) + (r() - 0.5) * 2, long: lerp(sec.long[0], sec.long[1], t) * (0.97 + r() * 0.05),
      large: sec.large, courbe: 0.03, pointe: 0.62, couche: 60 + (sec.n - i), type: "sec" }));
  }
  for (let i = 0; i < tert.n; i++) {
    const t = (i + 0.5) / tert.n;
    const b = seg(S, E, t);
    plumes.push(plume({ x: b[0], y: b[1] + 6, angle: lerp(tert.angles[0], tert.angles[1], t) + (r() - 0.5) * 2, long: lerp(tert.long[0], tert.long[1], t),
      large: sec.large * 1.05, courbe: 0.02, pointe: 0.6, couche: 80 + (tert.n - i), type: "sec" }));
  }
  const bras = (t) => (t < 0.45 ? seg(S, E, t / 0.45) : seg(E, W, (t - 0.45) / 0.55));
  const angleSous = (t) => (t < 0.45 ? lerp(tert.angles[0], tert.angles[1], t / 0.45) : lerp(sec.angles[0], sec.angles[1], (t - 0.45) / 0.55));
  for (const [rang, n, long, large, dec] of [[0, 14, 96, 34, 4], [1, 17, 60, 26, -6]]) {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.45) / n;
      const b = bras(t);
      plumes.push(plume({ x: b[0], y: b[1] + dec, angle: angleSous(t) + 6 + (r() - 0.5) * 4, long: long * (0.94 + r() * 0.1), large, courbe: 0.02, pointe: 0.5,
        couche: 100 + rang * 40 + (n - i), type: rang === 1 ? "couv1" : "couv0" }));
    }
  }
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const a = lerp(prim.angles[0] - 6, prim.angles[1] + 10, t);
    plumes.push(plume({ x: W[0] + 10 + t * 26, y: W[1] - 4 + t * 8, angle: a, long: 118 - t * 18, large: 34, courbe: 0.04, pointe: 0.55, couche: 90 + i, type: "couvp" }));
  }
  plumes.sort((a, b) => b.couche - a.couche); // du dessus vers le dessous

  // Position le long d'une plume (0 au calamus, 1 à la pointe) : projection sur l'axe échantillonné.
  const tPlume = (p, pt) => { let best = 0, m = Infinity; for (let k = 0; k <= 30; k++) { const c = p.axe(k / 30); const d = Math.hypot(pt[0] - c[0], pt[1] - c[1]); if (d < m) { m = d; best = k / 30; } } return best; };
  const dirBras = [W[0] - S[0], W[1] - S[1]]; const lb = Math.hypot(...dirBras); const u = [dirBras[0] / lb, dirBras[1] / lb]; const nrm = [-u[1], u[0]];
  // nrm pointe vers le bas (bord de fuite) quand l'aile part vers la gauche.
  const versBas = nrm[1] < 0 ? [-nrm[0], -nrm[1]] : nrm;
  const classes = { s1: [], s2: [], s3: [], o1: [], o2: [] };
  const etendue = Math.hypot(w, h) * 1.2;
  for (let j = -60; j < 120; j++) {
    const o = [S[0] + versBas[0] * j * ecart, S[1] + versBas[1] * j * ecart];
    const dec = (j % 2) * pas * 0.5; // rangées en quinconce : la trame reste régulière
    for (let s = -etendue + dec; s < etendue; s += pas) {
      const pt = [o[0] + u[0] * s, o[1] + u[1] * s];
      if (pt[0] < -4 || pt[1] < -4 || pt[0] > w + 4 || pt[1] > h + 4) continue;
      const p = plumes.find((q) => dedans(pt, q.contour));
      if (!p) continue;
      if (distBord(pt, p.contour) < vide) continue;
      const t = tPlume(p, pt);
      const prof = Math.max(0, (pt[0] - S[0]) * versBas[0] + (pt[1] - S[1]) * versBas[1]);
      let l = 1 - 0.5 * Math.min(1, prof / 300);
      if (p.type === "prim" || p.type === "sec") l *= 0.9 + 0.1 * Math.cos(t * Math.PI * 2 * 3);
      if (p.type.startsWith("couv")) l *= 1.04;
      if (p.type === "couv1") l = Math.max(l, 0.84); // le bord d'attaque : une bande plus claire, la ligne du bras
      l *= t > 0.86 ? lerp(1, 0.82, (t - 0.86) / 0.14) : 1;
      l += (r() - 0.5) * 0.1;
      const or = p.type === "prim" && orPrim.includes(p.rang) && t > 0.74;
      const pt2 = [Math.round(pt[0] * 2) / 2, Math.round(pt[1] * 2) / 2];
      if (or) classes[l > 0.62 ? "o1" : "o2"].push(pt2);
      else classes[l > 0.8 ? "s1" : l > 0.6 ? "s2" : "s3"].push(pt2);
    }
  }
  const trace = (pts) => pts.map(([x, y]) => `M${x} ${y}h0`).join("");
  return { w, h, s1: trace(classes.s1), s2: trace(classes.s2), s3: trace(classes.s3), o1: trace(classes.o1), o2: trace(classes.o2),
    n: Object.values(classes).reduce((a, c) => a + c.length, 0) };
}

const A = aile({ graine: 29102026, w: 800, h: 560, S: [830, 70], E: [620, 44], W: [400, 92],
  prim: { n: 10, angles: [180, 108], long: 340, large: 46 }, sec: { n: 11, angles: [97, 108], long: [232, 222], large: 44 },
  tert: { n: 4, angles: [88, 95], long: [196, 214] }, orPrim: [1, 2, 3] });
const B = aile({ graine: 1409141105, w: 800, h: 560, S: [834, 74], E: [626, 48], W: [408, 98],
  prim: { n: 10, angles: [178, 106], long: 332, large: 45 }, sec: { n: 11, angles: [96, 107], long: [226, 216], large: 43 },
  tert: { n: 4, angles: [87, 94], long: [192, 208] }, orPrim: [2, 3] });

const fichier = `// Généré par web/scripts/ailes.mjs : ne pas modifier à la main. ${A.n} et ${B.n} points.
// Deux ailes de chouette originales en trame de points (tracés « M x y h0 » : un point par extrémité arrondie).
export interface Aile { w: number; h: number; s1: string; s2: string; s3: string; o1: string; o2: string }
export const AILE_HAUT: Aile = ${JSON.stringify({ w: A.w, h: A.h, s1: A.s1, s2: A.s2, s3: A.s3, o1: A.o1, o2: A.o2 })};
export const AILE_BAS: Aile = ${JSON.stringify({ w: B.w, h: B.h, s1: B.s1, s2: B.s2, s3: B.s3, o1: B.o1, o2: B.o2 })};
`;
writeFileSync(OUT, fichier);
console.log(`ailes : ${A.n} + ${B.n} points, ${(fichier.length / 1024).toFixed(1)} Kio`);
