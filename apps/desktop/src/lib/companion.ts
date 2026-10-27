// Companion : règles PURES de l'état de la chouette (D-SPEC §B.6). Aucun minuteur ici : l'hôte (ui/Companion.tsx)
// rappelle `etatCompanion` à l'échéance `jusqua`. Chaque état vient d'un fait réel : deux instantanés du cœur
// (`detecter`), des événements locaux réels (dépôt, import, envoi au panneau) et des causes en cours.
// Priorité : Error soft, puis Success, puis Processing, puis Hint, puis Curious, puis Idle.
import type { Instantane, Section } from "./types";
import { pluriel } from "./format";

export type EtatChouette = "idle" | "curious" | "processing" | "success" | "error" | "hint";
/** Réglage « Présence de la chouette » (décision du directeur : Discrète par défaut, Expressive, Muette). */
export type Presence = "discrete" | "expressive" | "muette";
export const PRESENCES: Presence[] = ["discrete", "expressive", "muette"];
export const PRESENCE_DEFAUT: Presence = "discrete";

export type Cible = { section: Section } | { media: string };

export type FamilleSucces = "pret" | "importe" | "ajout";
export interface EvtLocal {
  type: "succes" | "erreur" | "visite-transferts";
  le: number;
  texte: string;
  cible?: Cible;
  famille?: FamilleSucces;
  /** Clé de dédoublonnage (un même fait vu par deux chemins ne compte qu'une fois). */
  cle?: string;
}

/** Ce qui est en cours à l'instant (faits réels, fournis par l'hôte). */
export interface Causes {
  /** Envois vers Premiere sans résultat (flux), demandes d'import encore en attente du panneau. */
  envois: number;
  /** Fichiers externes en cours de copie dans la bibliothèque. */
  copies: number;
  /** Envois vers AETHRYON Cloud en cours (file du cœur Rust). */
  nuage?: number;
  /** Imports musicaux autorisés en cours (section MUSIQUE). */
  musique?: number;
  /** Un glisser survole la fenêtre (entrée sans sortie). */
  survol: boolean;
  /** Astuce proposée (déjà filtrée par session et par « Ne plus afficher »). */
  astuce?: { cle: string; texte: string } | null;
  /** Activités en cours signalées par un module (AETHRYON Index : cle « scan ») : faits réels, texte du module. */
  externes?: { cle: string; texte: string; cible: Cible }[];
}

export interface SortieCompanion {
  etat: EtatChouette;
  texte: string;
  cible: Cible;
  /** Instant où l'état changera de lui-même (rappel de l'hôte), ou null. */
  jusqua: number | null;
  /** Identifiant du déclencheur (rejouer l'animation seulement s'il change). */
  cle: string;
  /** Faut-il animer le dessin ? (non en présence « Muette » ou en mouvement réduit) */
  animee: boolean;
}

export const DUREE_SUCCES = 1600;
export const DUREE_ERREUR = 8000;
export const FENETRE_GROUPE = 2000;

const ACTIFS = new Set(["attente", "conversion", "telechargement"]);

/** Transferts actifs et médias en cours sans transfert (navigateur), comme le compteur de la navigation. */
export function enCours(i: Instantane): number {
  const t = i.transferts.filter((x) => ACTIFS.has(x.etat)).length;
  const m = i.index.medias.filter((x) => x.etat === "en-cours" && !i.transferts.some((y) => ACTIFS.has(y.etat) && y.fichierAttendu?.toLowerCase() === `${x.nom}.${x.ext}`.toLowerCase())).length;
  return t + m;
}

function projetDe(i: Instantane, message: string): string | null {
  const p = i.liaison.panneau?.projet;
  if (p) return p;
  const m = message.match(/\(([^()]+)\)\s*$/);
  return m ? m[1] : null;
}

