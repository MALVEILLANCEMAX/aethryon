// Pictogrammes AETHRYON — SOURCE UNIQUE (proposition) : le composant React (icons.tsx) et l'export
// (scripts/export-owl-svgs.mjs → brand/icons/ui/*.svg) lisent ces données.
//
// Règles de construction (docs/BRAND-BOOK.md §Iconographie), tirées de la grammaire du symbole :
//  - grille 24 × 24, zone utile 3 → 21 (marge 2–3) ; trait 1,6 ; extrémités et jonctions arrondies ;
//  - rayons : 2,5 pour les contenants (≈ 1/6 du côté), 1,2 pour les petits ; cercles pleins r = 9 ;
//  - angles : 45° (angle bas du bec) et 67,5° (pente des bords du bec) ; pas d'autres obliques ;
//  - pointes vives réservées aux directions (chevrons, flèches) et à la coche, comme le bec et les
//    aigrettes sont les seules pointes du symbole ; tout le reste est arrondi ;
//  - points : disques pleins r = 1 ; une seule épaisseur de trait par pictogramme ;
//  - couleur héritée (currentColor) ; jamais de logo de tiers (la bulle « discussion » n'est pas Discord).
// Aucune dépendance : données pures.

export type IconEl =
  | { d: string }
  | { circle: readonly [number, number, number]; fill?: boolean; opacity?: number }
  | { rect: readonly [number, number, number, number, number] };

/** Coche dessinée avec les angles du bec : court trait à 45°, long trait à 67,5° (pente du bec). */
const CHECK = (() => {
  const v: [number, number] = [10.2, 15.6];
  const a = (45 * Math.PI) / 180, b = (67.5 * Math.PI) / 180;
  const s: [number, number] = [v[0] - 4.4 * Math.cos(a), v[1] - 4.4 * Math.sin(a)];
  const e: [number, number] = [v[0] + 9.6 * Math.cos(b), v[1] - 9.6 * Math.sin(b)];
  const f = (p: [number, number]) => `${Math.round(p[0] * 100) / 100} ${Math.round(p[1] * 100) / 100}`;
  return `M${f(s)}L${f(v)}L${f(e)}`;
})();
/** Même coche, réduite et centrée dans un cercle de rayon 9. */
const CHECK_IN_CIRCLE = (() => {
  const v: [number, number] = [10.6, 15.2];
  const a = (45 * Math.PI) / 180, b = (67.5 * Math.PI) / 180;
  const s: [number, number] = [v[0] - 3.2 * Math.cos(a), v[1] - 3.2 * Math.sin(a)];
  const e: [number, number] = [v[0] + 7 * Math.cos(b), v[1] - 7 * Math.sin(b)];
  const f = (p: [number, number]) => `${Math.round(p[0] * 100) / 100} ${Math.round(p[1] * 100) / 100}`;
  return `M${f(s)}L${f(v)}L${f(e)}`;
})();

