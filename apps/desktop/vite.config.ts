import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// WebView2 (Chromium récent) : cible chrome110. Aucune ressource réseau : polices et images embarquées.
// Deux pages : l'application (index.html) et le menu de la zone de notification (zone-menu.html, src-tauri/src/zone.rs).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: {
    target: "chrome110", outDir: "dist", assetsInlineLimit: 0, sourcemap: false,
    rollupOptions: { input: { index: fileURLToPath(new URL("./index.html", import.meta.url)), "zone-menu": fileURLToPath(new URL("./zone-menu.html", import.meta.url)) } },
  },
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"], environment: "node" },
});
