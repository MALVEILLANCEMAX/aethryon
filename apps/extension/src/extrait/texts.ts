// Textes de l'éditeur d'extrait (3.6.0, TimeLens 3.8.0), en français : espace insécable U+00A0 avant « ? ! : ; % » et dans « »,
// apostrophe typographique ’, points de suspension …. Partagés par le menu des pages et le popup ; vérifiés par
// tests/unit/extraits-textes.test.ts.
import { ETAPE_LABEL, type Etape } from "../shared/etapes.ts";
import type { ClipFormat, Edge } from "../shared/extrait.ts";
import { formatDureeHorloge, formatInstantCourt, formatLimit, formatParle } from "../shared/timecode.ts";

export const NBSP = " ";

export const X = {
  region: "Extrait de la vidéo",
  rangeGroup: "Passage de l’extrait",
  startSlider: "Début de l’extrait",
  endSlider: "Fin de l’extrait",
  startField: "Début",
  endField: "Fin",
  fieldHint: "HH:MM:SS.mmm",
  startFieldAria: "Début de l’extrait, au format heures, minutes, secondes et millisecondes",
  endFieldAria: "Fin de l’extrait, au format heures, minutes, secondes et millisecondes",
  startHere: "Début ici",
  endHere: "Fin ici",
  startHereAria: "Marquer le début ici",
  endHereAria: "Marquer la fin ici",
  player: "Lecteur",
  playerUnknown: "Lecteur indisponible",
  previewAria: "Lire le passage dans la vidéo",
  previewStopAria: "Arrêter la lecture du passage",
  fine: "Ajuster finement",
  durationLegend: "Durée",
  durationField: "Durée",
  durationFieldAria: "Durée de l’extrait, au format heures, minutes, secondes et millisecondes",
  custom: "Personnalisé",
  edgeGroup: "Borne à régler",
  frameBack: "−1 image",
  frameFwd: "+1 image",
  tenthBack: `−0,1${NBSP}s`,
  tenthFwd: `+0,1${NBSP}s`,
  frameBackAria: "Reculer la borne d’une image",
  frameFwdAria: "Avancer la borne d’une image",
  tenthBackAria: "Reculer la borne d’un dixième de seconde",
  tenthFwdAria: "Avancer la borne d’un dixième de seconde",
  lensStart: "Début",
  lensEnd: "Fin",
  lensTip: "Descends ici pour affiner",
  hintClose: "Fermer l’astuce",
  hintOff: "Ne plus afficher d’astuces",
  presetVideo: "Plus long que la vidéo.",
  format: "Format",
  exportLabel: "Exporter l’extrait",
  tools: "Continuer dans Tools avec ce passage",
  durationUnknown: `Durée de la vidéo inconnue${NBSP}: saisis le début et la fin, le serveur vérifiera le passage.`,
  keysHelp: `Flèches${NBSP}: 1 image ou 100 ms · Maj${NBSP}: 1 s · Alt${NBSP}: 10 ms`,
  sending: "Envoi au serveur…",
  waiting: "En attente du serveur",
  waitingDetail: "L’export démarre dès qu’une place se libère sur le serveur.",
  extractsOff: "Les extraits ne sont pas activés sur ce serveur pour le moment.",
  quotaReached: `Quota du jour atteint${NBSP}: de nouveaux exports seront possibles après la remise à zéro.`,
  fixFields: "Corrige le début ou la fin avant d’exporter.",
  cancel: "Annuler",
  show: "Afficher",
  retry: "Réessayer",
  failed: "Export impossible",
  partialTitle: "Extraction partielle impossible",
  cancelled: "Export annulé",
  cancelledDetail: "Le serveur a arrêté la récupération. Tu peux modifier le passage et relancer.",
  quotaTitle: "Quota du jour atteint",
  networkTitle: "Serveur injoignable",
  done: "Terminé",
} as const;

export const FORMAT_LABEL: Record<ClipFormat, string> = { mp4: "MP4", mp3: "MP3", gif: "GIF" };

/** Note sous les formats : ce que contient le fichier. */
export function formatNote(f: ClipFormat, quality?: string): string {
  if (f === "mp3") return "Son seul, en MP3.";
  if (f === "gif") return "Image animée, sans son.";
  return quality && quality !== "Auto" ? `Vidéo en ${quality}, avec le son (H.264 et AAC).` : "Vidéo avec le son (H.264 et AAC).";
}

/** Ce qui a été corrigé après une saisie ou un geste (annoncé poliment, jamais une erreur). */
export const ADJUST = {
  clampedEnd: (tc: string) => `Fin ramenée à la durée de la vidéo (${tc}).`,
  clampedZero: (what: "début" | "fin") => `Un instant ne peut pas être négatif${NBSP}: ${what} ramené${what === "fin" ? "e" : ""} à 00:00:00.000.`,
  followedEnd: () => `Le début dépassait la fin${NBSP}: la fin suit pour garder la durée du passage.`,
  followedStart: () => `La fin précédait le début${NBSP}: le début suit pour garder la durée du passage.`,
  maxApplied: (len: string) => `Passage ramené à ${len}, la durée maximale autorisée par le serveur.`,
};

