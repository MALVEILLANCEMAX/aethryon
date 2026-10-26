import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, internalCall, newUser } from "./helpers.ts";

test("création : secret montré une seule fois, jamais listé ni journalisé, plafond de 2", async () => {
  const h = await harness();
  try {
    const b = await newUser(h, "keys@example.test");
    const c1 = await b.json("/api/keys", { method: "POST", body: { name: "Mon iPhone" } });
    assert.equal(c1.status, 201);
    assert.match(c1.body.secret, /^ytc_[A-Za-z]{64}$/);
    assert.equal(c1.body.key.name, "Mon iPhone");
    assert.equal(c1.body.key.status, "active");
    assert.equal(c1.body.key.start, c1.body.secret.slice(0, 6));
    const list = await b.json("/api/keys");
    assert.equal(list.body.keys.length, 1);
    assert.ok(!JSON.stringify(list.body).includes(c1.body.secret));
    // la base ne contient que l'empreinte
    const row = h.s.db.prepare("SELECT key FROM apikey").get() as { key: string };
    assert.notEqual(row.key, c1.body.secret);
    assert.ok(!row.key.startsWith("ytc_"));
    assert.equal((await b.json("/api/keys", { method: "POST", body: { name: "iPad" } })).status, 201);
    const c3 = await b.json("/api/keys", { method: "POST", body: { name: "Trop" } });
    assert.equal(c3.status, 409);
    assert.equal(c3.body.error, "too_many_keys");
    // les journaux ne contiennent ni le secret ni l'e-mail
    const logs = h.logs.join("\n");
    assert.ok(!logs.includes(c1.body.secret));
    assert.ok(!logs.includes("keys@example.test"));
    // validation du nom
    const bad = await b.json("/api/keys", { method: "POST", body: { name: "" } });
    assert.equal(bad.status, 400);
    assert.equal((await b.json("/api/keys", { method: "POST", body: { name: "x".repeat(41) } })).status, 400);
    assert.equal((await b.json("/api/keys", { method: "POST", body: { name: "ok", expiresInDays: 7 } })).status, 400);
    // routes du plugin fermées
    assert.equal((await b.json("/api/auth/api-key/create", { method: "POST", body: { name: "x" } })).status, 404);
    assert.equal((await b.json("/api/auth/api-key/list")).status, 404);
  } finally { h.close(); }
});

test("renommer, révoquer (date), régénérer, vérifier un jeton collé", async () => {
  const h = await harness();
  try {
    const b = await newUser(h, "rot@example.test");
    const c = await b.json("/api/keys", { method: "POST", body: { name: "A", expiresInDays: 90 } });
    const id = c.body.key.id;
    assert.ok(c.body.key.expiresAt);
    const ren = await b.json(`/api/keys/${id}`, { method: "PATCH", body: { name: "  iPhone   de Léa " } });
    assert.equal(ren.body.key.name, "iPhone de Léa");
    const chk = await b.json("/api/keys/check", { method: "POST", body: { secret: c.body.secret } });
    assert.deepEqual([chk.body.valid, chk.body.status, chk.body.keyId], [true, "active", id]);
    const rot = await b.json(`/api/keys/${id}/rotate`, { method: "POST" });
    assert.equal(rot.status, 201);
    assert.equal(rot.body.revokedKeyId, id);
    assert.equal(rot.body.key.name, "iPhone de Léa");
    assert.notEqual(rot.body.secret, c.body.secret);
    const list = (await b.json("/api/keys")).body.keys as { id: string; status: string; revokedAt: string | null }[];
    assert.equal(list.find((k) => k.id === id)!.status, "revoked");
    assert.ok(list.find((k) => k.id === id)!.revokedAt);
    assert.equal(list.find((k) => k.id === rot.body.key.id)!.status, "active");
    const old = await b.json("/api/keys/check", { method: "POST", body: { secret: c.body.secret } });
    assert.deepEqual([old.body.valid, old.body.status], [false, "revoked"]);
    const rev = await b.json(`/api/keys/${rot.body.key.id}/revoke`, { method: "POST" });
    assert.equal(rev.body.key.status, "revoked");
    // idempotent
    assert.equal((await b.json(`/api/keys/${rot.body.key.id}/revoke`, { method: "POST" })).status, 200);
    assert.equal((await b.json(`/api/keys/${id}/rotate`, { method: "POST" })).status, 409);
    const unknown = await b.json("/api/keys/check", { method: "POST", body: { secret: "ytc_" + "Q".repeat(64) } });
    assert.deepEqual([unknown.body.valid, unknown.body.status], [false, "unknown"]);
  } finally { h.close(); }
});

test("isolation : un utilisateur ne voit ni ne modifie les jetons d'un autre", async () => {
  const h = await harness();
  try {
    const a = await newUser(h, "a@example.test");
    const bb = await newUser(h, "b@example.test");
    const ka = await a.json("/api/keys", { method: "POST", body: { name: "A" } });
    const id = ka.body.key.id;
    assert.equal((await bb.json("/api/keys")).body.keys.length, 0);
    assert.equal((await bb.json(`/api/keys/${id}`, { method: "PATCH", body: { name: "pirate" } })).status, 404);
    assert.equal((await bb.json(`/api/keys/${id}/revoke`, { method: "POST" })).status, 404);
    assert.equal((await bb.json(`/api/keys/${id}/rotate`, { method: "POST" })).status, 404);
    const chk = await bb.json("/api/keys/check", { method: "POST", body: { secret: ka.body.secret } });
    assert.equal(chk.body.valid, false);
    assert.equal(chk.body.status, "unknown");
    assert.equal((await a.json("/api/keys")).body.keys[0].status, "active");
    // sans session
    const anon = await h.s.publicApp.request("/api/keys");
    assert.equal(anon.status, 401);
  } finally { h.close(); }
});

test("suppression du compte : clés effacées, refusées par l'API interne ; export", async () => {
  const h = await harness();
  try {
    const b = await newUser(h, "bye@example.test");
    const k = await b.json("/api/keys", { method: "POST", body: { name: "A" } });
    const exp = await b.req("/api/account/export");
    assert.equal(exp.status, 200);
    assert.match(String(exp.headers.get("content-disposition")), /attachment/);
    const data = await exp.json() as { user: { email: string }; keys: unknown[] };
    assert.equal(data.user.email, "bye@example.test");
    assert.equal(data.keys.length, 1);
    assert.ok(!JSON.stringify(data).includes(k.body.secret));
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: k.body.secret, action: "access" })).body.allow, true);
    const del = await b.json("/api/auth/delete-user", { method: "POST", body: {} });
    assert.equal(del.status, 200);
    assert.equal((h.s.db.prepare("SELECT count(*) n FROM apikey").get() as { n: number }).n, 0);
    assert.equal((h.s.db.prepare("SELECT count(*) n FROM ytc_key_meta").get() as { n: number }).n, 0);
    const after = await internalCall(h, "/internal/v1/authorize", { key: k.body.secret, action: "access" });
    assert.deepEqual([after.body.allow, after.body.reason], [false, "invalid_key"]);
    assert.equal((await b.json("/api/me")).status, 401);
  } finally { h.close(); }
});
