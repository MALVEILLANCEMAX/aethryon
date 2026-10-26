// Constantes injectées par scripts/build.mjs (esbuild « define ») selon la cible (dev | prod).
declare const __AETHRYON_TARGET__: "dev" | "prod";
declare const __API_BASE__: string;   // ytapi, ex. https://api.malvu.fr/media
declare const __SITE_BASE__: string;  // site + compte, ex. https://raccourci.malvu.fr
declare const __VERSION__: string;    // version du manifeste (package.json, seule source)
declare const __RELEASE_STATUS__: string; // vide : publique (2026-10-18) ; « bêta » du 2026-10-11 au 2026-10-18
declare const __UPDATE_URL__: string; // latest.json : production figée, pile de test pour le build dev
