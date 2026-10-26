// Fabriques d'essai partagées (médias, transferts, instantanés) : valeurs minimales, sans rien de réel.
import type { Instantane, Media, ResultatEnvoi, Transfert } from "../types";

export function media(p: Partial<Media>): Media {
  return {
    id: p.id ?? "a".repeat(40), chemin: `C:\\M\\${p.nom ?? "x"}.${p.ext ?? "mp4"}`, nom: "x", ext: "mp4", type: "video", taille: 1, ajouteLe: "2026-10-18T01:00:00Z",
    modifieLe: "2026-10-18T01:00:00Z", duree: null, largeur: null, hauteur: null, ips: null, codecVideo: null, codecAudio: null, miniature: null,
    etat: "disponible", premiereCompatible: null, origine: { plateforme: "local", titre: null }, ...p,
  };
}

export function transfert(p: Partial<Transfert>): Transfert {
  return { schema: 1, id: "t1", titre: "Coucher de soleil", plateforme: "youtube", format: "mp4", etat: "attente", progression: null, fichierAttendu: "Coucher de soleil.mp4", chemin: null, erreur: null, majLe: "2026-10-23T20:00:00Z", ...p };
}

export function resultat(p: Partial<ResultatEnvoi>): ResultatEnvoi {
  return { nom: "c1.json", action: "importer", ids: ["1".repeat(40)], ok: true, message: "1 importé dans « AETHRYON » (Montage-voyage)", le: "2026-10-23T20:00:00Z", ...p };
}

export function instantane(p: { medias?: Media[]; transferts?: Transfert[]; resultats?: ResultatEnvoi[]; connecte?: boolean; projetOuvert?: boolean | null; projet?: string | null; enAttente?: string[] } = {}): Instantane {
  const connecte = p.connecte ?? true;
  return {
    version: "1.1.0-beta.1", plateforme: "windows",
    config: { schema: 1, dossierMedias: "C:\\M", dossiersSurveilles: ["C:\\M"], surveillance: true, demarrageAuto: true, notifications: { mediaPret: true, importReussi: true, erreurs: true },
      theme: "sombre", reduireAnimations: "systeme", importAuto: false, chutierParDefaut: "aethryon", premiere: { ccxInstalle: "1.0.0", installeLe: null } },
    assistantTermine: true, racine: "C:\\R", dossierConfig: "C:\\C",
    index: { schema: 1, misAJour: "2026-10-23T20:00:00Z", dossiers: [{ chemin: "C:\\M", principal: true }], medias: p.medias ?? [] },
    transferts: p.transferts ?? [],
    liaison: { connecte, age: 1, panneau: connecte ? { schema: 1, version: "1.0.0", battement: "2026-10-23T20:00:00Z", premiereVersion: "26.5", projetOuvert: p.projetOuvert ?? true, projet: p.projet === undefined ? "Montage-voyage" : p.projet, visible: true } : null },
    imports: { schema: 1, imports: {} },
    premiere: { installations: [], principale: null, cherche: [], enCours: false },
    creativeCloud: { upia: null, application: null }, panneauCep: { dossier: "C:\\Users\\Élodie\\AppData\\Roaming\\Adobe\\CEP\\extensions\\fr.aethryon.premiere", version: "2.0.1", libelle: "Panneau AETHRYON 2.0.1 installé" }, nativeMessaging: [], demarrageActif: true, desinstallationPresente: true,
    erreursDossiers: [], journaux: [0, 0], resultats: p.resultats ?? [], enAttente: p.enAttente ?? [],
  };
}
