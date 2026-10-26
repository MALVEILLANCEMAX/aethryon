// 2.0.1 : commandes `importer` d'AETHRYON Desktop (contrat §5, §9 v1.1, §11.5). Deux niveaux :
//   - règles pures (src/lib/commandes.ts) : jugement, index, résultat ;
//   - bout en bout dans Node : la VRAIE coque CEP (src/hote/cep.ts, vrais services Node, vrais fichiers) et le VRAI
//     script hôte aethryon.jsx sur un faux Premiere ; les commandes sont écrites comme le Desktop les écrit
//     (desktop/noyau/src/commandes.rs : deposer_importer) et leur résultat est relu comme le Desktop le relit
//     (commandes::resultat, service.rs est_expiration et « aucun projet » → sans-projet).
// NON TESTÉ DANS PREMIERE : le vrai importFiles et le vrai CEP restent à prouver chez le propriétaire.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { monde } from "../faux-premiere";
import { dossierTemporaire, requireNode } from "./outils";
import { idPourChemin } from "../../src/lib/bibliotheque";
import { cheminsDesktop, noterImports } from "../../src/lib/desktop";
import {
  creerRecepteurCommandes, EXPIRATION_MS, juger, lireIndex, MESSAGE_EXPIREE, MESSAGE_SANS_PROJET, nomCommande, resoudre, resultatImport,
  type Signal,
} from "../../src/lib/commandes";
import type { Hote } from "../../src/hote/types";

const ID = "a".repeat(40);
const T0 = Date.parse("2026-10-24T13:00:00.000Z");
const base = { schema: 1, id: randomUUID(), de: "desktop", pour: "panneau", action: "importer", args: { ids: [ID], chutier: "aethryon" }, creeLe: new Date(T0).toISOString() };