/** Textes de TimeLens (3.8.0) : valeurs venues du serveur et du passage, jamais écrites en dur. */
export const TL = {
  /** Bulle de durée : normale, près de la limite, à la limite, GIF plus court que le passage. */
  bubble: (lenMs: number) => formatDureeHorloge(lenMs),
  bubbleNear: (lenMs: number, maxMs: number) => `${formatDureeHorloge(lenMs)} · max ${formatDureeHorloge(maxMs)}`,
  bubbleMax: (maxMs: number) => `${formatDureeHorloge(maxMs)} · maximum`,
  bubbleGif: (gifMs: number) => `${formatDureeHorloge(gifMs)} en GIF`,
  /** « 0:12.5 → 0:42.5 » : insécable avant la flèche, coupure possible seulement après. */
  range: (s: number, e: number, hours: boolean) => `${formatInstantCourt(s, { hours })}${NBSP}→ ${formatInstantCourt(e, { hours })}`,
  now: (ms: number, hours: boolean) => `${X.player} ${formatInstantCourt(ms, { hours })}`,
  hereAria: (edge: Edge, ms: number | null) => `${edge === "start" ? X.startHereAria : X.endHereAria}${ms === null ? "" : `, lecteur à ${formatParle(ms)}`}`,
  placed: (edge: Edge, ms: number) => (edge === "start" ? `Début placé à ${formatParle(ms)}.` : `Fin placée à ${formatParle(ms)}.`),
  followLimit: (moved: Edge, maxMs: number) => `${moved === "start" ? "Le début suit" : "La fin suit"}${NBSP}: le serveur accepte ${formatLimit(maxMs)} par extrait.`,
  limitReached: (maxMs: number) => `Durée maximale atteinte${NBSP}: ${formatLimit(maxMs)} par extrait.`,
  passage: (s: number, e: number) => `Passage de ${formatParle(s)} à ${formatParle(e)}, durée ${formatParle(e - s)}.`,
  preset: (lenMs: number) => formatLimit(lenMs),
  presetAria: (lenMs: number, startMs: number) => `${formatParle(lenMs)} à partir de ${formatParle(startMs)}`,
  presetSaid: (lenMs: number, startMs: number) => `Durée${NBSP}: ${formatParle(lenMs)}, à partir de ${formatParle(startMs)}.`,
  presetGif: (gifMs: number) => `Un GIF dure ${formatLimit(gifMs)} au plus.`,
  presetMax: (maxMs: number) => `Au-delà de la durée maximale du serveur (${formatLimit(maxMs)}).`,
  gifLine: (gifMs: number) => `Un GIF dure ${formatLimit(gifMs)} au plus${NBSP}: seul le début du passage (${formatLimit(gifMs)}) sera exporté.`,
  gifSaid: (gifMs: number) => `GIF${NBSP}: seules les ${formatParle(gifMs)} du début du passage seront exportées.`,
  go: (lenMs: number, f: ClipFormat) => `Exporter ${formatDureeHorloge(lenMs)} en ${FORMAT_LABEL[f]}`,
  /**
   * Nom accessible du bouton : le texte visible d'abord (WCAG 2.5.3, « le nom contient le libellé »), puis la durée
   * parlée. D-SPEC §A.8 demandait « Exporter un extrait de 30 secondes en MP4 » seul : écart voulu, voir TIMELENS.md.
   */
  goAria: (lenMs: number, f: ClipFormat) => `${TL.go(lenMs, f)}, un extrait de ${formatParle(lenMs)}`,
  toolsTitle: (s: number, e: number, hours: boolean) => `Ouvre AETHRYON Tools avec ${formatInstantCourt(s, { hours })} → ${formatInstantCourt(e, { hours })}`,
  quota: (left: number) => (left === 1 ? "Plus qu’un export aujourd’hui" : `Plus que ${left} exports aujourd’hui`),
  hintInaction: () => `Lis la vidéo jusqu’au bon moment, puis «${NBSP}Début ici${NBSP}».`,
  hintHesitation: () => `Rien n’est envoyé avant «${NBSP}Exporter${NBSP}»${NBSP}: essaie librement.`,
  hintButee: (maxMs: number) => `Le serveur accepte ${formatLimit(maxMs)} par extrait. Pour un passage plus long, fais plusieurs extraits.`,
  hintPrecision: () => "Pour régler à l’image près, descends dans la lentille pendant le glisser.",
};

/** Titre de l'étape en cours, avec un pourcentage seulement s'il est mesuré. */
export function etapeTitle(e: Etape, progress: number | null): string {
  return progress === null ? ETAPE_LABEL[e] : `${ETAPE_LABEL[e]} · ${progress}${NBSP}%`;
}

/** Nom accessible de la barre d'avancement. */
export function progressAria(e: Etape | null, progress: number | null): string {
  const what = e ? ETAPE_LABEL[e] : X.sending;
  return progress === null ? `${what}, avancement non mesurable` : `${what}, ${progress}${NBSP}%`;
}

/** « Étape 2 sur 5 : Récupération de l’extrait » (lecteurs d'écran). */
export function stepAria(i: number, e: Etape, state: "fait" | "en cours" | "à venir" | "en échec"): string {
  return `Étape ${i + 1} sur 5${NBSP}: ${ETAPE_LABEL[e]} (${state})`;
}
