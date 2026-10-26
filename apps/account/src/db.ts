// Base SQLite (node:sqlite, sans module natif), en mode WAL.
// Deux connexions sur le même fichier :
// - « auth » pour Better Auth, qui ouvre ses propres transactions asynchrones (via Kysely) ;
// - « app » pour la logique métier, dont les transactions sont synchrones (aucun `await` dedans).
// Ainsi une transaction métier ne se retrouve jamais mêlée à une transaction Better Auth en cours.
// La connexion « app » n'attend jamais en bloquant le processus : si le verrou d'écriture est pris,
// `writeTx` réessaie de façon asynchrone (le processus continue de servir Better Auth).
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

export type DB = DatabaseSync;

export function openDb(path: string, busyTimeoutMs = 5000): DB {
  if (path === ":memory:") throw new Error("une base sur fichier est requise (deux connexions partagent le fichier)");
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${busyTimeoutMs}; PRAGMA synchronous = NORMAL;`);
  return db;
}

export interface Databases { auth: DB; app: DB }

export function openDatabases(path: string): Databases {
  const auth = openDb(path, 5000);
  const app = openDb(path, 0);
  return { auth, app };
}

export function newId(bytes = 16): string {
  return randomBytes(bytes).toString("base64url");
}

/** Transaction synchrone en écriture exclusive (migrations, outils). `fn` ne doit contenir aucun `await`. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const isBusy = (err: unknown): boolean =>
  !!err && typeof err === "object" && ((err as { errcode?: number }).errcode === 5 || /database is locked|SQLITE_BUSY/i.test(String((err as Error).message)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Transaction d'écriture à l'exécution : réessaie (asynchrone) tant que le verrou est pris, jusqu'à ~3 s. */
export async function writeTx<T>(db: DB, fn: () => T): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      db.exec("BEGIN IMMEDIATE");
    } catch (err) {
      if (isBusy(err) && attempt < 300) { await sleep(10); continue; }
      throw err;
    }
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch { /* déjà annulée */ }
      throw err;
    }
  }
}

// ---- migrations propres (versionnées, réversibles) ------------------------------------------

export interface Migration { version: number; name: string; up: string; down: string }

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(dir);
  const out: Migration[] = [];
  for (const f of files) {
    const m = /^(\d{3})_([a-z0-9_]+)\.up\.sql$/.exec(f);
    if (!m) continue;
    const version = Number(m[1]);
    const name = m[2]!;
    const down = `${m[1]}_${name}.down.sql`;
    if (!files.includes(down)) throw new Error(`migration ${f} sans fichier .down.sql`);
    out.push({ version, name, up: readFileSync(join(dir, f), "utf8"), down: readFileSync(join(dir, down), "utf8") });
  }
  return out.sort((a, b) => a.version - b.version);
}

function ensureTable(db: DB): void {
  db.exec("CREATE TABLE IF NOT EXISTS ytc_migration (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
}

export function appliedVersions(db: DB): number[] {
  ensureTable(db);
  return (db.prepare("SELECT version FROM ytc_migration ORDER BY version").all() as { version: number }[]).map((r) => r.version);
}

export function migrateUp(db: DB, migrations = loadMigrations()): number[] {
  const done = new Set(appliedVersions(db));
  const applied: number[] = [];
  for (const m of migrations) {
    if (done.has(m.version)) continue;
    tx(db, () => {
      db.exec(m.up);
      db.prepare("INSERT INTO ytc_migration (version, name, applied_at) VALUES (?, ?, ?)").run(m.version, m.name, new Date().toISOString());
    });
    applied.push(m.version);
  }
  return applied;
}

export function migrateDown(db: DB, steps: number, migrations = loadMigrations()): number[] {
  const done = appliedVersions(db).sort((a, b) => b - a).slice(0, steps);
  const reverted: number[] = [];
  for (const v of done) {
    const m = migrations.find((x) => x.version === v);
    if (!m) throw new Error(`migration ${v} introuvable`);
    tx(db, () => {
      db.exec(m.down);
      db.prepare("DELETE FROM ytc_migration WHERE version = ?").run(v);
    });
    reverted.push(v);
  }
  return reverted;
}
