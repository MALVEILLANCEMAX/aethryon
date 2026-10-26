// Journal d'administration (table ytc_admin_event). Chaque action sensible y laisse une ligne : acteur
// (identifiant + libellé, e-mail de l'admin au moment de l'action ou « système »), cible typée, détails
// avant/après sans aucun secret, résultat (ok | refused | error).
import { newId, writeTx, type DB } from "./db.ts";
import { nowIso } from "./time.ts";

export type AuditResult = "ok" | "refused" | "error";
export type TargetType = "user" | "key" | "job" | "setting" | "quota" | "admin";

export interface AuditInput {
  actorId: string | null;
  actorLabel: string;
  action: string;
  targetType?: TargetType | null;
  target?: string | null;
  details?: unknown;
  result?: AuditResult;
}

export interface AuditEvent {
  id: string; at: string; actorId: string | null; actorLabel: string | null; action: string;
  targetType: string | null; target: string | null; details: unknown; result: string;
}

export const SYSTEM_LABEL = "système";

/** Écriture synchrone (à appeler dans une transaction déjà ouverte, ou depuis un hook Better Auth). */
export function insertAudit(db: DB, e: AuditInput): string {
  const id = newId();
  db.prepare(
    "INSERT INTO ytc_admin_event (id, actor_user_id, actor_label, action, target_type, target, details, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, e.actorId, e.actorLabel.slice(0, 320), e.action, e.targetType ?? null, e.target ?? null,
    JSON.stringify(e.details ?? null), e.result ?? "ok", nowIso());
  return id;
}

/** Écriture dans sa propre transaction (connexion « app »). */
export function audit(db: DB, e: AuditInput): Promise<string> {
  return writeTx(db, () => insertAudit(db, e));
}

export interface AuditRow {
  id: string; created_at: string; actor_user_id: string | null; actor_label: string | null; action: string;
  target_type: string | null; target: string | null; details: string | null; result: string | null;
}

export function auditView(r: AuditRow): AuditEvent {
  let details: unknown = null;
  if (r.details) { try { details = JSON.parse(r.details); } catch { details = null; } }
  return {
    id: r.id, at: r.created_at, actorId: r.actor_user_id, actorLabel: r.actor_label, action: r.action,
    targetType: r.target_type, target: r.target, details, result: r.result ?? "ok",
  };
}
