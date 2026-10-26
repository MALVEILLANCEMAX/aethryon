import { describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (c: string) => `http://asset.localhost/${encodeURIComponent(c)}` }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  analyserVisibles, basculerVolume, ChargeurPages, cibleDossier, cibleTous, cibleVolume, estImportable, evenementsIndex, iconeVolume, indexApi,
  libelleProgression, libelleVolume, occupation, pourcentage, requete, resumeCourt, urlMiniatureIndex, volumeCoche,
  type ElementIndex, type PageIndex, type ProgressionScan, type ResumeScan,
} from "./index-medias";

const bilan = { nouveaux: 0, modifies: 0, renommes: 0, deplaces: 0, supprimes: 0, doublons: 0, inchanges: 0, retrouves: 0, indisponibles: 0, retires: 0 };
const prog = (p: Partial<ProgressionScan>): ProgressionScan => ({
  scan: 1, phase: "parcours", mode: "natif", cibles: ["D:\\"], fichiersVus: 12400, dossiers: 800, medias: { video: 1000, audio: 200, image: 4 }, octets: 0,
  erreurs: 0, liensIgnores: 0, exclus: 0, bouclesEvitees: 0, bilan, mesurable: false, fraction: null, dossierCourant: null, debit: 0, ecouleMs: 0, ...p,
});
const el = (id: string, p: Partial<ElementIndex> = {}): ElementIndex => ({
  id, chemin: `D:\\${id}.mp4`, dossier: "D:\\", nom: id, ext: "mp4", type: "video", taille: 1, modifieLe: "2026-10-25T10:00:00Z", ajouteLe: "2026-10-25T10:00:00Z",
  duree: null, largeur: null, hauteur: null, ips: null, codecVideo: null, codecAudio: null, titre: null, artistes: [], album: null, annee: null, miniature: null,
  etatMiniature: "a-faire", etat: "present", etatBibliotheque: null, sources: ["index"], volume: "D:\\", doublons: 0, doublonDe: null, enLigne: false,
  premiereCompatible: null, ...p,
});

describe("AETHRYON Index : progression et résumés", () => {
  it("jamais de pourcentage inventé : indéterminé sans total réel", () => {
    expect(pourcentage(prog({}))).toBeNull();
    expect(pourcentage(prog({ mesurable: true, fraction: 0.426 }))).toBe(43);
    expect(pourcentage(prog({ mesurable: false, fraction: 0.5 }))).toBeNull();
    expect(pourcentage({ phase: "miniatures", fait: 30, total: 120, actif: true })).toBe(25);
    expect(pourcentage({ phase: "repos", fait: 0, total: 0, actif: false })).toBeNull();
    expect(pourcentage({ etape: "miniatures", fait: 5, total: 10, message: null })).toBe(50);
  });

  it("libellés courts, nombres à la française", () => {
    expect(libelleProgression(prog({}))).toBe("12\u202F400\u00A0fichiers parcourus · 1\u202F204\u00A0médias");
    expect(libelleProgression(prog({ phase: "everything", mesurable: true, fraction: 0.5 }))).toContain("50\u00A0%");
    expect(libelleProgression(prog({ phase: "preparation" }))).toBe("Préparation du scan…");
    const r = { medias: { video: 1204, audio: 1, image: 0 }, erreurs: 3 } as ResumeScan;
    expect(resumeCourt(r)).toBe("1\u202F204\u00A0vidéos · 1\u00A0audio · 0\u00A0image · 3\u00A0erreurs");
    expect(resumeCourt({ ...r, erreurs: 0 })).not.toContain("erreur");
  });
});

describe("AETHRYON Index : cibles et volumes", () => {
  const c = { racine: "C:\\", disponible: true };
  const d = { racine: "D:\\", disponible: true };
  const e = { racine: "E:\\", disponible: false };
  it("cocher, décocher, remplacer « tous »", () => {
    let l = basculerVolume([], d);
    expect(l).toEqual([cibleVolume(d)]);
    expect(volumeCoche(l, { racine: "d:" })).toBe(true);
    l = basculerVolume(l, d);
    expect(l).toEqual([]);
    const tous = [cibleTous(), cibleDossier("C:\\Users\\Élodie\\Vidéos")];
    expect(volumeCoche(tous, c)).toBe(true);
    expect(basculerVolume(tous, c, [c, d, e])).toEqual([cibleVolume(d), cibleDossier("C:\\Users\\Élodie\\Vidéos")]);
  });

  it("icônes, libellés, occupation", () => {
    expect(iconeVolume({ genre: "fixe", disponible: true, systeme: true })).toBe("systeme");
    expect(iconeVolume({ genre: "amovible", disponible: true, systeme: false })).toBe("amovible");
    expect(iconeVolume({ genre: "reseau", disponible: false, systeme: false })).toBe("indisponible");
    expect(libelleVolume({ lettre: "E", nom: "CLÉ USB", racine: "E:\\" })).toBe("E: — CLÉ USB");
    expect(libelleVolume({ lettre: "D", nom: null, racine: "D:\\" })).toBe("D:");
    expect(occupation({ taille: 1000, libre: 250 })).toBe(0.75);
    expect(occupation({ taille: null, libre: 1 })).toBeNull();
  });
});

