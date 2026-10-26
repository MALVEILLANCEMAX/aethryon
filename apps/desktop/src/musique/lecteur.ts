// Lecteur audio de la section MUSIQUE (un seul pour toute l'application : le mini-lecteur et la scène le partagent).
// Moteur : deux éléments <audio> — l'un passe par l'analyseur Web Audio (visualisation) quand la source le permet
// (fichier local servi par `asset:` avec CORS), l'autre joue directement (écoute Cloud par lien signé, ou fichier local
// si le CORS manque) : une source « opaque » branchée sur l'analyseur serait rendue muette, donc jamais branchée.
// Progression, durée, position : celles de l'élément <audio> (rien d'estimé). Reprise : file, position, volume et modes
// enregistrés par le cœur (lecture.json), au plus toutes les 5 s pendant la lecture, et à chaque pause ou changement.
// Touches multimédia de Windows : Media Session (titre, artiste, pochette, lecture, pause, précédent, suivant).
import { useSyncExternalStore } from "react";
import * as F from "./file";
import type { EtatLecture, Repetition } from "./types";
import { musiqueApi } from "./api";

export interface InfoPiste { ref: string; titre: string; artistes: string; album: string | null; pochette: string | null; dureeS: number | null; qualite: string | null; source: "local" | "cloud" }
export interface Resolu { url: string; info: InfoPiste; cors: boolean }
/** Donne l'adresse lisible et la fiche d'une référence (fourni par la section MUSIQUE, qui connaît les médias). */
export type Resolveur = (ref: string) => Promise<Resolu | null>;

export interface EtatLecteur {
  file: F.File;
  info: InfoPiste | null;
  enLecture: boolean;
  chargement: boolean;
  position: number;
  duree: number | null;
  volume: number;
  muet: boolean;
  /** La visualisation reçoit-elle le signal de ce morceau ? (faux : écoute Cloud, CORS absent) */
  visualisable: boolean;
  erreur: string | null;
  /** Morceaux écoutés (identifiants, 200 derniers) : base des suggestions de la bibliothèque. */
  ecoutes: string[];
}

let etat: EtatLecteur = { file: F.VIDE, info: null, enLecture: false, chargement: false, position: 0, duree: null, volume: 0.8, muet: false, visualisable: false, erreur: null, ecoutes: [] };
const ecouteurs = new Set<() => void>();
const changer = (p: Partial<EtatLecteur>) => { etat = { ...etat, ...p }; for (const e of ecouteurs) e(); };
export const lireEtat = () => etat;
export const abonner = (e: () => void) => { ecouteurs.add(e); return () => { ecouteurs.delete(e); }; };
export function useLecteur(): EtatLecteur { return useSyncExternalStore(abonner, lireEtat); }

/** Le mini-lecteur de la fenêtre n'est monté qu'une fois une lecture demandée (signal lu par la coque). */
export const actif = () => etat.file.ordre.length > 0;

let resoudre: Resolveur = async () => null;
export function definirResolveur(r: Resolveur) { resoudre = r; }

// ---- Moteur ---------------------------------------------------------------------------------------------------------

let visu: HTMLAudioElement | null = null;
let direct: HTMLAudioElement | null = null;
let courantEl: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;
let analyseur: AnalyserNode | null = null;
let jeton = 0;

function element(cors: boolean): HTMLAudioElement {
  if (cors) {
    if (!visu) { visu = new Audio(); visu.crossOrigin = "anonymous"; brancherEvenements(visu); }
    return visu;
  }
  if (!direct) { direct = new Audio(); brancherEvenements(direct); }
  return direct;
}

/** Analyseur partagé (créé au premier geste de lecture), branché sur l'élément « CORS » seulement. */
export function analyseurAudio(): AnalyserNode | null {
  return etat.visualisable ? analyseur : null;
}

function graphe(el: HTMLAudioElement) {
  if (analyseur || typeof AudioContext === "undefined") return;
  try {
    ctx = new AudioContext();
    const src = ctx.createMediaElementSource(el);
    analyseur = ctx.createAnalyser();
    analyseur.fftSize = 512;
    analyseur.smoothingTimeConstant = 0.78;
    src.connect(analyseur);
    analyseur.connect(ctx.destination);
  } catch {
    analyseur = null;
  }
}

