// Politique des mots de passe, côté site : COPIE EXACTE de account/src/password-policy.ts (mêmes bornes, même liste,
// mêmes règles bloquantes ; vérifié par account/test/code-abonnement.test.ts). Le serveur reste juge : ce module sert à
// dire AVANT l'envoi ce qui sera refusé, avec les mêmes mots.
// En plus, et seulement à titre indicatif : une estimation de la solidité (jauge), qui ne bloque jamais.

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** Bases trop courantes (minuscules, sans accents ni chiffres) : refusées seules ou décorées de chiffres et symboles. */
export const COMMON_BASES: readonly string[] = [
  "password", "passw0rd", "motdepasse", "motdepass", "mdp", "azerty", "azertyuiop", "qwerty", "qwertyuiop", "qwertz",
  "azertyui", "qsdfghjklm", "wxcvbn", "asdfghjkl", "zxcvbnm", "iloveyou", "jetaime", "jetaimetoi", "soleil", "bonjour",
  "bonsoir", "salut", "coucou", "doudou", "loulou", "chouchou", "chocolat", "princesse", "princess", "football", "marseille",
  "paris", "parissaintgermain", "psg", "olympique", "dragon", "monkey", "sunshine", "superman", "batman", "starwars",
  "pokemon", "naruto", "minecraft", "fortnite", "admin", "administrator", "root", "welcome", "bienvenue", "letmein",
  "trustno", "master", "shadow", "michael", "jordan", "daniel", "nicolas", "thomas", "camille", "julien", "julie", "marie",
  "pierre", "chloe", "lucas", "hugo", "emma", "nathan", "sophie", "aurelie", "secret", "changeme", "default", "test",
  "testtest", "user", "utilisateur", "login", "connexion", "abcd", "aethryon", "youtube", "tiktok", "discord", "google",
  "gmail", "hotmail", "orange", "free", "apple", "iphone", "samsung", "facebook", "instagram", "twitter", "netflix",
  "spotify", "amazon", "microsoft", "windows", "computer", "ordinateur", "internet", "hello", "hellohello", "liberte",
  "france", "allezlesbleus", "vivelafrance", "amour", "bisous", "maman", "papa", "famille", "bebe", "cheval", "chien",
  "chat", "tigre", "lion", "loveyou", "lovely", "baseball", "basketball", "hockey", "soccer", "killer", "matrix",
  "freedom", "whatever", "qazwsx", "zaq", "asdf", "abc", "aaa", "azer", "qwer",
];

const SEQUENCES = ["abcdefghijklmnopqrstuvwxyz", "zyxwvutsrqponmlkjihgfedcba", "01234567890", "09876543210",
  "azertyuiopqsdfghjklmwxcvbn", "qwertyuiopasdfghjklzxcvbnm", "qwertzuiopasdfghjklyxcvbnm"];

/** Minuscules sans accents ni signes : « Été 2024 ! » → « ete2024 ». */
export function foldPassword(pw: string): string {
  return pw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Le mot de passe, une fois réduit à sa base (lettres seules, ou chiffres seuls s'il n'a que des chiffres), est-il trop
 *  courant : dans la liste, une suite du clavier ou de l'alphabet, ou une seule touche répétée ? */
export function isCommonPassword(pw: string): boolean {
  const folded = foldPassword(pw);
  if (!folded) return true;
  const letters = folded.replace(/[0-9]/g, "");
  const base = letters.length >= 3 ? letters : folded; // « 1234567890 » reste une suite de chiffres
  if (COMMON_BASES.includes(base)) return true;
  if (/^(.)\1*$/.test(base) || /^(.)\1*$/.test(folded)) return true;
  if (base.length >= 4 && SEQUENCES.some((s) => s.includes(base))) return true;
  // Une base courte répétée (« azazazazaz », « abcabcabc ») vaut sa répétition.
  const unit = /^(.{1,4}?)\1+$/.exec(base)?.[1];
  if (unit && (COMMON_BASES.includes(unit) || unit.length <= 2)) return true;
  return false;
}

export interface PasswordContext { email?: string | null; name?: string | null }

/** Le problème BLOQUANT d'un mot de passe, ou null s'il est accepté. Codes stables (le site les affiche). */
export function passwordProblem(pw: string, ctx: PasswordContext = {}): { code: string; message: string } | null {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN) {
    return { code: "password_too_short", message: `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères.` };
  }
  if (pw.length > PASSWORD_MAX) return { code: "password_too_long", message: `Le mot de passe doit faire ${PASSWORD_MAX} caractères au plus.` };
  if (isCommonPassword(pw)) {
    return { code: "password_common", message: "Ce mot de passe est trop courant : choisis-en un autre, une phrase de quelques mots par exemple." };
  }
  const folded = foldPassword(pw);
  const email = (ctx.email ?? "").toLowerCase();
  const local = email.split("@")[0] ?? "";
  const personal = [foldPassword(email), foldPassword(local), foldPassword(ctx.name ?? "")].filter((s) => s.length >= 3);
  if (personal.some((p) => folded === p || folded.replace(/[0-9]+$/, "") === p)) {
    return { code: "password_personal", message: "Le mot de passe ne doit pas reprendre ton adresse e-mail ou ton nom." };
  }
  return null;
}

