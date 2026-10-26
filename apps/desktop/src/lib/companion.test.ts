import { describe, expect, it } from "vitest";
import { astuceUnParUn, detecter, etatCompanion, intervalleClignement, memoriser, DUREE_ERREUR, DUREE_SUCCES, type Causes, type EvtLocal } from "./companion";
import { instantane, media, resultat, transfert } from "./essais/fixtures";

const RIEN: Causes = { envois: 0, copies: 0, survol: false };
const A = media({ id: "1".repeat(40), nom: "Coucher de soleil sur la côte", etat: "en-cours" });
const B = media({ id: "2".repeat(40), nom: "Nappe sonore", etat: "en-cours" });

describe("companion : déclencheurs réels à partir de deux instantanés", () => {
  it("premier instantané : aucun fait", () => {
    expect(detecter(null, instantane({ medias: [{ ...A, etat: "disponible" }] }), 0)).toEqual([]);
  });
  it("média devenu disponible (en cours ou absent avant) → Success « Prêt : nom »", () => {
    const e = detecter(instantane({ medias: [A] }), instantane({ medias: [{ ...A, etat: "disponible" }, { ...B, etat: "disponible" }] }), 100);
    expect(e.map((x) => x.texte)).toEqual(["Prêt : Coucher de soleil sur la côte", "Prêt : Nappe sonore"]);
    expect(detecter(instantane({ medias: [{ ...A, etat: "disponible" }] }), instantane({ medias: [{ ...A, etat: "disponible" }] }), 1)).toEqual([]);
  });
  it("transfert passé en erreur (pas déjà en erreur) → Error soft", () => {
    const av = instantane({ transferts: [transfert({ id: "t", etat: "telechargement" })] });
    const ap = instantane({ transferts: [transfert({ id: "t", etat: "erreur", titre: "Version longue" })] });
    expect(detecter(av, ap, 5)).toEqual([expect.objectContaining({ type: "erreur", texte: "Transfert interrompu : Version longue" })]);
    expect(detecter(ap, ap, 6)).toEqual([]);
  });
  it("résultat du panneau : ok → « Importé dans Montage-voyage », ok: false → « Import non effectué »", () => {
    const av = instantane();
    expect(detecter(av, instantane({ resultats: [resultat({})] }), 1)[0]).toMatchObject({ type: "succes", texte: "Importé dans Montage-voyage" });
    expect(detecter(av, instantane({ resultats: [resultat({ ok: false, message: "Aucun projet" })] }), 1)[0]).toMatchObject({ type: "erreur", texte: "Import non effectué" });
  });
  it("dédoublonnage : le même fait vu deux fois ne compte qu'une fois", () => {
    const e: EvtLocal = { type: "succes", le: 1, texte: "x", cle: "envoi:c1" };
    expect(memoriser(memoriser([], [e]), [{ ...e, le: 2 }])).toHaveLength(1);
  });
});

