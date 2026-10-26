// Contrôleur du panneau : état unique + actions. Aucune page ne parle à l'hôte directement.
// Rythme (DESIGN-SYSTEM §7.6) : rien ne tourne quand le panneau est caché, sauf la relève des commandes d'AETHRYON
// Desktop (2.0.1 : lecture de R\commandes\a-traiter\ toutes les secondes tant que le panneau est chargé, dossier
// presque toujours vide ; src/lib/commandes.ts) ; la bibliothèque est relue toutes les 4 s
// quand il est visible (lecture de dossier, peu coûteuse) ; la présence dans le projet est vérifiée toutes les 15 s
// et juste après un import ; la conversion suit le serveur par attente longue (aucune interrogation rapide).

import { creerClient, ErreurApi, EXTRAIT_MAX_S, ROUTES, libelleEtape, type Apercu, type ClientApi, type ConfigServeur, type Format, type Job, type Moi, type Qualite } from "../api/client";
import type { BilanImport, Capacites, Environnement, EtatSignature, Hote, InfoProjet, ModeChutier, ProtectionCle } from "../hote/types";
import {
  depuisDossier, depuisIndexDesktop, depuisRecents, etatAffiche, filtrer, fusionner, idPourChemin, nomDe, pretPourPremiere,
  type ContexteEtat, type FiltreEtat, type FiltrePlateforme, type FiltreType, type Media, type Recent, type Tri,
} from "../lib/bibliotheque";
import { creerRecepteurCommandes, type RecepteurCommandes } from "../lib/commandes";
import { battementPanneau, cheminsDesktop, DESKTOP_ABSENT, lireBattement, lireConfigDesktop, noterImports, type EtatDesktop } from "../lib/desktop";
import { pluriel, taille, typo } from "../lib/format";
import { creerJournal, declarerSecret, oublierSecret, type Journal } from "../lib/journal";
import { creerFileMiniatures, mesurerAudio, miniatureImage, miniatureVideo } from "../lib/miniatures";
import { analyserLien, miniatureSure, NOM_PLATEFORME, raisonRefus, type LienMedia } from "../lib/urls";
import { VERSION } from "../version";
import { creerMagasin, type Magasin } from "./magasin";
import { creerDiagnostic, DIAG_INITIAL, type EtatDiagnostic } from "./diagnostic";

export type Page = "accueil" | "bibliotheque" | "compte" | "reglages" | "diagnostic";
export type Animations = "systeme" | "reduites" | "completes";
export type Preuve = { ok: boolean; le: string; premiere: string | null };

export interface Reglages {
  schema: 1;
  dossierMedias: string | null;
  chutier: ModeChutier;
  format: Format;
  qualite: Qualite;
  bitrate: 128 | 192 | 320;
  importAuto: boolean;
  animations: Animations;
  langue: "fr";
  vue: "grille" | "liste";
  vignette: number;
  tri: Tri;
  preuves: Partial<Record<"glisserProjet" | "glisserTimeline" | "lectureVideo" | "importFiles", Preuve>>;
}

export const REGLAGES_DEFAUT: Reglages = {
  schema: 1, dossierMedias: null, chutier: "aethryon", format: "mp4", qualite: "1080", bitrate: 192, importAuto: false,
  animations: "systeme", langue: "fr", vue: "grille", vignette: 0.35, tri: "recent", preuves: {},
};

export interface Toast {
  id: number;
  type: "ok" | "erreur" | "info" | "attention";
  titre: string;
  texte?: string;
  action?: { libelle: string; faire: () => void };
}

export type EtatConnexion = "inconnu" | "deconnecte" | "attente" | "connecte";

export interface Connexion {
  etat: EtatConnexion;
  compte: { email: string; nom: string } | null;
  expireLe: string | null;
  protection: ProtectionCle | null;
  attente: { code: string; url: string; expireA: number } | null;
  moi: Moi | null;
  moiChargement: boolean;
  moiErreur: string | null;
  erreur: string | null;
  /** Le serveur n'a pas encore ouvert la connexion du panneau (404 premiere_closed, ou routes absentes). */
  indisponible: boolean;
  /** Plafond de 3 ordinateurs atteint : proposer « Mes jetons ». */
  tropDOrdinateurs: boolean;
}

export interface EtatApercu {
  etat: "vide" | "chargement" | "pret" | "erreur";
  donnees: Apercu | null;
  miniature: string | null;
  erreur: string | null;
  pourUrl: string | null;
}

export type PhaseTache = "conversion" | "telechargement" | "import" | "termine" | "erreur" | "annule";

export interface Tache {
  id: number;
  titre: string;
  plateforme: string;
  format: Format;
  phase: PhaseTache;
  libelle: string;
  /** Progression réelle de la phase en cours, de 0 à 1 (null : inconnue). */
  conversion: number;
  octets: { recus: number; total: number | null } | null;
  chemin: string | null;
  erreur: string | null;
  message: string | null;
}

export interface EtatBiblio {
  recherche: string;
  type: FiltreType;
  etat: FiltreEtat;
  plateforme: FiltrePlateforme;
  selection: ReadonlySet<string>;
  ancre: string | null;
  apercuId: string | null;
  chargee: boolean;
  dossierAbsent: boolean;
}

export interface EtatApp {
  pret: boolean;
  erreurDemarrage: string | null;
  page: Page;
  retour: Page;
  visible: boolean;
  largeur: number;
  env: Environnement | null;
  capacites: Capacites | null;
  signature: EtatSignature | null;
  reglages: Reglages;
  dossierMedias: string;
  projet: InfoProjet | null;
  projetVerifie: boolean;
  connexion: Connexion;
  saisie: string;
  lien: LienMedia | null;
  refus: string;
  apercu: EtatApercu;
  choix: { format: Format; qualite: Qualite; bitrate: 128 | 192 | 320 };
  extrait: { actif: boolean; debut: string; fin: string };
  tache: Tache | null;
  recents: Recent[];
  medias: Media[];
  importes: ReadonlySet<string>;
  erreurs: ReadonlyMap<string, string>;
  operations: ReadonlySet<string>;
  miniatures: Readonly<Record<string, string>>;
  biblio: EtatBiblio;
  desktop: EtatDesktop;
  toast: Toast | null;
  diag: EtatDiagnostic;
}

const CONNEXION_INITIALE: Connexion = {
  etat: "inconnu", compte: null, expireLe: null, protection: null, attente: null, moi: null, moiChargement: false, moiErreur: null, erreur: null, indisponible: false, tropDOrdinateurs: false,
};

export function etatInitial(): EtatApp {
  return {
    pret: false, erreurDemarrage: null, page: "accueil", retour: "accueil", visible: true, largeur: typeof window !== "undefined" ? window.innerWidth : 480,
    env: null, capacites: null, signature: null, reglages: REGLAGES_DEFAUT, dossierMedias: "", projet: null, projetVerifie: false,
    connexion: CONNEXION_INITIALE, saisie: "", lien: null, refus: "",
    apercu: { etat: "vide", donnees: null, miniature: null, erreur: null, pourUrl: null },
    choix: { format: "mp4", qualite: "1080", bitrate: 192 }, extrait: { actif: false, debut: "0:00", fin: "0:30" },
    tache: null, recents: [], medias: [], importes: new Set(), erreurs: new Map(), operations: new Set(), miniatures: {},
    biblio: { recherche: "", type: "tout", etat: "tous", plateforme: "toutes", selection: new Set(), ancre: null, apercuId: null, chargee: false, dossierAbsent: false },
    desktop: DESKTOP_ABSENT, toast: null, diag: DIAG_INITIAL,
  };
}

