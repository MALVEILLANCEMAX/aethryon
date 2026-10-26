// Configuration figée à la construction : aucune URL d'API n'est modifiable à l'exécution (pas de
// redirection possible du jeton vers un autre serveur, ni de la vérification de mise à jour).
export const TARGET = __AETHRYON_TARGET__;
export const API_BASE = __API_BASE__;
export const SITE_BASE = __SITE_BASE__;
export const VERSION = __VERSION__;
/**
 * Statut affiché (pied du popup, des réglages et de la page d'accueil, nom de version dans
 * chrome://extensions) : vide depuis que l'extension est publique (2026-10-18, décision du propriétaire) ;
 * « bêta » du 2026-10-11 au 2026-10-18 ; « en développement » avant (scripts/build.mjs, RELEASE_STATUS).
 */
export const RELEASE_STATUS = __RELEASE_STATUS__;
/**
 * « Version 3.5.2 · préproduction » (build de développement) ; « Version 3.5.2 » (publique), ou
 * « Version 3.5.2 · <statut> » si un statut est fixé.
 * La constante injectée est comparée directement (et non TARGET) : esbuild replie la condition, et le paquet
 * distribué ne contient plus le libellé de préproduction (tests/release : aucune trace de développement).
 */
export const versionLine = (v: string): string =>
  __AETHRYON_TARGET__ === "dev" ? `Version ${v} · préproduction` : RELEASE_STATUS ? `Version ${v} · ${RELEASE_STATUS}` : `Version ${v}`;

export const DASHBOARD_URL = `${SITE_BASE}/dashboard`;
export const KEYS_URL = `${SITE_BASE}/dashboard/cles`;
export const ACTIVITY_URL = `${SITE_BASE}/dashboard/activite`;
export const HELP_URL = `${SITE_BASE}/aide`;
export const PRIVACY_URL = `${SITE_BASE}/confidentialite`;
/** AETHRYON Tools : atelier de retouche du site (V3 : « Ouvrir AETHRYON Tools »). */
export const TOOLS_URL = `${SITE_BASE}/outils`;
/** Page publique de l'extension sur le site (téléchargement du ZIP, guide d'installation). */
export const DOWNLOAD_PAGE_URL = `${SITE_BASE}/extension`;
/**
 * Fichier public qui annonce la dernière version (docs/EXTENSION.md §8). Production :
 * https://raccourci.malvu.fr/downloads/extension/latest.json ; build de développement : la pile de test
 * (AETHRYON_UPDATE_URL à la construction). Jamais modifiable à l'exécution.
 */
export const UPDATE_URL = __UPDATE_URL__;

/** Chemin de retour de launchWebAuthFlow : https://<id>.chromiumapp.org/aethryon */
export const AUTH_REDIRECT_PATH = "aethryon";
/** Page d'accueil de l'extension (premier lancement : installation, épinglage, données, connexion). */
export const WELCOME_PATH = "welcome/welcome.html";
