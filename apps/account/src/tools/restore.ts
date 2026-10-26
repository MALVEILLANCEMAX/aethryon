// Restauration HORS SERVICE : `node dist/tools/restore.js <sauvegarde.sqlite> --force`.
// Arrêter le service d'abord (sinon il garde l'ancienne base ouverte). Vérifie l'intégrité de la
// sauvegarde, conserve l'actuelle sous <base>.avant-restauration-<date>, puis remplace la base.
import { copyFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function restore(backupPath: string, dbPath: string): string | null {
  const check = new DatabaseSync(backupPath, { readOnly: true });
  const res = check.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
  check.close();
  if (res.integrity_check !== "ok") throw new Error(`sauvegarde corrompue : ${res.integrity_check}`);
  let previous: string | null = null;
  if (existsSync(dbPath)) {
    previous = `${dbPath}.avant-restauration-${Date.now()}`;
    renameSync(dbPath, previous);
  }
  for (const ext of ["-wal", "-shm"]) if (existsSync(dbPath + ext)) rmSync(dbPath + ext);
  copyFileSync(backupPath, dbPath);
  return previous;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, force] = process.argv.slice(2);
  if (!file || force !== "--force") {
    console.error("usage : restore.js <sauvegarde.sqlite> --force   (service arrêté)");
    process.exit(2);
  }
  const prev = restore(file, process.env.DB_PATH || "/data/account.sqlite");
  console.log(`base restaurée depuis ${file}${prev ? ` ; ancienne base conservée : ${prev}` : ""}`);
}
