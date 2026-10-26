import { describe, expect, it } from "vitest";
import {
  compter, depuisDossier, depuisIndexDesktop, depuisRecents, estDans, etatAffiche, filtrer, fusionner, idPourChemin, type ContexteEtat, type EntreeDossier, type Media,
} from "../../src/lib/bibliotheque";
import { sha1 } from "../../src/lib/sha1";

const joindre = (a: string, b: string) => a.replace(/\\$/, "") + "\\" + b;
const D = "C:\\Users\\Élodie\\Downloads\\AETHRYON";
const vide: ContexteEtat = { operations: new Set(), erreurs: new Map(), importes: new Set() };
const e = (nom: string, taille = 1000, ilYa = 0): EntreeDossier => ({ nom, taille, modifie: Date.parse("2026-10-18T10:00:00Z") - ilYa * 1000, fichier: true });

describe("identifiants et déduplication", () => {
  it("SHA-1 conforme (vecteur connu) et identifiant indépendant de la casse et du séparateur", () => {
    expect(sha1("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(idPourChemin("C:/Users/A/Vidéo.MP4")).toBe(idPourChemin("c:\\users\\a\\vidéo.mp4"));
  });
  it("ignore les fichiers partiels, cachés, système et inconnus", () => {
    const m = depuisDossier([e("a.mp4"), e("b.mp4.aethryon.part"), e("c.mp4.crdownload"), e(".cache.mp4"), e("desktop.ini"), e("notes.txt"), e("son.mp3")], D, joindre);
    expect(m.map((x) => x.nom + "." + x.ext)).toEqual(["a.mp4", "son.mp3"]);
  });
  it("fusionne dossier, index Desktop et imports récents sans doublon, en gardant le meilleur de chaque source", () => {
    const dossier = depuisDossier([e("Clip.mp4", 5000)], D, joindre);
    const index = depuisIndexDesktop({ schema: 1, medias: [{ id: "x".repeat(40), chemin: D.toLowerCase() + "\\clip.MP4", type: "video", duree: 12, largeur: 1280, hauteur: 720, miniature: "miniatures/" + "a".repeat(40) + ".jpg", etat: "introuvable" }] }, "C:\\R\\miniatures", joindre);
    const recents = depuisRecents([{ chemin: D + "\\Clip.mp4", titre: "Le vrai titre", plateforme: "youtube", url: "https://youtu.be/x", format: "mp4", le: "2026-10-18T09:00:00Z" }], () => true);
    const m = fusionner(dossier, index, recents);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ taille: 5000, duree: 12, largeur: 1280, etatSource: "disponible", origine: { titre: "Le vrai titre" } });
    expect(m[0]!.sources.sort()).toEqual(["desktop", "dossier", "recent"]);
    expect(m[0]!.miniature).toBe("C:\\R\\miniatures\\" + "a".repeat(40) + ".jpg");
  });
  it("rejette les entrées d'index invalides (chemin relatif, miniature hors du dossier prévu)", () => {
    const m = depuisIndexDesktop({ schema: 1, medias: [{ chemin: "..\\x.mp4", type: "video" }, { chemin: "C:\\a\\b.mp4", type: "video", miniature: "..\\..\\Windows\\x.jpg" }] }, "C:\\R", joindre);
    expect(m).toHaveLength(1);
    expect(m[0]!.miniature).toBeNull();
    expect(depuisIndexDesktop({ schema: 2, medias: [] }, null, joindre)).toEqual([]);
  });
  it("un import récent dont le fichier a disparu est « Introuvable »", () => {
    const m = depuisRecents([{ chemin: "D:\\x.mp4", titre: null, plateforme: null, url: null, format: "mp4", le: "2026-10-18T09:00:00Z" }], () => false);
    expect(etatAffiche(m[0]!, vide)).toBe("introuvable");
  });
  it("estDans refuse « .. » et l'égalité", () => {
    expect(estDans("C:\\a\\b\\c.mp4", "C:\\a\\b")).toBe(true);
    expect(estDans("C:\\a\\b\\..\\..\\x.mp4", "C:\\a\\b")).toBe(false);
    expect(estDans("C:\\a\\b", "C:\\a\\b")).toBe(false);
  });
});

describe("recherche, filtres et tri", () => {
  const medias: Media[] = fusionner(
    depuisDossier([e("Coucher de soleil — vertical.mp4", 900, 50), e("Été à Séville.mp4", 3000, 10), e("Nappe sonore.wav", 2000, 30), e("Affiche.png", 100, 5), e("Œuvre finale.mov", 5000, 1)], D, joindre),
    depuisRecents([{ chemin: D + "\\Nappe sonore.wav", titre: "Ambiance plage", plateforme: "tiktok", url: null, format: "mp3", le: "2026-10-18T00:00:00Z" }], () => true),
  );
  it("recherche sans accents, sur tous les mots, dans le nom et le titre d'origine", () => {
    expect(filtrer(medias, { recherche: "ete seville" }, vide).map((m) => m.nom)).toEqual(["Été à Séville"]);
    expect(filtrer(medias, { recherche: "VERTICÀL" }, vide)).toHaveLength(1);
    expect(filtrer(medias, { recherche: "oeuvre" }, vide)).toHaveLength(1);
    expect(filtrer(medias, { recherche: "plage" }, vide).map((m) => m.nom)).toEqual(["Nappe sonore"]);
    expect(filtrer(medias, { recherche: "tiktok" }, vide)).toHaveLength(1);
    expect(filtrer(medias, { recherche: "introuvable" }, vide)).toHaveLength(0);
  });
  it("filtre par type, état et source, et compte par type", () => {
    expect(filtrer(medias, { type: "audio" }, vide).map((m) => m.ext)).toEqual(["wav"]);
    const id = medias.find((m) => m.ext === "png")!.id;
    expect(filtrer(medias, { etat: "importe" }, { ...vide, importes: new Set([id]) }).map((m) => m.ext)).toEqual(["png"]);
    expect(filtrer(medias, { plateforme: "tiktok" }, vide)).toHaveLength(1);
    expect(filtrer(medias, { plateforme: "local" }, vide)).toHaveLength(4);
    expect(compter(medias)).toEqual({ tout: 5, video: 3, audio: 1, image: 1 });
  });
  it("trie par ajout, nom (ordre français, numérique), taille et durée", () => {
    expect(filtrer(medias, { tri: "recent" }, vide)[0]!.nom).toBe("Œuvre finale");
    expect(filtrer(medias, { tri: "ancien" }, vide)[0]!.nom).toBe("Nappe sonore");
    expect(filtrer(medias, { tri: "nom" }, vide).map((m) => m.nom)).toEqual(["Affiche", "Coucher de soleil — vertical", "Été à Séville", "Nappe sonore", "Œuvre finale"]);
    expect(filtrer(medias, { tri: "taille" }, vide)[0]!.nom).toBe("Œuvre finale");
  });
  it("l'état affiché suit la priorité : en cours > introuvable > erreur > importé > disponible", () => {
    const m = medias[0]!;
    expect(etatAffiche(m, { ...vide, importes: new Set([m.id]), erreurs: new Map([[m.id, "x"]]) })).toBe("erreur");
    expect(etatAffiche(m, { ...vide, operations: new Set([m.id]), importes: new Set([m.id]) })).toBe("en-cours");
    expect(etatAffiche(m, { ...vide, importes: new Set([m.id]) })).toBe("importe");
  });
});
