// Types de la section MUSIQUE, miroirs EXACTS du cœur (noyau/src/musique/*.rs) et de l'API AETHRYON Music
// (cloud-music/MUSIC-API.md §4). Chargés avec la section seulement.

export interface Qualite { codec: string; conteneur: string; debitKbps: number | null; frequenceHz: number | null; bits: number | null; canaux: number | null; sansPerte: boolean }
export interface Provenance { connecteur: string; sourceUrl: string | null; licence: Licence | null; attribution: string | null; attestation: boolean; importId: string | null; importeLe: string; cloud: CloudImport | null }
export interface Piste {
  id: string; titre: string; artistes: string[]; album: string | null; artisteAlbum: string | null; numero: number | null; disque: number | null;
  annee: number | null; genre: string | null; isrc: string | null; dureeS: number | null; qualite: Qualite; pochette: string | null;
  etiquetage: "ok" | "absentes" | "illisible"; erreur?: string; empreinte: string; provenance?: Provenance;
}
export interface TitreIdentifie { position: number; titre: string; artistes: string[]; dureeS: number | null }
export interface SourcePlaylist { connecteur: string; url: string; titre: string | null; snapshot: string | null; synchroniseeLe: string; sansFichier: TitreIdentifie[] }
export interface Playlist { id: string; nom: string; pistes: string[]; creeLe: string; modifieLe: string; source?: SourcePlaylist }
export interface EntreeHistorique {
  id: string; quand: string; action: "analyse" | "import" | "enregistrement" | "synchronisation"; url: string; connecteur: string; titre: string | null;
  artistes: string[]; pochette: string | null; etat: string; importId: string | null; mediaId: string | null; erreur: string | null;
}
export interface FicheEnregistree { url: string; connecteur: string; type: string; titre: string | null; artistes: string[]; album: string | null; pochette: string | null; dureeS: number | null; etat: string; enregistreeLe: string }
export type Repetition = "non" | "tout" | "un";
export interface EtatLecture { file: string[]; index: number; positionS: number; aleatoire: boolean; repetition: Repetition; volume: number; majLe: string }
export interface VueMusique { pistes: Piste[]; playlists: Playlist[]; historique: EntreeHistorique[]; fiches: FicheEnregistree[]; lecture: EtatLecture; dossierPochettes: string }

// ---- API AETHRYON Music -------------------------------------------------------------------------------------------
export type Capacite = "Metadata" | "Search" | "Preview" | "Playback" | "AuthorizedDownload" | "Import";
export type EtatFiche = "lien_reconnu" | "identifie" | "correspondance" | "telechargeable";
export interface Licence { code: string; nom: string; url?: string | null; libre: boolean; attribution_requise?: boolean }
export interface FichierSource { nom: string; url?: string; extension?: string; type?: string; taille?: number | null; format?: string | null; dureeS?: number | null; original?: boolean }
export interface PisteFiche { titre: string; artistes: string[]; album?: string | null; dureeS?: number | null; isrc?: string | null; numero?: number | null; url?: string | null; id?: string | null; pochette?: string | null; fichiers?: FichierSource[] }
export interface Action {
  id: "ouvrir" | "lecteur_officiel" | "apercu" | "ecouter" | "enregistrer_lien" | "importer" | string;
  libelle?: string; url?: string; embed?: string; hauteur?: number; note?: string; mention?: string; dureeS?: number; type?: string;
  lien?: { libelle: string; url: string };
  requete?: { methode: string; chemin: string; corps: Record<string, unknown> };
  attestationRequise?: boolean; attestation?: string;
}
export interface Fiche {
  connecteur: string; type: string; id?: string | null; url: string; etat: EtatFiche; titre: string | null; artistes: string[]; album?: string | null;
  dureeS?: number | null; isrc?: string | null; date?: string | null; pochette?: string | null; pistes?: PisteFiche[]; pistesTotal?: number | null;
  licence?: Licence | null; attribution?: string | null; capacites: Capacite[]; actions: Action[]; restrictions?: string[]; manque?: string[];
  avertissements?: string[]; sourceMetadonnees?: string;
}
export interface CloudImport { etat: string; libelle: string; raison?: string | null }
export interface Avancement { octets: number; total: number | null }
export interface ImportSuivi {
  id: string; distant: string | null; url: string; connecteur: string; titre: string | null; artistes: string[]; pochette: string | null;
  etape: "demande" | "en_file" | "telechargement" | "verification" | "etiquetage" | "rapatriement" | "termine" | "echec" | "annule";
  serveur: Avancement | null; local: Avancement | null; licence: Licence | null; attribution: string | null; cloud: CloudImport | null; audio: Record<string, unknown> | null;
  code: string | null; message: string | null; chemin: string | null; mediaId: string | null; majLe: string;
}
