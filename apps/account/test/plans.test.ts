import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANS, effectivePlan, exportMinutes, exportWeight, fromDiscordEntitlement, planForSku, youtubeAllowed, type Entitlement } from "../src/plans.ts";
import { exportCost, seconds } from "../src/outils.ts";

test("catalogue V2 : Gratuit 0 €, Annuel 5 € par an, À vie 20 € une fois ; limites payantes identiques et plus larges ; rien d'illimité", () => {
  assert.deepEqual(Object.values(PLANS).map((p) => [p.id, p.name, p.priceEur, p.billing]),
    [["free", "Gratuit", 0, "none"], ["annuel", "Premium", 5, "year"], ["vie", "Premium à vie", 20, "once"]]);
  assert.deepEqual(PLANS.annuel.limits, PLANS.vie.limits, "seule la façon de payer change");
  for (const k of Object.keys(PLANS.free.limits) as (keyof typeof PLANS.free.limits)[]) {
    const f = PLANS.free.limits[k], a = PLANS.annuel.limits[k];
    if (f !== null && a !== null) assert.ok(f <= a, k);
    for (const p of Object.values(PLANS)) { const v = p.limits[k]; if (v !== null) assert.ok(Number.isFinite(v), `${p.id}.${k} fini`); }
  }
  assert.equal(PLANS.annuel.limits.monthly, 600, "plafond sur 30 jours des offres payantes");
  // Gratuit = l'offre réelle d'aujourd'hui, rien de retiré : 10 par jour, une à la fois, qualité et outils complets
  // (ytapi : jusqu'au 2160p, MP3 320, extraits de 3 min, GIF de 30 s, exports de 15 min, fichiers de 1,5 Go),
  // bibliothèque de 200 et historique de 90 jours ; plus la limite d'export de Tools (30 min pondérées par jour).
  assert.deepEqual([PLANS.free.limits.daily, PLANS.free.limits.monthly, PLANS.free.limits.maxActive, PLANS.free.limits.exportMinutesDaily], [10, null, 1, 30]);
  assert.deepEqual([PLANS.free.limits.maxQuality, PLANS.free.limits.maxBitrate, PLANS.free.limits.clipMaxS, PLANS.free.limits.gifMaxS, PLANS.free.limits.exportMaxS, PLANS.free.limits.maxFileMb],
    [2160, 320, 180, 30, 900, 1500]);
  assert.deepEqual([PLANS.free.limits.savedMax, PLANS.free.limits.historyDays], [200, 90]);
});

test("offre effective : le plus haut droit actif (À vie avant Annuel) ; expiré, futur ou révoqué ne compte pas", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  const e = (plan: "annuel" | "vie", startsAt: string, endsAt: string | null, revoked = false): Entitlement => ({ plan, source: "web", startsAt, endsAt, revoked });
  assert.equal(effectivePlan([], now).id, "free");
  assert.equal(effectivePlan([e("annuel", "2026-10-01T00:00:00Z", "2027-10-03T00:00:00Z")], now).id, "annuel");
  assert.equal(effectivePlan([e("annuel", "2026-10-01T00:00:00Z", "2027-10-03T00:00:00Z"), e("vie", "2026-10-15T00:00:00Z", null)], now).id, "vie");
  assert.equal(effectivePlan([e("annuel", "2025-10-01T00:00:00Z", "2026-10-03T00:00:00Z")], now).id, "free", "expiré");
  assert.equal(effectivePlan([e("vie", "2026-12-01T00:00:00Z", null)], now).id, "free", "pas encore commencé");
  assert.equal(effectivePlan([e("vie", "2026-10-01T00:00:00Z", null, true)], now).id, "free", "révoqué (remboursé, litige)");
});

test("SKU Discord → offre : seulement les identifiants configurés ; entitlement supprimé = révoqué", () => {
  const skus = { annuel: "1500000000000000001", vie: "1500000000000000002" };
  assert.equal(planForSku("1500000000000000002", skus), "vie");
  assert.equal(planForSku("999", skus), null);
  assert.equal(planForSku("1500000000000000001", {}), null, "aucun SKU configuré : aucun droit");
  const ent = fromDiscordEntitlement({ sku_id: "1500000000000000001", starts_at: "2026-10-01T00:00:00Z", ends_at: "2027-10-01T00:00:00Z" }, skus)!;
  assert.deepEqual(ent, { plan: "annuel", source: "discord", startsAt: "2026-10-01T00:00:00Z", endsAt: "2027-10-01T00:00:00Z", revoked: false });
  assert.equal(fromDiscordEntitlement({ sku_id: "1500000000000000001", deleted: true }, skus)!.revoked, true);
});

