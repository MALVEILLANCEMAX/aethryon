// Flux (« Flow ») : socle du glisser-déposer d'AETHRYON Desktop, SANS rien de visuel. L'interface s'y abonne pour
// faire réagir ses zones ; tout ce qui touche aux fichiers passe par le cœur Rust, qui valide.
//
// Sources (aucune ne vient du glisser-déposer HTML5 : sous Windows, quand le dépôt de fichiers de Tauri est actif,
// celui de la WebView ne fonctionne pas) :
//  - événements de dépôt de la WebView de Tauri 2 : `tauri://drag-enter` (chemins + position), `tauri://drag-over`
//    (position), `tauri://drag-drop` (chemins + position), `tauri://drag-leave` ; positions en pixels PHYSIQUES,
//    relatives au coin haut-gauche de la WebView ;
//  - `flux-glisser-fin` : fin d'un glisser natif lancé par `glisserMedias` (déposé / annulé, cible, application) ;
//  - `flux-import` : progression d'un import de fichiers déposés ; `resultat-commande` : réponse réelle du panneau.
//
// Règles : les zones sont des éléments DOM marqués `data-zone="premiere"`, `data-zone="bibliotheque"`… ; la zone
// visée se trouve par la POSITION (conversion physique → CSS par devicePixelRatio, puis elementFromPoint). Aucune
// confirmation n'est inventée : « importé » ne vient que du panneau Premiere, « déposé » seulement d'une cible qui a
// accepté le dépôt. Documentation : desktop/FLUX.md.
import { invoke as invokeTauri } from "@tauri-apps/api/core";
import { listen as listenTauri, type UnlistenFn } from "@tauri-apps/api/event";
import type { Chutier, Media, ResultatEnvoi, TypeMedia } from "./types";

// ---- Types (miroir du cœur : noyau/src/flux.rs, noyau/src/service.rs, src-tauri/src/glisser.rs) -------------------------

export interface FichierExterne { chemin: string; nom: string; taille: number; type: TypeMedia }
export interface DossierExterne { chemin: string; nom: string; surveille: boolean; surveillable: boolean; raison: string | null }
export interface Refus { chemin: string; nom: string; raison: string }
/** Ce que contient un survol ou un dépôt, selon le cœur. */
export interface Classement { medias: string[]; fichiers: FichierExterne[]; dossiers: DossierExterne[]; refuses: Refus[] }

export type IssueImport =
  | { etat: "importe"; chemin: string; id: string; fichier: string }
  | { etat: "deja-la"; id: string | null; raison: string }
  | { etat: "refuse"; raison: string }
  | { etat: "echec"; raison: string }
  | { etat: "annule" };
export type ResultatFichier = { source: string; nom: string } & IssueImport;
export interface ProgressionImport {
  lot: string; index: number; fichiers: number; nom: string; etape: "verification" | "copie" | "termine";
  fait: number; taille: number; faitLot: number; tailleLot: number;
}
export interface BilanImport { lot: string; fichiers: ResultatFichier[]; importes: number; dejaLa: number; refuses: number; echecs: number; annules: number; octets: number }

export interface GlisserDemarre { jeton: string; chemins: string[] }
export interface FinGlisser {
  jeton: string;
  /** `depose` : une cible a ACCEPTÉ le dépôt (ce n'est pas une confirmation d'import par Premiere Pro). */
  resultat: "depose" | "annule" | "erreur";
  effet: "copie" | "lien" | "aucun";
  cible: "interne" | "externe" | "inconnue";
  /** Exécutable sous le curseur au dépôt (« Adobe Premiere Pro.exe », « explorer.exe »), sans dossier. */
  application: string | null;
  fichiers: number;
  message: string | null;
}

/** Réponse du cœur à `envoyer_vers_premiere`. */
export type EnvoiCoeur = { etat: "envoye"; nom: string } | { etat: "non-connecte"; message: string; age: number | null };

/** États RÉELS d'un envoi vers Premiere Pro. */
export type EtatEnvoi =
  | { etat: "envoi" }
  | { etat: "envoye"; nom: string }
  | { etat: "importe"; nom: string; message: string; le: string }
  | { etat: "echec"; nom: string | null; message: string }
  | { etat: "non-connecte"; message: string; age: number | null }
  | { etat: "expire"; nom: string; message: string };

export type Provenance = "aethryon" | "externe";
export type ActionDepot = "envoyer-premiere" | "importer" | "surveiller" | "zone";
export interface Verdict {
  acceptable: boolean;
  actions: ActionDepot[];
  raison: string | null;
  /** Classement pas encore reçu du cœur : ni accepter ni refuser pour l'instant. */
  enAttente?: boolean;
}
export interface Point { x: number; y: number }

