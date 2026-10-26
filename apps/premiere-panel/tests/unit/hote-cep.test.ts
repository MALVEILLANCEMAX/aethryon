// La coque CEP ENTIÈRE (src/hote/cep.ts) dans Node : faux window.__adobe_cep__ dont evalScript exécute le VRAI
// script hôte aethryon.jsx sur un faux Premiere, et vrai Node (cep_node.require = require de Node) pour le réseau,
// les fichiers et la clé. Ce qui n'est pas couvert : Chromium 99 lui-même et le vrai Premiere (NON TESTÉ DANS PREMIERE).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { monde } from "../faux-premiere";
import { CLE_ESSAI, demarrerFauxServeur } from "../faux-serveur.mjs";
import { dossierTemporaire, requireNode } from "./outils";
import type { Hote } from "../../src/hote/types";
import { VERSION } from "../../src/version";

const g = globalThis as unknown as Record<string, unknown>;
const env = { HOME: process.env.HOME, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA };
const maison = dossierTemporaire("aethryon-maison-");
const dossierExt = join(maison, "extensions", "fr.aethryon.premiere");
const urls: string[] = [];
const menus: string[] = [];
const touches: string[] = [];
let premiere = monde();
let jsxCharge = true;
let hote: Hote;

beforeAll(async () => {
  process.env.HOME = maison;
  process.env.APPDATA = join(maison, "AppData", "Roaming");
  process.env.LOCALAPPDATA = join(maison, "AppData", "Local");
  mkdirSync(dossierExt, { recursive: true });
  g.window = {
    __adobe_cep__: {
      evalScript: (script: string, rappel: (r: string) => void) => setTimeout(() => rappel(jsxCharge ? premiere.evalScript(script) : "EvalScript error."), 1),
      getHostEnvironment: () => JSON.stringify({ appName: "PPRO", appVersion: "26.5.2" }),
      getSystemPath: (t: string) => (t === "extension" ? "file://" + encodeURI(dossierExt) : ""),
      getCurrentApiVersion: () => JSON.stringify({ major: 12, minor: 0, micro: 0 }),
      addEventListener: () => {},
      invokeSync: (_n: string, xml: string) => void menus.push(xml),
      registerKeyEventsInterest: (j: string) => void touches.push(j),
    },
    cep_node: { require: requireNode },
    cep: { util: { openURLInDefaultBrowser: (u: string) => void urls.push(u) } },
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

describe("coque CEP (faux Premiere, vrai Node)", () => {
  it("environnement : Premiere par ExtendScript, CEP, Node, dossiers du contrat", async () => {
    const e = await hote.environnement();
    expect(e).toMatchObject({ hote: "cep", premiereVersion: "26.5.2", cepVersion: "12.0.0", nodeVersion: process.versions.node, extensionVersion: VERSION, dossierExtension: dossierExt });
    expect(e.dossierMediasParDefaut).toBe(join(maison, "Downloads", "AETHRYON"));
    expect(e.dossierDonnees).toBe(join(maison, "AppData", "Roaming", "AETHRYON", "premiere"));
    expect(e.racineEchanges).toBe(join(maison, "AppData", "Local", "AETHRYON"));
  });
  it("import réel par le pont ExtendScript (appel figé, charge encodée) puis vérification", async () => {
    const f = join(maison, "Downloads", "AETHRYON", "Été « test » d'essai.mp4");
    mkdirSync(join(maison, "Downloads", "AETHRYON"), { recursive: true });
    writeFileSync(f, "x");
    premiere.ajouterExistant(f);
    const b = await hote.premiere.importer([f], "aethryon");
    expect(b).toMatchObject({ ok: true, chutier: "AETHRYON", projet: "Montage-voyage" });
    expect(await hote.premiere.presentsDansProjet([f])).toEqual([f]);
    expect((await hote.premiere.importer([f], "aethryon")).resultats[0]).toMatchObject({ deja: true });
    expect(await hote.premiere.projet()).toMatchObject({ nom: "Montage-voyage", sequenceActive: "Séquence 01" });
    expect(await hote.premiere.insererTeteLecture(f, "aethryon")).toMatchObject({ ok: true });
    expect(await hote.premiere.presentsDansSequence([f])).toEqual([f]);
  });
  it("script hôte absent : message clair, pas de plantage", async () => {
    jsxCharge = false;
    await expect(hote.premiere.projet()).rejects.toThrow(/aethryon\.jsx non chargé/);
    jsxCharge = true;
    premiere = monde({ sansProjet: true });
    expect(await hote.premiere.projet()).toBeNull();
    premiere = monde();
  });
  it("réseau, téléchargement et clé par Node", async () => {
    const fs = await demarrerFauxServeur({ tailleFichier: 100000 });
    const r = await hote.http({ methode: "GET", url: fs.base + "/media/health" }).catch((e) => e);
    // La coque livrée n'accepte que https (127.0.0.1 en clair est refusé hors des essais).
    expect(String(r.message)).toMatch(/https/);
    await fs.fermer();
    expect(await hote.coffre.ecrire({ cle: CLE_ESSAI, expireLe: null, compte: null, enregistreeLe: new Date().toISOString() })).toBe("acl");
    expect((await hote.coffre.lire())?.cle).toBe(CLE_ESSAI);
    await hote.coffre.effacer();
    expect(readdirSync(join(maison, "AppData", "Roaming", "AETHRYON", "premiere"))).toEqual([]);
  });
  it("navigateur par défaut seulement en https ; menu du panneau ; touches J K L", async () => {
    await expect(hote.ouvrirUrl("http://exemple.com")).rejects.toThrow();
    await hote.ouvrirUrl("https://raccourci.malvu.fr/premiere/connecter?code=ABCD-EFGH");
    expect(urls).toEqual(["https://raccourci.malvu.fr/premiere/connecter?code=ABCD-EFGH"]);
    hote.definirMenu([{ id: "accueil", libelle: "Accueil & <tout>" }, { id: "s", libelle: "", separateur: true }], () => {});
    expect(menus.pop()).toBe('<Menu><MenuItem Id="accueil" Label="Accueil &amp; &lt;tout>" Enabled="true" Checked="false"/><MenuItem Label="---" /></Menu>');
    hote.touchesVoulues([74, 75, 76]);
    expect(touches.pop()).toBe('[{"keyCode":74},{"keyCode":75},{"keyCode":76}]');
  });
  it("signature : lit META-INF/signatures.xml du dossier de l'extension", async () => {
    expect((await hote.signature()).etat).toBe("non-signee");
    mkdirSync(join(dossierExt, "META-INF"), { recursive: true });
    writeFileSync(join(dossierExt, "META-INF", "signatures.xml"), "<signatures/>");
    expect((await hote.signature()).etat).toBe("signee");
    expect(existsSync(join(dossierExt, "META-INF", "signatures.xml"))).toBe(true);
  });
});