describe("règles des commandes (pures)", () => {
  it("jugement : seule « importer » du Desktop, identifiants de l'index, chutier connu, 2 minutes au plus", () => {
    expect(juger(base, T0 + 1000)).toEqual({ verdict: "importer", ids: [ID], chutier: "aethryon" });
    expect(juger({ ...base, args: { ids: [ID, ID] } }, T0)).toEqual({ verdict: "importer", ids: [ID], chutier: "aethryon" });
    expect(juger({ ...base, args: { ids: [ID], chutier: "selection" } }, T0)).toMatchObject({ chutier: "selection" });
    expect(juger(base, T0 + EXPIRATION_MS - 1)).toMatchObject({ verdict: "importer" });
    expect(juger(base, T0 + EXPIRATION_MS + 1)).toEqual({ verdict: "expiree" });
    const refus: [Record<string, unknown>, RegExp][] = [
      [{ schema: 2 }, /schéma/], [{ de: "navigateur" }, /émetteur/], [{ action: "afficher-dans-explorateur" }, /hors de la liste/],
      [{ action: "executer" }, /hors de la liste/], [{ args: { ids: [] } }, /identifiants/], [{ args: { ids: ["C:\\x.mp4"] } }, /identifiants/],
      [{ args: { ids: [ID.toUpperCase()] } }, /identifiants/], [{ args: { ids: Array.from({ length: 201 }, (_, i) => i.toString(16).padStart(40, "0")) } }, /200 médias/],
      [{ args: { ids: [ID], chutier: "../x" } }, /chutier/], [{ args: null }, /identifiants/], [{ creeLe: "hier" }, /date/],
    ];
    for (const [modif, raison] of refus) {
      const j = juger({ ...base, ...modif }, T0);
      expect(j.verdict, JSON.stringify(modif)).toBe("refusee");
      expect(j.verdict === "refusee" && j.raison).toMatch(raison);
    }
  });

  it("noms : <horodatage>-<uuid>.json du Desktop ; jamais un .tmp d'écriture atomique ni un chemin", () => {
    expect(nomCommande(`20261024T131649123Z-${randomUUID()}.json`)).toBe(true);
    for (const n of ["x.json.p1a2b3c4-1.tmp", "a.json.1234-1.tmp", "../a.json", ".json", "a b.json", "a.JSON.txt"]) expect(nomCommande(n), n).toBe(false);
  });

  it("index : identifiants recalculés depuis les chemins ; seulement les médias disponibles des dossiers surveillés", () => {
    const D = "C:\\Users\\Élodie\\Downloads\\AETHRYON";
    const ok = `${D}\\Coucher de soleil.mp4`, encours = `${D}\\Arrivée.mp4`, perdu = `${D}\\Perdu.mp4`, dehors = "C:\\Windows\\x.mp4";
    const index = lireIndex(JSON.stringify({
      schema: 1, dossiers: [{ chemin: D, principal: true }],
      medias: [
        { id: "f".repeat(40), chemin: ok, ext: "mp4", type: "video", etat: "disponible" },
        { id: idPourChemin(encours), chemin: encours, ext: "mp4", type: "video", etat: "en-cours" },
        { id: idPourChemin(perdu), chemin: perdu, ext: "mp4", type: "video", etat: "introuvable" },
        { id: idPourChemin(dehors), chemin: dehors, ext: "mp4", type: "video", etat: "disponible" },
        { chemin: "relatif.mp4", ext: "mp4", type: "video" },
      ],
    }), (a, b) => `${a}\\${b}`)!;
    expect(index.dossiers).toEqual([D]);
    const r = resoudre([idPourChemin(ok), "f".repeat(40), idPourChemin(encours), idPourChemin(perdu), idPourChemin(dehors)], index);
    expect(r.chemins).toEqual([ok]);
    expect(r.refus.map((x) => x.raison)).toEqual([
      "média absent de la bibliothèque d'AETHRYON Desktop", "fichier encore en cours d'écriture",
      "fichier introuvable : il a été déplacé, renommé ou supprimé", "fichier hors des dossiers surveillés par AETHRYON Desktop",
    ]);
    expect(lireIndex('{"schema":1,"medias":[', (a, b) => a + b)).toBeNull();
    expect(lireIndex(null, (a, b) => a + b)).toBeNull();
  });

  it("résultat : ok seulement si chaque média est dans le projet ; « aucun projet » reconnu par le Desktop", () => {
    const a = "C:\\M\\a.mp4", b = "C:\\M\\b.mp4";
    const bilan = (resultats: { chemin: string; ok: boolean; deja?: boolean; code?: "introuvable" | "absentApres" }[]) => ({ ok: resultats.every((r) => r.ok), chutier: "AETHRYON", projet: "Montage", resultats });
    expect(resultatImport([a], bilan([{ chemin: a, ok: true }]), [], 1)).toMatchObject({ ok: true, message: "Importé dans « AETHRYON » (Montage)." });
    expect(resultatImport([a, b], bilan([{ chemin: a, ok: true }, { chemin: b, ok: true, deja: true }]), [], 2)).toMatchObject({ ok: true, message: "Importé dans « AETHRYON » (Montage) ; 1 déjà dans le projet." });
    expect(resultatImport([a], bilan([{ chemin: a, ok: true, deja: true }]), [], 1)).toMatchObject({ ok: true, message: "Déjà dans le projet (Montage) : aucun second import." });
    expect(resultatImport([a, b], bilan([{ chemin: a, ok: true }, { chemin: b, ok: false, code: "introuvable" }]), [], 2)).toMatchObject({ ok: false, message: "1 média sur 2 non importé : fichier introuvable : il a été déplacé, renommé ou supprimé." });
    expect(resultatImport([a], bilan([]), [], 1)).toMatchObject({ ok: false, message: "Premiere n'a rien répondu pour ce fichier." });
    const sans = resultatImport([a], { ok: false, chutier: null, projet: null, resultats: [], message: "aucunProjet" }, [], 1);
    expect(sans).toMatchObject({ ok: false, message: MESSAGE_SANS_PROJET });
    expect(sans.message.trim().toLowerCase().startsWith("aucun projet")).toBe(true);
  });
});

// ---- Bout en bout : vraie coque CEP, vrais fichiers, faux Premiere --------------------------------------------------------
const g = globalThis as unknown as Record<string, unknown>;
const env = { HOME: process.env.HOME, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA };
const maison = dossierTemporaire("aethryon-commandes-");
const R = join(maison, "AppData", "Local", "AETHRYON");
const medias = join(maison, "Downloads", "AETHRYON");
const aTraiter = join(R, "commandes", "a-traiter");
const traitees = join(R, "commandes", "traitees");
let premiere = monde();
let hote: Hote;

/** Lecture du résultat comme le Desktop (commandes::resultat : traitees\<nom> avec un « resultat »). */
function resultatDesktop(nom: string): { ok: boolean; message: string; le: string; expire?: boolean } | null {
  const f = join(traitees, nom);
  if (!existsSync(f)) return null;
  const c = JSON.parse(readFileSync(f, "utf8"));
  return c.resultat ?? null;
}
/** service.rs, est_expiration. */
const estExpiration = (r: { ok: boolean; message: string }) => !r.ok && /^(expirée|commande expirée)/.test(r.message.trim().toLowerCase());

