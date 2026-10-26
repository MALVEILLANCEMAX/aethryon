// Rendus de toutes les pages à 300, 480 et 960 px avec l'hôte MAQUETTE (Chromium de Playwright), plus contrôles
// automatiques : aucune erreur de page, aucun élément qui dépasse à droite sans être rogné par un conteneur, aucun
// défilement horizontal. Les captures vont dans tests/e2e/rendus/ ; un résumé JSON y est écrit.
// Usage : npx vite build --mode maquette && node tests/e2e/rendus.mjs [filtre]

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { servir } from "./serveur-statique.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, "..", "..");
const sortie = join(ici, "rendus");
mkdirSync(sortie, { recursive: true });
const filtre = process.argv[2] || "";

const LARGEURS = [[300, 720], [480, 760], [960, 700]];
const LIEN = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const SCENARIOS = {
  "accueil-vide": { q: "page=accueil" },
  "accueil-lien": { q: `page=accueil&lien=${encodeURIComponent(LIEN)}`, attendre: ".apercu-lien:not(.est-chargement)" },
  "accueil-extrait": {
    q: `page=accueil&lien=${encodeURIComponent(LIEN)}`, attendre: ".apercu-lien:not(.est-chargement)",
    faire: async (p) => { await p.click('[role="switch"]'); await p.waitForTimeout(250); },
  },
  "accueil-progression": {
    q: `page=accueil&lien=${encodeURIComponent(LIEN)}`, attendre: ".apercu-lien:not(.est-chargement)",
    faire: async (p) => { await p.click(".options .btn--principal"); await p.waitForSelector(".etape.est-en-cours"); await p.waitForTimeout(1300); },
  },
  "accueil-importe": {
    q: `page=accueil&lien=${encodeURIComponent(LIEN)}`, attendre: ".apercu-lien:not(.est-chargement)",
    faire: async (p) => { await p.click(".options .btn--principal"); await p.waitForSelector(".tache--termine", { timeout: 15000 }); await p.waitForTimeout(400); },
  },
  "accueil-deconnecte": { q: `page=accueil&etat=deconnecte&lien=${encodeURIComponent(LIEN)}`, attendre: ".carte--invite" },
  "accueil-refus": { q: `page=accueil&lien=${encodeURIComponent("https://www.youtube.com/@chaine")}`, attendre: ".lien__etat.est-refus" },
  "accueil-sans-projet": { q: "page=accueil&projet=0" },
  "bibliotheque-grille": { q: "page=bibliotheque", attendre: ".tuile", pause: 900 },
  "bibliotheque-liste": { q: "page=bibliotheque", attendre: ".tuile", faire: async (p) => { await p.click('button[aria-label="Liste"]'); await p.waitForSelector(".ligne"); await p.waitForTimeout(500); } },
  "bibliotheque-apercu": { q: "page=bibliotheque", attendre: ".tuile", faire: async (p) => { await p.click(".tuile >> nth=0"); await p.waitForSelector(".apercu"); await p.waitForTimeout(900); } },
  "bibliotheque-recherche": { q: "page=bibliotheque", attendre: ".tuile", faire: async (p) => { await p.fill('input[type="search"]', "verticàl"); await p.waitForTimeout(400); } },
  "bibliotheque-aucun": { q: "page=bibliotheque", attendre: ".tuile", faire: async (p) => { await p.fill('input[type="search"]', "zzz"); await p.waitForTimeout(400); } },
  "bibliotheque-selection": {
    q: "page=bibliotheque", attendre: ".tuile",
    faire: async (p) => { for (const n of [0, 1, 3]) await p.click(`.tuile >> nth=${n}`, { modifiers: ["Control"] }); await p.waitForTimeout(300); },
  },
  "bibliotheque-filtres": { q: "page=bibliotheque", attendre: ".tuile", faire: async (p) => { await p.click('button[aria-label^="Filtres"]'); await p.selectOption('select[aria-label="Filtrer par état"]', "importe"); await p.waitForTimeout(400); } },
  "bibliotheque-vide": { q: "page=bibliotheque&vide=1", attendre: ".vide" },
  "compte-connecte": { q: "page=compte", attendre: ".conversions" },
  "compte-deconnecte": { q: "page=compte&etat=deconnecte", attendre: ".compte__bloc--centre" },
  "compte-attente": { q: "page=compte&etat=deconnecte", attendre: ".compte__bloc--centre", faire: async (p) => { await p.click(".compte .btn--principal"); await p.waitForSelector(".code-appairage"); await p.waitForTimeout(300); } },
  "compte-indisponible": { q: "page=compte&etat=deconnecte&serveur=ferme", attendre: ".compte__bloc--centre", faire: async (p) => { await p.click(".compte .btn--principal"); await p.waitForSelector(".note--alerte"); await p.waitForTimeout(300); } },
  reglages: { q: "page=reglages", attendre: ".groupe" },
  diagnostic: { q: "page=diagnostic", attendre: ".essais", faire: async (p) => { await p.click(".diag .btn--principal"); await p.waitForFunction(() => !document.querySelector(".essai--en-cours") && document.querySelectorAll(".essai--ok, .essai--echec").length >= 6, null, { timeout: 20000 }); await p.waitForTimeout(300); } },
  "reduit-accueil": { q: `page=accueil&lien=${encodeURIComponent(LIEN)}`, attendre: ".apercu-lien:not(.est-chargement)", mouvementReduit: true },
};

