// Client TypeScript d'AETHRYON Index (scanner de médias locaux). Formes EXACTES du cœur Rust
// (noyau/src/index/, sérialisation camelCase) ; commandes Tauri de src-tauri/src/commandes_index.rs ; doc : desktop/INDEX.md.
// Les médias sont désignés par leur identifiant (SHA-1 du chemin normalisé, même règle qu'index.json) : l'interface
// ne transmet jamais un chemin à ouvrir. Seules les cibles d'un scan et l'emplacement de l'index sont des chemins.
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { nombre, NBSP } from "./format";
import type { EtatMedia, TypeMedia } from "./types";

// ---- Types ---------------------------------------------------------------------------------------------------------

export type GenreCible = "dossier" | "volume" | "tous";
/** Cible d'un scan : un dossier (récursif), un disque entier (`E:\`), ou tous les disques disponibles. */
export interface Cible {
  genre: GenreCible;
  chemin: string;
}

export type GenreVolume = "fixe" | "amovible" | "reseau" | "optique" | "memoire" | "inconnu";

export interface StatVolume {
  fichiers: number;
  video: number;
  audio: number;
  image: number;
  indisponibles: number;
  dernierScan: string | null;
}

export interface VolumeIndex {
  racine: string;
  lettre: string | null;
  nom: string | null;
  genre: GenreVolume;
  systemeFichiers: string | null;
  taille: number | null;
  libre: number | null;
  disponible: boolean;
  /** Raison d'une indisponibilité (lecteur vide, réseau injoignable…). */
  message: string | null;
  serie: string | null;
  cle: string | null;
  guid: string | null;
  /** Volume qui porte Windows. */
  systeme: boolean;
  /** Lecteur `subst` (un dossier présenté comme un disque). */
  substitue: boolean;
  /** NTFS local : renommages, déplacements et doublons reconnus par l'identifiant de fichier. */
  idsFiables: boolean;
  indexe: StatVolume;
  /** Ce volume est une cible enregistrée. */
  cible: boolean;
}

export type ModeEverything = "desactive" | "auto";

export interface ReglagesIndex {
  schema: number;
  cibles: Cible[];
  types: { video: boolean; audio: boolean; image: boolean };
  extensions: { video: string[]; audio: string[]; image: string[] };
  exclusions: string[];
  exclureCaches: boolean;
  suivreLiens: boolean;
  tailleMin: number;
  fils: number;
  /** Dossier de l'index, du cache et des miniatures (`null` : R\index). Changé par `deplacerEmplacement`. */
  emplacement: string | null;
  everything: ModeEverything;
  surveiller: boolean;
  metadonnees: boolean;
  miniatures: boolean;
}

/** Modification partielle acceptée par `index_reglages_modifier` (l'emplacement se change par migration). */
export type ModifReglagesIndex = Partial<Omit<ReglagesIndex, "schema" | "emplacement" | "types" | "extensions">> & {
  types?: Partial<ReglagesIndex["types"]>;
  extensions?: Partial<ReglagesIndex["extensions"]>;
};

export interface Bilan {
  nouveaux: number;
  modifies: number;
  renommes: number;
  deplaces: number;
  supprimes: number;
  doublons: number;
  inchanges: number;
  retrouves: number;
  indisponibles: number;
  retires: number;
}

export interface CompteTypes {
  video: number;
  audio: number;
  image: number;
}

export type Phase = "preparation" | "parcours" | "everything" | "rapprochement" | "termine";

export interface ProgressionScan {
  scan: number;
  phase: Phase;
  mode: "natif" | "everything" | "mixte";
  cibles: string[];
  fichiersVus: number;
  dossiers: number;
  medias: CompteTypes;
  octets: number;
  erreurs: number;
  liensIgnores: number;
  exclus: number;
  bouclesEvitees: number;
  bilan: Bilan;
  /** Vrai seulement si un total réel est connu (mode Everything) : sinon progression INDÉTERMINÉE. */
  mesurable: boolean;
  fraction: number | null;
  dossierCourant: string | null;
  /** Fichiers vus par seconde. */
  debit: number;
  ecouleMs: number;
}

