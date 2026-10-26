import { describe, expect, it } from "vitest";
import { dernierActif, naviguer, parLettre, positionAuPoint, premierActif, suivant } from "./menu";

const E = [
  { libelle: "Prévisualiser", desactive: true },
  { libelle: "Ouvrir", desactive: true },
  { libelle: "Importer dans Premiere" },
  { libelle: "Afficher dans l'Explorateur" },
  { libelle: "Copier le chemin" },
];

describe("menu : navigation pure", () => {
  it("surbrillance initiale = premier élément ACTIF (corrige D3)", () => {
    expect(premierActif(E)).toBe(2);
    expect(premierActif([{ libelle: "a", desactive: true }])).toBe(-1);
    expect(dernierActif(E)).toBe(4);
  });
  it("flèches en boucle en sautant les éléments désactivés", () => {
    expect(suivant(E, 2, 1)).toBe(3);
    expect(suivant(E, 4, 1)).toBe(2); // boucle, saute 0 et 1
    expect(suivant(E, 2, -1)).toBe(4); // boucle arrière
    expect(naviguer(E, 3, "ArrowDown")).toBe(4);
    expect(naviguer(E, 3, "ArrowUp")).toBe(2);
    expect(suivant([], 0, 1)).toBe(-1);
  });
  it("Début et Fin", () => {
    expect(naviguer(E, 4, "Home")).toBe(2);
    expect(naviguer(E, 2, "End")).toBe(4);
  });
  it("première lettre, en cycle, sans accents, jamais un désactivé", () => {
    expect(parLettre(E, 2, "a")).toBe(3);
    expect(parLettre(E, 3, "c")).toBe(4);
    expect(parLettre(E, 4, "p")).toBe(4); // « Prévisualiser » est désactivé : rien ne change
    const F = [{ libelle: "Écrire" }, { libelle: "Effacer" }, { libelle: "Éditer" }];
    expect(parLettre(F, 0, "e")).toBe(1);
    expect(parLettre(F, 1, "E")).toBe(2);
    expect(parLettre(F, 2, "é")).toBe(0);
    expect(naviguer(E, 2, "Enter")).toBeNull();
    expect(naviguer(E, 2, "Shift")).toBeNull();
  });
  it("position sous le pointeur, retournée si elle déborde, marge de 8 px", () => {
    const vue = { largeur: 1280, hauteur: 800 };
    expect(positionAuPoint(100, 100, 240, 200, vue)).toEqual({ x: 102, y: 102, origine: "top left" });
    expect(positionAuPoint(1200, 100, 240, 200, vue)).toEqual({ x: 958, y: 102, origine: "top right" });
    expect(positionAuPoint(100, 700, 240, 200, vue)).toEqual({ x: 102, y: 498, origine: "bottom left" });
    const p = positionAuPoint(10, 10, 2000, 2000, vue);
    expect(p.x).toBe(8);
    expect(p.y).toBe(8);
  });
});
