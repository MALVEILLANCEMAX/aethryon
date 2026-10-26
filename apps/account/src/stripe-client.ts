// Client Stripe officiel (SDK « stripe », version d'API figée), créé seulement quand la facturation est ouverte
// (BILLING=test ou live, config.ts). La clé secrète vient d'un fichier et ne quitte jamais ce processus.
import Stripe from "stripe";
import type { BillingConfig } from "./config.ts";

/** Version de l'API Stripe dont le code et les essais dépendent (celle du SDK 23.0.0). */
export const STRIPE_API_VERSION = "2026-09-30.endive";

export function createStripe(b: BillingConfig): Stripe {
  return new Stripe(b.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2, // avec une clé d'idempotence sur chaque création : jamais de double effet
    timeout: 15_000,
    telemetry: false,
    appInfo: { name: "AETHRYON" },
    // Simulateur local (essais seulement : config.ts refuse STRIPE_API_BASE en mode réel).
    ...(b.apiHost ? { host: b.apiHost.host, port: b.apiHost.port, protocol: b.apiHost.protocol } : {}),
  });
}
