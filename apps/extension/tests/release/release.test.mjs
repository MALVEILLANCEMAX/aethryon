// Paquet distribué (release/) : reproductible au bit près, autonome et propre, identifiant stable, latest.json
// au schéma exact, SHA256SUMS au format sha256sum.
//   npm run test:release      (construit deux fois la version de production dans des dossiers temporaires)
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { changelogEntry, extensionIdFromKey, RELEASE_ID } from "../../scripts/zip.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const NAME = `aethryon-extension-${pkg.version}.zip`;
const tmp = mkdtempSync(join(tmpdir(), "aethryon-release-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

function release(tag) {
  const dist = join(tmp, `dist-${tag}`);
  const out = join(tmp, `release-${tag}`);
  execFileSync(process.execPath, [join(ROOT, "scripts/build.mjs"), "--target=prod", `--out=${dist}`], { cwd: ROOT, stdio: "pipe" });
  execFileSync(process.execPath, [join(ROOT, "scripts/zip.mjs"), `--dist=${dist}`, `--out=${out}`], { cwd: ROOT, stdio: "pipe" });
  const zip = readFileSync(join(out, NAME));
  return { dist, out, zip, sha: createHash("sha256").update(zip).digest("hex") };
}

/** Lecture du répertoire central d'un ZIP (sans dépendance) : en-têtes bruts et contenu décompressé. */
function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "fin de répertoire central");
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const e = {
      madeBy: buf.readUInt16LE(p + 4), flags: buf.readUInt16LE(p + 8), method: buf.readUInt16LE(p + 10), time: buf.readUInt16LE(p + 12),
      date: buf.readUInt16LE(p + 14), compSize: buf.readUInt32LE(p + 20), size: buf.readUInt32LE(p + 24), nameLen: buf.readUInt16LE(p + 28),
      extraLen: buf.readUInt16LE(p + 30), commentLen: buf.readUInt16LE(p + 32), attrs: buf.readUInt32LE(p + 38), offset: buf.readUInt32LE(p + 42),
    };
    e.name = buf.toString("utf8", p + 46, p + 46 + e.nameLen);
    const lh = e.offset;
    assert.equal(buf.readUInt32LE(lh), 0x04034b50);
    e.localExtra = buf.readUInt16LE(lh + 28);
    const start = lh + 30 + buf.readUInt16LE(lh + 26) + e.localExtra;
    const raw = buf.subarray(start, start + e.compSize);
    e.data = e.method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    entries.push(e);
    p += 46 + e.nameLen + e.extraLen + e.commentLen;
  }
  return entries;
}

const A = release("a");
const B = release("b");

test("reproductible : deux constructions du même commit → même ZIP, même SHA-256", () => {
  assert.equal(A.sha, B.sha);
  assert.ok(A.zip.equals(B.zip));
  assert.equal(readFileSync(join(A.out, "latest.json"), "utf8"), readFileSync(join(B.out, "latest.json"), "utf8"));
});