export interface ErreurScan {
  chemin: string;
  message: string;
}

export interface ResumeScan {
  scan: number;
  etat: "termine" | "annule" | "erreur";
  mode: "natif" | "everything" | "mixte";
  debut: string;
  fin: string;
  dureeMs: number;
  cibles: string[];
  medias: CompteTypes;
  totalMedias: number;
  fichiersVus: number;
  dossiers: number;
  octets: number;
  erreurs: number;
  /** 200 premières erreurs (le compte, lui, est complet). */
  erreursListe: ErreurScan[];
  liensIgnores: number;
  exclus: number;
  bouclesEvitees: number;
  bilan: Bilan;
  /** Cibles sur un disque débranché : leurs fichiers sont « indisponibles », pas supprimés. */
  volumesIndisponibles: string[];
  message: string | null;
  debit: number;
}

export interface TotauxIndex {
  video: number;
  audio: number;
  image: number;
  total: number;
  indisponibles: number;
  absents: number;
  doublons: number;
  metadonneesAFaire: number;
  miniaturesAFaire: number;
  dossiers: number;
}

export interface Enrichissement {
  phase: "metadonnees" | "miniatures" | "repos";
  fait: number;
  total: number;
  actif: boolean;
}

export interface Migration {
  etape: "base" | "miniatures" | "verification" | "bascule" | "termine" | "erreur";
  fait: number;
  total: number;
  message: string | null;
}

export interface EtatEverything {
  disponible: boolean;
  version: string | null;
  baseChargee: boolean;
  raison: string | null;
}

export interface EtatIndex {
  /** Scan en cours (dernière progression), ou `null`. */
  scan: ProgressionScan | null;
  dernier: ResumeScan | null;
  /** Cibles d'un scan interrompu (coupure, fermeture) : « Reprendre » = `lancerScan(interrompu)`. */
  interrompu: Cible[] | null;
  totaux: TotauxIndex;
  emplacement: string;
  tailleIndex: number;
  enrichissement: Enrichissement;
  everything: EtatEverything;
  modeEverything: ModeEverything;
  /** Dossiers surveillés en direct. */
  veille: string[];
  migration: boolean;
}

export type EtatFichier = "present" | "absent" | "indisponible";
export type SourceIndex = "index" | "everything" | "bibliotheque";
export type TriIndex = "ajout" | "nom" | "taille" | "date" | "duree" | "chemin" | "type";

export interface RequeteIndex {
  /** Mots (préfixes, sans casse ni accents) cherchés dans le nom et les étiquettes. */
  texte?: string;
  dansChemin?: boolean;
  types?: TypeMedia[];
  /** Racines de volumes (`E:\`). */
  volumes?: string[];
  /** Dossier (récursif). */
  dossier?: string | null;
  tailleMin?: number | null;
  tailleMax?: number | null;
  modifieApres?: string | null;
  modifieAvant?: string | null;
  /** Vide : présents et indisponibles. */
  etats?: EtatFichier[];
  /** Vide : toutes (bibliotheque_requete) ; index et everything (index_rechercher). */
  sources?: SourceIndex[];
  doublons?: boolean;
  tri?: TriIndex;
  ordre?: "asc" | "desc" | null;
  /** À partir de 1. */
  page?: number;
  /** 1 à 500 (défaut 100). */
  taillePage?: number;
}

export interface ElementIndex {
  /** Identifiant du média (SHA-1 du chemin) : le même que dans index.json pour un dossier surveillé. */
  id: string;
  chemin: string;
  dossier: string;
  /** Nom sans l'extension. */
  nom: string;
  ext: string;
  type: TypeMedia;
  taille: number;
  modifieLe: string;
  ajouteLe: string;
  duree: number | null;
  largeur: number | null;
  hauteur: number | null;
  ips: number | null;
  codecVideo: string | null;
  codecAudio: string | null;
  titre: string | null;
  artistes: string[];
  album: string | null;
  annee: number | null;
  /** Chemin ABSOLU de la miniature (à passer par `urlMiniatureIndex`), ou `null`. */
  miniature: string | null;
  /** `webview` : vidéo à faire analyser par le WebView2 (`analyserVisibles`). */
  etatMiniature: "a-faire" | "faite" | "echec" | "impossible" | "webview";
  etat: EtatFichier;
  /** État dans index.json pour un dossier surveillé (`disponible`, `en-cours`…). */
  etatBibliotheque: EtatMedia | null;
  sources: SourceIndex[];
  volume: string | null;
  doublons: number;
  doublonDe: string | null;
  /** Fichier « en ligne seulement » (OneDrive…) : jamais ouvert par AETHRYON. */
  enLigne: boolean;
  premiereCompatible: boolean | null;
}