/** Faits nouveaux entre deux instantanés. Premier instantané (avant = null) : aucun fait. */
export function detecter(avant: Instantane | null, apres: Instantane, maintenant: number): EvtLocal[] {
  if (!avant) return [];
  const evts: EvtLocal[] = [];
  const etaitDispo = new Map(avant.index.medias.map((m) => [m.id, m.etat === "disponible"]));
  for (const m of apres.index.medias) {
    if (m.etat === "disponible" && etaitDispo.get(m.id) !== true) {
      evts.push({ type: "succes", famille: "pret", le: maintenant, texte: `Prêt : ${m.nom}`, cible: { media: m.id }, cle: `pret:${m.id}` });
    }
  }
  const etaitErreur = new Map(avant.transferts.map((t) => [t.id, t.etat === "erreur"]));
  for (const t of apres.transferts) {
    if (t.etat === "erreur" && etaitErreur.get(t.id) !== true) {
      evts.push({ type: "erreur", le: maintenant, texte: `Transfert interrompu : ${t.titre ?? t.fichierAttendu ?? "transfert"}`, cible: { section: "transferts" }, cle: `transfert:${t.id}` });
    }
  }
  const vus = new Set(avant.resultats.map((r) => r.nom));
  for (const r of apres.resultats) {
    if (vus.has(r.nom) || r.action !== "importer") continue;
    if (r.ok) {
      const p = projetDe(apres, r.message);
      evts.push({ type: "succes", famille: "importe", le: maintenant, texte: p ? `Importé dans ${p}` : "Importé dans Premiere Pro", cible: r.ids.length === 1 ? { media: r.ids[0] } : { section: "bibliotheque" }, cle: `envoi:${r.nom}` });
    } else {
      evts.push({ type: "erreur", le: maintenant, texte: "Import non effectué", cible: { section: "integrations" }, cle: `envoi:${r.nom}` });
    }
  }
  return evts;
}

/** Ajoute des événements à l'historique (dédoublonnés par clé, 40 au plus). */
export function memoriser(historique: readonly EvtLocal[], nouveaux: readonly EvtLocal[]): EvtLocal[] {
  const cles = new Set(historique.map((e) => e.cle).filter(Boolean));
  const ajout = nouveaux.filter((e) => !e.cle || !cles.has(e.cle));
  if (ajout.length === 0) return historique as EvtLocal[];
  return [...historique, ...ajout].slice(-40);
}

/** Groupe de réussites en cours : celles qui se suivent à moins de 2 s ne font qu'UN Success. */
function groupeSucces(evts: readonly EvtLocal[]): EvtLocal[] {
  const s = evts.filter((e) => e.type === "succes");
  if (s.length === 0) return [];
  const groupe = [s[s.length - 1]];
  for (let i = s.length - 2; i >= 0; i--) {
    if (groupe[0].le - s[i].le <= FENETRE_GROUPE) groupe.unshift(s[i]);
    else break;
  }
  return groupe;
}

