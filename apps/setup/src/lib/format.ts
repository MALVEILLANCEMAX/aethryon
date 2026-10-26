// Mise en forme française : tailles, durées, codes temporels, dates, dossiers « amicaux » et typographie.
// Espaces : insécable (U+00A0) avant « : » et dans « », fine insécable (U+202F) avant ; ! ?, insécable entre un
// nombre et son unité (DESIGN-SYSTEM.md §3, fonction typo() des maquettes reprise telle quelle).

export const NBSP = "\u00A0";
export const FINE = "\u202F";

/** Applique la typographie française à une chaîne d'interface. */
export function typo(t: string): string {
  return t
    .replace(/ ([;!?])/g, FINE + "$1")
    .replace(/ :/g, NBSP + ":")
    .replace(/« /g, "«" + NBSP)
    .replace(/ »/g, NBSP + "»")
    .replace(/(\d) (Ko|Mo|Go|To|kHz|kbit\/s|i\/s|%|s|ms|px|octets|sur|min|h)(?![\wÀ-ÿ])/g, "$1" + NBSP + "$2");
}

function virgule(v: number, decimales: number): string {
  return v.toFixed(decimales).replace(".", ",");
}

/** 845 654 → « 826 Ko » ; 23 173 529 → « 22,1 Mo » (unités binaires, comme l'Explorateur). */
export function taille(o: number): string {
  if (!Number.isFinite(o) || o < 0) return "—";
  if (o < 1024) return `${o}${NBSP}octets`;
  const unites = ["Ko", "Mo", "Go", "To"];
  let v = o / 1024;
  let i = 0;
  while (v >= 1024 && i < unites.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : virgule(v, 1)}${NBSP}${unites[i]}`;
}

/** Nombre groupé à la française : 845 654 (espace fine insécable). */
export function nombre(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, FINE);
}

/** Durée courte d'une carte : 12 → « 0:12 » ; 3725 → « 1:02:05 ». */
export function duree(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s) || s < 0) return "—";
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Code temporel de montage HH:MM:SS:II (images) ; sans cadence connue : HH:MM:SS. */
export function codeTemporel(s: number, ips: number | null | undefined): string {
  const t = Math.max(0, s || 0);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = Math.floor(t % 60);
  const base = [h, m, sec].map((x) => String(x).padStart(2, "0")).join(":");
  if (!ips || !Number.isFinite(ips) || ips <= 0) return base;
  const img = Math.floor((t - Math.floor(t)) * Math.round(ips) + 1e-6);
  return `${base}:${String(Math.min(img, Math.round(ips) - 1)).padStart(2, "0")}`;
}

/** Cadence : 30 → « 30 i/s » ; 29.97 → « 29,97 i/s ». */
export function cadence(ips: number | null | undefined): string | null {
  if (!ips || !Number.isFinite(ips)) return null;
  const r = Math.round(ips * 100) / 100;
  return `${Number.isInteger(r) ? r : virgule(r, 2).replace(/0$/, "")}${NBSP}i/s`;
}

export function definition(l: number | null, h: number | null): string | null {
  return l && h ? `${l}${NBSP}×${NBSP}${h}` : null;
}

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function heure(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function memeJour(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** « Samedi 18 octobre » */
export function dateLongue(d: Date): string {
  const j = JOURS[d.getDay()];
  return `${j[0].toUpperCase()}${j.slice(1)} ${d.getDate()}${NBSP}${MOIS[d.getMonth()]}`;
}

/** « Aujourd'hui, 01:12 » · « Hier, 22:40 » · « 12 oct., 09:05 ». */
export function quand(iso: string, maintenant = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hier = new Date(maintenant);
  hier.setDate(hier.getDate() - 1);
  if (memeJour(d, maintenant)) return `Aujourd'hui, ${heure(d)}`;
  if (memeJour(d, hier)) return `Hier, ${heure(d)}`;
  const annee = d.getFullYear() !== maintenant.getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${d.getDate()}${NBSP}${MOIS_COURTS[d.getMonth()]}${annee}, ${heure(d)}`;
}

/** « aujourd'hui à 01:12 » (phrase). */
export function quandPhrase(iso: string, maintenant = new Date()): string {
  const q = quand(iso, maintenant);
  if (q.startsWith("Aujourd'hui")) return `aujourd'hui à ${q.slice(13)}`;
  if (q.startsWith("Hier")) return `hier à ${q.slice(6)}`;
  return `le ${q.replace(", ", " à ")}`;
}

export function heureCourte(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : heure(d);
}

export function estAujourdhui(iso: string, maintenant = new Date()): boolean {
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && memeJour(d, maintenant);
}

/** « 18 oct. 2026 » */
export function dateCourte(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.getDate()}${NBSP}${MOIS_COURTS[d.getMonth()]} ${d.getFullYear()}`;
}

const DOSSIERS_CONNUS: Record<string, string> = {
  downloads: "Téléchargements",
  videos: "Vidéos",
  desktop: "Bureau",
  pictures: "Images",
  music: "Musique",
  documents: "Documents",
};

/** « C:\Users\Élodie\Videos\AETHRYON » → « Vidéos › AETHRYON ». */
export function dossierAmical(chemin: string): string {
  const parties = chemin.split(/[\\/]+/).filter(Boolean);
  if (parties.length === 0) return chemin;
  const nom = (p: string) => DOSSIERS_CONNUS[p.toLowerCase()] ?? p;
  if (parties.length === 1) return nom(parties[0]);
  return `${nom(parties[parties.length - 2])} › ${nom(parties[parties.length - 1])}`;
}

/** Libellé d'un codec pour l'inspecteur. */
export function codec(c: string | null | undefined): string | null {
  if (!c) return null;
  const n: Record<string, string> = {
    h264: "H.264", hevc: "HEVC (H.265)", av1: "AV1", vp9: "VP9", vp8: "VP8", prores: "Apple ProRes", mpeg4: "MPEG-4",
    aac: "AAC", mp3: "MP3", opus: "Opus", pcm: "PCM", "pcm-float": "PCM flottant", ac3: "AC-3", eac3: "E-AC-3", flac: "FLAC", alac: "ALAC",
  };
  return n[c] ?? c.toUpperCase();
}

export function pluriel(n: number, un: string, plusieurs: string): string {
  return `${n}${NBSP}${n > 1 ? plusieurs : un}`;
}
