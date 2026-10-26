// Choix du fournisseur de stockage (docs/STOCKAGE.md) : le reste du code reçoit un `Stockage` et ne sait pas où vont
// les fichiers. Rien n'est branché tant que le propriétaire n'a pas choisi (coûts, quotas, conditions).
import { LocalStockage, type LocalConfig } from "./local.ts";
import { S3Stockage, type S3Config } from "./s3.ts";
import type { Stockage } from "./stockage.ts";

export type ConfigStockage = { fournisseur: "local" } & LocalConfig | { fournisseur: "s3" } & S3Config;

export function creerStockage(c: ConfigStockage): Stockage {
  return c.fournisseur === "s3" ? new S3Stockage(c) : new LocalStockage(c);
}

export { cleValide, pieceJointe, type Objet, type Stockage } from "./stockage.ts";
export { LocalStockage, S3Stockage };
