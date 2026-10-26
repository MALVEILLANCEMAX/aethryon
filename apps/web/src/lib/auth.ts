// Connexion Google et par e-mail via Better Auth (appels directs, sans bibliothèque cliente), inscription par e-mail
// (account, src/signup.ts : adresse vérifiée AVANT la création du compte) et session.
// Inscription, connexion par mot de passe, mot de passe oublié : vérification de sécurité si le serveur l'exige.
import { verified } from "./verification.ts";
import { api, ApiError } from "./api.ts";
import { PASSWORD_MAX, PASSWORD_MIN } from "./password.ts";

/** Démarre la connexion Google : le serveur renvoie l'URL d'autorisation, le navigateur y va. */
export async function signInWithGoogle(callbackURL = "/dashboard"): Promise<void> {
  // Échec ou annulation chez Google : retour sur /connexion AVEC la page visée (« suite »). Sans elle, une nouvelle
  // tentative menait à l'espace au lieu de la page qui avait demandé la connexion (ex. l'autorisation de l'extension,
  // dont la fenêtre ne pouvait alors plus aboutir). Better Auth ajoute « error » à cette adresse (& ou ?).
  const errorCallbackURL = callbackURL === "/dashboard" ? "/connexion" : `/connexion?suite=${encodeURIComponent(callbackURL)}`;
  const r = await api<{ url?: string; redirect?: boolean }>("/api/auth/sign-in/social", {
    method: "POST",
    body: { provider: "google", callbackURL, errorCallbackURL, newUserCallbackURL: callbackURL },
  });
  if (!r.url) throw new ApiError(500, "no_redirect", "La connexion Google n'a pas pu démarrer.");
  window.location.assign(r.url);
}

/**
 * V3.5 : « Continuer avec Discord » — connexion d'un compte AETHRYON dont Discord est DÉJÀ lié (Espace › Discord).
 * Le serveur pose un jeton du navigateur (cookie) et renvoie l'adresse de Discord ; au retour, la session s'ouvre et
 * l'on arrive sur `retour` (chemin de ce site seulement). Refus : /connexion?discord=<motif> (DISCORD_LOGIN_ERRORS).
 */
export async function signInWithDiscord(retour = "/dashboard"): Promise<void> {
  const r = await api<{ url?: string }>("/api/discord/login", { method: "POST", body: { retour } });
  if (!r.url) throw new ApiError(500, "no_redirect", "La connexion Discord n'a pas pu démarrer.");
  window.location.assign(r.url);
}

export const DISCORD_LOGIN_ERRORS: Record<string, string> = {
  "non-liee": "Ce compte Discord n'est lié à aucun compte AETHRYON. Connecte-toi avec Google ou ton adresse e-mail, puis lie Discord depuis ton espace (une seule fois).",
  expiree: "La connexion Discord a expiré ou a été ouverte dans un autre navigateur. Recommence ici.",
  annulee: "Connexion Discord annulée.",
  echec: "Discord n'a pas répondu comme prévu. Réessaie dans un instant.",
  fermee: "La connexion avec Discord n'est pas ouverte sur ce serveur.",
  suspendu: "Ce compte est suspendu. Contacte l'administrateur.",
};

/** Longueur du mot de passe : la politique commune (lib/password.ts, identique à account). */
export { PASSWORD_MAX, PASSWORD_MIN };

/** Réponse d'une demande d'inscription : la même qu'un compte existe ou non. */
export interface SignupRequest { ok: true; expiresInMinutes: number; codeLength: number; codeExpiresInMinutes: number; resendAfterSeconds: number }

