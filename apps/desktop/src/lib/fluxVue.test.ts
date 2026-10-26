import { describe, expect, it } from "vitest";
import { capacites, distanceRect, estProche, etatDock, parImage, pointLePlusProche, versAjouts, versPointCss, vueImport, zoneParPosition } from "./fluxVue";
import type { EtatFlux, EtatEnvoi, Flux, OpEnvoi } from "./flux";
import { instantane, media } from "./essais/fixtures";

const DOCK = { left: 470, top: 704, right: 810, bottom: 776 };
const SURVOL_VIDE = { actif: false, provenance: null, chemins: [], classement: null, position: null, zone: null, verdict: null } as EtatFlux["survol"];
const M = media({ id: "1".repeat(40), nom: "Coucher" });
const I = instantane({ medias: [M] });
const enGlisser = (p: Partial<EtatFlux> = {}): EtatFlux => ({ survol: SURVOL_VIDE, glisser: { jeton: "g", ids: [M.id], chemins: [M.chemin], phase: "en-cours" }, operations: [], ...p });
const envoi = (e: EtatEnvoi, id = "op-1"): OpEnvoi => ({ id, le: 0, type: "envoi", ids: [M.id], chutier: null, envoi: e });

describe("fluxVue : géométrie", () => {
  it("conversion des pixels physiques en pixels CSS (150 %)", () => {
    expect(versPointCss({ x: 300, y: 150 }, 1.5)).toEqual({ x: 200, y: 100 });
    expect(versPointCss({ x: 300, y: 150 }, 0)).toEqual({ x: 300, y: 150 });
  });
  it("résolution des zones par position (rectangles fictifs), la dernière est au-dessus", () => {
    const zones = [{ nom: "bibliotheque", rect: { left: 0, top: 0, right: 1000, bottom: 800 } }, { nom: "premiere", rect: DOCK }];
    expect(zoneParPosition(zones, { x: 600, y: 740 })).toBe("premiere");
    expect(zoneParPosition(zones, { x: 100, y: 100 })).toBe("bibliotheque");
    expect(zoneParPosition(zones, { x: 2000, y: 100 })).toBeNull();
  });
  it("seuil « proche » de 48 px (hors de la zone), point le plus proche en %", () => {
    expect(distanceRect({ x: 600, y: 740 }, DOCK)).toBe(0);
    expect(estProche({ x: 600, y: 740 }, DOCK)).toBe(false);
    expect(estProche({ x: 600, y: 704 - 48 }, DOCK)).toBe(true);
    expect(estProche({ x: 600, y: 704 - 49 }, DOCK)).toBe(false);
    expect(estProche({ x: 470 - 30, y: 704 - 30 }, DOCK)).toBe(true);
    expect(pointLePlusProche({ x: 640, y: 600 }, DOCK)).toEqual({ px: 50, py: 0 });
    expect(pointLePlusProche({ x: 0, y: 900 }, DOCK)).toEqual({ px: 0, py: 100 });
  });
  it("regroupement par image : une seule application par image, la dernière valeur", () => {
    const file: (() => void)[] = [];
    const vu: number[] = [];
    const f = parImage<number>((v) => vu.push(v), (g) => file.push(g));
    f(1); f(2); f(3);
    expect(file).toHaveLength(1);
    file.shift()!();
    expect(vu).toEqual([3]);
    f(4);
    file.shift()!();
    expect(vu).toEqual([3, 4]);
  });
});

