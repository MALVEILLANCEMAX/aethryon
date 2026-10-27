// Jeu d'icônes « Égide » v2 (DESIGN_SYSTEM.md § 8) : grille 24, trait 1,6, extrémités et jointures rondes, aucun
// remplissage (sauf « theme »). Jeu MAISON : aucune marque tierce dessinée (ni logo de plateforme, ni logo Adobe) ;
// les plateformes et Premiere Pro sont nommées en toutes lettres à côté d'une icône générique. Les sept pictogrammes
// du catalogue des plateformes (video, vertical, post, image, direct, archive, onde) portent les identifiants de
// catalogue-plateformes.json (champ « icone »). Données pures : une icône = une liste de formes SVG, rendue par
// icone() (DOM, sans innerHTML), par le sprite genere/icones.svg ou par un composant React (exemple dans README.md).

export type FormeIcone = readonly ["path" | "circle" | "rect", Readonly<Record<string, string>>];

export const ICONES = {
  alerte: [["path", { d: "M12 4 21 19.5H3Z" }], ["path", { d: "M12 10v4M12 17h.01" }]],
  archive: [["rect", { x: "3.5", y: "4.5", width: "17", height: "4.5", rx: "1" }], ["path", { d: "M5 9v9.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4" }]],
  barre: [["circle", { cx: "12", cy: "12", r: "8.5" }], ["path", { d: "M8 12h8" }]],
  bas: [["path", { d: "m6 9.5 6 6 6-6" }]],
  biblio: [["rect", { x: "3.5", y: "3.5", width: "7", height: "7", rx: "1.5" }], ["rect", { x: "13.5", y: "3.5", width: "7", height: "7", rx: "1.5" }], ["rect", { x: "3.5", y: "13.5", width: "7", height: "7", rx: "1.5" }], ["rect", { x: "13.5", y: "13.5", width: "7", height: "7", rx: "1.5" }]],
  bulle: [["path", { d: "M5 17V7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5V17l-3-2H7.5" }], ["path", { d: "M9.5 10.5v1M14.5 10.5v1" }]],
  cadenas: [["rect", { x: "5", y: "10.5", width: "14", height: "10", rx: "2" }], ["path", { d: "M8 10.5V8a4 4 0 0 1 8 0v2.5" }]],
  cherche: [["circle", { cx: "11", cy: "11", r: "6" }], ["path", { d: "m20 20-4.5-4.5" }]],
  chevron: [["path", { d: "m9.5 6 6 6-6 6" }]],
  chutier: [["rect", { x: "3.5", y: "4", width: "17", height: "16", rx: "2" }], ["path", { d: "M3.5 9h17M8 13.5h4" }]],
  ciseaux: [["circle", { cx: "6", cy: "7", r: "2.5" }], ["circle", { cx: "6", cy: "17", r: "2.5" }], ["path", { d: "M8 8.5 20 16M8 15.5 20 8" }]],
  coller: [["rect", { x: "5.5", y: "5", width: "13", height: "15.5", rx: "2" }], ["path", { d: "M9 5V3.5h6V5M9 11h6M9 15h4" }]],
  compte: [["circle", { cx: "12", cy: "8.5", r: "3.5" }], ["path", { d: "M5 19.5a7 7 0 0 1 14 0" }]],
  convertir: [["path", { d: "M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" }]],
  copier: [["rect", { x: "8.5", y: "8.5", width: "11", height: "11", rx: "2" }], ["path", { d: "M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" }]],
  croix: [["path", { d: "M7 7l10 10M17 7 7 17" }]],
  debut: [["path", { d: "M10 5H7v14h3M12 12h7M16 9l3 3-3 3" }]],
  direct: [["circle", { cx: "12", cy: "12", r: "2" }], ["path", { d: "M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" }]],
  dossier: [["path", { d: "M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" }]],
  droits: [["path", { d: "M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7.5 3.5Z" }], ["path", { d: "m9 13.5 2 2 4-4" }]],
  ecouter: [["path", { d: "M4 14v-2a8 8 0 0 1 16 0v2" }], ["rect", { x: "3.5", y: "13.5", width: "4", height: "6", rx: "1.5" }], ["rect", { x: "16.5", y: "13.5", width: "4", height: "6", rx: "1.5" }]],
  exporter: [["path", { d: "M12 14V4m0 0 4 4m-4-4-4 4M5 15.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.5" }]],
  extension: [["path", { d: "M9 4.5h4v2a1.5 1.5 0 0 0 3 0v-2h3.5v5h-2a1.5 1.5 0 0 0 0 3h2v7H13v-2a1.5 1.5 0 0 0-3 0v2H4.5v-7h2a1.5 1.5 0 0 0 0-3h-2v-5Z" }]],
  fenetre: [["rect", { x: "3", y: "4", width: "18", height: "13", rx: "2" }], ["path", { d: "M9 20h6M12 17v3" }]],
  fichier: [["path", { d: "M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7.5 3.5ZM14 3.5V8h4" }]],
  fil: [["circle", { cx: "6", cy: "5.5", r: "2" }], ["circle", { cx: "6", cy: "18.5", r: "2" }], ["path", { d: "M6 7.5v9M11 5.5h9M11 12h7M11 18.5h9" }], ["circle", { cx: "6", cy: "12", r: "1" }]],
  fin: [["path", { d: "M14 5h3v14h-3M12 12H5M8 9l-3 3 3 3" }]],
  flux: [["path", { d: "M5 5a14 14 0 0 1 14 14M5 11a8 8 0 0 1 8 8" }], ["path", { d: "M6 18h.01" }]],
  gif: [["rect", { x: "3", y: "5", width: "18", height: "14", rx: "2" }], ["path", { d: "M8 12h2v2.5H7.5v-5H10M13 9.5v5M16 14.5v-5h2.5M16 12h2" }]],
  grille: [["rect", { x: "4", y: "4", width: "7", height: "7", rx: "1" }], ["rect", { x: "13", y: "4", width: "7", height: "7", rx: "1" }], ["rect", { x: "4", y: "13", width: "7", height: "7", rx: "1" }], ["rect", { x: "13", y: "13", width: "7", height: "7", rx: "1" }]],
  horloge: [["circle", { cx: "12", cy: "12", r: "8.5" }], ["path", { d: "M12 7.5V12l3 2" }]],
  image: [["rect", { x: "3.5", y: "5", width: "17", height: "14", rx: "2" }], ["circle", { cx: "9", cy: "10", r: "1.5" }], ["path", { d: "m4 18 5-5 3.5 3.5 2.5-2.5 5 4" }]],
  importer: [["path", { d: "M12 4v10m0 0 4-4m-4 4-4-4M5 15.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.5" }]],
  info: [["circle", { cx: "12", cy: "12", r: "8.5" }], ["path", { d: "M12 11v5M12 8h.01" }]],
  interdit: [["circle", { cx: "12", cy: "12", r: "8.5" }], ["path", { d: "m6 6 12 12" }]],
  lecture: [["path", { d: "M8 5.5v13l10.5-6.5Z" }]],
  lien: [["path", { d: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" }]],
  liste: [["path", { d: "M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" }]],
  menu: [["path", { d: "M4 7h16M4 12h16M4 17h16" }]],
  musique: [["circle", { cx: "12", cy: "12", r: "8.5" }], ["circle", { cx: "12", cy: "12", r: "2.5" }], ["path", { d: "M12 3.5a8.5 8.5 0 0 1 8.5 8.5" }]],
  navigateur: [["rect", { x: "3", y: "5", width: "18", height: "14", rx: "2" }], ["path", { d: "M3 9h18M6 7h.01M8.5 7h.01" }]],
  oeil: [["path", { d: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" }], ["circle", { cx: "12", cy: "12", r: "2.5" }]],
  ok: [["path", { d: "m5 12.5 4.5 4.5L19 7.5" }]],
  onde: [["path", { d: "M4 11v2M8 8v8M12 5v14M16 9v6M20 11v2" }]],
  ouvrir: [["path", { d: "M14 5h5v5M19 5l-8 8M17 14v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V8.5A1.5 1.5 0 0 1 6.5 7H10" }]],
  partager: [["path", { d: "M12 15V4m0 0L8.5 7.5M12 4l3.5 3.5M8 11H6.5A1.5 1.5 0 0 0 5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H16" }]],
  pause: [["path", { d: "M9 6v12M15 6v12" }]],
  plus: [["path", { d: "M12 5v14M5 12h14" }]],
  post: [["rect", { x: "4", y: "4", width: "16", height: "16", rx: "2" }], ["path", { d: "M8 9h8M8 13h8M8 17h5" }]],
  reglages: [["path", { d: "M4 7h9M17 7h3M4 17h3M11 17h9" }], ["circle", { cx: "15", cy: "7", r: "2" }], ["circle", { cx: "9", cy: "17", r: "2" }]],
  retour: [["path", { d: "M5 12a7 7 0 1 0 2-5M5 4v4h4" }]],
  son: [["path", { d: "M9 18V6l10-2v12" }], ["circle", { cx: "6.5", cy: "18", r: "2.5" }], ["circle", { cx: "16.5", cy: "16", r: "2.5" }]],
  telephone: [["rect", { x: "7", y: "3", width: "10", height: "18", rx: "2.5" }], ["path", { d: "M11 18h2" }]],
  theme: [["circle", { cx: "12", cy: "12", r: "8.5" }], ["path", { d: "M12 3.5v17a8.5 8.5 0 0 0 0-17Z", fill: "currentColor", stroke: "none" }]],
  trier: [["path", { d: "M7 5v14m0 0-3-3m3 3 3-3M17 19V5m0 0-3 3m3-3 3 3" }]],
  vertical: [["rect", { x: "7", y: "3", width: "10", height: "18", rx: "2" }], ["path", { d: "m10.5 9.5 4 2.5-4 2.5Z" }]],
  video: [["rect", { x: "3", y: "6", width: "13", height: "12", rx: "2" }], ["path", { d: "m16 10 5-3v10l-5-3" }]],} as const satisfies Record<string, readonly FormeIcone[]>;

export type NomIcone = keyof typeof ICONES;
export const NOMS_ICONES = Object.keys(ICONES) as NomIcone[];
export const estIcone = (n: unknown): n is NomIcone => typeof n === "string" && Object.prototype.hasOwnProperty.call(ICONES, n);

/** Balisage SVG d'une icône (texte constant, sans donnée utilisateur) : sprite, pré-rendu, documentation. */
export function balisageIcone(nom: NomIcone): string {
  return ICONES[nom].map(([tag, a]) => `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("");
}

/** Sprite SVG de tout le jeu (symboles « eg-i-<nom> »). */
export function spriteIcones(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg">${NOMS_ICONES.map((n) => `<symbol id="eg-i-${n}" viewBox="0 0 24 24">${balisageIcone(n)}</symbol>`).join("")}</svg>\n`;
}
