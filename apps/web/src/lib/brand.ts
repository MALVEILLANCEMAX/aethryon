// Constantes de marque AETHRYON (textes partagés).
export const BRAND = "AETHRYON";
export const TAGLINE = "De l'éther à tes mains.";

/** Nom du raccourci tel qu'il apparaît sur l'iPhone (inscrit dans le fichier signé v3, AETHRYON.cherri).
 *  L'ancien raccourci s'appelait « YouTube Converter » (LEGACY_SHORTCUT_NAME). */
export const SHORTCUT_NAME = "AETHRYON";
export const LEGACY_SHORTCUT_NAME = "YouTube Converter";

/** Intitulés exacts du menu du raccourci (src/AETHRYON.cherri, identiques à la v2). */
export const MENU = { mp4: "Vidéo MP4 (Photos)", mp3: "Audio MP3 (Fichiers)" } as const;

/** Confirmations exactes affichées par le raccourci v2 après l'enregistrement. */
export const SAVED = { mp4: "Vidéo enregistrée dans Photos", mp3: "Fichier enregistré dans Fichiers" } as const;

/** Plateformes RÉELLEMENT prises en charge par le service de conversion (ytapi : YouTube, TikTok, X).
 *  Instagram n'en fait pas partie : ne jamais l'afficher. `configKey` : clé de /api/config `platforms`
 *  (réglage du Control Center ; X y est nommé « twitter », comme dans ytapi). */
export type PlatformId = "youtube" | "tiktok" | "x";
export const PLATFORMS: readonly { id: PlatformId; name: string; configKey: "youtube" | "tiktok" | "twitter" }[] = [
  { id: "youtube", name: "YouTube", configKey: "youtube" },
  { id: "tiktok", name: "TikTok", configKey: "tiktok" },
  { id: "x", name: "X", configKey: "twitter" },
] as const;

/** Mention d'usage nominatif des logos (aucune affiliation). */
export const COMPAT_NOTE = "Compatible avec YouTube, TikTok et X — sans affiliation.";
