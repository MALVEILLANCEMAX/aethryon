// Mise en forme française : durées, codes temporels, tailles (comme l'Explorateur de Windows), dates relatives et
// typographie (espace fine insécable avant ; ! ?, espace insécable avant : et dans « »). Repris du panneau bêta 2
// (premiere/panneau/bibliotheque.js), porté en TypeScript.

export const NB = " "; // espace insécable
export const FINE = " "; // espace fine insécable

/** Typographie française appliquée à une chaîne venue d'ailleurs (titre de vidéo, message du serveur). */
export function typo(s: string): string {
  return String(s)
    .replace(/ ([;!?])/g, FINE + "$1")
    .replace(/ :/g, NB + ":")
    .replace(/« /g, "«" + NB)
    .replace(/ »/g, NB + "»")
    .replace(/(\d) (Ko|Mo|Go|kHz|kbit\/s|i\/s|%|s|ms|px|octets?|sur)(?![\wÀ-ÿ])/g, "$1" + NB + "$2");
}

/** 75 → « 1:15 » ; 3725 → « 1:02:05 ». */
export function duree(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return "";
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const mn = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const p = (n: number) => (n < 10 ? "0" : "") + n;
  return h ? `${h}:${p(mn)}:${p(sec)}` : `${mn}:${p(sec)}`;
}

/** Code temporel HH:MM:SS:II (images), arrondi à l'image inférieure. */
export function codeTemporel(s: number, ips = 30): string {
  const f = Math.max(1, Math.round(ips || 30));
  const total = Math.max(0, Math.floor((s || 0) * f + 1e-6));
  const im = total % f;
  const sec = Math.floor(total / f);
  const p = (n: number) => (n < 10 ? "0" : "") + n;
  return `${p(Math.floor(sec / 3600))}:${p(Math.floor((sec % 3600) / 60))}:${p(sec % 60)}:${p(im)}`;
}

/** Lit « 1:15 », « 01:02:05 », « 75 » ou « 75,5 » en secondes ; null si illisible. */
export function lireDuree(saisie: string): number | null {
  const s = saisie.trim().replace(",", ".");
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  const h = Number(m[1] || 0), mn = Number(m[2]), sec = Number(m[3]);
  if (mn >= 60 || sec >= 60) return null;
  return h * 3600 + mn * 60 + sec;
}

/** Taille comme l'Explorateur de Windows (Ko = 1 024 octets), virgule décimale. */
export function taille(o: number | null | undefined): string {
  if (o == null || !isFinite(o)) return "";
  if (o < 1024) return o + NB + "octet" + (o > 1 ? "s" : "");
  if (o < 1024 * 1024) return Math.max(1, Math.round(o / 1024)) + NB + "Ko";
  if (o < 1024 * 1024 * 1024) return (o / 1048576).toFixed(1).replace(".", ",") + NB + "Mo";
  return (o / 1073741824).toFixed(1).replace(".", ",") + NB + "Go";
}

export function pourcent(x: number): string {
  return Math.round(Math.max(0, Math.min(100, x))) + NB + "%";
}

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** « Aujourd’hui à 13:38 », « Hier à 09:12 », « 4 oct. 2026 ». */
export function dateRelative(iso: string | null | undefined, maintenant = Date.now()): string {
  const t = Date.parse(iso || "");
  if (!isFinite(t)) return "";
  const d = new Date(t);
  const n = new Date(maintenant);
  const p = (x: number) => (x < 10 ? "0" : "") + x;
  const heure = p(d.getHours()) + ":" + p(d.getMinutes());
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(n) - jour(d)) / 86400000);
  if (ecart === 0) return "Aujourd’hui à" + NB + heure;
  if (ecart === 1) return "Hier à" + NB + heure;
  return d.getDate() + NB + MOIS[d.getMonth()] + " " + d.getFullYear();
}

export function definition(l?: number | null, h?: number | null): string {
  return l && h ? `${l}${NB}×${NB}${h}` : "";
}

/** « 3 éléments », « 1 élément », « 0 élément » (singulier jusqu’à 1, règle française). */
export function pluriel(n: number, singulier: string, plurielForme = singulier + "s"): string {
  return n + NB + (Math.abs(n) >= 2 ? plurielForme : singulier);
}
