// Textes de l'interface intégrée aux pages, en français. Typographie : espace insécable U+00A0 avant
// ? ! : ; % et à l'intérieur des guillemets « », apostrophe typographique ’. Vérifié par
// tests/unit/content-strings.test.ts : toute nouvelle chaîne doit passer par ce module.

export const NBSP = " ";

export const T = {
  brand: "AETHRYON",
  trigger: "Télécharger",
  dialogLabel: "Télécharger avec AETHRYON",
  format: "Format",
  quality: "Qualité",
  bitrate: "Débit",
  video: "Vidéo",
  start: "Télécharger",
  sending: "Envoi…",
  queued: "En file",
  converting: "Conversion…",
  downloading: "Téléchargement…",
  done: "Enregistré",
  // 3.8.1 : « Envoyer vers › Premiere Pro » relayé à AETHRYON Desktop (états réels du Desktop).
  premiereSent: "Envoyé à AETHRYON Desktop",
  premiereImporting: "Import dans Premiere…",
  premiereDone: "Importé dans Premiere",
  cancelled: "Annulé",
  failedShort: "Échec",
  retry: "Réessayer",
  quoted: "Publication citée",
  // Connexion depuis la page (compte non connecté, ou notice sur les données pas encore acceptée).
  authNeeded: "Connexion requise",
  consentNeeded: "Notice à accepter",
  signIn: "Se connecter à AETHRYON",
  readNotice: "Lire la notice",
  signingIn: "Connexion…",
  signingInHint: `Une fenêtre AETHRYON s’ouvre${NBSP}: connecte-toi, puis autorise l’extension.`,
  signedIn: "Connecté",
  signedInHint: "Tu peux maintenant télécharger cette vidéo.",
  signInFailed: "Connexion impossible",
  noticeOpened: `La notice s’ouvre dans un nouvel onglet${NBSP}: accepte-la, puis reviens ici.`,
  openKeys: `Ouvrir «${NBSP}Mes jetons${NBSP}»`,
  errNoAnswer: "L’extension AETHRYON ne répond pas. Recharge la page puis réessaie.",
  errInvalidLink: "Ce lien n’est pas pris en charge.",
  errGeneric: "Le téléchargement a échoué.",
  panelRegion: "AETHRYON",
  panelMove: `Déplacer le panneau AETHRYON (flèches du clavier${NBSP}; touche Début pour le replacer)`,
  panelFallbackTitle: "Vidéo détectée",
  hintX: "Utilise le bouton AETHRYON sous la publication qui contient la vidéo.",
  hintYouTube: `Aucune vidéo sur cette page${NBSP}: ouvre une vidéo ou un Short.`,
  hintTikTok: `Aucune vidéo visible${NBSP}: fais défiler jusqu’à une vidéo.`,
  // V3 : outils rapides de la commande (extrait depuis l’instant de lecture, GIF, image, miniature, Tools).
  quickLegend: "Outils rapides",
  quickClip: "Extrait",
  quickGif: "GIF",
  quickFrame: "Image",
  quickThumb: "Miniature",
  quickTools: "Tools",
  quickClipAria: "Créer un extrait depuis l’instant de lecture",
  quickGifAria: "Créer un GIF depuis l’instant de lecture",
  quickFrameAria: "Enregistrer l’image affichée de la vidéo (PNG)",
  quickThumbAria: "Enregistrer la miniature de la vidéo",
  quickToolsAria: "Ouvrir cette vidéo dans AETHRYON Tools (nouvel onglet)",
  clipNoTime: `Lance la lecture de la vidéo${NBSP}: l’extrait part de l’instant de lecture.`,
  frameNoVideo: `Aucune vidéo lisible ici${NBSP}: lance la lecture, puis réessaie.`,
  frameNotReady: `La vidéo n’a pas encore d’image${NBSP}: lance la lecture, puis réessaie.`,
  frameTainted: `Ce site ne laisse pas lire l’image depuis la page${NBSP}: utilise le bouton AETHRYON de la barre d’outils du navigateur.`,
  frameDrm: `Vidéo protégée (DRM)${NBSP}: sa capture n’est pas possible.`,
  thumbMissing: "Aucune miniature connue pour cette vidéo.",
  toolsOpened: "AETHRYON Tools s’ouvre dans un nouvel onglet.",
  /** 3.5.2 : envoi vers Premiere que l’hôte d’AETHRYON Desktop n’a pas reçu (non installé ou en erreur). */
  desktopMissing: "Installe AETHRYON Desktop pour suivre l’envoi",
} as const;

