// 2.0.1 : commandes d'AETHRYON Desktop pour le panneau (C-CONTRAT-ECHANGES.md §5, §9 v1.1, §11.5, §12).
// Liste FERMÉE : `importer` seulement ({ ids, chutier }) ; aucune autre action n'est exécutée, aucun chemin libre n'est lu.
// Un passage (environ toutes les secondes tant que le panneau est chargé, src/etat/app.ts) :
//   1. lit R\commandes\a-traiter\*.json : illisible → relu au passage suivant ; adressée au Desktop → ignorée ;
//   2. juge la commande : refusée (schéma, émetteur, action, identifiants, chutier), expirée (plus de 2 minutes) ou à
//      importer ; les identifiants sont relus dans R\bibliotheque\index.json (index illisible → passage suivant) ;
//   3. la PREND par renommage dans traitees\ avant tout effet : si le renommage échoue (déjà prise, ou expirée par le
//      Desktop), rien n'est écrit ;
//   4. importe par le chemin habituel du panneau (importFiles dans le chutier visé, puis vérification par chemin) ;
//   5. écrit le résultat RÉEL dans traitees\ : { ok, message, le }, plus `expire: true` pour une commande expirée.
//      Une commande prise est toujours close par son propre résultat : l'expiration ne remplace jamais un vrai résultat.

import type { BilanImport, FichiersHote, InfoProjet, ModeChutier, ResultatImportFichier } from "../hote/types";
import { cheminAbsolu, cheminNormalise, depuisIndexDesktop, estDans, nomDe, type Media } from "./bibliotheque";

export const ACTIONS_PANNEAU: readonly string[] = ["importer"];
export const CHUTIERS: readonly ModeChutier[] = ["aethryon", "selection", "racine"];
/** Commandes de plus de 2 minutes non traitées : expirées (contrat §5). */
export const EXPIRATION_MS = 120_000;
/** Limite du script hôte (aethryon.jsx, importer : 200 chemins par appel). */
export const MAX_IDS = 200;
/** Le Desktop traduit ce texte en « sans-projet » (desktop/noyau/src/service.rs : commence par « aucun projet »). */
export const MESSAGE_SANS_PROJET = "Aucun projet ouvert dans Premiere Pro.";
/** Le Desktop reconnaît « commande expirée » (service.rs, est_expiration) ; `expire: true` le dit sans texte (§11.5). */
export const MESSAGE_EXPIREE = "commande expirée (plus de 2 minutes sans traitement)";
/** <horodatage>-<uuid>.json (desktop/noyau/src/commandes.rs) ; les .tmp d'écriture atomique ne passent pas. */
const NOM_COMMANDE = /^[0-9A-Za-z][0-9A-Za-z_-]{0,100}\.json$/;
const ID = /^[0-9a-f]{40}$/;

export interface Commande {
  schema?: unknown;
  id?: unknown;
  de?: unknown;
  pour?: unknown;
  action?: unknown;
  args?: unknown;
  creeLe?: unknown;
  [cle: string]: unknown;
}

export type Jugement =
  | { verdict: "importer"; ids: string[]; chutier: ModeChutier }
  | { verdict: "refusee"; raison: string }
  | { verdict: "expiree" };

export interface Resultat {
  ok: boolean;
  message: string;
  expire?: true;
}

export function nomCommande(nom: string): boolean {
  return NOM_COMMANDE.test(nom);
}

function objetJson(texte: string | null): Record<string, unknown> | null {
  if (!texte) return null;
  try {
    const v = JSON.parse(texte.replace(/^﻿/, ""));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null; // en cours d'écriture : relu au passage suivant (contrat §1)
  }
}

/** Commande lue (objet JSON) ou null si le fichier est illisible ou incomplet (relu au passage suivant). */
export function lireCommande(texte: string | null): Commande | null {
  return objetJson(texte) as Commande | null;
}

const point = (s: string) => (/[.!?]$/.test(s) ? s : s + ".");
/** Premiere injoignable (ExtendScript muet, script hôte absent) : le texte de la coque, jamais une pile. */
const injoignable = (e: unknown) => point((e instanceof Error && e.message ? e.message : "Premiere Pro ne répond pas").slice(0, 200));
/** Texte d'un toast du panneau : majuscule initiale, apostrophes typographiques (espaces insécables : typo() de l'app). */
const pourPanneau = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/([A-Za-zÀ-ÿ])'([A-Za-zÀ-ÿ])/g, "$1’$2");

