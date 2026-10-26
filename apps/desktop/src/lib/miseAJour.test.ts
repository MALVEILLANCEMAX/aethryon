import { describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
import { invoke } from "@tauri-apps/api/core";
import { installer, rechercher, resume, type Recherche } from "./miseAJour";

const R: Recherche = { actuelle: "1.0.0-beta.4", disponible: true, annonce: { version: "1.0.0-beta.5", fichier: "AETHRYON-Setup-2.0.0-beta.4.exe", sha256: "a".repeat(64), taille: 1000, publiee: "2026-10-21", notes: [] } };

describe("mise à jour d'AETHRYON Desktop", () => {
  it("résume chaque phase sans rien inventer", () => {
    expect(resume({ phase: "disponible", recherche: R }, "1.0.0-beta.4").titre).toBe("Version 1.0.0-beta.5 disponible");
    expect(resume({ phase: "telechargement", recherche: R, fait: 420, total: 1000 }, "x").titre).toBe("Téléchargement du setup · 42 %");
    expect(resume({ phase: "a-jour", recherche: { ...R, disponible: false } }, "1.0.0-beta.4").detail).toContain("1.0.0-beta.4");
    expect(resume({ phase: "erreur", erreur: "Site injoignable" }, "x").detail).toBe("Site injoignable");
    expect(resume({ phase: "inconnu" }, "1.0.0-beta.4").detail).toContain("sans votre clic");
  });

  it("recherche discrète : un échec ne montre rien ; installer n'est appelé que sur demande", async () => {
    const inv = vi.mocked(invoke);
    inv.mockRejectedValueOnce("Site injoignable : vérifie la connexion à Internet.");
    await rechercher(true);
    expect(inv).toHaveBeenCalledWith("maj_rechercher");
    expect(inv).not.toHaveBeenCalledWith("maj_installer");
    inv.mockResolvedValueOnce(R);
    await rechercher();
    inv.mockResolvedValueOnce(undefined);
    await installer();
    expect(inv).toHaveBeenLastCalledWith("maj_installer");
  });
});
