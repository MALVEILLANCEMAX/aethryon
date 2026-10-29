// Reconnaissance d'un lien SUR L'APPAREIL, sans aucune requête (accueil) : les règles précises du service pour les trois
// plateformes historiques (lib/probe.ts), le catalogue pour les autres. Le site ouvre lui-même (dans Tools) seulement
// YouTube, TikTok et X ; une plateforme en ligne du catalogue est dite reconnue, avec où la convertir.
import { probeLink } from "./probe.ts";
import { etatAffiche, ETATS, plateformeDuLienCatalogue, raisonPlateforme, type Plateforme } from "./catalogue.ts";

export type Reconnu = { nom: string; libelle: string; plateforme: Plateforme | null; dansTools: boolean };
export type Reconnaissance = { ok: true; r: Reconnu } | { ok: false; message: string; nom?: string };

export function reconnaitre(texte: string, coupees?: Partial<Record<"youtube" | "tiktok" | "twitter", boolean>>): Reconnaissance {
  const pf = plateformeDuLienCatalogue(texte);
  const p = probeLink(texte);
  if (p.state === "ok") {
    if (pf && etatAffiche(pf, coupees) === "temp") return { ok: false, message: raisonPlateforme(pf, "temp"), nom: pf.nom };
    return { ok: true, r: { nom: pf?.nom ?? "", libelle: p.label, plateforme: pf, dansTools: true } };
  }
  if (pf && !["youtube", "tiktok", "twitter"].includes(pf.id) && etatAffiche(pf, coupees) === "en-ligne") {
    return { ok: true, r: { nom: pf.nom, libelle: `Lien ${pf.nom} reconnu`, plateforme: pf, dansTools: false } };
  }
  if (pf && !["youtube", "tiktok", "twitter"].includes(pf.id)) {
    const e = etatAffiche(pf, coupees);
    return { ok: false, message: `${ETATS[e].libelle} : ${raisonPlateforme(pf, e)}`, nom: pf.nom };
  }
  return { ok: false, message: p.state === "refus" ? p.message : "Ce texte n'est pas un lien." };
}
