// Compte relié et transferts d'AETHRYON Cloud, vus par l'interface (la clé « desktop » reste dans le cœur Rust : elle
// n'est dans aucun de ces états). Deux petits magasins de module, lus par useSyncExternalStore :
//  - le compte : `compte_etat` au démarrage, puis chaque événement « compte » du cœur (appairage, rôle, révocation) ;
//  - les transferts du cloud : `cloud_transferts`, puis chaque événement « cloud-transfert » (progression RÉELLE).
// La section CLOUD n'existe que si le compte relié est administrateur ET le cloud ouvert sur le serveur.
import { useSyncExternalStore } from "react";
import { api, evenements } from "./api";
import type { EtatCompte, Media, TransfertCloud } from "./types";

type Ecouteur = () => void;

function magasin<T>(initial: T) {
  let valeur = initial;
  const ecouteurs = new Set<Ecouteur>();
  return {
    lire: () => valeur,
    ecrire: (v: T) => {
      valeur = v;
      for (const e of ecouteurs) e();
    },
    abonner: (e: Ecouteur) => {
      ecouteurs.add(e);
      return () => ecouteurs.delete(e);
    },
  };
}

const compte = magasin<EtatCompte | null>(null);
const transferts = magasin<TransfertCloud[]>([]);
let demarre = false;

/** Fusionne un avis de transfert (même identifiant : remplacé ; nouveau : ajouté). */
export function fusionner(liste: readonly TransfertCloud[], t: TransfertCloud): TransfertCloud[] {
  const i = liste.findIndex((x) => x.id === t.id);
  if (i < 0) return [...liste, t].slice(-60);
  const n = liste.slice();
  n[i] = t;
  return n;
}

/** Abonnements aux événements du cœur (une fois pour l'application). Hors de Tauri : rien. */
export function demarrerCompte(): void {
  if (demarre || typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  demarre = true;
  void evenements.compte((e) => compte.ecrire(e));
  void evenements.cloudTransfert((t) => transferts.ecrire(fusionner(transferts.lire(), t)));
  api.compteEtat().then((e) => compte.ecrire(e)).catch(() => {});
  api.cloudTransferts().then((l) => transferts.ecrire(l)).catch(() => {});
}

export const definirCompte = (e: EtatCompte) => compte.ecrire(e);

export function useCompte(): EtatCompte | null {
  return useSyncExternalStore(compte.abonner, compte.lire);
}

export function useTransfertsCloud(): TransfertCloud[] {
  return useSyncExternalStore(transferts.abonner, transferts.lire);
}

/** La section CLOUD est-elle offerte ? Seulement si le serveur le dit (administrateur ET cloud ouvert). */
export function cloudOuvert(e: EtatCompte | null): boolean {
  return !!e?.relie && e.cloud?.disponible === true && e.administrateur === true;
}

/** Envois vers le cloud encore en cours (niche de la chouette, pastille de la navigation). */
export function envoisActifs(l: readonly TransfertCloud[]): number {
  return l.filter((t) => t.sens === "envoi" && !["termine", "echec", "annule"].includes(t.etape)).length;
}

/** Types acceptés par le cloud (même table qu'account et que le cœur : cloud.rs, type_mime). */
const MIME: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", opus: "audio/ogg", wav: "audio/wav", flac: "audio/flac", gif: "image/gif" };

export function typeCloud(ext: string): string | null {
  const e = ext.toLowerCase();
  return Object.hasOwn(MIME, e) ? MIME[e] : null;
}

/** Un média de la bibliothèque peut-il partir vers le cloud ? (raison affichée sinon) */
export function envoiPossible(m: Pick<Media, "etat" | "ext" | "indexe">): { ok: boolean; raison: string | null } {
  if (m.etat !== "disponible") return { ok: false, raison: "Pas encore prêt" };
  // Le Cloud envoie les médias de la bibliothèque (dossiers surveillés) ; un média scanné ailleurs n'y est pas.
  if (m.indexe && !m.indexe.sources.includes("bibliotheque")) return { ok: false, raison: "Média scanné : surveillez son dossier pour l'envoyer" };
  if (!typeCloud(m.ext)) return { ok: false, raison: "Type non accepté par le Cloud (vidéo, audio ou GIF)" };
  return { ok: true, raison: null };
}
