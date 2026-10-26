// Abonnement (espace › Abonnement, docs/ABONNEMENTS.md) : l'offre RÉELLE du compte et « Me prévenir ».
// Tant que la facturation est fermée (BILLING=off, défaut), aucune vente, aucun paiement, aucun droit payant.
// « Me prévenir » enregistre une demande EXPLICITE (une seule par compte, modèle V2 : Annuel et À vie ouvrent ensemble),
// retirable, effacée avec le compte et incluse dans l'export ; elle ne sert qu'à prévenir ce compte le jour où les
// offres payantes ouvriront. Rien n'est envoyé aujourd'hui. Les demandes « Plus » / « Pro » de l'ancienne grille
// (ytc_plan_waitlist, migration 009) ont été reprises par la migration 011.
//   GET  /api/abonnement            → {plan, checkout, prevenir: boolean}
//   POST /api/abonnement/prevenir   {actif: boolean} → {prevenir}
import type { Hono } from "hono";
import type { Services } from "./app.ts";
import { err, Limiter, type Vars } from "./http.ts";
import { log } from "./log.ts";
import { effectivePlan } from "./plans.ts";

/** Ce compte a-t-il demandé à être prévenu de l'ouverture des offres payantes ? */
export function waitlistOf(db: Services["db"], userId: string): boolean {
  return !!db.prepare("SELECT 1 FROM ytc_offer_waitlist WHERE user_id = ?").get(userId);
}

export function mountAbonnement(app: Hono<{ Variables: Vars }>, s: Services): void {
  const { db } = s;
  const toggleLimiter = new Limiter(30, 3_600_000); // 30 changements par heure et par compte

  app.get("/api/abonnement", (c) => {
    const user = c.get("user");
    if (!user) return err(c, 401, "unauthorized", "Connecte-toi pour continuer.");
    const plan = effectivePlan(s.usage.entitlements(user.id));
    return c.json({
      // L'offre effective (droits du compte) ; « bêta » tant qu'aucun paiement n'est ouvert.
      plan: { id: plan.id, name: plan.name, beta: !s.billing.enabled },
      // Paiement possible seulement avec la facturation ouverte (BILLING=test|live, docs/FACTURATION.md).
      checkout: s.billing.enabled,
      prevenir: waitlistOf(db, user.id),
    });
  });

  app.post("/api/abonnement/prevenir", async (c) => {
    const user = c.get("user");
    if (!user) return err(c, 401, "unauthorized", "Connecte-toi pour continuer.");
    let b: unknown;
    try { b = await c.req.json(); } catch { b = null; }
    const o = (b && typeof b === "object" && !Array.isArray(b) ? b : {}) as Record<string, unknown>;
    // « plan » toléré (pages de l'ancienne grille encore ouvertes pendant une mise en ligne) mais sans effet.
    if (Object.keys(o).some((k) => k !== "plan" && k !== "actif") || typeof o.actif !== "boolean") {
      return err(c, 400, "invalid_request", "Demande invalide.");
    }
    if (!toggleLimiter.take(user.id)) return err(c, 429, "rate_limited", "Trop de changements : réessaie dans un moment.");
    if (o.actif) {
      db.prepare("INSERT INTO ytc_offer_waitlist (user_id, created_at) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING").run(user.id, new Date().toISOString());
    } else {
      db.prepare("DELETE FROM ytc_offer_waitlist WHERE user_id = ?").run(user.id);
    }
    log("info", "waitlist", { user: user.id, actif: o.actif });
    return c.json({ prevenir: waitlistOf(db, user.id) });
  });
}
