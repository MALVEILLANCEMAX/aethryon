// Page d'accord de la connexion « AETHRYON pour Premiere Pro » (/premiere/connecter, account/src/premiere.ts) :
// code utilisateur (8 lettres sans voyelle, affiché ABCD-EFGH), chemin de retour après la connexion, réponses
// du serveur. Aucune donnée n'est gardée dans le navigateur (ni stockage local, ni journal).

/** Lettres possibles du code (RFC 8628 §6.1 : 20 consonnes, ni voyelle, ni 0/O ni 1/I). */
const USER_CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ]{8}$/;

/** Saisie ou paramètre ?code= → 8 lettres (majuscules, sans espace ni tiret), sinon null. Même règle que le serveur. */
export function normalizeUserCode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length > 32) return null;
  const s = raw.toUpperCase().replace(/[\s\-‐-―.]/g, "");
  return USER_CODE_RE.test(s) ? s : null;
}

/** BCDFGHJK → BCDF-GHJK (forme affichée dans Premiere Pro). */
export const formatUserCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

/** Cette page, avec le code vérifié (retour après la connexion), ou sans code. */
export const connectPath = (code: string | null) => (code ? `/premiere/connecter?code=${formatUserCode(code)}` : "/premiere/connecter");

/** État d'une demande vu par la page (POST /api/premiere/demande). */
export type DemandeState = "en-attente" | "autorise" | "refuse" | "expire" | "utilise";
export interface Demande {
  codeUtilisateur: string;
  etat: DemandeState;
  /** Informations données par le panneau (indicatives) ; null si la demande a été prise par un autre compte. */
  appareil: { hote: string | null; versionPremiere: string | null; versionExtension: string | null } | null;
  creeLe: string;
  expireLe: string;
}

const STATES: ReadonlySet<string> = new Set(["en-attente", "autorise", "refuse", "expire", "utilise"]);

/** Réponse du serveur vérifiée (champ par champ) ; null si elle n'a pas la forme attendue. */
export function parseDemande(v: unknown): Demande | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Record<string, unknown>;
  if (typeof d.codeUtilisateur !== "string" || typeof d.etat !== "string" || !STATES.has(d.etat)) return null;
  if (typeof d.expireLe !== "string" || typeof d.creeLe !== "string") return null;
  const a = d.appareil;
  let appareil: Demande["appareil"] = null;
  if (a && typeof a === "object") {
    const x = a as Record<string, unknown>;
    const str = (k: string) => (typeof x[k] === "string" && (x[k] as string).length > 0 ? (x[k] as string) : null);
    appareil = { hote: str("hote"), versionPremiere: str("versionPremiere"), versionExtension: str("versionExtension") };
  }
  return { codeUtilisateur: d.codeUtilisateur, etat: d.etat as DemandeState, appareil, creeLe: d.creeLe, expireLe: d.expireLe };
}

/** État renvoyé avec un refus (409/410 de autoriser / refuser), sinon null. */
export function stateOfRefusal(data: Record<string, unknown> | null): DemandeState | null {
  const e = data?.etat;
  return typeof e === "string" && STATES.has(e) ? (e as DemandeState) : null;
}
