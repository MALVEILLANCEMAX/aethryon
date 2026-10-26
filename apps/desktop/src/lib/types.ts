// Types partagés avec le cœur Rust (noyau/) et le contrat d'échange v1 (C-CONTRAT-ECHANGES.md).

export type TypeMedia = "video" | "audio" | "image";
export type EtatMedia = "disponible" | "en-cours" | "introuvable" | "erreur";

export interface Media {
  id: string;
  chemin: string;
  nom: string;
  ext: string;
  type: TypeMedia;
  taille: number;
  ajouteLe: string;
  modifieLe: string;
  duree: number | null;
  largeur: number | null;
  hauteur: number | null;
  ips: number | null;
  codecVideo: string | null;
  codecAudio: string | null;
  miniature: string | null;
  etat: EtatMedia;
  erreur?: string;
  premiereCompatible: boolean | null;
  origine: { plateforme: string; titre: string | null };
  /** Nocturne-2 : média lu dans AETHRYON Index (Bibliothèque unifiée) : sources, volume, dossier, état du fichier,
   *  importable par le panneau (dossier surveillé), adresse de sa miniature. Absent : média de l'instantané seul. */
  indexe?: MediaIndexe;
}

export interface MediaIndexe {
  sources: ("index" | "everything" | "bibliotheque")[];
  volume: string | null;
  dossier: string;
  /** Fichier « en ligne seulement » (OneDrive…) : jamais ouvert par AETHRYON. */
  enLigne: boolean;
  etatFichier: "present" | "absent" | "indisponible";
  /** Seulement les médias d'index.json (contrat du panneau) ; un média scanné ailleurs passe par « Surveiller ce dossier ». */
  importable: boolean;
  miniatureUrl: string | null;
  doublons: number;
}

export interface Index {
  schema: number;
  misAJour: string;
  dossiers: { chemin: string; principal: boolean }[];
  medias: Media[];
}

export type Theme = "systeme" | "clair" | "sombre";
export type Animations = "systeme" | "oui" | "non";
export type Chutier = "aethryon" | "selection" | "racine";

export interface Config {
  schema: number;
  dossierMedias: string;
  dossiersSurveilles: string[];
  surveillance: boolean;
  demarrageAuto: boolean;
  notifications: { mediaPret: boolean; importReussi: boolean; erreurs: boolean };
  theme: Theme;
  reduireAnimations: Animations;
  importAuto: boolean;
  chutierParDefaut: Chutier;
  premiere: { ccxInstalle: string | null; installeLe: string | null };
}

export type EtatTransfert = "attente" | "telechargement" | "conversion" | "pret" | "erreur";

export interface Transfert {
  schema: number;
  id: string;
  titre: string | null;
  plateforme: string | null;
  format: string | null;
  etat: EtatTransfert;
  progression: number | null;
  fichierAttendu: string | null;
  chemin: string | null;
  erreur: string | null;
  majLe: string;
  /** 3.8.1 : conversion du Desktop (« Coller un lien ») ou relais de l'extension (« Envoyer vers › Premiere Pro »). */
  origine?: "desktop" | "extension";
  /** 3.8.1 : import dans Premiere Pro demandé par le Desktop, et son résultat réel. */
  premiere?: "demande" | "importe" | "non-connecte" | "sans-projet" | "echec";
  /** 3.8.1 : code stable d'une erreur (non_relie, quota_exceeded…). */
  code?: string;
  /** Nocturne : octets reçus par le Desktop (conversions qu'il télécharge), total annoncé, débit MESURÉ (octets/s). */
  recus?: number;
  total?: number;
  vitesse?: number;
  /** Nocturne : réception du fichier en pause (demandée dans Transferts). */
  pause?: boolean;
}

export interface BattementPanneau {
  schema: number;
  version: string | null;
  battement: string;
  premiereVersion: string | null;
  projetOuvert: boolean | null;
  projet: string | null;
  visible: boolean | null;
}

export interface InstallPremiere {
  exe: string;
  dossier: string;
  version: string | null;
  compatible: boolean | null;
  glisser: boolean | null;
  beta: boolean;
  source: string;
}

export interface DetectionPremiere {
  installations: InstallPremiere[];
  principale: InstallPremiere | null;
  cherche: string[];
  enCours: boolean | null;
}

export interface CreativeCloud {
  upia: string | null;
  application: string | null;
}

/** Panneau AETHRYON v2 : extension CEP posée par AETHRYON Setup (%APPDATA%\Adobe\CEP\extensions\fr.aethryon.premiere). */
export interface PanneauCep {
  dossier: string;
  /** ExtensionBundleVersion de CSXS/manifest.xml (« 2.0.1 »), null si illisible. */
  version: string | null;
  /** « Panneau AETHRYON 2.0.1 installé ». */
  libelle: string;
}

export interface EtatNavigateur {
  navigateur: string;
  enregistre: boolean;
  message: string | null;
}

export interface ResultatEnvoi {
  nom: string;
  action: string;
  ids: string[];
  ok: boolean;
  message: string;
  le: string;
  /** La commande a expiré (2 minutes sans réponse du panneau). */
  expire?: boolean;
}

export interface ImportFait {
  projet: string | null;
  chutier: string | null;
  le: string | null;
}

