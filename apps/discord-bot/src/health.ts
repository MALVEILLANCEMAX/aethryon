// Santé pour Docker : le bot écrit l'heure dans ce fichier toutes les 15 s tant qu'il est connecté à Discord ;
// `node dist/health.js` réussit si la dernière écriture date de moins de 60 s.
import { readFileSync } from "node:fs";

export const HEARTBEAT_FILE = process.env.HEARTBEAT_FILE ?? "/tmp/aethryon-discord-heartbeat";

export function isHealthy(read: (p: string) => string = (p) => readFileSync(p, "utf8"), now = Date.now(), maxAgeMs = 60_000): boolean {
  try {
    const t = Number(read(HEARTBEAT_FILE));
    return Number.isFinite(t) && now - t < maxAgeMs;
  } catch {
    return false;
  }
}

if (process.argv[1]?.endsWith("health.js")) process.exit(isHealthy() ? 0 : 1);
