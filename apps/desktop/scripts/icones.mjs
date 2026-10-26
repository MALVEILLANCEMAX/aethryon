// Fabrique les icônes et les images de l'installateur À PARTIR DES FICHIERS OFFICIELS (src/assets/brand), sans
// nouveau dessin : rendu par Chromium (playwright-core), puis assemblage ICO (entrées PNG) et BMP 24 bits pour NSIS.
// Usage : node scripts/icones.mjs [chemin de playwright-core]
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pw = require(process.argv[2] || process.env.PLAYWRIGHT_CORE || "playwright-core");
const ici = dirname(dirname(fileURLToPath(import.meta.url)));
const marque = (f) => readFileSync(join(ici, "src/assets/brand", f), "utf8");
const dataUrl = (svg) => "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
const APP = dataUrl(marque("aethryon-app.svg"));
const PETIT = dataUrl(marque("aethryon-petit.svg"));
const MAITRE = dataUrl(marque("aethryon-master.svg"));
const MOT = dataUrl(marque("aethryon-logotype-marcellus-ivoire.svg"));

const navigateur = await pw.chromium.launch();
const page = await navigateur.newPage();
await page.setContent("<!doctype html><body style='margin:0;background:#0f0f10'></body>");

// Dessine une liste de calques sur un canevas l×h ; renvoie PNG (data URL) et pixels RGBA.
async function rendre(l, h, fond, calques) {
  return page.evaluate(async ({ l, h, fond, calques }) => {
    const c = document.createElement("canvas");
    c.width = l; c.height = h;
    const x = c.getContext("2d");
    x.imageSmoothingQuality = "high";
    if (fond) { x.fillStyle = fond; x.fillRect(0, 0, l, h); }
    for (const k of calques) {
      if (k.degrade) {
        const g = x.createRadialGradient(k.degrade.x, k.degrade.y, 0, k.degrade.x, k.degrade.y, k.degrade.r);
        g.addColorStop(0, k.degrade.c0); g.addColorStop(1, k.degrade.c1);
        x.fillStyle = g; x.fillRect(0, 0, l, h); continue;
      }
      const img = new Image();
      img.src = k.src;
      await img.decode();
      x.drawImage(img, k.x, k.y, k.l, k.h);
    }
    return { png: c.toDataURL("image/png"), rgba: Array.from(x.getImageData(0, 0, l, h).data) };
  }, { l, h, fond, calques });
}
const png = (r) => Buffer.from(r.png.split(",")[1], "base64");

function ico(entrees) {
  const tete = Buffer.alloc(6 + 16 * entrees.length);
  tete.writeUInt16LE(0, 0); tete.writeUInt16LE(1, 2); tete.writeUInt16LE(entrees.length, 4);
  let off = tete.length;
  entrees.forEach(([taille, donnees], i) => {
    const o = 6 + 16 * i;
    tete.writeUInt8(taille >= 256 ? 0 : taille, o); tete.writeUInt8(taille >= 256 ? 0 : taille, o + 1);
    tete.writeUInt8(0, o + 2); tete.writeUInt8(0, o + 3); tete.writeUInt16LE(1, o + 4); tete.writeUInt16LE(32, o + 6);
    tete.writeUInt32LE(donnees.length, o + 8); tete.writeUInt32LE(off, o + 12); off += donnees.length;
  });
  return Buffer.concat([tete, ...entrees.map((e) => e[1])]);
}

function bmp(l, h, rgba) {
  const ligne = Math.ceil((l * 3) / 4) * 4;
  const b = Buffer.alloc(54 + ligne * h);
  b.write("BM", 0); b.writeUInt32LE(b.length, 2); b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(l, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
  b.writeUInt32LE(ligne * h, 34); b.writeInt32LE(2835, 38); b.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++) for (let x = 0; x < l; x++) {
    const s = ((h - 1 - y) * l + x) * 4, d = 54 + y * ligne + x * 3;
    b[d] = rgba[s + 2]; b[d + 1] = rgba[s + 1]; b[d + 2] = rgba[s];
  }
  return b;
}

const icones = join(ici, "src-tauri/icons");
mkdirSync(icones, { recursive: true });
// Application : 16–24 px depuis le petit logo (sur obsidienne), 32 px et plus depuis l'icône d'application officielle.
const entrees = [];
for (const t of [16, 20, 24, 32, 40, 48, 64, 256]) {
  const r = t <= 24
    ? await rendre(t, t, null, [{ src: PETIT, x: 0, y: 0, l: t, h: t }])
    : await rendre(t, t, null, [{ src: APP, x: 0, y: 0, l: t, h: t }]);
  entrees.push([t, png(r)]);
}
writeFileSync(join(icones, "icon.ico"), ico(entrees));
for (const [nom, t] of [["32x32.png", 32], ["128x128.png", 128], ["128x128@2x.png", 256], ["icon.png", 512]]) {
  writeFileSync(join(icones, nom), png(await rendre(t, t, null, [{ src: APP, x: 0, y: 0, l: t, h: t }])));
}
// Zone de notification : petit logo transparent, 32 px (Windows le réduit à 16 ou 20 selon l'échelle).
writeFileSync(join(icones, "zone-32.png"), png(await rendre(32, 32, null, [{ src: PETIT, x: 0, y: 0, l: 32, h: 32 }])));

// Installateur NSIS (MUI2) : bandeau de bienvenue 164 × 314 et en-tête 150 × 57, obsidienne et halo champagne du fond.
const inst = join(ici, "installateur");
mkdirSync(inst, { recursive: true });
const halo = (x, y, r) => ({ degrade: { x, y, r, c0: "rgba(212,175,124,0.16)", c1: "rgba(212,175,124,0)" } });
const bienvenue = await rendre(164, 314, "#0f0f10", [halo(82, 120, 120), { src: MAITRE, x: 42, y: 80, l: 80, h: 80 }, { src: MOT, x: 22, y: 190, l: 120, h: 14 }]);
writeFileSync(join(inst, "bienvenue.bmp"), bmp(164, 314, bienvenue.rgba));
const entete = await rendre(150, 57, "#0f0f10", [{ src: MAITRE, x: 104, y: 9, l: 38, h: 38 }]);
writeFileSync(join(inst, "entete.bmp"), bmp(150, 57, entete.rgba));
writeFileSync(join(inst, "installateur.ico"), ico(entrees));
await navigateur.close();
console.log("icônes et images de l'installateur écrites");
