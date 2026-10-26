// Purge de rétention à la demande : `node dist/tools/purge.js` (le service la fait aussi chaque jour).
import { loadConfig } from "../config.ts";
import { buildServer } from "../server.ts";

const s = await buildServer(loadConfig());
console.log(JSON.stringify(await s.usage.purge()));
s.close();
