import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, internalCall, newUser } from "./helpers.ts";

async function setup(env: Record<string, string> = {}) {
  const h = await harness({ ADMIN_EMAILS: "admin@example.test", ...env });
  const admin = await newUser(h, "admin@example.test");
  const u = await newUser(h, "user@example.test");
  const k = (await u.json("/api/keys", { method: "POST", body: { name: "iPhone" } })).body;
  return { h, admin, u, key: k.secret as string, keyId: k.key.id as string };
}

test("jeton interne obligatoire (absent ou faux → 401)", async () => {
  const { h, key } = await setup();
  try {
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key, action: "access" }, null)).status, 401);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key, action: "access" }, "wrong")).status, 401);
    const ok = await internalCall(h, "/internal/v1/authorize", { key, action: "access" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.allow, true);
    assert.equal(ok.body.limits.daily, 10);
    assert.equal(ok.body.limits.max_active, 1);
    assert.equal(ok.body.usage_id, undefined);
    assert.equal(ok.body.key_kind, "shortcut", "type de clé transmis à ytapi (limites par adresse sauf pour le bot)");
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key, action: "nope" })).status, 400);
  } finally { h.close(); }
});

test("refus : inconnu, révoqué, suspendu, format, pause", async () => {
  const { h, admin, u, key, keyId } = await setup();
  try {
    const bad = await internalCall(h, "/internal/v1/authorize", { key: "ytc_" + "Z".repeat(64), action: "access" });
    assert.deepEqual([bad.body.allow, bad.body.reason], [false, "invalid_key"]);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: "pas-un-jeton", action: "access" })).body.reason, "invalid_key");
    const gif = await internalCall(h, "/internal/v1/authorize", { key, action: "create_job", fmt: "gif" });
    assert.equal(gif.body.reason, "format_not_allowed");
    await admin.json("/api/admin/settings", { method: "POST", body: { conversionsPaused: true } });
    const paused = await internalCall(h, "/internal/v1/authorize", { key, action: "create_job", fmt: "mp3" });
    assert.equal(paused.body.reason, "paused");
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key, action: "access" })).body.allow, true); // le polling reste permis
    assert.equal((await u.json("/api/status")).body.state, "paused");
    await admin.json("/api/admin/settings", { method: "POST", body: { conversionsPaused: false } });
    const uid = (await u.json("/api/me")).body.user.id;
    await admin.json(`/api/admin/users/${uid}/status`, { method: "POST", body: { status: "suspended" } });
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key, action: "access" })).body.reason, "user_suspended");
    await admin.json(`/api/admin/users/${uid}/status`, { method: "POST", body: { status: "active" } });
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key, action: "access" })).body.allow, true);
    await u.json(`/api/keys/${keyId}/revoke`, { method: "POST" }).catch(() => undefined); // session supprimée à la suspension
    h.s.db.prepare("UPDATE apikey SET enabled = 0 WHERE id = ?").run(keyId);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key, action: "access" })).body.reason, "invalid_key");
  } finally { h.close(); }
});

test("quota : exactement N créations sur 25 appels simultanés ; access et refunded ne comptent pas", async () => {
  const { h, u, key } = await setup();
  try {
    for (let i = 0; i < 5; i++) assert.equal((await internalCall(h, "/internal/v1/authorize", { key, action: "access" })).body.allow, true);
    const results = await Promise.all(Array.from({ length: 25 }, () => internalCall(h, "/internal/v1/authorize", { key, action: "create_job", fmt: "mp3", platform: "tiktok" })));
    const allowed = results.filter((r) => r.body.allow);
    const refused = results.filter((r) => !r.body.allow);
    assert.equal(allowed.length, 10);
    assert.ok(refused.every((r) => r.body.reason === "quota_exceeded" && r.body.retry_after_s > 0 && r.body.retry_after_s <= 90_000));
    const me = (await u.json("/api/me")).body;
    assert.deepEqual([me.today.used, me.today.remaining], [10, 0]);
    // un « refunded » rend l'unité
    const id = allowed[0]!.body.usage_id;
    assert.equal((await internalCall(h, `/internal/v1/usage/${id}`, { state: "refunded" })).body.ok, true);
    assert.equal((await u.json("/api/me")).body.today.remaining, 1);
    const again = await internalCall(h, "/internal/v1/authorize", { key, action: "create_job", fmt: "mp4" });
    assert.equal(again.body.allow, true);
    assert.equal(again.body.remaining_today, 0);
  } finally { h.close(); }
});

