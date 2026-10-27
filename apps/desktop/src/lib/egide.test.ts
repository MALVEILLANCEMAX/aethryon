// Égide dans Desktop (lot 2) : le paquet design/ est la seule source des jetons, des polices, des icônes et de la chouette ;
// plus aucune trace des jetons Nocturne ; démarrage sans flash ; le fil lit des faits réels.
import { describe, expect, it } from "vitest";
import chouette from "../../../../packages/design/assets/aethryon-master.svg?raw";
import chouetteDesktop from "../assets/brand/aethryon-master.svg?raw";
import indexHtml from "../../index.html?raw";
import zoneHtml from "../../zone-menu.html?raw";
import viteConfig from "../../vite.config.ts?raw";
import { CUSTOM_EXEMPLE, creerPersistance, docOfficiel, entreeDePreference, normaliserDoc, resoudreTheme, stockageMemoire, variablesTheme, verifierContrastes, ORDRE_THEMES } from "./egide";
import { etatNoeud, ordreFil, type Ligne } from "./transfertsVue";
import type { Transfert } from "./types";

const feuilles = import.meta.glob("../**/*.css", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("Égide dans Desktop", () => {
  it("Obsidian par défaut, six thèmes à 27 contrastes conformes, aucune variable en ligne pour un thème officiel", () => {
    const p = creerPersistance({ stockage: stockageMemoire() });
    expect(entreeDePreference(p.lire())).toBe("obsidian");
    for (const t of ORDRE_THEMES) {
      const r = resoudreTheme(t === "custom" ? normaliserDoc(CUSTOM_EXEMPLE) : docOfficiel(t));
      expect(verifierContrastes(r).every((m) => m.ok), t).toBe(true);
    }
    expect(variablesTheme(resoudreTheme(docOfficiel("obsidian"))).attrs["data-eg-theme"]).toBe("obsidian");
    expect(variablesTheme(resoudreTheme(normaliserDoc(CUSTOM_EXEMPLE))).theme).toBe("custom");
  });
  it("chouette maître : le même fichier (octet pour octet) dans design/ et dans l'écran de démarrage", () => {
    expect(chouette).toContain("AETHRYON — symbole maître");
    expect(chouetteDesktop).toBe(chouette);
  });
  it("démarrage sans flash : theme-boot.js inséré par Vite en tête des DEUX pages, aucune couleur écrite en dur dans le HTML", () => {
    expect(viteConfig).toContain("egide-theme-boot");
    expect(viteConfig).toContain("../../packages/design/genere/theme-boot.js");
    for (const html of [indexHtml, zoneHtml]) {
      expect(html).toContain('data-eg-theme="obsidian"');
      expect(html).toContain('<meta name="viewport"');
      expect(html).not.toMatch(/background:\s*#|data-theme=/);
    }
    expect(indexHtml).toContain('<body class="eg-page">');
    expect(indexHtml).toContain("eg-veille");
  });
  it("plus aucun jeton Nocturne ni thème clair d'avant ; polices Égide seulement ; jamais « transition: all »", () => {
    const noms = Object.keys(feuilles);
    expect(noms.length).toBeGreaterThan(15);
    for (const [nom, css] of Object.entries(feuilles)) {
      expect(css, nom).not.toMatch(/var\(--(ae|n|e|t|lh|r|s|bg|line|text|state|accent|font|ease|ressort|verre|win)-[a-z0-9-]+/);
      expect(css, nom).not.toMatch(/data-theme|theme-light|Playfair|"Inter"/);
      expect(css, nom).not.toMatch(/transition:\s*all/);
    }
  });
});

const T = (id: string, etat: Transfert["etat"], majLe: string, autres: Partial<Transfert> = {}): Ligne => ({
  cle: `t-${id}`, nom: id, media: null,
  transfert: { schema: 1, id, titre: id, plateforme: "youtube", format: "mp4", etat, progression: null, fichierAttendu: null, chemin: null, erreur: null, majLe, ...autres },
});

describe("le fil : ordre et nœuds tirés des faits", () => {
  it("les transferts actifs d'abord, du plus récent au plus ancien ; puis l'historique", () => {
    const l = [T("vieux-pret", "pret", "2026-10-26T08:00:00Z"), T("cours", "telechargement", "2026-10-26T09:00:00Z"), T("attente", "attente", "2026-10-26T10:00:00Z"), T("erreur", "erreur", "2026-10-26T11:00:00Z")];
    expect(ordreFil(l).map((x) => x.cle)).toEqual(["t-attente", "t-cours", "t-erreur", "t-vieux-pret"]);
  });
  it("nœud : attente, en cours, pause (réception seulement), terminé, erreur ; un transfert annulé n'est pas une erreur", () => {
    expect(etatNoeud(T("a", "attente", ""))).toBe("attente");
    expect(etatNoeud(T("c", "conversion", ""))).toBe("cours");
    expect(etatNoeud(T("p", "telechargement", "", { pause: true }))).toBe("pause");
    expect(etatNoeud(T("p2", "conversion", "", { pause: true }))).toBe("cours");
    expect(etatNoeud(T("o", "pret", ""))).toBe("ok");
    expect(etatNoeud(T("e", "erreur", ""))).toBe("err");
    expect(etatNoeud(T("x", "erreur", "", { code: "annule" }))).toBe("attente");
  });
});