export interface Instantane {
  version: string;
  plateforme: string;
  config: Config;
  assistantTermine: boolean;
  racine: string;
  dossierConfig: string;
  index: Index;
  transferts: Transfert[];
  liaison: { connecte: boolean; age: number | null; panneau: BattementPanneau | null };
  imports: { schema: number; imports: Record<string, ImportFait[]> };
  premiere: DetectionPremiere;
  creativeCloud: CreativeCloud;
  panneauCep: PanneauCep | null;
  nativeMessaging: EtatNavigateur[];
  demarrageActif: boolean;
  desinstallationPresente: boolean;
  erreursDossiers: [string, string][];
  journaux: [number, number];
  resultats: ResultatEnvoi[];
  enAttente: string[];
  /** Nocturne : transferts que CE Desktop reçoit lui-même (annulables ; pause pendant la réception du fichier). */
  transfertsPilotables?: string[];
}

export interface Diagnostic {
  premiere: DetectionPremiere;
  creativeCloud: CreativeCloud;
  panneau: PanneauCep | null;
  panneauPresent: boolean;
  dossierDefaut: string;
  espaceLibre: number | null;
  dureeMs: number;
  plateforme: string;
}

export type EtatEtape = "attente" | "en-cours" | "ok" | "ignore" | "a-confirmer" | "erreur";

export interface Operation {
  libelle: string;
  etat: EtatEtape;
  message: string | null;
  dureeMs: number;
}

export interface Etape {
  numero: number;
  titre: string;
  description: string;
  etat: EtatEtape;
  dureeMs: number;
  operations: Operation[];
}

export interface Rapport {
  etapes: Etape[];
  reussi: boolean;
  annule: boolean;
  version: string;
  panneau: { statut: "installe" | "a-confirmer" | "non-installe" | "ignore"; version: string | null; message: string };
  dossierMedias: string;
  premiere: InstallPremiere | null;
  dureeMs: number;
}

export interface OptionsAssistant {
  dossierMedias: string;
  surveillance: boolean;
  demarrageAuto: boolean;
  installerPanneau: boolean;
  notifications: "toutes" | "importantes" | "aucune";
}

export interface AAnalyser {
  id: string;
  chemin: string;
  type: TypeMedia;
  ext: string;
}

export interface ResultatUpia {
  ok: boolean;
  code: number | null;
  message: string;
  sortie: string;
}

export type Section = "accueil" | "bibliotheque" | "musique" | "transferts" | "cloud" | "integrations" | "parametres"
  /** Écran du scanner AETHRYON Index (feat/index) : seulement s'il est présent dans la construction (lib/scanner.ts). */
  | "scanner";

// ---- Compte relié et AETHRYON Cloud (noyau/src/compte.rs, cloud.rs) : jamais la clé, seulement ces états ----------

export interface AppairageVu {
  codeUtilisateur: string;
  url: string;
  expireLe: string;
  etat: "en-attente" | "autorise" | "refuse" | "expire" | "deja-utilise" | "erreur";
  message: string | null;
}

export interface EtatCompte {
  relie: boolean;
  compte: { email: string; nom: string } | null;
  administrateur: boolean | null;
  cloud: { disponible: boolean; raison: "non_admin" | "ferme" | null } | null;
  cleExpireLe: string | null;
  relieLe: string | null;
  appairage: AppairageVu | null;
  erreur: string | null;
  horsLigne: boolean;
  verifieLe: string | null;
}

export interface QuotaCloud { max: number; utilise: number; reserve: number; sauvegarde: number; disponible: number }
export interface EtatCloud { actif: boolean; quota: QuotaCloud; retentionJours: number; tailleMaxFichier: number; sauvegardeAuto: boolean }
export type StatutCloud = "en_attente" | "envoi_en_cours" | "sauvegarde" | "echec" | "suppression_en_attente" | "expire" | "supprime";
export interface ObjetCloud {
  id: string; nom: string; type: string; taille: number; statut: StatutCloud; libelle: string; origine: string; plateforme: string | null;
  creeLe: string; envoyeLe: string | null; expireLe: string | null; expireDansJours: number | null; sha256: string | null; erreur: string | null; apercu: boolean;
  /** Bibliothèque musicale du cloud (`musique=1`) : fiche gardée à part de l'audio, disponibilité, réimport. */
  musique?: { connecteur: string; titre: string | null; artistes: string[]; album: string | null; date: string | null; licence: { code: string; nom: string } | null; attribution: string | null; sourceUrl: string | null; pochetteUrl: string | null; audio: Record<string, unknown> | null } | null;
  audioDisponible?: boolean;
  reimport?: { possible: boolean; url: string; connecteur: string; attestationRequise: boolean } | null;
}
export interface ListeCloud { items: ObjetCloud[]; total: number; page: number; taillePage: number; quota: QuotaCloud | null }
export interface LienCloud { url: string; expireLe: string; usage: "telecharger" | "apercu" }
export interface FiltresCloud { q: string; statut: string; type: string; tri: string; page: number; musique?: boolean }
export type EtapeTransfertCloud = "attente" | "verification" | "envoi" | "confirmation" | "telechargement" | "termine" | "echec" | "annule";
export interface TransfertCloud {
  id: string; sens: "envoi" | "telechargement"; mediaId: string | null; objetId: string | null; nom: string; taille: number;
  etape: EtapeTransfertCloud; fait: number; total: number; statut: string | null; code: string | null; message: string | null;
  chemin: string | null; creeLe: string; finiLe: string | null;
}
