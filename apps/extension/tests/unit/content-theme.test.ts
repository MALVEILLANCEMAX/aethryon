import { test } from "node:test";
import assert from "node:assert/strict";
import { DARK_LUMINANCE, parseCssColor, relativeLuminance, themeFromBackgrounds } from "../../src/content/common/theme.ts";

test("parseCssColor : formats renvoyés par getComputedStyle et notations courantes", () => {
  assert.deepEqual(parseCssColor("rgb(255, 255, 255)"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseCssColor("rgba(0, 0, 0, 0)"), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepEqual(parseCssColor("rgba(15, 20, 25, 0.75)"), { r: 15, g: 20, b: 25, a: 0.75 });
  assert.deepEqual(parseCssColor("rgb(21 32 43 / 50%)"), { r: 21, g: 32, b: 43, a: 0.5 });
  assert.deepEqual(parseCssColor("rgb(100% 0% 0%)"), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseCssColor("#0f0f0f"), { r: 15, g: 15, b: 15, a: 1 });
  assert.deepEqual(parseCssColor("#FFF"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseCssColor("#00000080"), { r: 0, g: 0, b: 0, a: 128 / 255 });
  assert.deepEqual(parseCssColor("transparent"), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepEqual(parseCssColor("color(srgb 1 1 1)"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseCssColor("  RGB(1, 2, 3)  "), { r: 1, g: 2, b: 3, a: 1 });
  for (const bad of ["", "red", "rgb(1, 2)", "rgb(a, b, c)", "url(x)", "#12", "hsl(0 0% 0%)", "color(display-p3 1 1 1)", null, undefined]) {
    assert.equal(parseCssColor(bad), null, String(bad));
  }
});

test("luminance relative WCAG", () => {
  assert.equal(relativeLuminance({ r: 255, g: 255, b: 255 }), 1);
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
  const gray = relativeLuminance({ r: 119, g: 119, b: 119 });
  assert.ok(gray > 0.17 && gray < 0.2, String(gray));
});

test("thème : premier fond opaque (transparent ignoré), fonds réels des plateformes", () => {
  const dark = [
    ["rgb(15, 15, 15)"],                     // YouTube sombre
    ["rgb(0, 0, 0)"],                        // X « Lights out »
    ["rgb(21, 32, 43)"],                     // X « Dim »
    ["rgba(0, 0, 0, 0)", "rgb(18, 18, 18)"], // body transparent, html sombre (TikTok)
  ];
  for (const c of dark) assert.equal(themeFromBackgrounds(c), "dark", c.join(" | "));
  const light = [
    ["rgb(255, 255, 255)"],
    ["rgba(0, 0, 0, 0)", "rgb(249, 249, 249)"],
    ["rgb(240, 240, 240)"],
    ["rgba(0, 0, 0, 0.3)", "rgb(255, 255, 255)"], // trop transparent : on regarde plus loin
  ];
  for (const c of light) assert.equal(themeFromBackgrounds(c), "light", c.join(" | "));
  assert.equal(themeFromBackgrounds([]), "light");
  assert.equal(themeFromBackgrounds(["n'importe quoi", null]), "light");
  assert.equal(themeFromBackgrounds(["transparent"], "dark"), "dark");
  assert.ok(DARK_LUMINANCE > 0 && DARK_LUMINANCE < 0.5);
});
