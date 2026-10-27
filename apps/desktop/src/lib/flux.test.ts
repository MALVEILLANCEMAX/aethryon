// Essais du flux (glisser-déposer) avec des événements Tauri SIMULÉS : bus d'événements, commandes du cœur, zones
// et minuteries remplacés. Rien ici ne démontre le glisser natif sous Windows (voir TESTS-MANUELS.md, section F).
import { describe, expect, it } from "vitest";
import {
  creerFlux, envoyerVersPremiere, EVENEMENTS, importerFichiers, verdictPour, versCss,
  type BilanImport, type Classement, type Dependances, type FinGlisser, type OpEnvoi, type OpImport, type OpSurveiller,
} from "./flux";
import type { Media, ResultatEnvoi } from "./types";

const ID = "1".repeat(40);
const ID2 = "2".repeat(40);
const PLAGE = "C:\\Users\\Élodie\\Downloads\\AETHRYON\\Plage.mp4";
const CLIP = "D:\\Rushes\\Clip nuit.mov";
const NOTES = "D:\\Rushes\\notes.txt";
const DOSSIER = "D:\\Rushes\\Voyage";

type Rappel = (e: { payload: unknown }) => void;

/** Banc : bus d'événements, commandes du cœur programmables, zones en pixels CSS, temps simulé. */
function banc(o: { ratio?: number; listenLent?: boolean } = {}) {
  const ecouteurs = new Map<string, Set<Rappel>>();
  const appels: { cmd: string; args?: Record<string, unknown> }[] = [];
  const reponses: Record<string, (a: Record<string, unknown>) => unknown> = {};
  const marques: { etat: string | null; flux: string | null; glisser: boolean }[] = [];
  const minuteries = new Map<number, { f: () => void; a: number }>();
  let maintenant = 1000;
  let n = 0;
  const lents: (() => void)[] = [];
  const zones = [
    { nom: "premiere", x0: 0, y0: 0, x1: 100, y1: 100 },
    { nom: "bibliotheque", x0: 100, y0: 0, x1: 400, y1: 300 },
    { nom: "transferts", x0: 400, y0: 0, x1: 500, y1: 100 },
  ];
  const deps: Partial<Dependances> = {
    invoke: async <T,>(cmd: string, args?: Record<string, unknown>) => {
      appels.push({ cmd, args });
      const f = reponses[cmd];
      if (!f) throw `Commande non programmée : ${cmd}`;
      return (await f(args ?? {})) as T;
    },
    listen: async <T,>(ev: string, f: (e: { payload: T }) => void) => {
      if (o.listenLent) await new Promise<void>((r) => lents.push(r));
      const s = ecouteurs.get(ev) ?? new Set<Rappel>();
      s.add(f as Rappel);
      ecouteurs.set(ev, s);
      return () => {
        s.delete(f as Rappel);
      };
    },
    zoneSous: (x, y) => {
      const z = zones.find((z) => x >= z.x0 && x < z.x1 && y >= z.y0 && y < z.y1);
      return z ? { nom: z.nom } : null;
    },
    ratio: () => o.ratio ?? 1.5,
    planifier: (f) => f(),
    minuterie: (f, ms) => {
      n += 1;
      minuteries.set(n, { f, a: maintenant + ms });
      return n;
    },
    annulerMinuterie: (id) => {
      minuteries.delete(id as number);
    },
    maintenant: () => maintenant,
    marquer: (_el, etat, r) => {
      marques.push({ etat, flux: r.flux, glisser: r.glisser });
    },
  };
  const emettre = (ev: string, payload: unknown) => {
    for (const f of [...(ecouteurs.get(ev) ?? [])]) f({ payload });
  };
  const avancer = (ms: number) => {
    maintenant += ms;
    for (const [id, m] of [...minuteries]) {
      if (m.a <= maintenant) {
        minuteries.delete(id);
        m.f();
      }
    }
  };
  const nbEcouteurs = () => [...ecouteurs.values()].reduce((a, s) => a + s.size, 0);
  const appelsDe = (cmd: string) => appels.filter((a) => a.cmd === cmd);
  return { deps, emettre, avancer, appels, appelsDe, reponses, marques, nbEcouteurs, lents, minuteries };
}

