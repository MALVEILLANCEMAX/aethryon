import { test } from "node:test";
import assert from "node:assert/strict";
import { displayMode, planDisplay } from "../../src/content/common/policy.ts";
import { DEFAULT_SETTINGS } from "../../src/shared/types.ts";

const s = (patch: Partial<typeof DEFAULT_SETTINGS> = {}) => ({ ...DEFAULT_SETTINGS, platforms: { ...DEFAULT_SETTINGS.platforms }, ...patch });
const t = (key: string, anchor: boolean) => ({ key, anchor: anchor ? {} : null });

test("mode d'affichage selon les réglages", () => {
  assert.equal(displayMode(null, "youtube"), "off", "réglages pas encore lus");
  assert.equal(displayMode(s(), "youtube"), "inline");
  assert.equal(displayMode(s({ platforms: { youtube: false, tiktok: true, twitter: true } }), "youtube"), "off");
  assert.equal(displayMode(s({ platforms: { youtube: false, tiktok: true, twitter: true } }), "tiktok"), "inline");
  assert.equal(displayMode(s({ inlineButtons: false }), "twitter"), "off");
  assert.equal(displayMode(s({ floatingPanel: true }), "twitter"), "panel");
  assert.equal(displayMode(s({ floatingPanel: true, inlineButtons: false }), "twitter"), "panel");
});

test("une seule commande par vidéo : clés dédoublonnées, cibles sans ancrage exclues", () => {
  const plan = planDisplay("inline", [t("twitter:1", true), t("twitter:1", true), t("twitter:2", false), t("twitter:3", true)], null, null, 0, 2500);
  assert.deepEqual(plan.inline.map((x) => x.key), ["twitter:1", "twitter:3"]);
  assert.equal(plan.panel, null);
});

test("panneau de secours : seulement après le délai, pour la vidéo courante sans ancrage", () => {
  const p = t("youtube:abc", false);
  const first = planDisplay("inline", [p], p, null, 1000, 2500);
  assert.equal(first.panel, null);
  assert.equal(first.recheckAt, 3500);
  assert.deepEqual(first.missing, { key: "youtube:abc", since: 1000 });
  const still = planDisplay("inline", [p], p, first.missing, 3000, 2500);
  assert.equal(still.panel, null);
  const later = planDisplay("inline", [p], p, still.missing, 3500, 2500);
  assert.equal(later.panel, p);
  assert.equal(later.recheckAt, null);
  // Autre vidéo : le délai repart de zéro.
  const q = t("youtube:def", false);
  const other = planDisplay("inline", [q], q, later.missing, 4000, 2500);
  assert.equal(other.panel, null);
  assert.deepEqual(other.missing, { key: "youtube:def", since: 4000 });
  // L'ancrage apparaît : plus de panneau, bouton intégré.
  const found = t("youtube:def", true);
  const ok = planDisplay("inline", [found], found, other.missing, 4100, 2500);
  assert.deepEqual([ok.panel, ok.missing, ok.inline.length], [null, null, 1]);
});

test("panneau forcé : la vidéo courante est dans le panneau, jamais aussi en bouton intégré", () => {
  const p = t("tiktok:1", true);
  const plan = planDisplay("panel", [p, t("tiktok:2", true)], p, null, 0, 2500);
  assert.equal(plan.panel, p);
  assert.deepEqual(plan.inline, []);
  const fallback = planDisplay("inline", [t("x:1", true), t("x:2", false)], t("x:2", false), { key: "x:2", since: 0 }, 9999, 2500);
  assert.equal(fallback.panel?.key, "x:2");
  assert.deepEqual(fallback.inline.map((x) => x.key), ["x:1"]);
});

test("mode désactivé : rien", () => {
  const p = t("youtube:abc", true);
  assert.deepEqual(planDisplay("off", [p], p, { key: "youtube:abc", since: 0 }, 0, 2500), { inline: [], panel: null, missing: null, recheckAt: null });
});
