// Identité V1 dans l'extension : UNE seule tête (brand/master), générée — jamais copiée à la main — et les
// mêmes valeurs que le site ; petit logo jusqu'à 24 px ; aucune dépendance aux anciennes images du kit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ext from "../../src/shared/brand-head.ts";
import * as webHead from "../../../web/src/ui/brand/head.ts";
import * as webWordmark from "../../../web/src/ui/brand/wordmark.ts";
import { isSmallOwl } from "../../src/shared/owl.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO = join(ROOT, "..");

test("tête et logotype de l'extension = ceux du site (même source brand/master), en-tête « GÉNÉRÉ — ne pas modifier »", () => {
  assert.deepEqual(ext.HEAD, webHead.HEAD);
  assert.deepEqual(ext.SMALL, webHead.SMALL);
  assert.equal(ext.RIM, webHead.RIM);
  assert.deepEqual(ext.WORDMARK, webWordmark.WORDMARK);
  const src = readFileSync(join(ROOT, "src/shared/brand-head.ts"), "utf8");
  assert.ok(src.startsWith("// GÉNÉRÉ — ne pas modifier."));
});

test("modules générés à jour : export_web.py --check (régénération sans écart)", () => {
  const out = execFileSync("python3", ["-I", join(REPO, "../packages/brand/master/tools/export_web.py"), "--check"], { encoding: "utf8" });
  assert.match(out, /à jour/);
});

test("petit logo de 16 à 24 px (tête réelle, marge exclue), maître au-delà", () => {
  assert.equal(isSmallOwl(16), true);
  assert.equal(isSmallOwl(24), true);
  assert.equal(isSmallOwl(26), false);
  assert.equal(isSmallOwl(33, 12.4), true, "mascotte de 33 px : tête de 23,8 px");
  assert.equal(isSmallOwl(60, 12.4), false);
});

test("aucune trace de l'ancienne identité : ni images 3D du kit, ni web/public, ni tête recopiée", () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
  walk(join(ROOT, "src"));
  walk(join(ROOT, "scripts"));
  for (const f of files.filter((x) => /\.(ts|mjs|html|css)$/.test(x))) {
    const s = readFileSync(f, "utf8");
    assert.doesNotMatch(s, /three-quarter|\.webp|web\/public|owl-head(-\d+)?\.(svg|png)|OWL_SHAPES/, f);
  }
  const build = readFileSync(join(ROOT, "scripts/build.mjs"), "utf8");
  assert.match(build, /brand", "master", "png"/);
  assert.match(build, /aethryon-extension-\$\{s\}\.png/);
});

test("pictogrammes des plateformes : les mêmes tracés neutres v3 que le site, aucun tracé de logo de marque (docs/MARQUES.md)", () => {
  const icons = readFileSync(join(ROOT, "src/shared/icons.ts"), "utf8");
  const site = readFileSync(join(REPO, "web/src/ui/brand/PlatformGlyph.tsx"), "utf8");
  const GEOMETRY = ["x", "y", "width", "height", "rx", "cx", "cy", "r", "d"];
  const shapes = [...icons.matchAll(/\{ tag: "(rect|path|circle)", a: \{([^}]*)\}/g)];
  assert.equal(shapes.length, 11, "4 formes YouTube, 3 TikTok, 4 X");
  for (const [, tag, body] of shapes) {
    const attrs = [...body!.matchAll(/(?:"([\w-]+)"|(\w+)): "([^"]*)"/g)].map((m) => [m[1] ?? m[2], m[3]] as const).filter(([k]) => GEOMETRY.includes(k!));
    const sig = attrs.map(([k, v]) => `${k}="${v}"`).join(" ");
    assert.ok(site.includes(`<${tag} ${sig}`), `forme absente du site : <${tag} ${sig}>`);
  }
  // Signatures des logos YouTube, TikTok et X (Simple Icons), comme web/scripts/check-dist.mjs et scripts/build.mjs.
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
  walk(join(ROOT, "src"));
  for (const f of files.filter((x) => /\.(ts|html|css|json)$/.test(x))) {
    const s = readFileSync(f, "utf8");
    for (const sig of ["M23.498 6.186", "M12.525.02c1.31", "M14.234 10.162"]) assert.ok(!s.includes(sig), `${f} : tracé de logo de marque`);
  }
});
