import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// WebView2 (Chromium récent) : cible chrome110. Aucune ressource réseau : polices et images embarquées.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  base: "./",
  server: { port: 5174, strictPort: true },
  build: { target: "chrome110", outDir: "dist", assetsInlineLimit: 0, sourcemap: false },
});
