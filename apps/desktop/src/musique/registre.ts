// Registre partagé par la section MUSIQUE et le mini-lecteur (qui reste monté quand la section est fermée) : médias de
// l'index, fiches musicales, objets musicaux du Cloud. Le résolveur du lecteur y lit l'adresse à jouer :
//  - `loc:<id>` → fichier local servi par `asset:` (dossiers surveillés seulement) ;
//  - `cloud:<id>` → lien signé « apercu » de 5 min demandé au cœur (écoute sécurisée, rien n'est enregistré).
import { api, separateur, urlFichier } from "../lib/api";
import type { Media, ObjetCloud } from "../lib/types";
import { definirResolveur, type InfoPiste } from "./lecteur";
import { artistesDe, libelleQualite } from "./qualite";
import type { Piste } from "./types";

export const registre = {
  medias: new Map<string, Media>(),
  pistes: new Map<string, Piste>(),
  cloud: new Map<string, ObjetCloud>(),
  dossierPochettes: "",
};

export function urlPochette(nom: string | null | undefined): string | null {
  if (!nom) return null;
  if (nom.startsWith("https://")) return nom;
  if (!registre.dossierPochettes || !/^[0-9a-f]{32}\.(jpg|png|webp)$/.test(nom)) return null;
  const s = separateur(registre.dossierPochettes);
  return urlFichier(`${registre.dossierPochettes}${s}${nom}`);
}

export function infoLocale(p: Piste): InfoPiste {
  return { ref: `loc:${p.id}`, titre: p.titre, artistes: artistesDe(p), album: p.album, pochette: urlPochette(p.pochette), dureeS: p.dureeS, qualite: libelleQualite(p.qualite), source: "local" };
}

export function infoCloud(o: ObjetCloud): InfoPiste {
  const m = o.musique;
  return { ref: `cloud:${o.id}`, titre: m?.titre ?? o.nom, artistes: m?.artistes?.join(", ") || "Artiste inconnu", album: m?.album ?? null, pochette: m?.pochetteUrl ?? null, dureeS: typeof m?.audio?.dureeS === "number" ? (m.audio.dureeS as number) : null, qualite: null, source: "cloud" };
}

definirResolveur(async (ref) => {
  if (ref.startsWith("loc:")) {
    const id = ref.slice(4);
    const m = registre.medias.get(id);
    const p = registre.pistes.get(id);
    if (!m || m.etat !== "disponible" || !p) return null;
    return { url: urlFichier(m.chemin), info: infoLocale(p), cors: true };
  }
  if (ref.startsWith("cloud:")) {
    const o = registre.cloud.get(ref.slice(6));
    if (!o || o.audioDisponible === false || o.statut !== "sauvegarde") return null;
    const l = await api.cloudLien(o.id, "apercu");
    return { url: l.url, info: infoCloud(o), cors: false };
  }
  return null;
});

export function synchroniserMedias(medias: Media[]) {
  registre.medias = new Map(medias.map((m) => [m.id, m]));
}
