// État de la liaison avec Premiere Pro et fil d'activité, déduits uniquement de faits réels (battement du panneau,
// détection de l'exe, config, imports, transferts). Rien n'est supposé.
import type { Instantane, Media } from "./types";
import { heureCourte } from "./format";

export type StatutPremiere = "connecte" | "panneau-ferme" | "panneau-absent" | "incompatible" | "introuvable" | "inconnu";

export interface Liaison {
  statut: StatutPremiere;
  /** Version lue dans l'exe de Premiere, ou rapportée par le panneau. */
  version: string | null;
  titre: string;
  detail: string;
  /** Fil plein (relié) ou en pointillé. */
  relie: boolean;
}

/** Version courte « 26.5.2 » à partir de « 26.5.2.13 ». */
export function versionCourte(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.split(".").slice(0, 3).join(".");
}

export interface VersionsPanneau {
  /** Version rapportée par le panneau ouvert (battement), sinon lue dans le manifeste du panneau CEP installé. */
  installee: string | null;
  /** Panneau CEP présent (%APPDATA%\Adobe\CEP\extensions\fr.aethryon.premiere, posé par AETHRYON Setup). */
  present: boolean;
}

/** Plus aucun `.ccx` : seul le panneau CEP réellement installé compte (relu par le cœur à chaque instantané). */
export function versionsPanneau(i: Instantane): VersionsPanneau {
  return { installee: i.liaison.panneau?.version ?? i.panneauCep?.version ?? null, present: !!i.panneauCep };
}

export function liaison(i: Instantane): Liaison {
  const p = i.premiere.principale;
  const b = i.liaison.panneau;
  const version = versionCourte(b?.premiereVersion ?? p?.version ?? null);
  const panneauInstalle = !!i.panneauCep;
  if (i.liaison.connecte && b) {
    const projet = b.projetOuvert && b.projet ? `${b.projet}.prproj` : "aucun projet ouvert";
    return { statut: "connecte", version, titre: "Connecté", detail: `Panneau ${b.version ?? "?"} · ${projet}`, relie: true };
  }
  if (!p) {
    if (i.plateforme !== "windows") return { statut: "inconnu", version: null, titre: "Non vérifiable", detail: "Détection possible sous Windows seulement", relie: false };
    return { statut: "introuvable", version: null, titre: "Premiere Pro introuvable", detail: "Installe Premiere Pro 25.6 ou plus récent", relie: false };
  }
  if (p.compatible === false) {
    return { statut: "incompatible", version, titre: "Version trop ancienne", detail: "Le panneau demande Premiere Pro 25.6 ou plus récent", relie: false };
  }
  if (!panneauInstalle) {
    return { statut: "panneau-absent", version, titre: "Panneau non installé", detail: "« Réparer avec AETHRYON Setup » l'installe", relie: false };
  }
  return { statut: "panneau-ferme", version, titre: "Panneau fermé", detail: "Ouvre Premiere Pro, puis le panneau AETHRYON", relie: false };
}

export interface Activite {
  icone: "import" | "download" | "error" | "check" | "convert";
  titre: string;
  detail: string;
  heure: string;
  le: string;
  erreur?: boolean;
}

/** Fil d'activité : imports confirmés par le panneau, transferts, médias arrivés, demandes refusées. */
export function activites(i: Instantane, max = 4): Activite[] {
  const parId = new Map<string, Media>(i.index.medias.map((m) => [m.id, m]));
  const v: Activite[] = [];
  for (const [id, liste] of Object.entries(i.imports.imports ?? {})) {
    for (const imp of liste) {
      if (!imp.le) continue;
      const m = parId.get(id);
      v.push({ icone: "import", titre: "Importé dans Premiere", detail: m ? m.nom : "Média retiré de la bibliothèque", heure: heureCourte(imp.le), le: imp.le });
    }
  }
  for (const t of i.transferts) {
    const nom = t.titre ?? t.fichierAttendu ?? "Transfert";
    if (t.etat === "telechargement") v.push({ icone: "download", titre: `Téléchargement en cours${t.progression != null ? ` · ${Math.round(t.progression * 100)} %` : ""}`, detail: nom, heure: heureCourte(t.majLe), le: t.majLe });
    else if (t.etat === "conversion") v.push({ icone: "convert", titre: "Conversion en cours", detail: nom, heure: heureCourte(t.majLe), le: t.majLe });
    else if (t.etat === "erreur") v.push({ icone: "error", titre: "Téléchargement interrompu", detail: nom, heure: heureCourte(t.majLe), le: t.majLe, erreur: true });
  }
  for (const r of i.resultats) {
    if (!r.ok) v.push({ icone: "error", titre: "Import non effectué", detail: r.message, heure: heureCourte(r.le), le: r.le, erreur: true });
  }
  for (const m of i.index.medias) {
    if (m.etat === "disponible") v.push({ icone: "check", titre: "Média ajouté", detail: m.nom, heure: heureCourte(m.ajouteLe), le: m.ajouteLe });
  }
  return v.sort((a, b) => b.le.localeCompare(a.le)).slice(0, max);
}

/** Phrase d'état de l'Accueil : « tout fonctionne. » seulement si c'est vrai. */
export function phraseEtat(i: Instantane): string {
  const l = liaison(i);
  if (i.erreursDossiers.length > 0) return "le dossier surveillé est introuvable.";
  if (!i.config.surveillance) return "la surveillance du dossier est coupée.";
  if (l.statut === "connecte") return "tout fonctionne.";
  if (l.statut === "panneau-ferme") return "le panneau Premiere Pro n'est pas ouvert.";
  if (l.statut === "panneau-absent") return "le panneau Premiere Pro n'est pas installé.";
  if (l.statut === "incompatible") return "Premiere Pro doit être mis à jour pour le panneau.";
  if (l.statut === "introuvable") return "Premiere Pro n'a pas été trouvé sur ce PC.";
  return "surveillance active.";
}
