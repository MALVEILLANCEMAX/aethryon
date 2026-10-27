// Point d'entrée du socle Égide pour le site : la copie src/egide (contexte Docker web/) du paquet design/. Les lots 1
// et 2 importent d'ici (`import { appliquerTheme } from "../lib/egide.ts"`), jamais directement de la copie.
export * from "../egide/src/index.ts";