interface Mesure {
  modifie: string | null;
  duree: number | null;
  largeur: number | null;
  hauteur: number | null;
  fichier: string | null;
}

export function contexte(e: Pick<EtatApp, "operations" | "erreurs" | "importes">): ContexteEtat {
  return { operations: e.operations, erreurs: e.erreurs, importes: e.importes };
}

export function mediasFiltres(e: Pick<EtatApp, "medias" | "biblio" | "reglages" | "importes" | "erreurs" | "operations">): Media[] {
  return filtrer(e.medias, { recherche: e.biblio.recherche, type: e.biblio.type, etat: e.biblio.etat, plateforme: e.biblio.plateforme, tri: e.reglages.tri }, contexte(e));
}

export function creerApp(hote: Hote, config: ConfigServeur) {
  const m: Magasin<EtatApp> = creerMagasin(etatInitial());
  const journal: Journal = creerJournal();
  journal.surLigne((l) => hote.journaliser(l.niveau, l.message));
  let cle: string | null = null;
  const client: ClientApi = creerClient(hote, config, () => cle);
  const lire = m.lire;
  const ecrire = m.ecrire;
  let env: Environnement;
  let fichiersDesktop: ReturnType<typeof cheminsDesktop>;
  let dossierMiniatures = "";
  let mesures: Record<string, Mesure> = {};
  let presentsVus: Set<string> | null = null;
  let derniereVerifProjet = 0;
  let minuteurBiblio: ReturnType<typeof setTimeout> | null = null;
  let minuteurBattement: ReturnType<typeof setTimeout> | null = null;
  let minuteurToast: ReturnType<typeof setTimeout> | null = null;
  let minuteurApercu: ReturnType<typeof setTimeout> | null = null;
  let minuteurCommandes: ReturnType<typeof setTimeout> | null = null;
  let recepteur: RecepteurCommandes | null = null;
  let annulerTache: AbortController | null = null;
  let jobCourant: string | null = null;
  let sequenceApercu = 0;
  let attenteConnexion = 0;
  let codeAppareil: string | null = null;
  let compteurToast = 0;
  let compteurTache = 0;

  // ---- Toasts ------------------------------------------------------------------------------------------------------------
  function toast(t: Omit<Toast, "id">, duree = 5000) {
    const id = ++compteurToast;
    ecrire({ toast: { ...t, id } });
    if (minuteurToast) clearTimeout(minuteurToast);
    minuteurToast = setTimeout(() => {
      if (lire().toast?.id === id) ecrire({ toast: null });
    }, duree);
  }
  function suspendreToast(oui: boolean) {
    if (oui && minuteurToast) clearTimeout(minuteurToast);
    else if (!oui) {
      const id = lire().toast?.id;
      minuteurToast = setTimeout(() => {
        if (lire().toast?.id === id) ecrire({ toast: null });
      }, 2500);
    }
  }

  // ---- Réglages -------------------------------------------------------------------------------------------------------------
  let minuteurReglages: ReturnType<typeof setTimeout> | null = null;
  function sauverReglages() {
    if (minuteurReglages) clearTimeout(minuteurReglages);
    minuteurReglages = setTimeout(() => {
      void hote.fichiers.ecrireTexte(hote.fichiers.joindre(env.dossierDonnees, "reglages.json"), JSON.stringify(lire().reglages, null, 2)).catch(() => journal.ecrire("attention", "réglages non enregistrés"));
    }, 300);
  }

  function appliquerAnimations(a: Animations) {
    const racine = document.documentElement;
    if (a === "reduites") racine.setAttribute("data-motion", "reduced");
    else if (a === "completes") racine.setAttribute("data-motion", "full");
    else racine.removeAttribute("data-motion");
  }

  function lireReglages(texte: string | null): Reglages {
    let brut: Partial<Reglages> = {};
    try {
      brut = texte ? JSON.parse(texte) : {};
    } catch {
      brut = {};
    }
    const r: Reglages = { ...REGLAGES_DEFAUT, preuves: {} };
    if (typeof brut.dossierMedias === "string" && brut.dossierMedias.length < 1024) r.dossierMedias = brut.dossierMedias;
    if (brut.chutier === "aethryon" || brut.chutier === "selection" || brut.chutier === "racine") r.chutier = brut.chutier;
    if (brut.format === "mp4" || brut.format === "mp3") r.format = brut.format;
    if (typeof brut.qualite === "string" && ["best", "2160", "1440", "1080", "720", "480", "360"].includes(brut.qualite)) r.qualite = brut.qualite as Qualite;
    if (brut.bitrate === 128 || brut.bitrate === 192 || brut.bitrate === 320) r.bitrate = brut.bitrate;
    r.importAuto = brut.importAuto === true;
    if (brut.animations === "reduites" || brut.animations === "completes") r.animations = brut.animations;
    if (brut.vue === "liste") r.vue = "liste";
    if (typeof brut.vignette === "number" && brut.vignette >= 0 && brut.vignette <= 1) r.vignette = brut.vignette;
    if (typeof brut.tri === "string" && ["recent", "ancien", "nom", "taille", "duree"].includes(brut.tri)) r.tri = brut.tri as Tri;
    if (brut.preuves && typeof brut.preuves === "object") r.preuves = brut.preuves;
    return r;
  }

  function changerReglage<K extends keyof Reglages>(cle_: K, valeur: Reglages[K]) {
    const reglages = { ...lire().reglages, [cle_]: valeur };
    ecrire({ reglages });
    if (cle_ === "animations") appliquerAnimations(valeur as Animations);
    if (cle_ === "format" || cle_ === "qualite" || cle_ === "bitrate") ecrire((e) => ({ choix: { ...e.choix, [cle_]: valeur } }));
    if (cle_ === "importAuto" && valeur) presentsVus = new Set(lire().medias.map((x) => x.id));
    sauverReglages();
  }

  function enregistrerPreuve(nom: keyof Reglages["preuves"], ok: boolean) {
    const p: Preuve = { ok, le: new Date().toISOString(), premiere: lire().env?.premiereVersion ?? null };
    changerReglage("preuves", { ...lire().reglages.preuves, [nom]: p });
  }

  // ---- Démarrage ------------------------------------------------------------------------------------------------------------
  async function demarrer() {
    try {
      env = await hote.environnement();
      const appdata = env.dossierDonnees.replace(/[\\/]AETHRYON[\\/]premiere$/i, "");
      fichiersDesktop = cheminsDesktop(hote.fichiers, env.racineEchanges, appdata);
      dossierMiniatures = hote.fichiers.joindre(env.racineEchanges, "premiere", "miniatures");
      const [texteReglages, capacites, texteRecents, texteMesures, texteConfig] = await Promise.all([
        hote.fichiers.lireTexte(hote.fichiers.joindre(env.dossierDonnees, "reglages.json")),
        hote.capacites(),
        hote.fichiers.lireTexte(hote.fichiers.joindre(env.dossierDonnees, "recents.json")),
        hote.fichiers.lireTexte(hote.fichiers.joindre(dossierMiniatures, "mesures.json")),
        hote.fichiers.lireTexte(fichiersDesktop.config),
      ]);
      const reglages = lireReglages(texteReglages);
      appliquerAnimations(reglages.animations);
      const configDesktop = lireConfigDesktop(texteConfig);
      const dossierMedias = reglages.dossierMedias || configDesktop.dossierMedias || env.dossierMediasParDefaut;
      mesures = lireMesures(texteMesures);
      ecrire({
        env, capacites, reglages, dossierMedias, recents: lireRecents(texteRecents),
        choix: { format: reglages.format, qualite: reglages.qualite, bitrate: reglages.bitrate },
      });
      await restaurerConnexion();
      ecrire({ pret: true });
      demarrerCommandes();
      journal.ecrire("info", `panneau ${VERSION} démarré (${env.hote}, Premiere ${env.premiereVersion ?? "?"})`);
      void verifierProjet();
      void rafraichirBibliotheque(true);
      planifier();
      void hote.signature().then((s) => ecrire({ signature: s })).catch(() => {});
    } catch (e) {
      ecrire({ pret: true, erreurDemarrage: e instanceof Error ? e.message : String(e) });
    }
  }

  function lireRecents(texte: string | null): Recent[] {
    try {
      const v = texte ? JSON.parse(texte) : null;
      return Array.isArray(v?.recents) ? (v.recents as Recent[]).filter((r) => r && typeof r.chemin === "string").slice(0, 40) : [];
    } catch {
      return [];
    }
  }

  function lireMesures(texte: string | null): Record<string, Mesure> {
    try {
      const v = texte ? JSON.parse(texte) : null;
      return v && typeof v === "object" && v.schema === 1 && v.mesures && typeof v.mesures === "object" ? v.mesures : {};
    } catch {
      return {};
    }
  }

  async function sauverRecents(recents: Recent[]) {
    ecrire({ recents });
    try {
      await hote.fichiers.ecrireTexte(hote.fichiers.joindre(env.dossierDonnees, "recents.json"), JSON.stringify({ schema: 1, recents }, null, 1));
    } catch {
      journal.ecrire("attention", "liste des imports récents non enregistrée");
    }
  }

  // ---- Visibilité et rythme ----------------------------------------------------------------------------------------------
  function planifier() {
    if (minuteurBiblio) clearTimeout(minuteurBiblio);
    if (!lire().visible) return;
    minuteurBiblio = setTimeout(async () => {
      await rafraichirBibliotheque(false);
      planifier();
    }, 4000);
  }

  // ---- Commandes d'AETHRYON Desktop (2.0.1, contrat §5, §9) -------------------------------------------------------------
  // Seule `importer` est exécutée, par le même chemin qu'un import manuel (importerChemins : importFiles, vérification,
  // imports.json, état des cartes) ; toast discret ; résultat réel dans traitees\ (src/lib/commandes.ts).
  function demarrerCommandes() {
    recepteur = creerRecepteurCommandes({
      fichiers: hote.fichiers,
      aTraiter: fichiersDesktop.aTraiter,
      traitees: fichiersDesktop.traitees,
      index: fichiersDesktop.index,
      posix: env.posix,
      projet: async () => {
        const projet = await hote.premiere.projet();
        ecrire({ projet, projetVerifie: true });
        return projet;
      },
      importer: (chemins, mode) => importerChemins(chemins, mode, true),
      signaler: (s) => toast({ type: s.type, titre: typo(s.titre), texte: typo(s.texte) }),
      journal: (niveau, message) => journal.ecrire(niveau, message),
    });
    surveillerCommandes();
  }

  function surveillerCommandes() {
    if (minuteurCommandes) clearTimeout(minuteurCommandes);
    minuteurCommandes = setTimeout(async () => {
      try {
        await recepteur?.passe();
      } catch (e) {
        journal.ecrire("attention", "commandes d’AETHRYON Desktop : " + (e instanceof Error ? e.message : String(e)));
      }
      surveillerCommandes();
    }, 1000);
  }

  function battre() {
    if (minuteurBattement) clearTimeout(minuteurBattement);
    const e = lire();
    if (e.desktop.installe && env) {
      void hote.fichiers.ecrireTexte(fichiersDesktop.battementPanneau, battementPanneau(VERSION, e.env?.premiereVersion ?? null, e.projet?.nom ?? null, e.visible)).catch(() => {});
    }
    minuteurBattement = setTimeout(battre, e.visible ? 2000 : 10000);
  }

  hote.surVisibilite((visible) => {
    ecrire({ visible });
    fileMiniatures.pause(!visible);
    battre();
    if (visible) {
      void verifierProjet();
      void rafraichirBibliotheque(true);
      planifier();
    } else if (minuteurBiblio) clearTimeout(minuteurBiblio);
  });

  // ---- Projet Premiere ----------------------------------------------------------------------------------------------------
  async function verifierProjet(): Promise<InfoProjet | null> {
    try {
      const projet = await hote.premiere.projet();
      ecrire({ projet, projetVerifie: true });
      return projet;
    } catch (e) {
      journal.ecrire("attention", "projet illisible : " + (e instanceof Error ? e.message : String(e)));
      ecrire({ projet: null, projetVerifie: true });
      return null;
    }
  }

  async function verifierImportes(force = false) {
    const t = Date.now();
    if (!force && t - derniereVerifProjet < 15000) return;
    derniereVerifProjet = t;
    const projet = await verifierProjet();
    const e = lire();
    if (!projet) {
      if (e.importes.size) ecrire({ importes: new Set() });
      return;
    }
    const prets = e.medias.filter((x) => x.etatSource === "disponible").map((x) => x.chemin);
    if (!prets.length) return;
    try {
      const presents = await hote.premiere.presentsDansProjet(prets.slice(0, 2000));
      const ids = new Set(presents.map(idPourChemin));
      const avant = lire().importes;
      if (ids.size !== avant.size || [...ids].some((i) => !avant.has(i))) ecrire({ importes: ids });
    } catch (err) {
      journal.ecrire("attention", "vérification du projet impossible : " + (err instanceof Error ? err.message : String(err)));
    }
  }

  // ---- Bibliothèque -------------------------------------------------------------------------------------------------------
  let rafraichissementEnCours = false;
  async function rafraichirBibliotheque(forcerProjet: boolean) {
    if (rafraichissementEnCours || !env) return;
    rafraichissementEnCours = true;
    try {
      const e = lire();
      const [entrees, texteBattement, texteIndex] = await Promise.all([
        hote.fichiers.lister(e.dossierMedias),
        hote.fichiers.lireTexte(fichiersDesktop.battementDesktop),
        hote.fichiers.lireTexte(fichiersDesktop.index),
      ]);
      const desktop = lireBattement(texteBattement);
      if (texteIndex !== null) desktop.installe = true;
      const dossier = entrees ? depuisDossier(entrees, e.dossierMedias, hote.fichiers.joindre) : [];
      const indexDesktop = texteIndex ? depuisIndexDesktop(safeJson(texteIndex), fichiersDesktop.miniatures, hote.fichiers.joindre, env.posix) : [];
      const presents = new Set(dossier.map((x) => x.id));
      const horsDossier = e.recents.filter((r) => !presents.has(idPourChemin(r.chemin)));
      const existences = new Map<string, boolean>();
      await Promise.all(horsDossier.map(async (r) => existences.set(r.chemin, await hote.fichiers.existe(r.chemin))));
      const recents = depuisRecents(e.recents, (c) => presents.has(idPourChemin(c)) || existences.get(c) === true);
      let medias = fusionner(dossier, indexDesktop, recents);
      medias = medias.map((x) => appliquerMesure(x));
      const avant = lire().medias;
      const change = avant.length !== medias.length || medias.some((x, i) => {
        const a = avant[i];
        return !a || a.id !== x.id || a.taille !== x.taille || a.etatSource !== x.etatSource || a.duree !== x.duree || a.miniature !== x.miniature;
      });
      ecrire({
        desktop,
        biblio: { ...lire().biblio, chargee: true, dossierAbsent: entrees === null },
        ...(change ? { medias } : {}),
      });
      if (desktop.installe && !minuteurBattement) battre();
      await importAutomatique(medias);
      await verifierImportes(forcerProjet);
    } finally {
      rafraichissementEnCours = false;
    }
  }

  function appliquerMesure(x: Media): Media {
    const me = mesures[x.id];
    if (!me || (me.modifie && x.modifieLe && me.modifie !== x.modifieLe)) return x;
    return { ...x, duree: x.duree ?? me.duree, largeur: x.largeur ?? me.largeur, hauteur: x.hauteur ?? me.hauteur };
  }

  async function importAutomatique(medias: Media[]) {
    const r = lire().reglages;
    if (!r.importAuto) {
      presentsVus = null;
      return;
    }
    if (!presentsVus) {
      presentsVus = new Set(medias.map((x) => x.id));
      return;
    }
    const nouveaux = medias.filter((x) => !presentsVus!.has(x.id) && x.etatSource === "disponible" && x.type !== "image");
    for (const x of medias) presentsVus.add(x.id);
    if (nouveaux.length && lire().projet) {
      journal.ecrire("info", `import automatique de ${nouveaux.length} fichier(s) arrivé(s) dans le dossier`);
      await importerMedias(nouveaux.map((x) => x.id), "auto");
    }
  }

  // ---- Miniatures -----------------------------------------------------------------------------------------------------------
  let minuteurMesures: ReturnType<typeof setTimeout> | null = null;
  function sauverMesures() {
    if (minuteurMesures) clearTimeout(minuteurMesures);
    minuteurMesures = setTimeout(() => {
      void hote.fichiers.ecrireTexte(hote.fichiers.joindre(dossierMiniatures, "mesures.json"), JSON.stringify({ schema: 1, mesures })).catch(() => {});
    }, 1500);
  }

  const fileMiniatures = creerFileMiniatures(async (id) => {
    const x = lire().medias.find((y) => y.id === id);
    if (!x || x.etatSource === "introuvable") return;
    let url: string | null = null;
    if (x.miniature) url = hote.fichiers.urlLocale(x.miniature);
    const me = mesures[id];
    if (!url && me?.fichier && (!me.modifie || me.modifie === x.modifieLe) && (await hote.fichiers.existe(me.fichier))) url = hote.fichiers.urlLocale(me.fichier);
    if (url) {
      ecrire((e) => ({ miniatures: { ...e.miniatures, [id]: url! } }));
      return;
    }
    const source = hote.fichiers.urlLocale(x.chemin);
    let r: { dataUrl: string | null; duree: number | null; largeur: number | null; hauteur: number | null };
    if (x.type === "video") r = await miniatureVideo(source);
    else if (x.type === "image") r = await miniatureImage(source);
    else r = { dataUrl: null, ...(await mesurerAudio(source)) };
    let fichier: string | null = null;
    if (r.dataUrl) {
      fichier = hote.fichiers.joindre(dossierMiniatures, `${id}.jpg`);
      try {
        await hote.fichiers.ecrireBase64(fichier, r.dataUrl.slice(r.dataUrl.indexOf(",") + 1));
      } catch {
        fichier = null;
      }
      const d = r.dataUrl;
      ecrire((e) => ({ miniatures: { ...e.miniatures, [id]: d } }));
    }
    if (r.duree != null || r.largeur != null || fichier) {
      mesures[id] = { modifie: x.modifieLe, duree: r.duree, largeur: r.largeur, hauteur: r.hauteur, fichier };
      sauverMesures();
      ecrire((e) => ({ medias: e.medias.map((y) => (y.id === id ? appliquerMesure(y) : y)) }));
    }
  });

  // ---- Accueil : lien, aperçu, conversion -----------------------------------------------------------------------------------
  function saisir(texte: string) {
    const lien = analyserLien(texte);
    const precedent = lire().lien;
    ecrire({ saisie: texte, lien, refus: lien || texte.trim().length < 6 ? "" : raisonRefus(texte) });
    if (minuteurApercu) clearTimeout(minuteurApercu);
    if (!lien) {
      if (lire().apercu.etat !== "vide") ecrire({ apercu: { etat: "vide", donnees: null, miniature: null, erreur: null, pourUrl: null } });
      return;
    }
    if (precedent?.url === lien.url && lire().apercu.pourUrl === lien.url && lire().apercu.etat !== "erreur") return;
    minuteurApercu = setTimeout(() => void chargerApercu(lien), 320);
  }

  async function coller(): Promise<boolean> {
    try {
      const t = await navigator.clipboard.readText();
      if (t && t.length < 2048) {
        saisir(t.trim());
        return true;
      }
    } catch {
      /* presse-papiers refusé : l'utilisateur colle avec Ctrl V */
    }
    return false;
  }

  async function chargerApercu(lien: LienMedia) {
    const n = ++sequenceApercu;
    if (lire().connexion.etat !== "connecte") {
      ecrire({ apercu: { etat: "vide", donnees: null, miniature: null, erreur: null, pourUrl: lien.url } });
      return;
    }
    ecrire({ apercu: { etat: "chargement", donnees: null, miniature: null, erreur: null, pourUrl: lien.url } });
    try {
      const a = await client.apercu(lien.url);
      if (n !== sequenceApercu) return;
      const reel = a.entries && a.entries.length ? { ...a.entries[(lien.rang || 1) - 1] ?? a.entries[0]!, platform: a.platform, media_count: a.media_count } : a;
      ecrire({ apercu: { etat: "pret", donnees: reel, miniature: null, erreur: null, pourUrl: lien.url } });
      ajusterExtrait(reel.duration);
      let mini: string | null = null;
      if (reel.thumbnail_id) mini = await client.miniature(reel.thumbnail_id).catch(() => null);
      if (!mini) mini = miniatureSure(reel.thumbnail);
      if (n === sequenceApercu && mini) ecrire((e) => ({ apercu: { ...e.apercu, miniature: mini } }));
    } catch (err) {
      if (n !== sequenceApercu) return;
      if (err instanceof ErreurApi && err.statut === 401) await refusYtapi();
      ecrire({ apercu: { etat: "erreur", donnees: null, miniature: null, erreur: messageErreur(err), pourUrl: lien.url } });
    }
  }

  function ajusterExtrait(duree: number | null) {
    if (!duree) return;
    const fin = Math.min(duree, 30);
    ecrire({ extrait: { ...lire().extrait, debut: "0:00", fin: formatSecondes(fin) } });
  }

  function choisir<K extends keyof EtatApp["choix"]>(k: K, v: EtatApp["choix"][K]) {
    ecrire((e) => ({ choix: { ...e.choix, [k]: v } }));
  }

  function changerExtrait(maj: Partial<EtatApp["extrait"]>) {
    ecrire((e) => ({ extrait: { ...e.extrait, ...maj } }));
  }

  /** Vérifie l'extrait : null si valable (ou désactivé), sinon le message à montrer. */
  function erreurExtrait(e = lire()): string | null {
    if (!e.extrait.actif) return null;
    const d = lireSecondes(e.extrait.debut);
    const f = lireSecondes(e.extrait.fin);
    if (d == null || f == null) return "Écris le début et la fin en minutes:secondes (ex. 1:05).";
    if (f <= d) return "La fin doit venir après le début.";
    const max = EXTRAIT_MAX_S[e.choix.format];
    if (f - d > max) return `Extrait limité à ${max / 60} min en ${e.choix.format.toUpperCase()}.`;
    const duree = e.apercu.donnees?.duration;
    if (duree && d >= duree) return "Le début est après la fin de la vidéo.";
    return null;
  }

  async function importerDepuisLien() {
    const e = lire();
    if (!e.lien) return;
    if (e.connexion.etat !== "connecte") {
      naviguer("compte");
      toast({ type: "info", titre: "Connecte ton compte", texte: "La conversion utilise ton compte AETHRYON et son quota." });
      return;
    }
    if (e.tache && (e.tache.phase === "conversion" || e.tache.phase === "telechargement" || e.tache.phase === "import")) return;
    const errExtrait = erreurExtrait(e);
    if (errExtrait) {
      toast({ type: "erreur", titre: "Extrait invalide", texte: errExtrait });
      return;
    }
    const lien = e.lien;
    const format = e.choix.format;
    const titre = e.apercu.donnees?.title || `${NOM_PLATEFORME[lien.plateforme]} · ${lien.id}`;
    const id = ++compteurTache;
    annulerTache = new AbortController();
    const signal = annulerTache.signal;
    const maj = (t: Partial<Tache>) => ecrire((x) => (x.tache && x.tache.id === id ? { tache: { ...x.tache, ...t } } : {}));
    ecrire({ tache: { id, titre, plateforme: lien.plateforme, format, phase: "conversion", libelle: "Envoi au serveur AETHRYON", conversion: 0, octets: null, chemin: null, erreur: null, message: null } });
    let debut: number | undefined;
    let fin: number | undefined;
    if (e.extrait.actif) {
      debut = lireSecondes(e.extrait.debut) ?? undefined;
      fin = lireSecondes(e.extrait.fin) ?? undefined;
    }
    try {
      let job: Job = await client.creerJob({ url: lien.url, fmt: format, quality: e.choix.qualite, bitrate: e.choix.bitrate, start_s: debut, end_s: fin, index: lien.rang });
      jobCourant = job.job_id;
      journal.ecrire("info", `conversion ${job.job_id} lancée (${lien.plateforme}, ${format}${debut != null ? ", extrait" : ""})`);
      while (job.status !== "done") {
        if (signal.aborted) throw new DOMException("annulé", "AbortError");
        maj({ libelle: libelleEtape(job), conversion: Math.max(0, Math.min(1, (job.progress || 0) / 100)) });
        job = await client.suivreJob(job.job_id);
      }
      maj({ libelle: "Conversion terminée", conversion: 1, phase: "telechargement", octets: { recus: 0, total: job.size_bytes ?? null } });
      if (signal.aborted) throw new DOMException("annulé", "AbortError");
      const fichier = await client.telechargerFichier(job, lire().dossierMedias, (recus, total) => maj({ octets: { recus, total }, libelle: "Téléchargement dans le dossier des médias" }), signal);
      jobCourant = null;
      journal.ecrire("info", `fichier reçu (${taille(fichier.taille)}) : ${nomDe(fichier.chemin)}`);
      maj({ phase: "import", chemin: fichier.chemin, libelle: "Import dans Premiere" });
      const recent: Recent = { chemin: fichier.chemin, titre: job.title || titre, plateforme: lien.plateforme, url: lien.url, format, le: new Date().toISOString(), duree: debut != null && fin != null ? fin - debut : e.apercu.donnees?.duration ?? null, taille: fichier.taille, importeDans: null };
      await sauverRecents([recent, ...lire().recents.filter((r) => idPourChemin(r.chemin) !== idPourChemin(fichier.chemin))].slice(0, 40));
      await rafraichirBibliotheque(false);
      const projet = await verifierProjet();
      if (!projet) {
        maj({ phase: "termine", message: "Fichier enregistré. Ouvre un projet dans Premiere, puis importe-le depuis la bibliothèque." });
        toast({ type: "attention", titre: "Fichier prêt, aucun projet ouvert", texte: typo(nomDe(fichier.chemin)) });
        return;
      }
      const bilan = await importerChemins([fichier.chemin], lire().reglages.chutier);
      const r = bilan.resultats[0];
      if (bilan.ok && r) {
        recent.importeDans = bilan.projet;
        await sauverRecents(lire().recents.map((x) => (x.chemin === recent.chemin ? recent : x)));
        maj({ phase: "termine", message: r.deja ? "Déjà dans le projet : aucun second import." : `Importé dans « ${bilan.chutier ?? "AETHRYON"} » · ${bilan.projet ?? ""}` });
        toast({
          type: r.horsLigne ? "attention" : "ok",
          titre: r.deja ? "Déjà dans le projet" : `Importé dans « ${bilan.chutier ?? "AETHRYON"} »`,
          texte: typo(`${recent.titre ?? nomDe(fichier.chemin)} · ${bilan.projet ?? ""}`),
          action: { libelle: "Moniteur source", faire: () => void ouvrirMoniteurSourceChemin(fichier.chemin) },
        });
      } else {
        const msg = messageImport(r);
        maj({ phase: "erreur", erreur: msg });
        toast({ type: "erreur", titre: "Import impossible", texte: msg });
      }
    } catch (err) {
      const annule = signal.aborted || (err instanceof DOMException && err.name === "AbortError") || (err as { code?: string })?.code === "ABORT";
      if (jobCourant) {
        void client.quitterJob(jobCourant);
        jobCourant = null;
      }
      if (annule) {
        maj({ phase: "annule", message: "Import annulé : rien n’a été ajouté au projet." });
        return;
      }
      if (err instanceof ErreurApi && err.statut === 401) await refusYtapi();
      const msg = messageErreur(err);
      journal.ecrire("erreur", "import depuis un lien en échec : " + msg);
      maj({ phase: "erreur", erreur: msg });
      toast({ type: "erreur", titre: "Échec", texte: msg });
    } finally {
      annulerTache = null;
    }
  }

  function annulerImportEnCours() {
    annulerTache?.abort();
  }

  function fermerTache() {
    const t = lire().tache;
    if (t && (t.phase === "termine" || t.phase === "erreur" || t.phase === "annule")) ecrire({ tache: null });
  }

  // ---- Import vers Premiere --------------------------------------------------------------------------------------------------
  async function importerChemins(chemins: string[], mode: ModeChutier, depuisDesktop = false): Promise<BilanImport> {
    const ids = chemins.map(idPourChemin);
    ecrire((e) => ({ operations: new Set([...e.operations, ...ids]) }));
    try {
      const bilan = await hote.premiere.importer(chemins, mode);
      const importes = new Set(lire().importes);
      const erreurs = new Map(lire().erreurs);
      for (const r of bilan.resultats) {
        const id = idPourChemin(r.chemin);
        if (r.ok) {
          importes.add(id);
          if (r.horsLigne) erreurs.set(id, "Importé, mais Premiere ne peut pas le lire (média hors ligne : codec non pris en charge).");
          else erreurs.delete(id);
        } else erreurs.set(id, messageImport(r));
      }
      ecrire({ importes, erreurs });
      const reussis = bilan.resultats.filter((r) => r.ok && !r.deja).map((r) => idPourChemin(r.chemin));
      if (reussis.length && (depuisDesktop || lire().desktop.installe) && bilan.projet) {
        try {
          await noterImports(hote.fichiers, fichiersDesktop.imports, reussis, bilan.projet, bilan.chutier || "racine");
        } catch {
          journal.ecrire("attention", "imports.json non écrit");
        }
      }
      if (bilan.resultats.some((r) => r.ok && !r.deja)) journal.ecrire("info", `${bilan.resultats.filter((r) => r.ok && !r.deja).length} import(s) confirmé(s) dans « ${bilan.chutier} » (${bilan.projet})`);
      for (const r of bilan.resultats) if (!r.ok) journal.ecrire("erreur", `import en échec (${nomDe(r.chemin)}) : ${messageImport(r)}`);
      return bilan;
    } catch (err) {
      const msg = "Premiere ne répond pas : " + (err instanceof Error ? err.message : String(err));
      ecrire((e) => {
        const erreurs = new Map(e.erreurs);
        for (const id of ids) erreurs.set(id, msg);
        return { erreurs };
      });
      return { ok: false, chutier: null, projet: null, resultats: chemins.map((c) => ({ chemin: c, ok: false, code: "exception" as const, detail: msg })) };
    } finally {
      ecrire((e) => {
        const operations = new Set(e.operations);
        for (const id of ids) operations.delete(id);
        return { operations };
      });
    }
  }

  async function importerMedias(ids: string[], origine: "utilisateur" | "auto" = "utilisateur") {
    const e = lire();
    const ctx = contexte(e);
    const choisis = e.medias.filter((x) => ids.includes(x.id));
    const prets = choisis.filter((x) => pretPourPremiere(x, ctx));
    const refuses = choisis.length - prets.length;
    if (!prets.length) {
      if (origine === "utilisateur") toast({ type: "erreur", titre: "Rien à importer", texte: refuses ? "Fichier introuvable ou encore en cours d’écriture." : "Choisis au moins un média." });
      return;
    }
    if (!(await verifierProjet())) {
      if (origine === "utilisateur") toast({ type: "erreur", titre: "Aucun projet ouvert", texte: "Ouvre ou crée un projet dans Premiere Pro pour importer." });
      return;
    }
    const bilan = await importerChemins(prets.map((x) => x.chemin), e.reglages.chutier);
    const nouveaux = bilan.resultats.filter((r) => r.ok && !r.deja).length;
    const deja = bilan.resultats.filter((r) => r.deja).length;
    const echecs = bilan.resultats.filter((r) => !r.ok);
    const prefixe = origine === "auto" ? "Import automatique · " : "";
    if (echecs.length && !nouveaux && !deja) {
      toast({ type: "erreur", titre: echecs.length > 1 ? `${echecs.length} imports en erreur` : "Import impossible", texte: prefixe + messageImport(echecs[0]), action: origine === "utilisateur" ? { libelle: "Réessayer", faire: () => void importerMedias(echecs.map((r) => idPourChemin(r.chemin))) } : undefined });
    } else if (nouveaux) {
      const parties = [`${bilan.projet ?? ""}`];
      if (deja) parties.push(`${deja} déjà dans le projet`);
      if (echecs.length) parties.push(`${echecs.length} en erreur`);
      toast({ type: echecs.length ? "attention" : "ok", titre: nouveaux > 1 ? `${nouveaux} médias importés dans « ${bilan.chutier} »` : `Importé dans « ${bilan.chutier} »`, texte: prefixe + parties.filter(Boolean).join(" · ") });
    } else if (deja && origine === "utilisateur") {
      toast({ type: "info", titre: deja > 1 ? `${deja} déjà dans le projet` : "Déjà dans le projet", texte: "Aucun second import." });
    }
    if (origine === "utilisateur") ecrire((x) => ({ biblio: { ...x.biblio, selection: new Set() } }));
  }

  function mediaPar(id: string): Media | undefined {
    return lire().medias.find((x) => x.id === id);
  }

  async function insererTeteLecture(id: string) {
    const x = mediaPar(id);
    if (!x) return;
    if (!pretPourPremiere(x, contexte(lire()))) {
      toast({ type: "erreur", titre: "Insertion impossible", texte: "Fichier introuvable ou encore en cours d’écriture." });
      return;
    }
    ecrire((e) => ({ operations: new Set([...e.operations, id]) }));
    try {
      const r = await hote.premiere.insererTeteLecture(x.chemin, lire().reglages.chutier);
      if (r.ok) {
        ecrire((e) => ({ importes: new Set([...e.importes, id]) }));
        toast({ type: "ok", titre: "Inséré à la tête de lecture", texte: typo(r.message || x.nom) });
      } else toast({ type: "erreur", titre: "Insertion impossible", texte: typo(r.message || "Premiere a refusé l’insertion.") });
    } catch (err) {
      toast({ type: "erreur", titre: "Insertion impossible", texte: messageErreur(err) });
    } finally {
      ecrire((e) => {
        const operations = new Set(e.operations);
        operations.delete(id);
        return { operations };
      });
    }
  }

  async function ouvrirMoniteurSourceChemin(chemin: string) {
    try {
      const r = await hote.premiere.ouvrirMoniteurSource(chemin);
      if (!r.ok) toast({ type: "erreur", titre: "Moniteur source", texte: r.message || "Premiere n’a pas ouvert le fichier." });
    } catch (err) {
      toast({ type: "erreur", titre: "Moniteur source", texte: messageErreur(err) });
    }
  }

  async function afficherDansExplorateur(chemin: string) {
    const r = await hote.afficherDansExplorateur(chemin);
    if (!r.ok) toast({ type: "erreur", titre: "Explorateur", texte: r.message || "L’Explorateur n’a pas pu être ouvert." });
  }

  async function copierChemin(chemin: string) {
    const ok = await hote.copierTexte(chemin);
    toast({ type: ok ? "info" : "erreur", titre: ok ? "Chemin copié" : "Copie impossible", texte: ok ? typo(nomDe(chemin)) : undefined }, 2500);
  }

  /** Glisser vers Premiere : uniquement des fichiers complets et présents. Renvoie false si rien n'est glissable. */
  function glisser(dt: DataTransfer, ids: string[]): boolean {
    const e = lire();
    // Vérification de capacité : une coque qui ne sait pas glisser vers Premiere ne prétend pas le faire.
    if (e.capacites?.glisserVersPremiere === "non") return false;
    const ctx = contexte(e);
    const chemins = e.medias.filter((x) => ids.includes(x.id) && pretPourPremiere(x, ctx)).map((x) => x.chemin);
    if (!chemins.length) return false;
    const poses = hote.preparerGlisser(dt, chemins);
    journal.ecrire("info", `glisser de ${chemins.length} fichier(s) ; formats posés : ${poses.join(", ") || "aucun"}`);
    return poses.length > 0;
  }

  function finGlisser() {
    // Si le dépôt a eu lieu dans Premiere, la carte passe à « Importé » (vérifié dans le projet, jamais supposé).
    setTimeout(() => void verifierImportes(true), 1200);
  }

  // ---- Sélection et aperçu ----------------------------------------------------------------------------------------------------
  function majBiblio(maj: Partial<EtatBiblio>) {
    ecrire((e) => ({ biblio: { ...e.biblio, ...maj } }));
  }

  function selectionner(id: string, mode: "seul" | "basculer" | "plage", visibles: Media[]) {
    const b = lire().biblio;
    if (mode === "seul") return majBiblio({ selection: new Set([id]), ancre: id });
    if (mode === "basculer") {
      const s = new Set(b.selection);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return majBiblio({ selection: s, ancre: id });
    }
    const i0 = visibles.findIndex((x) => x.id === (b.ancre || id));
    const i1 = visibles.findIndex((x) => x.id === id);
    if (i0 < 0 || i1 < 0) return majBiblio({ selection: new Set([id]), ancre: id });
    const [a, z] = i0 < i1 ? [i0, i1] : [i1, i0];
    majBiblio({ selection: new Set(visibles.slice(a, z + 1).map((x) => x.id)) });
  }

  // ---- Compte ---------------------------------------------------------------------------------------------------------------
  async function restaurerConnexion() {
    try {
      const c = await hote.coffre.lire();
      if (c && c.cle) {
        if (c.expireLe && Date.parse(c.expireLe) < Date.now()) {
          await hote.coffre.effacer();
          ecrire({ connexion: { ...CONNEXION_INITIALE, etat: "deconnecte", erreur: "Ta connexion a expiré (30 jours) : reconnecte le panneau." } });
          return;
        }
        cle = c.cle;
        declarerSecret(cle);
        ecrire({ connexion: { ...CONNEXION_INITIALE, etat: "connecte", compte: c.compte, expireLe: c.expireLe, protection: await hote.coffre.protection() } });
        void chargerMoi();
        return;
      }
    } catch {
      journal.ecrire("attention", "clé enregistrée illisible");
    }
    ecrire({ connexion: { ...CONNEXION_INITIALE, etat: "deconnecte" } });
  }

  async function chargerMoi() {
    if (!cle) return;
    ecrire((e) => ({ connexion: { ...e.connexion, moiChargement: true, moiErreur: null } }));
    try {
      const moi = await client.moi();
      ecrire((e) => ({ connexion: { ...e.connexion, moi, moiChargement: false, expireLe: moi.cle.expireLe ?? e.connexion.expireLe, compte: { email: moi.compte.email, nom: moi.compte.nom || e.connexion.compte?.nom || "" } } }));
    } catch (err) {
      if (err instanceof ErreurApi && err.statut === 401) {
        await cleRefusee(err.message);
        return;
      }
      ecrire((e) => ({ connexion: { ...e.connexion, moiChargement: false, moiErreur: messageErreur(err) } }));
    }
  }

  async function cleRefusee(motif?: string) {
    oublierSecret(cle);
    cle = null;
    await hote.coffre.effacer().catch(() => {});
    ecrire({ connexion: { ...CONNEXION_INITIALE, etat: "deconnecte", erreur: motif || "Ta connexion a été révoquée ou a expiré : reconnecte le panneau." } });
  }

  /** 401 de ytapi : le motif est demandé à /api/premiere/moi ; la clé n'est effacée que si le compte la refuse aussi. */
  async function refusYtapi() {
    if (!cle) return;
    try {
      await client.moi();
    } catch (err) {
      if (err instanceof ErreurApi && err.statut === 401) await cleRefusee(err.message);
    }
  }

  async function connecter() {
    const n = ++attenteConnexion;
    ecrire((e) => ({ connexion: { ...e.connexion, erreur: null } }));
    try {
      const e = lire();
      const a = await client.appairer(e.env?.nomMachine || "PC", e.env?.premiereVersion ?? null, VERSION);
      codeAppareil = a.codeAppareil;
      declarerSecret(codeAppareil);
      const url = client.urlPageAccord(a);
      ecrire((x) => ({ connexion: { ...x.connexion, etat: "attente", attente: { code: a.codeUtilisateur, url, expireA: Date.now() + a.expireDans * 1000 } } }));
      try {
        await hote.ouvrirUrl(url);
      } catch {
        toast({ type: "attention", titre: "Navigateur non ouvert", texte: "Ouvre la page indiquée et saisis le code." });
      }
      let intervalle = a.intervalle;
      const limite = Date.now() + a.expireDans * 1000;
      while (n === attenteConnexion && Date.now() < limite) {
        await pause(intervalle * 1000);
        if (n !== attenteConnexion) return;
        let r;
        try {
          r = await client.jeton(a.codeAppareil);
        } catch (err) {
          // Réseau momentanément coupé : on garde le code et on réessaie au prochain tour.
          journal.ecrire("attention", "interrogation de la connexion : " + messageErreur(err));
          continue;
        }
        if (r.etat === "en-attente") continue;
        if (r.etat === "lent") {
          // Trop rapide : attendre le délai demandé (Retry-After) en plus, puis reprendre au rythme indiqué.
          await pause(Math.max(0, r.intervalle - intervalle) * 1000);
          continue;
        }
        oublierSecret(codeAppareil);
        codeAppareil = null;
        if (r.etat === "accorde") {
          cle = r.cle;
          declarerSecret(cle);
          const protection = await hote.coffre.ecrire({ cle: r.cle, expireLe: r.expireLe, compte: r.compte, enregistreeLe: new Date().toISOString() });
          ecrire({ connexion: { ...CONNEXION_INITIALE, etat: "connecte", compte: r.compte, expireLe: r.expireLe, protection } });
          journal.ecrire("info", "panneau connecté au compte AETHRYON (clé de type premiere)");
          toast({ type: "ok", titre: "Compte connecté", texte: r.compte.email ? typo(r.compte.email) : undefined });
          void chargerMoi();
          const l = lire().lien;
          if (l) void chargerApercu(l);
          return;
        }
        journal.ecrire(r.etat === "deja-utilise" ? "attention" : "info", "connexion du panneau terminée sans clé : " + r.etat);
        ecrire({ connexion: { ...CONNEXION_INITIALE, etat: "deconnecte", erreur: r.etat === "indisponible" ? null : r.message, indisponible: r.etat === "indisponible", tropDOrdinateurs: r.etat === "trop-d-ordinateurs" } });
        return;
      }
      if (n === attenteConnexion) ecrire({ connexion: { ...CONNEXION_INITIALE, etat: "deconnecte", erreur: "Le code a expiré (10 minutes) : relance la connexion." } });
    } catch (err) {
      if (n !== attenteConnexion) return;
      if (err instanceof ErreurApi && err.code === "indisponible") {
        journal.ecrire("info", "connexion du panneau pas encore ouverte sur le serveur (404)");
        ecrire({ connexion: { ...CONNEXION_INITIALE, etat: "deconnecte", indisponible: true } });
        return;
      }
      ecrire({ connexion: { ...CONNEXION_INITIALE, etat: "deconnecte", erreur: messageErreur(err) } });
    }
  }

  function annulerConnexion() {
    attenteConnexion++;
    oublierSecret(codeAppareil);
    codeAppareil = null;
    ecrire({ connexion: { ...CONNEXION_INITIALE, etat: "deconnecte" } });
  }

  async function rouvrirPageAccord() {
    const a = lire().connexion.attente;
    if (a) await hote.ouvrirUrl(a.url).catch(() => {});
  }

  async function deconnecter() {
    let revoquee = false;
    try {
      revoquee = await client.deconnecter();
    } catch {
      revoquee = false;
    }
    oublierSecret(cle);
    cle = null;
    await hote.coffre.effacer().catch(() => {});
    ecrire({ connexion: { ...CONNEXION_INITIALE, etat: "deconnecte" }, apercu: { etat: "vide", donnees: null, miniature: null, erreur: null, pourUrl: null } });
    journal.ecrire("info", revoquee ? "déconnecté : clé révoquée sur le serveur et effacée du PC" : "déconnecté : clé effacée du PC (révocation serveur non confirmée)");
    toast(revoquee
      ? { type: "info", titre: "Déconnecté", texte: "La clé du panneau est révoquée et effacée de ce PC." }
      : { type: "attention", titre: "Déconnecté de ce PC", texte: "Le serveur n’a pas confirmé la révocation : révoque la clé « Premiere Pro » dans « Mes jetons » (ton espace AETHRYON)." }, 8000);
  }

  // ---- Réglages : dossier des médias ------------------------------------------------------------------------------------------
  async function choisirDossierMedias() {
    const d = await hote.choisirDossier(lire().dossierMedias, "Dossier des médias AETHRYON");
    if (!d) return;
    const t = await hote.fichiers.testerEcriture(d);
    if (!t.ok) {
      toast({ type: "erreur", titre: "Dossier refusé", texte: t.message });
      return;
    }
    changerReglage("dossierMedias", d);
    ecrire({ dossierMedias: d, medias: [], biblio: { ...lire().biblio, chargee: false } });
    void rafraichirBibliotheque(true);
  }

  async function dossierParDefaut() {
    changerReglage("dossierMedias", null);
    const texteConfig = await hote.fichiers.lireTexte(fichiersDesktop.config);
    const d = lireConfigDesktop(texteConfig).dossierMedias || env.dossierMediasParDefaut;
    ecrire({ dossierMedias: d, medias: [], biblio: { ...lire().biblio, chargee: false } });
    void rafraichirBibliotheque(true);
  }

  async function creerDossierMedias() {
    try {
      await hote.fichiers.creerDossier(lire().dossierMedias);
      await rafraichirBibliotheque(true);
    } catch (err) {
      toast({ type: "erreur", titre: "Dossier non créé", texte: messageErreur(err) });
    }
  }

  // ---- Navigation -------------------------------------------------------------------------------------------------------------
  function naviguer(page: Page) {
    const e = lire();
    if (e.page === page) return;
    ecrire({ page, retour: e.page === "reglages" || e.page === "diagnostic" ? e.retour : e.page });
    if (page === "compte" && e.connexion.etat === "connecte") void chargerMoi();
    if (page === "bibliotheque") void rafraichirBibliotheque(true);
  }

  const diagnostic = creerDiagnostic({ hote, client, lire, ecrire, journal, enregistrerPreuve, env: () => env, dossierEssais: () => hote.fichiers.joindre(env.racineEchanges, "premiere", "diagnostic") });

  hote.definirMenu(
    [
      { id: "accueil", libelle: "Accueil" },
      { id: "bibliotheque", libelle: "Bibliothèque" },
      { id: "compte", libelle: "Compte" },
      { id: "sep", libelle: "", separateur: true },
      { id: "reglages", libelle: "Réglages" },
      { id: "diagnostic", libelle: "Diagnostic" },
    ],
    (id) => {
      if (id === "accueil" || id === "bibliotheque" || id === "compte" || id === "reglages" || id === "diagnostic") naviguer(id);
    },
  );

  if (typeof window !== "undefined") {
    window.addEventListener("resize", () => ecrire({ largeur: window.innerWidth }));
  }

  return {
    magasin: m,
    journal,
    hote,
    client,
    actions: {
      demarrer, naviguer, saisir, coller, choisir, changerExtrait, erreurExtrait, importerDepuisLien, annulerImportEnCours, fermerTache,
      rechargerApercu: () => {
        const l = lire().lien;
        if (l) void chargerApercu(l);
      },
      rafraichirBibliotheque: () => rafraichirBibliotheque(true),
      demanderMiniature: (id: string) => fileMiniatures.demander(id),
      importerMedias, insererTeteLecture,
      ouvrirMoniteurSource: (id: string) => {
        const x = mediaPar(id);
        if (x) void ouvrirMoniteurSourceChemin(x.chemin);
      },
      afficherDansExplorateur: (chemin: string) => void afficherDansExplorateur(chemin),
      copierChemin: (chemin: string) => void copierChemin(chemin),
      glisser, finGlisser, majBiblio, selectionner,
      connecter, annulerConnexion, rouvrirPageAccord, deconnecter, chargerMoi,
      ouvrirEspace: () => hote.ouvrirUrl(client.config.compte + ROUTES.jetons).catch(() => toast({ type: "erreur", titre: "Navigateur non ouvert" })),
      changerReglage, choisirDossierMedias, dossierParDefaut, creerDossierMedias,
      fermerToast: () => ecrire({ toast: null }),
      suspendreToast,
      urlLocale: (chemin: string) => hote.fichiers.urlLocale(chemin),
      diagnostic,
    },
  };
}