export interface EtatSurvol {
  /** Un glisser survole la fenêtre. */
  actif: boolean;
  /** `aethryon` : glisser natif lancé par `glisserMedias` ; `externe` : fichiers venus d'ailleurs (Explorateur…). */
  provenance: Provenance | null;
  chemins: string[];
  classement: Classement | null;
  /** Position CSS (pixels du viewport). */
  position: Point | null;
  zone: string | null;
  verdict: Verdict | null;
}

export interface EtatGlisser {
  jeton: string | null;
  ids: string[];
  chemins: string[];
  /** `demarrage` : demande envoyée au cœur ; `en-cours` : DoDragDrop a démarré. */
  phase: "demarrage" | "en-cours";
}

interface OpBase { id: string; le: number }
export interface OpEnvoi extends OpBase { type: "envoi"; ids: string[]; chutier: Chutier | null; envoi: EtatEnvoi }
export interface OpImport extends OpBase {
  type: "import"; lot: string; fichiers: FichierExterne[]; progression: ProgressionImport | null; bilan: BilanImport | null; erreur: string | null;
}
export interface OpSurveiller extends OpBase {
  type: "surveiller"; dossiers: DossierExterne[]; etat: "proposee" | "en-cours" | "acceptee" | "refusee" | "erreur"; message: string | null;
}
export interface OpGlisser extends OpBase { type: "glisser"; fin: FinGlisser }
export interface OpRefus extends OpBase { type: "refus"; zone: string; raison: string }
export interface OpZone extends OpBase { type: "zone"; zone: string; etat: "en-cours" | "fait" | "erreur"; message: string | null }
export type Operation = OpEnvoi | OpImport | OpSurveiller | OpGlisser | OpRefus | OpZone;

export interface EtatFlux {
  survol: EtatSurvol;
  /** Glisser natif lancé par AETHRYON, y compris quand le curseur est hors de la fenêtre. */
  glisser: EtatGlisser | null;
  /** Suites des dépôts (envois, imports, propositions, refus), de la plus ancienne à la plus récente. */
  operations: Operation[];
}

/** Ce que l'interface sait et que le flux consulte pour juger un survol (facultatif). */
export interface ContexteFlux {
  /** `false` : le panneau ne bat plus → la zone « premiere » refuse. `null`/absent : inconnu (le cœur tranchera). */
  premiereConnecte?: boolean | null;
  /** Médias de l'index (pour refuser d'emblée un média « en cours » ou introuvable). */
  medias?: readonly Media[];
  chutier?: Chutier | null;
}

/** Zone ajoutée par l'interface (ex. « transferts », « export ») : son verdict et son action au dépôt. */
export interface RegleZone {
  verdict(c: Classement, ctx: ContexteFlux, provenance: Provenance | null): Verdict;
  deposer(c: Classement, ctx: ContexteFlux): Promise<string | void> | string | void;
}

export interface ZoneTrouvee { nom: string; element?: Element }

/** Tout ce que le flux emprunte à Tauri et au navigateur (remplaçable dans les essais). */
export interface Dependances {
  invoke: <T>(commande: string, args?: Record<string, unknown>) => Promise<T>;
  listen: <T>(evenement: string, f: (e: { payload: T }) => void) => Promise<UnlistenFn>;
  /** Zone `data-zone` sous un point CSS. */
  zoneSous: (x: number, y: number) => ZoneTrouvee | null;
  /** Pixels physiques par pixel CSS (window.devicePixelRatio : mise à l'échelle de Windows × zoom). */
  ratio: () => number;
  /** Regroupe les notifications (requestAnimationFrame). */
  planifier: (f: () => void) => void;
  minuterie: (f: () => void, ms: number) => unknown;
  annulerMinuterie: (id: unknown) => void;
  maintenant: () => number;
  /** Attributs `data-flux-etat` sur la zone survolée et `data-flux*` sur <html> (crochets CSS de l'interface). */
  marquer: (zone: Element | null, etat: "accepte" | "refuse" | "attente" | null, racine: { flux: Provenance | null; glisser: boolean }) => void;
}

export const EVENEMENTS = {
  entree: "tauri://drag-enter",
  survol: "tauri://drag-over",
  depot: "tauri://drag-drop",
  sortie: "tauri://drag-leave",
  glisserFin: "flux-glisser-fin",
  import: "flux-import",
  resultat: "resultat-commande",
} as const;

// ---- Dépendances par défaut (Tauri + DOM) -------------------------------------------------------------------------------

function zoneSousDom(x: number, y: number): ZoneTrouvee | null {
  if (typeof document === "undefined") return null;
  const el = document.elementFromPoint(x, y)?.closest("[data-zone]");
  const nom = el?.getAttribute("data-zone");
  return el && nom ? { nom, element: el } : null;
}

