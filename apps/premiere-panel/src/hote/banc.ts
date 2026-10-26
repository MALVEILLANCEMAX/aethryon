// Hôte BANC (essai de bout en bout, jamais livré) : Premiere simulé, mais réseau et disque RÉELS.
// Le réseau, le téléchargement, les fichiers et le coffre passent par window.__banc, une fonction exposée par le script
// Playwright (tests/e2e/bout-en-bout.mjs) qui exécute src/noeud/services.ts dans Node — exactement le code que la
// coque CEP exécute dans Premiere avec cep_node.require. Seul ExtendScript est simulé (il n'existe pas ici).

import type { BilanImport, Environnement, Hote, ModeChutier } from "./types";
import { poserFormatsGlisser } from "../lib/glisser";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    __banc?: (nom: string, args: string) => Promise<string>;
    __bancSuivi?: (id: number, recus: number, total: number | null) => void;
    __bancPremiere?: { importes: string[]; sequence: string[] };
  }
}

export function creerHoteBanc(): Hote {
  const pont = window.__banc!;
  const suivis = new Map<number, (r: number, t: number | null) => void>();
  let n = 0;
  window.__bancSuivi = (id, recus, total) => suivis.get(id)?.(recus, total);

  async function appel<T>(nom: string, ...args: unknown[]): Promise<T> {
    const r = JSON.parse(await pont(nom, JSON.stringify(args)));
    if (r.erreur) throw Object.assign(new Error(r.erreur.message), r.erreur);
    return r.valeur as T;
  }

  // Premiere simulé, mais vérifiant l'existence RÉELLE des fichiers.
  const projet = { nom: "Projet du banc", chemin: null, chutierSelectionne: null, sequenceActive: "Séquence 01" };
  const dansProjet = new Set<string>();
  const dansSequence = new Set<string>();
  window.__bancPremiere = { importes: [], sequence: [] };
  const majVisible = () => {
    window.__bancPremiere = { importes: [...dansProjet], sequence: [...dansSequence] };
  };
  const existe = (c: string) => appel<boolean>("fichiers.existe", c);

  const hote: Hote = {
    nom: "banc",
    environnement: () => appel<Environnement>("environnement"),
    capacites: async () => ({ glisserVersPremiere: "a-prouver", lectureVideoLocale: true, premiere: true, reseau: true, coffre: (await appel<any>("coffre.protection")) || "acl", choisirDossier: false, afficherDansExplorateur: false }),
    signature: () => appel("signature"),
    http: (r) => appel("http", r),
    async telecharger(r, suivi) {
      const id = ++n;
      suivis.set(id, suivi);
      try {
        return await appel("telecharger", r, id);
      } finally {
        suivis.delete(id);
      }
    },
    fichiers: {
      existe,
      lister: (d) => appel("fichiers.lister", d),
      lireTexte: (c) => appel("fichiers.lireTexte", c),
      ecrireTexte: (c, t) => appel("fichiers.ecrireTexte", c, t),
      ecrireBase64: (c, b) => appel("fichiers.ecrireBase64", c, b),
      creerDossier: (c) => appel("fichiers.creerDossier", c),
      supprimerFichierInterne: (c) => appel("fichiers.supprimerFichierInterne", c),
      renommer: (a, b) => appel("fichiers.renommer", a, b),
      testerEcriture: (d) => appel("fichiers.testerEcriture", d),
      espaceLibre: (d) => appel("fichiers.espaceLibre", d),
      joindre: (...p) => p.join("/").replace(/\/{2,}/g, "/"),
      // Servi par le script Playwright (route /banc-fichier) à partir du vrai disque.
      urlLocale: (c) => "/banc-fichier?c=" + encodeURIComponent(c),
    },
    premiere: {
      projet: async () => projet,
      async importer(chemins: string[], mode: ModeChutier): Promise<BilanImport> {
        const resultats = [];
        for (const c of chemins) {
          if (!(await existe(c))) resultats.push({ chemin: c, ok: false, code: "introuvable" as const });
          else if (dansProjet.has(c)) resultats.push({ chemin: c, ok: true, deja: true });
          else {
            dansProjet.add(c);
            resultats.push({ chemin: c, ok: true });
          }
        }
        majVisible();
        return { ok: resultats.every((r) => r.ok), chutier: mode === "racine" ? "Racine du projet" : "AETHRYON", projet: projet.nom, resultats };
      },
      presentsDansProjet: async (c) => c.filter((x) => dansProjet.has(x)),
      presentsDansSequence: async (c) => c.filter((x) => dansSequence.has(x)),
      async insererTeteLecture(c) {
        if (!(await existe(c))) return { ok: false, message: "Fichier introuvable." };
        dansProjet.add(c);
        dansSequence.add(c);
        majVisible();
        return { ok: true, message: "Inséré (Premiere simulé)." };
      },
      ouvrirMoniteurSource: async () => ({ ok: true }),
      essaiImport: async (c) => ((await existe(c)) ? { ok: true, importe: true, nettoye: true, chutierTemporaire: "AETHRYON · diagnostic", dureeMs: 1 } : { ok: false, message: "absent" }),
    },
    coffre: {
      lire: () => appel("coffre.lire"),
      ecrire: (c) => appel("coffre.ecrire", c),
      effacer: () => appel("coffre.effacer"),
      protection: () => appel("coffre.protection"),
    },
    ouvrirUrl: (u) => appel("ouvrirUrl", u),
    afficherDansExplorateur: async () => ({ ok: false, message: "Banc : pas d’Explorateur." }),
    choisirDossier: async () => null,
    copierTexte: async () => true,
    preparerGlisser: (dt, chemins) => poserFormatsGlisser(dt, chemins, (c) => "file://" + c),
    surVisibilite: () => () => {},
    definirMenu: () => {},
    touchesVoulues: () => {},
    journaliser: (niveau, message) => void appel("journal", niveau, message).catch(() => {}),
  };
  return hote;
}
