// Chemins de retour (« suite » après la connexion) : uniquement un chemin relatif de CE site.
// Mêmes règles que Better Auth (isSafeRelativeURL) : commence par « / » mais pas « // », aucune barre
// oblique inverse ni caractère de contrôle, aucun séparateur encodé (%2F, %5C) dans le chemin, et la
// résolution par le navigateur reste sur notre origine. Tout le reste est refusé (redirection ouverte).
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

// Fusion d'audit : `window` n'est lu qu'après les refus immédiats — /connexion est pré-rendue à la
// construction (sans `window`, « suite » absente → null), sinon le pré-rendu échoue.
export function safeReturnPath(raw: string | null | undefined, origin?: string): string | null {
  if (!raw || raw.length > 2048) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || CONTROL.test(raw)) return null;
  const end = raw.search(/[?#]/);
  const path = end === -1 ? raw : raw.slice(0, end);
  if (/%2f|%5c/i.test(path)) return null;
  const base = origin ?? (typeof window === "undefined" ? null : window.location.origin);
  if (!base) return null;
  try {
    const u = new URL(raw, base);
    return u.origin === base ? `${u.pathname}${u.search}${u.hash}` : null;
  } catch {
    return null;
  }
}
