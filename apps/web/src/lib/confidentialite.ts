// Préférences de confidentialité (V3.5). Inventaire RÉEL de ce que le site garde (relevé dans le code le 2026-10-16,
// docs/CONFORMITE.md) et choix du visiteur, gardés sur cet appareil.
//
// Aujourd'hui, aucune catégorie facultative : le site ne charge aucune ressource d'un autre site (politique de
// sécurité : default-src 'self'), n'affiche aucune publicité et ne mesure pas l'audience. Les cookies et le stockage
// qu'il utilise sont nécessaires (connexion) ou servent des réglages demandés par la personne : ils sont exemptés de
// consentement (CNIL, lignes directrices du 17 septembre 2020). Le bandeau INFORME donc, sans faux choix.
// Dès qu'un service facultatif sera ajouté ici (FACULTATIFS), le même bandeau proposera « Tout accepter », « Tout
// refuser » (à égalité) et « Personnaliser », et ce service ne démarrera qu'après accord (aConsenti).

export interface Facultatif {
  id: string;
  titre: string;
  description: string;
}

/** Services facultatifs, soumis à consentement. Vide : rien de tel sur le site. */
export const FACULTATIFS: readonly Facultatif[] = [];

/** Ce que le site garde sur l'appareil, et pourquoi (affiché dans les préférences). */
export const NECESSAIRES: readonly { titre: string; ou: string; duree: string; pourquoi: string }[] = [
  { titre: "Session de connexion", ou: "Cookie", duree: "30 jours au plus", pourquoi: "Te garder connecté. Posé seulement quand tu te connectes." },
  { titre: "Sécurité d'une connexion Google", ou: "Cookie", duree: "10 minutes", pourquoi: "Vérifier que la réponse de Google répond bien à ta demande." },
  { titre: "Tes réglages", ou: "Stockage de l'appareil", duree: "Jusqu'à ce que tu les effaces", pourquoi: "Guide masqué, bandeau fermé, brouillons de Tools, sons, nouveautés déjà vues, ce choix." },
  { titre: "Onglet en cours", ou: "Stockage de l'onglet", duree: "Le temps de l'onglet", pourquoi: "Un lien en attente pendant une connexion, la reprise après une mise à jour du site." },
];

const KEY = "aethryon:confidentialite";
/** Signature de la liste des services facultatifs : si elle change, le choix est redemandé. */
const SIGNATURE = FACULTATIFS.map((f) => f.id).sort().join(",");

export interface Choix {
  v: 1;
  /** Date du choix (ISO). */
  at: string;
  /** Liste des services facultatifs au moment du choix. */
  signature: string;
  services: Record<string, boolean>;
}

let cache: Choix | null | undefined;
const listeners = new Set<() => void>();

function read(): Choix | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<Choix> | null;
    if (!raw || raw.v !== 1 || typeof raw.at !== "string" || typeof raw.signature !== "string" || typeof raw.services !== "object" || raw.services === null) return null;
    return { v: 1, at: raw.at, signature: raw.signature, services: Object.fromEntries(Object.entries(raw.services).filter(([, b]) => typeof b === "boolean")) as Record<string, boolean> };
  } catch {
    return null;
  }
}

/** Choix enregistré et toujours valable (même liste de services facultatifs), sinon null. */
export function lireChoix(): Choix | null {
  if (cache === undefined) cache = read();
  return cache && cache.signature === SIGNATURE ? cache : null;
}

/** Le stockage de l'appareil fonctionne-t-il ? Sinon, le bandeau ne s'impose pas à chaque page (choix impossible à garder). */
export function stockageDisponible(): boolean {
  try {
    const k = `${KEY}:essai`;
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

/** Enregistre le choix (tous les services facultatifs : accepté ou refusé) ; prévient les abonnés. */
export function enregistrerChoix(services: Record<string, boolean>): Choix {
  const c: Choix = { v: 1, at: new Date().toISOString(), signature: SIGNATURE, services: Object.fromEntries(FACULTATIFS.map((f) => [f.id, services[f.id] === true])) };
  cache = c;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* stockage refusé : le choix vaut pour cette page */
  }
  for (const f of listeners) f();
  return c;
}

/** Un service facultatif ne démarre qu'avec un accord enregistré pour lui. */
export function aConsenti(id: string): boolean {
  return lireChoix()?.services[id] === true;
}

export function abonner(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

// ---- ouverture des préférences depuis n'importe où (pied de page) ------------------------------------------------
// L'interface est chargée à part, une fois la page prête : une demande arrivée avant est gardée, et le chargement
// est demandé tout de suite (événement « aethryon:visite »).
const ouvrir = new Set<() => void>();
let enAttente = false;
export function ouvrirPreferences(): void {
  if (ouvrir.size === 0) {
    enAttente = true;
    window.dispatchEvent(new Event("aethryon:visite"));
    return;
  }
  for (const f of ouvrir) f();
}
export function surOuverturePreferences(f: () => void): () => void {
  ouvrir.add(f);
  if (enAttente) {
    enAttente = false;
    queueMicrotask(f);
  }
  return () => ouvrir.delete(f);
}