/** Laisse s'écouler toutes les promesses en attente. */
const vider = () => new Promise((r) => setTimeout(r, 0));

/** Position physique (Tauri) d'un point CSS avec un ratio de 1,5 (mise à l'échelle 150 %). */
const phys = (x: number, y: number, ratio = 1.5) => ({ x: x * ratio, y: y * ratio });

const resultat = (p: Partial<ResultatEnvoi>): ResultatEnvoi => ({ nom: "N1.json", action: "importer", ids: [ID], ok: true, message: "", le: "2026-10-23T20:00:00Z", expire: false, ...p });
const fin = (p: Partial<FinGlisser>): FinGlisser => ({ jeton: "g1", resultat: "depose", effet: "copie", cible: "interne", application: null, fichiers: 1, message: null, ...p });
const media = (p: Partial<Media>): Media => ({
  id: ID, chemin: PLAGE, nom: "Plage", ext: "mp4", type: "video", taille: 10, ajouteLe: "", modifieLe: "", duree: null, largeur: null, hauteur: null, ips: null,
  codecVideo: null, codecAudio: null, miniature: null, etat: "disponible", premiereCompatible: true, origine: { plateforme: "local", titre: null }, ...p,
});

describe("flux : positions et verdicts (fonctions pures)", () => {
  it("convertit les pixels physiques de Tauri en pixels CSS selon le facteur d'échelle", () => {
    expect(versCss({ x: 300, y: 150 }, 1.5)).toEqual({ x: 200, y: 100 });
    expect(versCss({ x: 250, y: 125 }, 1.25)).toEqual({ x: 200, y: 100 });
    expect(versCss({ x: 10, y: 20 }, 0)).toEqual({ x: 10, y: 20 });
    expect(versCss({ x: 10, y: 20 }, Number.NaN)).toEqual({ x: 10, y: 20 });
  });

  it("juge chaque zone sans rien inventer", () => {
    const vide: Classement = { medias: [], fichiers: [], dossiers: [], refuses: [] };
    expect(verdictPour("premiere", null, {}, "externe").enAttente).toBe(true);
    expect(verdictPour("premiere", { ...vide, medias: [ID] }, {}, "aethryon")).toEqual({ acceptable: true, actions: ["envoyer-premiere"], raison: null });
    expect(verdictPour("premiere", { ...vide, medias: [ID] }, { premiereConnecte: false }, "aethryon").raison).toContain("n'est pas connecté");
    expect(verdictPour("premiere", { ...vide, medias: [ID] }, { medias: [media({ etat: "en-cours" })] }, "aethryon").raison).toBe("« Plage » n'est pas disponible pour l'instant.");
    expect(verdictPour("premiere", { ...vide, fichiers: [{ chemin: CLIP, nom: "Clip nuit.mov", taille: 1, type: "video" }] }, {}, "externe").raison).toContain("Ajoute d'abord");
    expect(verdictPour("bibliotheque", { ...vide, medias: [ID] }, {}, "aethryon").raison).toBe("Déjà dans la bibliothèque.");
    const mixte: Classement = { ...vide, fichiers: [{ chemin: CLIP, nom: "Clip nuit.mov", taille: 1, type: "video" }], dossiers: [{ chemin: DOSSIER, nom: "Voyage", surveille: false, surveillable: true, raison: null }] };
    expect(verdictPour("bibliotheque", mixte, {}, "externe").actions).toEqual(["importer", "surveiller"]);
    expect(verdictPour("bibliotheque", { ...vide, dossiers: [{ ...mixte.dossiers[0], surveillable: false, surveille: true, raison: "Déjà surveillé par AETHRYON." }] }, {}, "externe").raison).toBe("Déjà surveillé par AETHRYON.");
    expect(verdictPour("bibliotheque", { ...vide, refuses: [{ chemin: NOTES, nom: "notes.txt", raison: "Type non pris en charge." }] }, {}, "externe").raison).toBe("Type non pris en charge.");
    expect(verdictPour("ailleurs", mixte, {}, "externe").acceptable).toBe(false);
  });
});