// ---- jauge (indicative, jamais bloquante) --------------------------------------------------------

export type StrengthLevel = 0 | 1 | 2 | 3 | 4;
export interface Strength { level: StrengthLevel; label: string }
/** Tous les mots possibles de la jauge (superposés dans une case de largeur fixe, ui/PasswordStrength.tsx). */
export const STRENGTH_LABELS = ["Trop court", "Trop courant", "Trop personnel", "Trop long", "Faible", "Moyen", "Bon", "Excellent"] as const;

/** Entropie approchée (bits) : longueur EFFECTIVE (une touche répétée ou une suite comptent peu) × log2(alphabet).
 *  Volontairement simple : elle oriente, le serveur ne s'en sert pas. */
export function estimateBits(pw: string): number {
  const chars = Array.from(pw);
  let pool = 0;
  if (/\p{Ll}/u.test(pw)) pool += 26;
  if (/\p{Lu}/u.test(pw)) pool += 26;
  if (/\p{N}/u.test(pw)) pool += 10;
  if (/[^\p{L}\p{N}\s]/u.test(pw)) pool += 33;
  if (/\s/.test(pw)) pool += 1;
  if (/[^\x00-\x7f]/.test(pw)) pool += 20;
  pool = Math.max(pool, 10);
  let effective = 0;
  for (let i = 0; i < chars.length; i++) {
    const prev = i > 0 ? chars[i - 1]!.codePointAt(0)! : -10;
    const cur = chars[i]!.codePointAt(0)!;
    effective += cur === prev ? 0.3 : Math.abs(cur - prev) === 1 ? 0.5 : 1;
  }
  return effective * Math.log2(pool);
}

/** Niveau de la jauge : 0 (vide), 1 (trop court, courant, personnel, ou faible) à 4 (excellent). */
export function estimateStrength(pw: string, ctx: PasswordContext = {}): Strength {
  if (!pw) return { level: 0, label: "" };
  const problem = passwordProblem(pw, ctx);
  if (problem?.code === "password_too_short") return { level: 1, label: "Trop court" };
  if (problem?.code === "password_common") return { level: 1, label: "Trop courant" };
  if (problem?.code === "password_personal") return { level: 1, label: "Trop personnel" };
  if (problem) return { level: 1, label: "Trop long" };
  const bits = estimateBits(pw);
  if (bits < 40) return { level: 1, label: "Faible" };
  if (bits < 55) return { level: 2, label: "Moyen" };
  if (bits < 75) return { level: 3, label: "Bon" };
  return { level: 4, label: "Excellent" };
}

export interface PasswordRuleState { id: "length" | "common" | "personal"; label: string; met: boolean; remaining: number }

/** Les règles BLOQUANTES, telles qu'affichées sous le champ (cochées au fil de la saisie). `personal` seulement quand
 *  l'adresse ou le nom sont connus (inscription). */
export function passwordRules(pw: string, ctx: PasswordContext = {}): PasswordRuleState[] {
  const problem = pw ? passwordProblem(pw, ctx) : null;
  const rules: PasswordRuleState[] = [
    { id: "length", label: `${PASSWORD_MIN} caractères au moins`, met: pw.length >= PASSWORD_MIN && pw.length <= PASSWORD_MAX, remaining: Math.max(0, PASSWORD_MIN - pw.length) },
    { id: "common", label: "Pas un mot de passe courant", met: !!pw && problem?.code !== "password_common" && !isCommonPassword(pw), remaining: 0 },
  ];
  if (ctx.email || ctx.name) rules.push({ id: "personal", label: "Différent de ton adresse et de ton nom", met: !!pw && problem?.code !== "password_personal", remaining: 0 });
  return rules;
}
