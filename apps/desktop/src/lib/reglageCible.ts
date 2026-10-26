// Catégorie de Paramètres à montrer à l'ouverture (« Gérer le compte » depuis Intégrations, par exemple). Lue une seule
// fois par Paramètres (chargé à la demande), puis oubliée.
let cible: string | null = null;

export function viserReglage(c: string): void {
  cible = c;
}

export function prendreCibleReglage(): string | null {
  const c = cible;
  cible = null;
  return c;
}
