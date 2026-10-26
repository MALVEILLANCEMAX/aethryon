// Interface « Hote » : la SEULE porte entre l'interface web AETHRYON et ce qui l'entoure.
// Trois implémentations :
//   - cep.ts          : Premiere 25.x–26.x, extension CEP 12 (CSInterface, ExtendScript figé, Node.js 17) ;
//   - uxp-webview.ts  : future coque UXP (<webview> + pont postMessage), ébauche qui compile, documentée ;
//   - maquette.ts     : hôte simulé pour les essais et les captures (aucun Premiere, aucun réseau réel).
// L'interface ne parle jamais directement à Node, à ExtendScript ni au réseau : tout passe par ici, ce qui permet de
// changer de coque sans toucher aux pages.

import type { EntreeDossier } from "../lib/bibliotheque";

export type NomHote = "cep" | "uxp-webview" | "maquette" | "banc";

// ---- Réseau --------------------------------------------------------------------------------------------------------------
export interface RequeteHttp {
  methode: "GET" | "POST" | "DELETE";
  url: string;
  entetes?: Record<string, string>;
  /** Corps JSON (sérialisé par l'hôte). */
  json?: unknown;
  /** « binaire » : corps rendu en base64 (miniatures). */
  reponse?: "json" | "binaire";
  delaiMs?: number;
}

export interface ReponseHttp {
  statut: number;
  entetes: Record<string, string>;
  /** JSON analysé (null si vide ou illisible). */
  json: unknown;
  /** Base64 quand reponse = « binaire ». */
  base64?: string;
  typeContenu?: string;
}

export interface RequeteTelechargement {
  url: string;
  entetes?: Record<string, string>;
  dossier: string;
  /** Nom souhaité (nettoyé et rendu unique par l'hôte : jamais d'écrasement). */
  nomSouhaite: string;
  /** Taille annoncée par le serveur, vérifiée à la fin quand elle est connue. */
  tailleAttendue?: number | null;
}

export interface ResultatTelechargement {
  chemin: string;
  taille: number;
}

export type SuiviOctets = (recus: number, total: number | null) => void;

// ---- Premiere -----------------------------------------------------------------------------------------------------------
export type ModeChutier = "aethryon" | "selection" | "racine";

export interface InfoProjet {
  nom: string;
  chemin: string | null;
  /** Nom du chutier sélectionné dans le panneau Projet (getInsertionBin), si connu. */
  chutierSelectionne: string | null;
  sequenceActive: string | null;
}

export interface ResultatImportFichier {
  chemin: string;
  ok: boolean;
  /** Déjà présent dans le projet : aucun second import. */
  deja?: boolean;
  /** Importé mais hors ligne (codec refusé). */
  horsLigne?: boolean;
  code?: "exception" | "absentApres" | "introuvable" | "aucunProjet";
  detail?: string;
}

export interface BilanImport {
  ok: boolean;
  chutier: string | null;
  projet: string | null;
  resultats: ResultatImportFichier[];
  message?: string;
}

export interface ResultatAction {
  ok: boolean;
  message?: string;
  detail?: string;
}

export interface ResultatEssaiImport extends ResultatAction {
  chutierTemporaire?: string;
  importe?: boolean;
  nettoye?: boolean;
  dureeMs?: number;
}

export interface PremiereHote {
  projet(): Promise<InfoProjet | null>;
  /** importFiles dans le chutier visé, puis vérification par chemin dans le projet (aucun import à l'aveugle). */
  importer(chemins: string[], mode: ModeChutier): Promise<BilanImport>;
  /** Parmi ces chemins, ceux déjà présents dans le projet ouvert. */
  presentsDansProjet(chemins: string[]): Promise<string[]>;
  /** Parmi ces chemins, ceux utilisés dans la séquence active (preuve du glisser vers la timeline). */
  presentsDansSequence(chemins: string[]): Promise<string[]>;
  insererTeteLecture(chemin: string, mode: ModeChutier): Promise<ResultatAction>;
  ouvrirMoniteurSource(chemin: string): Promise<ResultatAction>;
  /** Diagnostic : chutier temporaire, import du petit fichier, vérification, puis nettoyage. */
  essaiImport(chemin: string): Promise<ResultatEssaiImport>;
}