test("ZIP : entrées triées, date fixe 1980-01-01 00:00, droits 0644, aucun champ supplémentaire, aucun dossier", () => {
  const entries = readZip(A.zip);
  const names = entries.map((e) => e.name);
  assert.deepEqual(names, [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  for (const e of entries) {
    assert.equal(e.date, 0x0021, `${e.name} : date`);
    assert.equal(e.time, 0, `${e.name} : heure`);
    assert.equal(e.attrs >>> 16, 0o100644, `${e.name} : droits`);
    assert.equal(e.extraLen + e.localExtra + e.commentLen, 0, `${e.name} : champs supplémentaires`);
    assert.equal(e.madeBy >> 8, 3, `${e.name} : créé sous Unix`);
    assert.ok(!e.name.endsWith("/"), "aucun dossier");
    assert.ok([0, 8].includes(e.method));
  }
});

test("autonome et propre : manifeste + tout le nécessaire ; ni sources, ni cartes, ni tests, ni secrets, ni adresses de test", () => {
  const entries = readZip(A.zip);
  const names = entries.map((e) => e.name);
  for (const need of ["manifest.json", "background.js", "content/youtube.js", "content/tiktok.js", "content/x.js", "popup/popup.html", "popup/popup.js", "popup/popup.css",
    "options/options.html", "options/options.js", "options/options.css", "welcome/welcome.html", "welcome/welcome.js", "welcome/welcome.css",
    "assets/icons/icon-16.png", "assets/icons/icon-32.png", "assets/icons/icon-48.png", "assets/icons/icon-128.png", "assets/fonts/inter.woff2",
    "assets/fonts/playfair.woff2", "assets/fonts/LICENSE-Inter.txt", "assets/fonts/LICENSE-PlayfairDisplay.txt"]) {
    assert.ok(names.includes(need), `fichier attendu : ${need}`);
  }
  assert.equal(names.length, 22, `aucun fichier en trop : ${names.join(", ")}`);
  for (const e of entries) {
    assert.doesNotMatch(e.name, /\.(ts|map|mjs)$|tests?\/|src\/|\.keys|node_modules/, e.name);
    if (/\.(js|html|css|json)$/.test(e.name)) {
      const t = e.data.toString("utf8");
      // Aucune trace de développement : adresses et libellés de préproduction, cartes de sources, domaines de test,
      // identifiant de développement, clé privée, chemins de la machine de construction, journal de débogage.
      for (const re of [/localhost/i, /127\.0\.0\.1/, /pr[eé]prod/i, /sourceMappingURL/, /(@|\/\/)[a-z0-9.-]+\.test\b/i, /dnllfjakdgmgfiompaheickmbjjlgjdc/,
        /BEGIN [A-Z ]*PRIVATE KEY/, /\/(tmp|root|home)\//, /scratchpad|node_modules/, /console\.(log|debug|info)\(/, /\bdebugger\b/]) {
        assert.doesNotMatch(t, re, `${e.name} : ${re}`);
      }
      // Aucun tracé de logo de marque (docs/MARQUES.md ; mêmes signatures que web/scripts/check-dist.mjs).
      for (const sig of ["M23.498 6.186", "M12.525.02c1.31", "M14.234 10.162"]) assert.ok(!t.includes(sig), `${e.name} : tracé de logo de marque ${sig}`);
    }
  }
  // Pictogrammes neutres v3 (les mêmes que le site) dans chaque surface : popup, réglages, accueil, boutons des pages.
  for (const f of ["popup/popup.js", "options/options.js", "welcome/welcome.js", "content/youtube.js", "content/tiktok.js", "content/x.js"]) {
    const t = entries.find((e) => e.name === f).data.toString("utf8");
    for (const sig of ["M6.2 15h11.6", "M5.1 16.4V7.3", "M10.7 7.9h5.6"]) assert.ok(t.includes(sig), `${f} : pictogramme v3 ${sig}`);
  }
  // Icônes : celles de l'identité V1 (brand/master/png), octet pour octet, PNG RVBA 8 bits aux dimensions annoncées.
  for (const s of [16, 32, 48, 128]) {
    const icon = entries.find((e) => e.name === `assets/icons/icon-${s}.png`).data;
    assert.ok(icon.equals(readFileSync(join(ROOT, "../../packages/brand/master/png", `aethryon-extension-${s}.png`))), `icône ${s} px`);
    assert.ok(icon.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `icône ${s} px : PNG`);
    assert.deepEqual([icon.readUInt32BE(16), icon.readUInt32BE(20), icon[24], icon[25]], [s, s, 8, 6], `icône ${s} px : ${s}×${s}, 8 bits, RVBA`);
  }
});

test("manifeste : identifiant stable necpohicddjeaeaaomaakehcbccapabg, version 3.8.1, permissions minimales exactes", () => {
  const m = JSON.parse(readZip(A.zip).find((e) => e.name === "manifest.json").data.toString("utf8"));
  assert.equal(extensionIdFromKey(m.key), RELEASE_ID);
  assert.equal(RELEASE_ID, "necpohicddjeaeaaomaakehcbccapabg");
  assert.equal(m.name, "AETHRYON");
  assert.equal(m.version, pkg.version);
  assert.equal(m.version, "3.8.1");
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.permissions, ["storage", "downloads", "identity", "alarms", "activeTab"]);
  // 3.5.2 : nativeMessaging facultative (lien local avec AETHRYON Desktop, demandée au choix « Premiere Pro »).
  assert.deepEqual(m.optional_permissions, ["notifications", "nativeMessaging"]);
  assert.deepEqual(m.host_permissions, ["https://api.malvu.fr/*", "https://raccourci.malvu.fr/*"]);
  assert.deepEqual(m.content_scripts.map((c) => c.matches).flat(), ["https://www.youtube.com/*", "https://m.youtube.com/*", "https://www.tiktok.com/*", "https://x.com/*", "https://twitter.com/*", "https://mobile.twitter.com/*"]);
  // YouTube Music (music.youtube.com) fermé le 2026-10-23 : ni script injecté, ni permission d'hôte, ni joker *.youtube.com.
  assert.equal(/music\.youtube|youtubemusic/i.test(JSON.stringify(m)), false, "aucune mention de YouTube Music dans le manifeste");
  assert.equal(/\*\.youtube|youtube\.com\/\*/.test(JSON.stringify(m.host_permissions)), false);
  assert.equal(m.web_accessible_resources, undefined);
  assert.equal(m.externally_connectable, undefined);
  assert.equal(m.update_url, undefined, "aucune mise à jour automatique (installation hors store)");
  // Pages de l'extension : scripts du paquet seulement, aucun objet, aucune base, jamais dans un cadre.
  assert.deepEqual(m.content_security_policy, { extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
  // Chrome 140 : première version où storage.local.setAccessLevel protège le jeton (scripts/build.mjs).
  assert.equal(m.minimum_chrome_version, "140");
  // Libellé de version (chrome://extensions) : aucun depuis que l'extension est publique (2026-10-18) ; jamais
  // celui de la préproduction, jamais « bêta ».
  assert.equal(m.version_name, undefined);
  for (const e of readZip(A.zip).filter((x) => /\.(js|html|json)$/.test(x.name))) assert.doesNotMatch(e.data.toString("utf8"), /bêta|pr[eé]production/, e.name);
  assert.deepEqual(Object.keys(m.icons), ["16", "32", "48", "128"]);
  assert.deepEqual(m.action.default_icon, { 16: "assets/icons/icon-16.png", 32: "assets/icons/icon-32.png" });
  assert.equal(m.background.type, "module");
  assert.deepEqual(m.options_ui, { page: "options/options.html", open_in_tab: true });
});

test("latest.json : schéma exact (clés et ordre), valeurs du ZIP et du journal des versions ; SHA256SUMS au format sha256sum", () => {
  const latest = JSON.parse(readFileSync(join(A.out, "latest.json"), "utf8"));
  assert.deepEqual(Object.keys(latest), ["version", "file", "sha256", "size", "released", "minChrome", "notes"]);
  const entry = changelogEntry(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"), pkg.version);
  assert.deepEqual(latest, { version: pkg.version, file: NAME, sha256: A.sha, size: A.zip.length, released: entry.released, minChrome: 140, notes: entry.notes });
  assert.match(latest.released, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(latest.notes.length >= 3 && latest.notes.every((n) => typeof n === "string" && n.length < 200));
  assert.equal(readFileSync(join(A.out, "SHA256SUMS"), "utf8"), `${A.sha}  ${NAME}\n`);
  execFileSync("sha256sum", ["-c", "SHA256SUMS"], { cwd: A.out, stdio: "pipe" });
});

test("paquet refusé pour un build de développement (mauvaise clé, mauvais nom)", () => {
  const dev = join(tmp, "dist-dev");
  execFileSync(process.execPath, [join(ROOT, "scripts/build.mjs"), "--target=dev", `--out=${dev}`], { cwd: ROOT, stdio: "pipe" });
  assert.throws(() => execFileSync(process.execPath, [join(ROOT, "scripts/zip.mjs"), `--dist=${dev}`, `--out=${join(tmp, "release-dev")}`], { cwd: ROOT, stdio: "pipe" }));
  assert.throws(() => execFileSync(process.execPath, [join(ROOT, "scripts/build.mjs"), "--target=store"], { cwd: ROOT, stdio: "pipe" }), "cible « store » supprimée");
});