export function etatCompanion(apres: Instantane, evts: readonly EvtLocal[], causes: Causes, maintenant: number, presence: Presence, reduit = false): SortieCompanion {
  const animee = presence !== "muette" && !reduit;
  const sortie = (etat: EtatChouette, texte: string, cible: Cible, jusqua: number | null, cle: string): SortieCompanion => ({ etat, texte, cible, jusqua, cle, animee });

  // Error soft : jusqu'à une visite de Transferts (section affichée), ou 8 s.
  const visite = Math.max(-Infinity, ...evts.filter((e) => e.type === "visite-transferts").map((e) => e.le));
  const erreur = [...evts].reverse().find((e) => e.type === "erreur");
  if (erreur && erreur.le > visite && maintenant - erreur.le < DUREE_ERREUR) {
    return sortie("error", erreur.texte, erreur.cible ?? { section: "transferts" }, erreur.le + DUREE_ERREUR, `erreur:${erreur.le}`);
  }

  // Success : 1,6 s après le dernier fait du groupe ; un groupe = une seule animation (clé du premier).
  const g = groupeSucces(evts);
  if (g.length && maintenant - g[g.length - 1].le < DUREE_SUCCES) {
    const dernier = g[g.length - 1];
    const prets = g.filter((e) => e.famille === "pret");
    const fort = [...g].reverse().find((e) => e.famille === "ajout") ?? [...g].reverse().find((e) => e.famille === "importe");
    const texte = fort ? fort.texte : g.length > 1 && prets.length === g.length ? pluriel(g.length, "média prêt", "médias prêts") : dernier.texte;
    const cible = g.length > 1 ? { section: "bibliotheque" as Section } : dernier.cible ?? { section: "bibliotheque" as Section };
    return sortie("success", texte, cible, dernier.le + DUREE_SUCCES, `succes:${g[0].le}`);
  }

  // Processing : tant que dure la cause.
  if (causes.envois > 0) return sortie("processing", "Import demandé au panneau…", { section: "integrations" }, null, "processing:envoi");
  if (causes.copies > 0) return sortie("processing", `Copie de ${pluriel(causes.copies, "fichier", "fichiers")}…`, { section: "bibliotheque" }, null, "processing:copie");
  const ext = causes.externes?.[0];
  if (ext) return sortie("processing", ext.texte, ext.cible, null, `processing:${ext.cle}`);
  if (causes.musique) return sortie("processing", causes.musique > 1 ? `${causes.musique} imports musicaux…` : "Import musical…", { section: "musique" }, null, "processing:musique");
  if (causes.nuage) return sortie("processing", causes.nuage > 1 ? `${causes.nuage} envois vers le Cloud…` : "Envoi vers le Cloud…", { section: "cloud" }, null, "processing:cloud");
  const n = enCours(apres);
  if (n > 0) {
    const attente = apres.transferts.filter((t) => t.etat === "attente").length;
    const actifs = n - attente;
    const texte = actifs > 0 ? pluriel(actifs, "transfert en cours", "transferts en cours") : pluriel(attente, "transfert en attente", "transferts en attente");
    return sortie("processing", texte, { section: "transferts" }, null, "processing:transferts");
  }

  // Hint : niveau « Expressive » seulement.
  if (presence === "expressive" && causes.astuce) return sortie("hint", causes.astuce.texte, { section: "bibliotheque" }, null, `astuce:${causes.astuce.cle}`);

  if (causes.survol) return sortie("curious", "Dépose pour ajouter", { section: "bibliotheque" }, null, "curious");
  return sortie("idle", "Tout est calme", { section: "transferts" }, null, "idle");
}

/** Lecture et écriture du réglage (localStorage `aethryon.chouette`, sous try/catch comme `aethryon.vue`). */
export function lirePresence(): Presence {
  try {
    const v = localStorage.getItem("aethryon.chouette");
    return v === "expressive" || v === "muette" || v === "discrete" ? v : PRESENCE_DEFAUT;
  } catch {
    return PRESENCE_DEFAUT;
  }
}

export function ecrirePresence(p: Presence): void {
  try { localStorage.setItem("aethryon.chouette", p); } catch { /* stockage indisponible : réglage de session */ }
}

/** Intervalle de clignement au repos : Expressive 4 à 7 s, Discrète 8 à 14 s, Muette jamais. `alea` dans [0, 1). */
export function intervalleClignement(p: Presence, alea: number): number | null {
  if (p === "muette") return null;
  return p === "expressive" ? 4000 + alea * 3000 : 8000 + alea * 6000;
}

/** Astuce « un par un » : trois imports d'un seul média en moins de 60 s. */
export function astuceUnParUn(importsSimples: readonly number[], maintenant: number): boolean {
  return importsSimples.filter((t) => maintenant - t < 60_000).length >= 3;
}

// ---- Nocturne : apparence de la chouette en profondeur (ui/chouette.tsx) -----------------------------------------------

export type ApparenceChouette = "repos" | "attention" | "chargement" | "scan" | "telechargement" | "reussite" | "erreur";

/** Apparence d'après l'état réel : téléchargement (transferts), analyse (AETHRYON Index), chargement (le reste). */
export function apparenceDe(s: Pick<SortieCompanion, "etat" | "cle">): ApparenceChouette {
  switch (s.etat) {
    case "success": return "reussite";
    case "error": return "erreur";
    case "curious": case "hint": return "attention";
    case "processing":
      if (s.cle === "processing:transferts") return "telechargement";
      if (s.cle.startsWith("processing:scan")) return "scan";
      return "chargement";
    default: return "repos";
  }
}

/** Progression RÉELLE des transferts actifs (moyenne des progressions transmises), sinon null (comète). */
export function progressionTransferts(i: Pick<Instantane, "transferts">): number | null {
  const l = i.transferts.filter((t) => (t.etat === "telechargement" || t.etat === "conversion") && t.progression != null);
  if (l.length === 0) return null;
  return l.reduce((n, t) => n + (t.progression ?? 0), 0) / l.length;
}
