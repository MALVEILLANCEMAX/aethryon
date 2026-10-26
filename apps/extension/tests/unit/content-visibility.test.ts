import { test } from "node:test";
import assert from "node:assert/strict";
import { pickMostVisible, visibleSample } from "../../src/content/common/visibility.ts";

const vp = { width: 1000, height: 800 };
const rect = (top: number, height = 800, left = 300, width = 400) => ({ left, top, right: left + width, bottom: top + height });

test("surface visible : entière, partielle, hors écran", () => {
  assert.equal(visibleSample(rect(0), vp).area, 400 * 800);
  assert.equal(visibleSample(rect(-600), vp).area, 400 * 200);
  assert.equal(visibleSample(rect(900), vp).area, 0);
  assert.equal(visibleSample(rect(0), vp).centerDistance, 0);
});

test("fil TikTok : l'élément le plus visible suit le défilement", () => {
  const items = ["a", "b", "c"];
  const at = (scroll: number) => (id: string) => visibleSample(rect(items.indexOf(id) * 800 - scroll), vp);
  assert.equal(pickMostVisible(items, at(0)), "a");
  assert.equal(pickMostVisible(items, at(300)), "a", "encore majoritairement visible");
  assert.equal(pickMostVisible(items, at(500)), "b");
  assert.equal(pickMostVisible(items, at(1600)), "c");
});

test("égalité : le plus proche du centre ; rien de visible : null", () => {
  const samples: Record<string, { area: number; centerDistance: number }> = { a: { area: 100, centerDistance: 300 }, b: { area: 100, centerDistance: 20 }, c: { area: 0, centerDistance: 0 } };
  assert.equal(pickMostVisible(["a", "b", "c"], (k) => samples[k]!), "b");
  assert.equal(pickMostVisible(["c"], (k) => samples[k]!), null);
  assert.equal(pickMostVisible([], () => ({ area: 1, centerDistance: 0 })), null);
});