export interface PageIndex {
  elements: ElementIndex[];
  total: number;
  page: number;
  taillePage: number;
  pages: number;
  dureeMs: number;
}

export interface AAnalyserIndex {
  id: string;
  chemin: string;
  type: TypeMedia;
  ext: string;
}

export interface AnalyseIndex {
  duree?: number | null;
  largeur?: number | null;
  hauteur?: number | null;
  echec?: boolean;
}

// ---- Commandes et événements ---------------------------------------------------------------------------------------

export const indexApi = {
  volumes: () => invoke<VolumeIndex[]>("index_volumes"),
  reglages: () => invoke<ReglagesIndex>("index_reglages"),
  modifierReglages: (modif: ModifReglagesIndex) => invoke<ReglagesIndex>("index_reglages_modifier", { modif }),
  /** Lance un scan (cibles des réglages si absentes) : répond le numéro du scan ; la suite arrive par les événements. */
  lancerScan: (cibles?: Cible[] | null) => invoke<number>("index_scan_lancer", { cibles: cibles ?? null }),
  annulerScan: () => invoke<boolean>("index_scan_annuler"),
  etat: () => invoke<EtatIndex>("index_etat"),
  resume: (scan?: number | null) => invoke<ResumeScan | null>("index_resume", { scan: scan ?? null }),
  /** Médias scannés seulement (sources index et everything). */
  rechercher: (requete: RequeteIndex) => invoke<PageIndex>("index_rechercher", { requete }),
  /** Bibliothèque unifiée : dossiers surveillés (index.json) + médias scannés, avec leur source. */
  bibliotheque: (requete: RequeteIndex) => invoke<PageIndex>("bibliotheque_requete", { requete }),
  action: (id: string, action: "ouvrir" | "explorateur") => invoke<void>("index_media_action", { id, action }),
  /** Ouvre CE fichier au protocole `asset:` et renvoie son chemin (aperçu, lecture). */
  apercu: (id: string) => invoke<string>("index_apercu", { id }),
  demanderMiniatures: (ids: string[]) => invoke<AAnalyserIndex[]>("index_miniatures_demander", { ids }),
  enregistrerAnalyse: (id: string, analyse: AnalyseIndex, jpeg: string | null) => invoke<void>("index_analyse_enregistrer", { id, analyse, jpeg }),
  deplacerEmplacement: (chemin: string) => invoke<string>("index_emplacement_deplacer", { chemin }),
  everything: () => invoke<EtatEverything>("index_everything"),
  retirer: (chemin: string) => invoke<number>("index_retirer", { chemin }),
};

export const evenementsIndex = {
  progression: (f: (p: ProgressionScan) => void): Promise<UnlistenFn> => listen<ProgressionScan>("index-progression", (e) => f(e.payload)),
  fin: (f: (r: ResumeScan) => void): Promise<UnlistenFn> => listen<ResumeScan>("index-fin", (e) => f(e.payload)),
  /** `index`, `bibliotheque`, `reglages`, `volumes`, `miniatures`. */
  changement: (f: (quoi: string) => void): Promise<UnlistenFn> => listen<string>("index-changement", (e) => f(e.payload)),
  enrichissement: (f: (e: Enrichissement) => void): Promise<UnlistenFn> => listen<Enrichissement>("index-enrichissement", (e) => f(e.payload)),
  migration: (f: (m: Migration) => void): Promise<UnlistenFn> => listen<Migration>("index-migration", (e) => f(e.payload)),
};

// ---- Aides (pures, testées) ----------------------------------------------------------------------------------------

