// Destination « Premiere Pro » (3.5.1, docs/EXTENSION.md §11) : règles partagées par le service worker, le menu
// des pages, le popup et les réglages.
// - Le fichier va dans le sous-dossier AETHRYON du dossier de téléchargement du navigateur (sous Windows, par
//   défaut : %USERPROFILE%\Downloads\AETHRYON), que surveille AETHRYON Desktop : il entre dans sa bibliothèque et
//   apparaît dans le panneau AETHRYON de Premiere, prêt à importer. Rien n'est importé automatiquement : c'est
//   l'utilisateur qui importe. 3.5.2 : l'envoi est en plus annoncé au Desktop par Native Messaging (permission
//   facultative, src/background/desktop.ts) ; aucun serveur local, aucun port réseau.
// - Premiere importe le MP4 en H.264 (ou HEVC) avec du son AAC, pas l'AV1, le VP9, le WebM ni l'Opus
//   (docs/EXTENSION.md §11) : la vidéo est demandée à ytapi avec transcode=true, qui livre TOUJOURS un .mp4
//   H.264 + AAC (pistes copiées quand elles le sont déjà, réencodées sinon ; le serveur refuse tout autre
//   résultat). Le MP3 s'importe tel quel.
import type { Quality } from "./types.ts";

/** Sous-dossier (relatif au dossier de téléchargement du navigateur) surveillé par le panneau de Premiere. */
export const PREMIERE_FOLDER = "AETHRYON";

/**
 * Qualité demandée à ytapi pour Premiere. « Auto » devient 1080p : avec transcode=true, « best » prendrait la plus
 * haute définition quel qu'en soit le codec (sur YouTube, du VP9 ou de l'AV1 au-dessus de 1080p) et la ferait
 * réencoder en H.264 par le serveur, long et limité en durée ; jusqu'à 1080p, YouTube a presque toujours du H.264,
 * copié sans réencodage (c'est déjà ce que donne « Auto » vers Téléchargements). Une qualité choisie reste la même.
 */
export function premiereQuality(q: Quality): Quality {
  return q === "best" ? "1080" : q;
}

/** 1440p et 2160p n'existent qu'en VP9 ou AV1 sur YouTube : le serveur réencode (plus long, durée limitée). */
export function premiereReencodes(q: Quality): boolean {
  return q === "1440" || q === "2160";
}
