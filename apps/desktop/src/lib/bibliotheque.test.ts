import { describe, expect, it } from "vitest";
import { correspond, decompter, dernierMedia, etatAffiche, filtrer, progressionMedia, selectionner, trier } from "./bibliotheque";
import { activites, liaison, phraseEtat, versionCourte, versionsPanneau } from "./liaison";
import type { Instantane, Media } from "./types";

function media(p: Partial<Media>): Media {
  return {
    id: p.id ?? "a".repeat(40), chemin: `C:\\M\\${p.nom ?? "x"}.${p.ext ?? "mp4"}`, nom: "x", ext: "mp4", type: "video", taille: 1, ajouteLe: "2026-10-18T01:00:00Z",
    modifieLe: "2026-10-18T01:00:00Z", duree: null, largeur: null, hauteur: null, ips: null, codecVideo: null, codecAudio: null, miniature: null,
    etat: "disponible", premiereCompatible: null, origine: { plateforme: "local", titre: null }, ...p,
  };
}

const M = [
  media({ id: "1".repeat(40), nom: "Coucher de soleil sur la côte", ajouteLe: "2026-10-18T01:12:00Z", taille: 845654, duree: 12 }),
  media({ id: "2".repeat(40), nom: "Nappe sonore — côte", ext: "wav", type: "audio", ajouteLe: "2026-10-17T22:40:00Z", taille: 2300000, duree: 12 }),
  media({ id: "3".repeat(40), nom: "AETHRYON — Le Passage (V3.5)", etat: "en-cours", ajouteLe: "2026-10-18T01:18:00Z", taille: 14_900_000 }),
  media({ id: "4".repeat(40), nom: "Rushes plage", etat: "introuvable", ajouteLe: "2026-10-10T10:00:00Z", duree: 24 }),
  media({ id: "5".repeat(40), nom: "Affiche", ext: "png", type: "image", ajouteLe: "2026-10-16T10:00:00Z" }),
];

describe("bibliothèque", () => {
  it("recherche sans accents ni casse, mot par mot", () => {
    expect(correspond(M[0], "COTE soleil")).toBe(true);
    expect(correspond(M[0], "coucher wav")).toBe(false);
    expect(correspond(M[1], ".wav")).toBe(true);
    expect(filtrer(M, "audio", "").map((m) => m.nom)).toEqual(["Nappe sonore — côte"]);
    expect(filtrer(M, "tout", "côte")).toHaveLength(2);
  });
  it("tri", () => {
    expect(trier(M, "ajout")[0].nom).toBe("AETHRYON — Le Passage (V3.5)");
    expect(trier(M, "nom")[0].nom).toBe("AETHRYON — Le Passage (V3.5)");
    expect(trier(M, "taille")[0].nom).toBe("AETHRYON — Le Passage (V3.5)");
    expect(trier(M, "duree")[0].nom).toBe("Rushes plage");
  });
  it("décompte et dernier média disponible", () => {
    expect(decompter(M)).toEqual({ tout: 5, video: 3, audio: 1, image: 1, disponibles: 3, enCours: 1, aVerifier: 1 });
    expect(dernierMedia(M)?.nom).toBe("Coucher de soleil sur la côte");
  });
  it("« Importé » vient des imports du panneau, jamais de l'index", () => {
    expect(etatAffiche(M[0], {})).toBe("available");
    expect(etatAffiche(M[0], { [M[0].id]: [{ projet: "Montage-voyage", chutier: "AETHRYON", le: "2026-10-18T01:20:00Z" }] })).toBe("imported");
    expect(etatAffiche(M[2], {})).toBe("running");
    expect(etatAffiche(M[3], {})).toBe("missing");
  });
  it("progression d'un média relié à un transfert", () => {
    const t = { schema: 1, id: "j", titre: null, plateforme: "youtube", format: "mp4", etat: "telechargement" as const, progression: 0.64,
      fichierAttendu: "aethryon — le passage (v3.5).MP4", chemin: null, erreur: null, majLe: "" };
    expect(progressionMedia(M[2], [t])).toBe(0.64);
    expect(progressionMedia(M[0], [t])).toBeNull();
  });
  it("sélection multiple façon Explorateur", () => {
    const ordre = ["a", "b", "c", "d"];
    expect(selectionner([], ordre, "b", "simple", null)).toEqual(["b"]);
    expect(selectionner(["b"], ordre, "d", "bascule", "b")).toEqual(["b", "d"]);
    expect(selectionner(["b", "d"], ordre, "d", "bascule", "b")).toEqual(["b"]);
    expect(selectionner(["b"], ordre, "d", "plage", "b")).toEqual(["b", "c", "d"]);
    expect(selectionner(["c"], ordre, "a", "plage", "c")).toEqual(["a", "b", "c"]);
  });
});

const CEP = { dossier: "C:\\Users\\Élodie\\AppData\\Roaming\\Adobe\\CEP\\extensions\\fr.aethryon.premiere", version: "2.0.1", libelle: "Panneau AETHRYON 2.0.1 installé" };

