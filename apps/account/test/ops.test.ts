import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { appliedVersions, migrateDown, migrateUp, openDb } from "../src/db.ts";
import { backup } from "../src/tools/backup.ts";
import { restore } from "../src/tools/restore.ts";
import { signedSessionCookie } from "../src/tools/create-test-session.ts";
import { harness, internalCall, newUser, ORIGIN } from "./helpers.ts";

test("migrations réversibles : up → down → up", async () => {
  const h = await harness();
  try {
    const db = h.s.db;
    assert.deepEqual(appliedVersions(db), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    assert.deepEqual(migrateDown(db, 15), [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ytc_%'").all() as { name: string }[]).map((t) => t.name);
    assert.deepEqual(tables, ["ytc_migration"]);
    assert.deepEqual(migrateUp(db), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    assert.deepEqual(appliedVersions(db), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    assert.deepEqual(migrateUp(db), []);
  } finally { h.close(); }
});

test("sauvegarde à chaud puis restauration : les données reviennent", async () => {
  const h = await harness();
  try {
    const b = await newUser(h, "bak@example.test");
    const k = await b.json("/api/keys", { method: "POST", body: { name: "A" } });
    const file = backup(h.cfg.dbPath, h.cfg.backupDir);
    assert.ok(existsSync(file));
    await b.json(`/api/keys/${k.body.key.id}/revoke`, { method: "POST" });
    h.s.close();
    const prev = restore(file, h.cfg.dbPath);
    assert.ok(prev && existsSync(prev));
    const db = openDb(h.cfg.dbPath, 5000);
    const row = db.prepare("SELECT k.enabled, m.revoked_at FROM apikey k LEFT JOIN ytc_key_meta m ON m.key_id = k.id").get() as { enabled: number; revoked_at: string | null };
    assert.deepEqual([row.enabled, row.revoked_at], [1, null]); // état d'avant la révocation
    assert.equal((db.prepare('SELECT count(*) n FROM "user"').get() as { n: number }).n, 1);
    db.close();
  } finally {
    try { h.close(); } catch { /* déjà fermé */ }
  }
});

test("rotation des sauvegardes : 14 conservées", async () => {
  const h = await harness();
  try {
    const { mkdirSync, writeFileSync, readdirSync } = await import("node:fs");
    mkdirSync(h.cfg.backupDir, { recursive: true });
    for (let i = 0; i < 20; i++) writeFileSync(join(h.cfg.backupDir, `account-2026010${i % 9}-0000${String(i).padStart(2, "0")}.sqlite`), "x");
    backup(h.cfg.dbPath, h.cfg.backupDir);
    assert.equal(readdirSync(h.cfg.backupDir).filter((f) => f.endsWith(".sqlite")).length, 14);
  } finally { h.close(); }
});

test("purge de rétention : anciennes utilisations supprimées", async () => {
  const h = await harness({ RETENTION_USAGE_DAYS: "90" });
  try {
    const b = await newUser(h, "old@example.test");
    const k = (await b.json("/api/keys", { method: "POST", body: { name: "A" } })).body;
    await internalCall(h, "/internal/v1/authorize", { key: k.secret, action: "create_job", fmt: "mp3" });
    await internalCall(h, "/internal/v1/authorize", { key: k.secret, action: "create_job", fmt: "mp3" });
    h.s.db.prepare("UPDATE ytc_usage SET created_at = '2020-01-01T00:00:00.000Z' WHERE rowid = (SELECT min(rowid) FROM ytc_usage)").run();
    const r = await h.s.usage.purge();
    assert.equal(r.usage, 1);
    assert.equal((h.s.db.prepare("SELECT count(*) n FROM ytc_usage").get() as { n: number }).n, 1);
  } finally { h.close(); }
});

test("jeton expiré refusé par l'API interne", async () => {
  const h = await harness();
  try {
    const b = await newUser(h, "exp@example.test");
    const k = (await b.json("/api/keys", { method: "POST", body: { name: "A", expiresInDays: 30 } })).body;
    h.s.dbs.auth.prepare("UPDATE apikey SET expiresAt = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), k.key.id);
    const r = await internalCall(h, "/internal/v1/authorize", { key: k.secret, action: "access" });
    assert.equal(r.body.allow, false);
    assert.ok(["expired", "invalid_key"].includes(r.body.reason), r.body.reason);
    const list = (await b.json("/api/keys")).body.keys;
    assert.ok(list.length === 0 || list[0].status === "expired");
  } finally { h.close(); }
});

test("outil de session de test : cookie signé accepté par l'API", async () => {
  const h = await harness();
  try {
    const ctx = await h.s.auth.$context;
    const user = await ctx.internalAdapter.createUser({ email: "tool@preprod.test", name: "tool", emailVerified: true }, { method: "admin" });
    const session = await ctx.internalAdapter.createSession(user.id);
    const cookie = await signedSessionCookie(ctx.authCookies.sessionToken.name, session.token, ctx.secret);
    const res = await h.s.publicApp.request("/api/me", { headers: { cookie, "x-real-ip": "198.51.100.7" } });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { user: { email: string } }).user.email, "tool@preprod.test");
    const forged = cookie.replace(/%2B|%2F|[A-Za-z0-9]{4}(?=%3D|$)/, "AAAA");
    const res2 = await h.s.publicApp.request("/api/me", { headers: { cookie: forged, "x-real-ip": "198.51.100.8" } });
    assert.equal(res2.status, 401);
    void ORIGIN;
  } finally { h.close(); }
});
