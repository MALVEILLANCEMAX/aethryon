// Migrations : `node dist/tools/migrate.js up | down <N> | status`.
// « up » applique aussi les migrations Better Auth (via buildServer) ; « down » ne touche qu'aux tables ytc_*.
import { loadConfig } from "../config.ts";
import { appliedVersions, migrateDown, openDb } from "../db.ts";
import { buildServer } from "../server.ts";

const [cmd, arg] = process.argv.slice(2);
if (cmd === "up") {
  const s = await buildServer(loadConfig());
  console.log(`migrations appliquées : ${appliedVersions(s.db).join(", ") || "aucune"}`);
  s.close();
} else if (cmd === "down") {
  const n = Number(arg ?? "1");
  if (!Number.isInteger(n) || n < 1) { console.error("usage : migrate.js down <N>"); process.exit(2); }
  const db = openDb(process.env.DB_PATH || "/data/account.sqlite", 5000);
  console.log(`migrations annulées : ${migrateDown(db, n).join(", ") || "aucune"}`);
  db.close();
} else if (cmd === "status") {
  const db = openDb(process.env.DB_PATH || "/data/account.sqlite", 5000);
  console.log(`migrations appliquées : ${appliedVersions(db).join(", ") || "aucune"}`);
  db.close();
} else {
  console.error("usage : migrate.js up | down <N> | status");
  process.exit(2);
}
