// Diagnostic intégré : un essai que le propriétaire lance UNE fois sur son PC, et qui produit un rapport copiable.
// Chaque ligne dit ce qui a été réellement mesuré ; un essai non fait reste « à faire », jamais « réussi ».
//   1. versions (Node, Premiere, CEP, Chromium, extension) ; 2. signature et PlayerDebugMode ;
//   3. pont ExtendScript ; 4. lecture d'un MP4 H.264/AAC LOCAL + miniature (canvas) ;
//   5. importFiles dans un chutier temporaire, puis nettoyage ; 6. réseau vers l'API ; 7. dossier des médias ;
//   8. clé (type de protection, jamais la clé) ; 9–10. glisser vers le panneau Projet et vers la timeline : essai
//      MANUEL, prouvé en relisant le projet et la séquence par ExtendScript.

import type { ClientApi } from "../api/client";
import essaiMp4 from "../assets/diagnostic/essai-aethryon.mp4?inline";
import type { Environnement, Hote } from "../hote/types";
import { dateRelative, definition, taille } from "../lib/format";
import type { Journal } from "../lib/journal";
import { miniatureVideo } from "../lib/miniatures";
import { VERSION } from "../version";
import type { EtatApp } from "./app";

export type IdEssai = "versions" | "signature" | "pont" | "video" | "import" | "reseau" | "dossier" | "cle" | "glisserProjet" | "glisserTimeline";
export type EtatEssai = "attente" | "en-cours" | "ok" | "echec" | "a-faire";

export interface EssaiDiag {
  id: IdEssai;
  titre: string;
  etat: EtatEssai;
  detail: string;
}

export interface EtatDiagnostic {
  enCours: boolean;
  lanceLe: string | null;
  essais: EssaiDiag[];
  glisser: { mode: "projet" | "timeline"; chemin: string; finA: number } | null;
}

const TITRES: Record<IdEssai, string> = {
  versions: "Versions",
  signature: "Signature de l’extension",
  pont: "Script hôte (ExtendScript)",
  video: "Lecture vidéo locale",
  import: "Import (importFiles)",
  reseau: "Réseau vers AETHRYON",
  dossier: "Dossier des médias",
  cle: "Clé du compte",
  glisserProjet: "Glisser vers le panneau Projet",
  glisserTimeline: "Glisser vers la timeline",
};

const ORDRE: IdEssai[] = ["versions", "signature", "pont", "video", "import", "glisserProjet", "glisserTimeline", "reseau", "dossier", "cle"];

export const DIAG_INITIAL: EtatDiagnostic = {
  enCours: false, lanceLe: null, glisser: null,
  essais: ORDRE.map((id) => ({ id, titre: TITRES[id], etat: id === "glisserProjet" || id === "glisserTimeline" ? "a-faire" : "attente", detail: "" })),
};

interface Dependances {
  hote: Hote;
  client: ClientApi;
  lire: () => EtatApp;
  ecrire: (m: Partial<EtatApp> | ((e: EtatApp) => Partial<EtatApp>)) => void;
  journal: Journal;
  enregistrerPreuve: (nom: "glisserProjet" | "glisserTimeline" | "lectureVideo" | "importFiles", ok: boolean) => void;
  env: () => Environnement;
  dossierEssais: () => string;
}

const BASE64_ESSAI = essaiMp4.slice(essaiMp4.indexOf(",") + 1);

