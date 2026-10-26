import { test } from "node:test";
import assert from "node:assert/strict";
import { describeJob, describeSending, IDLE } from "../../src/content/common/job.ts";
import { JobStore } from "../../src/content/common/store.ts";

test("état par vidéo, indépendant de l'affichage : abonnements, clé de job, désabonnement", () => {
  const store = new JobStore();
  assert.equal(store.get("youtube:abc").display, IDLE);
  const seen: string[] = [];
  const off = store.subscribe("youtube:abc", (s) => seen.push(s.display.phase));
  store.set("youtube:abc", { display: describeSending() });
  store.set("youtube:abc", { jobKey: "jobkey000001", display: describeJob({ state: "queued" }) });
  assert.equal(store.mediaKeyForJob("jobkey000001"), "youtube:abc");
  off();
  store.set("youtube:abc", { display: describeJob({ state: "done" }) });
  assert.deepEqual(seen, ["sending", "queued"]);
  // Une nouvelle commande pour la même vidéo retrouve l'état (navigation, nœud recyclé, panneau).
  assert.equal(store.get("youtube:abc").display.phase, "done");
  assert.equal(store.get("youtube:abc").jobKey, "jobkey000001");
});

test("mémoire bornée : les vieux états terminés sont oubliés, jamais ceux en cours ni ceux affichés", () => {
  const store = new JobStore();
  store.set("busy", { display: describeJob({ state: "converting", progress: 10 }) });
  store.subscribe("shown", () => {});
  store.set("shown", { display: describeJob({ state: "done" }) });
  for (let i = 0; i < 100; i++) store.set(`v${i}`, { jobKey: `jobkey${String(i).padStart(6, "0")}`, display: describeJob({ state: "done" }) });
  assert.equal(store.get("busy").display.phase, "converting");
  assert.equal(store.get("shown").display.phase, "done");
  assert.equal(store.get("v0").display.phase, "idle", "le plus ancien est oublié");
  assert.equal(store.mediaKeyForJob("jobkey000000"), undefined);
  assert.equal(store.get("v99").display.phase, "done");
});
