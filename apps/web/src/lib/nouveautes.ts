// Nouveautés (V3.5) : annonces versionnées, montrées UNE fois chacune (après le choix de confidentialité, jamais par-
// dessus), retrouvables depuis « Nouveautés » du pied de page. Ajouter une annonce = ajouter une entrée en tête
// d'ANNONCES : l'interface ne change pas. Règle : n'annoncer que ce qui est en ligne au moment du déploiement.

export interface Point {
  titre: string;
  texte: string;
}

export interface Annonce {
  /** Identifiant stable (« vu » est gardé par identifiant). */
  id: string;
  version: string;
  titre: string;
  accroche: string;
  points: readonly Point[];
  /** Page qui en dit plus (« Découvrir les nouveautés »). */
  lien: { to: string; label: string };
  /** Petite ligne au-dessus du titre (par défaut : « Nouvelle version · <version> »). */
  surtitre?: string;
  /** Visuel en tête de la fenêtre (par défaut : la tête maître). */
  visuel?: "premiere";
  /** Fichier à télécharger : remplace le bouton « lien » comme action principale. */
  telechargement?: { href: string; label: string };
  /** Ligne pratique sous les points (configuration requise, avertissement…). */
  note?: string;
}

/** Version publique du site (une seule source : l'annonce la plus récente et la page d'aide). */
export const VERSION_SITE = "3.5";

export const ANNONCES: readonly Annonce[] = [
  {
    // Publié le 2026-10-18 à la demande du propriétaire (« Logiciel Extension Premiere Pro disponible »).
    id: "premiere-pro-2.0",
    version: "2.0",
    surtitre: "Nouveau · Windows",
    visuel: "premiere",
    titre: "AETHRYON pour Premiere Pro est disponible",
    accroche: "Tes vidéos entrent dans Premiere Pro, sans passer par tes dossiers.",
    points: [
      { titre: "Colle un lien", texte: "Un lien YouTube, TikTok ou X suffit ; la vidéo arrive dans Premiere en MP4, prête à monter." },
      { titre: "Aperçu avant import", texte: "Regarde le clip dans le panneau, puis importe-le dans le chutier de ton choix." },
      { titre: "Ton compte AETHRYON", texte: "Tu te connectes depuis le panneau : tes conversions comptent dans ton quota habituel." },
      { titre: "Installation guidée", texte: "Un installateur pour installer, réparer, mettre à jour ou désinstaller." },
    ],
    lien: { to: "/#solutions", label: "En savoir plus" },
    telechargement: { href: "/downloads/premiere/AETHRYON-Setup-2.0.0-beta.9.exe", label: "Télécharger pour Windows" },
    note: "Windows 11 et Premiere Pro 25.6 ou plus récent. L'installateur n'est pas encore signé : Windows affiche un avertissement avant de l'ouvrir.",
  },
  {
    id: "v3.5",
    version: "3.5",
    titre: "AETHRYON 3.5",
    accroche: "Votre espace créatif évolue.",
    points: [
      { titre: "Tools, plus fluide", texte: "Une frise plus souple, un lecteur pour revoir tes exports et le glisser de la sélection vers « Exporter »." },
      { titre: "Annuler, rétablir", texte: "Chaque réglage se défait : Ctrl + Z pour annuler, Ctrl + Maj + Z ou Ctrl + Y pour rétablir (⌘ sur Mac)." },
      { titre: "Raccourcis et son", texte: "Raccourcis fiables sur clavier AZERTY, et le mode « Sped Up » qui accélère tempo et tonalité ensemble." },
      { titre: "Tes exports, rangés", texte: "Une médiathèque avec la vraie miniature, la durée, le poids et l'aperçu de chaque fichier." },
    ],
    lien: { to: "/outils", label: "Découvrir les nouveautés" },
  },
];

const KEY = "aethryon:nouveautes:vues";

function lues(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-20) : [];
  } catch {
    return [];
  }
}

/** Annonce la plus récente pas encore vue, sinon null (stockage indisponible : null, jamais à chaque page). */
export function annonceAVoir(): Annonce | null {
  const a = ANNONCES[0];
  if (!a) return null;
  try {
    window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
  return lues().includes(a.id) ? null : a;
}

export function marquerVue(id: string): void {
  try {
    const v = lues();
    if (!v.includes(id)) window.localStorage.setItem(KEY, JSON.stringify([...v, id]));
  } catch {
    /* stockage refusé */
  }
}

// ---- réouverture depuis le pied de page (même principe que les préférences de confidentialité) ------------------
const ouvrir = new Set<() => void>();
let enAttente = false;
export function ouvrirNouveautes(): void {
  if (ouvrir.size === 0) {
    enAttente = true;
    window.dispatchEvent(new Event("aethryon:visite"));
    return;
  }
  for (const f of ouvrir) f();
}
export function surOuvertureNouveautes(f: () => void): () => void {
  ouvrir.add(f);
  if (enAttente) {
    enAttente = false;
    queueMicrotask(f);
  }
  return () => ouvrir.delete(f);
}
