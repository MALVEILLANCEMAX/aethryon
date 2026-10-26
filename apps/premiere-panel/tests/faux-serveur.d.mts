// Types du faux serveur (tests/faux-serveur.mjs).
import type { Server } from "node:http";
export const CLE_ESSAI: string;
export interface EntreeJournal { methode: string; chemin: string; cle: boolean; origine: string | null; typeContenu: string | null; cookie: boolean; corps: any }
export interface FauxServeur {
  serveur: Server;
  base: string;
  config: { compte: string; api: string };
  journal: EntreeJournal[];
  jobs: Map<string, unknown>;
  clesRevoquees: Set<string>;
  revocations: Map<string, string>;
  fermer(): Promise<void>;
}
export function demarrerFauxServeur(o?: {
  tailleFichier?: number; attentesAvantAccord?: number; intervalle?: number; urlVerification?: string; refus?: boolean; refusJob?: boolean; longueurFausse?: boolean; lent?: boolean;
  /** 404 premiere_closed sur appairage et jeton (connexion fermée) ; sansRoutes : 404 not_found (routes absentes). */
  ferme?: boolean; sansRoutes?: boolean;
  expire?: boolean; suspendu?: boolean; tropDOrdinateurs?: boolean;
  /** Intervalle minimal entre deux interrogations d'un même code (429 trop-rapide + Retry-After sinon). */
  cadenceMs?: number; retryAfter?: number;
}): Promise<FauxServeur>;
