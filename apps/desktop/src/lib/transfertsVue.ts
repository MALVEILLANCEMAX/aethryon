// Lecture des transferts pour l'interface (règles PURES, partagées par la page Transferts et le fil de la coque) :
// lignes (transferts du cœur + téléchargements du navigateur repérés dans le dossier surveillé), mesures RÉELLES
// (fraction annoncée, octets reçus, débit mesuré par le cœur), bilan. Rien n'est estimé ni inventé.
import { taille } from "./format";
import type { Instantane, Media, Transfert } from "./types";

export interface Ligne {
  cle: string;
  nom: string;
  media: Media | null;
  transfert: Transfert | null;
}

/** Plateformes du contrat et du catalogue, en toutes lettres (aucun logo). */
export const PLATEFORMES: Record<string, string> = { youtube: "YouTube", tiktok: "TikTok", x: "X", twitter: "X", bluesky: "Bluesky", wikimedia: "Wikimedia Commons" };

const nomMedia = (m: Media) => `${m.nom}.${m.ext}`;

/** Débit lisible (« 3,2 Mo/s ») : seulement une mesure du cœur, jamais une estimation. */
export function debit(octetsParSeconde: number | null | undefined): string | null {
  return octetsParSeconde && octetsParSeconde > 0 ? `${taille(octetsParSeconde)}/s` : null;
}

export function lignesDe(inst: Instantane): Ligne[] {
  const parNom = new Map(inst.index.medias.map((m) => [nomMedia(m).toLowerCase(), m]));
  const lignes: Ligne[] = inst.transferts.map((t) => ({
    cle: `t-${t.id}`,
    nom: t.fichierAttendu ?? t.titre ?? "Transfert",
    transfert: t,
    media: (t.chemin ? inst.index.medias.find((m) => m.chemin === t.chemin) : null) ?? (t.fichierAttendu ? parNom.get(t.fichierAttendu.toLowerCase()) ?? null : null),
  }));
  const relies = new Set(lignes.map((l) => l.media?.id).filter(Boolean));
  for (const m of inst.index.medias) {
    if (m.etat === "en-cours" && !relies.has(m.id)) lignes.push({ cle: `m-${m.id}`, nom: nomMedia(m), media: m, transfert: null });
  }
  return lignes;
}

export const estActive = (l: Ligne): boolean => (l.transfert ? !/^(pret|erreur)$/.test(l.transfert.etat) : true);

/** Ce qui est mesuré pour une ligne active : fraction (ou null), octets, débit, étape lisible. */
export function mesures(l: Ligne) {
  const t = l.transfert;
  const m = l.media;
  if (!t) {
    return { frac: null, etape: "Téléchargement du navigateur", octets: m ? `${taille(m.taille)} reçus · taille finale inconnue` : null, vitesse: null, pause: false };
  }
  const pause = !!t.pause && t.etat === "telechargement";
  const frac = t.etat === "telechargement" || t.etat === "conversion" ? t.progression ?? null : null;
  const etape = t.etat === "attente" ? "En attente" : t.etat === "conversion" ? "Conversion sur le serveur" : pause ? "En pause" : "Réception du fichier";
  const octets = t.recus != null && t.etat === "telechargement"
    ? (t.total ? `${taille(t.recus)} sur ${taille(t.total)}` : `${taille(t.recus)} reçus`)
    : t.etat === "telechargement" && m ? `${taille(m.taille)} reçus` : null;
  return { frac, etape, octets, vitesse: pause || t.etat !== "telechargement" ? null : debit(t.vitesse), pause };
}

/** Bilan réel des transferts actifs : moyenne des progressions connues, débit et octets cumulés. */
export function bilan(actives: Ligne[]) {
  const connues = actives.map((l) => mesures(l).frac).filter((f): f is number => f != null);
  const vitesse = actives.reduce((s, l) => s + (l.transfert && !l.transfert.pause && l.transfert.etat === "telechargement" ? l.transfert.vitesse ?? 0 : 0), 0);
  const recus = actives.reduce((s, l) => s + (l.transfert?.etat === "telechargement" ? l.transfert.recus ?? 0 : 0), 0);
  return { moyenne: connues.length ? connues.reduce((a, b) => a + b, 0) / connues.length : null, vitesse: debit(vitesse), recus: recus > 0 ? taille(recus) : null };
}

/** Ordre du fil : les actives d'abord (les plus récentes en tête), puis l'historique, du plus récent au plus ancien. */
export function ordreFil(lignes: Ligne[]): Ligne[] {
  const date = (l: Ligne) => Date.parse(l.transfert?.majLe ?? l.media?.modifieLe ?? "") || 0;
  return [...lignes].sort((a, b) => Number(estActive(b)) - Number(estActive(a)) || date(b) - date(a));
}

/** État du nœud d'Égide pour une ligne : attente, cours, pause, ok, err (annulé = attente barrée côté texte). */
export function etatNoeud(l: Ligne): "attente" | "cours" | "pause" | "ok" | "err" {
  const t = l.transfert;
  if (!t) return "cours";
  if (t.etat === "pret") return "ok";
  if (t.etat === "erreur") return t.code === "annule" ? "attente" : "err";
  if (t.etat === "attente") return "attente";
  return t.pause && t.etat === "telechargement" ? "pause" : "cours";
}