describe("flux : glisser natif d'AETHRYON", () => {
  it("survole les zones en direct, envoie vers Premiere au dépôt, et attend la confirmation RÉELLE du panneau", async () => {
    const b = banc();
    b.reponses.glisser_medias = () => ({ jeton: "g1", chemins: [PLAGE] });
    b.reponses.envoyer_vers_premiere = () => ({ etat: "envoye", nom: "N1.json" });
    const flux = creerFlux({ dependances: b.deps, contexte: () => ({ premiereConnecte: true, chutier: "selection" }) });
    await flux.demarrer();
    expect(b.nbEcouteurs()).toBe(6);
    const notifs: string[] = [];
    flux.abonner((e) => notifs.push(`${e.survol.zone ?? "-"}:${e.survol.verdict?.acceptable ?? "-"}`));

    await flux.glisserMedias([ID]);
    expect(flux.etat().glisser).toMatchObject({ jeton: "g1", phase: "en-cours", ids: [ID] });
    b.emettre(EVENEMENTS.entree, { paths: [PLAGE], position: phys(50, 50) });
    let s = flux.etat().survol;
    expect(s).toMatchObject({ actif: true, provenance: "aethryon", zone: "premiere", position: { x: 50, y: 50 } });
    expect(s.verdict).toEqual({ acceptable: true, actions: ["envoyer-premiere"], raison: null });
    expect(b.appelsDe("flux_classer")).toHaveLength(0); // nos propres chemins : classement immédiat
    expect(b.marques.at(-1)).toEqual({ etat: "accepte", flux: "aethryon", glisser: true });

    b.emettre(EVENEMENTS.survol, { position: phys(200, 100) });
    s = flux.etat().survol;
    expect(s.zone).toBe("bibliotheque");
    expect(s.verdict?.raison).toBe("Déjà dans la bibliothèque.");
    expect(b.marques.at(-1)?.etat).toBe("refuse");
    b.emettre(EVENEMENTS.survol, { position: phys(30, 30) });
    expect(flux.etat().survol.zone).toBe("premiere");

    b.emettre(EVENEMENTS.depot, { paths: [PLAGE], position: phys(30, 30) });
    await vider();
    expect(b.appelsDe("envoyer_vers_premiere")[0].args).toEqual({ ids: [ID], chutier: "selection" });
    let op = flux.etat().operations[0] as OpEnvoi;
    expect(op.envoi).toEqual({ etat: "envoye", nom: "N1.json" });
    expect(flux.etat().survol.actif).toBe(false);
    expect(b.marques.at(-1)?.etat).toBe(null);

    b.emettre(EVENEMENTS.glisserFin, fin({}));
    expect(flux.etat().glisser).toBeNull();
    expect(flux.etat().operations).toHaveLength(1); // dépôt interne : pas d'opération « glisser » en plus
    // Un autre résultat (autre commande) n'est pas pris pour le nôtre.
    b.emettre(EVENEMENTS.resultat, resultat({ nom: "AUTRE.json", ok: false, message: "x" }));
    expect((flux.etat().operations[0] as OpEnvoi).envoi.etat).toBe("envoye");
    b.emettre(EVENEMENTS.resultat, resultat({ message: "1 importé dans « AETHRYON » (Montage-voyage)" }));
    op = flux.etat().operations[0] as OpEnvoi;
    expect(op.envoi).toEqual({ etat: "importe", nom: "N1.json", message: "1 importé dans « AETHRYON » (Montage-voyage)", le: "2026-10-23T20:00:00Z" });
    expect(b.nbEcouteurs()).toBe(6); // l'écouteur du suivi est retiré à l'état final
    expect(notifs.length).toBeGreaterThan(4);
    await flux.arreter();
    expect(b.nbEcouteurs()).toBe(0);
  });

  it("dépôt sur la fenêtre annoncé APRÈS la fin du glisser : l'action a lieu ; sans dépôt, le survol s'éteint après 1,5 s", async () => {
    const b = banc();
    b.reponses.glisser_medias = () => ({ jeton: "g1", chemins: [PLAGE] });
    b.reponses.envoyer_vers_premiere = () => ({ etat: "envoye", nom: "N1.json" });
    const flux = creerFlux({ dependances: b.deps });
    await flux.demarrer();
    await flux.glisserMedias([ID]);
    b.emettre(EVENEMENTS.entree, { paths: [PLAGE], position: phys(20, 20) });
    b.emettre(EVENEMENTS.glisserFin, fin({}));
    expect(flux.etat().survol.actif).toBe(true); // délai de grâce
    b.emettre(EVENEMENTS.depot, { paths: [PLAGE], position: phys(20, 20) });
    await vider();
    expect(b.appelsDe("envoyer_vers_premiere")).toHaveLength(1);

    await flux.glisserMedias([ID]);
    b.emettre(EVENEMENTS.entree, { paths: [PLAGE], position: phys(20, 20) });
    b.emettre(EVENEMENTS.glisserFin, fin({}));
    b.avancer(1499);
    expect(flux.etat().survol.actif).toBe(true);
    b.avancer(2);
    expect(flux.etat().survol.actif).toBe(false);
    expect(b.appelsDe("envoyer_vers_premiere")).toHaveLength(1);
    await flux.arreter();
  });

  it("dépôt dans une autre application : opération « glisser » avec le nom de l'exécutable, sans prétendre à un import", async () => {
    const b = banc();
    b.reponses.glisser_medias = () => ({ jeton: "g1", chemins: [PLAGE] });
    const flux = creerFlux({ dependances: b.deps });
    await flux.demarrer();
    await flux.glisserMedias([ID]);
    b.emettre(EVENEMENTS.entree, { paths: [PLAGE], position: phys(150, 50) });
    b.emettre(EVENEMENTS.sortie, null);
    expect(flux.etat().survol.actif).toBe(false);
    expect(flux.etat().glisser).not.toBeNull(); // toujours en cours, hors de la fenêtre
    expect(b.marques.at(-1)).toEqual({ etat: null, flux: null, glisser: true });
    b.emettre(EVENEMENTS.glisserFin, fin({ cible: "externe", application: "Adobe Premiere Pro.exe" }));
    expect(flux.etat().glisser).toBeNull();
    expect(flux.etat().operations[0]).toMatchObject({ type: "glisser", fin: { resultat: "depose", application: "Adobe Premiere Pro.exe" } });
    expect(b.appelsDe("envoyer_vers_premiere")).toHaveLength(0);
    await expect(flux.glisserMedias([])).rejects.toThrow("Aucun média");
    await flux.arreter();
  });

  it("fin arrivée avant la réponse de glisser_medias (bouton relâché aussitôt) : appliquée dès que le jeton est connu", async () => {
    const b = banc();
    let repondre: (v: unknown) => void = () => {};
    b.reponses.glisser_medias = () => new Promise((r) => (repondre = r));
    const flux = creerFlux({ dependances: b.deps });
    await flux.demarrer();
    const p = flux.glisserMedias([ID]);
    await vider();
    expect(flux.etat().glisser?.phase).toBe("demarrage");
    await expect(flux.glisserMedias([ID])).rejects.toThrow("déjà en cours");
    b.emettre(EVENEMENTS.glisserFin, fin({ jeton: "g7", resultat: "annule", effet: "aucun", cible: "inconnue", message: "Bouton de la souris relâché avant le début du glisser." }));
    repondre({ jeton: "g7", chemins: [PLAGE] });
    await p;
    expect(flux.etat().glisser).toBeNull();
    await flux.arreter();
  });

  it("annulation : Échap côté interface arrête le glisser natif et éteint les zones", async () => {
    const b = banc();
    b.reponses.glisser_medias = () => ({ jeton: "g1", chemins: [PLAGE] });
    b.reponses.glisser_annuler = () => true;
    const flux = creerFlux({ dependances: b.deps });
    await flux.demarrer();
    await flux.glisserMedias([ID]);
    b.emettre(EVENEMENTS.entree, { paths: [PLAGE], position: phys(20, 20) });
    flux.annuler();
    expect(b.appelsDe("glisser_annuler")).toHaveLength(1);
    expect(flux.etat().survol.actif).toBe(false);
    b.emettre(EVENEMENTS.glisserFin, fin({ resultat: "annule", effet: "aucun", message: "Annulé par AETHRYON." }));
    expect(flux.etat().glisser).toBeNull();
    expect(flux.etat().operations).toHaveLength(0);
    await flux.arreter();
  });
});

