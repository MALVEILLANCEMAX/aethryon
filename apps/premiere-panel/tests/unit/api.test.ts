// Client d'API contre le FAUX serveur, avec les vrais services Node (réseau https/http, téléchargement en flux).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { creerClient, ErreurApi, ROUTES, TEXTES_CONNEXION } from "../../src/api/client";
import { CLE_ESSAI, demarrerFauxServeur } from "../faux-serveur.mjs";
import { dossierTemporaire, hotePourClient, services } from "./outils";

let fs: Awaited<ReturnType<typeof demarrerFauxServeur>>;
beforeAll(async () => {
  fs = await demarrerFauxServeur({ attentesAvantAccord: 2 });
});
afterAll(() => fs.fermer());

describe("connexion par page d'accord (routes et codes du vrai serveur account)", () => {
  it("routes : appairage, jeton, moi, deconnexion ; page d'accord et « Mes jetons » sur le site", () => {
    expect(ROUTES).toMatchObject({ appairage: "/api/premiere/appairage", jeton: "/api/premiere/jeton", moi: "/api/premiere/moi", deconnexion: "/api/premiere/deconnexion", pageAccord: "/premiere/connecter", jetons: "/dashboard/cles" });
  });
  it("appairage (corps strict hote / versionPremiere / versionExtension) puis 428, la clé une seule fois, puis 410 « déjà utilisé » (clé révoquée)", async () => {
    const c = creerClient(hotePourClient(), fs.config, () => null);
    const a = await c.appairer("PC-ESSAI", "26.5.2", "2.0.0");
    expect(a.codeUtilisateur).toMatch(/^TEST-/);
    expect(c.urlPageAccord(a)).toBe(`${fs.base}/premiere/connecter?code=${encodeURIComponent(a.codeUtilisateur)}`);
    expect(await c.jeton(a.codeAppareil)).toEqual({ etat: "en-attente" });
    expect(await c.jeton(a.codeAppareil)).toEqual({ etat: "en-attente" });
    const r = await c.jeton(a.codeAppareil);
    expect(r).toMatchObject({ etat: "accorde", cle: CLE_ESSAI, compte: { email: "essai@preprod.test" } });
    expect(await c.jeton(a.codeAppareil)).toEqual({ etat: "deja-utilise", message: TEXTES_CONNEXION["deja-utilise"] });
    expect(fs.revocations.get(CLE_ESSAI)).toBe("replay");
    fs.clesRevoquees.clear();
    fs.revocations.clear();
    const appel = fs.journal.find((j) => j.chemin === "/api/premiere/appairage");
    expect(appel?.corps).toEqual({ hote: "PC-ESSAI", versionPremiere: "26.5.2", versionExtension: "2.0.0" });
    expect(appel?.cle).toBe(false);
    // Node : ni Origin ni cookie (le serveur refuse toute origine web et n'envoie aucun en-tête CORS).
    expect(fs.journal.filter((j) => j.chemin.startsWith("/api/premiere/")).every((j) => j.origine === null && !j.cookie)).toBe(true);
  });
  it("appairage : champs absents plutôt que null ou vides, tronqués à 60 / 32 / 32 caractères", async () => {
    const c = creerClient(hotePourClient(), fs.config, () => null);
    await c.appairer("  ", null, "2.0.0");
    expect(fs.journal.filter((j) => j.chemin === "/api/premiere/appairage").pop()?.corps).toEqual({ versionExtension: "2.0.0" });
    await c.appairer("É".repeat(80), "9".repeat(40), "2.0.0-" + "b".repeat(40));
    const corps = fs.journal.filter((j) => j.chemin === "/api/premiere/appairage").pop()?.corps;
    expect([...corps.hote].length).toBe(60);
    expect(corps.versionPremiere.length).toBe(32);
    expect(corps.versionExtension.length).toBe(32);
  });
  it("refuse une page d'accord hors du site AETHRYON configuré", async () => {
    const autre = await demarrerFauxServeur({ urlVerification: "https://hameconnage.invalid/premiere/connecter" });
    const c = creerClient(hotePourClient(), autre.config, () => null);
    await expect(c.appairer("PC", null, "2.0.0")).rejects.toThrow(/inattendue/);
    await autre.fermer();
  });
  it("connexion pas encore ouverte (404 premiere_closed) ou routes absentes (404) : « pas encore disponible »", async () => {
    for (const o of [{ ferme: true }, { sansRoutes: true }]) {
      const autre = await demarrerFauxServeur(o);
      const c = creerClient(hotePourClient(), autre.config, () => null);
      const e = await c.appairer("PC", null, "2.0.0").catch((x) => x);
      expect(e).toBeInstanceOf(ErreurApi);
      expect(e).toMatchObject({ statut: 404, code: "indisponible" });
      expect(e.message).toMatch(/^Connexion pas encore disponible/);
      await autre.fermer();
    }
  });
  it("fins de connexion : chaque code du serveur donne un état et un message clairs en français", async () => {
    const cas: [Record<string, boolean>, string][] = [
      [{ refus: true }, "refuse"], [{ expire: true }, "expire"], [{ suspendu: true }, "suspendu"], [{ tropDOrdinateurs: true }, "trop-d-ordinateurs"],
    ];
    for (const [o, etat] of cas) {
      const autre = await demarrerFauxServeur({ attentesAvantAccord: 0, ...o });
      const c = creerClient(hotePourClient(), autre.config, () => null);
      const a = await c.appairer("PC", null, "2.0.0");
      const r = await c.jeton(a.codeAppareil);
      expect(r, etat).toEqual({ etat, message: TEXTES_CONNEXION[etat as keyof typeof TEXTES_CONNEXION] });
      await autre.fermer();
    }
    const c = creerClient(hotePourClient(), fs.config, () => null);
    expect(await c.jeton("code-inconnu-" + "x".repeat(30))).toEqual({ etat: "invalide", message: TEXTES_CONNEXION.invalide });
    expect(TEXTES_CONNEXION["trop-d-ordinateurs"]).toMatch(/Mes jetons/);
    for (const t of Object.values(TEXTES_CONNEXION)) expect(t).toMatch(/^[A-ZÉ].+[.]$/);
  });
  it("trop rapide : 429 avec Retry-After → « lent » et le délai demandé", async () => {
    const autre = await demarrerFauxServeur({ cadenceMs: 60000, retryAfter: 7 });
    const c = creerClient(hotePourClient(), autre.config, () => null);
    const a = await c.appairer("PC", null, "2.0.0");
    expect(await c.jeton(a.codeAppareil)).toEqual({ etat: "en-attente" });
    expect(await c.jeton(a.codeAppareil)).toEqual({ etat: "lent", intervalle: 7 });
    await autre.fermer();
  });
  it("/moi : forme du serveur (compte, quota, recentes, cle) ; déconnexion 204 sans corps ; ensuite 401 avec le motif", async () => {
    let cle: string | null = CLE_ESSAI;
    const c = creerClient(hotePourClient(), fs.config, () => cle);
    const moi = await c.moi();
    expect(moi.compte).toEqual({ email: "essai@preprod.test", nom: "Essai" });
    expect(moi.quota).toMatchObject({ utilise: 2, limite: 10, restant: 8, illimite: false });
    expect(moi.recentes[0]).toMatchObject({ plateforme: "youtube", format: "mp4", etat: "done" });
    expect(moi.cle.expireLe).toMatch(/^\d{4}-/);
    expect(moi.recentes.length).toBeLessThanOrEqual(5);
    expect(await c.deconnecter()).toBe(true);
    const appel = fs.journal.filter((j) => j.chemin === "/api/premiere/deconnexion").pop();
    expect(appel).toMatchObject({ methode: "POST", cle: true, typeContenu: null, origine: null });
    const e = await c.moi().catch((x) => x);
    expect(e).toMatchObject({ statut: 401, code: "token_revoked" });
    expect(e.message).toMatch(/révoqué depuis ton espace/);
    fs.clesRevoquees.clear();
    fs.revocations.clear();
    cle = null;
    await expect(c.moi()).rejects.toThrow(/Connecte ton compte/);
  });
});

