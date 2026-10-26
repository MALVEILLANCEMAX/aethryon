import { test } from "node:test";
import assert from "node:assert/strict";
import { clampToViewport, defaultPanelPosition, isOffscreen, placePopover, resolvePanelPosition } from "../../src/content/common/geometry.ts";

const vp = { width: 1280, height: 800 };
const panel = { width: 340, height: 58 };

test("panneau : hors écran, bornage, position par défaut (bas gauche)", () => {
  assert.equal(isOffscreen({ x: 16, y: 726 }, panel, vp), false);
  assert.equal(isOffscreen({ x: 1000, y: 10 }, panel, vp), true, "dépasse à droite");
  assert.equal(isOffscreen({ x: -1, y: 10 }, panel, vp), true);
  assert.equal(isOffscreen({ x: 10, y: 790 }, panel, vp), true);
  assert.equal(isOffscreen({ x: Number.NaN, y: 0 }, panel, vp), true);
  assert.deepEqual(clampToViewport({ x: 5000, y: -40 }, panel, vp), { x: 1280 - 340 - 8, y: 8 });
  assert.deepEqual(defaultPanelPosition(panel, vp), { x: 16, y: 800 - 58 - 16 });
  assert.deepEqual(defaultPanelPosition(panel, { width: 320, height: 40 }), { x: 16, y: 16 }, "fenêtre minuscule : jamais négatif");
});

test("panneau : position enregistrée gardée si visible, sinon réinitialisée", () => {
  assert.deepEqual(resolvePanelPosition({ x: 200, y: 300 }, panel, vp), { pos: { x: 200, y: 300 }, reset: false });
  assert.deepEqual(resolvePanelPosition({ x: 2400, y: 300 }, panel, vp), { pos: { x: 16, y: 726 }, reset: true }, "écran externe débranché");
  assert.deepEqual(resolvePanelPosition(null, panel, vp), { pos: { x: 16, y: 726 }, reset: false });
});

test("popover : dessous si la place le permet, sinon dessus ; jamais hors de la fenêtre", () => {
  const pop = { width: 300, height: 320 };
  assert.deepEqual(placePopover({ x: 600, y: 100, width: 120, height: 36 }, pop, vp), { x: 510, y: 144, side: "below" });
  assert.deepEqual(placePopover({ x: 600, y: 600, width: 120, height: 36 }, pop, vp), { x: 510, y: 272, side: "above" });
  assert.equal(placePopover({ x: 1250, y: 100, width: 30, height: 30 }, pop, vp).x, 1280 - 12 - 300, "bord droit");
  assert.equal(placePopover({ x: 0, y: 100, width: 30, height: 30 }, pop, vp).x, 12, "bord gauche");
  const tight = placePopover({ x: 600, y: 200, width: 120, height: 36 }, { width: 300, height: 700 }, vp);
  assert.equal(tight.y, 800 - 12 - 700, "ni dessus ni dessous : collé au bas, visible");
});