let dernierMarque: Element | null = null;
function marquerDom(zone: Element | null, etat: "accepte" | "refuse" | "attente" | null, racine: { flux: Provenance | null; glisser: boolean }) {
  if (typeof document === "undefined") return;
  if (dernierMarque && dernierMarque !== zone) dernierMarque.removeAttribute("data-flux-etat");
  if (zone && etat) zone.setAttribute("data-flux-etat", etat);
  else zone?.removeAttribute("data-flux-etat");
  dernierMarque = zone && etat ? zone : null;
  const h = document.documentElement;
  if (racine.flux) h.setAttribute("data-flux", racine.flux); else h.removeAttribute("data-flux");
  if (racine.glisser) h.setAttribute("data-flux-glisser", ""); else h.removeAttribute("data-flux-glisser");
}

const DEFAUT: Dependances = {
  invoke: <T,>(c: string, a?: Record<string, unknown>) => invokeTauri<T>(c, a),
  listen: <T,>(e: string, f: (x: { payload: T }) => void) => listenTauri<T>(e, f),
  zoneSous: zoneSousDom,
  ratio: () => (typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1),
  planifier: (f) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => f()) : setTimeout(f, 0)),
  minuterie: (f, ms) => setTimeout(f, ms),
  annulerMinuterie: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  maintenant: () => Date.now(),
  marquer: marquerDom,
};

function dependances(d?: Partial<Dependances>): Dependances {
  return { ...DEFAUT, ...d };
}

/** Retire un écouteur. Celui de @tauri-apps/api renvoie en fait une promesse : jamais de rejet laissé sans suite. */
function retirerEcouteur(u: UnlistenFn): Promise<void> {
  try {
    return Promise.resolve(u() as unknown).then(() => undefined, () => undefined);
  } catch {
    return Promise.resolve();
  }
}

function message(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Opération impossible.";
}

// ---- Fonctions pures -----------------------------------------------------------------------------------------------------

/** Position physique (Tauri) → position CSS (viewport). */
export function versCss(p: Point, ratio: number): Point {
  const r = ratio > 0 && Number.isFinite(ratio) ? ratio : 1;
  return { x: p.x / r, y: p.y / r };
}

/** Normalisation d'un chemin comme l'identifiant d'index (minuscules, séparateurs « \ »). */
export function normaliser(chemin: string): string {
  return chemin.replace(/\//g, "\\").toLowerCase();
}

export function memesChemins(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a.map(normaliser));
  return b.every((c) => s.has(normaliser(c)));
}

const accepte = (actions: ActionDepot[]): Verdict => ({ acceptable: true, actions, raison: null });
const refuse = (raison: string | null): Verdict => ({ acceptable: false, actions: [], raison });

/** Ce que ferait un dépôt sur `zone` : zones prédéfinies « premiere » et « bibliotheque », ou règle de l'interface. */
export function verdictPour(zone: string, c: Classement | null, ctx: ContexteFlux, provenance: Provenance | null, regle?: RegleZone): Verdict {
  if (!c) return { acceptable: false, actions: [], raison: null, enAttente: true };
  if (regle) return regle.verdict(c, ctx, provenance);
  if (zone === "premiere") {
    if (c.medias.length === 0) {
      return refuse(c.fichiers.length || c.dossiers.length ? "Ajoute d'abord ces fichiers à la bibliothèque : seuls ses médias partent vers Premiere Pro." : "Rien à envoyer vers Premiere Pro.");
    }
    if (ctx.premiereConnecte === false) return refuse("Premiere Pro n'est pas connecté : ouvre le panneau AETHRYON dans Premiere Pro.");
    if (ctx.medias) {
      const parId = new Map(ctx.medias.map((m) => [m.id, m]));
      for (const id of c.medias) {
        const m = parId.get(id);
        if (!m) return refuse("Média inconnu de la bibliothèque.");
        if (m.etat !== "disponible") return refuse(`« ${m.nom} » n'est pas disponible pour l'instant.`);
      }
    }
    return accepte(["envoyer-premiere"]);
  }
  if (zone === "bibliotheque") {
    const actions: ActionDepot[] = [];
    if (c.fichiers.length) actions.push("importer");
    if (c.dossiers.some((d) => d.surveillable)) actions.push("surveiller");
    if (actions.length) return accepte(actions);
    if (c.dossiers.length) return refuse(c.dossiers[0].raison ?? "Ce dossier ne peut pas être surveillé.");
    if (c.medias.length) return refuse("Déjà dans la bibliothèque.");
    if (c.refuses.length) return refuse(c.refuses[0].raison);
    return refuse("Rien à ajouter.");
  }
  return refuse("Cette zone n'accepte pas ce dépôt.");
}

