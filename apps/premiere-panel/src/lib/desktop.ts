// Compatibilité avec AETHRYON Desktop (FACULTATIF) — contrat d'échange v1/v1.1 (C-CONTRAT-ECHANGES.md).
// Le panneau est autonome : sans Desktop, il lit lui-même le dossier des médias. Quand Desktop est installé, le panneau :
//   - lit %APPDATA%\AETHRYON\config.json (dossier des médias choisi dans Desktop) ;
//   - lit R\bibliotheque\index.json (métadonnées, miniatures) et R\etat\desktop.json (battement) ;
//   - écrit R\etat\panneau.json (son battement) et R\etat\imports.json (imports réalisés), en écriture atomique ;
//   - 2.0.1 : traite la SEULE commande `importer` que lui adresse le Desktop (R\commandes\a-traiter\, contrat §5, §9,
//     §11.5 ; src/lib/commandes.ts) : prise par renommage dans traitees\, identifiants relus dans l'index, import par le
//     chemin habituel (importFiles puis vérification), résultat réel écrit dans traitees\. Aucune autre action.

import type { FichiersHote } from "../hote/types";

export interface EtatDesktop {
  /** Le dossier d'échange existe : Desktop est (ou a été) installé. */
  installe: boolean;
  /** Battement de moins de 6 s (contrat §4). */
  connecte: boolean;
  version: string | null;
  battement: string | null;
  dossierMedias: string | null;
  premiere: { detecte: boolean; version: string | null } | null;
}

export const DESKTOP_ABSENT: EtatDesktop = { installe: false, connecte: false, version: null, battement: null, dossierMedias: null, premiere: null };

export function cheminsDesktop(f: Pick<FichiersHote, "joindre">, racine: string, appdata: string) {
  return {
    config: f.joindre(appdata, "AETHRYON", "config.json"),
    index: f.joindre(racine, "bibliotheque", "index.json"),
    miniatures: f.joindre(racine, "bibliotheque", "miniatures"),
    battementDesktop: f.joindre(racine, "etat", "desktop.json"),
    battementPanneau: f.joindre(racine, "etat", "panneau.json"),
    imports: f.joindre(racine, "etat", "imports.json"),
    aTraiter: f.joindre(racine, "commandes", "a-traiter"),
    traitees: f.joindre(racine, "commandes", "traitees"),
  };
}

function json(texte: string | null): Record<string, unknown> | null {
  if (!texte) return null;
  try {
    const v = JSON.parse(texte.replace(/^﻿/, ""));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null; // fichier en cours d'écriture : relu au passage suivant (contrat §1)
  }
}

/** Lit le battement de Desktop. Connecté = battement de moins de 6 s. */
export function lireBattement(texte: string | null, maintenant = Date.now()): EtatDesktop {
  const j = json(texte);
  if (!j || j.schema !== 1) return { ...DESKTOP_ABSENT, installe: texte !== null };
  const b = typeof j.battement === "string" ? j.battement : null;
  const t = b ? Date.parse(b) : NaN;
  const p = j.premiere as Record<string, unknown> | undefined;
  return {
    installe: true,
    connecte: isFinite(t) && maintenant - t < 6000 && maintenant - t > -60000,
    version: typeof j.version === "string" ? j.version.slice(0, 40) : null,
    battement: b,
    dossierMedias: typeof j.dossierMedias === "string" ? j.dossierMedias : null,
    premiere: p && typeof p === "object" ? { detecte: !!p.detecte, version: typeof p.version === "string" ? p.version : null } : null,
  };
}

/** Dossier des médias réglé dans Desktop (config.json, schema 1), s'il existe. */
export function lireConfigDesktop(texte: string | null): { dossierMedias: string | null; importAuto: boolean | null } {
  const j = json(texte);
  if (!j || j.schema !== 1) return { dossierMedias: null, importAuto: null };
  return {
    dossierMedias: typeof j.dossierMedias === "string" && /^([A-Za-z]:\\|\\\\|\/)/.test(j.dossierMedias) ? j.dossierMedias : null,
    importAuto: typeof j.importAuto === "boolean" ? j.importAuto : null,
  };
}

export function battementPanneau(version: string, premiereVersion: string | null, projet: string | null, visible: boolean): string {
  return JSON.stringify({ schema: 1, version, battement: new Date().toISOString(), premiereVersion, projetOuvert: !!projet, projet, visible });
}

/** Ajoute des imports à R\etat\imports.json (contrat §4), sans perdre les entrées existantes. */
export function ajouterImports(texte: string | null, ids: string[], projet: string, chutier: string): string {
  const j = json(texte);
  const imports: Record<string, { projet: string; chutier: string; le: string }[]> =
    j && j.schema === 1 && j.imports && typeof j.imports === "object" ? (j.imports as Record<string, { projet: string; chutier: string; le: string }[]>) : {};
  const le = new Date().toISOString();
  for (const id of ids) {
    const liste = Array.isArray(imports[id]) ? imports[id]! : [];
    liste.push({ projet, chutier, le });
    imports[id] = liste.slice(-20);
  }
  return JSON.stringify({ schema: 1, imports });
}

/** Note des imports réussis dans R\etat\imports.json (lu par le Desktop : « Importé »), comme après un import manuel. */
export async function noterImports(f: Pick<FichiersHote, "lireTexte" | "ecrireTexte">, chemin: string, ids: string[], projet: string, chutier: string): Promise<void> {
  if (!ids.length) return;
  const avant = await f.lireTexte(chemin);
  await f.ecrireTexte(chemin, ajouterImports(avant, ids, projet, chutier));
}
