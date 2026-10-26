// Lien d'installation du raccourci : UNE seule source (docs/ADMIN.md §7). Le lien iCloud officiel est un
// réglage serveur (`shortcutUrl`, modifiable dans le Control Center) exposé par /api/config (`icloudUrl`) :
// le site ne l'écrit nulle part en dur et le lit uniquement ici. Le fichier signé reste le secours.
// Le lien iCloud est une simple navigation (aucune requête du site vers iCloud) : la CSP n'est pas concernée.
import { useConfig } from "./hooks.ts";

/** Fichier signé servi par le site si la configuration ne répond pas (même valeur que le serveur). */
const DEFAULT_FALLBACK = "/downloads/AETHRYON.shortcut";
/** Forme exigée aussi par le serveur : on n'affiche jamais un lien d'une autre forme (défense en profondeur). */
const ICLOUD_RE = /^https:\/\/www\.icloud\.com\/shortcuts\/[0-9a-f]{32}$/;

export interface ShortcutLinks {
  /** Lien iCloud officiel, ou null s'il n'est pas (encore) publié. */
  icloudUrl: string | null;
  /** Fichier signé (même origine), toujours disponible. */
  fallbackDownload: string;
  /** Version publiée du raccourci, ou null tant que la configuration n'est pas chargée. */
  version: string | null;
  loading: boolean;
}

export function useShortcutUrl(): ShortcutLinks {
  const cfg = useConfig();
  const raw = cfg.data?.icloudUrl ?? null;
  const fallback = cfg.data?.fallbackDownload;
  return {
    icloudUrl: raw && ICLOUD_RE.test(raw) ? raw : null,
    fallbackDownload: fallback && fallback.startsWith("/") && !fallback.startsWith("//") ? fallback : DEFAULT_FALLBACK,
    version: cfg.data?.shortcutVersion ?? null,
    loading: cfg.loading,
  };
}

/** Attributs d'un lien vers iCloud : navigation simple, sans transmettre l'origine ni garder de référence. */
export const ICLOUD_REL = "noopener noreferrer";
