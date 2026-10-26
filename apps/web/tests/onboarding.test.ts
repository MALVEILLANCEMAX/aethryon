// Guide « Bien démarrer » (src/lib/onboarding.ts) : seuls les jetons du RACCOURCI comptent pour les étapes
// du raccourci ; une clé d'extension navigateur, même utilisée, ne coche rien et n'apparaît pas comme
// « raccourci relié ».   node --test web/tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveGuide, isShortcutKey } from "../src/lib/onboarding.ts";
import type { ActivityItem, ApiKey } from "../src/lib/types.ts";

const key = (over: Partial<ApiKey>): ApiKey => ({
  id: "k1", name: "iPhone", start: "ytc_ab", createdAt: "2026-10-11T08:00:00.000Z", lastUsedAt: null, expiresAt: null, revokedAt: null,
  status: "active", kind: "shortcut", deviceLabel: null, ...over,
});
const ext = (over: Partial<ApiKey> = {}): ApiKey => key({ id: "e1", name: "Extension Chrome · Chrome · Windows", kind: "extension", deviceLabel: "Chrome · Windows", ...over });
const item = (over: Partial<ActivityItem> = {}): ActivityItem => ({
  id: "a1", createdAt: "2026-10-11T09:00:00.000Z", finishedAt: "2026-10-11T09:00:10.000Z", fmt: "mp4", platform: "youtube", state: "done", errorCode: null, errorMessage: null, ...over,
});

test("une clé d'extension utilisée, seule : aucune étape du raccourci n'est cochée, aucun « raccourci relié »", () => {
  const g = deriveGuide([ext({ lastUsedAt: "2026-10-11T09:00:00.000Z" })], []);
  assert.deepEqual(g.steps, { acces: "current", raccourci: "todo", conversion: "todo", activite: "todo" });
  assert.equal(g.usedKey, null);
  assert.deepEqual(g.activeKeys, []);
  assert.equal(g.noActiveKey, false);
  assert.deepEqual(g.sub, { create: "current", copy: "todo", install: "todo" });
});

test("jeton du raccourci utilisé + clé d'extension plus récente : c'est le jeton du raccourci qui relie l'iPhone", () => {
  const g = deriveGuide([
    key({ lastUsedAt: "2026-10-11T08:30:00.000Z" }),
    ext({ lastUsedAt: "2026-10-11T10:00:00.000Z" }),
  ], [item()]);
  assert.equal(g.usedKey?.id, "k1");
  assert.deepEqual(g.activeKeys.map((k) => k.id), ["k1"]);
  assert.equal(g.steps.raccourci, "done");
  assert.equal(g.ready, true);
});

test("conversions faites par l'extension : comptées dans l'activité, mais le raccourci reste à installer", () => {
  const g = deriveGuide([ext({ lastUsedAt: "2026-10-11T09:00:00.000Z" })], [item()]);
  assert.deepEqual(g.steps, { acces: "done", raccourci: "current", conversion: "done", activite: "done" });
  assert.equal(g.ready, false);
});

test("clé sans `kind` (serveur d'avant l'extension) : jeton du raccourci", () => {
  assert.equal(isShortcutKey({ kind: undefined as unknown as "shortcut" }), true);
  assert.equal(isShortcutKey({ kind: "extension" }), false);
});
