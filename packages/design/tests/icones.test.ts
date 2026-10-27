// Icônes maison (aucune marque), chouette maître, polices et licences.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ICONES, NOMS_ICONES, balisageIcone, spriteIcones } from "../src/icones.ts";
import { STATUTS_PLATEFORME } from "../src/dom/composants.ts";

const ICI = import.meta.dirname;
const DEPOT = join(ICI, "../../..");

test("jeu maison : aucune icône nommée d'après une marque, formes simples seulement", () => {
  const marques = /youtube|tiktok|twitter|^x$|spotify|deezer|apple|iphone|android|adobe|premiere|discord|chrome|instagram|facebook|bluesky|wikimedia|google|microsoft|windows/i;
  assert.ok(NOMS_ICONES.length >= 55);
  for (const n of NOMS_ICONES) {
    assert.ok(!marques.test(n), `nom de marque : ${n}`);
    for (const [tag, a] of ICONES[n]) {
      assert.ok(["path", "circle", "rect"].includes(tag), `${n} : ${tag}`);
      for (const [k, v] of Object.entries(a)) {
        assert.match(k, /^[a-z-]+$/);
        assert.ok(!/url|javascript|<|>|"/i.test(v), `${n} : ${k}=${v}`);
      }
    }
  }
  assert.ok(!/(href|xlink|<script|<image|url\()/i.test(spriteIcones()));
  assert.match(balisageIcone("lien"), /^<path d="/);
});

test("les sept pictogrammes du catalogue des plateformes existent (champ « icone »)", () => {
  const catalogue = JSON.parse(readFileSync(join(DEPOT, "apps/media-api/app/plateformes.json"), "utf8")) as { icones: Record<string, string>; plateformes: { icone: string }[] };
  for (const k of Object.keys(catalogue.icones)) assert.ok((NOMS_ICONES as string[]).includes(k), `icône de catalogue absente : ${k}`);
  for (const p of catalogue.plateformes) assert.ok((NOMS_ICONES as string[]).includes(p.icone), p.icone);
  for (const s of Object.values(STATUTS_PLATEFORME)) assert.ok((NOMS_ICONES as string[]).includes(s.icone));
});

test("chouette : le fichier maître brand/master, octet pour octet", () => {
  const h = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
  assert.equal(h(join(ICI, "../assets/aethryon-master.svg")), h(join(DEPOT, "packages/brand/master/aethryon-master.svg")));
});

test("polices OFL : trois fichiers, une licence chacune, déclarées une seule fois dans egide.css", () => {
  const fonts = readdirSync(join(ICI, "../fonts"));
  const woff2 = fonts.filter((f) => f.endsWith(".woff2"));
  assert.equal(woff2.length, 3);
  for (const f of ["marcellus", "hanken-grotesk", "geist-mono"]) {
    const lic = join(ICI, `../fonts/LICENSE-${f}.txt`);
    assert.ok(existsSync(lic));
    assert.match(readFileSync(lic, "utf8"), /SIL OPEN FONT LICENSE/i);
  }
  const css = readFileSync(join(ICI, "../genere/egide.css"), "utf8");
  assert.equal((css.match(/@font-face \{/g) ?? []).length, 3);
  for (const f of woff2) assert.equal(css.split(f).length - 1, 1, `${f} référencé une fois`);
  const shadow = readFileSync(join(ICI, "../genere/egide-shadow.css"), "utf8");
  assert.equal((shadow.match(/@font-face \{/g) ?? []).length, 0);
  assert.ok(!shadow.includes(":root"));
});
