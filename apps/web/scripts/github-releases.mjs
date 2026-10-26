// Versions du dépôt officiel AETHRYON, relevées À LA CONSTRUCTION du site (page /open-source) : le navigateur ne
// contacte jamais GitHub (CSP connect-src 'self'). Écrit .depot/notes.json, lu par vite.config.ts.
//   VITE_GITHUB_PUBLIC=1 : API publique des releases (sans jeton) ; si elle échoue ou ne liste rien, le CHANGELOG.md
//     public de la branche main ; sinon la copie du CHANGELOG.md gardée ici (src/data/depot/).
//   VITE_GITHUB_PUBLIC=0 (défaut, dépôt encore privé) : aucune requête ; la copie du CHANGELOG.md du dépôt seulement.
// Aucune version n'est inventée : sans source lisible, la liste est vide et la page le dit.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChangelog, parseReleases } from "./depot-notes.mjs";

export const REPO = "MALVEILLANCEMAX/aethryon";
const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = process.env.VITE_GITHUB_PUBLIC ?? "0";
if (PUBLIC !== "0" && PUBLIC !== "1") throw new Error(`VITE_GITHUB_PUBLIC doit valoir 0 ou 1 (reçu : ${PUBLIC})`);
const SNAPSHOT = process.env.GITHUB_CHANGELOG_FILE ?? join(web, "src/data/depot/CHANGELOG.md");
const SNAPSHOT_REF = join(web, "src/data/depot/REF");

async function get(url, accept) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: accept, "User-Agent": "aethryon-site-build", "X-GitHub-Api-Version": "2022-11-28" } });
    if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
    return accept.includes("json") ? r.json() : r.text();
  } finally {
    clearTimeout(t);
  }
}

let notes = null;
const why = [];
if (PUBLIC === "1") {
  try {
    const entries = parseReleases(await get(`https://api.github.com/repos/${REPO}/releases?per_page=30`, "application/vnd.github+json"));
    if (entries.length) notes = { source: "releases", ref: null, entries };
    else why.push("aucune release publiée");
  } catch (e) { why.push(`releases : ${e.message}`); }
  if (!notes) {
    try {
      const entries = parseChangelog(await get(`https://raw.githubusercontent.com/${REPO}/main/CHANGELOG.md`, "text/plain"));
      if (entries.length) notes = { source: "changelog", ref: "main", entries };
    } catch (e) { why.push(`CHANGELOG.md public : ${e.message}`); }
  }
}
if (!notes) {
  let entries = [];
  let ref = null;
  try {
    entries = parseChangelog(readFileSync(SNAPSHOT, "utf8"));
    ref = readFileSync(SNAPSHOT_REF, "utf8").trim().slice(0, 12) || null;
  } catch (e) { why.push(`copie du CHANGELOG.md : ${e.message}`); }
  notes = { source: entries.length ? "changelog" : "none", ref, entries };
}
notes = { repo: REPO, public: PUBLIC === "1", builtAt: new Date().toISOString().slice(0, 10), ...notes };
mkdirSync(join(web, ".depot"), { recursive: true });
writeFileSync(join(web, ".depot/notes.json"), JSON.stringify(notes));
console.log(`depot : ${notes.entries.length} version(s), source ${notes.source}${notes.ref ? ` (${notes.ref})` : ""}, dépôt ${notes.public ? "public" : "privé (aucune requête)"}${why.length ? ` — ${why.join(" ; ")}` : ""}`);