describe("flux : fichiers et dossiers externes", () => {
  const classement = (chemins: string[]): Classement => ({
    medias: [],
    fichiers: chemins.filter((c) => c.endsWith(".mov")).map((c) => ({ chemin: c, nom: "Clip nuit.mov", taille: 10, type: "video" })),
    dossiers: chemins.filter((c) => c === DOSSIER).map((c) => ({ chemin: c, nom: "Voyage", surveille: false, surveillable: true, raison: null })),
    refuses: chemins.filter((c) => c.endsWith(".txt")).map((c) => ({ chemin: c, nom: "notes.txt", raison: "Type non pris en charge : vidéo, audio ou image attendus." })),
  });

  it("classés par le cœur (attente puis verdict), importés au dépôt avec progression et bilan", async () => {
    const b = banc();
    let finClasser: (c: Classement) => void = () => {};
    b.reponses.flux_classer = (a) => new Promise<Classement>((r) => (finClasser = () => r(classement(a.chemins as string[]))));
    let finImport: () => void = () => {};
    b.reponses.importer_fichiers = (a) =>
      new Promise<BilanImport>((r) => (finImport = () => r({ lot: a.lot as string, fichiers: [{ source: CLIP, nom: "Clip nuit.mov", etat: "importe", chemin: "C:\\M\\Clip nuit.mov", id: ID2, fichier: "Clip nuit.mov" }], importes: 1, dejaLa: 0, refuses: 0, echecs: 0, annules: 0, octets: 10 })));
    const flux = creerFlux({ dependances: b.deps });
    await flux.demarrer();
    b.emettre(EVENEMENTS.entree, { paths: [CLIP, NOTES], position: phys(150, 50) });
    expect(flux.etat().survol).toMatchObject({ provenance: "externe", zone: "bibliotheque", classement: null });
    expect(flux.etat().survol.verdict?.enAttente).toBe(true);
    expect(b.marques.at(-1)).toEqual({ etat: "attente", flux: "externe", glisser: false });
    finClasser(classement([]));
    await vider();
    expect(flux.etat().survol.verdict).toEqual({ acceptable: true, actions: ["importer"], raison: null });
    b.emettre(EVENEMENTS.survol, { position: phys(50, 50) });
    expect(flux.etat().survol.verdict?.acceptable).toBe(false); // zone « premiere » : fichiers externes refusés

    b.emettre(EVENEMENTS.depot, { paths: [CLIP, NOTES], position: phys(160, 60) });
    await vider();
    const [appel] = b.appelsDe("importer_fichiers");
    expect(appel.args?.chemins).toEqual([CLIP]); // le .txt refusé n'est même pas envoyé
    const lot = appel.args?.lot as string;
    expect(lot).toMatch(/^import-/);
    b.emettre(EVENEMENTS.import, { lot: "autre", index: 0, fichiers: 1, nom: "x", etape: "copie", fait: 1, taille: 2, faitLot: 1, tailleLot: 2 });
    b.emettre(EVENEMENTS.import, { lot, index: 0, fichiers: 1, nom: "Clip nuit.mov", etape: "copie", fait: 5, taille: 10, faitLot: 5, tailleLot: 10 });
    let op = flux.etat().operations[0] as OpImport;
    expect(op.progression).toMatchObject({ fait: 5, taille: 10, nom: "Clip nuit.mov" });
    finImport();
    await vider();
    op = flux.etat().operations[0] as OpImport;
    expect(op.bilan?.importes).toBe(1);
    await flux.arreter();
  });

  it("un dossier n'est jamais copié : AETHRYON propose « Surveiller ce dossier »", async () => {
    const b = banc();
    b.reponses.flux_classer = (a) => classement(a.chemins as string[]);
    b.reponses.dossier_ajouter = () => null;
    const flux = creerFlux({ dependances: b.deps });
    await flux.demarrer();
    b.emettre(EVENEMENTS.entree, { paths: [DOSSIER], position: phys(150, 50) });
    await vider();
    expect(flux.etat().survol.verdict?.actions).toEqual(["surveiller"]);
    b.emettre(EVENEMENTS.depot, { paths: [DOSSIER], position: phys(150, 50) });
    await vider();
    expect(b.appelsDe("importer_fichiers")).toHaveLength(0);
    const op = flux.etat().operations[0] as OpSurveiller;
    expect(op).toMatchObject({ type: "surveiller", etat: "proposee", dossiers: [{ chemin: DOSSIER }] });
    await flux.accepterProposition(op.id);
    expect(b.appelsDe("dossier_ajouter")[0].args).toEqual({ chemin: DOSSIER });
    expect(flux.etat().operations[0]).toMatchObject({ etat: "acceptee", message: "« Voyage » est maintenant surveillé." });

    // Refus de la proposition : rien n'est appelé.
    b.emettre(EVENEMENTS.depot, { paths: [DOSSIER], position: phys(150, 50) });
    await vider();
    const op2 = flux.etat().operations[1] as OpSurveiller;
    flux.refuserProposition(op2.id);
    expect(flux.etat().operations[1]).toMatchObject({ etat: "refusee" });
    expect(b.appelsDe("dossier_ajouter")).toHaveLength(1);
    flux.oublier(op2.id);
    expect(flux.etat().operations).toHaveLength(1);
    await flux.arreter();
  });

  it("dépôt refusé (hors zone, zone qui refuse) : retour clair, aucune commande", async () => {
    const b = banc();
    b.reponses.flux_classer = (a) => classement(a.chemins as string[]);
    const flux = creerFlux({ dependances: b.deps });
    await flux.demarrer();
    b.emettre(EVENEMENTS.depot, { paths: [NOTES], position: phys(150, 50) });
    await vider();
    expect(flux.etat().operations[0]).toMatchObject({ type: "refus", zone: "bibliotheque", raison: "Type non pris en charge : vidéo, audio ou image attendus." });
    b.emettre(EVENEMENTS.depot, { paths: [CLIP], position: phys(900, 900) }); // hors de toute zone
    await vider();
    expect(flux.etat().operations).toHaveLength(1);
    expect(b.appelsDe("importer_fichiers")).toHaveLength(0);
    await flux.arreter();
  });

  it("classement arrivé après la sortie du curseur : ignoré", async () => {
    const b = banc();
    let finClasser: () => void = () => {};
    b.reponses.flux_classer = (a) => new Promise<Classement>((r) => (finClasser = () => r(classement(a.chemins as string[]))));
    const flux = creerFlux({ dependances: b.deps });
    await flux.demarrer();
    b.emettre(EVENEMENTS.entree, { paths: [CLIP], position: phys(150, 50) });
    b.emettre(EVENEMENTS.sortie, null);
    finClasser();
    await vider();
    expect(flux.etat().survol).toMatchObject({ actif: false, classement: null });
    await flux.arreter();
  });

  it("zone ajoutée par l'interface : verdict et action à elle", async () => {
    const b = banc();
    b.reponses.flux_classer = (a) => classement(a.chemins as string[]);
    const flux = creerFlux({ dependances: b.deps });
    await flux.demarrer();
    const retirer = flux.definirZone("transferts", {
      verdict: (c) => ({ acceptable: c.fichiers.length > 0, actions: ["zone"], raison: null }),
      deposer: async (c) => `${c.fichiers.length} fichier prêt à partir`,
    });
    b.emettre(EVENEMENTS.depot, { paths: [CLIP], position: phys(450, 50) });
    await vider();
    expect(flux.etat().operations[0]).toMatchObject({ type: "zone", zone: "transferts", etat: "fait", message: "1 fichier prêt à partir" });
    retirer();
    b.emettre(EVENEMENTS.depot, { paths: [CLIP], position: phys(450, 50) });
    await vider();
    expect(flux.etat().operations[1]).toMatchObject({ type: "refus", zone: "transferts" });
    await flux.arreter();
  });

  it("importerFichiers seul : progression du lot, écouteur retiré même en cas d'échec", async () => {
    const b = banc();
    b.reponses.importer_fichiers = (a) => {
      b.emettre(EVENEMENTS.import, { lot: a.lot, index: 0, fichiers: 1, nom: "Clip nuit.mov", etape: "termine", fait: 0, taille: 0, faitLot: 10, tailleLot: 10 });
      return { lot: a.lot, fichiers: [], importes: 0, dejaLa: 0, refuses: 0, echecs: 0, annules: 0, octets: 0 };
    };
    const vues: string[] = [];
    const bilan = await importerFichiers([CLIP], { lot: "lot-a", surProgression: (p) => vues.push(p.etape), dependances: b.deps });
    expect(bilan.lot).toBe("lot-a");
    expect(vues).toEqual(["termine"]);
    expect(b.nbEcouteurs()).toBe(0);
    b.reponses.importer_fichiers = () => Promise.reject("Identifiant de lot refusé.");
    await expect(importerFichiers([CLIP], { lot: "../x", dependances: b.deps })).rejects.toBe("Identifiant de lot refusé.");
    expect(b.nbEcouteurs()).toBe(0);
  });
});