// ---- Appels unitaires (utilisables sans le contrôleur) -------------------------------------------------------------------

/** Glisser natif de médias (IDENTIFIANTS de l'index) vers une autre application. Répond quand le glisser a démarré. */
export function glisserMedias(ids: string[], d?: Partial<Dependances>): Promise<GlisserDemarre> {
  return dependances(d).invoke<GlisserDemarre>("glisser_medias", { ids });
}

/** Arrête le glisser natif en cours (comme Échap). */
export function annulerGlisser(d?: Partial<Dependances>): Promise<boolean> {
  return dependances(d).invoke<boolean>("glisser_annuler");
}

/** Classement par le cœur de chemins remis par le système (survol, dépôt, sélecteur). */
export function classer(chemins: string[], d?: Partial<Dependances>): Promise<Classement> {
  return dependances(d).invoke<Classement>("flux_classer", { chemins });
}

let compteurLots = 0;
/** Identifiant de lot (corrélation des avis de progression). */
export function nouveauLot(): string {
  compteurLots += 1;
  return `import-${Date.now().toString(36)}-${compteurLots.toString(36)}`;
}

/** Importe des fichiers déposés (ou choisis dans le sélecteur) : copie atomique, sans doublon. */
export async function importerFichiers(chemins: string[], options: { lot?: string; surProgression?: (p: ProgressionImport) => void; dependances?: Partial<Dependances> } = {}): Promise<BilanImport> {
  const d = dependances(options.dependances);
  const lot = options.lot ?? nouveauLot();
  const retirer = await d.listen<ProgressionImport>(EVENEMENTS.import, (e) => {
    if (e.payload.lot === lot) options.surProgression?.(e.payload);
  });
  try {
    return await d.invoke<BilanImport>("importer_fichiers", { lot, chemins });
  } finally {
    void retirerEcouteur(retirer);
  }
}

export function annulerImport(lot: string, d?: Partial<Dependances>): Promise<boolean> {
  return dependances(d).invoke<boolean>("importer_annuler", { lot });
}

export interface SuiviEnvoi {
  etat(): EtatEnvoi;
  abonner(f: (e: EtatEnvoi) => void): () => void;
  /** État final : importé, échec, non connecté ou expiré. */
  fin: Promise<EtatEnvoi>;
  /** Cesse d'écouter (la commande déjà déposée n'est pas rappelée : elle expire seule au bout de 2 minutes). */
  arreter(): void;
}

const FINAUX = new Set(["importe", "echec", "non-connecte", "expire"]);
/** Délai de garde côté interface : le cœur expire la commande à 2 min ; au-delà de 2 min 15 s, on relit son état. */
export const GARDE_ENVOI_MS = 135_000;

/**
 * Envoie des médias (identifiants) au panneau Premiere Pro et suit les états RÉELS : `envoye` (commande déposée),
 * `importe` (confirmé par le panneau, avec son message), `echec` (message du panneau ou refus du cœur),
 * `non-connecte` (le panneau ne bat plus depuis 15 s : RIEN n'est envoyé), `expire` (2 minutes sans réponse).
 */
