// Formats d'affichage de la démonstration (timecodes, tailles, durées), en français.
const nf1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** Taille en Mo (ou Go), une décimale. */
export const mo = (x: number): string => (x >= 1000 ? `${nf1.format(x / 1000)} Go` : x >= 100 ? `${Math.round(x)} Mo` : `${nf1.format(x)} Mo`);

/** Débit en Mo/s, une décimale. */
export const debit = (x: number): string => `${nf1.format(x)} Mo/s`;

/** Timecode m:ss (ou h:mm:ss), avec dixièmes si demandé. */
export function tc(s: number, dixiemes = false): string {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const sec = dixiemes ? r.toFixed(1).padStart(4, "0") : String(Math.floor(r)).padStart(2, "0");
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${sec}`;
}

/** Durée lisible : « 30 s », « 1 min », « 4 min 12 s ». */
export function dureeLisible(s: number): string {
  s = Math.round(s);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

/** Timecode parlé pour les lecteurs d'écran : « 1 min 2,5 s ». */
export const tcParle = (s: number): string => {
  const m = Math.floor(s / 60), r = Math.round((s % 60) * 10) / 10;
  return `${m} min ${String(r).replace(".", ",")} s`;
};

/** Nom de fichier produit (minuscules, sans accents, tirets ; extrait : « _1-02_1-32 »). */
export function nomFichier(titre: string, ext: string, extrait: readonly [number, number] | null): string {
  const base = titre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return extrait ? `${base}_${tc(extrait[0]).replace(":", "-")}_${tc(extrait[1]).replace(":", "-")}.${ext}` : `${base}.${ext}`;
}
