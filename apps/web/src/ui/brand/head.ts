// Tête maître d'AETHRYON : GÉNÉRÉ depuis brand/master/aethryon-master.svg par
// brand/master/tools/export_web.py. Ne pas modifier à la main : modifier le maître, puis régénérer.
// Grille de 64 unités ; l'ordre de peinture fait partie du dessin (voir docs/IDENTITE-MAITRE.md).
export const HEAD = {
  shell: { d: "M8 23C8 10 20 7 32 7s24 3 24 16v15c0 12-13 17-24 23C21 55 8 50 8 38Z", fill: "#D7C2A5" },
  faceLeft: { d: "M32 28C22 13 9 14 8 30 6 48 21 47 32 57Z", fill: "#FAF8F3" },
  faceRight: { d: "M32 28C42 13 55 14 56 30 58 48 43 47 32 57Z", fill: "#F0E7D9" },
  eyeLeft: { d: "M13 26C23 24 28 29 28 37c-8 5-16 0-15-11Z", fill: "#101010" },
  eyeRight: { d: "M51 26C41 24 36 29 36 37c8 5 16 0 15-11Z", fill: "#101010" },
  glintLeft: { cx: 21, cy: 29, r: 1.8, fill: "#FAF8F3" },
  glintRight: { cx: 44, cy: 29, r: 1.8, fill: "#FAF8F3" },
  browLeft: { d: "M32 39C26 21 8 24 3 5 12 15 26 11 32 26Z", fill: "#E8D5B7" },
  browRight: { d: "M32 39C38 21 56 24 61 5 52 15 38 11 32 26Z", fill: "#E8D5B7" },
  browLine: { d: "M4 7C13 20 25 16 32 31 39 16 51 20 60 7", stroke: "#FAF8F3", strokeWidth: 1.4 },
  beakLeft: { d: "M32 36 27 42 32 51Z", fill: "#AC8150" },
  beakRight: { d: "M32 36 37 42 32 51Z", fill: "#DCC39B" },
} as const;

/** Petit logo, de 16 à 24 px (corrections optiques validées le 2026-10-11) : amandes des yeux +6 % autour de
 *  leur centre, reflets carrés alignés sur la grille de 16 px, ligne du front retirée. */
export const SMALL = {
  maxPx: 24,
  eyeScale: 1.06,
  eyeLeftCenter: [20.46, 32.25],
  eyeRightCenter: [43.54, 32.25],
  glintLeft: { x: 20, y: 28, width: 4, height: 4 },
  glintRight: { x: 44, y: 28, width: 4, height: 4 },
} as const;

/** Liseré champagne des fonds clairs (validé le 2026-10-11) : faces rognées de cette largeur le long de
 *  l'écusson, pour que la joue ivoire ne se fonde pas dans un fond ivoire. Silhouette inchangée. */
export const RIM = 0.45;
