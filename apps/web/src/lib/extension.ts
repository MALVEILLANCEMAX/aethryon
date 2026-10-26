// Extension navigateur AETHRYON : distribution DIRECTE depuis ce site (aucune boutique d'extensions),
// décidée À LA CONSTRUCTION. Avec EXTENSION_DOWNLOAD=1, scripts/fetch-downloads.sh copie la release
// vérifiée (extension/release : archive, SHA256SUMS, latest.json) dans /downloads/extension/ et vite.config.ts
// injecte latest.json ici : la page /extension propose le téléchargement et le site présente l'extension comme
// disponible. Sinon (défaut) : rien n'est servi et tout le site dit « en développement ».
export interface ExtensionRelease {
  version: string;
  /** Nom du fichier dans /downloads/extension/ (aethryon-extension-<version>.zip). */
  file: string;
  sha256: string;
  /** Taille en octets. */
  size: number;
  /** Date de publication (AAAA-MM-JJ). */
  released: string;
  /** Version minimale de Chrome (manifest minimum_chrome_version). */
  minChrome: number;
  notes: string[];
}

/** Typographie française des notes (écrites dans CHANGELOG.md avec des espaces ordinaires) : espace insécable avant
 *  « : ; ! ? » » et après « « », pour qu'aucune ligne ne commence par une ponctuation (e2e/webkit/ponctuation.mjs). */
export const typoNote = (s: string) => s.replace(/[ \u00a0\u202f]+([:;!?»])/g, "\u00a0$1").replace(/«[ \u00a0\u202f]+/g, "«\u00a0");

function read(): ExtensionRelease | null {
  const raw = import.meta.env.VITE_EXTENSION_RELEASE as string | undefined;
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<ExtensionRelease>;
    const ok = typeof r.version === "string" && /^\d+\.\d+\.\d+$/.test(r.version)
      && typeof r.file === "string" && r.file === `aethryon-extension-${r.version}.zip`
      && typeof r.sha256 === "string" && /^[0-9a-f]{64}$/.test(r.sha256)
      && typeof r.size === "number" && r.size > 0 && typeof r.released === "string"
      && typeof r.minChrome === "number" && Array.isArray(r.notes);
    return ok ? { ...(r as ExtensionRelease), notes: (r.notes as unknown[]).filter((n): n is string => typeof n === "string").map(typoNote) } : null;
  } catch {
    return null;
  }
}

export const EXTENSION_RELEASE: ExtensionRelease | null = read();
export const EXTENSION_AVAILABLE = EXTENSION_RELEASE !== null;
export const EXTENSION_PAGE = "/extension";
export const extensionDownloadUrl = (r: ExtensionRelease) => `/downloads/extension/${r.file}`;
export const EXTENSION_SUMS_URL = "/downloads/extension/SHA256SUMS";

/** Statut affiché partout sur le site (héros, solutions, schéma « Un compte », guide de l'espace…). */
export const EXTENSION_STATUS = EXTENSION_AVAILABLE
  ? { label: "Disponible", lower: "disponible", detail: "installation manuelle, hors store", state: "ready" as const, tone: "ok" as const }
  : { label: "En développement", lower: "en développement", detail: "", state: "dev" as const, tone: "warn" as const };

/** Taille lisible (« 296 Ko »). */
export const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo` : `${Math.round(bytes / 1024)} Ko`);

/** Date lisible (« 11 octobre 2026 »), sans dépendre du fuseau du visiteur. */
export function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  return y && m && d ? `${d} ${months[m - 1]} ${y}` : iso;
}
