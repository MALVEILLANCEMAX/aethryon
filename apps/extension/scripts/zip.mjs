// Paquet de la version distribuée : node scripts/zip.mjs [--dist=dist] [--out=release]
//   (après node scripts/build.mjs --target=prod ; « npm run package » fait les deux)
// Écrit dans <out> (release/ par défaut, non versionné) :
//   aethryon-extension-<version>.zip   le dossier construit, à décompresser puis charger en mode développeur ;
//   SHA256SUMS                         une ligne par archive présente, format de sha256sum (« sha256sum -c ») ;
//   latest.json                        {"version","file","sha256","size","released","minChrome","notes"},
//                                      lu par l'extension (avis de nouvelle version) et par la page du site.
// ZIP REPRODUCTIBLE : entrées triées (chemins POSIX), date fixe 1980-01-01 00:00 (minimum du format ZIP),
// droits fixes 0644, aucun champ supplémentaire, aucun dossier, compression DEFLATE niveau 9 — deux
// constructions du même commit donnent la même empreinte SHA-256 (tests/release/release.test.mjs).
// Refuse tout autre paquet que la version de production : clé publique « installation locale » (identifiant
// necpohicddjeaeaaomaakehcbccapabg), nom AETHRYON, version de package.json, notes dans CHANGELOG.md.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
if (args.target && args.target !== "prod") {
  console.error("zip : seule la version de production est empaquetée (le build de développement n'est pas distribué).");
  process.exit(2);
}
const DIST = resolve(ROOT, args.dist ?? "dist");
const OUT = resolve(ROOT, args.out ?? "release");
export const RELEASE_ID = "necpohicddjeaeaaomaakehcbccapabg";

/** Identifiant Chrome d'une extension : 32 premiers chiffres hexadécimaux du SHA-256 de la clé publique (a–p). */
export function extensionIdFromKey(keyB64) {
  return [...createHash("sha256").update(Buffer.from(keyB64, "base64")).digest("hex").slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

/** Section « ## <version> — AAAA-MM-JJ » de CHANGELOG.md : date et lignes « - … » (texte brut). */
export function changelogEntry(text, version) {
  const lines = text.split(/\r?\n/);
  const head = lines.findIndex((l) => new RegExp(`^##\\s+\\[?${version.replace(/\./g, "\\.")}\\]?\\s+[—–-]\\s+(\\d{4}-\\d{2}-\\d{2})\\s*$`).test(l));
  if (head < 0) return null;
  const released = /(\d{4}-\d{2}-\d{2})/.exec(lines[head])[1];
  const notes = [];
  for (const l of lines.slice(head + 1)) {
    if (/^##\s/.test(l)) break;
    const m = /^[-*]\s+(.+)$/.exec(l.trim());
    if (m) notes.push(m[1].replace(/`([^`]*)`/g, "$1").replace(/\*\*([^*]*)\*\*/g, "$1").trim());
  }
  return { released, notes };
}

function files(dir) {
  const out = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  walk(dir);
  // Ordre binaire des chemins (indépendant de la langue du système) : archive reproductible.
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const DOS_TIME = 0; // 00:00:00
const MODE = (0o100644 << 16) >>> 0; // fichier ordinaire, rw-r--r--

/** ZIP déterministe (en-têtes écrits à la main : aucun champ variable). */
export function deterministicZip(dir) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const name of files(dir)) {
    const data = readFileSync(join(dir, name));
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const nameBuf = Buffer.from(name, "utf8");
    const utf8 = /[^\x20-\x7e]/.test(name) ? 0x0800 : 0;
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(utf8, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE((3 << 8) | 20, 4); // créé sous Unix, ZIP 2.0
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(utf8, 8);
    cd.writeUInt16LE(stored ? 0 : 8, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // aucun champ supplémentaire
    cd.writeUInt16LE(0, 32); // aucun commentaire
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(MODE, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  const n = central.length / 2;
  end.writeUInt16LE(n, 8);
  end.writeUInt16LE(n, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}

function main() {
  if (!existsSync(join(DIST, "manifest.json"))) throw new Error(`zip : ${DIST} n'est pas construit (node scripts/build.mjs --target=prod)`);
  const manifest = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  if (manifest.name !== "AETHRYON" || !manifest.key || extensionIdFromKey(manifest.key) !== RELEASE_ID) {
    throw new Error("zip : ce dossier n'est pas la version de production (nom AETHRYON, clé « installation locale » attendus)");
  }
  if (manifest.version !== pkg.version) throw new Error(`zip : version du manifeste (${manifest.version}) ≠ package.json (${pkg.version})`);
  const entry = changelogEntry(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"), manifest.version);
  if (!entry || !entry.notes.length) throw new Error(`zip : CHANGELOG.md n'a pas de section « ## ${manifest.version} — AAAA-MM-JJ » avec des notes`);

  mkdirSync(OUT, { recursive: true });
  const file = `aethryon-extension-${manifest.version}.zip`;
  const zip = deterministicZip(DIST);
  writeFileSync(join(OUT, file), zip);
  const sha256 = createHash("sha256").update(zip).digest("hex");

  // SHA256SUMS : toutes les archives présentes, triées par nom (format sha256sum, deux espaces).
  const sums = readdirSync(OUT).filter((f) => /^aethryon-extension-[\d.]+\.zip$/.test(f)).sort()
    .map((f) => `${createHash("sha256").update(readFileSync(join(OUT, f))).digest("hex")}  ${f}`);
  writeFileSync(join(OUT, "SHA256SUMS"), `${sums.join("\n")}\n`);

  const latest = {
    version: manifest.version,
    file,
    sha256,
    size: zip.length,
    released: entry.released,
    minChrome: Number.parseInt(manifest.minimum_chrome_version, 10),
    notes: entry.notes,
  };
  writeFileSync(join(OUT, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);
  console.log(`${join(OUT, file)}\nsha256 ${sha256}\ntaille ${zip.length} octets\n${join(OUT, "SHA256SUMS")}\n${join(OUT, "latest.json")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
