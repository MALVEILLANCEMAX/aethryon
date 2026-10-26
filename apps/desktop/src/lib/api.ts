// Pont vers le cœur Rust (commandes Tauri). Les médias sont toujours désignés par leur identifiant d'index :
// l'interface ne transmet jamais un chemin à ouvrir. Dans les essais Playwright, `window.__TAURI_INTERNALS__` est
// remplacé par une maquette (e2e/maquette-tauri.js) : aucun appel n'est alors « réel », ce que les captures disent.
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AAnalyser, Config, Diagnostic, Etape, EtatCloud, EtatCompte, FiltresCloud, Instantane, LienCloud, ListeCloud, Media, ObjetCloud, OptionsAssistant,
  QuotaCloud, Rapport, ResultatEnvoi, ResultatUpia, Section, Transfert, TransfertCloud,
} from "./types";

export const api = {
  etat: () => invoke<Instantane>("etat"),
  modeLancement: () => invoke<string>("mode_lancement"),
  fenetrePrete: () => invoke<void>("fenetre_prete"),
  fenetre: (action: "reduire" | "agrandir" | "fermer") => invoke<void>("fenetre", { action }),
  modeFenetre: (mode: "assistant" | "app") => invoke<void>("mode_fenetre", { mode }),
  configModifier: (modif: Record<string, unknown>) => invoke<Config>("config_modifier", { modif }),
  choisirDossier: (titre: string) => invoke<string | null>("choisir_dossier", { titre }),
  choisirFichiers: () => invoke<string[]>("choisir_fichiers"),
  choisirPremiere: () => invoke<string | null>("choisir_premiere"),
  mediaAction: (id: string, action: "ouvrir" | "explorateur") => invoke<void>("media_action", { id, action }),
  importer: (ids: string[], chutier?: string) => invoke<string>("importer", { ids, chutier: chutier ?? null }),
  aAnalyser: (max: number) => invoke<AAnalyser[]>("a_analyser", { max }),
  analyseEnregistrer: (id: string, analyse: { duree?: number | null; largeur?: number | null; hauteur?: number | null; echec?: boolean }, jpeg: string | null) =>
    invoke<void>("analyse_enregistrer", { id, analyse, jpeg }),
  ajouterFichiers: (chemins: string[]) => invoke<string[]>("ajouter_fichiers", { chemins }),
  dossierAjouter: (chemin: string) => invoke<void>("dossier_ajouter", { chemin }),
  dossierRetirer: (chemin: string) => invoke<void>("dossier_retirer", { chemin }),
  transfertsEffacer: () => invoke<number>("transferts_effacer"),
  /** Nocturne : annuler une conversion de CE Desktop, ou mettre en pause / reprendre la réception de son fichier. */
  transfertPiloter: (id: string, action: "pause" | "reprendre" | "annuler") => invoke<void>("transfert_piloter", { id, action }),
  rescanner: () => invoke<void>("rescanner"),
  redetecter: () => invoke<void>("redetecter"),
  diagnostic: (premiere?: string | null) => invoke<Diagnostic>("diagnostic", { premiere: premiere ?? null }),
  assistantExecuter: (options: OptionsAssistant, premiere?: string | null) => invoke<Rapport>("assistant_executer", { options, premiere: premiere ?? null }),
  assistantAnnuler: () => invoke<void>("assistant_annuler"),
  assistantFin: () => invoke<void>("assistant_fin"),
  ouvrirPremiere: () => invoke<void>("ouvrir_premiere"),
  panneauDesinstaller: () => invoke<ResultatUpia>("panneau_desinstaller"),
  /** Setup PUBLIÉ téléchargé et vérifié comme pour « Mettre à jour », lancé sur « Réparer » ; le Desktop se ferme. */
  reparerAvecSetup: () => invoke<void>("reparer_avec_setup"),
  /** Page de téléchargement d'AETHRYON Setup (adresse figée dans le cœur). */
  ouvrirPageSetup: () => invoke<void>("ouvrir_page_setup"),
  ouvrirDossier: (quoi: "journaux" | "medias" | "racine") => invoke<void>("ouvrir_dossier", { quoi }),
  rapportExporter: () => invoke<string | null>("rapport_exporter"),
  lancerDesinstalleur: () => invoke<void>("lancer_desinstalleur"),
  quitter: () => invoke<void>("quitter"),
  webview2: () => invoke<string | null>("webview2"),
  // Compte relié (la clé reste dans le cœur Rust) et AETHRYON Cloud.
  compteEtat: () => invoke<EtatCompte>("compte_etat"),
  compteRelier: () => invoke<EtatCompte>("compte_relier"),
  compteAnnuler: () => invoke<EtatCompte>("compte_annuler"),
  compteRafraichir: () => invoke<EtatCompte>("compte_rafraichir"),
  compteDeconnecter: () => invoke<EtatCompte>("compte_deconnecter"),
  /** 3.8.1 : « Coller un lien » : conversion par ytapi avec la clé du compte relié (suivie dans Transferts). */
  convertirLien: (url: string, format: "mp4" | "mp3") => invoke<Transfert>("convertir_lien", { url, format }),
  cloudEtat: () => invoke<EtatCloud>("cloud_etat"),
  cloudObjets: (filtres: FiltresCloud) => invoke<ListeCloud>("cloud_objets", { filtres }),
  cloudLien: (id: string, usage: "telecharger" | "apercu") => invoke<LienCloud>("cloud_lien", { id, usage }),
  cloudSupprimer: (id: string) => invoke<{ objet: ObjetCloud; quota: QuotaCloud }>("cloud_supprimer", { id }),
  cloudTelecharger: (id: string) => invoke<TransfertCloud>("cloud_telecharger", { id }),
  cloudEnvoyer: (ids: string[]) => invoke<TransfertCloud[]>("cloud_envoyer", { ids }),
  cloudAnnuler: (id: string) => invoke<boolean>("cloud_annuler", { id }),
  cloudTransferts: () => invoke<TransfertCloud[]>("cloud_transferts"),
};

