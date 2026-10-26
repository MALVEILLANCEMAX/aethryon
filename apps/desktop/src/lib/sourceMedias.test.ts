import { describe, expect, it } from "vitest";
import { vueInstantane } from "./sourceMedias";
import { media } from "./essais/fixtures";

const M = [
  media({ id: "1".repeat(40), nom: "Été à la côte", type: "video", ajouteLe: "2026-10-20T10:00:00Z" }),
  media({ id: "2".repeat(40), nom: "Nappe sonore", ext: "wav", type: "audio", ajouteLe: "2026-10-21T10:00:00Z" }),
  media({ id: "3".repeat(40), nom: "Plan 10", type: "video", ajouteLe: "2026-10-19T10:00:00Z" }),
  media({ id: "4".repeat(40), nom: "Plan 9", type: "image", ext: "png", ajouteLe: "2026-10-18T10:00:00Z" }),
];

describe("source « instantané » de la Bibliothèque", () => {
  it("filtre, recherche sans accents, tri naturel, plages", () => {
    const v = vueInstantane(M, { filtre: "tout", recherche: "", tri: "nom" });
    expect(v.total).toBe(4);
    expect(v.lire(0, 4).map((m) => m!.nom)).toEqual(["Été à la côte", "Nappe sonore", "Plan 9", "Plan 10"]);
    expect(v.lire(1, 2).map((m) => m!.nom)).toEqual(["Nappe sonore"]);
    const r = vueInstantane(M, { filtre: "video", recherche: "ete", tri: "ajout" });
    expect(r.total).toBe(1);
    expect(r.rang("1".repeat(40))).toBe(0);
    expect(r.rang("2".repeat(40))).toBe(-1);
    expect(r.ordre).toEqual(["1".repeat(40)]);
  });
  it("les décomptes des puces suivent la recherche, pas le filtre de type", () => {
    const v = vueInstantane(M, { filtre: "audio", recherche: "plan", tri: "ajout" });
    expect(v.total).toBe(0);
    expect(v.decompte).toMatchObject({ tout: 2, video: 1, image: 1, audio: 0 });
  });
  it("50 000 médias : requête complète en moins de 400 ms (filtre, tri, recherche)", () => {
    const grand = Array.from({ length: 50_000 }, (_, i) => media({ id: i.toString(16).padStart(40, "0"), nom: `Plan ${i} — côte`, ajouteLe: new Date(1_700_000_000_000 + i * 1000).toISOString() }));
    const t = performance.now();
    const v = vueInstantane(grand, { filtre: "tout", recherche: "cote 4", tri: "nom" });
    const d = performance.now() - t;
    expect(v.total).toBeGreaterThan(0);
    expect(d).toBeLessThan(400);
  });
});

describe("empreinte des médias (relecture de l'instantané toutes les 5 s)", () => {
  it("identique si rien ne change, différente au moindre changement visible", async () => {
    const { empreinteMedias } = await import("./sourceMedias");
    const a = empreinteMedias(M);
    expect(empreinteMedias(M.map((m) => ({ ...m })))).toBe(a);
    expect(empreinteMedias(M.map((m, i) => (i === 1 ? { ...m, etat: "en-cours" as const } : m)))).not.toBe(a);
    expect(empreinteMedias(M.map((m, i) => (i === 2 ? { ...m, miniature: "miniatures/x.jpg" } : m)))).not.toBe(a);
    expect(empreinteMedias(M.map((m, i) => (i === 0 ? { ...m, duree: 12 } : m)))).not.toBe(a);
    expect(empreinteMedias(M.slice(1))).not.toBe(a);
  });
});
