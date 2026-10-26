// Origine à montrer à la prochaine ouverture de la Bibliothèque (« Explorer les médias » à la fin d'un scan : les
// médias SCANNÉS). Lue une fois par la Bibliothèque, puis oubliée.
export type Origine = "tout" | "dossiers" | "scannes";

let demandee: Origine | null = null;

export function viserOrigine(o: Origine): void {
  demandee = o;
}

export function prendreOrigine(): Origine | null {
  const o = demandee;
  demandee = null;
  return o;
}