function brancherEvenements(el: HTMLAudioElement) {
  el.preload = "auto";
  el.addEventListener("timeupdate", () => { if (el === courantEl) changer({ position: el.currentTime }); enregistrerPlusTard(); });
  el.addEventListener("durationchange", () => { if (el === courantEl) changer({ duree: Number.isFinite(el.duration) ? el.duration : null }); });
  el.addEventListener("playing", () => { if (el === courantEl) changer({ enLecture: true, chargement: false, erreur: null }); majSession(); });
  el.addEventListener("waiting", () => { if (el === courantEl) changer({ chargement: true }); });
  el.addEventListener("pause", () => { if (el === courantEl) { changer({ enLecture: false }); enregistrer(); } majSession(); });
  el.addEventListener("ended", () => { if (el === courantEl) void finNaturelle(); });
  el.addEventListener("error", () => { if (el === courantEl) void erreurLecture(el); });
}

async function erreurLecture(el: HTMLAudioElement) {
  // Fichier local servi sans en-tête CORS : on rejoue le même fichier sans visualisation plutôt que d'échouer.
  if (el === visu && etat.info?.source === "local") {
    const t = el.currentTime;
    const src = el.currentSrc || el.src;
    el.removeAttribute("src");
    const d = element(false);
    courantEl = d;
    changer({ visualisable: false });
    d.src = src;
    d.volume = etat.muet ? 0 : etat.volume;
    try { d.currentTime = t; await d.play(); return; } catch { /* message ci-dessous */ }
  }
  const code = el.error?.code;
  changer({ enLecture: false, chargement: false, erreur: code === 4 ? "Ce fichier ne peut pas être lu par le lecteur (format ou fichier abîmé)." : code === 2 ? "Lecture interrompue : fichier indisponible (lien expiré ou disque débranché)." : "Lecture impossible." });
}

async function charger(f: F.File, depart = 0, jouer = true) {
  const ref = F.courant(f);
  const mon = ++jeton;
  changer({ file: f, chargement: !!ref, erreur: null, position: depart, duree: null });
  if (!ref) { arreterElements(); changer({ info: null, enLecture: false, chargement: false }); return; }
  const r = await resoudre(ref).catch(() => null);
  if (mon !== jeton) return;
  if (!r) {
    changer({ chargement: false, enLecture: false, info: null, erreur: "Ce morceau n'est plus disponible (fichier déplacé, supprimé ou audio expiré dans le Cloud)." });
    return;
  }
  arreterElements();
  const el = element(r.cors);
  courantEl = el;
  if (r.cors) graphe(el);
  el.src = r.url;
  el.volume = etat.muet ? 0 : etat.volume;
  changer({ info: r.info, visualisable: r.cors && !!analyseur, duree: r.info.dureeS });
  if (depart > 0) {
    await new Promise<void>((ok) => { const f2 = () => { el.removeEventListener("loadedmetadata", f2); ok(); }; el.addEventListener("loadedmetadata", f2); window.setTimeout(ok, 1500); });
    if (mon !== jeton) return;
    try { el.currentTime = depart; } catch { /* position gardée à 0 */ }
  }
  const id = ref.startsWith("loc:") ? ref.slice(4) : null;
  if (id && jouer) changer({ ecoutes: [...etat.ecoutes.filter((x) => x !== id), id].slice(-200) });
  if (jouer) {
    await ctx?.resume().catch(() => {});
    try { await el.play(); } catch (e) { if (mon === jeton && (e as Error)?.name !== "AbortError") changer({ chargement: false, enLecture: false }); }
  } else changer({ chargement: false });
  majSession();
  enregistrer();
}

function arreterElements() {
  for (const el of [visu, direct]) if (el && !el.paused) el.pause();
}

async function finNaturelle() {
  const n = F.suivant(etat.file, true);
  if (!n) { changer({ enLecture: false, position: 0 }); if (courantEl) courantEl.currentTime = 0; enregistrer(); return; }
  if (n.pos === etat.file.pos && F.courant(n) === F.courant(etat.file) && courantEl) {
    courantEl.currentTime = 0;
    await courantEl.play().catch(() => {});
    return;
  }
  await charger(n);
}

// ---- Commandes publiques ----------------------------------------------------------------------------------------------

/** Lit une liste à partir d'un morceau (album, playlist, sélection, bibliothèque filtrée). */
export function lire(refs: string[], depart = 0) {
  void charger(F.creer(refs, depart, etat.file.aleatoire, etat.file.repetition));
}

export function basculer() {
  const el = courantEl;
  if (!el || !etat.info) {
    if (etat.file.ordre.length) void charger(etat.file, etat.position);
    return;
  }
  if (el.paused) { void ctx?.resume(); void el.play().catch(() => {}); } else el.pause();
}

export function pause() { courantEl?.pause(); }

