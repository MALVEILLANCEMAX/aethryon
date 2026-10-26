import { describe, expect, it } from "vitest";
import { noeuds } from "./pipeline";
import { media, resultat, transfert } from "./essais/fixtures";

const M = media({ id: "1".repeat(40), nom: "Coucher de soleil", taille: 14_200_000 });
const etats = (p: ReturnType<typeof noeuds>) => p.noeuds.map((n) => n.etat);

describe("pipeline (chaque ligne du tableau §B.7)", () => {
  it("attente : Demande faite, Conversion en attente d'une place", () => {
    const p = noeuds(transfert({ etat: "attente" }), null, {}, {}, [], null);
    expect(etats(p)).toEqual(["fait", "attente", "a-venir", "a-venir", "a-venir"]);
    expect(p.noeuds[1].detail).toBe("En attente d'une place");
    expect(p.aria).toBe("Étape 2 sur 5 : Conversion, En attente d'une place");
  });
  it("conversion : en cours, avec pourcentage seulement s'il est transmis", () => {
    expect(noeuds(transfert({ etat: "conversion", progression: 0.38 }), null, {}, {}, [], null).noeuds[1]).toMatchObject({ etat: "en-cours", detail: "38 %", progression: 0.38 });
    const sans = noeuds(transfert({ etat: "conversion", progression: null }), null, {}, {}, [], null).noeuds[1];
    expect(sans.progression).toBeNull();
    expect(sans.detail).toBe("en cours");
  });
  it("téléchargement : pourcentage sur le nœud (la taille reçue est écrite par la carte de Transferts)", () => {
    const p = noeuds(transfert({ etat: "telechargement", progression: 0.64 }), media({ ...M, etat: "en-cours" }), {}, {}, [], null);
    expect(etats(p)).toEqual(["fait", "fait", "en-cours", "a-venir", "a-venir"]);
    expect(p.noeuds[2].detail).toMatch(/^64\u00a0?%$|^64 %$/);
    expect(p.aria).toContain("Étape 3 sur 5 : Téléchargement");
  });
  it("Nocturne : conversion reçue par le Desktop : octets laissés à la carte, pause dite sur le nœud", () => {
    const p = noeuds(transfert({ etat: "telechargement", progression: 0.35, recus: 18_400_000, total: 52_100_000 }), media({ ...M, etat: "en-cours" }), {}, {}, [], null);
    expect(p.noeuds[2].detail).toBe("35 %");
    const enPause = noeuds(transfert({ etat: "telechargement", progression: 0.35, recus: 18_400_000, total: 52_100_000, pause: true }), null, {}, {}, [], null);
    expect(enPause.noeuds[2]).toMatchObject({ etat: "en-cours", detail: "En pause · 35 %", progression: 0.35 });
    expect(enPause.aria).toBe("Étape 3 sur 5 : Téléchargement, En pause · 35 %");
  });
  it("prêt et média trouvé : action « Importer dans Premiere »", () => {
    const p = noeuds(transfert({ etat: "pret" }), M, {}, {}, [], null);
    expect(etats(p)).toEqual(["fait", "fait", "fait", "fait", "a-venir"]);
    expect(p.importable).toBe(true);
  });
  it("prêt : « Demandé… », « Importé · Montage-voyage », « Non importé »", () => {
    const d = { [M.id]: { nom: "c1.json", le: 1 } };
    expect(noeuds(transfert({ etat: "pret" }), M, {}, d, [], null).noeuds[4]).toMatchObject({ etat: "en-cours", detail: "Demandé…" });
    expect(noeuds(transfert({ etat: "pret" }), M, { [M.id]: [{ projet: "Montage-voyage", chutier: "AETHRYON", le: "x" }] }, {}, [], null).noeuds[4]).toMatchObject({ etat: "fait", detail: "Importé · Montage-voyage" });
    const p = noeuds(transfert({ etat: "pret" }), M, {}, d, [resultat({ nom: "c1.json", ok: false, message: "Aucun projet ouvert" })], null);
    expect(p.noeuds[4]).toMatchObject({ etat: "erreur", detail: "Non importé" });
    expect(p.importable).toBe(false);
  });
  it("prêt sans média : ambre « Fichier attendu non retrouvé »", () => {
    const p = noeuds(transfert({ etat: "pret" }), null, {}, {}, [], null);
    expect(p.noeuds[3]).toMatchObject({ etat: "ambre", detail: "Fichier attendu non retrouvé" });
    expect(p.importable).toBe(false);
  });
  it("erreur : sur le nœud du dernier état vu dans la session, sinon bandeau", () => {
    const t = transfert({ etat: "erreur", erreur: "Connexion interrompue à 41 %", progression: 0.41 });
    expect(etats(noeuds(t, null, {}, {}, [], "telechargement"))).toEqual(["fait", "fait", "erreur", "a-venir", "a-venir"]);
    expect(etats(noeuds(t, null, {}, {}, [], "conversion"))).toEqual(["fait", "erreur", "a-venir", "a-venir", "a-venir"]);
    const b = noeuds(t, null, {}, {}, [], null);
    expect(b.bandeau).toBe("Connexion interrompue à 41 %");
    expect(b.aria).toBe("Erreur : Connexion interrompue à 41 %");
  });
  it("média « en cours » sans transfert (navigateur) : taille finale inconnue, indéterminé", () => {
    const p = noeuds(null, media({ ...M, etat: "en-cours" }), {}, {}, [], null);
    expect(p.noeuds[2]).toMatchObject({ etat: "en-cours", progression: null });
    expect(p.noeuds[2].detail).toContain("taille finale inconnue");
    expect(p.noeuds[0].etat).toBe("sans-objet");
  });
});
