// Noms des fichiers que l'extension enregistre elle-même (V3 : image de la vidéo, miniature). Les fichiers convertis
// gardent le nom donné par le serveur. Lisibles, sans caractère refusé par Windows, macOS ou Linux, bornés.
import { cleanText } from "../shared/messages.ts";

/** Caractères refusés dans un nom de fichier (Windows) ; contrôles et marques de direction : retirés par cleanText. */
const FORBIDDEN = /[<>:"/\\|?*]/g;

/** Base d'un nom de fichier à partir d'un titre de vidéo (non fiable : vient d'une page). */
export function fileBase(title: string | undefined, fallback: string): string {
  const t = cleanText(title ?? "", 200).replace(FORBIDDEN, " ").replace(/\s+/g, " ").trim().replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 100).trim();
  return t || fallback;
}

/** 83.4 → « 1m23s » ; 3723 → « 1h02m03s » (deux-points interdits dans un nom de fichier sous Windows). */
export function fileTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}h${String(m).padStart(2, "0")}m${ss}s` : `${m}m${ss}s`;
}

export function frameFileName(title: string | undefined, at?: number): string {
  return `${fileBase(title, "Image AETHRYON")} (image ${at !== undefined && Number.isFinite(at) ? fileTime(at) : "de la vidéo"}).png`;
}

/** Extension d'image d'après l'adresse de la miniature (jpg par défaut : format des plateformes). */
export function imageExt(url: string): "jpg" | "png" | "webp" {
  try {
    const u = new URL(url);
    const ext = /\.(png|jpe?g|webp)$/.exec(u.pathname.toLowerCase())?.[1] ?? (u.searchParams.get("format") ?? "").toLowerCase();
    if (ext === "webp") return "webp";
    if (ext === "png") return "png";
  } catch { /* adresse déjà validée en amont */ }
  return "jpg";
}

export function thumbFileName(title: string | undefined, url: string): string {
  return `${fileBase(title, "Miniature AETHRYON")} (miniature).${imageExt(url)}`;
}
