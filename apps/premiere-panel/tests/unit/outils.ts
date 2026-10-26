// Aides des essais unitaires : services Node réels dans un dossier temporaire, hôte minimal pour le client d'API.
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { creerServicesNoeud } from "../../src/noeud/services";
import type { Hote } from "../../src/hote/types";

export const requireNode = createRequire(import.meta.url);

export function dossierTemporaire(prefixe = "aethryon-essai-"): string {
  return mkdtempSync(join(tmpdir(), prefixe));
}

export function services(dossierDonnees = dossierTemporaire(), journal: string[] = []) {
  return creerServicesNoeud(requireNode, {
    dossierDonnees,
    dossiersInternes: () => [dossierDonnees],
    httpLocalAdmis: true,
    journal: (n, m) => journal.push(`[${n}] ${m}`),
  });
}

/** Hôte réduit à ce que le client d'API utilise (réseau et téléchargement), sur les vrais services Node. */
export function hotePourClient(s = services()): Hote {
  return { http: s.http, telecharger: s.telecharger } as unknown as Hote;
}
