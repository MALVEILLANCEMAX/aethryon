// Dépôt GitHub officiel d'AETHRYON (code sous Apache-2.0, marque réservée). Tant que le dépôt est PRIVÉ
// (VITE_GITHUB_PUBLIC=0, défaut), le site ne montre AUCUN lien vers lui : un visiteur n'y trouverait qu'une 404.
// Le drapeau est posé à la construction (vite.config.ts) ; deploy-web.sh refuse GITHUB_PUBLIC=1 tant que le dépôt
// n'est pas public, et check-dist refuse tout lien vers github.com sans lui.

// Hors de Vite (essais sous Node), import.meta.env n'existe pas.
function built<T>(read: () => T, fallback: T): T {
  try { return read(); } catch { return fallback; }
}
export const GITHUB_PUBLIC = built(() => import.meta.env.VITE_GITHUB_PUBLIC === "1", false);
export const GITHUB_REPO = "MALVEILLANCEMAX/aethryon";
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
