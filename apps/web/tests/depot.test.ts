// Versions du dépôt officiel (page /open-source) : lecture du CHANGELOG.md et des releases GitHub, sans rien inventer ;
// texte des notes ; dates ; version d'un fichier publié.
//   node --test web/tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blocks, parseChangelog, parseReleases } from "../scripts/depot-notes.mjs";
import { dateLongue, depotNotes, inline, versionDuFichier } from "../src/lib/github.ts";

const NB = " ";

test("CHANGELOG : versions numérotées seulement, « Unreleased » ignorée, date et titre lus", () => {
  const md = `# Changelog\n\nIntro.\n\n## [Unreleased]\n\n### Added\n\n- Something not released yet\n\n## [0.2.0-beta.1] — 2026-11-02\n\n### Fixed\n\n- A bug\n  on two lines\n\n## [0.1.0] — 2026-10-26 — First source release (private preview)\n\nText.\n\n| A | B |\n|---|---|\n| x | y |\n\n### Added\n\n- One\n- Two\n`;
  const e = parseChangelog(md);
  assert.deepEqual(e.map((x) => x.version), ["0.2.0-beta.1", "0.1.0"]);
  assert.equal(e[0]!.date, "2026-11-02");
  assert.equal(e[0]!.title, null);
  assert.equal(e[0]!.prerelease, true);
  assert.deepEqual(e[0]!.blocks, [{ t: "h", text: "Fixed" }, { t: "li", text: "A bug on two lines" }]);
  assert.equal(e[1]!.title, "First source release (private preview)");
  assert.equal(e[1]!.prerelease, true, "« preview » dans le titre : pré-version");
  assert.deepEqual(e[1]!.blocks, [{ t: "p", text: "Text." }, { t: "h", text: "Added" }, { t: "li", text: "One" }, { t: "li", text: "Two" }]);
});

test("CHANGELOG gardé avec le site : au moins une version réelle, aucune « Unreleased »", () => {
  const e = parseChangelog(readFileSync(new URL("../src/data/depot/CHANGELOG.md", import.meta.url), "utf8"));
  assert.ok(e.length >= 1);
  assert.ok(e.every((x) => /^\d+\.\d+\.\d+/.test(x.version)));
  assert.match(readFileSync(new URL("../src/data/depot/REF", import.meta.url), "utf8"), /^[0-9a-f]{7,40}\s*$/);
});

test("releases GitHub : brouillons exclus, lien seulement vers github.com", () => {
  const e = parseReleases([
    { tag_name: "v0.2.0", name: "v0.2.0", draft: false, prerelease: false, published_at: "2026-11-05T10:00:00Z", html_url: "https://github.com/MALVEILLANCEMAX/aethryon/releases/tag/v0.2.0", body: "## Changes\n- New" },
    { tag_name: "v0.3.0", name: "Draft", draft: true },
    { tag_name: "v0.1.0", name: "AETHRYON 0.1.0", draft: false, prerelease: true, published_at: "2026-10-26T14:47:55Z", html_url: "https://evil.example/x", body: null },
  ]);
  assert.deepEqual(e.map((x) => [x.version, x.title, x.date, x.prerelease, x.url]), [
    ["0.2.0", null, "2026-11-05", false, "https://github.com/MALVEILLANCEMAX/aethryon/releases/tag/v0.2.0"],
    ["0.1.0", "AETHRYON 0.1.0", "2026-10-26", true, null],
  ]);
  assert.deepEqual(e[0]!.blocks, [{ t: "h", text: "Changes" }, { t: "li", text: "New" }]);
  assert.throws(() => parseReleases({ message: "Not Found" }));
});

test("blocs : commentaires, citations et filets ignorés", () => {
  assert.deepEqual(blocks("<!-- x -->\n> [!NOTE]\n> quoted\n---\nPara\n"), [{ t: "p", text: "Para" }]);
});

test("notes : liens réduits à leur texte, code et gras gardés, HTML retiré", () => {
  assert.deepEqual(inline("See [the docs](https://example.test) and `make test` with **care**<br>."), [
    { t: "text", text: "See the docs and " }, { t: "code", text: "make test" }, { t: "text", text: " with " }, { t: "strong", text: "care" }, { t: "text", text: "." },
  ]);
});

test("notes absentes ou illisibles : liste vide, jamais d'erreur", () => {
  assert.equal(depotNotes("").entries.length, 0);
  assert.equal(depotNotes("{pas du json").source, "none");
  const n = depotNotes(JSON.stringify({ repo: "r", public: false, builtAt: "2026-10-26", source: "changelog", ref: "3f4e3b8", entries: [{ version: "0.1.0", title: null, date: null, prerelease: false, url: null, blocks: [] }, { nope: 1 }] }));
  assert.deepEqual(n.entries.map((e) => e.version), ["0.1.0"]);
});

test("dates et versions de fichiers", () => {
  assert.equal(dateLongue("2026-10-26"), `26${NB}octobre 2026`);
  assert.equal(dateLongue("2026-13-01"), null);
  assert.equal(dateLongue(null), null);
  assert.equal(versionDuFichier("/downloads/premiere/AETHRYON-Setup-2.0.0-beta.8.exe"), "2.0.0-beta.8");
  assert.equal(versionDuFichier("/downloads/x/AETHRYON-Setup.exe"), null);
});
