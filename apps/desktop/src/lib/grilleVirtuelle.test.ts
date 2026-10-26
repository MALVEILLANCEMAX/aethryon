import { describe, expect, it } from "vitest";
import { defilementPour, disposer, disposerListe, hauteurTotale, plage, position } from "./grilleVirtuelle";

const R = { min: 240, ecartX: 20, ecartY: 28, ratio: 0.5625, texte: 52 };

describe("grille virtualisée", () => {
  it("colonnes selon la largeur (2 au moins), cartes de largeur égale", () => {
    expect(disposer(780, R).colonnes).toBe(3);
    expect(disposer(300, R).colonnes).toBe(2);
    expect(disposer(2240, R).colonnes).toBe(8);
    const d = disposer(1000, R);
    expect(d.colonnes * d.largeurCarte + (d.colonnes - 1) * R.ecartX).toBeCloseTo(1000);
    expect(d.hauteurCarte).toBe(Math.round(d.largeurCarte * 0.5625 + 52));
  });
  it("positions et hauteur totale", () => {
    const d = disposer(1000, R);
    expect(position(d, 0)).toEqual({ x: 0, y: 0 });
    expect(position(d, d.colonnes)).toEqual({ x: 0, y: d.pas });
    expect(hauteurTotale(d, 0)).toBe(0);
    expect(hauteurTotale(d, d.colonnes * 3)).toBe(3 * d.pas - R.ecartY);
  });
  it("plage rendue : quelques lignes autour de la vue, jamais au-delà du total", () => {
    const d = disposer(1000, R);
    const p = plage(d, 50_000, 100 * d.pas, 800, 2);
    const lignes = (p.fin - p.debut) / d.colonnes;
    expect(p.debut).toBe(98 * d.colonnes);
    expect(lignes).toBeLessThanOrEqual(Math.ceil(800 / d.pas) + 5);
    expect(plage(d, 10, 0, 800).fin).toBe(10);
    expect(plage(d, 0, 0, 800)).toEqual({ debut: 0, fin: 0 });
  });
  it("défilement pour rendre visible un élément (clavier), barre collante comprise", () => {
    const d = disposerListe(800, 60);
    expect(defilementPour(d, 0, 0, 600)).toBeNull();
    expect(defilementPour(d, 20, 0, 600)).toBe(20 * 60 + 60 - 600);
    expect(defilementPour(d, 2, 600, 600, 50)).toBe(70);
  });
});
