// Rôle administrateur hors panneau (docs/ADMIN.md §1), idempotent :
//   node dist/tools/admin.js grant --email <e-mail>   promotion (e-mail vérifié + liaison Google exigés)
//   node dist/tools/admin.js reactivate --email <e-mail>  réactive un compte suspendu (secours)
//   node dist/tools/admin.js list                      administrateurs actuels
// Codes de sortie : 0 = fait (ou déjà administrateur), 1 = refusé (compte absent ou inéligible),
// 2 = usage ou configuration invalide. Chaque promotion ou refus est inscrit au journal d'administration.
import { ConfigError, loadConfig } from "../config.ts";
import { writeTx } from "../db.ts";
import { grantAdmin, listAdmins, reactivateUser } from "../roles.ts";
import { buildServer } from "../server.ts";

export const TOOL_LABEL = "outil admin.js";

const USAGE = "usage\u00a0: admin.js grant --email <adresse> | admin.js reactivate --email <adresse> | admin.js list";

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd !== "grant" && cmd !== "reactivate" && cmd !== "list") { console.error(USAGE); return 2; }
  let email = "";
  if (cmd === "grant" || cmd === "reactivate") {
    const i = rest.indexOf("--email");
    email = (i >= 0 ? rest[i + 1] ?? "" : "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error(`adresse e-mail manquante ou invalide\n${USAGE}`); return 2; }
  }
  let cfg;
  try { cfg = loadConfig(); } catch (e) {
    console.error(e instanceof ConfigError ? `configuration invalide : ${e.message}` : "configuration invalide");
    return 2;
  }
  const s = await buildServer(cfg);
  try {
    if (cmd === "list") {
      const admins = listAdmins(s.db);
      if (!admins.length) console.log("aucun administrateur");
      for (const a of admins) {
        console.log(`${a.email}\t${a.status === "suspended" ? "suspendu" : "actif"}\tcréé le ${a.createdAt}\tdernière connexion ${a.lastLoginAt ?? "jamais"}`);
      }
      return 0;
    }
    if (cmd === "reactivate") {
      const rr = await writeTx(s.db, () => reactivateUser(s.db, email, TOOL_LABEL));
      if (!rr.ok) { console.error(`refusé\u00a0: ${rr.message}`); return 1; }
      console.log(rr.code === "reactivated" ? `${email}${"\u00a0"}: compte réactivé` : `${email}${"\u00a0"}: déjà actif (aucun changement)`);
      return 0;
    }
    const r = await writeTx(s.db, () => grantAdmin(s.db, email, TOOL_LABEL));
    if (r.ok) {
      console.log(r.code === "granted" ? `${email} est maintenant administrateur.` : `${email} est déjà administrateur (aucun changement).`);
      return 0;
    }
    console.error(`refusé\u00a0: ${r.message}`);
    return 1;
  } finally {
    s.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2));
}
