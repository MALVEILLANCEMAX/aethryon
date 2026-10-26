// Rôles (docs/ADMIN.md §1). `user.role` en base fait foi ; ADMIN_EMAILS n'est qu'une liste d'amorçage :
// promotion à la création d'une session si l'e-mail y figure, est vérifié ET a une liaison Google.
// Jamais de rétrogradation automatique (elle se fait dans le panneau, avec garde du dernier admin).
// Toutes les fonctions sont synchrones : elles s'exécutent sur la connexion qu'on leur donne
// (« auth » dans les hooks Better Auth, « app » ailleurs, dans une transaction ouverte par l'appelant).
import { insertAudit, SYSTEM_LABEL } from "./audit.ts";
import type { DB } from "./db.ts";

export type IneligibleReason = "user_not_found" | "email_not_verified" | "no_google_account" | "user_suspended";
export type Eligibility = { ok: true } | { ok: false; reason: IneligibleReason; message: string };

export const INELIGIBLE_TEXT: Record<IneligibleReason, string> = {
  user_not_found: "Aucun compte avec cette adresse.",
  email_not_verified: "L'adresse e-mail de ce compte n'est pas vérifiée par Google.",
  no_google_account: "Ce compte n'est lié à aucune connexion Google.",
  user_suspended: "Ce compte est suspendu.",
};

const refuse = (reason: IneligibleReason): Eligibility => ({ ok: false, reason, message: INELIGIBLE_TEXT[reason] });

/** Un compte peut-il être administrateur ? (e-mail vérifié, liaison Google, non suspendu) */
export function adminEligibility(db: DB, userId: string): Eligibility {
  const u = db.prepare('SELECT "emailVerified" AS ev, status FROM "user" WHERE id = ?').get(userId) as
    | { ev: number | boolean | null; status: string | null } | undefined;
  if (!u) return refuse("user_not_found");
  if (u.status === "suspended") return refuse("user_suspended");
  if (!(u.ev === true || Number(u.ev) === 1)) return refuse("email_not_verified");
  const g = db.prepare("SELECT 1 AS x FROM account WHERE \"userId\" = ? AND \"providerId\" = 'google' LIMIT 1").get(userId);
  if (!g) return refuse("no_google_account");
  return { ok: true };
}

/** Administrateurs actifs (non suspendus), en excluant éventuellement un compte. */
export function countActiveAdmins(db: DB, excludeUserId: string | null = null): number {
  const r = db.prepare(
    "SELECT count(*) AS n FROM \"user\" WHERE role = 'admin' AND (status IS NULL OR status <> 'suspended') AND (? IS NULL OR id <> ?)",
  ).get(excludeUserId, excludeUserId) as { n: number };
  return Number(r.n);
}

/**
 * Amorçage à la création d'une session : promotion idempotente si l'e-mail figure dans ADMIN_EMAILS
 * et que le compte est éligible. Renvoie vrai si le rôle vient de changer.
 */
export function bootstrapAdmin(db: DB, userId: string, adminEmails: ReadonlySet<string>): boolean {
  const u = db.prepare('SELECT email, role FROM "user" WHERE id = ?').get(userId) as { email: string; role: string | null } | undefined;
  if (!u || u.role === "admin" || !adminEmails.has(u.email.toLowerCase())) return false;
  if (!adminEligibility(db, userId).ok) return false;
  // Point de sauvegarde : rôle et audit ensemble, que Better Auth ait ouvert une transaction ou non.
  db.exec("SAVEPOINT ytc_bootstrap");
  try {
    db.prepare("UPDATE \"user\" SET role = 'admin' WHERE id = ?").run(userId);
    insertAudit(db, {
      actorId: null, actorLabel: SYSTEM_LABEL, action: "role.bootstrap", targetType: "user", target: userId,
      details: { before: { role: u.role ?? "user" }, after: { role: "admin" }, source: "ADMIN_EMAILS" },
    });
    db.exec("RELEASE ytc_bootstrap");
  } catch (e) {
    db.exec("ROLLBACK TO ytc_bootstrap");
    db.exec("RELEASE ytc_bootstrap");
    throw e;
  }
  return true;
}