describe("flux : envoi vers Premiere Pro, états réels", () => {
  it("Premiere non connecté : rien n'est envoyé, et l'état le dit", async () => {
    const b = banc();
    b.reponses.envoyer_vers_premiere = () => ({ etat: "non-connecte", message: "Premiere Pro n'est pas connecté : le panneau AETHRYON ne donne plus signe de vie depuis 20 s. Rien n'a été envoyé.", age: 20 });
    const s = envoyerVersPremiere([ID], null, { dependances: b.deps });
    const e = await s.fin;
    expect(e).toMatchObject({ etat: "non-connecte", age: 20 });
    expect(b.nbEcouteurs()).toBe(0);
  });

  it("expiré, échec du panneau, refus du cœur : jamais transformés en succès", async () => {
    const b = banc();
    b.reponses.envoyer_vers_premiere = () => ({ etat: "envoye", nom: "N1.json" });
    const s1 = envoyerVersPremiere([ID], "aethryon", { dependances: b.deps });
    await vider();
    expect(s1.etat()).toEqual({ etat: "envoye", nom: "N1.json" });
    b.emettre(EVENEMENTS.resultat, resultat({ ok: false, expire: true, message: "Expirée : le panneau AETHRYON n'a pas répondu en 2 minutes." }));
    expect(await s1.fin).toMatchObject({ etat: "expire", nom: "N1.json" });

    const s2 = envoyerVersPremiere([ID], null, { dependances: b.deps });
    await vider();
    b.emettre(EVENEMENTS.resultat, resultat({ ok: false, message: "Aucun projet ouvert : ouvrez ou créez un projet dans Premiere Pro pour importer" }));
    expect(await s2.fin).toEqual({ etat: "echec", nom: "N1.json", message: "Aucun projet ouvert : ouvrez ou créez un projet dans Premiere Pro pour importer" });
    // Un résultat positif arrivé ensuite ne change plus rien.
    b.emettre(EVENEMENTS.resultat, resultat({ ok: true, message: "x" }));
    expect(s2.etat().etat).toBe("echec");

    b.reponses.envoyer_vers_premiere = () => Promise.reject("« Plage » n'est pas disponible (en cours).");
    const s3 = envoyerVersPremiere([ID], null, { dependances: b.deps });
    expect(await s3.fin).toEqual({ etat: "echec", nom: null, message: "« Plage » n'est pas disponible (en cours)." });
    expect(b.nbEcouteurs()).toBe(0);
  });

  it("résultat arrivé pendant le dépôt de la commande, puis garde de 2 min 15 s qui relit l'état du cœur", async () => {
    const b = banc();
    b.reponses.envoyer_vers_premiere = () => {
      b.emettre(EVENEMENTS.resultat, resultat({ nom: "N2.json", message: "1 importé dans « AETHRYON »" }));
      return { etat: "envoye", nom: "N2.json" };
    };
    const s = envoyerVersPremiere([ID], null, { dependances: b.deps });
    expect(await s.fin).toMatchObject({ etat: "importe", nom: "N2.json" });

    b.reponses.envoyer_vers_premiere = () => ({ etat: "envoye", nom: "N3.json" });
    b.reponses.etat = () => ({ resultats: [] });
    const t = envoyerVersPremiere([ID], null, { dependances: b.deps, gardeMs: 135_000 });
    const etats: string[] = [];
    t.abonner((e) => etats.push(e.etat));
    await vider();
    b.avancer(134_000);
    await vider();
    expect(t.etat().etat).toBe("envoye");
    b.avancer(2_000);
    expect(await t.fin).toMatchObject({ etat: "expire", message: "Aucune réponse du panneau AETHRYON en 2 minutes : la demande a expiré." });
    expect(etats).toEqual(["envoye", "expire"]);

    b.reponses.envoyer_vers_premiere = () => ({ etat: "envoye", nom: "N4.json" });
    b.reponses.etat = () => ({ resultats: [resultat({ nom: "N4.json", message: "importé (lu dans l'état)" })] });
    const u = envoyerVersPremiere([ID], null, { dependances: b.deps });
    await vider();
    b.avancer(136_000);
    expect(await u.fin).toMatchObject({ etat: "importe", message: "importé (lu dans l'état)" });
    expect(b.minuteries.size).toBe(0);
    expect(b.nbEcouteurs()).toBe(0);
  });

  it("Premiere non connecté vu par l'interface : la zone refuse, aucun envoi au dépôt", async () => {
    const b = banc();
    b.reponses.glisser_medias = () => ({ jeton: "g1", chemins: [PLAGE] });
    const flux = creerFlux({ dependances: b.deps, contexte: () => ({ premiereConnecte: false }) });
    await flux.demarrer();
    await flux.glisserMedias([ID]);
    b.emettre(EVENEMENTS.entree, { paths: [PLAGE], position: phys(20, 20) });
    expect(flux.etat().survol.verdict?.raison).toContain("n'est pas connecté");
    b.emettre(EVENEMENTS.depot, { paths: [PLAGE], position: phys(20, 20) });
    await vider();
    expect(b.appelsDe("envoyer_vers_premiere")).toHaveLength(0);
    expect(flux.etat().operations[0]).toMatchObject({ type: "refus", zone: "premiere" });
    await flux.arreter();
  });
});