describe("AETHRYON Index : éléments et pagination", () => {
  it("miniature avec invalidation du cache ; import Premiere réservé à index.json", () => {
    expect(urlMiniatureIndex(el("a"))).toBeNull();
    expect(urlMiniatureIndex(el("a", { miniature: "D:\\AETHRYON\\Index\\miniatures\\01\\1.jpg" }))).toBe(
      "http://asset.localhost/D%3A%5CAETHRYON%5CIndex%5Cminiatures%5C01%5C1.jpg?v=2026-10-25T10%3A00%3A00Z",
    );
    expect(estImportable(el("a"))).toBe(false);
    expect(estImportable(el("a", { sources: ["index", "bibliotheque"], etatBibliotheque: "disponible" }))).toBe(true);
    expect(estImportable(el("a", { sources: ["bibliotheque"], etatBibliotheque: "en-cours" }))).toBe(false);
    expect(requete({ texte: "côte" })).toEqual({ texte: "côte", page: 1, taillePage: 100, tri: "ajout" });
  });

  it("défilement infini : pages successives, réponse périmée ignorée, fin détectée", async () => {
    const tous = Array.from({ length: 250 }, (_, i) => el(`m${i}`));
    let appels = 0;
    const lent = { resoudre: null as null | (() => void) };
    const charger = async (r: { page?: number; taillePage?: number; texte?: string }): Promise<PageIndex> => {
      appels++;
      if (r.texte === "lent") await new Promise<void>((ok) => (lent.resoudre = ok));
      const t = r.taillePage ?? 100;
      const p = r.page ?? 1;
      return { elements: tous.slice((p - 1) * t, p * t), total: tous.length, page: p, taillePage: t, pages: Math.ceil(tous.length / t), dureeMs: 1 };
    };
    const c = new ChargeurPages(charger, {}, 100);
    await c.reinitialiser({});
    expect(c.elements.length).toBe(100);
    expect(await c.suivante()).toBe(true);
    expect(await c.suivante()).toBe(true);
    expect(c.elements.length).toBe(250);
    expect(c.fini).toBe(true);
    expect(await c.suivante()).toBe(false);
    expect(appels).toBe(3);
    // Requête changée pendant un chargement lent : la vieille réponse n'écrase rien.
    const vieux = c.reinitialiser({ texte: "lent" });
    await Promise.resolve();
    const neuf = c.reinitialiser({ texte: "rapide" });
    lent.resoudre?.();
    await Promise.all([vieux, neuf]);
    expect(c.elements.length).toBe(100);
  });
});

describe("AETHRYON Index : appels au cœur", () => {
  it("noms de commandes et d'arguments exacts", async () => {
    const inv = vi.mocked(invoke);
    inv.mockResolvedValue(undefined);
    await indexApi.lancerScan([cibleTous()]);
    expect(inv).toHaveBeenLastCalledWith("index_scan_lancer", { cibles: [{ genre: "tous", chemin: "" }] });
    await indexApi.lancerScan();
    expect(inv).toHaveBeenLastCalledWith("index_scan_lancer", { cibles: null });
    await indexApi.bibliotheque(requete({ types: ["audio"] }));
    expect(inv).toHaveBeenLastCalledWith("bibliotheque_requete", { requete: { texte: "", page: 1, taillePage: 100, tri: "ajout", types: ["audio"] } });
    await indexApi.modifierReglages({ types: { image: false }, everything: "auto" });
    expect(inv).toHaveBeenLastCalledWith("index_reglages_modifier", { modif: { types: { image: false }, everything: "auto" } });
    await indexApi.resume();
    expect(inv).toHaveBeenLastCalledWith("index_resume", { scan: null });
    await indexApi.action("a".repeat(40), "explorateur");
    expect(inv).toHaveBeenLastCalledWith("index_media_action", { id: "a".repeat(40), action: "explorateur" });
    await evenementsIndex.progression(() => {});
    expect(vi.mocked(listen)).toHaveBeenCalledWith("index-progression", expect.any(Function));
  });

  it("analyse des vidéos visibles par le WebView2, échec compris", async () => {
    const inv = vi.mocked(invoke);
    inv.mockReset();
    inv.mockImplementation(async (cmd: string) => (cmd === "index_miniatures_demander" ? [{ id: "v1", chemin: "D:\\a.mp4", type: "video", ext: "mp4" }, { id: "v2", chemin: "D:\\b.mkv", type: "video", ext: "mkv" }] : undefined));
    const analyser = vi.fn(async (a: { id: string }) => {
      if (a.id === "v2") throw new Error("codec");
      return { duree: 12, largeur: 1280, hauteur: 720, jpeg: "data:image/jpeg;base64,AAAA" };
    });
    expect(await analyserVisibles(["v1", "v2", "i1"], analyser)).toBe(2);
    expect(inv).toHaveBeenCalledWith("index_miniatures_demander", { ids: ["v1", "v2", "i1"] });
    expect(inv).toHaveBeenCalledWith("index_analyse_enregistrer", { id: "v1", analyse: { duree: 12, largeur: 1280, hauteur: 720, echec: false }, jpeg: "data:image/jpeg;base64,AAAA" });
    expect(inv).toHaveBeenCalledWith("index_analyse_enregistrer", { id: "v2", analyse: { duree: null, largeur: null, hauteur: null, echec: true }, jpeg: null });
    expect(await analyserVisibles([], analyser)).toBe(0);
  });
});
