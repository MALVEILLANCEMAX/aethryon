// Construction de l'interface web unique.
//   - mode « cep »      : coque CEP (Premiere 25.x–26.x), entrée src/entree-cep.tsx, script CLASSIQUE (IIFE) : un module ES
//                         chargé depuis file:// serait bloqué par Chromium (origine null) ;
//   - mode « maquette » : hôte simulé, pour les captures et les essais (jamais livré) ;
//   - mode « banc »     : hôte simulé pour Premiere + vrai réseau et vrai disque par Node (essai de bout en bout).
// Cible : chrome99 (CEP 12 = Chromium 99) ; aucune ressource distante ; polices embarquées.
import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";

const ENTREES: Record<string, string> = {
  cep: "src/entree-cep.tsx",
  maquette: "src/entree-maquette.tsx",
  banc: "src/entree-banc.tsx",
  uxp: "src/entree-uxp.tsx",
};

/** Remplace le script module par un script classique différé et retire « crossorigin » (file:// dans CEP). */
function scriptClassique(): Plugin {
  return {
    name: "aethryon-script-classique",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return html
          .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>')
          .replace(/<link rel="stylesheet" crossorigin href=/g, '<link rel="stylesheet" href=')
          .replace(/<link rel="modulepreload"[^>]*>/g, "");
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const entree = ENTREES[mode] ?? ENTREES.maquette!;
  return {
    base: "./",
    esbuild: { jsx: "automatic", jsxImportSource: "preact", legalComments: "none" },
    define: { __ENTREE__: JSON.stringify(entree) },
    plugins: [
      {
        name: "aethryon-entree",
        transformIndexHtml: { order: "pre", handler: (html: string) => html.replace("/src/entree.tsx", "/" + entree) },
      },
      scriptClassique(),
    ],
    build: {
      target: "chrome99",
      cssTarget: "chrome99",
      outDir: `dist/${mode === "production" ? "cep" : mode}`,
      emptyOutDir: true,
      modulePreload: false,
      cssCodeSplit: false,
      assetsInlineLimit: 0,
      sourcemap: false,
      rollupOptions: {
        input: resolve(__dirname, "index.html"),
        output: { format: "iife", inlineDynamicImports: true, entryFileNames: "assets/aethryon.js", assetFileNames: "assets/[name]-[hash][extname]" },
      },
    },
    server: { host: "127.0.0.1", port: 5180, strictPort: true },
  };
});