describe("flux : aucune fuite d'écouteurs", () => {
  it("démarrage idempotent, arrêt complet, arrêt pendant l'installation des écouteurs", async () => {
    const b = banc();
    const flux = creerFlux({ dependances: b.deps });
    await flux.demarrer();
    await flux.demarrer();
    expect(b.nbEcouteurs()).toBe(6);
    await flux.arreter();
    await flux.arreter();
    expect(b.nbEcouteurs()).toBe(0);
    expect(b.marques.at(-1)).toEqual({ etat: null, flux: null, glisser: false });
    // Événements après l'arrêt : ignorés.
    b.emettre(EVENEMENTS.entree, { paths: [CLIP], position: phys(150, 50) });
    expect(flux.etat().survol.actif).toBe(false);

    const lent = banc({ listenLent: true });
    const f2 = creerFlux({ dependances: lent.deps });
    const d = f2.demarrer();
    await vider();
    const arret = f2.arreter();
    for (const r of lent.lents.splice(0)) r();
    await d;
    await arret;
    await vider();
    expect(lent.nbEcouteurs()).toBe(0);
    // Redémarrage après coup : six écouteurs, pas douze.
    const d2 = f2.demarrer();
    await vider();
    for (const r of lent.lents.splice(0)) r();
    await d2;
    expect(lent.nbEcouteurs()).toBe(6);
    await f2.arreter();
    expect(lent.nbEcouteurs()).toBe(0);
  });

  it("l'arrêt coupe aussi les suivis d'envoi en cours et les minuteries", async () => {
    const b = banc();
    b.reponses.glisser_medias = () => ({ jeton: "g1", chemins: [PLAGE] });
    b.reponses.envoyer_vers_premiere = () => ({ etat: "envoye", nom: "N1.json" });
    const flux = creerFlux({ dependances: b.deps });
    await flux.demarrer();
    await flux.glisserMedias([ID]);
    b.emettre(EVENEMENTS.entree, { paths: [PLAGE], position: phys(20, 20) });
    b.emettre(EVENEMENTS.depot, { paths: [PLAGE], position: phys(20, 20) });
    await vider();
    expect(b.nbEcouteurs()).toBe(7); // six du flux + celui du suivi d'envoi
    expect(b.minuteries.size).toBe(1); // garde de l'envoi
    await flux.arreter();
    expect(b.nbEcouteurs()).toBe(0);
    expect(b.minuteries.size).toBe(0);
  });
});
