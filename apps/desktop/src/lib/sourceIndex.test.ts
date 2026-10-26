import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (c: string) => `asset://${c}` }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { sourcesDe, versMedia } from "./sourceIndex";
import type { ElementIndex } from "./index-medias";
import { media } from "./essais/fixtures";

const E = (p: Partial<ElementIndex>): ElementIndex => ({
  id: "9".repeat(40), chemin: "D:\\Rushes\\Plage.mp4", dossier: "D:\\Rushes", nom: "Plage", ext: "mp4", type: "video", taille: 1000, modifieLe: "2026-10-24T10:00:00Z",
  ajouteLe: "2026-10-25T09:00:00Z", duree: 12, largeur: 1920, hauteur: 1080, ips: 25, codecVideo: "h264", codecAudio: "aac", titre: null, artistes: [], album: null, annee: null,
  miniature: "D:\\AETHRYON\\Index\\miniatures\\9.jpg", etatMiniature: "faite", etat: "present", etatBibliotheque: null, sources: ["index"], volume: "D:\\", doublons: 0, doublonDe: null,
  enLigne: false, premiereCompatible: true, ...p,
});

describe("source paginée d'AETHRYON Index (Nocturne-2)", () => {
  it("un média scanné devient un Media marqué « indexe », jamais importable par le panneau, avec sa miniature d'index", () => {
    const m = versMedia(E({}), new Map());
    expect(m.etat).toBe("disponible");
    expect(m.indexe).toMatchObject({ sources: ["index"], volume: "D:\\", dossier: "D:\\Rushes", importable: false, etatFichier: "present" });
    expect(m.indexe?.miniatureUrl).toContain("asset://D:\\AETHRYON\\Index\\miniatures\\9.jpg");
    expect(versMedia(E({ etat: "indisponible" }), new Map()).etat).toBe("introuvable");
  });
  it("un média d'index.json garde l'objet de l'instantané (états, transferts) et devient importable s'il est disponible", () => {
    const b = media({ id: "9".repeat(40), nom: "Plage", etat: "en-cours" });
    const m = versMedia(E({ sources: ["bibliotheque", "index"], etatBibliotheque: "disponible" }), new Map([[b.id, b]]));
    expect(m.etat).toBe("en-cours");
    expect(m.indexe?.importable).toBe(true);
  });
  it("origine → sources de la requête (vide = toutes)", () => {
    expect(sourcesDe("tout")).toEqual([]);
    expect(sourcesDe("scannes")).toEqual(["index", "everything"]);
  });
});
