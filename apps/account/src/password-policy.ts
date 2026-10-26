// Politique des mots de passe (docs/CONTRAT.md §7) : UNE règle, appliquée par le serveur partout où un mot de passe est
// choisi (inscription : signup.ts ; changement et réinitialisation : crochet de Better Auth, auth.ts) et affichée à
// l'identique par le site (web/src/lib/password.ts, mêmes listes : vérifié par test/password-policy.test.ts).
//
// Bloquant, et seulement ceci :
//   - 10 à 128 caractères (comptés comme Better Auth : unités UTF-16) ;
//   - pas un mot de passe courant, même décoré (« Azerty2024! », « Motdepasse1 ») : la base, sans chiffres, symboles,
//     espaces ni majuscules, n'est ni dans la liste ni une suite (« abcdef… », « 123456… », une seule touche répétée) ;
//   - à l'inscription : différent de l'adresse e-mail, de sa partie avant « @ » et du nom.
// Jamais exigé : majuscule, chiffre ou symbole. Une longue phrase de passe (« lune de miel à Dinard ») est acceptée ;
// le gestionnaire de mots de passe et le collage aussi.

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
