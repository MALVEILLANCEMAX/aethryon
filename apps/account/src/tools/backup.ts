// Sauvegarde à chaud : VACUUM INTO (copie cohérente même pendant le service), rotation des 14 dernières.
// `node dist/tools/backup.js` — DB_PATH et BACKUP_DIR comme le service.
import { chmodSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../db.ts";

export function backup(dbPath: string, dir: string, keep = 14): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const target = join(dir, `account-${stamp}.sqlite`);
  const db = openDb(dbPath, 5000);
  try {
    db.prepare("VACUUM INTO ?").run(target);
  } finally {
    db.close();
  }
  chmodSync(target, 0o600); // contient des e-mails et des sessions
  const files = readdirSync(dir).filter((f) => /^account-\d{8}-\d{6}\.sqlite$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) rmSync(join(dir, f));
  return target;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = backup(process.env.DB_PATH || "/data/account.sqlite", process.env.BACKUP_DIR || "/data/backups");
  console.log(`sauvegarde : ${target} (${statSync(target).size} octets)`);
}