export const evenements = {
  changement: (f: (quoi: string) => void): Promise<UnlistenFn> => listen<string>("changement", (e) => f(e.payload)),
  mediaPret: (f: (m: Media) => void) => listen<Media>("media-pret", (e) => f(e.payload)),
  resultatCommande: (f: (r: ResultatEnvoi) => void) => listen<ResultatEnvoi>("resultat-commande", (e) => f(e.payload)),
  naviguer: (f: (s: Section) => void) => listen<Section>("naviguer", (e) => f(e.payload)),
  mode: (f: (m: string) => void) => listen<string>("mode", (e) => f(e.payload)),
  assistant: (f: (etapes: Etape[]) => void) => listen<Etape[]>("assistant-progression", (e) => f(e.payload)),
  compte: (f: (e: EtatCompte) => void) => listen<EtatCompte>("compte", (e) => f(e.payload)),
  cloudTransfert: (f: (t: TransfertCloud) => void) => listen<TransfertCloud>("cloud-transfert", (e) => f(e.payload)),
};

/** Séparateur du système (Windows : « \ »), déduit de la racine fournie par le cœur. */
export function separateur(racine: string): string {
  return racine.includes("\\") ? "\\" : "/";
}

/** Adresse `asset:` d'un fichier local servi au WebView2 (portée limitée par le cœur aux dossiers surveillés). */
export function urlFichier(chemin: string): string {
  return convertFileSrc(chemin);
}

/** Miniature d'un média (`R\bibliotheque\miniatures\<id>.jpg`), avec la date de modification pour invalider le cache. */
export function urlMiniature(racine: string, m: Media): string | null {
  // Média d'AETHRYON Index sans miniature de la bibliothèque : celle de l'index (chemin absolu, portée asset: du cœur).
  if (!m.miniature) return m.indexe?.miniatureUrl ?? null;
  const s = separateur(racine);
  return convertFileSrc(`${racine}${s}bibliotheque${s}${m.miniature.replace(/\//g, s)}`) + `?v=${encodeURIComponent(m.modifieLe)}`;
}

/** Message lisible d'une erreur renvoyée par une commande. */
export function messageErreur(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Opération impossible.";
}