/** « 30 s à partir de 1:23 » (V3 : légende des outils rapides ; l’instant est une heure de lecture). */
export function clipCaption(length: number, anchor: "before" | "around" | "after", at: string): string {
  const where = anchor === "before" ? `avant ${at}` : anchor === "around" ? `autour de ${at}` : `à partir de ${at}`;
  return `Extrait de ${length}${NBSP}s ${where}`;
}

/** « 42 % » (espace insécable avant %). */
export function percent(p: number): string {
  return `${p}${NBSP}%`;
}

/** « Conversion… 42 % » / « Téléchargement… 60 % ». */
export function withPercent(label: string, p: number | null): string {
  return p === null ? label : `${label} ${percent(p)}`;
}

/** « Vidéo 2 » */
export function videoN(n: number): string {
  return `${T.video} ${n}`;
}

/** « 2 vidéos » */
export function videoCount(n: number): string {
  return n > 1 ? `${n} vidéos` : "1 vidéo";
}

/** « 192 kbit/s » (même unité que le popup et les réglages) */
export function kbps(b: number): string {
  return `${b}${NBSP}kbit/s`;
}

/** Nom accessible du bouton, qui distingue les publications dans un fil (« … de @alice … »). */
export function triggerAria(context: string | null): string {
  return context ? `Télécharger la vidéo (${context}) avec AETHRYON` : "Télécharger cette vidéo avec AETHRYON";
}

/** « Publication citée · @bob » */
export function quotedContext(handle: string | null): string {
  return handle ? `${T.quoted} · @${handle}` : T.quoted;
}

/** V3.5 : menu de la page, vue Extrait, barre YouTube. */
export const M = {
  rowVideo: "Télécharger la vidéo",
  rowAudio: "Extraire l’audio",
  rowClip: "Extrait rapide",
  // Égide (3.9.0) : mots visibles des petites tuiles du menu (le nom complet reste le nom accessible).
  tileClip: "Extrait",
  tileFrame: "Image",
  tileTools: "Tools",
  rowFrame: "Image de la vidéo",
  rowFrameSub: "PNG, sur cet appareil",
  rowThumb: "Miniature",
  rowTools: "Continuer dans AETHRYON Tools",
  chooseQuality: "Choisir la qualité de la vidéo",
  chooseBitrate: "Choisir le débit de l’audio",
  qualityTitle: "Qualité de la vidéo",
  bitrateTitle: "Débit de l’audio",
  qualityBest: "Meilleure disponible",
  back: "Revenir au menu",
  cancel: "Annuler",
  showFile: "Afficher",
  clipTitle: "Extrait",
  tbLabel: "Outils AETHRYON",
  tbFold: "Replier la barre AETHRYON",
  tbUnfold: "Déplier la barre AETHRYON",
  tbClip: "Extrait",
  tbFrame: "Image",
  tbDownloadAria: "Télécharger cette vidéo avec AETHRYON",
  tbAudioAria: "Extraire l’audio de cette vidéo en MP3",
  tbClipAria: "Créer un extrait de cette vidéo",
  // 3.5.1 : destination des vidéos et de l’audio (Téléchargements, ou Téléchargements › AETHRYON pour Premiere Pro).
  // 3.5.2 : « Envoyer vers » › « Premiere Pro » (les mots du brief, en deux parties pour rester compact) ; rien
  // n’est importé automatiquement : le fichier attend dans AETHRYON Desktop et dans le panneau de Premiere.
  destTitle: "Envoyer vers",
  destDownloads: "Téléchargements",
  destPremiere: "Premiere Pro",
  destHint: "AETHRYON Desktop convertit la vidéo, l’enregistre dans sa bibliothèque et l’importe dans Premiere Pro.",
  destReencode: `Au-delà de 1080p, le serveur réencode la vidéo en H.264 pour Premiere${NBSP}: c’est plus long.`,
  premiereBest: "Auto, jusqu’à 1080p",
  premiereVideo: (q: string) => `MP4 H.264 · ${q}`,
  paused: (platform: string) => `${platform} est en pause côté serveur pour quelques minutes${NBSP}: réessaie un peu plus tard.`,
} as const;