/** Inscription, étape 1 : un code à 6 chiffres et un lien de secours partent vers l'adresse. */
export async function requestSignup(email: string): Promise<SignupRequest> {
  return verified((v) => api<SignupRequest>("/api/inscription/demande", { method: "POST", body: { email }, ...v }));
}
/** Inscription, étape 1 bis : le code saisi ; juste, il donne le jeton de l'étape 3 (15 minutes). */
export async function verifySignupCode(email: string, code: string): Promise<{ token: string; email: string }> {
  return api<{ ok: true; token: string; email: string }>("/api/inscription/code", { method: "POST", body: { email, code } });
}
/** Inscription, étape 2 : l'adresse visée par un lien encore valable. */
export async function checkSignupToken(token: string): Promise<string> {
  return (await api<{ email: string }>("/api/inscription/verifier", { method: "POST", body: { token } })).email;
}
/** Inscription, étape 3 : nom et mot de passe ; le compte est créé et la session ouverte. */
export async function finishSignup(token: string, name: string, password: string): Promise<void> {
  await api("/api/inscription/terminer", { method: "POST", body: { token, name, password } });
}
export async function signInWithEmail(email: string, password: string): Promise<void> {
  await verified((v) => api("/api/auth/sign-in/email", { method: "POST", body: { email, password, rememberMe: true }, ...v }));
}
/** Mot de passe oublié : même réponse que l'adresse ait un compte ou non. */
export async function requestPasswordReset(email: string): Promise<void> {
  await verified((v) => api("/api/auth/request-password-reset", { method: "POST", body: { email }, ...v }));
}
/** Changement de mot de passe (session ouverte, mot de passe actuel exigé) ; les autres sessions sont fermées. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api("/api/auth/change-password", { method: "POST", body: { currentPassword, newPassword, revokeOtherSessions: true } });
}
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await api("/api/auth/reset-password", { method: "POST", body: { token, newPassword } });
}

/** Jeton placé après le « # » d'un lien reçu par e-mail : lu une fois, puis retiré de l'adresse (historique, captures).
 *  Idempotent : React peut rejouer un premier rendu (chargement différé de la page, mode strict), qui rappelle
 *  l'initialiseur d'état alors que l'adresse n'a déjà plus de « # » ; le jeton lu pour cette page est alors redonné. */
let taken: { path: string; token: string | null } | null = null;
export function takeHashToken(): string | null {
  const path = window.location.pathname;
  if (!window.location.hash) return taken?.path === path ? taken.token : null;
  const t = window.location.hash.replace(/^#/, "");
  window.history.replaceState(window.history.state, "", path + window.location.search);
  taken = { path, token: /^[A-Za-z0-9_-]{16,128}$/.test(t) ? t : null };
  return taken.token;
}

/** Message français d'une erreur d'authentification (Better Auth répond en anglais, avec un code). */
export function authMessage(e: unknown, fallback: string): string {
  if (!(e instanceof ApiError)) return fallback;
  if (e.isNetwork) return "Connexion impossible. Vérifie ta connexion et réessaie.";
  // Vérification de sécurité (lib/verification.ts) : annulée, ou action suspendue par le serveur (message exact).
  if (e.code === "verification_cancelled" || e.code === "temporarily_blocked" || e.code === "verification_unavailable") return e.message;
  if (e.status === 429) return "Trop d'essais : attends une minute, puis réessaie.";
  const code = e.code.toLowerCase();
  return AUTH_ERRORS[code] ?? LOGIN_ERRORS[code] ?? (/[àâçéèêëîïôûùüÿœ]/i.test(e.message) ? e.message : fallback);
}
const AUTH_ERRORS: Record<string, string> = {
  invalid_email_or_password: "Adresse e-mail ou mot de passe incorrect.",
  invalid_password: "Mot de passe actuel incorrect.",
  invalid_code: "Code incorrect ou expiré. Vérifie le dernier e-mail reçu, ou demande un nouveau code.",
  password_common: "Ce mot de passe est trop courant : choisis-en un autre, une phrase de quelques mots par exemple.",
  password_personal: "Le mot de passe ne doit pas reprendre ton adresse e-mail ou ton nom.",
  credential_account_not_found: "Ce compte n'a pas encore de mot de passe.",
  invalid_email: "Adresse e-mail invalide.",
  invalid_token: "Ce lien n'est plus valable : il a expiré ou a déjà servi. Demande-en un nouveau.",
  password_too_short: `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères.`,
  password_too_long: `Le mot de passe doit faire ${PASSWORD_MAX} caractères au plus.`,
  email_signup_disabled: "L'inscription par e-mail n'est pas ouverte sur ce serveur.",
};

export async function signOut(): Promise<void> {
  await api("/api/auth/sign-out", { method: "POST", body: {} });
}

export async function deleteAccount(): Promise<void> {
  await api("/api/auth/delete-user", { method: "POST", body: {} });
}

/** Messages des erreurs de connexion renvoyées par le serveur (?error=code sur /connexion). */
export const LOGIN_ERRORS: Record<string, string> = {
  email_not_verified: "Ton adresse e-mail Google n'est pas vérifiée. Vérifie-la chez Google puis réessaie.",
  signups_closed: "Les inscriptions sont fermées pour le moment.",
  not_invited: "Ce service est sur invitation : ce compte Google n'est pas invité.",
  account_suspended: "Ce compte est suspendu. Contacte l'administrateur.",
  account_not_linked: "Ce compte Google ne correspond pas au compte existant.",
  google_disabled: "La connexion Google n'est pas encore configurée sur ce serveur.",
  access_denied: "Connexion annulée.",
  state_mismatch: "La connexion a expiré. Réessaie.",
  please_restart_the_process: "La connexion a expiré. Réessaie.",
};