test("événements d'utilisation : transitions idempotentes, activité sans URL ni titre", async () => {
  const { h, u, key } = await setup();
  try {
    const r = await internalCall(h, "/internal/v1/authorize", { key, action: "create_job", fmt: "mp4", platform: "x" });
    const id = r.body.usage_id;
    assert.equal((await internalCall(h, `/internal/v1/usage/${id}`, { state: "running" })).status, 200);
    assert.equal((await internalCall(h, `/internal/v1/usage/${id}`, { state: "done", size_bytes: 1234 })).status, 200);
    assert.equal((await internalCall(h, `/internal/v1/usage/${id}`, { state: "running" })).status, 200); // ignoré
    assert.equal((await internalCall(h, `/internal/v1/usage/${id}`, { state: "error", error_code: "timeout" })).status, 200); // terminal non écrasé
    const r2 = await internalCall(h, "/internal/v1/authorize", { key, action: "create_job", fmt: "mp3", platform: "youtube" });
    await internalCall(h, `/internal/v1/usage/${r2.body.usage_id}`, { state: "error", error_code: "private" });
    assert.equal((await internalCall(h, "/internal/v1/usage/inexistant123", { state: "done" })).status, 404);
    assert.equal((await internalCall(h, `/internal/v1/usage/${id}`, { state: "bogus" })).status, 400);
    const act = (await u.json("/api/activity")).body;
    assert.equal(act.items.length, 2);
    const done = act.items.find((i: { fmt: string }) => i.fmt === "mp4");
    assert.deepEqual([done.state, done.platform, done.errorCode], ["done", "x", null]);
    const failed = act.items.find((i: { fmt: string }) => i.fmt === "mp3");
    assert.deepEqual([failed.state, failed.errorCode, failed.errorMessage], ["error", "private", "La vidéo est privée."]);
    assert.ok(!JSON.stringify(act).match(/https?:\/\//));
    assert.equal(act.today.used, 1, "l'échec (private) n'est pas décompté du quota");
  } finally { h.close(); }
});

test("administration : réservée aux admins ; limite quotidienne réglable ; état du service", async () => {
  const { h, admin, u, key } = await setup();
  try {
    assert.equal((await u.json("/api/admin/overview")).status, 403);
    assert.equal((await u.json("/api/admin/settings", { method: "POST", body: { conversionsPaused: true } })).status, 403);
    // Forme du contrat docs/ADMIN.md §6 (vue d'ensemble détaillée, listes paginées, réglages séparés).
    const ov = (await admin.json("/api/admin/overview")).body;
    assert.equal(ov.users.total, 2);
    const st = (await admin.json("/api/admin/settings")).body;
    assert.deepEqual([st.conversionsPaused, st.dailyLimit], [false, 10]);
    const users = (await admin.json("/api/admin/users?q=user")).body.items;
    assert.equal(users.length, 1);
    assert.equal(users[0].activeKeys, 1);
    assert.equal((await admin.json("/api/admin/settings", { method: "POST", body: { dailyLimit: 2 } })).body.dailyLimit, 2);
    assert.equal((await admin.json("/api/admin/settings", { method: "POST", body: { dailyLimit: -1 } })).status, 400);
    const a = await Promise.all([1, 2, 3].map(() => internalCall(h, "/internal/v1/authorize", { key, action: "create_job", fmt: "mp3" })));
    assert.equal(a.filter((r) => r.body.allow).length, 2);
    const self = (await admin.json("/api/me")).body.user.id;
    assert.equal((await admin.json(`/api/admin/users/${self}/status`, { method: "POST", body: { status: "suspended" } })).status, 400);
    const events = h.s.db.prepare("SELECT action FROM ytc_admin_event ORDER BY created_at").all() as { action: string }[];
    assert.ok(events.some((e) => e.action === "settings.update"));
    h.ytapiUp.value = false;
    h.s.status.invalidate();
    assert.equal((await u.json("/api/status")).body.state, "down");
    h.ytapiUp.value = true;
    h.s.status.invalidate();
    assert.equal((await u.json("/api/status")).body.state, "ok");
  } finally { h.close(); }
});

test("quota : une conversion en échec n'est jamais décomptée (2026-10-13), registre anti-abus compris", async () => {
  const { h, admin, u, key } = await setup();
  try {
    await admin.json("/api/admin/settings", { method: "POST", body: { dailyLimit: 2 } });
    const auth = (fmt = "mp4") => internalCall(h, "/internal/v1/authorize", { key, action: "create_job", fmt, platform: "youtube" });
    // Trois échecs de suite (YouTube bloque le serveur) : aucune unité consommée.
    for (let i = 0; i < 3; i++) {
      const r = await auth();
      assert.equal(r.body.allow, true, `tentative ${i + 1} autorisée`);
      assert.equal((await internalCall(h, `/internal/v1/usage/${r.body.usage_id}`, { state: "running", job_id: `job-e${i}` })).status, 200);
      assert.equal((await internalCall(h, `/internal/v1/usage/${r.body.usage_id}`, { state: "error", error_code: "bot_check" })).status, 200);
    }
    const act = (await u.json("/api/activity")).body;
    assert.equal(act.today.used, 0);
    assert.equal(act.today.remaining, 2);
    assert.deepEqual(act.items.map((i: { state: string }) => i.state), ["error", "error", "error"], "les échecs restent dans l'historique");
    const ledger = h.s.db.prepare("SELECT used FROM ytc_quota_ledger").get() as { used: number } | undefined;
    assert.equal(ledger?.used ?? 0, 0, "le registre anti-abus rend l'unité aussi");
    // Deux réussites consomment le quota ; la troisième demande est refusée.
    for (let i = 0; i < 2; i++) {
      const r = await auth("mp3");
      await internalCall(h, `/internal/v1/usage/${r.body.usage_id}`, { state: "done", platform: "tiktok" });
    }
    const refused = await auth();
    assert.equal(refused.body.allow, false);
    assert.equal(refused.body.reason, "quota_exceeded");
    // Un échec arrivé APRÈS un état terminal ne rend rien (transitions idempotentes).
    const done = (h.s.db.prepare("SELECT id FROM ytc_usage WHERE state = 'done' LIMIT 1").get() as { id: string }).id;
    await internalCall(h, `/internal/v1/usage/${done}`, { state: "error", error_code: "timeout" });
    assert.equal((await u.json("/api/activity")).body.today.used, 2);
  } finally { h.close(); }
});

test("/api/status : pause YouTube de ytapi exposée (plateforme, cause, fin), sans changer l'état global ; rien si la pause est finie", async () => {
  const { h, u } = await setup();
  try {
    const until = new Date(Date.now() + 14 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    (h.ytapi.status.platforms as Record<string, Record<string, unknown>>).youtube = {
      state: "bot_check", since: "2026-10-12T22:05:13Z", last_success: null, last_error: "bot_check", last_error_at: "2026-10-12T22:05:13Z",
      cooldown_until: until, consecutive_blocks: 1,
    };
    h.s.status.invalidate();
    const st = (await u.json("/api/status")).body;
    assert.equal(st.state, "ok", "le service et les autres plateformes fonctionnent");
    assert.deepEqual(st.pauses, [{ platform: "youtube", reason: "bot_check", until: new Date(until).toISOString() }]);
    assert.ok(!JSON.stringify(st).includes("ne-doit-pas-sortir"), "rien d'autre de l'état interne");
  } finally { h.close(); }
});

test("/api/status : pause terminée (fin passée) ou ytapi injoignable → aucune pause annoncée", async () => {
  const { h, u } = await setup();
  try {
    const platforms = h.ytapi.status.platforms as Record<string, Record<string, unknown>>;
    platforms.youtube = { ...platforms.tiktok, state: "bot_check", cooldown_until: new Date(Date.now() - 1000).toISOString() };
    h.s.status.invalidate();
    assert.deepEqual((await u.json("/api/status")).body.pauses, []);
  } finally { h.close(); }
  const second = await setup();
  try {
    second.h.ytapiUp.value = false;
    second.h.s.status.invalidate();
    const st = (await second.u.json("/api/status")).body;
    assert.deepEqual([st.state, st.pauses], ["down", []]);
  } finally { second.h.close(); }
});