export function envoyerVersPremiere(ids: string[], chutier?: Chutier | null, options: { dependances?: Partial<Dependances>; gardeMs?: number } = {}): SuiviEnvoi {
  const d = dependances(options.dependances);
  let courant: EtatEnvoi = { etat: "envoi" };
  const abonnes = new Set<(e: EtatEnvoi) => void>();
  let resoudre: (e: EtatEnvoi) => void = () => {};
  const fin = new Promise<EtatEnvoi>((r) => (resoudre = r));
  let nom: string | null = null;
  let arrete = false;
  let retirer: UnlistenFn | null = null;
  let garde: unknown = null;
  const avant: ResultatEnvoi[] = [];

  const nettoyer = () => {
    arrete = true;
    if (retirer) void retirerEcouteur(retirer);
    retirer = null;
    if (garde !== null) d.annulerMinuterie(garde);
    garde = null;
  };
  const changer = (e: EtatEnvoi) => {
    if (FINAUX.has(courant.etat)) return;
    courant = e;
    for (const f of [...abonnes]) f(e);
    if (FINAUX.has(e.etat)) {
      nettoyer();
      resoudre(e);
    }
  };
  const appliquer = (r: ResultatEnvoi) => {
    if (r.ok) changer({ etat: "importe", nom: r.nom, message: r.message, le: r.le });
    else if (r.expire) changer({ etat: "expire", nom: r.nom, message: r.message });
    else changer({ etat: "echec", nom: r.nom, message: r.message });
  };
  const verifier = async () => {
    garde = null;
    if (arrete || nom === null) return;
    try {
      const i = await d.invoke<{ resultats: ResultatEnvoi[] }>("etat");
      const r = i.resultats.find((x) => x.nom === nom);
      if (r) return appliquer(r);
    } catch {
      /* l'état est relu une seule fois ; à défaut, on dit ce qu'on a constaté */
    }
    changer({ etat: "expire", nom, message: "Aucune réponse du panneau AETHRYON en 2 minutes : la demande a expiré." });
  };

  void (async () => {
    try {
      const un = await d.listen<ResultatEnvoi>(EVENEMENTS.resultat, (e) => {
        const r = e.payload;
        if (r.action !== "importer") return;
        if (nom === null) avant.push(r);
        else if (r.nom === nom) appliquer(r);
      });
      if (arrete) {
        void retirerEcouteur(un);
        return;
      }
      retirer = un;
      const rep = await d.invoke<EnvoiCoeur>("envoyer_vers_premiere", { ids, chutier: chutier ?? null });
      if (arrete) return;
      if (rep.etat === "non-connecte") return changer({ etat: "non-connecte", message: rep.message, age: rep.age ?? null });
      nom = rep.nom;
      changer({ etat: "envoye", nom });
      const deja = avant.find((r) => r.nom === nom);
      avant.length = 0;
      if (deja) return appliquer(deja);
      garde = d.minuterie(() => void verifier(), options.gardeMs ?? GARDE_ENVOI_MS);
    } catch (e) {
      changer({ etat: "echec", nom, message: message(e) });
    }
  })();

  return {
    etat: () => courant,
    abonner(f) {
      abonnes.add(f);
      return () => abonnes.delete(f);
    },
    fin,
    arreter: nettoyer,
  };
}

// ---- Contrôleur -------------------------------------------------------------------------------------------------------------

export interface OptionsFlux {
  contexte?: () => ContexteFlux;
  /** Pose `data-flux-etat` sur la zone survolée et `data-flux` / `data-flux-glisser` sur <html> (défaut : oui). */
  marquerZones?: boolean;
  dependances?: Partial<Dependances>;
}

export interface Flux {
  /** Installe les écouteurs (idempotent). */
  demarrer(): Promise<void>;
  /** Retire TOUS les écouteurs, minuteries et marques ; les suivis d'envoi cessent d'écouter. Idempotent. */
  arreter(): Promise<void>;
  /** Instantané immuable (même objet tant que rien ne change : compatible useSyncExternalStore). */
  etat(): EtatFlux;
  /** Notifié au plus une fois par image. Renvoie la fonction de désabonnement. */
  abonner(f: (e: EtatFlux) => void): () => void;
  /** Lance un glisser natif des médias (identifiants). Rejette si un glisser est déjà en cours ou refusé par le cœur. */
  glisserMedias(ids: string[]): Promise<GlisserDemarre>;
  /** Abandonne le survol en cours (Échap) et arrête le glisser natif lancé par AETHRYON, s'il y en a un. */
  annuler(): void;
  /** « Surveiller ce dossier » : `chemin` précis, ou tous les dossiers proposés. */
  accepterProposition(id: string, chemin?: string): Promise<void>;
  refuserProposition(id: string): void;
  annulerImport(lot: string): Promise<boolean>;
  /** Retire une opération terminée de la liste. */
  oublier(id: string): void;
  /** Ajoute une zone propre à l'interface ; renvoie la fonction de retrait. */
  definirZone(nom: string, regle: RegleZone): () => void;
}

const SURVOL_VIDE: EtatSurvol = { actif: false, provenance: null, chemins: [], classement: null, position: null, zone: null, verdict: null };
/** Après la fin d'un glisser natif déposé SUR la fenêtre, l'événement de dépôt peut arriver juste après : délai de grâce. */
const GRACE_DEPOT_MS = 1500;
/** Une fin de glisser arrivée avant la réponse de `glisser_medias` est gardée ce temps-là. */
const GARDE_FIN_ORPHELINE_MS = 5000;

