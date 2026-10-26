// Téléchargement en flux : .part puis renommage, jamais d'écrasement, nettoyage en cas d'échec ou d'annulation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { nettoyerNomFichier } from "../../src/noeud/services";
import { dossierTemporaire, services } from "./outils";

let serveur: Server;
let base = "";
beforeAll(async () => {
  serveur = createServer((req, res) => {
    const u = new URL(req.url!, "http://x");
    if (u.pathname === "/ok") {
      res.writeHead(200, { "content-length": 200000 });
      res.end(Buffer.alloc(200000, 1));
    } else if (u.pathname === "/coupe") {
      res.writeHead(200, { "content-length": 500000 });
      res.write(Buffer.alloc(100000, 1));
      setTimeout(() => res.destroy(), 30);
    } else if (u.pathname === "/lent") {
      res.writeHead(200, { "content-length": 1000000 });
      let n = 0;
      const t = setInterval(() => {
        if (n++ > 50) return clearInterval(t);
        res.write(Buffer.alloc(10000, 1));
      }, 20);
      res.on("close", () => clearInterval(t));
    } else if (u.pathname === "/redirige") {
      res.writeHead(302, { location: "https://ailleurs.invalid/x" });
      res.end();
    } else if (u.pathname === "/expire") {
      res.writeHead(410, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "file_gone", detail: "Le fichier a expiré ou a été supprimé : relancez le job." }));
    } else if (u.pathname === "/vide") {
      res.writeHead(200, { "content-length": 0 });
      res.end();
    }
  });
  await new Promise<void>((r) => serveur.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(serveur.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => serveur.close(() => r())));

const s = services();

describe("téléchargement", () => {
  it("écrit en .aethryon.part puis renomme ; nom unique si le fichier existe", async () => {
    const d = dossierTemporaire();
    writeFileSync(join(d, "Clip.mp4"), "déjà là");
    const r = await s.telecharger({ url: base + "/ok", dossier: d, nomSouhaite: "Clip.mp4" }, () => {});
    expect(r).toEqual({ chemin: join(d, "Clip (2).mp4"), taille: 200000 });
    expect(readdirSync(d).sort()).toEqual(["Clip (2).mp4", "Clip.mp4"]);
  });
  it("connexion coupée : erreur claire et aucun fichier partiel laissé", async () => {
    const d = dossierTemporaire();
    await expect(s.telecharger({ url: base + "/coupe", dossier: d, nomSouhaite: "a.mp4" }, () => {})).rejects.toThrow(/interrompu|incomplet|Connexion/);
    expect(readdirSync(d)).toEqual([]);
  });
  it("annulation : le .part est supprimé", async () => {
    const d = dossierTemporaire();
    const ac = new AbortController();
    const p = s.telecharger({ url: base + "/lent", dossier: d, nomSouhaite: "b.mp4" }, () => {}, ac.signal);
    setTimeout(() => ac.abort(), 120);
    await expect(p).rejects.toThrow(/annulée/);
    expect(readdirSync(d)).toEqual([]);
  });
  it("ne suit jamais une redirection (la clé ne part vers aucun autre serveur)", async () => {
    const d = dossierTemporaire();
    await expect(s.telecharger({ url: base + "/redirige", dossier: d, nomSouhaite: "c.mp4", entetes: { authorization: "Bearer ytc_secret0000" } }, () => {})).rejects.toMatchObject({ statut: 302 });
    expect(readdirSync(d)).toEqual([]);
  });
  it("reprend le message d'erreur du serveur ; refuse un fichier vide ou de taille inattendue", async () => {
    const d = dossierTemporaire();
    await expect(s.telecharger({ url: base + "/expire", dossier: d, nomSouhaite: "e.mp4" }, () => {})).rejects.toThrow(/expiré/);
    await expect(s.telecharger({ url: base + "/vide", dossier: d, nomSouhaite: "v.mp4" }, () => {})).rejects.toThrow(/vide/);
    await expect(s.telecharger({ url: base + "/ok", dossier: d, nomSouhaite: "t.mp4", tailleAttendue: 12 }, () => {})).rejects.toThrow(/inattendue/);
    expect(readdirSync(d)).toEqual([]);
  });
  it("nettoie les noms pour Windows", () => {
    expect(nettoyerNomFichier('Titre : "spécial" <1/2>?.mp4')).toBe("Titre spécial 1 2 .mp4".replace(" .mp4", ".mp4"));
    expect(nettoyerNomFichier("CON.mp4")).toBe("AETHRYON CON.mp4");
    expect(nettoyerNomFichier("...")).toBe("AETHRYON");
    expect(nettoyerNomFichier("a".repeat(300) + ".mp4").length).toBeLessThanOrEqual(145);
    expect(nettoyerNomFichier("x‮gnp.exe.mp4")).toBe("x gnp.exe.mp4");
  });
  it("écriture atomique et suppression limitée aux fichiers du panneau", async () => {
    const d = dossierTemporaire();
    const ss = services(d);
    await ss.fichiers.ecrireTexte(join(d, "sous", "reglages.json"), "{}");
    expect(readdirSync(join(d, "sous"))).toEqual(["reglages.json"]);
    await expect(ss.fichiers.supprimerFichierInterne("/etc/passwd")).rejects.toThrow(/refusée/);
    await ss.fichiers.supprimerFichierInterne(join(d, "sous", "reglages.json"));
    expect(readdirSync(join(d, "sous"))).toEqual([]);
  });
});
