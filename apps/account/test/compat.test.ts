// Compatibilité des jetons ytc_ avec ytapi : expiration, révocation immédiate, plusieurs jetons d'un
// même utilisateur (quota commun), rotation. Le vrai Better Auth vérifie les jetons (empreinte SHA-256).
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, internalCall, newUser } from "./helpers.ts";

async function twoKeys() {
  const h = await harness();
  const u = await newUser(h, "multi@example.test");
  const a = (await u.json("/api/keys", { method: "POST", body: { name: "iPhone" } })).body;
  const b = (await u.json("/api/keys", { method: "POST", body: { name: "iPad", expiresInDays: 30 } })).body;
  return { h, u, a: { secret: a.secret as string, id: a.key.id as string }, b: { secret: b.secret as string, id: b.key.id as string } };
}

test("jeton expiré : refusé par l'API interne avec le motif « expired »", async () => {
  const { h, b } = await twoKeys();
  try {
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: b.secret, action: "access" })).body.allow, true);
    h.s.db.prepare("UPDATE apikey SET expiresAt = ? WHERE id = ?").run(new Date(Date.now() - 60_000).toISOString(), b.id);
    const r = await internalCall(h, "/internal/v1/authorize", { key: b.secret, action: "create_job", fmt: "mp4" });
    assert.equal(r.body.allow, false);
    assert.equal(r.body.reason, "expired");
    assert.match(r.body.message, /expiré/);
  } finally { h.close(); }
});

test("révocation depuis le site : refus dès l'appel suivant, l'autre jeton reste valable", async () => {
  const { h, u, a, b } = await twoKeys();
  try {
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: a.secret, action: "access" })).body.allow, true);
    assert.equal((await u.json(`/api/keys/${a.id}/revoke`, { method: "POST" })).status, 200);
    const r = await internalCall(h, "/internal/v1/authorize", { key: a.secret, action: "access" });
    assert.deepEqual([r.body.allow, r.body.reason], [false, "invalid_key"]);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: a.secret, action: "create_job", fmt: "mp3" })).body.allow, false);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: b.secret, action: "access" })).body.allow, true);
  } finally { h.close(); }
});

test("deux jetons d'un même utilisateur : un seul quota (10 au total), même user_id", async () => {
  const { h, u, a, b } = await twoKeys();
  try {
    const seen = new Set<string>();
    let allowed = 0;
    for (let i = 0; i < 12; i++) {
      const key = i % 2 === 0 ? a.secret : b.secret;
      const r = await internalCall(h, "/internal/v1/authorize", { key, action: "create_job", fmt: i % 3 ? "mp3" : "mp4", platform: "tiktok" });
      if (r.body.allow) { allowed++; seen.add(r.body.user_id); assert.equal(r.body.limits.max_active, 1); }
      else assert.equal(r.body.reason, "quota_exceeded");
    }
    assert.equal(allowed, 10);
    assert.equal(seen.size, 1);
    assert.deepEqual([(await u.json("/api/me")).body.today.used, (await u.json("/api/me")).body.today.remaining], [10, 0]);
    // révoquer puis recréer un jeton ne rend pas de conversions
    await u.json(`/api/keys/${a.id}/revoke`, { method: "POST" });
    const c = (await u.json("/api/keys", { method: "POST", body: { name: "Nouveau" } })).body;
    const r = await internalCall(h, "/internal/v1/authorize", { key: c.secret, action: "create_job", fmt: "mp3" });
    assert.deepEqual([r.body.allow, r.body.reason], [false, "quota_exceeded"]);
  } finally { h.close(); }
});

test("rotation : l'ancien secret est refusé aussitôt, le nouveau est accepté", async () => {
  const { h, u, a } = await twoKeys();
  try {
    const rot = await u.json(`/api/keys/${a.id}/rotate`, { method: "POST" });
    assert.equal(rot.status, 201); // nouvelle clé créée
    const fresh = rot.body.secret as string;
    assert.ok(fresh.startsWith("ytc_") && fresh !== a.secret);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: a.secret, action: "access" })).body.allow, false);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: fresh, action: "access" })).body.allow, true);
  } finally { h.close(); }
});
