// Qualité audio RÉELLE (mesurée par le cœur dans les en-têtes du flux) → libellés simples, sans jargon superflu.
import type { Piste, Qualite } from "./types";

const NOMS: Record<string, string> = { mp3: "MP3", aac: "AAC", alac: "ALAC", flac: "FLAC", opus: "Opus", vorbis: "Vorbis", pcm: "WAV", aiff: "AIFF", ape: "APE", wavpack: "WavPack", mpc: "Musepack", speex: "Speex" };

export function nomCodec(q: Qualite): string {
  return NOMS[q.codec] ?? (q.codec && q.codec !== "inconnu" ? q.codec.toUpperCase() : "Format inconnu");
}

const khz = (hz: number) => `${(hz / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} kHz`;

/** « FLAC · 24 bits · 96 kHz » ; « MP3 · 192 kb/s · 44,1 kHz ». Une valeur inconnue est omise, jamais devinée. */
export function libelleQualite(q: Qualite): string {
  const p = [nomCodec(q)];
  if (q.sansPerte && q.bits) p.push(`${q.bits} bits`);
  if (!q.sansPerte && q.debitKbps) p.push(`${q.debitKbps} kb/s`);
  if (q.frequenceHz) p.push(khz(q.frequenceHz));
  if (q.canaux === 1) p.push("mono");
  return p.join(" · ");
}

/** Classe de qualité pour le filtre : « haute résolution », « sans perte », « compressé », « inconnu ». */
export type ClasseQualite = "hires" | "sansperte" | "compresse" | "inconnu";
export function classeQualite(q: Qualite): ClasseQualite {
  if (!q.codec || q.codec === "inconnu") return "inconnu";
  if (q.sansPerte) return (q.bits ?? 0) > 16 || (q.frequenceHz ?? 0) > 48_000 ? "hires" : "sansperte";
  return "compresse";
}
export const CLASSES: Record<ClasseQualite, string> = { hires: "Haute résolution", sansperte: "Sans perte", compresse: "Compressé", inconnu: "Inconnue" };

export function artistesDe(p: Pick<Piste, "artistes" | "artisteAlbum">): string {
  return p.artistes.length ? p.artistes.join(", ") : p.artisteAlbum ?? "Artiste inconnu";
}
