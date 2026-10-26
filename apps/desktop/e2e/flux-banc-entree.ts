// Entrée du banc e2e du flux : expose le VRAI module src/lib/flux.ts (avec @tauri-apps/api réel, branché sur la
// maquette de l'API Tauri) à la page d'essai. Construit à la volée par e2e/flux-banc.mjs (esbuild), jamais livré.
import { creerFlux, envoyerVersPremiere, EVENEMENTS } from "../src/lib/flux";

(window as unknown as { __fluxBanc: unknown }).__fluxBanc = { creerFlux, envoyerVersPremiere, EVENEMENTS };
