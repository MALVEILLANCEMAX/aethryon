// Versions du format « aethryon-theme » et migrations (THEME_ENGINE.md § 8). Une migration par saut de version
// (n -> n + 1), fonction pure, testée sur des fichiers d'exemple gardés pour toujours (tests/fixtures/v<n>/).
// Version 1 : première version publiée, aucune migration encore nécessaire. Une version plus récente que
// l'application est refusée explicitement (le thème courant reste inchangé).

export const VERSION_SCHEMA = 1;

export type DocBrut = Record<string, unknown>;
/** Une étape : reçoit un document de la version n (déjà copié), renvoie la version n + 1 et note ce qu'elle a fait. */
export type Migration = (doc: DocBrut, rapport: string[]) => DocBrut;
/** Table des migrations : clé = version de départ. */
export type TableMigrations = Readonly<Record<number, Migration>>;

/** Migrations réelles (vide en v1). Exemple d'une future étape 1 -> 2 : renommer un jeton par une table d'alias. */
export const MIGRATIONS: TableMigrations = {};

export type ResultatMigration =
  | { ok: true; doc: DocBrut; depuis: number; rapport: string[] }
  | { ok: false; erreur: string };

/**
 * Amène un document brut (JSON déjà analysé) à `cible`. Ne valide pas le contenu : le validateur passe ensuite sur le
 * résultat. Refuse une version plus récente, une version inconnue ou une chaîne de migrations incomplète.
 */
export function migrer(entree: DocBrut, table: TableMigrations = MIGRATIONS, cible: number = VERSION_SCHEMA): ResultatMigration {
  const v = entree.schemaVersion;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return { ok: false, erreur: `« schemaVersion » doit valoir ${cible}.` };
  if (v > cible) return { ok: false, erreur: `Ce thème vient d'une version plus récente d'AETHRYON (schemaVersion ${v}).` };
  let doc = JSON.parse(JSON.stringify(entree)) as DocBrut;
  const rapport: string[] = [];
  for (let n = v; n < cible; n++) {
    const etape = table[n];
    if (!etape) return { ok: false, erreur: `Aucune migration connue de la version ${n} vers la version ${n + 1}.` };
    doc = etape(doc, rapport);
    doc.schemaVersion = n + 1;
  }
  return { ok: true, doc, depuis: v, rapport };
}

/** Outil pour écrire une migration : renomme des jetons (table d'alias) et retire ceux qui n'existent plus. */
export function renommerJetons(doc: DocBrut, alias: Readonly<Record<string, string>>, retires: readonly string[], rapport: string[]): DocBrut {
  const t = doc.tokens;
  if (!t || typeof t !== "object" || Array.isArray(t)) return doc;
  const sortie: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(t as Record<string, unknown>)) {
    if (retires.includes(k)) { rapport.push(`Jeton « ${k} » retiré (il n'existe plus).`); continue; }
    const nouveau = alias[k];
    if (nouveau) { sortie[nouveau] = val; rapport.push(`Jeton « ${k} » renommé en « ${nouveau} ».`); } else sortie[k] = val;
  }
  return { ...doc, tokens: sortie };
}