export function creerDiagnostic(d: Dependances) {
  const { hote, client, lire, ecrire, journal } = d;
  let minuteurGlisser: ReturnType<typeof setTimeout> | null = null;

  function poser(id: IdEssai, etat: EtatEssai, detail: string) {
    ecrire((e) => ({ diag: { ...e.diag, essais: e.diag.essais.map((x) => (x.id === id ? { ...x, etat, detail } : x)) } }));
  }

  async function fichierEssai(nom: string): Promise<string> {
    const chemin = hote.fichiers.joindre(d.dossierEssais(), nom);
    await hote.fichiers.ecrireBase64(chemin, BASE64_ESSAI);
    return chemin;
  }

  async function mesurer<T>(f: () => Promise<T>): Promise<[T, number]> {
    const t0 = performance.now();
    const r = await f();
    return [r, Math.round(performance.now() - t0)];
  }

  async function essaiVersions() {
    const env = d.env();
    const p = [`extension ${VERSION}`, `coque ${env.hote}`, `CEP ${env.cepVersion ?? "?"}`, `Premiere ${env.premiereVersion ?? "?"}`, `Node ${env.nodeVersion ?? "?"}`, `Chromium ${env.chromiumVersion ?? "?"}`, env.os ?? ""];
    poser("versions", env.premiereVersion && env.nodeVersion ? "ok" : "echec", p.filter(Boolean).join(" · "));
  }

  async function essaiSignature() {
    const s = await hote.signature();
    const debug = s.modeDebogage === true ? "PlayerDebugMode ACTIVÉ (Premiere accepte alors toute extension non signée)" : s.modeDebogage === false ? "PlayerDebugMode absent" : "PlayerDebugMode non mesuré";
    poser("signature", s.etat === "signee" ? "ok" : "echec", `${s.etat === "signee" ? "Signée" : s.etat === "non-signee" ? "Non signée" : "Inconnue"} : ${s.detail} ${debug}.`);
  }

  async function essaiPont() {
    try {
      const [projet, ms] = await mesurer(() => hote.premiere.projet());
      poser("pont", "ok", `Réponse en ${ms} ms ; ${projet ? `projet « ${projet.nom} » ouvert` : "aucun projet ouvert"}.`);
    } catch (e) {
      poser("pont", "echec", e instanceof Error ? e.message : String(e));
    }
  }

  async function essaiVideo() {
    const v = document.createElement("video");
    const peut = v.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
    let chemin: string;
    try {
      chemin = await fichierEssai("essai-aethryon.mp4");
    } catch (e) {
      poser("video", "echec", "Fichier d’essai non écrit : " + (e instanceof Error ? e.message : String(e)));
      return;
    }
    const url = hote.fichiers.urlLocale(chemin);
    const lu = await new Promise<{ ok: boolean; detail: string }>((resoudre) => {
      const minuteur = setTimeout(() => resoudre({ ok: false, detail: "aucune image décodée en 6 s" }), 6000);
      v.muted = true;
      v.preload = "auto";
      v.addEventListener("error", () => {
        clearTimeout(minuteur);
        resoudre({ ok: false, detail: `erreur du lecteur (code ${v.error?.code ?? "?"})` });
      });
      v.addEventListener("loadeddata", async () => {
        try {
          await v.play();
          await new Promise((r) => setTimeout(r, 450));
          clearTimeout(minuteur);
          const avance = v.currentTime > 0.05;
          v.pause();
          resoudre({ ok: avance, detail: `${definition(v.videoWidth, v.videoHeight)}, ${v.duration.toFixed(1).replace(".", ",")} s${avance ? ", lecture qui avance" : ", lecture bloquée"}` });
        } catch (e) {
          clearTimeout(minuteur);
          resoudre({ ok: false, detail: "lecture refusée : " + (e instanceof Error ? e.message : String(e)) });
        }
      });
      v.src = url;
    });
    v.removeAttribute("src");
    const mini = lu.ok ? await miniatureVideo(url) : null;
    const miniOk = !!mini?.dataUrl;
    const ok = lu.ok && miniOk;
    d.enregistrerPreuve("lectureVideo", ok);
    poser("video", ok ? "ok" : "echec", `MP4 H.264/AAC local (canPlayType : « ${peut || "non"} ») : ${lu.detail} ; miniature ${miniOk ? "générée" : "impossible (canvas refusé)"}.`);
  }

  async function essaiImport() {
    if (!lire().projet) {
      await hote.premiere.projet().then((p) => ecrire({ projet: p })).catch(() => {});
    }
    if (!lire().projet) {
      poser("import", "echec", "Aucun projet ouvert : ouvre ou crée un projet puis relance le diagnostic.");
      return;
    }
    let chemin = "";
    try {
      chemin = await fichierEssai("essai-aethryon-import.mp4");
      const r = await hote.premiere.essaiImport(chemin);
      d.enregistrerPreuve("importFiles", !!r.ok);
      poser("import", r.ok ? "ok" : "echec", r.ok
        ? `Chutier temporaire « ${r.chutierTemporaire} » créé, fichier importé et retrouvé, chutier supprimé (${r.dureeMs} ms).`
        : `${r.message || ""} ${r.importe ? "Importé" : "Non importé"} ; ${r.nettoye ? "nettoyé" : "chutier temporaire à supprimer à la main"}. ${r.detail || ""}`.trim());
    } catch (e) {
      poser("import", "echec", e instanceof Error ? e.message : String(e));
    } finally {
      if (chemin) await hote.fichiers.supprimerFichierInterne(chemin).catch(() => {});
    }
  }

  async function essaiReseau() {
    const api = await client.sante();
    let site = "";
    let siteOk = false;
    try {
      const [r, ms] = await mesurer(() => hote.http({ methode: "GET", url: client.config.compte + "/", delaiMs: 10000 }));
      siteOk = r.statut >= 200 && r.statut < 400;
      site = `site : ${r.statut} en ${ms} ms`;
    } catch (e) {
      site = "site : " + (e instanceof Error ? e.message : String(e));
    }
    poser("reseau", api.ok && siteOk ? "ok" : "echec", `serveur de conversion : ${api.ok ? `joignable en ${api.ms} ms` : api.detail} ; ${site}.`);
  }

  async function essaiDossier() {
    const dossier = lire().dossierMedias;
    const t = await hote.fichiers.testerEcriture(dossier);
    const libre = t.ok ? await hote.fichiers.espaceLibre(dossier) : null;
    poser("dossier", t.ok ? "ok" : "echec", `${dossier} : ${t.ok ? "écriture possible" : t.message}${libre != null ? `, ${taille(libre)} libres` : ""}.`);
  }

  async function essaiCle() {
    const c = lire().connexion;
    if (c.etat !== "connecte") {
      poser("cle", "a-faire", "Aucune clé : connecte le compte (page Compte) pour vérifier sa protection.");
      return;
    }
    const p = await hote.coffre.protection();
    const texte = p === "dpapi" ? "protégée par DPAPI (profil Windows de l’utilisateur)" : p === "acl" ? "fichier du profil, accès réservé à l’utilisateur (DPAPI indisponible)" : p === "memoire" ? "gardée en mémoire seulement (profil non inscriptible)" : "protection inconnue";
    poser("cle", p === "dpapi" || p === "acl" ? "ok" : "echec", `Clé ${texte} ; jamais écrite dans un journal.`);
  }

  async function lancer() {
    if (lire().diag.enCours) return;
    ecrire((e) => ({ diag: { ...e.diag, enCours: true, lanceLe: new Date().toISOString(), essais: e.diag.essais.map((x) => (x.id === "glisserProjet" || x.id === "glisserTimeline" ? x : { ...x, etat: "attente", detail: "" })) } }));
    const etapes: [IdEssai, () => Promise<void>][] = [
      ["versions", essaiVersions], ["signature", essaiSignature], ["pont", essaiPont], ["video", essaiVideo],
      ["import", essaiImport], ["reseau", essaiReseau], ["dossier", essaiDossier], ["cle", essaiCle],
    ];
    for (const [id, f] of etapes) {
      poser(id, "en-cours", "");
      try {
        await f();
      } catch (e) {
        poser(id, "echec", e instanceof Error ? e.message : String(e));
      }
    }
    ecrire((e) => ({ diag: { ...e.diag, enCours: false } }));
    journal.ecrire("info", "diagnostic terminé");
    await enregistrerRapport();
  }

  async function essayerGlisser(mode: "projet" | "timeline") {
    arreterGlisser();
    const id: IdEssai = mode === "projet" ? "glisserProjet" : "glisserTimeline";
    if (mode === "timeline" && !lire().projet?.sequenceActive) {
      const p = await hote.premiere.projet().catch(() => null);
      ecrire({ projet: p });
      if (!p?.sequenceActive) {
        poser(id, "echec", "Aucune séquence active : ouvre une séquence dans la timeline puis recommence.");
        return;
      }
    }
    const h = new Date();
    const nom = `AETHRYON essai glisser ${mode} ${String(h.getHours()).padStart(2, "0")}h${String(h.getMinutes()).padStart(2, "0")}m${String(h.getSeconds()).padStart(2, "0")}.mp4`;
    const chemin = await fichierEssai(nom);
    const finA = Date.now() + 90000;
    ecrire((e) => ({ diag: { ...e.diag, glisser: { mode, chemin, finA } } }));
    poser(id, "en-cours", mode === "projet" ? "Glisse la carte dans le panneau Projet de Premiere." : "Glisse la carte sur une piste de la timeline.");
    const verifier = async () => {
      const g = lire().diag.glisser;
      if (!g || g.chemin !== chemin) return;
      try {
        const presents = mode === "projet" ? await hote.premiere.presentsDansProjet([chemin]) : await hote.premiere.presentsDansSequence([chemin]);
        if (presents.length) {
          d.enregistrerPreuve(id, true);
          poser(id, "ok", `Premiere a reçu le fichier (retrouvé dans ${mode === "projet" ? "le projet" : "la séquence active"} par ExtendScript). Tu peux supprimer « ${nom} » du projet.`);
          ecrire((e) => ({ diag: { ...e.diag, glisser: null } }));
          void enregistrerRapport();
          return;
        }
      } catch (e) {
        journal.ecrire("attention", "essai de glisser : " + (e instanceof Error ? e.message : String(e)));
      }
      if (Date.now() > finA) {
        d.enregistrerPreuve(id, false);
        poser(id, "echec", "Rien reçu en 90 s : Premiere n’a pas accepté le glisser (ou la carte n’a pas été déposée). Repli : « Importer » ou « Insérer à la tête de lecture ».");
        ecrire((e) => ({ diag: { ...e.diag, glisser: null } }));
        void enregistrerRapport();
        return;
      }
      minuteurGlisser = setTimeout(verifier, 1000);
    };
    minuteurGlisser = setTimeout(verifier, 1000);
  }

  function arreterGlisser() {
    if (minuteurGlisser) clearTimeout(minuteurGlisser);
    minuteurGlisser = null;
    const g = lire().diag.glisser;
    if (g) {
      const id: IdEssai = g.mode === "projet" ? "glisserProjet" : "glisserTimeline";
      if (lire().diag.essais.find((x) => x.id === id)?.etat === "en-cours") poser(id, "a-faire", "Essai interrompu.");
      ecrire((e) => ({ diag: { ...e.diag, glisser: null } }));
    }
  }

  function rapport(): string {
    const e = lire();
    const env = e.env;
    const marque: Record<EtatEssai, string> = { ok: "[OK]", echec: "[ÉCHEC]", "a-faire": "[À FAIRE]", attente: "[NON LANCÉ]", "en-cours": "[EN COURS]" };
    const lignes = [
      "AETHRYON pour Premiere Pro — rapport de diagnostic",
      `Date : ${e.diag.lanceLe ? dateRelative(e.diag.lanceLe) : "non lancé"} (${e.diag.lanceLe ?? "—"})`,
      `Extension ${VERSION} · ${env?.hote ?? "?"} · Premiere ${env?.premiereVersion ?? "?"} · CEP ${env?.cepVersion ?? "?"} · Node ${env?.nodeVersion ?? "?"} · Chromium ${env?.chromiumVersion ?? "?"} · ${env?.os ?? "?"}`,
      "",
      ...e.diag.essais.map((x) => `${marque[x.etat]} ${x.titre} — ${x.detail || "—"}`),
      "",
      "Ce rapport ne contient ni clé, ni mot de passe, ni adresse e-mail ; il cite des chemins locaux du PC.",
    ];
    return lignes.join("\n").replace(/[  ]/g, " ");
  }

  async function enregistrerRapport(): Promise<string | null> {
    const env = d.env();
    const nom = `diagnostic-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.txt`;
    const chemin = hote.fichiers.joindre(env.racineEchanges, "journaux", nom);
    try {
      await hote.fichiers.ecrireTexte(chemin, rapport());
      return chemin;
    } catch {
      return null;
    }
  }

  return {
    lancer, essayerGlisser, arreterGlisser, rapport,
    copierRapport: () => hote.copierTexte(rapport()),
    preparerGlisserEssai: (dt: DataTransfer) => {
      const g = lire().diag.glisser;
      return g ? hote.preparerGlisser(dt, [g.chemin]) : [];
    },
  };
}
