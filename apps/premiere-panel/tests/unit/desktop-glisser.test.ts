import { describe, expect, it } from "vitest";
import { ajouterImports, lireBattement, lireConfigDesktop } from "../../src/lib/desktop";
import { poserFormatsGlisser } from "../../src/lib/glisser";

describe("contrat AETHRYON Desktop (facultatif)", () => {
  it("battement : connecté seulement sous 6 s, illisible = non connecté", () => {
    const t = Date.parse("2026-10-18T10:00:00Z");
    const b = (s: number) => JSON.stringify({ schema: 1, version: "1.0.0", battement: new Date(t - s * 1000).toISOString(), dossierMedias: "C:\\M" });
    expect(lireBattement(b(2), t)).toMatchObject({ installe: true, connecte: true, version: "1.0.0", dossierMedias: "C:\\M" });
    expect(lireBattement(b(7), t).connecte).toBe(false);
    expect(lireBattement("{ en cours d'écrit", t)).toMatchObject({ installe: true, connecte: false });
    expect(lireBattement(null, t).installe).toBe(false);
  });
  it("config.json : dossier des médias absolu seulement", () => {
    expect(lireConfigDesktop(JSON.stringify({ schema: 1, dossierMedias: "D:\\Médias" })).dossierMedias).toBe("D:\\Médias");
    expect(lireConfigDesktop(JSON.stringify({ schema: 1, dossierMedias: "relatif" })).dossierMedias).toBeNull();
  });
  it("imports.json : ajoute sans perdre l'existant", () => {
    const a = ajouterImports(null, ["id1"], "Projet", "AETHRYON");
    const b = JSON.parse(ajouterImports(a, ["id1", "id2"], "Projet", "AETHRYON"));
    expect(b.schema).toBe(1);
    expect(b.imports.id1).toHaveLength(2);
    expect(b.imports.id2).toHaveLength(1);
  });
});

describe("glisser vers Premiere", () => {
  it("pose com.adobe.cep.dnd.file.N pour chaque chemin, puis les formats standard, sans qu'un refus n'arrête les autres", () => {
    const poses: Record<string, string> = {};
    const dt = {
      setData(type: string, v: string) {
        if (type === "application/x-cef-dnd-file") throw new Error("refusé");
        poses[type] = v;
      },
      effectAllowed: "all",
    } as unknown as DataTransfer;
    const r = poserFormatsGlisser(dt, ["C:\\M\\a b.mp4", "C:\\M\\c.mp3"], (c) => "file:///" + c.replace(/\\/g, "/").replace(/ /g, "%20"));
    expect(r).toEqual(["com.adobe.cep.dnd.file.0", "com.adobe.cep.dnd.file.1", "text/uri-list", "text/plain"]);
    expect(poses["com.adobe.cep.dnd.file.0"]).toBe("C:\\M\\a b.mp4");
    expect(poses["text/uri-list"]).toBe("file:///C:/M/a%20b.mp4\r\nfile:///C:/M/c.mp3");
    expect((dt as unknown as { effectAllowed: string }).effectAllowed).toBe("copy");
  });
});
