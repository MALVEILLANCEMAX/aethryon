import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Égide : démarrage du thème SANS flash. design/genere/theme-boot.js (script externe autonome, < 1 Ko, compatible avec
// la CSP : script-src 'self') est émis tel quel, haché, et inséré EN TÊTE de chaque page (application et menu de la
// zone de notification), avant les feuilles et le module : la préférence de l'appareil est posée dès la première image.
function egideThemeBoot(): Plugin {
  const source = readFileSync(new URL("../../packages/design/genere/theme-boot.js", import.meta.url), "utf8");
  const fichier = `assets/theme-boot-${createHash("sha256").update(source).digest("hex").slice(0, 10)}.js`;
  return {
    name: "egide-theme-boot",
    configureServer(server) {
      server.middlewares.use(`/${fichier}`, (_req, res) => { res.setHeader("Content-Type", "text/javascript"); res.end(source); });
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const sortie = html.replace(/(<meta name="viewport"[^>]*>)/, `$1\n<script src="/${fichier}"></script>`);
        if (sortie === html) throw new Error("egide-theme-boot : <meta name=\"viewport\"> introuvable");
        return sortie;
      },
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: fichier, source });
    },
  };
}

// WebView2 (Chromium récent) : cible chrome110. Aucune ressource réseau : polices et images embarquées.
// Deux pages : l'application (index.html) et le menu de la zone de notification (zone-menu.html, src-tauri/src/zone.rs).
export default defineConfig({
  plugins: [react(), egideThemeBoot()],
  clearScreen: false,
  // Égide : le paquet partagé design/ et le catalogue des plateformes (docs/) sont hors de desktop/.
  server: { port: 5173, strictPort: true, fs: { allow: [".", "../../packages/design", "../../docs/api/CATALOGUE-PLATEFORMES.json"] } },
  build: {
    target: "chrome110", outDir: "dist", assetsInlineLimit: 0, sourcemap: false,
    rollupOptions: { input: { index: fileURLToPath(new URL("./index.html", import.meta.url)), "zone-menu": fileURLToPath(new URL("./zone-menu.html", import.meta.url)) } },
  },
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"], environment: "node" },
});
