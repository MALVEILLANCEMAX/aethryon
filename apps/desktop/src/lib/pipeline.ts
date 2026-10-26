// Transferts en pipeline (D-SPEC §B.7) : règles PURES. Cinq nœuds — Demande, Conversion, Téléchargement,
// Bibliothèque, Premiere — déduits seulement des faits réels : `transferts/<id>.json` (attente, conversion,
// téléchargement, prêt, erreur), le média de l'index, `imports.json` (écrit par le panneau) et les demandes d'import
// faites dans la session avec leur résultat réel. Rien n'est supposé : un nœud sans fait reste « à venir ».
import type { EtatTransfert, ImportFait, Media, ResultatEnvoi, Transfert } from "./types";

export type CleNoeud = "demande" | "conversion" | "telechargement" | "bibliotheque" | "premiere";
export type EtatNoeud = "fait" | "en-cours" | "attente" | "a-venir" | "erreur" | "ambre" | "sans-objet";

export interface Noeud {
  cle: CleNoeud;
  libelle: string;
  etat: EtatNoeud;
  /** Texte réel sous le nœud (« 64 % », « En attente d'une place »…). */
  detail: string | null;
  /** Progression réelle (0 à 1) du connecteur qui MÈNE à ce nœud ; null = inconnue (comète, ou rayures). */
  progression: number | null;
}

/** Demande d'import faite dans cette session (commande déposée pour le panneau). */
export interface DemandeImport { nom: string; le: number }

export interface Pipeline {
  noeuds: Noeud[];
  /** Étape courante (1 à 5) pour le lecteur d'écran. */
  etape: number;
  /** « Étape 3 sur 5 : Téléchargement, 64 % ». */
  aria: string;
  /** Erreur sans étape connue : bandeau sur toute la carte. */
  bandeau: string | null;
  /** « Importer dans Premiere » est proposé (média prêt, pas d'import connu ni demandé). */
  importable: boolean;
}

export const LIBELLES: Record<CleNoeud, string> = {
  demande: "Demande",
  conversion: "Conversion",
  telechargement: "Téléchargement",
  bibliotheque: "Bibliothèque",
  premiere: "Premiere",
};
const ORDRE: CleNoeud[] = ["demande", "conversion", "telechargement", "bibliotheque", "premiere"];

const pct = (p: number | null | undefined) => (p == null ? null : `${Math.round(Math.max(0, Math.min(1, p)) * 100)} %`);

function construire(etats: Partial<Record<CleNoeud, [EtatNoeud, string | null, number | null]>>): Noeud[] {
  return ORDRE.map((cle) => {
    const [etat, detail, progression] = etats[cle] ?? ["a-venir", null, null];
    return { cle, libelle: LIBELLES[cle], etat, detail, progression };
  });
}

function aria(noeuds: Noeud[]): { etape: number; aria: string } {
  const i = noeuds.findIndex((n) => n.etat === "en-cours" || n.etat === "attente" || n.etat === "erreur" || n.etat === "ambre");
  const k = i >= 0 ? i : (() => { let d = -1; noeuds.forEach((n, j) => { if (n.etat === "fait") d = j; }); return Math.max(0, d); })();
  const n = noeuds[k];
  const etat = n.etat === "fait" ? "fait" : n.etat === "erreur" ? "erreur" : n.etat === "attente" ? "en attente" : n.etat === "ambre" ? "à vérifier" : "en cours";
  return { etape: k + 1, aria: `Étape ${k + 1} sur 5 : ${n.libelle}, ${n.detail ?? etat}` };
}

/**
 * Nœuds d'un transfert (ou d'un média « en cours » sans transfert : téléchargement du navigateur).
 * `dernierEtatVu` : dernier état actif observé PENDANT la session (pour placer une erreur sur le bon nœud).
 */
