// Choix de la source demandée au serveur pour un lien (partagé par Tools et le champ de l'accueil).
import type { Preview } from "./api.ts";

/** Qualité demandée au serveur : la meilleure en H.264 jusqu'à 1080p (lisible partout), sinon un réencodage. */
export function choixSource(p: Preview): { quality: string; transcode: boolean } {
  const h264 = p.qualities.filter((q) => q.h264 && q.quality && q.quality <= 1080).map((q) => q.quality!);
  if (h264.length) return { quality: String(Math.max(...h264)), transcode: false };
  return { quality: "1080", transcode: (p.duration ?? 0) <= 900 };
}
