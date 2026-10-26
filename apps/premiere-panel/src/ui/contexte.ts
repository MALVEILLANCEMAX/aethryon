import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { App, EtatApp } from "../etat/app";
import { useSelection } from "../etat/magasin";

export const ContexteApp = createContext<App | null>(null);

export function useApp(): App {
  const a = useContext(ContexteApp);
  if (!a) throw new Error("ContexteApp absent");
  return a;
}

/** Lit une tranche de l'état ; la page ne se redessine que si cette tranche change. */
export function useEtat<T>(choisir: (e: EtatApp) => T): T {
  return useSelection(useApp().magasin, choisir);
}

/** Classe de largeur (mêmes seuils que le CSS) : compact < 360, moyen < 760, large au-delà. */
export function classeLargeur(l: number): "compact" | "moyen" | "large" {
  return l < 360 ? "compact" : l < 760 ? "moyen" : "large";
}
