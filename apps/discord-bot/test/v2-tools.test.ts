// « Ouvrir dans AETHRYON Tools » (docs/OUTILS.md) : le bouton n'apparaît que sur la carte PRIVÉE d'un résultat MP4/MP3
// d'origine, quand la fonction est ouverte ; jamais sur un partage public ni sur un fichier dérivé ; un compte qui ne
// répond pas donne la carte habituelle, sans bouton.
import { test } from "node:test";
import assert from "node:assert/strict";
import { featuresOf } from "../src/config.ts";
import { resultCard, sharedCard, type Features } from "../src/v2/ui.ts";
import { ALL, bench, ix, last, MB, settle, SITE, textOf, TIKTOK } from "./fakes-v2.ts";

const F: Features = { ...ALL, tools: true };
const b = { site: SITE, emoji: null };
const meta = { url: TIKTOK, platform: "tiktok", title: "T", creator: "nasa", durationS: 12 };
const base = { meta, fmt: "mp4" as const, jobId: "job-1", owner: "1", title: "T", sizeBytes: 3 * MB, shareAllowed: true,
  attachment: { name: "a.mp4", type: "video/mp4" }, toolsUrl: `${SITE}/outils/studio#ref=${"r".repeat(43)}` };
const urls = (card: unknown) => [...JSON.stringify(card).matchAll(/"url":"([^"]+)"/g)].map((m) => m[1]);

test("carte privée : « Ouvrir dans Tools » (lien avec le jeton après #), avant « Source » ; fonction fermée : aucun bouton", () => {
  const card = resultCard(b, base, F);
  assert.match(JSON.stringify(card), /"label":"Ouvrir dans Tools"/);
  const links = urls(card);
  assert.ok(links.includes(base.toolsUrl));
  assert.ok(links.indexOf(base.toolsUrl) < links.indexOf(TIKTOK), "« Source » reste le dernier bouton");
  assert.doesNotMatch(JSON.stringify(resultCard(b, base, { ...F, tools: false })), /Ouvrir dans Tools/);
  assert.doesNotMatch(JSON.stringify(sharedCard(b, base, "1", F)), /Ouvrir dans Tools|outils\/studio/, "jamais en public");
});

test("conversion réelle : le lien est demandé à account pour CE job ; un compte injoignable donne la carte sans bouton", async () => {
  const B = bench(F);
  B.acc.state.files.set("job-1", { bytes: Buffer.alloc(MB, 1), name: "Lancement [abc].mp4", type: "video/mp4" });
  const i = ix("command", { commandName: "convert", opts: { url: TIKTOK, format: "mp4" } });
  await B.router.handle(i);
  for (let k = 0; k < 60 && !i.calls.some((c) => c.m === "edit" && /MÉDIA PRÊT/.test(textOf(c.r))); k++) await settle();
  assert.ok(B.acc.state.calls.includes("outils:job-1"), B.acc.state.calls.join(","));
  assert.match(JSON.stringify(last(i, "edit").r), /Ouvrir dans Tools/);
  const C = bench(F);
  C.acc.api.toolsLink = async () => { throw new Error("injoignable"); };
  C.acc.state.files.set("job-1", { bytes: Buffer.alloc(MB, 1), name: "Lancement [abc].mp4", type: "video/mp4" });
  const j = ix("command", { commandName: "convert", opts: { url: TIKTOK, format: "mp4" } });
  await C.router.handle(j);
  for (let k = 0; k < 60 && !j.calls.some((c) => c.m === "edit" && /MÉDIA PRÊT/.test(textOf(c.r))); k++) await settle();
  const final = JSON.stringify(last(j, "edit").r);
  assert.match(final, /MÉDIA PRÊT/);
  assert.doesNotMatch(final, /Ouvrir dans Tools/);
});

test("TOOLS_ENABLED=1 exige CONVERT_ENABLED=1", () => {
  assert.throws(() => featuresOf({ TOOLS_ENABLED: "1" } as NodeJS.ProcessEnv), /TOOLS_ENABLED=1 exige CONVERT_ENABLED=1/);
  assert.equal(featuresOf({ LINK_ENABLED: "1", CONVERT_ENABLED: "1", TOOLS_ENABLED: "1" } as NodeJS.ProcessEnv).tools, true);
});
