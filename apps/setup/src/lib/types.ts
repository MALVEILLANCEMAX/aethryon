// Types échangés avec le moteur Rust (serde, camelCase). Ils décrivent ce que le moteur MESURE sur le PC.

export type Notifications = "toutes" | "importantes" | "aucune";

export interface Options {
  extension: boolean;
  desktop: boolean;
  dossierMedias: string;
  surveillance: boolean;
  demarrageAuto: boolean;
  notifications: Notifications;
}

export interface InstallPremiere {
  exe: string;
  dossier: string;
  version: string | null;
  compatible: boolean | null;
  beta: boolean;
  source: string;
}

export interface Inventaire {
  version: string;
  installeLe: string;
  misAJourLe: string;
  options: Options;
  versionDesktop: string | null;
  versionExtension: string | null;
  dossierExtension: string | null;
}

export interface InstallationExistante {
  version: string;
  dossier: string;
  inventaire: Inventaire | null;
}

export interface Detection {
  premiere: InstallPremiere[];
  principale: InstallPremiere | null;
  cherche: string[];
  premiereOuvert: boolean;
  intervalleExtension: string;
  creativeCloud: string | null;
  webview2: string | null;
  windows: string | null;
  dossierExtensions: string;
  playerDebugMode: string[];
  extensionPresente: string | null;
  extensionEstLien: boolean;
  installation: InstallationExistante | null;
  ancienneBeta: string | null;
  desktopOuvert: boolean;
  espaceLibre: number | null;
  dureeMs: number;
}

export type Action = "reparer" | "mettreAJour" | "desinstaller";

export interface InfoCharge {
  version: string;
  versionDesktop: string | null;
  versionExtension: string;
  extensionRemplacant: boolean;
  tailleDesktop: number;
  tailleExtension: number;
  intervallePremiere: string;
  signature: Record<string, string>;
  /** Extension navigateur embarquée (dossier géré %LOCALAPPDATA%\AETHRYON\extension), si la charge en contient une. */
  versionNavigateur?: string | null;
}

export interface EtatInitial {
  mode: "installation" | "maintenance";
  demande: "normal" | "maintenance" | "desinstaller" | "mettreAJour";
  actions: Action[];
  charge: InfoCharge;
  options: Options;
  detection: Detection;
  journal: string | null;
}

export type Etat = "attente" | "enCours" | "termine" | "echec" | "annule" | "ignore";

export interface SousEtape {
  libelle: string;
  etat: Etat;
  detail: string | null;
  dureeMs: number | null;
}

export interface Etape {
  cle: string;
  titre: string;
  description: string;
  etat: Etat;
  sous: SousEtape[];
  fait: number;
  total: number;
  dureeMs: number | null;
  resume: string | null;
}

export interface Resultat {
  version: string;
  versionDesktop: string | null;
  versionExtension: string | null;
  extensionRemplacant: boolean;
  dossierMedias: string;
  dossierInstallation: string;
  dossierExtension: string | null;
  exeDesktop: string | null;
  premiereOuvert: boolean;
  /** Version de la bêta NSIS remplacée par cette installation (null s'il n'y en avait pas). */
  ancienneBetaRemplacee: string | null;
  versionNavigateur?: string | null;
  dossierNavigateur?: string | null;
  avertissements: string[];
}

export interface Avancement {
  operation: "installer" | "reparer" | "mettreAJour" | "desinstaller";
  etapes: Etape[];
  courante: number;
  termine: boolean;
  succes: boolean;
  annule: boolean;
  erreur: string | null;
  retourArriere: string[];
  ecouleMs: number;
  resultat: Resultat | null;
}

export type Operation = "installer" | "reparer" | "mettreAJour";
