// Clés « outils » d'AETHRYON Tools : `node dist/tools/outils-keys.js effacer`, lancé par deploy-tools.sh --rollback
// AVANT de remettre une image d'account sans Tools (migration 010 conservée) : l'ancien code listerait ces clés dans
// « Mes jetons » jusqu'à leur expiration (15 min au plus). Efface aussi les liens « Ouvrir dans Tools » en attente.
// Rien d'autre n'est touché (même effet que la migration 010 descendante sur ces lignes, sans changer le schéma).
import { openDb } from "../db.ts";

if (process.argv[2] !== "effacer") {
  console.error("usage : outils-keys.js effacer");
  process.exit(2);
}
const db = openDb(process.env.DB_PATH || "/data/account.sqlite", 5000);
try {
  db.exec("BEGIN IMMEDIATE");
  const keys = db.prepare("DELETE FROM apikey WHERE id IN (SELECT key_id FROM ytc_key_meta WHERE kind = 'outils')").run().changes;
  db.prepare("DELETE FROM ytc_key_meta WHERE kind = 'outils'").run();
  const refs = db.prepare("DELETE FROM ytc_outils_ref").run().changes;
  db.exec("COMMIT");
  console.log(`clés « outils » effacées : ${keys} ; liens « Ouvrir dans Tools » effacés : ${refs}`);
} catch (e) {
  try { db.exec("ROLLBACK"); } catch { /* déjà annulée */ }
  console.error(`échec : ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
