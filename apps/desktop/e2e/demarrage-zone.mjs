// Captures de l'écran de démarrage et du menu de la zone de notification (Chromium, Playwright, MAQUETTE de l'API
// Tauri : rien n'est « réel » ici). Le menu est posé sur un bureau SIMULÉ : l'acrylique, l'ombre et le liseré de DWM y
// sont imités en CSS ; le rendu réel sous Windows 11 n'est PAS démontré par ces captures.
// Usage : npm run build && node e2e/demarrage-zone.mjs [dossier de sortie]   (PLAYWRIGHT_CORE : chemin du module)
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_CORE || "/root/.npm/_npx/705bc6b22212b352/node_modules/playwright-core");
const ici = dirname(fileURLToPath(import.meta.url));
const racine = dirname(ici);
const dist = join(racine, "dist");
// SORTIE (comme les autres bancs) passe avant le dossier de livraison de la 3.8, pour ne jamais le réécrire par mégarde.
const sortie = process.argv[2] || process.env.SORTIE || "captures";
mkdirSync(sortie, { recursive: true });

// Bureau simulé : fond d'écran (fixture), barre des tâches de Windows 11 en bas, icône AETHRYON, menu dans un cadre
// placé comme le fait zone.rs (centré sur l'icône, 8 px au-dessus de la barre, borné à 8 px du bord).
const BUREAU = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif}
body{background:#1b1b1d url(/__fond.jpg) center/cover}
.barre{position:fixed;left:0;right:0;bottom:0;height:48px;display:flex;align-items:center;justify-content:flex-end;gap:2px;padding-right:10px;
  background:rgb(32 32 32/.84);backdrop-filter:blur(24px) saturate(1.3);box-shadow:inset 0 1px 0 rgb(255 255 255/.07);color:#fff;font-size:12px}
.ic{width:32px;height:40px;display:grid;place-items:center;border-radius:4px;color:rgb(255 255 255/.8)}
.ic.on{background:rgb(255 255 255/.08)}.ic img{width:16px;height:16px}
.heure{text-align:right;line-height:16px;padding:0 8px}
.acry{position:fixed;border-radius:8px;background:rgb(32 32 32/.72);backdrop-filter:blur(30px) saturate(1.25);box-shadow:0 0 0 1px #3a352e,0 10px 30px rgb(0 0 0/.42)}
iframe{position:fixed;border:0;border-radius:8px;background:transparent}
.note{position:fixed;left:10px;top:8px;font:500 10px/14px system-ui;color:rgb(255 255 255/.9);background:rgb(0 0 0/.5);padding:3px 7px;border-radius:4px}
</style></head><body>
<div class="note">Maquette Chromium — acrylique, ombre et liseré de DWM imités en CSS ; rendu Windows 11 NON DÉMONTRÉ</div>
<div class="acry" id="acry"></div><iframe id="menu" src="/zone-menu.html"></iframe>
<div class="barre"><div class="ic">&#8963;</div><div class="ic on" id="icone"><img src="/__zone-32.png" alt=""></div><div class="heure">11:52<br>24/10/2026</div></div>
</body></html>`;

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const serveur = createServer((req, res) => {
  const p = decodeURIComponent((req.url || "/").split("?")[0]);
  const virtuels = { "/__bureau.html": [BUREAU, TYPES[".html"]], "/__fond.jpg": [readFileSync(join(ici, "fixtures", "coucher-1s.jpg")), TYPES[".jpg"]],
    "/__zone-32.png": [readFileSync(join(racine, "src-tauri", "icons", "zone-32.png")), TYPES[".png"]] };
  if (virtuels[p]) { res.writeHead(200, { "Content-Type": virtuels[p][1] }); res.end(virtuels[p][0]); return; }
  const f = join(dist, p === "/" ? "index.html" : p);
  if (!f.startsWith(dist) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
}).listen(0);
const base = `http://127.0.0.1:${serveur.address().port}`;
const maquette = readFileSync(join(ici, "maquette-tauri.js"), "utf8");
const navigateur = await pw.chromium.launch();

async function contexte(scenario, options) {
  const ctx = await navigateur.newContext({ deviceScaleFactor: 1, locale: "fr-FR", timezoneId: "Europe/Paris", colorScheme: "dark", reducedMotion: "no-preference", ...options });
  const erreurs = [];
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreurs.push(String(e)));
  // Miniatures (protocole asset:) non servies ici : seules les autres erreurs comptent.
  p.on("console", (m) => { if (m.type() === "error" && !(m.location().url || "").startsWith("http://asset.localhost")) erreurs.push(m.text()); });
  await p.addInitScript(`window.__SCENARIO__ = ${JSON.stringify(scenario)};\n${maquette}`);
  return { ctx, p, erreurs };
}
const bilan = (nom, ok, detail) => console.log(`${ok ? "OK " : "ÉCHEC"} ${nom}${detail ? ` — ${detail}` : ""}`);

// 1. Démarrage lent (première lecture de l'état : 1,6 s) : l'écran se montre au-delà de 150 ms, puis s'efface.
{
  const { ctx, p, erreurs } = await contexte({ etatLent: 1600 }, { viewport: { width: 1280, height: 800 } });
  await p.goto(`${base}/`);
  await p.waitForTimeout(1150);
  const etat = await p.evaluate(() => document.getElementById("demarrage")?.dataset.etat);
  await p.screenshot({ path: join(sortie, "demarrage.png") });
  await p.waitForTimeout(1500);
  const apres = await p.evaluate(() => ({ present: !!document.getElementById("demarrage"), montre: window.__maquette.appels.filter((c) => c === "fenetre_prete").length }));
  bilan("démarrage lent : écran visible pendant l'attente", etat === "visible", `data-etat=${etat}`);
  bilan("démarrage lent : écran retiré une fois prêt, fenêtre montrée une seule fois", !apres.present && apres.montre === 1, JSON.stringify(apres));
  bilan("démarrage lent : console", !erreurs.length, erreurs.join(" | "));
  await ctx.close();
}
// 2. Démarrage rapide : prêt avant 150 ms ⇒ l'écran n'est jamais montré.
{
  const { ctx, p, erreurs } = await contexte({}, { viewport: { width: 1280, height: 800 } });
  await p.addInitScript(() => {
    new MutationObserver(() => { if (document.getElementById("demarrage")?.dataset.etat === "visible") window.__ecranVu = true; })
      .observe(document, { subtree: true, attributes: true, attributeFilter: ["data-etat"] });
  });
  await p.goto(`${base}/`);
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => ({ vu: !!window.__ecranVu, present: !!document.getElementById("demarrage"), montre: window.__maquette.appels.filter((c) => c === "fenetre_prete").length }));
  // « vu » dépend de la vitesse de Chromium ici : vrai seulement si l'interface a mis plus de 150 ms à se monter.
  bilan("démarrage rapide : écran retiré, fenêtre montrée une fois", !r.present && r.montre === 1, JSON.stringify(r));
  bilan("démarrage rapide : console", !erreurs.length, erreurs.join(" | "));
  await ctx.close();
}
// 3. Menu de la zone de notification sur le bureau simulé (640 × 360, échelle 2), « Ouvrir le dossier des médias » survolé.
{
  const L = 640, H = 360;
  const { ctx, p, erreurs } = await contexte({}, { viewport: { width: L, height: H }, deviceScaleFactor: 2 });
  await p.goto(`${base}/__bureau.html`);
  const cadre = p.frameLocator("#menu");
  const f = p.frames().find((x) => x.url().endsWith("/zone-menu.html"));
  await f.waitForFunction(() => window.__maquette?.zone);
  const { largeur, hauteur } = await f.evaluate(() => window.__maquette.zone);
  await p.evaluate(({ largeur, hauteur, L, H }) => {
    const r = document.getElementById("icone").getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const x = Math.max(8, Math.min(cx - largeur / 2, L - largeur - 8));
    const y = H - 48 - hauteur - 8;
    for (const id of ["acry", "menu"]) Object.assign(document.getElementById(id).style, { left: `${x}px`, top: `${y}px`, width: `${largeur}px`, height: `${hauteur}px` });
  }, { largeur, hauteur, L, H });
  await f.evaluate(() => window.__maquette.emettre("zone-menu-ouvrir", { cote: "bas", verre: true, animations: "systeme" }));
  await cadre.locator("#zm-dossier").hover();
  await p.waitForTimeout(450);
  const focus = await f.evaluate(() => ({ actif: document.activeElement?.id, hl: document.querySelector(".zm-i.is-hl")?.id, ouvert: document.documentElement.dataset.ouvert }));
  await p.screenshot({ path: join(sortie, "menu-zone.png") });
  bilan("menu : mesuré, ouvert, survol en or", focus.ouvert === "1" && focus.hl === "zm-dossier", `${largeur} × ${hauteur} px CSS, ${JSON.stringify(focus)}`);
  // Clavier : Fin puis Entrée choisit « Quitter AETHRYON » (la maquette n'exécute rien).
  await cadre.locator("#zm").press("End");
  await cadre.locator("#zm").press("Enter");
  await p.waitForTimeout(200);
  const appels = await f.evaluate(() => window.__maquette.appels.filter((c) => c.startsWith("zone_menu")));
  bilan("menu : clavier (Fin, Entrée) → zone_menu_choisir", appels.includes("zone_menu_choisir"), appels.join(", "));
  bilan("menu : console", !erreurs.length, erreurs.join(" | "));
  await ctx.close();
}
await navigateur.close();
serveur.close();
console.log(`Captures : ${sortie}`);
