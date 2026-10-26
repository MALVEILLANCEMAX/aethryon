// Coque UXP + <webview> (plan E3, avant la fin annoncée de CEP) — ÉBAUCHE QUI COMPILE, NON BRANCHÉE.
//
// Principe (modèle « Webview UI » de Bolt UXP) : la MÊME interface web est chargée dans une <webview> d'un plugin UXP
// (allowLocalRendering: "yes", enableMessageBridge: "localAndRemote"). Elle ne touche ni au disque ni à Premiere :
// chaque méthode de « Hote » devient un message { id, methode, args } envoyé au plugin par window.uxpHost.postMessage ;
// le plugin (premiere.js de la bêta 2, fetch et fs d'UXP) exécute et répond { id, ok, valeur | erreur } par
// webview.postMessage, reçu ici par l'événement « message ». Types primitifs seulement (pas de fonction ni d'objet
// DOM) : le suivi d'un téléchargement arrive par des messages { suivi, recus, total }.
// Ce qui reste [non vérifié] dans Premiere : lecture vidéo locale dans la WebView, glisser depuis la WebView (UXP 9.1
// annonce le glisser entre panneaux UXP et WebView ; vers le panneau Projet : à prouver) — voir PLAN-COQUE-UXP.md.

import type { Capacites, Environnement, EtatSignature, Hote } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface PontUxp {
  postMessage(message: unknown): void;
}

declare global {
  interface Window {
    uxpHost?: PontUxp;
  }
}

export function uxpPresent(): boolean {
  return typeof window !== "undefined" && !!window.uxpHost;
}

export function creerHoteUxpWebview(): Hote {
  const pont = window.uxpHost!;
  let compteur = 0;
  const attentes = new Map<number, { ok: (v: any) => void; ko: (e: Error) => void; suivi?: (r: number, t: number | null) => void }>();

  window.addEventListener("message", (e: MessageEvent) => {
    const d = e.data as { id?: number; ok?: boolean; valeur?: unknown; erreur?: string; suivi?: boolean; recus?: number; total?: number | null };
    if (!d || typeof d.id !== "number") return;
    const a = attentes.get(d.id);
    if (!a) return;
    if (d.suivi) {
      a.suivi?.(Number(d.recus) || 0, d.total ?? null);
      return;
    }
    attentes.delete(d.id);
    if (d.ok) a.ok(d.valeur);
    else a.ko(new Error(d.erreur || "Erreur du plugin UXP"));
  });

  function demander<T>(methode: string, args: unknown[] = [], suivi?: (r: number, t: number | null) => void): Promise<T> {
    const id = ++compteur;
    return new Promise<T>((ok, ko) => {
      attentes.set(id, { ok, ko, suivi });
      pont.postMessage({ id, methode, args });
    });
  }

  const abonnes = new Set<(v: boolean) => void>();
  document.addEventListener("visibilitychange", () => abonnes.forEach((f) => f(document.visibilityState === "visible")));

  return {
    nom: "uxp-webview",
    environnement: () => demander<Environnement>("environnement"),
    capacites: async () => ({ ...(await demander<Capacites>("capacites")), glisserVersPremiere: "a-prouver" }),
    signature: () => demander<EtatSignature>("signature"),
    http: (r) => demander("http", [r]),
    telecharger: (r, suivi) => demander("telecharger", [r], suivi),
    fichiers: {
      existe: (c) => demander("fichiers.existe", [c]),
      lister: (d) => demander("fichiers.lister", [d]),
      lireTexte: (c) => demander("fichiers.lireTexte", [c]),
      ecrireTexte: (c, t) => demander("fichiers.ecrireTexte", [c, t]),
      ecrireBase64: (c, b) => demander("fichiers.ecrireBase64", [c, b]),
      creerDossier: (c) => demander("fichiers.creerDossier", [c]),
      supprimerFichierInterne: (c) => demander("fichiers.supprimerFichierInterne", [c]),
      renommer: (a, b) => demander("fichiers.renommer", [a, b]),
      testerEcriture: (d) => demander("fichiers.testerEcriture", [d]),
      espaceLibre: (d) => demander("fichiers.espaceLibre", [d]),
      joindre: (...p) => p.join("\\").replace(/\\{2,}/g, "\\"),
      // Les fichiers locaux seraient servis par le plugin (à prouver : allowLocalRendering ne couvre que le paquet).
      urlLocale: (c) => "file:///" + c.replace(/\\/g, "/"),
    },
    premiere: {
      projet: () => demander("premiere.projet"),
      importer: (c, m) => demander("premiere.importer", [c, m]),
      presentsDansProjet: (c) => demander("premiere.presentsDansProjet", [c]),
      presentsDansSequence: (c) => demander("premiere.presentsDansSequence", [c]),
      insererTeteLecture: (c, m) => demander("premiere.insererTeteLecture", [c, m]),
      ouvrirMoniteurSource: (c) => demander("premiere.ouvrirMoniteurSource", [c]),
      essaiImport: (c) => demander("premiere.essaiImport", [c]),
    },
    coffre: {
      lire: () => demander("coffre.lire"),
      ecrire: (c) => demander("coffre.ecrire", [c]),
      effacer: () => demander("coffre.effacer"),
      protection: () => demander("coffre.protection"),
    },
    ouvrirUrl: (u) => demander("ouvrirUrl", [u]),
    afficherDansExplorateur: (c) => demander("afficherDansExplorateur", [c]),
    choisirDossier: (i, t) => demander("choisirDossier", [i, t]),
    copierTexte: (t) => demander("copierTexte", [t]),
    // Glisser depuis la WebView vers Premiere : [non vérifié]. La coque UXP proposera une poignée native (27.0+).
    preparerGlisser: () => [],
    surVisibilite(f) {
      abonnes.add(f);
      return () => abonnes.delete(f);
    },
    definirMenu: (entrees) => void pont.postMessage({ id: 0, methode: "menu", args: [entrees] }),
    touchesVoulues: () => {},
    journaliser: (n, m) => void pont.postMessage({ id: 0, methode: "journal", args: [n, m] }),
  };
}