export function totalMedias(c: CompteTypes): number {
  return c.video + c.audio + c.image;
}

/** Pourcentage RÉEL, ou `null` quand aucun total n'est connu (afficher alors une progression indéterminée). */
export function pourcentage(p: ProgressionScan | Enrichissement | Migration): number | null {
  if ("mesurable" in p) return p.mesurable && p.fraction != null ? Math.min(100, Math.max(0, Math.round(p.fraction * 100))) : null;
  return p.total > 0 ? Math.min(100, Math.round((p.fait / p.total) * 100)) : null;
}

function compte(n: number, un: string, plusieurs: string): string {
  return `${nombre(n)}${NBSP}${n > 1 ? plusieurs : un}`;
}

/** « 12 400 fichiers parcourus · 1 204 médias » ; avec le pourcentage seulement s'il est réel. */
export function libelleProgression(p: ProgressionScan): string {
  const medias = compte(totalMedias(p.medias), "média", "médias");
  const pc = pourcentage(p);
  switch (p.phase) {
    case "preparation":
      return "Préparation du scan…";
    case "everything":
      return `Lecture de l'index d'Everything · ${medias}${pc != null ? ` · ${pc}${NBSP}%` : ""}`;
    case "rapprochement":
      return `Mise à jour de l'index · ${medias}`;
    case "termine":
      return `Terminé · ${medias}`;
    default:
      return `${compte(p.fichiersVus, "fichier parcouru", "fichiers parcourus")} · ${medias}`;
  }
}

/** « 1 204 vidéos · 3 520 audios · 12 004 images · 3 erreurs » (zéro erreur : rien). */
export function resumeCourt(r: ResumeScan): string {
  const l = [compte(r.medias.video, "vidéo", "vidéos"), compte(r.medias.audio, "audio", "audios"), compte(r.medias.image, "image", "images")];
  if (r.erreurs > 0) l.push(compte(r.erreurs, "erreur", "erreurs"));
  return l.join(" · ");
}

export const cibleDossier = (chemin: string): Cible => ({ genre: "dossier", chemin });
export const cibleVolume = (v: Pick<VolumeIndex, "racine">): Cible => ({ genre: "volume", chemin: v.racine });
export const cibleTous = (): Cible => ({ genre: "tous", chemin: "" });

const memeChemin = (a: string, b: string) => a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();

export function volumeCoche(cibles: Cible[], v: Pick<VolumeIndex, "racine">): boolean {
  return cibles.some((c) => c.genre === "tous" || (c.genre === "volume" && memeChemin(c.chemin, v.racine)));
}

/** Coche ou décoche un disque dans la liste des cibles (la cible « tous » est remplacée par un choix explicite). */
export function basculerVolume(cibles: Cible[], v: Pick<VolumeIndex, "racine">, tous: Pick<VolumeIndex, "racine" | "disponible">[] = []): Cible[] {
  if (cibles.some((c) => c.genre === "tous")) {
    return tous.filter((x) => x.disponible && !memeChemin(x.racine, v.racine)).map(cibleVolume).concat(cibles.filter((c) => c.genre === "dossier"));
  }
  return volumeCoche(cibles, v) ? cibles.filter((c) => !(c.genre === "volume" && memeChemin(c.chemin, v.racine))) : [...cibles, cibleVolume(v)];
}

export function requete(partiel: RequeteIndex = {}): RequeteIndex {
  return { texte: "", page: 1, taillePage: 100, tri: "ajout", ...partiel };
}

/** Adresse `asset:` d'une miniature, avec la date de modification pour invalider le cache du WebView2. */
export function urlMiniatureIndex(e: Pick<ElementIndex, "miniature" | "modifieLe">): string | null {
  return e.miniature ? `${convertFileSrc(e.miniature)}?v=${encodeURIComponent(e.modifieLe)}` : null;
}

export type IconeVolume = "systeme" | "disque" | "amovible" | "reseau" | "optique" | "indisponible";

export function iconeVolume(v: Pick<VolumeIndex, "genre" | "disponible" | "systeme">): IconeVolume {
  if (!v.disponible) return "indisponible";
  if (v.systeme) return "systeme";
  if (v.genre === "amovible") return "amovible";
  if (v.genre === "reseau") return "reseau";
  if (v.genre === "optique") return "optique";
  return "disque";
}