export function suivantManuel() {
  const n = F.suivant(etat.file, false);
  if (n) void charger(n);
}

export function precedentManuel() {
  const { file, redemarrer } = F.precedent(etat.file, courantEl?.currentTime ?? 0);
  if (redemarrer) { if (courantEl) courantEl.currentTime = 0; changer({ position: 0 }); return; }
  void charger(file);
}

export function chercher(s: number) {
  const el = courantEl;
  if (!el) return;
  const d = Number.isFinite(el.duration) ? el.duration : etat.duree ?? 0;
  el.currentTime = Math.max(0, Math.min(d || s, s));
  changer({ position: el.currentTime });
}

export function volume(v: number) {
  const x = Math.max(0, Math.min(1, v));
  // Toucher le volume rend le son (fin du « muet »), comme partout ailleurs.
  for (const el of [visu, direct]) if (el) el.volume = x;
  changer({ volume: x, muet: false });
  enregistrerPlusTard();
}

export function muet() {
  const m = !etat.muet;
  for (const el of [visu, direct]) if (el) el.volume = m ? 0 : etat.volume;
  changer({ muet: m });
}

export function aleatoire() { changer({ file: F.basculerAleatoire(etat.file) }); enregistrer(); }
export function repetition(r?: Repetition) { changer({ file: { ...etat.file, repetition: r ?? F.cycleRepetition(etat.file.repetition) } }); enregistrer(); }
export function ajouterFile(refs: string[], ou: "ensuite" | "fin") {
  const vide = !etat.file.ordre.length;
  const f = F.ajouter(etat.file, refs, ou);
  if (vide) void charger(f); else { changer({ file: f }); enregistrer(); }
}
export function retirerAVenir(n: number) { changer({ file: F.retirerAVenir(etat.file, n) }); enregistrer(); }
export function deplacerAVenir(de: number, vers: number) { changer({ file: F.deplacerAVenir(etat.file, de, vers) }); enregistrer(); }
export function allerA(n: number) { void charger(F.allerA(etat.file, n)); }
export function vider() { jeton++; arreterElements(); changer({ file: { ...F.VIDE, aleatoire: etat.file.aleatoire, repetition: etat.file.repetition }, info: null, enLecture: false, position: 0, duree: null }); enregistrer(); }

/** Volume enregistré (reprise) : appliqué dès l'ouverture de la section, sans rien jouer. */
export function volumeEnregistre(l: EtatLecture) {
  if (!etat.file.ordre.length) changer({ volume: l.volume });
}

/** « Reprendre la lecture » : la file, le morceau et la position enregistrés par le cœur, joués à la demande. */
export function reprendre(l: EtatLecture) {
  if (!l.file.length) return;
  changer({ volume: l.volume, file: { ...F.depuisEtat(l) } });
  void charger(F.depuisEtat(l), l.positionS, true);
}

// ---- Enregistrement de la reprise (cœur) -------------------------------------------------------------------------------

let minuterie: number | undefined;
let dernier = 0;
function enregistrerPlusTard() {
  if (Date.now() - dernier < 5000) return;
  window.clearTimeout(minuterie);
  minuterie = window.setTimeout(enregistrer, 400);
}
function enregistrer() {
  dernier = Date.now();
  const e = F.versEtat(etat.file);
  void musiqueApi.lecture({ ...e, positionS: courantEl?.currentTime ?? etat.position, volume: etat.volume, majLe: "" }).catch(() => {});
}

// ---- Media Session (touches multimédia, superposition de Windows) ------------------------------------------------------

function majSession() {
  const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
  if (!ms) return;
  const i = etat.info;
  try {
    ms.metadata = i ? new MediaMetadata({ title: i.titre, artist: i.artistes, album: i.album ?? "", artwork: i.pochette ? [{ src: i.pochette }] : [] }) : null;
    ms.playbackState = etat.enLecture ? "playing" : i ? "paused" : "none";
    ms.setActionHandler("play", () => basculer());
    ms.setActionHandler("pause", () => pause());
    ms.setActionHandler("previoustrack", () => precedentManuel());
    ms.setActionHandler("nexttrack", () => suivantManuel());
  } catch { /* Media Session absente ou partielle */ }
}

/** Essais (vitest, maquette) : remet le lecteur à zéro. */
export function _reinitialiser() {
  jeton++;
  etat = { file: F.VIDE, info: null, enLecture: false, chargement: false, position: 0, duree: null, volume: 0.8, muet: false, visualisable: false, erreur: null, ecoutes: [] };
}