export const ICONS = {
  link: { label: "Lien", els: [{ d: "M10.6 13.4a3.6 3.6 0 0 0 5.1 0l2.9-2.9a3.6 3.6 0 0 0-5.1-5.1l-1.2 1.2" }, { d: "M13.4 10.6a3.6 3.6 0 0 0-5.1 0l-2.9 2.9a3.6 3.6 0 0 0 5.1 5.1l1.2-1.2" }] },
  paste: { label: "Coller", els: [{ d: "M8.5 5H7.5A2.5 2.5 0 0 0 5 7.5v11A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 16.5 5h-1" }, { rect: [8.5, 3, 7, 4, 1.2] }, { d: "M12 10v6.5M9.5 14l2.5 2.5 2.5-2.5" }] },
  copy: { label: "Copier", els: [{ rect: [8.5, 8.5, 12, 12, 2.5] }, { d: "M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" }] },
  video: { label: "Vidéo (MP4)", els: [{ rect: [3, 6, 12.5, 12, 2.5] }, { d: "M15.5 10.5l4.3-2.6a.8.8 0 0 1 1.2.7v6.8a.8.8 0 0 1-1.2.7l-4.3-2.6" }] },
  audio: { label: "Audio (MP3)", els: [{ d: "M9 17.5V6.3l10-2v11.2" }, { circle: [6.5, 17.5, 2.5] }, { circle: [16.5, 15.5, 2.5] }] },
  download: { label: "Télécharger", els: [{ d: "M12 3.5v11.5M7.5 10.5 12 15l4.5-4.5M5 20h14" }] },
  share: { label: "Partager", els: [{ d: "M12 3.5v11M8.5 7 12 3.5 15.5 7" }, { d: "M8.5 10H7.5A2.5 2.5 0 0 0 5 12.5v6A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-6a2.5 2.5 0 0 0-2.5-2.5h-1" }] },
  photos: { label: "Photos", els: [{ rect: [3, 4.5, 18, 15, 2.5] }, { circle: [8.5, 9.5, 1.6] }, { d: "M21 15.5 16.2 11l-8.7 8.5" }] },
  files: { label: "Fichiers", els: [{ d: "M3 7.5A2.5 2.5 0 0 1 5.5 5h3.3c.5 0 .9.2 1.2.6l1.5 1.9h7A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" }] },
  key: { label: "Clé, jeton", els: [{ circle: [8, 15.5, 4] }, { d: "M10.9 12.6 19.5 4M16.5 7l2.5 2.5M14 9.5l1.8 1.8" }] },
  account: { label: "Compte", els: [{ circle: [12, 8.5, 3.8] }, { d: "M4.5 20.5a7.5 7.5 0 0 1 15 0" }] },
  history: { label: "Historique, activité", els: [{ d: "M4 12a8 8 0 1 0 2.6-5.9M4 4.5v4h4" }, { d: "M12 8v4.5l3 1.8" }] },
  quota: { label: "Quota", els: [{ d: "M4.3 16.5a8 8 0 1 1 15.4 0" }, { d: "M12 14l3.4-4.5" }, { circle: [12, 14, 1.2], fill: true }, { d: "M7 19.5h10" }] },
  settings: { label: "Réglages", els: [{ d: "M4 7.5h8M16 7.5h4M4 16.5h3M11 16.5h9" }, { circle: [14, 7.5, 2] }, { circle: [9, 16.5, 2] }] },
  help: { label: "Aide", els: [{ circle: [12, 12, 9] }, { d: "M9.7 9.5a2.4 2.4 0 0 1 4.6 1c0 1.6-2.3 2-2.3 3.5" }, { circle: [12, 16.9, 1], fill: true }] },
  iphone: { label: "iPhone", els: [{ rect: [6.5, 2.5, 11, 19, 3] }, { d: "M10.5 5.3h3" }] },
  browser: { label: "Navigateur, extension", els: [{ rect: [3, 4.5, 18, 15, 2.5] }, { d: "M3 9h18" }, { circle: [6, 6.8, 0.9], fill: true }, { circle: [8.6, 6.8, 0.9], fill: true }] },
  chat: { label: "Discussion (robot)", els: [{ d: "M12 4.5c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7c-1 0-2-.1-2.9-.4L4.5 20l1.3-3.6c-1.4-1.3-2.3-3-2.3-4.9 0-3.9 3.8-7 8.5-7z" }] },
  dashboard: { label: "Espace web", els: [{ rect: [3.5, 3.5, 7, 9, 2] }, { rect: [13.5, 3.5, 7, 5, 2] }, { rect: [13.5, 11.5, 7, 9, 2] }, { rect: [3.5, 15.5, 7, 5, 2] }] },
  success: { label: "Réussi", els: [{ circle: [12, 12, 9] }, { d: CHECK_IN_CIRCLE }] },
  check: { label: "Validé", els: [{ d: CHECK }] },
  error: { label: "Erreur", els: [{ d: "M10.8 3.4c.6-.9 1.8-.9 2.4 0l5.6 7.8c.4.5.4 1.1 0 1.6l-5.6 7.8c-.6.9-1.8.9-2.4 0l-5.6-7.8c-.4-.5-.4-1.1 0-1.6z" }, { d: "M12 8.5v4" }, { circle: [12, 15.6, 1], fill: true }] },
  warning: { label: "Attention", els: [{ d: "M10.3 4.2 3 17.1A2 2 0 0 0 4.7 20h14.6a2 2 0 0 0 1.7-2.9L13.7 4.2a2 2 0 0 0-3.4 0z" }, { d: "M12 9.3v4.2" }, { circle: [12, 16.6, 1], fill: true }] },
  info: { label: "Information", els: [{ circle: [12, 12, 9] }, { d: "M12 11v5.5" }, { circle: [12, 7.8, 1], fill: true }] },
  loading: { label: "Chargement", els: [{ circle: [12, 12, 8.5], opacity: 0.25 }, { d: "M12 3.5a8.5 8.5 0 0 1 8.5 8.6" }] },
  external: { label: "Lien externe", els: [{ d: "M14 4h6v6M20 4l-8.5 8.5" }, { d: "M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" }] },
  arrowRight: { label: "Continuer", els: [{ d: "M4.5 12h15M13.5 6l6 6-6 6" }] },
  close: { label: "Fermer", els: [{ d: "M6.5 6.5l11 11M17.5 6.5l-11 11" }] },
  menu: { label: "Menu", els: [{ d: "M4 7h16M4 12h16M4 17h16" }] },
  chevronDown: { label: "Déplier", els: [{ d: "M6 9.5l6 6 6-6" }] },
  chevronUp: { label: "Replier", els: [{ d: "M6 14.5l6-6 6 6" }] },
  chevronLeft: { label: "Précédent", els: [{ d: "M14.5 6l-6 6 6 6" }] },
  chevronRight: { label: "Suivant", els: [{ d: "M9.5 6l6 6-6 6" }] },
} as const satisfies Record<string, { label: string; els: readonly IconEl[] }>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];
export const ICON_STROKE = 1.6;

/** Contenu SVG d'un pictogramme (sans la balise <svg>), pour l'export et les pages statiques. */
export function iconMarkup(name: IconName): string {
  return (ICONS[name].els as readonly IconEl[]).map((el) => {
    if ("d" in el) return `<path d="${el.d}"/>`;
    if ("rect" in el) { const [x, y, w, h, r] = el.rect; return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`; }
    const [cx, cy, r] = el.circle;
    return `<circle cx="${cx}" cy="${cy}" r="${r}"${el.fill ? ' fill="currentColor" stroke="none"' : ""}${el.opacity !== undefined ? ` opacity="${el.opacity}"` : ""}/>`;
  }).join("");
}