/** « C: — Windows », « E: — CLÉ USB », « D: » (nom absent). */
export function libelleVolume(v: Pick<VolumeIndex, "lettre" | "nom" | "racine">): string {
  const l = v.lettre ? `${v.lettre}:` : v.racine;
  return v.nom ? `${l} — ${v.nom}` : l;
}

/** Part occupée du disque (0 à 1), ou `null` si la taille est inconnue. */
export function occupation(v: Pick<VolumeIndex, "taille" | "libre">): number | null {
  if (!v.taille || v.libre == null) return null;
  return Math.min(1, Math.max(0, (v.taille - v.libre) / v.taille));
}

/** Importable dans Premiere Pro par la commande du panneau (contrat §5) : seulement les médias d'index.json. Pour un
 * média scanné ailleurs : « Surveiller ce dossier » (son dossier entre dans index.json) ou le glisser natif. */
export function estImportable(e: Pick<ElementIndex, "sources" | "etatBibliotheque">): boolean {
  return e.sources.includes("bibliotheque") && e.etatBibliotheque === "disponible";
}

/** Chargement page par page (défilement infini) : l'interface ne charge jamais tout ; les réponses périmées
 * (requête changée entre-temps) sont ignorées. */
export class ChargeurPages {
  elements: ElementIndex[] = [];
  total = 0;
  pages = 0;
  private page = 0;
  private jeton = 0;
  private enCours: Promise<boolean> | null = null;
  private r: RequeteIndex;

  constructor(private readonly charger: (r: RequeteIndex) => Promise<PageIndex>, r: RequeteIndex = {}, private readonly taillePage = 100) {
    this.r = requete(r);
  }

  get fini(): boolean {
    return this.page > 0 && this.page >= this.pages;
  }

  /** Nouvelle requête : tout est vidé, la première page est chargée. */
  async reinitialiser(r: RequeteIndex): Promise<void> {
    this.r = requete(r);
    this.jeton++;
    this.elements = [];
    this.total = 0;
    this.pages = 0;
    this.page = 0;
    this.enCours = null;
    await this.suivante();
  }

  /** Charge la page suivante ; faux s'il n'y en a plus (ou si la requête a changé pendant le chargement). */
  suivante(): Promise<boolean> {
    if (this.enCours) return this.enCours;
    if (this.fini) return Promise.resolve(false);
    const jeton = this.jeton;
    const page = this.page + 1;
    this.enCours = this.charger({ ...this.r, page, taillePage: this.taillePage })
      .then((p) => {
        if (jeton !== this.jeton) return false;
        const vus = new Set(this.elements.map((e) => e.id));
        this.elements = this.elements.concat(p.elements.filter((e) => !vus.has(e.id)));
        this.total = p.total;
        this.pages = p.pages;
        this.page = page;
        return true;
      })
      .finally(() => {
        if (jeton === this.jeton) this.enCours = null;
      });
    return this.enCours;
  }
}

type Analyseur = (a: AAnalyserIndex) => Promise<{ duree?: number | null; largeur?: number | null; hauteur?: number | null; echec?: boolean; jpeg: string | null }>;

/** Miniatures des cartes visibles : images et pochettes passent devant dans le cœur ; les vidéos sont analysées ici par
 * le WebView2 (`analyser` de src/analyse/Analyseur.tsx), une à la fois. Renvoie le nombre de vidéos analysées. */
export async function analyserVisibles(ids: string[], analyser: Analyseur): Promise<number> {
  if (ids.length === 0) return 0;
  const videos = await indexApi.demanderMiniatures(ids);
  let n = 0;
  for (const v of videos) {
    const r = await analyser(v).catch(() => ({ echec: true, jpeg: null }) as Awaited<ReturnType<Analyseur>>);
    await indexApi.enregistrerAnalyse(v.id, { duree: r.duree ?? null, largeur: r.largeur ?? null, hauteur: r.hauteur ?? null, echec: !!r.echec }, r.jpeg).catch(() => {});
    n++;
  }
  return n;
}
