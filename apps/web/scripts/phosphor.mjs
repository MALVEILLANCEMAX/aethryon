// Génère web/src/ui/ph/ph.ts depuis les SVG de @phosphor-icons/core (licence MIT, © 2023 Phosphor Icons).
// Usage : node web/scripts/phosphor.mjs <dossier assets du paquet> (ex. …/package/assets, version 2.1.1).
// Seules les icônes de CARTE sont copiées : graisse « bold » (trait), fond du « duotone » (opacité 0,2 dans le paquet,
// rendu par la classe ph-duo) et, pour PLEIN, la graisse « fill ». Aucune icône de marque (logos de plateformes,
// d'Apple, d'Adobe ou de Discord) : leurs conditions ne le permettent pas (revérifié le 2026-10-12).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ASSETS = process.argv[2];
if (!ASSETS || !existsSync(join(ASSETS, "bold"))) throw new Error("usage : node web/scripts/phosphor.mjs <…/package/assets>");
const SORTIE = join(import.meta.dirname, "../src/ui/ph");

// Nom du site → nom Phosphor. Les 57 premiers reprennent les noms du jeu Égide (design/src/icones.ts), dont les sept
// pictogrammes du catalogue des plateformes ; les suivants remplacent ui/Icon.tsx.
const CARTE = {
  alerte: "warning", archive: "archive", barre: "minus-circle", bas: "caret-down", biblio: "books", bulle: "chat-circle",
  cadenas: "lock", cherche: "magnifying-glass", chevron: "caret-right", chutier: "tray", ciseaux: "scissors",
  coller: "clipboard-text", compte: "user", convertir: "arrow-line-down", copier: "copy", croix: "x", debut: "arrow-line-left",
  direct: "broadcast", dossier: "folder", droits: "certificate", ecouter: "headphones", exporter: "upload-simple",
  extension: "puzzle-piece", fenetre: "app-window", fichier: "file", fil: "path", fin: "arrow-line-right", flux: "rss",
  gif: "gif", grille: "squares-four", horloge: "clock", image: "image", importer: "download-simple", info: "info",
  interdit: "prohibit", lecture: "play", lien: "link", liste: "list-bullets", menu: "list", musique: "vinyl-record",
  navigateur: "browser", oeil: "eye", ok: "check", onde: "waveform", ouvrir: "arrow-square-out", partager: "export",
  pause: "pause", plus: "plus", post: "article", reglages: "sliders-horizontal", retour: "arrow-counter-clockwise",
  son: "music-notes", telephone: "device-mobile", theme: "circle-half", trier: "arrows-down-up",
  vertical: "device-mobile-camera", video: "video-camera",
  cle: "key", film: "film-strip", bouclier: "shield-check", eclair: "lightning", actualiser: "arrows-clockwise",
  deconnexion: "sign-out", activite: "pulse", maison: "house", qr: "qr-code", etincelle: "sparkle", droite: "arrow-right", monde: "globe",
  tasse: "coffee", sortie: "arrow-up-right", livre: "book-open", sablier: "hourglass", jauge: "gauge", nuage: "cloud",
  televerser: "cloud-arrow-up", corbeille: "trash", courriel: "envelope-simple", cache: "eye-slash", cloche: "bell",
  silence: "bell-slash", precedent: "caret-left", discussion: "chats-circle", profil: "user-circle",
  carte: "credit-card", calendrier: "calendar-blank", coche: "check-circle", etoile: "star", globe: "globe-simple",
  recadrer: "crop", compresser: "arrows-in-simple",
  // Pages intérieures (« Le Passage », 2026-10-28) : emblèmes des pages et repères de l'aide.
  bouee: "lifebuoy", balance: "scales", recu: "receipt", identite: "identification-card", document: "file-text",
  rompu: "link-break", boussole: "compass", empreinte: "fingerprint",
};
// Glyphes pleins : commandes de lecture, tuiles des produits et emblèmes des pages intérieures.
const PLEIN = ["lecture", "pause", "extension", "film", "telephone", "discussion", "ciseaux", "profil", "navigateur",
  "bouee", "balance", "recu", "identite", "document", "bouclier", "boussole", "cle", "rompu", "sablier", "courriel"];

const chemins = (graisse, nom) => {
  const f = join(ASSETS, graisse, `${nom}-${graisse}.svg`);
  if (!existsSync(f)) throw new Error(`absent : ${graisse}/${nom}`);
  return [...readFileSync(f, "utf8").matchAll(/<path d="([^"]+)"( opacity="[^"]+")?/g)].map((m) => ({ d: m[1], fond: !!m[2] }));
};
const sur = (d) => { if (!/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/.test(d)) throw new Error(`tracé inattendu : ${d.slice(0, 40)}`); return d; };

const lignes = Object.entries(CARTE).map(([n, ph]) => {
  const trait = chemins("bold", ph).map((p) => p.d).join("");
  const fond = chemins("duotone", ph).filter((p) => p.fond).map((p) => p.d).join("");
  return `  ${n}: { t: "${sur(trait)}", f: "${sur(fond)}" },`;
});
const pleins = PLEIN.map((n) => `  ${n}: "${sur(chemins("fill", CARTE[n]).map((p) => p.d).join(""))}",`);

mkdirSync(SORTIE, { recursive: true });
writeFileSync(join(SORTIE, "ph.ts"), `// GÉNÉRÉ par web/scripts/phosphor.mjs depuis @phosphor-icons/core 2.1.1 : ne pas modifier à la main.
// Icônes Phosphor, licence MIT, © 2023 Phosphor Icons (texte complet : LICENSE-phosphor.txt, à côté).
// Grille 256 ; t = graisse « bold », f = fond du « duotone » (affiché par la classe ph-duo) ; PH_PLEIN = graisse « fill ».
export const PH = {
${lignes.join("\n")}
} as const;

export const PH_PLEIN = {
${pleins.join("\n")}
} as const;

export type NomPh = keyof typeof PH;
export type NomPlein = keyof typeof PH_PLEIN;
`);
copyFileSync(join(dirname(ASSETS), "LICENSE"), join(SORTIE, "LICENSE-phosphor.txt"));
console.log(`ph.ts : ${lignes.length} icônes, ${pleins.length} pleines`);
