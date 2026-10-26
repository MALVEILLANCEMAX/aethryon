// Migration 005 (liaison Discord) sur une base JETABLE : remplie au niveau 004 (comptes, jetons du raccourci,
// clés d'extension, codes PKCE, conversions, quotas, bonus, refus, réglages, journal d'administration), puis
// up → down → up. Chaque passage : données 001–004 identiques à l'octet près (instantané JSON de toutes les
// lignes), contraintes CHECK attendues, clés étrangères et intégrité vérifiées. Aucune base réelle n'est utilisée.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appliedVersions, migrateDown, migrateUp, tx, type DB } from "../src/db.ts";
import { harness, internalCall, newUser } from "./helpers.ts";

const TABLES_004 = [
  "user", "account", "apikey", "ytc_usage", "ytc_key_meta", "ytc_setting", "ytc_admin_event", "ytc_quota_ledger",
  "ytc_user_policy", "ytc_quota_grant", "ytc_auth_failure", "ytc_ext_code",
];
const DISCORD_TABLES = ["ytc_discord_download", "ytc_discord_link", "ytc_discord_state"];

function snapshot(db: DB): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of TABLES_004) {
    const rows = db.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[];
    out[t] = rows.map((r) => JSON.stringify(r)).sort();
  }
  return out;
}
/** Comparaison table par table (message précis : table et première ligne différente). */
function same(db: DB, ref: Record<string, string[]>, step: string) {
  const now = snapshot(db);
  for (const t of TABLES_004) assert.deepEqual(now[t], ref[t], `${step} : table ${t} modifiée`);
}
const tables = (db: DB) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ytc_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
const sqlOf = (db: DB, name: string) => (db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name) as { sql: string } | undefined)?.sql ?? "";
function healthy(db: DB) {
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), [], "aucune clé étrangère orpheline");
  assert.equal((db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
  assert.deepEqual((db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ytc_key_meta' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name), ["ytc_key_meta_user"]);
}

test("migration 005 : up → down → up sur une base 004 remplie ; données 001–004 intactes ; clés discord effacées au retour arrière", async () => {
  const h = await harness({ ADMIN_EMAILS: "admin@example.test", EXTENSION_IDS: "abcdefghijklmnopabcdefghijklmnop" });
  try {
    const db = h.s.db;
    assert.deepEqual(migrateDown(db, 11), [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
    assert.deepEqual(appliedVersions(db), [1, 2, 3, 4]);
    assert.ok(!tables(db).some((t) => DISCORD_TABLES.includes(t)));

    // ---- données au niveau 004 ----
    const admin = await newUser(h, "admin@example.test");
    const a = await newUser(h, "alice@example.test");
    const b = await newUser(h, "bob@example.test");
    const aid = (await a.json("/api/me")).body.user.id as string;
    const bid = (await b.json("/api/me")).body.user.id as string;
    const k1 = (await a.json("/api/keys", { method: "POST", body: { name: "iPhone", expiresInDays: 90 } })).body;
    const k2 = (await a.json("/api/keys", { method: "POST", body: { name: "iPad" } })).body;
    await a.json(`/api/keys/${k2.key.id}/rotate`, { method: "POST" });
    await a.json(`/api/keys/${k1.key.id}/revoke`, { method: "POST" });
    const kb = (await b.json("/api/keys", { method: "POST", body: { name: "Mon iPhone" } })).body;
    // Clés d'extension (une active, une révoquée pour rejeu) et codes PKCE (utilisé, en attente).
    const ext = (await h.s.auth.api.createApiKey({ body: { userId: aid, name: "Extension Chrome · Mac", expiresIn: 90 * 86_400 } })) as { id: string };
    const extR = (await h.s.auth.api.createApiKey({ body: { userId: bid, name: "Extension Chrome · PC", expiresIn: 90 * 86_400 } })) as { id: string };
    tx(db, () => {
      const ins = db.prepare("INSERT INTO ytc_key_meta (key_id, user_id, created_at, kind, device_label, revoked_at, revoked_reason) VALUES (?, ?, ?, 'extension', ?, ?, ?)");
      ins.run(ext.id, aid, "2026-10-11T08:00:00.000Z", "Mac", null, null);
      ins.run(extR.id, bid, "2026-10-11T08:05:00.000Z", "PC", "2026-10-11T08:06:00.000Z", "replay");
      const code = db.prepare("INSERT INTO ytc_ext_code (code_hash, user_id, redirect_uri, code_challenge, device_label, key_id, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      code.run("hash-utilise", aid, "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/aethryon", "c".repeat(43), "Mac", ext.id, "2026-10-11T08:00:00.000Z", "2026-10-11T08:02:00.000Z", "2026-10-11T08:00:30.000Z");
      code.run("hash-attente", bid, "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/aethryon", "d".repeat(43), null, null, "2026-10-11T09:00:00.000Z", "2026-10-11T09:02:00.000Z", null);
    });
    // Conversions (réservée, terminée, en erreur, remboursée), refus, quotas, bonus, réglages, journal.
    for (const fmt of ["mp3", "mp4", "mp4"]) {
      const r = await internalCall(h, "/internal/v1/authorize", { key: kb.secret, action: "create_job", fmt, platform: "youtube" });
      assert.equal(r.body.allow, true);
    }
    const ids = (db.prepare("SELECT id FROM ytc_usage ORDER BY created_at").all() as { id: string }[]).map((r) => r.id);
    await internalCall(h, `/internal/v1/usage/${ids[0]}`, { state: "done", size_bytes: 1234, job_id: "job-a" });
    await internalCall(h, `/internal/v1/usage/${ids[1]}`, { state: "error", error_code: "bot_check", cause: "Sign in to confirm" });
    await internalCall(h, `/internal/v1/usage/${ids[2]}`, { state: "refunded" });
    await internalCall(h, "/internal/v1/authorize", { key: "ytc_" + "Z".repeat(64), action: "access" });
    await admin.json(`/api/admin/users/${bid}/quota`, { method: "PUT", body: { dailyLimit: 25, unlimited: false, maxActive: 2 } });
    const g = await admin.json(`/api/admin/users/${bid}/quota/grant`, { method: "POST", body: { amount: 3, reason: "test" } });
    assert.equal(g.status, 201, JSON.stringify(g.body));
    await admin.json("/api/admin/settings", { method: "POST", body: { maintenanceMessage: "Maintenance jeudi." } });
    for (const t of ["ytc_usage", "ytc_key_meta", "ytc_ext_code", "ytc_user_policy", "ytc_quota_grant", "ytc_auth_failure", "ytc_setting", "ytc_admin_event", "ytc_quota_ledger"]) {
      assert.ok((db.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n > 0, `${t} rempli`);
    }
    const before = snapshot(db);
    healthy(db);

    // ---- 005 : up ----
    assert.deepEqual(migrateUp(db), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    assert.deepEqual(appliedVersions(db), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    same(db, before, "up");
    for (const t of DISCORD_TABLES) assert.ok(tables(db).includes(t), t);
    assert.match(sqlOf(db, "ytc_key_meta"), /'shortcut', 'extension', 'discord'/);
    assert.match(sqlOf(db, "ytc_key_meta"), /'replay', 'unlink', 'released'/);
    healthy(db);
    assert.throws(() => db.prepare("UPDATE ytc_key_meta SET kind = 'autre' WHERE key_id = ?").run(ext.id), /CHECK/);
    assert.throws(() => db.prepare("INSERT INTO ytc_discord_link (discord_user_id, user_id, discord_name, linked_at) VALUES ('12a45678901234567', ?, 'x', 'y')").run(aid), /CHECK/);
    assert.throws(() => db.prepare("INSERT INTO ytc_discord_link (discord_user_id, user_id, discord_name, linked_at) VALUES ('1234', ?, 'x', 'y')").run(aid), /CHECK/);
    assert.throws(() => db.prepare("INSERT INTO ytc_discord_link (discord_user_id, user_id, discord_name, linked_at) VALUES ('123456789012345678', 'inconnu', 'x', 'y')").run(), /FOREIGN KEY/);

    // ---- données Discord (005) ----
    const d1 = await h.s.keys.createDiscordKey(aid, "session");
    const d2 = await h.s.keys.createDiscordKey(aid, "session");
    const d3 = await h.s.keys.createDiscordKey(aid, "download");
    await h.s.keys.revoke(aid, d2.key.id, "released");
    await h.s.keys.revoke(aid, d3.key.id, "unlink");
    tx(db, () => {
      db.prepare("INSERT INTO ytc_discord_link (discord_user_id, user_id, discord_name, linked_at) VALUES ('123456789012345678', ?, 'alice', '2026-10-11T10:00:00.000Z')").run(aid);
      db.prepare("INSERT INTO ytc_discord_state (state_hash, user_id, session_hash, created_at, expires_at) VALUES ('s1', ?, 'h', 'a', 'b')").run(bid);
      db.prepare("INSERT INTO ytc_discord_download (token_hash, user_id, job_id, created_at, expires_at) VALUES ('t1', ?, 'job-a', 'a', 'b')").run(aid);
    });
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: d1.secret, action: "access" })).body.allow, true);
    healthy(db);

    // ---- 005 : down ----
    assert.deepEqual(migrateDown(db, 11), [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
    assert.deepEqual(appliedVersions(db), [1, 2, 3, 4]);
    assert.ok(!tables(db).some((t) => DISCORD_TABLES.includes(t)), "tables Discord retirées");
    same(db, before, "down (clés discord effacées)");
    for (const d of [d1, d2, d3]) assert.equal(db.prepare("SELECT 1 FROM apikey WHERE id = ?").get(d.key.id), undefined);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: d1.secret, action: "access" })).body.allow, false, "clé discord inutilisable après le retour arrière");
    // Ce refus vient d'être compté (ytc_auth_failure, effet voulu du test) : référence mise à jour pour cette table seule.
    before.ytc_auth_failure = snapshot(db).ytc_auth_failure!;
    assert.doesNotMatch(sqlOf(db, "ytc_key_meta"), /discord|unlink|released/);
    assert.throws(() => db.prepare("UPDATE ytc_key_meta SET kind = 'discord' WHERE key_id = ?").run(ext.id), /CHECK/);
    assert.throws(() => db.prepare("UPDATE ytc_key_meta SET revoked_reason = 'unlink' WHERE key_id = ?").run(ext.id), /CHECK/);
    healthy(db);

    // ---- 005 : up de nouveau ----
    assert.deepEqual(migrateUp(db), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    same(db, before, "up (2e fois)");
    for (const t of DISCORD_TABLES) assert.equal((db.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n, 0, `${t} vide`);
    healthy(db);
    assert.deepEqual(migrateUp(db), []);
    // Le service fonctionne sur la base remontée.
    assert.equal((await a.json("/api/me")).status, 200);
    assert.deepEqual(((await b.json("/api/keys")).body.keys as { name: string; kind: string }[]).map((k) => `${k.kind}:${k.name}`).sort(),
      ["extension:Extension Chrome · PC", "shortcut:Mon iPhone"]);
    assert.equal((await h.s.keys.createDiscordKey(aid, "session")).key.kind, "discord");
  } finally { h.close(); }
});