describe("companion : priorités et durées", () => {
  const i = instantane({ transferts: [transfert({ etat: "telechargement" }), transfert({ id: "t2", etat: "conversion" })] });
  it("Error soft > Success > Processing > Hint > Curious > Idle", () => {
    const ok: EvtLocal = { type: "succes", le: 1000, texte: "Prêt : A", famille: "pret" };
    const ko: EvtLocal = { type: "erreur", le: 1000, texte: "Import non effectué" };
    const tout = { ...RIEN, envois: 1, survol: true, astuce: { cle: "a", texte: "Astuce" } };
    expect(etatCompanion(i, [ok, ko], tout, 1100, "expressive").etat).toBe("error");
    expect(etatCompanion(i, [ok], tout, 1100, "expressive").etat).toBe("success");
    expect(etatCompanion(i, [], tout, 1100, "expressive")).toMatchObject({ etat: "processing", texte: "Import demandé au panneau…" });
    expect(etatCompanion(instantane(), [], { ...tout, envois: 0 }, 1100, "expressive").etat).toBe("hint");
    expect(etatCompanion(instantane(), [], { ...RIEN, survol: true }, 1100, "expressive").etat).toBe("curious");
    expect(etatCompanion(instantane(), [], RIEN, 1100, "discrete")).toMatchObject({ etat: "idle", texte: "Tout est calme" });
  });
  it("Processing : « 2 transferts en cours »", () => {
    expect(etatCompanion(i, [], RIEN, 0, "discrete")).toMatchObject({ etat: "processing", texte: "2\u00a0transferts en cours", cible: { section: "transferts" } });
    expect(etatCompanion(instantane(), [], { ...RIEN, copies: 3 }, 0, "discrete").texte).toBe("Copie de 3\u00a0fichiers…");
  });
  it("Success dure 1 600 ms ; Error soft 8 000 ms ou jusqu'à une visite de Transferts", () => {
    const ok: EvtLocal = { type: "succes", le: 1000, texte: "Prêt : A", famille: "pret" };
    expect(etatCompanion(instantane(), [ok], RIEN, 1000 + DUREE_SUCCES - 1, "discrete")).toMatchObject({ etat: "success", jusqua: 1000 + DUREE_SUCCES });
    expect(etatCompanion(instantane(), [ok], RIEN, 1000 + DUREE_SUCCES, "discrete").etat).toBe("idle");
    const ko: EvtLocal = { type: "erreur", le: 1000, texte: "Transfert interrompu : x" };
    expect(etatCompanion(instantane(), [ko], RIEN, 1000 + DUREE_ERREUR - 1, "discrete").etat).toBe("error");
    expect(etatCompanion(instantane(), [ko], RIEN, 1000 + DUREE_ERREUR, "discrete").etat).toBe("idle");
    expect(etatCompanion(instantane(), [ko, { type: "visite-transferts", le: 1500, texte: "" }], RIEN, 1600, "discrete").etat).toBe("idle");
  });
  it("arrivées groupées sur 2 s : UN seul Success (même clé), texte « 3 médias prêts »", () => {
    const e = [0, 900, 1800].map((le, k) => ({ type: "succes" as const, le, texte: `Prêt : ${k}`, famille: "pret" as const }));
    const s1 = etatCompanion(instantane(), e.slice(0, 1), RIEN, 100, "discrete");
    const s3 = etatCompanion(instantane(), e, RIEN, 1900, "discrete");
    expect(s3.texte).toBe("3\u00a0médias prêts");
    expect(s3.cle).toBe(s1.cle);
    expect(s3.jusqua).toBe(1800 + DUREE_SUCCES);
    const loin = [...e, { type: "succes" as const, le: 5000, texte: "Prêt : 4", famille: "pret" as const }];
    expect(etatCompanion(instantane(), loin, RIEN, 5100, "discrete")).toMatchObject({ texte: "Prêt : 4" });
  });
  it("trois niveaux de présence et mouvement réduit", () => {
    const astuce = { ...RIEN, astuce: { cle: "un-par-un", texte: "Astuce" } };
    expect(etatCompanion(instantane(), [], astuce, 0, "expressive").etat).toBe("hint");
    expect(etatCompanion(instantane(), [], astuce, 0, "discrete").etat).toBe("idle");
    expect(etatCompanion(instantane(), [], astuce, 0, "muette")).toMatchObject({ etat: "idle", animee: false });
    expect(etatCompanion(instantane(), [], RIEN, 0, "discrete", true).animee).toBe(false);
    expect(etatCompanion(instantane(), [], RIEN, 0, "expressive", false).animee).toBe(true);
    expect(intervalleClignement("muette", 0.5)).toBeNull();
    expect(intervalleClignement("expressive", 0)).toBe(4000);
    expect(intervalleClignement("expressive", 0.999)).toBeLessThan(7000);
    expect(intervalleClignement("discrete", 0)).toBe(8000);
    expect(intervalleClignement("discrete", 0.999)).toBeLessThan(14000);
  });
  it("astuce « un par un » : trois imports d'un média en moins de 60 s", () => {
    expect(astuceUnParUn([0, 10_000, 59_000], 59_500)).toBe(true);
    expect(astuceUnParUn([0, 10_000, 59_000], 61_000)).toBe(false);
  });
});

describe("Nocturne : apparence de la chouette", () => {
  it("relie chaque état réel à une apparence distincte (réussite ≠ erreur, téléchargement ≠ chargement)", async () => {
    const { apparenceDe } = await import("./companion");
    expect(apparenceDe({ etat: "idle", cle: "idle" })).toBe("repos");
    expect(apparenceDe({ etat: "curious", cle: "curious" })).toBe("attention");
    expect(apparenceDe({ etat: "hint", cle: "astuce:x" })).toBe("attention");
    expect(apparenceDe({ etat: "processing", cle: "processing:transferts" })).toBe("telechargement");
    expect(apparenceDe({ etat: "processing", cle: "processing:copie" })).toBe("chargement");
    expect(apparenceDe({ etat: "processing", cle: "processing:scan" })).toBe("scan");
    expect(apparenceDe({ etat: "success", cle: "succes:1" })).toBe("reussite");
    expect(apparenceDe({ etat: "error", cle: "erreur:1" })).toBe("erreur");
  });
  it("progression des transferts : moyenne des valeurs transmises, sinon inconnue", async () => {
    const { progressionTransferts } = await import("./companion");
    const t = (etat: string, progression: number | null) => ({ etat, progression }) as never;
    expect(progressionTransferts({ transferts: [] })).toBeNull();
    expect(progressionTransferts({ transferts: [t("attente", null), t("telechargement", null)] })).toBeNull();
    expect(progressionTransferts({ transferts: [t("telechargement", 0.6), t("conversion", 0.2), t("pret", 1)] })).toBeCloseTo(0.4);
  });
});

describe("Nocturne : activité signalée par un module (scanner)", () => {
  it("une analyse en cours devient « Processing » avec la clé processing:scan, après les envois et les copies", async () => {
    const { etatCompanion, apparenceDe } = await import("./companion");
    const ext = { externes: [{ cle: "scan", texte: "Analyse de D: · 1 204 fichiers", cible: { section: "bibliotheque" as const } }] };
    const s = etatCompanion(instantane({}), [], { ...RIEN, ...ext }, 0, "discrete");
    expect(s.etat).toBe("processing");
    expect(s.cle).toBe("processing:scan");
    expect(apparenceDe(s)).toBe("scan");
    expect(etatCompanion(instantane({}), [], { ...RIEN, copies: 2, ...ext }, 0, "discrete").cle).toBe("processing:copie");
  });
});