function inst(p: Partial<Instantane> = {}): Instantane {
  return {
    version: "1.0.0-beta.1", plateforme: "windows",
    config: { schema: 1, dossierMedias: "C:\\M", dossiersSurveilles: ["C:\\M"], surveillance: true, demarrageAuto: false, notifications: { mediaPret: true, importReussi: false, erreurs: true },
      theme: "systeme", reduireAnimations: "systeme", importAuto: false, chutierParDefaut: "aethryon", premiere: { ccxInstalle: "1.0.0-beta.1", installeLe: "2026-10-18T00:00:00Z" } },
    assistantTermine: true, racine: "C:\\R", dossierConfig: "C:\\C", index: { schema: 1, misAJour: "", dossiers: [], medias: M }, transferts: [],
    liaison: { connecte: false, age: null, panneau: null }, imports: { schema: 1, imports: {} },
    premiere: { installations: [], principale: { exe: "C:\\P\\Adobe Premiere Pro.exe", dossier: "C:\\P", version: "26.5.2.13", compatible: true, glisser: false, beta: false, source: "dossier" }, cherche: [], enCours: false },
    creativeCloud: { upia: "C:\\U.exe", application: null }, panneauCep: CEP, nativeMessaging: [], demarrageActif: false, desinstallationPresente: true,
    erreursDossiers: [], journaux: [1, 100], resultats: [], enAttente: [], ...p,
  };
}

describe("liaison avec Premiere Pro (aucun état supposé)", () => {
  it("connecté seulement si le panneau bat", () => {
    const b = { schema: 1, version: "1.0.0-beta.1", battement: "2026-10-18T03:00:00Z", premiereVersion: "26.5.2", projetOuvert: true, projet: "Montage-voyage", visible: true };
    const l = liaison(inst({ liaison: { connecte: true, age: 1, panneau: b } }));
    expect(l.statut).toBe("connecte");
    expect(l.relie).toBe(true);
    expect(l.detail).toBe("Panneau 1.0.0-beta.1 · Montage-voyage.prproj");
    expect(liaison(inst({ liaison: { connecte: false, age: 30, panneau: b } })).statut).toBe("panneau-ferme");
  });
  it("version du panneau : celle du panneau CEP installé, jamais celle d'un ancien .ccx", () => {
    expect(versionsPanneau(inst())).toEqual({ installee: "2.0.1", present: true });
    const b = { schema: 1, version: "2.0.2", battement: "2026-10-18T03:00:00Z", premiereVersion: "26.5.2", projetOuvert: true, projet: "M", visible: true };
    expect(versionsPanneau(inst({ liaison: { connecte: true, age: 1, panneau: b } })).installee).toBe("2.0.2");
    // config.json garde encore ccxInstalle (bêta 1, UXP) : ce n'est pas un panneau installé.
    expect(versionsPanneau(inst({ panneauCep: null }))).toEqual({ installee: null, present: false });
  });
  it("introuvable, trop ancien, non installé", () => {
    expect(liaison(inst({ premiere: { installations: [], principale: null, cherche: [], enCours: null } })).statut).toBe("introuvable");
    const vieux = inst();
    vieux.premiere.principale = { ...vieux.premiere.principale!, version: "25.2.1", compatible: false };
    expect(liaison(vieux).statut).toBe("incompatible");
    const sans = inst({ panneauCep: null });
    expect(sans.config.premiere.ccxInstalle).toBe("1.0.0-beta.1");
    expect(liaison(sans)).toMatchObject({ statut: "panneau-absent", detail: "« Réparer avec AETHRYON Setup » l'installe" });
    expect(liaison(inst()).statut).toBe("panneau-ferme");
    expect(liaison(inst({ plateforme: "autre", premiere: { installations: [], principale: null, cherche: [], enCours: null } })).statut).toBe("inconnu");
  });
  it("« tout fonctionne » seulement si c'est vrai", () => {
    expect(phraseEtat(inst())).toBe("le panneau Premiere Pro n'est pas ouvert.");
    expect(phraseEtat(inst({ erreursDossiers: [["C:\\M", "introuvable"]] }))).toBe("le dossier surveillé est introuvable.");
    expect(versionCourte("26.5.2.13")).toBe("26.5.2");
  });
  it("activité réelle, la plus récente d'abord", () => {
    const i = inst({ imports: { schema: 1, imports: { [M[0].id]: [{ projet: "P", chutier: "AETHRYON", le: "2026-10-18T01:20:00Z" }] } },
      transferts: [{ schema: 1, id: "e", titre: "Version longue", plateforme: "youtube", format: "mp4", etat: "erreur", progression: 0.41, fichierAttendu: null, chemin: null, erreur: "Connexion interrompue", majLe: "2026-10-18T00:41:00Z" }] });
    const a = activites(i, 3);
    expect(a[0].titre).toBe("Importé dans Premiere");
    expect(a.some((x) => x.erreur && x.titre === "Téléchargement interrompu")).toBe(true);
  });
});