// ---- Fichiers ------------------------------------------------------------------------------------------------------------
export interface FichiersHote {
  existe(chemin: string): Promise<boolean>;
  lister(dossier: string): Promise<EntreeDossier[] | null>;
  lireTexte(chemin: string): Promise<string | null>;
  /** Écriture atomique : <fichier>.p<hex>-<n>.tmp puis renommage (contrat §9). */
  ecrireTexte(chemin: string, texte: string): Promise<void>;
  /** Écrit des octets (base64) — miniatures en cache, fichier d'essai du diagnostic. */
  ecrireBase64(chemin: string, base64: string): Promise<void>;
  creerDossier(chemin: string): Promise<void>;
  /** Supprime UN fichier que le panneau a lui-même créé (cache, essai, .part) ; refuse tout le reste. */
  supprimerFichierInterne(chemin: string): Promise<void>;
  /**
   * Déplace UN fichier .json d'échange avec AETHRYON Desktop (R\commandes\a-traiter → R\commandes\traitees : prise
   * d'une commande par renommage, contrat §9) ; refuse tout autre dossier. Échoue si la source n'existe plus (commande
   * déjà prise ou expirée par le Desktop).
   */
  renommer(source: string, destination: string): Promise<void>;
  /** Vérifie qu'on peut écrire dans le dossier (création puis suppression d'un fichier témoin). */
  testerEcriture(dossier: string): Promise<ResultatAction>;
  joindre(...parties: string[]): string;
  /** Adresse utilisable par <video>/<img> (file:///… en CEP). */
  urlLocale(chemin: string): string;
  /** Espace libre du disque qui porte ce dossier, en octets, si mesurable. */
  espaceLibre(dossier: string): Promise<number | null>;
}

// ---- Coffre (clé personnelle) ---------------------------------------------------------------------------------------------
export type ProtectionCle = "dpapi" | "acl" | "memoire";

export interface CleStockee {
  cle: string;
  expireLe: string | null;
  compte: { email: string; nom: string } | null;
  enregistreeLe: string;
}

export interface CoffreHote {
  lire(): Promise<CleStockee | null>;
  ecrire(c: CleStockee): Promise<ProtectionCle>;
  effacer(): Promise<void>;
  protection(): Promise<ProtectionCle | null>;
}

// ---- Environnement et capacités -------------------------------------------------------------------------------------------
export interface Environnement {
  hote: NomHote;
  premiereVersion: string | null;
  cepVersion: string | null;
  nodeVersion: string | null;
  chromiumVersion: string | null;
  os: string | null;
  nomMachine: string | null;
  /** %USERPROFILE%\Downloads\AETHRYON par défaut (contrat d'échange §1). */
  dossierMediasParDefaut: string;
  /** %APPDATA%\AETHRYON\premiere : réglages, récents, clé protégée. */
  dossierDonnees: string;
  /** %LOCALAPPDATA%\AETHRYON : racine des échanges avec AETHRYON Desktop (facultatif). */
  racineEchanges: string;
  extensionVersion: string;
  /** Dossier de l'extension installée (signature : META-INF/signatures.xml). */
  dossierExtension: string | null;
  posix: boolean;
}

export interface EtatSignature {
  /** « signee » : META-INF/signatures.xml présent (la validité est contrôlée par Premiere au chargement). */
  etat: "signee" | "non-signee" | "inconnu";
  /** PlayerDebugMode posé dans le registre (CSXS.12) : Premiere accepte alors les extensions non signées. */
  modeDebogage: boolean | null;
  detail: string;
}

export interface Capacites {
  /** Glisser vers Premiere par dataTransfer (com.adobe.cep.dnd.file.N) : documenté sans format, à prouver. */
  glisserVersPremiere: "oui" | "non" | "a-prouver";
  lectureVideoLocale: boolean;
  premiere: boolean;
  reseau: boolean;
  coffre: ProtectionCle;
  choisirDossier: boolean;
  afficherDansExplorateur: boolean;
}

export interface Hote {
  readonly nom: NomHote;
  environnement(): Promise<Environnement>;
  capacites(): Promise<Capacites>;
  signature(): Promise<EtatSignature>;

  http(req: RequeteHttp): Promise<ReponseHttp>;
  telecharger(req: RequeteTelechargement, suivi: SuiviOctets, signal?: AbortSignal): Promise<ResultatTelechargement>;

  fichiers: FichiersHote;
  premiere: PremiereHote;
  coffre: CoffreHote;

  /** Ouvre une adresse https dans le navigateur par défaut (jamais dans le panneau). */
  ouvrirUrl(url: string): Promise<void>;
  afficherDansExplorateur(chemin: string): Promise<ResultatAction>;
  choisirDossier(initial: string, titre: string): Promise<string | null>;
  copierTexte(texte: string): Promise<boolean>;

  /**
   * Prépare le glisser d'une carte vers Premiere. Renvoie les formats réellement posés (vide si aucun) ;
   * chaque format est posé séparément, dans un try, pour qu'un refus n'annule pas les autres.
   */
  preparerGlisser(dt: DataTransfer, chemins: string[]): string[];

  /** Appelé quand le panneau est montré ou caché (aucune interrogation quand il est caché). */
  surVisibilite(f: (visible: boolean) => void): () => void;
  /** Menu du panneau (≡ en haut à droite dans Premiere). */
  definirMenu(entrees: { id: string; libelle: string; separateur?: boolean }[], f: (id: string) => void): void;
  /** Touches que le panneau veut recevoir quand il a le focus (J K L, espace, flèches dans l'aperçu). */
  touchesVoulues(codes: number[]): void;

  journaliser(niveau: "info" | "attention" | "erreur", message: string): void;
}
