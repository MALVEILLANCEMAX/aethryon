// Pont vers le moteur (commandes Tauri). Hors de Tauri (captures Playwright), `window.__MAQUETTE_SETUP__` fournit
// les mêmes fonctions, nourries par des instantanés produits par le VRAI moteur sur un système factice.
import type { Avancement, Detection, EtatInitial, Operation, Options } from "./types";

type Ecouteur = (a: Avancement) => void;

export interface Pont {
  etatInitial(): Promise<EtatInitial>;
  detecter(exeManuel: string | null): Promise<Detection>;
  choisirDossier(): Promise<string | null>;
  choisirPremiere(): Promise<string | null>;
  espaceLibre(chemin: string): Promise<number | null>;
  lancer(operation: Operation, options: Options, ecouteur: Ecouteur): Promise<Avancement>;
  annuler(): Promise<void>;
  inventaireMedias(chemin: string): Promise<[number, number]>;
  desinstaller(garderMedias: boolean, garderNavigateur: boolean, ecouteur: Ecouteur): Promise<Avancement>;
  ouvrir(quoi: "premiere" | "aethryon" | "journal" | "medias" | "navigateur"): Promise<void>;
  fenetre(action: "reduire" | "fermer"): Promise<void>;
  pret(): Promise<void>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __MAQUETTE_SETUP__?: Pont;
  }
}

async function tauri(): Promise<Pont> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const suivre = async <T>(f: () => Promise<T>, ecouteur: Ecouteur): Promise<T> => {
    const fin = await listen<Avancement>("avancement", (e) => ecouteur(e.payload));
    try {
      return await f();
    } finally {
      fin();
    }
  };
  return {
    etatInitial: () => invoke("etat_initial"),
    detecter: (exeManuel) => invoke("detecter", { exeManuel }),
    choisirDossier: () => invoke("choisir_dossier"),
    choisirPremiere: () => invoke("choisir_premiere"),
    espaceLibre: (chemin) => invoke("espace_libre", { chemin }),
    lancer: (operation, options, ecouteur) => suivre(() => invoke<Avancement>("lancer", { operation, options }), ecouteur),
    annuler: () => invoke("annuler"),
    inventaireMedias: (chemin) => invoke("inventaire_medias", { chemin }),
    desinstaller: (garderMedias, garderNavigateur, ecouteur) => suivre(() => invoke<Avancement>("desinstaller", { garderMedias, garderNavigateur }), ecouteur),
    ouvrir: (quoi) => invoke("ouvrir", { quoi }),
    fenetre: (action) => invoke("fenetre", { action }),
    pret: () => invoke("pret"),
  };
}

let pont: Promise<Pont> | null = null;

export function api(): Promise<Pont> {
  if (!pont) {
    pont = window.__TAURI_INTERNALS__ ? tauri() : window.__MAQUETTE_SETUP__ ? Promise.resolve(window.__MAQUETTE_SETUP__) : Promise.reject(new Error("Ni Tauri ni maquette : rien à afficher."));
  }
  return pont;
}

export function messageErreur(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Erreur inconnue.";
}