test("budget YouTube : sans effet tant que les proxys ne sont pas nécessaires ; avec proxys, jamais plus que le net d'une offre", () => {
  assert.equal(youtubeAllowed(PLANS.free, 50, 1, false), true);
  assert.equal(youtubeAllowed(PLANS.free, 0.04, 0.02, true), false, "Gratuit : 0,05 Go par mois avec proxys");
  assert.equal(youtubeAllowed(PLANS.annuel, 0.1, 0.03, true), true);
  // Garde-fou (COUTS.md §10) : à 3 $/Go (2,76 €/Go), le budget mensuel au plafond ne dépasse pas le net mensuel d'Annuel
  // (4,64 € par an, frais Stripe déduits, franchise de TVA) ni celui d'À vie étalé sur 5 ans (19,45 € / 60 mois).
  const perMonth = PLANS.annuel.limits.youtubeGbMonthly * 2.76;
  assert.ok(perMonth <= 4.64 / 12 + 0.03, `annuel : ${perMonth.toFixed(2)} € par mois`);
  assert.ok(perMonth <= 19.45 / 60 + 0.1, "à vie sur 5 ans");
});

test("minutes d'export : pondérées par le coût mesuré (1080p = 1, 720p 0,65, 4K 3,5, GIF 0,55, son 0)", () => {
  assert.deepEqual(["video", "compress", "gif", "audio", "apercu", "echantillon"].map((op) => exportWeight(op, 1080)), [1, 1, 0.55, 0, 0, 0]);
  assert.deepEqual([exportWeight("video", 720), exportWeight("video", 480), exportWeight("video", 1440), exportWeight("video", 2160)], [0.65, 0.65, 1, 3.5]);
  assert.equal(exportMinutes("video", 600, 1080), 10);
  assert.equal(exportMinutes("video", 60, 2160), 3.5);
  assert.equal(exportMinutes("gif", 10, null), 0.1, "10 s de GIF : 0,09 → arrondi au dixième supérieur");
  assert.equal(exportMinutes("audio", 3600, null), 0);
  // Demande réelle : passage, vitesse, hauteur demandée ou de la source, côté court (vidéo verticale).
  const media = { duration: 120, width: 1920, height: 1080 };
  assert.equal(exportCost({ op: "video", start_s: 10, duration_s: 60 }, media), 1);
  assert.equal(exportCost({ op: "video", start_s: 10, duration_s: 60, speed: 2 }, media), 0.5, "×2 : 30 s produites");
  assert.equal(exportCost({ op: "video", start_s: 100, duration_s: 60 }, media), 0.4, "borné à la fin du média (20 s)");
  assert.equal(exportCost({ op: "video", start_s: "0:10", duration_s: 60, height: 720 }, media), 0.7, "0,65 arrondi au dixième supérieur");
  assert.equal(exportCost({ op: "video", duration_s: 60 }, { duration: 60, width: 2160, height: 3840 }), 3.5, "4K verticale");
  assert.equal(exportCost({ op: "video", duration_s: 60 }, { duration: 60, width: 1080, height: 1920 }), 1, "1080p verticale : côté court");
  assert.equal(exportCost({ op: "audio", duration_s: 60 }, media), 0);
  assert.equal(seconds("1:02:03"), 3723);
  assert.equal(seconds("1:2:3:4"), null);
  assert.equal(seconds(-1), null);
});

test("site et serveur d'accord : limites affichées (web/src/lib/offres.ts) et version des CGV (web/src/lib/legal.tsx)", async () => {
  const { readFileSync } = await import("node:fs");
  const { CGV_VERSION } = await import("../src/facturation.ts");
  const offres = readFileSync(new URL("../../web/src/lib/offres.ts", import.meta.url), "utf8");
  const num = (src: string, re: RegExp) => Number(re.exec(src)?.[1] ?? NaN);
  const paid = /const PAID: PlanLimits = \{([^}]+)\}/.exec(offres)?.[1] ?? "";
  const free = /id: "free"[^}]*limits: \{([^}]+)\}/.exec(offres)?.[1] ?? "";
  const L = PLANS.annuel.limits, F = PLANS.free.limits;
  assert.deepEqual(
    [num(paid, /daily: (\d+)/), num(paid, /monthly: (\d+)/), num(paid, /maxActive: (\d+)/), num(paid, /exportMinutes: (\d+)/), num(paid, /savedMax: (\d+)/), num(paid, /historyDays: (\d+)/)],
    [L.daily, L.monthly, L.maxActive, L.exportMinutesDaily, L.savedMax, L.historyDays], "offres payantes : mêmes limites des deux côtés");
  assert.deepEqual(
    [num(free, /daily: (\d+)/), num(free, /maxActive: (\d+)/), num(free, /exportMinutes: (\d+)/), num(free, /savedMax: (\d+)/), num(free, /historyDays: (\d+)/)],
    [F.daily, F.maxActive, F.exportMinutesDaily, F.savedMax, F.historyDays], "Gratuit : mêmes limites des deux côtés");
  assert.equal(L.savedMax, F.savedMax, "bibliothèque (bot Discord) : même plafond pour toutes les offres, jamais vendue");
  assert.doesNotMatch(offres, /id: "library"/, "aucune ligne « Bibliothèque » dans les offres");
  const legal = readFileSync(new URL("../../web/src/lib/legal.tsx", import.meta.url), "utf8");
  assert.equal(/export const CGV_VERSION = "([^"]+)"/.exec(legal)?.[1], CGV_VERSION, "version des CGV : la même sur le site et le serveur");
});
