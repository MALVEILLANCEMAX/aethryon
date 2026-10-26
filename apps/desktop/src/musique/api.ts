// Commandes du cœur pour la section MUSIQUE (commandes_musique.rs). Chargé avec la section : le JS de démarrage n'en
// porte rien. Aucune clé ni aucun chemin ne transite : identifiants d'index, liens https, corps d'import filtré.
import { invoke } from "@tauri-apps/api/core";
import type { EntreeHistorique, EtatLecture, Fiche, FicheEnregistree, ImportSuivi, Playlist, VueMusique } from "./types";

export type OpPlaylist =
  | { op: "creer"; nom: string; pistes?: string[] }
  | { op: "renommer"; id: string; nom: string }
  | { op: "supprimer"; id: string }
  | { op: "ajouter"; id: string; pistes: string[]; position?: number }
  | { op: "retirer"; id: string; position: number }
  | { op: "deplacer"; id: string; de: number; vers: number }
  | { op: "reordonner"; id: string; pistes: string[] };

export interface Presentation { url: string; connecteur: string; titre: string | null; artistes: string[]; pochette: string | null }

export const musiqueApi = {
  vue: () => invoke<VueMusique>("musique_vue"),
  playlists: (op: OpPlaylist) => invoke<{ playlists: Playlist[]; id: string | null }>("musique_playlists", { op }),
  noter: (entree: Partial<EntreeHistorique> & Pick<EntreeHistorique, "action" | "url">) => invoke<EntreeHistorique[]>("musique_historique_noter", { entree }),
  effacerHistorique: () => invoke<void>("musique_historique_effacer"),
  enregistrerFiche: (fiche: Partial<FicheEnregistree> & { url: string }) => invoke<FicheEnregistree[]>("musique_fiche_enregistrer", { fiche }),
  retirerFiche: (url: string) => invoke<FicheEnregistree[]>("musique_fiche_retirer", { url }),
  lecture: (etat: EtatLecture) => invoke<EtatLecture>("musique_lecture", { etat }),
  ouvrirLien: (url: string) => invoke<void>("musique_ouvrir_lien", { url }),
  connecteurs: () => invoke<{ connecteurs: { id: string; nom: string; actif: boolean; capacites: string[]; limites?: string[] }[] }>("musique_connecteurs"),
  analyser: (url: string, typeLien?: "podcast" | "fichier") => invoke<{ fiche: Fiche }>("musique_analyser", { url, typeLien: typeLien ?? null }),
  rechercher: (q: string, source: string) => invoke<{ resultats: Fiche[]; source: string }>("musique_rechercher", { q, source }),
  synchroniser: (url: string) => invoke<{ resultat: { playlist: { titre: string | null; total: number }; stats: { titres: number; correspondancesSures: number; correspondancesProbables: number; sansFichier: number } }; playlists: Playlist[] }>("musique_synchroniser", { url }),
  importer: (corps: Record<string, unknown>, presentation: Presentation) => invoke<ImportSuivi>("musique_importer", { corps, presentation }),
  imports: () => invoke<ImportSuivi[]>("musique_imports"),
  annulerImport: (id: string) => invoke<boolean>("musique_import_annuler", { id }),
};
