// Dépôt GitHub officiel d'AETHRYON (code sous Apache-2.0, marque réservée). Tant que le dépôt est PRIVÉ
// (VITE_GITHUB_PUBLIC=0, défaut), le site ne montre AUCUN lien vers lui : un visiteur n'y trouverait qu'une 404.
// Les versions affichées viennent du dépôt lui-même, relevées à la construction (scripts/github-releases.mjs) :
// releases GitHub publiées, sinon son CHANGELOG.md. Le navigateur ne contacte jamais GitHub (CSP connect-src 'self').

// Valeurs posées par vite.config.ts (define) ; hors de Vite (essais sous Node), import.meta.env n'existe pas.
function built<T>(read: () => T, fallback: T): T {
  try { return read(); } catch { return fallback; }
}
export const GITHUB_PUBLIC = built(() => import.meta.env.VITE_GITHUB_PUBLIC === "1", false);
export const GITHUB_REPO = "MALVEILLANCEMAX/aethryon";
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
export const GITHUB_RELEASES_URL = `${GITHUB_URL}/releases`;
export const GITHUB_CHANGELOG_URL = `${GITHUB_URL}/blob/main/CHANGELOG.md`;
export const CODE_LICENSE = "Apache-2.0";

export type NoteBlock = { t: "h" | "li" | "p"; text: string };
export type DepotVersion = {
  version: string;
  title: string | null;
  /** AAAA-MM-JJ (date de publication de la release, ou celle écrite dans le CHANGELOG). */
  date: string | null;
  prerelease: boolean;
  /** Page de la release sur GitHub (seulement si elle vient de l'API publique). */
  url: string | null;
  blocks: NoteBlock[];
};
export type DepotNotes = {
  repo: string;
  public: boolean;
  /** Date de la construction du site (relevé des versions). */
  builtAt: string;
  /** releases : API publique de GitHub ; changelog : CHANGELOG.md du dépôt ; none : aucune source lisible. */
  source: "releases" | "changelog" | "none";
  /** Révision du CHANGELOG.md lu (copie gardée avec le site) ou « main ». */
  ref: string | null;
  entries: DepotVersion[];
};

const EMPTY: DepotNotes = { repo: GITHUB_REPO, public: GITHUB_PUBLIC, builtAt: "", source: "none", ref: null, entries: [] };

/** Notes relevées à la construction (vite.config.ts) ; vides si absentes ou illisibles — jamais inventées. */
export function depotNotes(raw = built(() => import.meta.env.VITE_DEPOT_NOTES as string | undefined, undefined)): DepotNotes {
  if (!raw) return EMPTY;
  try {
    const n = JSON.parse(raw) as DepotNotes;
    if (!Array.isArray(n.entries)) return EMPTY;
    return { ...EMPTY, ...n, entries: n.entries.filter((e) => typeof e.version === "string" && Array.isArray(e.blocks)) };
  } catch {
    return EMPTY;
  }
}

export type Inline = { t: "text" | "code" | "strong"; text: string };

/** Texte d'une note → morceaux affichables. Les liens Markdown deviennent leur seul texte : la page ne renvoie pas
 *  vers des adresses tierces citées dans les notes (le lien « Voir sur GitHub » de la version suffit). */
export function inline(text: string): Inline[] {
  const plain = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "");
  const out: Inline[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (let m = re.exec(plain); m; m = re.exec(plain)) {
    if (m.index > last) out.push({ t: "text", text: plain.slice(last, m.index) });
    out.push(m[1] !== undefined ? { t: "code", text: m[1] } : { t: "strong", text: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < plain.length) out.push({ t: "text", text: plain.slice(last) });
  return out.filter((p) => p.text.length > 0);
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « 2026-10-26 » → « 26 octobre 2026 » (sans fuseau : la date est déjà celle du calendrier). */
export function dateLongue(iso: string | null): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!m) return null;
  const mois = MOIS[Number(m[2]) - 1];
  return mois ? `${Number(m[3])} ${mois} ${m[1]}` : null;
}

/** Version d'un fichier publié d'après son nom (AETHRYON-Setup-2.0.0-beta.8.exe → 2.0.0-beta.8). */
export function versionDuFichier(path: string): string | null {
  return /-(\d+\.\d+\.\d+(?:-[\w.]+?)?)\.(?:exe|msi|dmg|zip|AppImage|deb)$/.exec(path)?.[1] ?? null;
}