export type App = ReturnType<typeof creerApp>;
export type Actions = App["actions"];

// ---- Aides -----------------------------------------------------------------------------------------------------------------
function pause(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeJson(texte: string): unknown {
  try {
    return JSON.parse(texte.replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

export function lireSecondes(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(t);
  if (!m) return null;
  const h = Number(m[1] || 0), mn = Number(m[2]), sec = Number(m[3]);
  if (mn >= 60 || sec >= 60) return null;
  return h * 3600 + mn * 60 + sec;
}

export function formatSecondes(s: number): string {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), mn = Math.floor((t % 3600) / 60), sec = t % 60;
  const p = (n: number) => (n < 10 ? "0" : "") + n;
  return h ? `${h}:${p(mn)}:${p(sec)}` : `${mn}:${p(sec)}`;
}

export function messageErreur(err: unknown): string {
  if (err instanceof ErreurApi) return err.message;
  if (err instanceof Error) return typo(err.message);
  return "Erreur inattendue.";
}

export function messageImport(r: { code?: string; detail?: string; chemin: string } | undefined): string {
  if (!r) return "Premiere n’a rien répondu.";
  if (r.code === "introuvable") return "Fichier introuvable : il a été déplacé, renommé ou supprimé.";
  if (r.code === "aucunProjet") return "Aucun projet ouvert dans Premiere.";
  if (r.code === "exception") return "Premiere a refusé l’import : " + (r.detail || "erreur inconnue") + ".";
  const ext = (r.chemin.split(".").pop() || "").toLowerCase();
  if (ext === "webm" || ext === "mkv" || ext === "opus" || ext === "ogg") return "Format absent de la liste d’import de Premiere : convertis-le en MP4 (H.264 + AAC) depuis l’Accueil.";
  return "Premiere a accepté l’import, mais le fichier n’apparaît pas dans le projet (codec probablement non pris en charge).";
}

export function resumeSelection(n: number): string {
  return pluriel(n, "sélectionné", "sélectionnés");
}

export { etatAffiche };