export function noeuds(
  t: Transfert | null,
  m: Media | null,
  imports: Record<string, ImportFait[]>,
  demandes: Record<string, DemandeImport>,
  resultats: readonly ResultatEnvoi[],
  dernierEtatVu: EtatTransfert | null,
): Pipeline {
  let e: Partial<Record<CleNoeud, [EtatNoeud, string | null, number | null]>> = {};
  let bandeau: string | null = null;
  let importable = false;
  if (!t) {
    // Téléchargement du navigateur repéré dans le dossier surveillé : seule la taille reçue est connue.
    // (La carte de Transferts écrit la taille reçue ; le nœud dit seulement ce qui manque.)
    e = {
      demande: ["sans-objet", null, null],
      conversion: ["sans-objet", null, null],
      telechargement: ["en-cours", "taille finale inconnue", null],
      premiere: ["sans-objet", null, null],
    };
  } else if (t.etat === "attente") {
    e = { demande: ["fait", null, null], conversion: ["attente", "En attente d'une place", null] };
  } else if (t.etat === "conversion") {
    e = { demande: ["fait", null, null], conversion: ["en-cours", pct(t.progression) ?? "en cours", t.progression] };
  } else if (t.etat === "telechargement") {
    // Octets reçus et débit : écrits par la carte de Transferts ; le nœud dit la pause et le pourcentage.
    e = {
      demande: ["fait", null, null],
      conversion: ["fait", null, null],
      telechargement: ["en-cours", [t.pause ? "En pause" : null, pct(t.progression)].filter(Boolean).join(" · ") || "en cours", t.progression],
    };
  } else if (t.etat === "pret") {
    if (!m) {
      e = { demande: ["fait", null, null], conversion: ["fait", null, null], telechargement: ["fait", null, null], bibliotheque: ["ambre", "Fichier attendu non retrouvé", null], premiere: ["sans-objet", null, null] };
    } else {
      const faits = imports[m.id] ?? [];
      const dernier = faits.length ? faits[faits.length - 1] : null;
      const d = demandes[m.id];
      const r = d ? resultats.find((x) => x.nom === d.nom) : undefined;
      let premiere: [EtatNoeud, string | null, number | null];
      // 3.8.1 : import demandé par le Desktop après sa propre conversion (relais de l'extension) : son résultat réel.
      if (t.premiere === "importe") premiere = ["fait", dernier?.projet ? `Importé · ${dernier.projet}` : "Importé", null];
      else if (t.premiere === "demande") premiere = ["en-cours", "Demandé…", null];
      else if (t.premiere) premiere = ["erreur", t.premiere === "sans-projet" ? "Aucun projet ouvert" : t.premiere === "non-connecte" ? "Premiere non connecté" : "Non importé", null];
      else if (r && !r.ok) premiere = ["erreur", "Non importé", null];
      else if (dernier) premiere = ["fait", dernier.projet ? `Importé · ${dernier.projet}` : "Importé", null];
      else if (r && r.ok) premiere = ["fait", "Importé", null];
      else if (d) premiere = ["en-cours", "Demandé…", null];
      else {
        premiere = ["a-venir", null, null];
        importable = m.etat === "disponible";
      }
      e = { demande: ["fait", null, null], conversion: ["fait", null, null], telechargement: ["fait", null, null], bibliotheque: ["fait", null, null], premiere };
    }
  } else {
    // Erreur : sur le nœud du dernier état actif vu dans la session ; sinon bandeau sur toute la carte.
    const message = t.erreur ?? "Transfert interrompu";
    if (dernierEtatVu === "attente" || dernierEtatVu === "conversion") {
      e = { demande: ["fait", null, null], conversion: ["erreur", message, null] };
    } else if (dernierEtatVu === "telechargement") {
      e = { demande: ["fait", null, null], conversion: ["fait", null, null], telechargement: ["erreur", message, t.progression] };
    } else {
      e = { demande: ["fait", null, null] };
      bandeau = message;
    }
  }
  const n = construire(e);
  const a = aria(n);
  return { noeuds: n, etape: a.etape, aria: bandeau ? `Erreur : ${bandeau}` : a.aria, bandeau, importable };
}