/** Jugement d'une commande adressée au panneau (pour = « panneau »). */
export function juger(c: Commande, maintenant: number): Jugement {
  if (c.schema !== 1) return { verdict: "refusee", raison: "schéma de commande inconnu" };
  if (c.de !== "desktop") return { verdict: "refusee", raison: "émetteur inconnu (seul AETHRYON Desktop envoie des commandes au panneau)" };
  if (typeof c.action !== "string" || !ACTIONS_PANNEAU.includes(c.action)) return { verdict: "refusee", raison: "action hors de la liste autorisée" };
  const a = c.args && typeof c.args === "object" && !Array.isArray(c.args) ? (c.args as { ids?: unknown; chutier?: unknown }) : null;
  if (!a || !Array.isArray(a.ids) || !a.ids.length || a.ids.some((i) => typeof i !== "string" || !ID.test(i))) {
    return { verdict: "refusee", raison: "identifiants de médias invalides" };
  }
  const ids = [...new Set(a.ids as string[])];
  if (ids.length > MAX_IDS) return { verdict: "refusee", raison: `${MAX_IDS} médias au plus par demande` };
  if (a.chutier !== undefined && !CHUTIERS.includes(a.chutier as ModeChutier)) return { verdict: "refusee", raison: "chutier inconnu" };
  const cree = typeof c.creeLe === "string" ? Date.parse(c.creeLe) : NaN;
  if (!Number.isFinite(cree)) return { verdict: "refusee", raison: "date de création illisible" };
  if (maintenant - cree > EXPIRATION_MS) return { verdict: "expiree" };
  return { verdict: "importer", ids, chutier: (a.chutier as ModeChutier | undefined) ?? "aethryon" };
}

export interface IndexDesktop {
  medias: Map<string, Media>;
  /** Dossiers surveillés par le Desktop (index.dossiers) : un média hors de ces dossiers n'est jamais importé. */
  dossiers: string[];
}

/** Index du Desktop (schema 1) ; null s'il est absent, illisible ou incomplet (relu au passage suivant). */
export function lireIndex(texte: string | null, joindre: (a: string, b: string) => string, posix = false): IndexDesktop | null {
  const o = objetJson(texte) as { schema?: unknown; medias?: unknown; dossiers?: unknown } | null;
  if (!o || o.schema !== 1 || !Array.isArray(o.medias)) return null;
  const medias = new Map<string, Media>();
  // Identifiants RECALCULÉS depuis les chemins (depuisIndexDesktop) : jamais ceux écrits dans le fichier.
  for (const m of depuisIndexDesktop(o, null, joindre, posix)) medias.set(m.id, m);
  const dossiers = Array.isArray(o.dossiers)
    ? o.dossiers.map((d) => (d && typeof d === "object" ? (d as { chemin?: unknown }).chemin : null)).filter((d): d is string => cheminAbsolu(d, posix))
    : [];
  return { medias, dossiers };
}

export interface Refus {
  id: string;
  raison: string;
}

/** Identifiants de l'index → chemins à importer (seulement des médias disponibles, dans un dossier surveillé). */
export function resoudre(ids: string[], index: IndexDesktop): { chemins: string[]; refus: Refus[] } {
  const chemins: string[] = [];
  const refus: Refus[] = [];
  for (const id of ids) {
    const m = index.medias.get(id);
    if (!m) refus.push({ id, raison: "média absent de la bibliothèque d'AETHRYON Desktop" });
    else if (!index.dossiers.some((d) => estDans(m.chemin, d))) refus.push({ id, raison: "fichier hors des dossiers surveillés par AETHRYON Desktop" });
    else if (m.etatSource === "en-cours") refus.push({ id, raison: "fichier encore en cours d'écriture" });
    else if (m.etatSource === "introuvable") refus.push({ id, raison: "fichier introuvable : il a été déplacé, renommé ou supprimé" });
    else if (m.etatSource !== "disponible") refus.push({ id, raison: m.erreur || "fichier en erreur dans AETHRYON Desktop" });
    else chemins.push(m.chemin);
  }
  return { chemins, refus };
}