describe("fluxVue : état du dock à partir des états RÉELS", () => {
  it("caché hors glisser et sans envoi", () => {
    expect(etatDock({ survol: SURVOL_VIDE, glisser: null, operations: [] }, I, new Map(), 0, false)).toBeNull();
  });
  it("révélée, survolée (« Relâchez pour importer »), invalide", () => {
    expect(etatDock(enGlisser(), I, new Map(), 0, false)).toMatchObject({ etat: "revelee", titre: "Envoyer vers Premiere Pro", sousTitre: "Projet : Montage-voyage", accepte: true });
    expect(etatDock(enGlisser(), I, new Map(), 0, true)).toMatchObject({ etat: "survolee", titre: "Relâchez pour importer", sousTitre: "dans Montage-voyage" });
    expect(etatDock(enGlisser(), instantane({ medias: [M], projetOuvert: false }), new Map(), 0, true)).toMatchObject({ etat: "invalide", titre: "Aucun projet ouvert", accepte: false });
    expect(etatDock(enGlisser(), instantane({ medias: [M], connecte: false }), new Map(), 0, false)).toMatchObject({ etat: "invalide", horloge: true, accepte: false });
    expect(etatDock(enGlisser(), instantane({ medias: [{ ...M, etat: "en-cours" }] }), new Map(), 0, false)).toMatchObject({ etat: "invalide", titre: "Ce média n'est pas encore prêt" });
  });
  it("les cinq états d'un envoi : envoyé, importé, échec, non connecté, expiré ; durées 1,6 s et 4 s", () => {
    const e = (s: EtatEnvoi): EtatFlux => ({ survol: SURVOL_VIDE, glisser: null, operations: [envoi(s)] });
    expect(etatDock(e({ etat: "envoye", nom: "c" }), I, new Map(), 0, false)).toMatchObject({ etat: "en-cours", titre: "Envoyé au panneau…", envoi: "envoye" });
    const fin = new Map([["op-1", 1000]]);
    expect(etatDock(e({ etat: "importe", nom: "c", message: "1 importé dans « AETHRYON » (Montage-voyage)", le: "" }), I, fin, 2599, false)).toMatchObject({ etat: "reussie", titre: "Importé dans Montage-voyage" });
    expect(etatDock(e({ etat: "importe", nom: "c", message: "m", le: "" }), I, fin, 2600, false)).toBeNull();
    expect(etatDock(e({ etat: "echec", nom: "c", message: "Aucun projet ouvert" }), I, fin, 4999, false)).toMatchObject({ etat: "echec", titre: "Import non effectué", sousTitre: "Aucun projet ouvert" });
    expect(etatDock(e({ etat: "echec", nom: "c", message: "x" }), I, fin, 5000, false)).toBeNull();
    expect(etatDock(e({ etat: "non-connecte", message: "Rien n'a été envoyé.", age: null }), I, fin, 1500, false)).toMatchObject({ etat: "echec", titre: "Rien n'a été envoyé", envoi: "non-connecte" });
    expect(etatDock(e({ etat: "expire", nom: "c", message: "Expirée" }), I, fin, 1500, false)).toMatchObject({ etat: "echec", titre: "Demande expirée", envoi: "expire" });
  });
  it("un nouveau glisser passe avant l'affichage d'un ancien résultat", () => {
    expect(etatDock(enGlisser({ operations: [envoi({ etat: "importe", nom: "c", message: "m", le: "" })] }), I, new Map([["op-1", 0]]), 100, false)?.etat).toBe("revelee");
  });
});

describe("fluxVue : imports et capacités", () => {
  it("progression réelle d'après les octets copiés", () => {
    const v = vueImport({ id: "op", le: 0, type: "import", lot: "l", fichiers: [{ chemin: "C:\\a.mp4", nom: "a.mp4", taille: 100, type: "video" }], bilan: null, erreur: null,
      progression: { lot: "l", index: 0, fichiers: 1, nom: "a.mp4", etape: "copie", fait: 25, taille: 100, faitLot: 25, tailleLot: 100 } });
    expect(v).toMatchObject({ progression: 0.25, courant: { nom: "a.mp4", progression: 0.25 }, fini: false });
    expect(vueImport({ id: "op", le: 0, type: "import", lot: "l", fichiers: [], bilan: null, erreur: null, progression: null }).progression).toBeNull();
  });
  it("bilan du socle → { ajoutes, ignores } (§B.3)", () => {
    expect(versAjouts({ lot: "l", importes: 1, dejaLa: 1, refuses: 0, echecs: 0, annules: 1, octets: 1, fichiers: [
      { source: "a", nom: "a", etat: "importe", chemin: "C:\\a", id: "x", fichier: "a" },
      { source: "b", nom: "b", etat: "deja-la", id: null, raison: "Déjà là." },
      { source: "c", nom: "c", etat: "annule" },
    ] })).toEqual({ ajoutes: ["x"], ignores: [{ chemin: "b", raison: "Déjà là." }, { chemin: "c", raison: "Annulé." }] });
  });
  it("socle absent : AUCUNE capacité (l'interface de glisser n'est pas affichée)", () => {
    expect(capacites({} as Flux, false)).toEqual({});
    expect(Object.keys(capacites({} as Flux, true)).sort()).toEqual(["ecouterGlisser", "glisserHors", "importerFichiers"]);
  });
});
