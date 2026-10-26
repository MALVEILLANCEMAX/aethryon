// Constantes normalement injectées par esbuild (scripts/build.mjs), posées AVANT l'import des modules
// de l'extension : importer ce fichier en premier dans chaque test du service worker.
import { API, SITE } from "./backend.ts";

const g = globalThis as Record<string, unknown>;
g.__AETHRYON_TARGET__ = "dev";
g.__API_BASE__ = API;
g.__SITE_BASE__ = SITE;
g.__VERSION__ = "1.0.0";
g.__RELEASE_STATUS__ = "";
g.__UPDATE_URL__ = `${SITE}/downloads/extension/latest.json`;
