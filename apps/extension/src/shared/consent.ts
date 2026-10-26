// Notice sur les données et accord de l'utilisateur (Chrome Web Store « Disclosure Requirements », règles
// de consentement explicite de Firefox — docs/EXTENSION-STORE.md §1). Tant que l'accord n'est pas donné :
// aucune connexion, aucun téléchargement, AUCUNE requête vers un serveur (le service worker refuse ;
// les pages renvoient vers cette notice). L'accord est gardé dans storage.local avec le numéro de version de
// la notice : changer le texte d'une façon qui change ce qui est collecté ⇒ incrémenter CONSENT_VERSION
// (l'accord est alors redemandé).
//
// La notice DOIT décrire exactement le code ; elle est affichée telle quelle par la page d'accueil et par la
// page de réglages (une seule source). Vérifiée par tests/unit/consent.test.ts.
// 2 (V3, 2026-10-15) : extraits, GIF, image de la vidéo, miniature, lien « Ouvrir dans Tools ».
export const CONSENT_VERSION = 2;
export const CONSENT_KEY = "consent";

export interface ConsentRecord { version: number; at: string }

/** Une section de la notice : un titre court et une phrase (texte d'interface, typographie française). */
export interface DisclosureItem { id: string; title: string; text: string }

const NB = " ";

export const DISCLOSURE: readonly DisclosureItem[] = [
  {
    id: "local",
    title: "Gardé sur cet ordinateur",
    text: `Dans le stockage local de l'extension${NB}: sa clé de connexion (un jeton ytc_), l'adresse e-mail et le nom de ton compte, la date d'expiration de la connexion, le dernier état connu de ton compte (quota du jour et 5 dernières conversions, sans lien ni titre), le motif d'une éventuelle déconnexion, ton accord à cette notice et l'état de la vérification de mise à jour (date, dernière version annoncée, avis masqué).`,
  },
  {
    id: "connexion",
    title: "Envoyé à la connexion",
    text: `Au site AETHRYON (raccourci.malvu.fr)${NB}: le nom de l'appareil, c'est-à-dire le navigateur et le système (par exemple «${NB}Chrome · Windows${NB}»), affiché dans «${NB}Mes jetons${NB}», puis un code de connexion à usage unique et sa preuve (PKCE). Ensuite, avec la clé${NB}: la lecture de ton quota et de tes 5 dernières conversions, et la révocation de la clé quand tu te déconnectes. Si la connexion n'aboutit pas (fenêtre fermée, page qui ne se charge pas), l'extension vérifie seulement si la page du site répond, pour t'en dire la raison.`,
  },
  {
    id: "conversion",
    title: "Envoyé quand tu télécharges ou crées un extrait",
    text: `Au serveur de conversion AETHRYON (api.malvu.fr)${NB}: le lien canonique de la vidéo que tu as choisie, le format (MP4 ou MP3), la qualité ou le débit, pour X le numéro de la vidéo dans la publication, et pour un extrait son début et sa fin en secondes (pour un GIF, la demande de le tirer de l'extrait). Puis le suivi de la conversion, son annulation si tu la demandes, et le téléchargement du fichier converti par ton navigateur (avant une relance, une requête d'un octet vérifie que le fichier est encore là). «${NB}Ouvrir dans Tools${NB}» envoie au site AETHRYON l'identifiant du fichier déjà converti, pour l'ouvrir dans l'éditeur. La clé voyage dans l'en-tête des requêtes, jamais dans une adresse.`,
  },
  {
    id: "page",
    title: "Lu sur la page, sans rien envoyer",
    text: `Le titre de la vidéo, l'adresse de sa miniature, sa durée et l'instant de lecture, pour te les montrer et placer un extrait. Les miniatures sont chargées depuis les serveurs d'images des plateformes (YouTube, TikTok, X), comme sur la page elle-même${NB}; «${NB}Miniature${NB}» la fait télécharger par ton navigateur depuis ces mêmes serveurs. «${NB}Image${NB}» copie l'image affichée de la vidéo (ou, si la page l'interdit et que tu as cliqué sur l'icône de l'extension, une capture de l'onglet recadrée sur la vidéo)${NB}: elle est enregistrée sur ton ordinateur et n'est envoyée nulle part.`,
  },
  {
    id: "session",
    title: "Gardé le temps de la session",
    text: `Dans la mémoire de session du navigateur, effacée à sa fermeture et à la déconnexion${NB}: les 30 téléchargements les plus récents (lien, titre, format, extrait, état), pour suivre leur progression. Une image de la vidéo n'y est jamais gardée.`,
  },
  {
    id: "reglages",
    title: "Tes réglages",
    text: `Dans le stockage synchronisé de Chrome (copié sur tes autres appareils si la synchronisation est activée)${NB}: boutons dans les sites, format par défaut, qualité, débit, durée et placement d'un extrait, outils rapides, panneau flottant et sa position, notifications.`,
  },
  {
    id: "mise-a-jour",
    title: "Vérification de mise à jour",
    text: `Au plus toutes les 12${NB}heures, l'extension lit le fichier public latest.json sur raccourci.malvu.fr, sans clé ni donnée de compte, pour te signaler une nouvelle version. Elle ne télécharge et n'installe jamais rien d'elle-même.`,
  },
  {
    id: "jamais",
    title: "Jamais",
    text: `Aucun historique de navigation collecté, aucun cookie lu, aucune publicité, aucune revente ni aucun partage avec des tiers. Comme pour toute connexion, ces serveurs voient l'adresse IP de ton navigateur.`,
  },
];

/** Rappel des droits (popup, réglages, page d'accueil, README) : honnête, jamais une permission de contourner. */
export const RIGHTS_NOTICE = `Convertis seulement des contenus pour lesquels tu disposes des droits nécessaires${NB}; l'installation hors store ne change rien aux conditions de YouTube, TikTok et X.`;

/** Accord valable pour CETTE version de la notice (absent, mal formé ou plus ancien : non). */
export function isAccepted(raw: unknown, version = CONSENT_VERSION): boolean {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Partial<ConsentRecord>;
  return r.version === version && typeof r.at === "string" && Number.isFinite(Date.parse(r.at));
}

export async function getConsent(): Promise<ConsentRecord | null> {
  const raw = (await chrome.storage.local.get(CONSENT_KEY))[CONSENT_KEY];
  return isAccepted(raw) ? (raw as ConsentRecord) : null;
}

/** Accord donné à une version PLUS ANCIENNE de la notice (extension mise à jour depuis) : elle est à relire. */
export async function consentOutdated(): Promise<boolean> {
  const raw = (await chrome.storage.local.get(CONSENT_KEY))[CONSENT_KEY] as Partial<ConsentRecord> | undefined;
  return typeof raw?.version === "number" && raw.version < CONSENT_VERSION && isAccepted(raw, raw.version);
}

export async function setConsent(now = new Date()): Promise<ConsentRecord> {
  const rec: ConsentRecord = { version: CONSENT_VERSION, at: now.toISOString() };
  await chrome.storage.local.set({ [CONSENT_KEY]: rec });
  return rec;
}

export async function clearConsent(): Promise<void> {
  await chrome.storage.local.remove(CONSENT_KEY);
}