/** Comme desktop/noyau/src/commandes.rs, deposer_importer : nom <horodatage>-<uuid>.json, champs en camelCase. */
function deposer(ids: string[], o: { chutier?: string; age?: number; action?: string; pour?: string } = {}): string {
  const t = new Date(Date.now() - (o.age ?? 0));
  const id = randomUUID();
  const nom = `${t.toISOString().replace(/[-:]/g, "").replace(".", "")}-${id}.json`;
  mkdirSync(aTraiter, { recursive: true });
  writeFileSync(join(aTraiter, nom), JSON.stringify({ schema: 1, id, de: "desktop", pour: o.pour ?? "panneau", action: o.action ?? "importer", args: { ids, chutier: o.chutier ?? "aethryon" }, creeLe: t.toISOString() }));
  return nom;
}

function media(nom: string, etat = "disponible"): { chemin: string; id: string; entree: Record<string, unknown> } {
  const chemin = join(medias, nom);
  return { chemin, id: idPourChemin(chemin), entree: { id: idPourChemin(chemin), chemin, nom: nom.replace(/\.[^.]+$/, ""), ext: "mp4", type: "video", etat, premiereCompatible: true } };
}

function ecrireIndex(entrees: Record<string, unknown>[]) {
  mkdirSync(join(R, "bibliotheque"), { recursive: true });
  writeFileSync(join(R, "bibliotheque", "index.json"), JSON.stringify({ schema: 1, misAJour: new Date().toISOString(), dossiers: [{ chemin: medias, principal: true }], medias: entrees }));
}

const signaux: Signal[] = [];
function recepteur(fichiers = hote.fichiers) {
  const c = cheminsDesktop(hote.fichiers, R, join(maison, "AppData", "Roaming"));
  return creerRecepteurCommandes({
    fichiers, aTraiter: c.aTraiter, traitees: c.traitees, index: c.index, posix: true,
    projet: () => hote.premiere.projet(),
    // Même suite qu'un import manuel du panneau (src/etat/app.ts, importerChemins) : import vérifié, puis imports.json.
    importer: async (chemins, mode) => {
      const b = await hote.premiere.importer(chemins, mode);
      const reussis = b.resultats.filter((r) => r.ok && !r.deja).map((r) => idPourChemin(r.chemin));
      if (b.projet) await noterImports(hote.fichiers, c.imports, reussis, b.projet, b.chutier || "racine");
      return b;
    },
    signaler: (s) => void signaux.push(s),
  });
}

beforeAll(async () => {
  process.env.HOME = maison;
  process.env.APPDATA = join(maison, "AppData", "Roaming");
  process.env.LOCALAPPDATA = join(maison, "AppData", "Local");
  mkdirSync(medias, { recursive: true });
  g.window = {
    __adobe_cep__: {
      evalScript: (script: string, rappel: (r: string) => void) => setTimeout(() => rappel(premiere.evalScript(script)), 1),
      getHostEnvironment: () => JSON.stringify({ appName: "PPRO", appVersion: "26.5.2" }),
      getSystemPath: () => "",
      getCurrentApiVersion: () => JSON.stringify({ major: 12, minor: 0, micro: 0 }),
      addEventListener: () => {},
      invokeSync: () => "",
    },
    cep_node: { require: requireNode },
    cep: { util: { openURLInDefaultBrowser: () => {} } },
    addEventListener: () => {},
  };
  g.document = { addEventListener: () => {}, visibilityState: "visible" };
  const { creerHoteCep } = await import("../../src/hote/cep");
  hote = creerHoteCep();
});
afterAll(() => {
  Object.assign(process.env, env);
  delete g.window;
  delete g.document;
});
beforeEach(() => {
  rmSync(join(R, "commandes"), { recursive: true, force: true });
  rmSync(join(R, "etat"), { recursive: true, force: true });
  premiere = monde();
  signaux.length = 0;
});