export function creerFlux(options: OptionsFlux = {}): Flux {
  const d = dependances(options.dependances);
  const marquerZones = options.marquerZones !== false;
  const ctx = () => options.contexte?.() ?? {};
  const regles = new Map<string, RegleZone>();
  const abonnes = new Set<(e: EtatFlux) => void>();
  const retraits: UnlistenFn[] = [];
  const suivis = new Map<string, SuiviEnvoi>();
  const finsOrphelines = new Map<string, FinGlisser>();
  const minuteries = new Set<unknown>();

  let survol: EtatSurvol = SURVOL_VIDE;
  let glisser: EtatGlisser | null = null;
  let operations: Operation[] = [];
  let instantane: EtatFlux = { survol, glisser, operations };
  let notificationPrevue = false;
  let session = 0;
  let generation = 0;
  let actif = false;
  let demarrage: Promise<void> | null = null;
  let numero = 0;
  let classementEnCours: { session: number; chemins: string[]; promesse: Promise<Classement> } | null = null;
  let zoneMarquee: ZoneTrouvee | null = null;
  let graceDepot: unknown = null;

  const temporiser = (f: () => void, ms: number) => {
    const id: unknown = d.minuterie(() => {
      minuteries.delete(id);
      f();
    }, ms);
    minuteries.add(id);
    return id;
  };
  const detemporiser = (id: unknown) => {
    if (id === null) return;
    minuteries.delete(id);
    d.annulerMinuterie(id);
  };

  function publier() {
    instantane = { survol, glisser, operations };
    if (notificationPrevue) return;
    notificationPrevue = true;
    d.planifier(() => {
      notificationPrevue = false;
      for (const f of [...abonnes]) f(instantane);
    });
  }

  function marquer(zone: ZoneTrouvee | null, verdict: Verdict | null) {
    zoneMarquee = zone;
    if (!marquerZones) return;
    const etat = !zone || !verdict ? null : verdict.enAttente ? "attente" : verdict.acceptable ? "accepte" : "refuse";
    d.marquer(zone?.element ?? null, etat, { flux: survol.actif ? survol.provenance : null, glisser: glisser !== null });
  }

  function resoudreZone() {
    const z = survol.position ? d.zoneSous(survol.position.x, survol.position.y) : null;
    const verdict = z ? verdictPour(z.nom, survol.classement, ctx(), survol.provenance, regles.get(z.nom)) : null;
    survol = { ...survol, zone: z?.nom ?? null, verdict };
    marquer(z, verdict);
  }

  function viderSurvol() {
    session += 1;
    classementEnCours = null;
    detemporiser(graceDepot);
    graceDepot = null;
    survol = SURVOL_VIDE;
    marquer(null, null);
  }

  function ajouter<O extends Operation>(op: Omit<O, "id" | "le">): O {
    numero += 1;
    const complete = { ...op, id: `op-${numero}`, le: d.maintenant() } as O;
    operations = [...operations, complete];
    publier();
    return complete;
  }

  function modifier<O extends Operation>(id: string, f: (o: O) => O) {
    let change = false;
    operations = operations.map((o) => {
      if (o.id !== id) return o;
      change = true;
      return f(o as O);
    });
    if (change) publier();
  }

  // ---- Événements de dépôt de Tauri ----

  function surEntree(p: { paths?: string[]; position: Point }) {
    if (!actif) return;
    viderSurvol();
    const s = session;
    const chemins = Array.isArray(p.paths) ? p.paths : [];
    const provenance: Provenance = glisser ? "aethryon" : "externe";
    const prerempli = glisser && glisser.chemins.length > 0 && memesChemins(chemins, glisser.chemins) ? { medias: [...glisser.ids], fichiers: [], dossiers: [], refuses: [] } : null;
    survol = { actif: true, provenance, chemins, classement: prerempli, position: versCss(p.position, d.ratio()), zone: null, verdict: null };
    resoudreZone();
    publier();
    if (prerempli || chemins.length === 0) return;
    const promesse = d.invoke<Classement>("flux_classer", { chemins });
    classementEnCours = { session: s, chemins, promesse };
    promesse.then(
      (c) => {
        if (!actif || s !== session || !survol.actif) return;
        survol = { ...survol, classement: c };
        resoudreZone();
        publier();
      },
      (e) => {
        if (!actif || s !== session || !survol.actif) return;
        survol = { ...survol, classement: { medias: [], fichiers: [], dossiers: [], refuses: chemins.map((c) => ({ chemin: c, nom: c, raison: message(e) })) } };
        resoudreZone();
        publier();
      },
    );
  }

  function surSurvol(p: { position: Point }) {
    if (!actif || !survol.actif) return;
    survol = { ...survol, position: versCss(p.position, d.ratio()) };
    resoudreZone();
    publier();
  }

  function surSortie() {
    if (!actif || !survol.actif) return;
    viderSurvol();
    publier();
  }

  async function surDepot(p: { paths?: string[]; position: Point }) {
    if (!actif) return;
    const chemins = Array.isArray(p.paths) ? p.paths : [];
    const position = versCss(p.position, d.ratio());
    const memeSession = survol.actif && memesChemins(survol.chemins, chemins);
    const provenance: Provenance = memeSession && survol.provenance ? survol.provenance : glisser ? "aethryon" : "externe";
    let c = memeSession ? survol.classement : null;
    const enCours = memeSession && classementEnCours && classementEnCours.session === session ? classementEnCours.promesse : null;
    const z = d.zoneSous(position.x, position.y);
    viderSurvol();
    publier();
    if (!z || chemins.length === 0) return;
    if (!c) {
      try {
        c = await (enCours ?? d.invoke<Classement>("flux_classer", { chemins }));
      } catch (e) {
        ajouter<OpRefus>({ type: "refus", zone: z.nom, raison: message(e) });
        return;
      }
    }
    if (!actif) return;
    const regle = regles.get(z.nom);
    const v = verdictPour(z.nom, c, ctx(), provenance, regle);
    if (!v.acceptable) {
      ajouter<OpRefus>({ type: "refus", zone: z.nom, raison: v.raison ?? "Dépôt refusé." });
      return;
    }
    if (regle) return executerZone(z.nom, regle, c);
    for (const a of v.actions) {
      if (a === "envoyer-premiere") envoyer(c.medias);
      else if (a === "importer") importer(c.fichiers);
      else if (a === "surveiller") ajouter<OpSurveiller>({ type: "surveiller", dossiers: c.dossiers.filter((x) => x.surveillable), etat: "proposee", message: null });
    }
  }

  function executerZone(zone: string, regle: RegleZone, c: Classement) {
    const op = ajouter<OpZone>({ type: "zone", zone, etat: "en-cours", message: null });
    Promise.resolve()
      .then(() => regle.deposer(c, ctx()))
      .then(
        (m) => modifier<OpZone>(op.id, (o) => ({ ...o, etat: "fait", message: typeof m === "string" ? m : null })),
        (e) => modifier<OpZone>(op.id, (o) => ({ ...o, etat: "erreur", message: message(e) })),
      );
  }

  function envoyer(ids: string[]) {
    const chutier = ctx().chutier ?? null;
    const op = ajouter<OpEnvoi>({ type: "envoi", ids: [...ids], chutier, envoi: { etat: "envoi" } });
    const suivi = envoyerVersPremiere(ids, chutier, { dependances: d });
    suivis.set(op.id, suivi);
    suivi.abonner((e) => {
      if (!actif) return;
      modifier<OpEnvoi>(op.id, (o) => ({ ...o, envoi: e }));
    });
    void suivi.fin.then(() => suivis.delete(op.id));
  }

  function importer(fichiers: FichierExterne[]) {
    const lot = nouveauLot();
    const op = ajouter<OpImport>({ type: "import", lot, fichiers: [...fichiers], progression: null, bilan: null, erreur: null });
    d.invoke<BilanImport>("importer_fichiers", { lot, chemins: fichiers.map((f) => f.chemin) }).then(
      (b) => actif && modifier<OpImport>(op.id, (o) => ({ ...o, bilan: b })),
      (e) => actif && modifier<OpImport>(op.id, (o) => ({ ...o, erreur: message(e) })),
    );
  }

  function surProgression(p: ProgressionImport) {
    if (!actif) return;
    const op = operations.find((o): o is OpImport => o.type === "import" && o.lot === p.lot);
    if (op && !op.bilan) modifier<OpImport>(op.id, (o) => ({ ...o, progression: p }));
  }

  // ---- Fin d'un glisser natif ----

  function surFin(f: FinGlisser) {
    if (!actif) return;
    if (!glisser || glisser.jeton !== f.jeton) {
      // Arrivée avant la réponse de glisser_medias : gardée un instant.
      if (glisser?.phase === "demarrage") {
        finsOrphelines.set(f.jeton, f);
        temporiser(() => finsOrphelines.delete(f.jeton), GARDE_FIN_ORPHELINE_MS);
      }
      return;
    }
    glisser = null;
    if (f.resultat === "erreur" || (f.resultat === "depose" && f.cible !== "interne")) ajouter<OpGlisser>({ type: "glisser", fin: f });
    if (survol.actif) {
      if (f.resultat === "depose" && f.cible === "interne") {
        // Le dépôt sur la fenêtre arrive par tauri://drag-drop, parfois juste après cette fin.
        const s = session;
        graceDepot = temporiser(() => {
          graceDepot = null;
          if (s === session && survol.actif) surSortie();
        }, GRACE_DEPOT_MS);
      } else {
        viderSurvol();
      }
    }
    marquer(zoneMarquee, survol.verdict);
    publier();
  }

  async function demarrer() {
    if (demarrage) return demarrage;
    actif = true;
    const gen = ++generation;
    const ecouter = async <T,>(evenement: string, f: (p: T) => void) => {
      const un = await d.listen<T>(evenement, (e) => {
        if (gen === generation) f(e.payload);
      });
      if (gen !== generation) void retirerEcouteur(un);
      else retraits.push(un);
    };
    demarrage = Promise.all([
      ecouter<{ paths?: string[]; position: Point }>(EVENEMENTS.entree, surEntree),
      ecouter<{ position: Point }>(EVENEMENTS.survol, surSurvol),
      ecouter<{ paths?: string[]; position: Point }>(EVENEMENTS.depot, (p) => void surDepot(p)),
      ecouter<null>(EVENEMENTS.sortie, surSortie),
      ecouter<FinGlisser>(EVENEMENTS.glisserFin, surFin),
      ecouter<ProgressionImport>(EVENEMENTS.import, surProgression),
    ]).then(() => undefined);
    return demarrage;
  }

  async function arreter() {
    generation += 1;
    actif = false;
    demarrage = null;
    const r = retraits.splice(0);
    for (const s of suivis.values()) s.arreter();
    suivis.clear();
    for (const m of [...minuteries]) detemporiser(m);
    finsOrphelines.clear();
    session += 1;
    classementEnCours = null;
    graceDepot = null;
    survol = SURVOL_VIDE;
    glisser = null;
    if (marquerZones) d.marquer(null, null, { flux: null, glisser: false });
    zoneMarquee = null;
    instantane = { survol, glisser, operations };
    await Promise.all(r.map(retirerEcouteur));
  }

  return {
    demarrer,
    arreter,
    etat: () => instantane,
    abonner(f) {
      abonnes.add(f);
      return () => {
        abonnes.delete(f);
      };
    },
    async glisserMedias(ids) {
      if (glisser) throw new Error("Un glisser est déjà en cours.");
      if (ids.length === 0) throw new Error("Aucun média à glisser.");
      glisser = { jeton: null, ids: [...ids], chemins: [], phase: "demarrage" };
      marquer(zoneMarquee, survol.verdict);
      publier();
      try {
        const r = await d.invoke<GlisserDemarre>("glisser_medias", { ids });
        if (!actif || !glisser) return r;
        glisser = { ...glisser, jeton: r.jeton, chemins: r.chemins, phase: "en-cours" };
        // Le survol a pu commencer avant la réponse : maintenant que les chemins sont connus, il est à nous.
        if (survol.actif && survol.provenance === "aethryon" && !survol.classement && memesChemins(survol.chemins, r.chemins)) {
          survol = { ...survol, classement: { medias: [...glisser.ids], fichiers: [], dossiers: [], refuses: [] } };
          resoudreZone();
        }
        publier();
        const orpheline = finsOrphelines.get(r.jeton);
        if (orpheline) {
          finsOrphelines.delete(r.jeton);
          surFin(orpheline);
        }
        return r;
      } catch (e) {
        glisser = null;
        marquer(zoneMarquee, survol.verdict);
        publier();
        throw e instanceof Error ? e : new Error(message(e));
      }
    },
    annuler() {
      if (glisser) void d.invoke<boolean>("glisser_annuler").catch(() => false);
      if (survol.actif) {
        viderSurvol();
        publier();
      }
    },
    async accepterProposition(id, chemin) {
      const op = operations.find((o): o is OpSurveiller => o.id === id && o.type === "surveiller");
      if (!op || op.etat === "en-cours" || op.etat === "acceptee") return;
      const dossiers = op.dossiers.filter((x) => !chemin || normaliser(x.chemin) === normaliser(chemin));
      if (dossiers.length === 0) return;
      modifier<OpSurveiller>(id, (o) => ({ ...o, etat: "en-cours", message: null }));
      try {
        for (const x of dossiers) await d.invoke<void>("dossier_ajouter", { chemin: x.chemin });
        modifier<OpSurveiller>(id, (o) => ({ ...o, etat: "acceptee", message: dossiers.length > 1 ? `${dossiers.length} dossiers ajoutés à la surveillance.` : `« ${dossiers[0].nom} » est maintenant surveillé.` }));
      } catch (e) {
        modifier<OpSurveiller>(id, (o) => ({ ...o, etat: "erreur", message: message(e) }));
      }
    },
    refuserProposition(id) {
      modifier<OpSurveiller>(id, (o) => (o.type === "surveiller" && o.etat === "proposee" ? { ...o, etat: "refusee" } : o));
    },
    annulerImport: (lot) => d.invoke<boolean>("importer_annuler", { lot }),
    oublier(id) {
      const avant = operations.length;
      operations = operations.filter((o) => o.id !== id);
      suivis.get(id)?.arreter();
      suivis.delete(id);
      if (operations.length !== avant) publier();
    },
    definirZone(nom, regle) {
      regles.set(nom, regle);
      return () => {
        if (regles.get(nom) === regle) regles.delete(nom);
      };
    },
  };
}