function raisonImport(r: ResultatImportFichier | undefined): string {
  if (!r) return "Premiere n'a rien répondu pour ce fichier";
  if (r.code === "introuvable") return "fichier introuvable : il a été déplacé, renommé ou supprimé";
  if (r.code === "exception") return "Premiere a refusé l'import" + (r.detail ? ` (${r.detail.slice(0, 200)})` : "");
  if (r.code === "aucunProjet") return MESSAGE_SANS_PROJET;
  return "Premiere a accepté l'import, mais le fichier n'apparaît pas dans le projet (codec probablement non pris en charge)";
}

/** Résultat réel d'un import demandé : ok seulement si CHAQUE média demandé est dans le projet (importé ou déjà là). */
export function resultatImport(chemins: string[], bilan: BilanImport, refus: Refus[], demandes: number): Resultat & { importes: string[]; deja: number } {
  if (bilan.message === "aucunProjet") return { ok: false, message: MESSAGE_SANS_PROJET, importes: [], deja: 0 };
  const parChemin = new Map(bilan.resultats.map((r) => [cheminNormalise(r.chemin), r]));
  const importes: string[] = [];
  let deja = 0;
  const echecs: string[] = refus.map((r) => r.raison);
  for (const c of chemins) {
    const r = parChemin.get(cheminNormalise(c));
    if (r && r.ok && r.deja) deja++;
    else if (r && r.ok) importes.push(c);
    else echecs.push(raisonImport(r));
  }
  const ou = `« ${bilan.chutier ?? "AETHRYON"} »${bilan.projet ? ` (${bilan.projet})` : ""}`;
  if (!echecs.length) {
    const parties: string[] = [];
    if (importes.length) parties.push(importes.length > 1 ? `${importes.length} médias importés dans ${ou}` : `Importé dans ${ou}`);
    if (deja) parties.push(importes.length ? `${deja} déjà dans le projet` : `Déjà dans le projet${bilan.projet ? ` (${bilan.projet})` : ""} : aucun second import`);
    return { ok: true, message: point(parties.join(" ; ")), importes, deja };
  }
  const message = demandes > 1 ? `${echecs.length} média${echecs.length > 1 ? "s" : ""} sur ${demandes} non importé${echecs.length > 1 ? "s" : ""} : ${point(echecs[0]!)}` : point(echecs[0]!);
  return { ok: false, message, importes, deja };
}

export interface Signal {
  type: "ok" | "erreur" | "info" | "attention";
  titre: string;
  texte: string;
}

export interface DependancesRecepteur {
  fichiers: Pick<FichiersHote, "lister" | "lireTexte" | "ecrireTexte" | "renommer" | "joindre">;
  /** R\commandes\a-traiter, R\commandes\traitees, R\bibliotheque\index.json. */
  aTraiter: string;
  traitees: string;
  index: string;
  posix?: boolean;
  /** Projet ouvert (null : aucun) ; une exception = Premiere ne répond pas. */
  projet: () => Promise<InfoProjet | null>;
  /** Import habituel du panneau (importFiles dans le chutier visé, vérification, imports.json, état). */
  importer: (chemins: string[], mode: ModeChutier) => Promise<BilanImport>;
  /** Toast discret dans le panneau. */
  signaler?: (s: Signal) => void;
  journal?: (niveau: "info" | "attention" | "erreur", message: string) => void;
  maintenant?: () => number;
}