describe("commandes `importer` du Desktop (vraie coque CEP, vrais fichiers, faux Premiere)", () => {
  it("importe dans le chutier AETHRYON, vérifie, note imports.json, résultat réel relu par le Desktop, jamais deux fois", async () => {
    const m = media("Coucher de soleil sur la côte.mp4");
    writeFileSync(m.chemin, "x");
    premiere.ajouterExistant(m.chemin);
    ecrireIndex([m.entree]);
    const nom = deposer([m.id]);
    expect(await recepteur().passe()).toBe(1);
    expect(readdirSync(aTraiter)).toEqual([]);
    const r = resultatDesktop(nom)!;
    expect(r).toMatchObject({ ok: true, message: "Importé dans « AETHRYON » (Montage-voyage)." });
    expect(Date.parse(r.le)).toBeGreaterThan(Date.now() - 10_000);
    expect("expire" in r).toBe(false);
    const c = JSON.parse(readFileSync(join(traitees, nom), "utf8"));
    expect(c).toMatchObject({ schema: 1, de: "desktop", pour: "panneau", action: "importer", args: { ids: [m.id], chutier: "aethryon" } });
    expect(premiere.importes).toEqual([[m.chemin]]);
    expect(premiere.root.children!.find((x) => x.name === "AETHRYON")!.children!).toHaveLength(1);
    expect(await hote.premiere.presentsDansProjet([m.chemin])).toEqual([m.chemin]);
    const imports = JSON.parse(readFileSync(join(R, "etat", "imports.json"), "utf8"));
    expect(imports.imports[m.id]).toMatchObject([{ projet: "Montage-voyage", chutier: "AETHRYON" }]);
    expect(signaux).toEqual([{ type: "ok", titre: "Importé depuis AETHRYON Desktop", texte: "« AETHRYON » · Coucher de soleil sur la côte.mp4" }]);
    // Passage suivant : rien à refaire.
    expect(await recepteur().passe()).toBe(0);
    expect(premiere.importes).toHaveLength(1);
    // Deux panneaux (ou deux passages) en même temps : la prise par renommage n'en laisse passer qu'un.
    const nom2 = deposer([m.id], { chutier: "racine" });
    const n = await Promise.all([recepteur().passe(), recepteur().passe()]);
    expect(n[0] + n[1]).toBe(1);
    expect(resultatDesktop(nom2)).toMatchObject({ ok: true, message: "Déjà dans le projet (Montage-voyage) : aucun second import." });
    expect(premiere.importes).toHaveLength(1);
  });

  it("aucun projet ouvert : résultat {ok:false} « Aucun projet ouvert dans Premiere Pro. » (sans-projet côté Desktop), rien d'importé", async () => {
    premiere = monde({ sansProjet: true });
    const m = media("Sans projet.mp4");
    writeFileSync(m.chemin, "x");
    ecrireIndex([m.entree]);
    const nom = deposer([m.id]);
    expect(await recepteur().passe()).toBe(1);
    expect(resultatDesktop(nom)).toMatchObject({ ok: false, message: MESSAGE_SANS_PROJET });
    expect(premiere.importes).toEqual([]);
    expect(signaux[0]).toMatchObject({ type: "attention", titre: "Aucun projet ouvert" });
  });

  it("script hôte muet (aethryon.jsx non chargé) : échec réel avec le texte de la coque, rien d'importé", async () => {
    const vrai = premiere;
    premiere = { ...vrai, evalScript: () => "EvalScript error." };
    const m = media("Muet.mp4");
    writeFileSync(m.chemin, "x");
    ecrireIndex([m.entree]);
    const nom = deposer([m.id]);
    expect(await recepteur().passe()).toBe(1);
    expect(resultatDesktop(nom)).toMatchObject({ ok: false, message: "Script hôte AETHRYON indisponible (aethryon.jsx non chargé)." });
    expect(vrai.importes).toEqual([]);
  });

  it("expirée (plus de 2 minutes) : close avec expire: true, reconnue par le Desktop, rien d'importé", async () => {
    const m = media("Ancien.mp4");
    writeFileSync(m.chemin, "x");
    premiere.ajouterExistant(m.chemin);
    ecrireIndex([m.entree]);
    const nom = deposer([m.id], { age: EXPIRATION_MS + 5000 });
    expect(await recepteur().passe()).toBe(1);
    const r = resultatDesktop(nom)!;
    expect(r).toMatchObject({ ok: false, expire: true, message: MESSAGE_EXPIREE });
    expect(estExpiration(r)).toBe(true);
    expect(premiere.importes).toEqual([]);
  });

  it("le Desktop a pris la commande juste avant (expiration) : son résultat n'est jamais écrasé", async () => {
    const m = media("Course.mp4");
    writeFileSync(m.chemin, "x");
    premiere.ajouterExistant(m.chemin);
    ecrireIndex([m.entree]);
    const nom = deposer([m.id]);
    const expireeDesktop = { ok: false, message: "Expirée : le panneau AETHRYON n'a pas répondu en 2 minutes (Premiere fermé, aucun projet ouvert ou panneau caché).", le: new Date().toISOString() };
    const fichiers = {
      ...hote.fichiers,
      // commandes.rs, expirer : le Desktop déplace la commande dans traitees\ puis y écrit « Expirée » ; le renommage du
      // panneau, juste après, échoue (source absente).
      renommer: async (a: string, b: string) => {
        mkdirSync(traitees, { recursive: true });
        renameSync(a, b);
        writeFileSync(b, JSON.stringify({ ...JSON.parse(readFileSync(b, "utf8")), resultat: expireeDesktop }));
        return hote.fichiers.renommer(a, b);
      },
    };
    expect(await recepteur(fichiers).passe()).toBe(0);
    expect(resultatDesktop(nom)).toEqual(expireeDesktop);
    expect(premiere.importes).toEqual([]);
  });

  it("liste fermée et identifiants de l'index : refus écrits, rien d'exécuté ; commandes du Desktop et fichiers incomplets laissés", async () => {
    const dehors = join(maison, "Ailleurs.mp4");
    writeFileSync(dehors, "x");
    premiere.ajouterExistant(dehors);
    const enCours = media("Arrivée.mp4", "en-cours");
    ecrireIndex([{ id: idPourChemin(dehors), chemin: dehors, ext: "mp4", type: "video", etat: "disponible" }, enCours.entree]);
    const autre = deposer([ID], { action: "afficher-dans-explorateur" });
    const horsDossier = deposer([idPourChemin(dehors)]);
    const pasPret = deposer([enCours.id]);
    const inconnu = deposer(["b".repeat(40)]);
    const pourDesktop = deposer([ID], { pour: "desktop", action: "rescanner" });
    writeFileSync(join(aTraiter, `20261024T000000000Z-${randomUUID()}.json`), '{"schema":1,"de":"desktop","pour":"panneau"');
    writeFileSync(join(aTraiter, `${horsDossier}.p1a2b3c4-1.tmp`), "{}");
    expect(await recepteur().passe()).toBe(4);
    expect(resultatDesktop(autre)).toMatchObject({ ok: false, message: "Refusée : action hors de la liste autorisée." });
    expect(resultatDesktop(horsDossier)).toMatchObject({ ok: false, message: "fichier hors des dossiers surveillés par AETHRYON Desktop." });
    expect(resultatDesktop(pasPret)).toMatchObject({ ok: false, message: "fichier encore en cours d'écriture." });
    expect(resultatDesktop(inconnu)).toMatchObject({ ok: false, message: "média absent de la bibliothèque d'AETHRYON Desktop." });
    expect(premiere.importes).toEqual([]);
    const restants = readdirSync(aTraiter);
    expect(restants).toHaveLength(3);
    expect(restants).toEqual(expect.arrayContaining([pourDesktop, `${horsDossier}.p1a2b3c4-1.tmp`, expect.stringMatching(/^20261024T000000000Z-/)]));
  });

  it("index illisible (Desktop en train de l'écrire) : la commande n'est pas prise, elle passe au passage suivant", async () => {
    const m = media("Patience.mp4");
    writeFileSync(m.chemin, "x");
    premiere.ajouterExistant(m.chemin);
    mkdirSync(join(R, "bibliotheque"), { recursive: true });
    writeFileSync(join(R, "bibliotheque", "index.json"), '{"schema":1,"medias":[{"chemin"');
    const nom = deposer([m.id]);
    expect(await recepteur().passe()).toBe(0);
    expect(readdirSync(aTraiter)).toEqual([nom]);
    ecrireIndex([m.entree]);
    expect(await recepteur().passe()).toBe(1);
    expect(resultatDesktop(nom)).toMatchObject({ ok: true });
  });

  it("déplacement refusé hors de R\\commandes (la coque ne déplace rien d'autre)", async () => {
    const f = join(maison, "Downloads", "AETHRYON", "a.json");
    writeFileSync(f, "{}");
    await expect(hote.fichiers.renommer(f, join(traitees, "a.json"))).rejects.toThrow(/refusé/);
    await expect(hote.fichiers.renommer(join(aTraiter, "..", "..", "etat", "x.json"), join(traitees, "x.json"))).rejects.toThrow(/refusé/);
    expect(existsSync(f)).toBe(true);
  });
});