describe("aperçu, conversion et téléchargement", () => {
  it("aperçu avec miniature servie par le serveur (data: URL, aucune requête vers la plateforme)", async () => {
    const c = creerClient(hotePourClient(), fs.config, () => CLE_ESSAI);
    const a = await c.apercu("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(a).toMatchObject({ title: "Essai : coucher de soleil", duration: 75 });
    expect(await c.miniature(a.thumbnail_id!)).toMatch(/^data:image\/jpeg;base64,\/9j\//);
    expect(fs.journal.filter((j) => j.chemin.startsWith("/media/preview")).every((j) => j.cle)).toBe(true);
  });
  it("conversion MP4 : transcode true, extrait arrondi, puis fichier en flux (.part puis renommage) sans suivre file_url", async () => {
    const dossier = dossierTemporaire();
    const s = services();
    const c = creerClient(hotePourClient(s), fs.config, () => CLE_ESSAI);
    let job = await c.creerJob({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", fmt: "mp4", quality: "720", start_s: 10.12345, end_s: 40 });
    const corps = fs.journal.filter((j) => j.chemin === "/media/jobs").pop()!.corps;
    expect(corps).toEqual({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", fmt: "mp4", quality: "720", transcode: true, start_s: 10.123, end_s: 40 });
    const vus: string[] = [];
    while (job.status !== "done") {
      job = await c.suivreJob(job.job_id);
      vus.push(job.stage);
    }
    expect(vus).toEqual(["downloading", "transcoding", "done"]);
    expect(fs.journal.some((j) => j.chemin.includes("wait=25&change=true"))).toBe(true);
    const suivi: number[] = [];
    let partielVu = false;
    const r = await c.telechargerFichier(job, dossier, (recus) => {
      suivi.push(recus);
      if (readdirSync(dossier).some((n) => n.endsWith(".aethryon.part"))) partielVu = true;
    });
    expect(r.taille).toBe(3 * 1024 * 1024 + 123);
    expect(statSync(r.chemin).size).toBe(r.taille);
    expect(r.chemin.endsWith("Essai coucher de soleil [x].mp4")).toBe(true); // « : » retiré (interdit sous Windows)
    expect(readdirSync(dossier)).toEqual(["Essai coucher de soleil [x].mp4"]);
    expect(partielVu).toBe(true);
    expect(suivi[suivi.length - 1]).toBe(r.taille);
    expect(fs.journal.some((j) => j.chemin === `/media/jobs/${job.job_id}/file`)).toBe(true);
    // Deuxième téléchargement du même fichier : jamais d'écrasement.
    const r2 = await c.telechargerFichier(job, dossier, () => {});
    expect(r2.chemin.endsWith("Essai coucher de soleil [x] (2).mp4")).toBe(true);
  });
  it("MP3 : débit, sans transcode ni qualité", async () => {
    const c = creerClient(hotePourClient(), fs.config, () => CLE_ESSAI);
    await c.creerJob({ url: "https://x.com/a/status/1712345678901234567", fmt: "mp3", bitrate: 320 });
    expect(fs.journal.filter((j) => j.chemin === "/media/jobs").pop()!.corps).toEqual({ url: "https://x.com/a/status/1712345678901234567", fmt: "mp3", bitrate: 320 });
  });
  it("quota atteint : message du serveur et délai", async () => {
    const autre = await demarrerFauxServeur({ refusJob: true });
    const c = creerClient(hotePourClient(), autre.config, () => CLE_ESSAI);
    const e = await c.creerJob({ url: "https://youtu.be/dQw4w9WgXcQ", fmt: "mp4" }).catch((x) => x);
    expect(e).toBeInstanceOf(ErreurApi);
    expect(e).toMatchObject({ statut: 429, code: "quota_exceeded", reessayerDans: 3600 });
    expect(e.message).toBe("Quota du jour atteint.");
    await autre.fermer();
  });
  it("annulation : DELETE du job", async () => {
    const c = creerClient(hotePourClient(), fs.config, () => CLE_ESSAI);
    const j = await c.creerJob({ url: "https://youtu.be/dQw4w9WgXcQ", fmt: "mp4" });
    await c.quitterJob(j.job_id);
    expect(fs.jobs.has(j.job_id)).toBe(false);
  });
  it("santé du serveur sans clé", async () => {
    const c = creerClient(hotePourClient(), fs.config, () => null);
    expect(await c.sante()).toMatchObject({ ok: true });
  });
  it("aucune connexion non chiffrée hors de 127.0.0.1", async () => {
    const c = creerClient(hotePourClient(), { compte: "http://exemple.com", api: "http://exemple.com/media" }, () => CLE_ESSAI);
    await expect(c.apercu("https://youtu.be/dQw4w9WgXcQ")).rejects.toThrow(/https/);
    expect(existsSync).toBeTruthy();
  });
});
