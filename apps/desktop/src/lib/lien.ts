// « Coller un lien » (Accueil) : plateforme reconnue d'après l'adresse (indication visuelle seulement : le serveur
// de conversion reste seul juge de ce qu'il accepte, comme sur le site et dans l'extension).
export type Plateforme = "YouTube" | "TikTok" | "X";

export function plateformeDe(saisie: string): Plateforme | null {
  const t = saisie.trim();
  if (!t) return null;
  let hote: string;
  try {
    hote = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`).hostname.toLowerCase().replace(/^www\.|^m\./, "");
  } catch {
    return null;
  }
  if (hote === "youtu.be" || hote === "youtube.com" || hote.endsWith(".youtube.com") || hote === "youtube-nocookie.com") return "YouTube";
  if (hote === "tiktok.com" || hote.endsWith(".tiktok.com")) return "TikTok";
  if (hote === "x.com" || hote === "twitter.com" || hote.endsWith(".twitter.com") || hote.endsWith(".x.com")) return "X";
  return null;
}
