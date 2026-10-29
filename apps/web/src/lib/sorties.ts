// Ce qui vient de sortir et ce qui arrive (revue produit du 2026-10-15), lu sur les réglages de construction, jamais
// affirmé à la main. « Le Passage » (2026-10-28) : la section « Nouveautés » est fondue dans les portes de l'accueil
// (landing/egide/Stations.tsx), qui montrent chaque sortie importante sur sa porte et dans son panneau.
import { EXTENSION_AVAILABLE } from "./extension.ts";
import { DISCORD_CONVERTS, DISCORD_PUBLIC } from "./discord.ts";

/** Ce qui arrive, avec un statut honnête : « En développement » = du code existe et se teste, pas encore
 *  publié ; « Prévu » = décidé, pas encore commencé. Aucune date promise. */
export const PLANNED: { id: string; title: string; body: string; status: "En développement" | "Prévu" }[] = [
  // Publiée (EXTENSION_DOWNLOAD=1) : elle n'est plus « à venir », elle a sa page (/extension).
  ...(EXTENSION_AVAILABLE ? [] : [{ id: "extension", title: "Extension navigateur", body: "Un bouton AETHRYON sous les vidéos, sur ordinateur.", status: "En développement" as const }]),
  // Public (DISCORD_PHASE media, media-auto) : il passe dans « Sorti récemment ».
  ...(DISCORD_PUBLIC ? [] : [{ id: "discord", title: "Bot Discord", body: "/convert dans ton serveur, avec ton quota.", status: "En développement" as const }]),
  // Liaison ouverte (DISCORD_PHASE conversion, media…) : elle existe dans l'espace (/dashboard/discord), elle n'est plus « à venir ».
  ...(DISCORD_CONVERTS ? [] : [{ id: "comptes", title: "Comptes connectés", body: "Relier ton compte Discord à ton compte AETHRYON.", status: "En développement" as const }]),
];

/** Ce qui vient de sortir, avec son statut réel. */
export const RELEASED: { id: string; title: string; body: string; status: string }[] = [
  // Pas la phrase de la bande Tools (« Quatre façons ») : ici, ce qui est nouveau.
  { id: "tools", title: "AETHRYON Tools", body: "L'atelier en ligne, ouvert à tous en bêta.", status: "Disponible · bêta" },
  ...(DISCORD_PUBLIC ? [{ id: "discord", title: "Bot Discord", body: "/clip, /gif et ta bibliothèque, avec ton compte.", status: "Disponible" }] : []),
  ...(EXTENSION_AVAILABLE ? [{ id: "extension", title: "Extension navigateur", body: "Extrait, GIF et image depuis la page de la vidéo.", status: "Disponible" }] : []),
  // AETHRYON pour Premiere Pro : disponible depuis le 2026-10-18 (décision du propriétaire) ; nom en texte (docs/MARQUES.md).
  { id: "premiere", title: "AETHRYON pour Premiere Pro", body: "L'extension pour Premiere Pro et son installateur Windows : colle un lien, prévisualise la vidéo, importe-la dans le chutier de ton choix.", status: "Disponible" },
];
