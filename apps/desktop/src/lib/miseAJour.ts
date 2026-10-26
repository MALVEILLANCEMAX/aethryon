// Mise à jour d'AETHRYON Desktop (Paramètres › Mises à jour, avis discret de la barre latérale). JAMAIS silencieuse :
// la recherche lit seulement latest.json (au démarrage, puis une fois par jour, ou sur « Rechercher ») ; télécharger,
// vérifier et lancer le setup n'a lieu que sur le clic « Mettre à jour » (commande maj_installer du cœur Rust).
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface AnnonceDesktop {
  version: string;
  fichier: string;
  sha256: string;
  taille: number;
  publiee: string;
  notes: string[];
}
export interface Recherche {
  actuelle: string;
  disponible: boolean;
  annonce: AnnonceDesktop;
}
export type Phase = "inconnu" | "recherche" | "a-jour" | "disponible" | "erreur" | "telechargement" | "verification" | "lancement";
export interface EtatMaj {
  phase: Phase;
  recherche?: Recherche;
  erreur?: string;
  fait?: number;
  total?: number;
}

let etat: EtatMaj = { phase: "inconnu" };
const abonnes = new Set<() => void>();
function poser(e: EtatMaj): void {
  etat = e;
  for (const f of abonnes) f();
}

export function useMiseAJour(): EtatMaj {
  return useSyncExternalStore((f) => { abonnes.add(f); return () => abonnes.delete(f); }, () => etat);
}

const occupe = (p: Phase) => p === "recherche" || p === "telechargement" || p === "verification" || p === "lancement";

/** Lit l'annonce. `discret` : un échec ne montre rien (recherche automatique) et garde l'état précédent. */
export async function rechercher(discret = false): Promise<void> {
  if (occupe(etat.phase)) return;
  const avant = etat;
  poser({ ...etat, phase: "recherche", erreur: undefined });
  try {
    const r = await invoke<Recherche>("maj_rechercher");
    poser({ phase: r.disponible ? "disponible" : "a-jour", recherche: r });
  } catch (e) {
    poser(discret ? (avant.phase === "inconnu" ? { phase: "inconnu" } : avant) : { phase: "erreur", recherche: avant.recherche, erreur: texte(e) });
  }
}

/** Clic « Mettre à jour » : le cœur relit l'annonce, télécharge, vérifie, lance le setup, puis ferme le Desktop. */
export async function installer(): Promise<void> {
  if (occupe(etat.phase)) return;
  const recherche = etat.recherche;
  poser({ phase: "telechargement", recherche, fait: 0, total: recherche?.annonce.taille });
  const fin = await listen<{ etape: Phase; fait: number; total: number }>("maj-progression", (ev) => {
    const p = ev.payload;
    if (p.etape === "telechargement" || p.etape === "verification" || p.etape === "lancement") poser({ phase: p.etape, recherche, fait: p.fait, total: p.total });
  });
  try {
    await invoke<void>("maj_installer");
    poser({ phase: "lancement", recherche });
  } catch (e) {
    poser({ phase: "erreur", recherche, erreur: texte(e) });
  } finally {
    fin();
  }
}

function texte(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Recherche impossible.";
}

const pct = (f?: number, t?: number) => (t ? Math.min(100, Math.floor(((f ?? 0) / t) * 100)) : 0);

/** Titre et détail de la ligne « Mises à jour » (fonction pure, essayée par vitest). */
export function resume(e: EtatMaj, actuelle: string): { titre: string; detail: string } {
  const v = e.recherche?.annonce.version;
  switch (e.phase) {
    case "recherche":
      return { titre: "Recherche en cours…", detail: "Lecture de l'annonce publiée sur raccourci.malvu.fr." };
    case "a-jour":
      return { titre: "AETHRYON Desktop est à jour", detail: `Version ${actuelle}, la dernière publiée.` };
    case "disponible":
      return { titre: `Version ${v} disponible`, detail: `Installée : ${actuelle}. Le setup vérifié s'ouvrira sur « Mettre à jour », puis AETHRYON Desktop se fermera.` };
    case "telechargement":
      return { titre: `Téléchargement du setup · ${pct(e.fait, e.total)} %`, detail: e.recherche ? e.recherche.annonce.fichier : "" };
    case "verification":
      return { titre: "Vérification de l'empreinte SHA-256", detail: "Le setup n'est lancé que s'il est identique à celui annoncé." };
    case "lancement":
      return { titre: "Lancement du setup…", detail: "AETHRYON Desktop se ferme ; le setup termine la mise à jour." };
    case "erreur":
      return { titre: "Mise à jour impossible", detail: e.erreur ?? "Erreur inconnue." };
    default:
      return { titre: "Mises à jour", detail: `Version ${actuelle}. Aucune mise à jour n'est installée sans votre clic.` };
  }
}