/** Éléments visibles qui dépassent à droite sans être rognés par un ancêtre (overflow ≠ visible). */
function controlerDebordements() {
  const l = window.innerWidth;
  const fautifs = [];
  const tous = document.querySelectorAll("body *");
  for (const el of tous) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || st.position === "fixed" && r.right <= 1) continue;
    if (r.right <= l + 1 && r.left >= -1) continue;
    let rogne = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const sa = getComputedStyle(a);
      if (sa.overflowX !== "visible" || sa.overflow !== "visible") {
        const ra = a.getBoundingClientRect();
        if (ra.right <= l + 1 && ra.left >= -1) { rogne = true; break; }
      }
    }
    if (el.closest(".sr-only")) rogne = true;
    // Un élément qui dépasse le conteneur de PAGE (zone défilante) est une faute, même s'il est rogné.
    const page = el.parentElement && el.parentElement.closest(".defile, .vue, .app");
    if (page && !el.closest(".ell, .tuile__image, .lect__scene, .apercu-lien__image, .recent__mini, .ligne__mini, .champ-lien, .champ, .choix")) {
      const rp = page.getBoundingClientRect();
      if (r.right > rp.right + 1) rogne = false;
    }
    if (!rogne) fautifs.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} [${Math.round(r.left)}–${Math.round(r.right)}]`);
  }
  return { fautifs: fautifs.slice(0, 12), defilementH: document.documentElement.scrollWidth > l + 1 };
}

const serveur = await servir([["/maquette/medias/", join(racine, "maquette", "medias")], ["/", join(racine, "dist", "maquette")]]);
const port = serveur.address().port;
const navigateur = await chromium.launch();
const bilan = [];
let echecs = 0;
for (const [nom, sc] of Object.entries(SCENARIOS)) {
  if (filtre && !nom.includes(filtre)) continue;
  for (const [l, h] of LARGEURS) {
    const contexte = await navigateur.newContext({ viewport: { width: l, height: h }, deviceScaleFactor: 1, reducedMotion: sc.mouvementReduit ? "reduce" : "no-preference" });
    const page = await contexte.newPage();
    const erreurs = [];
    page.on("pageerror", (e) => erreurs.push("pageerror: " + e.message));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource.*(inexistant|404)/.test(m.text()) && erreurs.push("console: " + m.text()));
    try {
      await page.goto(`http://127.0.0.1:${port}/index.html?${sc.q}`);
      await page.waitForSelector(".app:not(.app--chargement)");
      if (sc.attendre) await page.waitForSelector(sc.attendre, { timeout: 8000 });
      if (sc.faire) await sc.faire(page);
      await page.waitForTimeout(sc.pause ?? 350);
      const c = await page.evaluate(controlerDebordements);
      const fichier = join(sortie, `${nom}-${l}.png`);
      await page.screenshot({ path: fichier });
      const ok = !erreurs.length && !c.fautifs.length && !c.defilementH;
      if (!ok) echecs++;
      bilan.push({ nom, largeur: l, ok, erreurs, debordements: c.fautifs, defilementH: c.defilementH });
      console.log(`${ok ? "ok    " : "ÉCHEC "} ${nom} @${l}${erreurs.length ? " · " + erreurs.join(" | ") : ""}${c.fautifs.length ? " · déborde : " + c.fautifs.join(", ") : ""}${c.defilementH ? " · défilement horizontal" : ""}`);
    } catch (e) {
      echecs++;
      bilan.push({ nom, largeur: l, ok: false, erreurs: [String(e.message || e)] });
      console.log(`ÉCHEC  ${nom} @${l} · ${String(e.message || e).split("\n")[0]}`);
      await page.screenshot({ path: join(sortie, `${nom}-${l}-echec.png`) }).catch(() => {});
    }
    await contexte.close();
  }
}
await navigateur.close();
serveur.close();
writeFileSync(join(sortie, "bilan.json"), JSON.stringify({ le: new Date().toISOString(), echecs, bilan }, null, 1));
console.log(`\n${bilan.length} rendus, ${echecs} en échec.`);
process.exit(echecs ? 1 : 0);