export function creerRecepteurCommandes(d: DependancesRecepteur) {
  const maintenant = d.maintenant ?? (() => Date.now());
  const journal = d.journal ?? (() => {});
  const signaler = d.signaler ?? (() => {});
  let enCours = false;

  async function executer(j: Extract<Jugement, { verdict: "importer" }>, chemins: string[], refus: Refus[]): Promise<Resultat> {
    if (!chemins.length) {
      const message = point(`${j.ids.length > 1 ? `aucun des ${j.ids.length} médias n'est importable : ` : ""}${refus[0]?.raison ?? "rien à importer"}`);
      signaler({ type: "erreur", titre: "Import demandé par AETHRYON Desktop", texte: pourPanneau(message) });
      return { ok: false, message };
    }
    let projet: InfoProjet | null;
    try {
      projet = await d.projet();
    } catch (e) {
      return { ok: false, message: injoignable(e) };
    }
    if (!projet) {
      signaler({ type: "attention", titre: "Aucun projet ouvert", texte: "AETHRYON Desktop a demandé un import : ouvre un projet dans Premiere Pro, puis relance l’envoi." });
      return { ok: false, message: MESSAGE_SANS_PROJET };
    }
    let bilan: BilanImport;
    try {
      bilan = await d.importer(chemins, j.chutier);
    } catch (e) {
      return { ok: false, message: injoignable(e) };
    }
    const r = resultatImport(chemins, bilan, refus, j.ids.length);
    if (r.ok && r.importes.length) {
      signaler({ type: "ok", titre: r.importes.length > 1 ? `${r.importes.length} médias importés depuis AETHRYON Desktop` : "Importé depuis AETHRYON Desktop", texte: `« ${bilan.chutier ?? "AETHRYON"} » · ${r.importes.length > 1 ? bilan.projet ?? "" : nomDe(r.importes[0]!)}` });
    } else if (r.ok) {
      signaler({ type: "info", titre: "Déjà dans le projet", texte: "Demande d’AETHRYON Desktop : aucun second import." });
    } else {
      signaler({ type: r.message === MESSAGE_SANS_PROJET ? "attention" : "erreur", titre: "Import demandé par AETHRYON Desktop", texte: pourPanneau(r.message) });
    }
    return { ok: r.ok, message: r.message };
  }

  async function ecrireResultat(cible: string, c: Commande, r: Resultat) {
    const resultat = { ok: r.ok, message: r.message, le: new Date(maintenant()).toISOString(), ...(r.expire ? { expire: true } : {}) };
    await d.fichiers.ecrireTexte(cible, JSON.stringify({ ...c, resultat }));
  }

  /** Un passage sur a-traiter\ ; renvoie le nombre de commandes closes par le panneau. */
  async function passe(): Promise<number> {
    if (enCours) return 0;
    enCours = true;
    try {
      const entrees = await d.fichiers.lister(d.aTraiter);
      if (!entrees) return 0; // dossier absent : AETHRYON Desktop n'est pas installé
      const noms = entrees.map((e) => e.nom).filter(nomCommande).sort();
      let index: IndexDesktop | null | undefined;
      let closes = 0;
      for (const nom of noms) {
        const source = d.fichiers.joindre(d.aTraiter, nom);
        const c = lireCommande(await d.fichiers.lireTexte(source));
        if (!c || c.pour !== "panneau") continue; // en cours d'écriture (passage suivant) ou adressée au Desktop
        const j = juger(c, maintenant());
        let chemins: string[] = [];
        let refus: Refus[] = [];
        if (j.verdict === "importer") {
          if (index === undefined) index = lireIndex(await d.fichiers.lireTexte(d.index), d.fichiers.joindre, d.posix);
          if (!index) continue; // index illisible : la commande attend le passage suivant, sans être prise
          ({ chemins, refus } = resoudre(j.ids, index));
        }
        // Prise par renommage AVANT tout effet (contrat §9) : jamais exécutée deux fois, jamais écrasée par une expiration.
        const cible = d.fichiers.joindre(d.traitees, nom);
        try {
          await d.fichiers.renommer(source, cible);
        } catch {
          continue; // déjà prise, ou expirée par le Desktop entre-temps
        }
        let r: Resultat;
        if (j.verdict === "refusee") {
          r = { ok: false, message: `Refusée : ${j.raison}.` };
          journal("attention", `commande ${nom} refusée : ${j.raison}`);
        } else if (j.verdict === "expiree") {
          r = { ok: false, message: MESSAGE_EXPIREE, expire: true };
          journal("info", `commande ${nom} expirée (plus de 2 minutes)`);
          signaler({ type: "info", titre: "Demande d’import expirée", texte: "AETHRYON Desktop l’a envoyée il y a plus de 2 minutes : relance-la si besoin." });
        } else {
          r = await executer(j, chemins, refus);
          journal(r.ok ? "info" : "attention", `commande ${nom} (importer, ${j.ids.length} média(s), chutier ${j.chutier}) : ${r.message}`);
        }
        try {
          await ecrireResultat(cible, c, r);
        } catch (e) {
          journal("erreur", `résultat de la commande ${nom} non écrit : ${e instanceof Error ? e.message : String(e)}`);
        }
        closes++;
      }
      return closes;
    } finally {
      enCours = false;
    }
  }

  return { passe };
}

export type RecepteurCommandes = ReturnType<typeof creerRecepteurCommandes>;
