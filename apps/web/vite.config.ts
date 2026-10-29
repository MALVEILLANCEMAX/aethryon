import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Identité : la tête maître (brand/master, logo du propriétaire validé le 2026-10-11), seule chouette du site depuis Égide
// (lot 1) ; l'exploration vectorielle C3 (VITE_MASCOT=vector), refusée, est retirée du code.
const MASCOT = process.env.VITE_MASCOT ?? "master";
if (MASCOT !== "master") throw new Error(`VITE_MASCOT : seule la tête maître existe depuis Égide (reçu : ${MASCOT})`);

// Égide (paquet design/, copie src/egide par `node ../../packages/design/scripts/build.mjs --sync`) : script de démarrage du thème,
// EXTERNE (CSP script-src 'self' : aucun script en ligne), chargé de façon bloquante en tête de <head> avant les
// feuilles, haché dans /assets/ (cache immuable de nginx, archive des anciennes versions). Il ne fait rien sans
// préférence enregistrée (Obsidian vient de la feuille) ; sinon il pose le thème choisi AVANT le premier rendu.
function egideThemeBoot(): Plugin {
  const source = readFileSync(new URL("./src/egide/genere/theme-boot.js", import.meta.url), "utf8");
  const fichier = `assets/theme-boot-${createHash("sha256").update(source).digest("hex").slice(0, 10)}.js`;
  return {
    name: "egide-theme-boot",
    configureServer(server) {
      server.middlewares.use(`/${fichier}`, (_req, res) => { res.setHeader("Content-Type", "text/javascript"); res.end(source); });
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const sortie = html.replace(/(<meta name="viewport"[^>]*>)/, `$1\n    <script src="/${fichier}"></script>`);
        if (sortie === html) throw new Error("egide-theme-boot : <meta name=\"viewport\"> introuvable dans index.html");
        return sortie;
      },
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: fichier, source });
    },
  };
}

// Extension navigateur (distribution directe, src/lib/extension.ts) : publiée seulement avec EXTENSION_DOWNLOAD=1,
// quand scripts/fetch-downloads.sh a copié la release vérifiée (public-downloads/extension/latest.json).
const EXTENSION_DOWNLOAD = process.env.EXTENSION_DOWNLOAD ?? "0";
if (EXTENSION_DOWNLOAD !== "0" && EXTENSION_DOWNLOAD !== "1") throw new Error(`EXTENSION_DOWNLOAD doit valoir 0 ou 1 (reçu : ${EXTENSION_DOWNLOAD})`);
const LATEST = new URL("./public-downloads/extension/latest.json", import.meta.url);
if (EXTENSION_DOWNLOAD === "1" && !existsSync(LATEST)) throw new Error("EXTENSION_DOWNLOAD=1 sans public-downloads/extension/latest.json : lancer scripts/fetch-downloads.sh avec EXTENSION_DOWNLOAD=1");
const EXTENSION_RELEASE = EXTENSION_DOWNLOAD === "1" ? readFileSync(LATEST, "utf8").trim() : "";

// Dépôt GitHub officiel (src/lib/github.ts) : VITE_GITHUB_PUBLIC=1 seulement quand il est PUBLIC (sinon chaque lien
// mènerait à une 404) ; 0 par défaut.
const GITHUB_PUBLIC = process.env.VITE_GITHUB_PUBLIC ?? "0";
if (GITHUB_PUBLIC !== "0" && GITHUB_PUBLIC !== "1") throw new Error(`VITE_GITHUB_PUBLIC doit valoir 0 ou 1 (reçu : ${GITHUB_PUBLIC})`);

// Build strictement compatible avec la CSP du site : pas de script inline, pas de data: URI
// (assetsInlineLimit: 0), pas de polyfill de modulepreload injecté.
// Deux builds (npm run build) : le site (dist/) puis le rendu statique des pages publiques
// (`vite build --ssr src/entry-static.tsx` → .prerender/, lu par scripts/prerender.mjs, jamais servi).
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react(), tailwindcss(), ...(isSsrBuild ? [] : [egideThemeBoot()])],
  publicDir: isSsrBuild ? false : "public",
  define: { "import.meta.env.VITE_EXTENSION_RELEASE": JSON.stringify(EXTENSION_RELEASE), "import.meta.env.VITE_GITHUB_PUBLIC": JSON.stringify(GITHUB_PUBLIC) },
  build: {
    outDir: isSsrBuild ? ".prerender" : "dist",
    target: "es2022",
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    cssCodeSplit: true,
    sourcemap: false,
    chunkSizeWarningLimit: 400,
  },
  server: {
    proxy: { "/api": { target: process.env.API_TARGET ?? "http://127.0.0.1:18120", changeOrigin: false } },
  },
  preview: {
    proxy: { "/api": { target: process.env.API_TARGET ?? "http://127.0.0.1:18120", changeOrigin: false } },
  },
}));