export type GrantResult =
  | { ok: true; code: "granted" | "already_admin"; userId: string }
  | { ok: false; code: IneligibleReason; message: string; userId: string | null };

/** Promotion par l'outil `admin.js grant` (mêmes vérifications que l'amorçage, audit dans tous les cas). */
export function grantAdmin(db: DB, rawEmail: string, actorLabel: string): GrantResult {
  const email = rawEmail.trim().toLowerCase();
  const u = db.prepare('SELECT id, role, status FROM "user" WHERE email = ?').get(email) as { id: string; role: string | null; status: string | null } | undefined;
  if (!u) {
    insertAudit(db, { actorId: null, actorLabel, action: "role.grant", targetType: "user", target: null, details: { reason: "user_not_found" }, result: "refused" });
    return { ok: false, code: "user_not_found", message: INELIGIBLE_TEXT.user_not_found, userId: null };
  }
  if (u.role === "admin" && u.status === "suspended") {
    // « Déjà administrateur » serait trompeur : ce compte ne peut pas se connecter. Réactivation
    // explicite et journalisée : admin.js reactivate.
    insertAudit(db, { actorId: null, actorLabel, action: "role.grant", targetType: "user", target: u.id, details: { reason: "user_suspended" }, result: "refused" });
    return { ok: false, code: "user_suspended", message: "Ce compte administrateur est suspendu\u00a0: réactive-le d'abord (admin.js reactivate --email …).", userId: u.id };
  }
  if (u.role === "admin") return { ok: true, code: "already_admin", userId: u.id };
  const e = adminEligibility(db, u.id);
  if (!e.ok) {
    insertAudit(db, { actorId: null, actorLabel, action: "role.grant", targetType: "user", target: u.id, details: { reason: e.reason }, result: "refused" });
    return { ok: false, code: e.reason, message: e.message, userId: u.id };
  }
  db.prepare("UPDATE \"user\" SET role = 'admin' WHERE id = ?").run(u.id);
  insertAudit(db, {
    actorId: null, actorLabel, action: "role.grant", targetType: "user", target: u.id,
    details: { before: { role: u.role ?? "user" }, after: { role: "admin" } },
  });
  return { ok: true, code: "granted", userId: u.id };
}

export type ReactivateResult =
  | { ok: true; code: "reactivated" | "already_active"; userId: string }
  | { ok: false; code: "user_not_found"; message: string; userId: null };

/** Réactivation d'un compte suspendu par l'outil (secours si plus aucun administrateur n'est actif). */
export function reactivateUser(db: DB, rawEmail: string, actorLabel: string): ReactivateResult {
  const email = rawEmail.trim().toLowerCase();
  const u = db.prepare('SELECT id, status FROM "user" WHERE email = ?').get(email) as { id: string; status: string | null } | undefined;
  if (!u) {
    insertAudit(db, { actorId: null, actorLabel, action: "user.status", targetType: "user", target: null, details: { reason: "user_not_found" }, result: "refused" });
    return { ok: false, code: "user_not_found", message: INELIGIBLE_TEXT.user_not_found, userId: null };
  }
  if (u.status !== "suspended") return { ok: true, code: "already_active", userId: u.id };
  db.prepare("UPDATE \"user\" SET status = 'active' WHERE id = ?").run(u.id);
  insertAudit(db, { actorId: null, actorLabel, action: "user.status", targetType: "user", target: u.id, details: { before: { status: "suspended" }, after: { status: "active" } } });
  return { ok: true, code: "reactivated", userId: u.id };
}

export function listAdmins(db: DB): { id: string; email: string; name: string; status: string; createdAt: string; lastLoginAt: string | null }[] {
  return (db.prepare(
    'SELECT id, email, name, status, "createdAt" AS createdAt, "lastLoginAt" AS lastLoginAt FROM "user" WHERE role = \'admin\' ORDER BY "createdAt"',
  ).all() as { id: string; email: string; name: string; status: string | null; createdAt: string; lastLoginAt: string | null }[])
    .map((r) => ({ ...r, status: r.status ?? "active" }));
}
