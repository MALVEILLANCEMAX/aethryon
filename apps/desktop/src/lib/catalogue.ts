// Chargement à la demande du catalogue des plateformes (docs/api/CATALOGUE-PLATEFORMES.json, même source que l'API) :
// un module à part, lu au premier focus du champ « Coller un lien » ou à l'ouverture du dialogue, jamais au démarrage.
import { useEffect, useState } from "react";
import type { Catalogue, EntreeCatalogue } from "./plateformes";

let promesse: Promise<Catalogue> | null = null;
let charge: Catalogue | null = null;

export function chargerCatalogue(): Promise<Catalogue> {
  promesse ??= import("../../../../docs/api/CATALOGUE-PLATEFORMES.json").then((m) => {
    charge = { version: m.version, categories: m.categories, plateformes: m.plateformes as EntreeCatalogue[] };
    return charge;
  });
  return promesse;
}

/** Le catalogue (null tant qu'il n'est pas lu) ; `actif` : le lire maintenant. */
export function useCatalogue(actif = true): Catalogue | null {
  const [c, setC] = useState<Catalogue | null>(charge);
  useEffect(() => {
    if (!actif || c) return;
    let vivant = true;
    void chargerCatalogue().then((x) => { if (vivant) setC(x); }).catch(() => {});
    return () => { vivant = false; };
  }, [actif, c]);
  return c;
}
