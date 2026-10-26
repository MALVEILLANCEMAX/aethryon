// Point d'entrée « Scanner mes disques » (AETHRYON Index, construit sur la branche feat/index).
// Contrat : l'écran du scanner est le module `src/index/EcranScanner.tsx` (export par défaut, composant React sans
// propriété obligatoire, qui reçoit `onFermer`). Il est chargé À LA DEMANDE (aucun octet dans le JS de démarrage) et
// s'affiche comme la section « scanner ». Tant que ce fichier n'existe pas dans la construction, `scannerDisponible`
// est faux et AUCUN bouton n'est affiché : jamais de bouton factice.
import { lazy, type ComponentType, type LazyExoticComponent } from "react";

type ModuleEcran = { default: ComponentType<{ onFermer: () => void }> };

// Vite résout ce motif à la construction : objet vide si le fichier est absent.
const ecrans = import.meta.glob<ModuleEcran>("../index/EcranScanner.tsx");
const charger = Object.values(ecrans)[0] as (() => Promise<ModuleEcran>) | undefined;

export const scannerDisponible: boolean = !!charger;
export const EcranScanner: LazyExoticComponent<ComponentType<{ onFermer: () => void }>> | null = charger ? lazy(charger) : null;
