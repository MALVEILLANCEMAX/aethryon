import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { existsSync, readFileSync } from "node:fs";

// Identité : la tête maître (brand/master, logo du propriétaire validé le 2026-10-11) est le comportement par
// défaut, sans extension. VITE_MASCOT=vector reconstruit l'EXPLORATION C3 archivée (piste non retenue) : les
// modules ui/brand/OwlGaze.tsx et OwlMark.tsx sont alors résolus vers ui/brand/athena (même API).
const MASCOT = process.env.VITE_MASCOT ?? "master";
if (!["master", "vector"].includes(MASCOT)) throw new Error(`VITE_MASCOT doit valoir master ou vector (reçu : ${MASCOT})`);
function vectorExploration(): Plugin {
  const swap: Record<string, string> = { "/src/ui/brand/OwlGaze.tsx": "athena/AthenaGaze.tsx", "/src/ui/brand/OwlMark.tsx": "athena/AthenaMark.tsx" };
  return {
    name: "aethryon-c3-exploration",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!/(^|\/)Owl(Gaze|Mark)\.tsx$/.test(source)) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      const key = r && Object.keys(swap).find((k) => r.id.endsWith(k));
      return key ? r!.id.replace(/Owl(Gaze|Mark)\.tsx$/, swap[key]!) : null;
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

// Build strictement compatible avec la CSP du site : pas de script inline, pas de data: URI
// (assetsInlineLimit: 0), pas de polyfill de modulepreload injecté.
// Deux builds (npm run build) : le site (dist/) puis le rendu statique des pages publiques
// (`vite build --ssr src/entry-static.tsx` → .prerender/, lu par scripts/prerender.mjs, jamais servi).
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react(), tailwindcss(), ...(MASCOT === "vector" ? [vectorExploration()] : [])],
  publicDir: isSsrBuild ? false : "public",
  define: { "import.meta.env.VITE_EXTENSION_RELEASE": JSON.stringify(EXTENSION_RELEASE) },
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
