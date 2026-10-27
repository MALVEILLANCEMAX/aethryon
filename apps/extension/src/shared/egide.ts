// Point d'entrée du socle Égide pour l'extension (paquet partagé design/, source unique, aucune copie). Chemin relatif :
// esbuild, tsc et les essais (node --test) le résolvent tous. Le lot 4 importe d'ici, par exemple
// `creerRacineOmbre(hote)` pour le menu injecté (feuille adoptée, permise par une CSP stricte) et
// `demarrerTheme(document.documentElement)` pour le popup.
export * from "../../../../packages/design/src/index.ts";
