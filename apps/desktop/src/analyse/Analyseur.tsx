// Analyse sans ffmpeg (contrat §3, audit §6.5) : un <video>, <audio> ou <img> caché du WebView2 charge le fichier
// (protocole asset, limité aux dossiers surveillés), lit durée et définition, se place à 10 % de la durée, dessine
// l'image sur un canevas 480 × 270 (bandes noires pour les verticales) et l'envoie en JPEG au cœur Rust, qui l'écrit
// dans `miniatures\<id>.jpg`. Un fichier que WebView2 ne sait pas lire est marqué « échec » (jamais réessayé en boucle).
import { useEffect, useRef } from "react";
import { api, urlFichier } from "../lib/api";
import { useMagasin } from "../lib/magasin";
import type { AAnalyser } from "../lib/types";

const L = 480;
const H = 270;
const DELAI = 15000;

function dessiner(source: CanvasImageSource, sl: number, sh: number): string | null {
  const c = document.createElement("canvas");
  c.width = L;
  c.height = H;
  const x = c.getContext("2d");
  if (!x || !sl || !sh) return null;
  x.fillStyle = "#0f0f10";
  x.fillRect(0, 0, L, H);
  const e = Math.min(L / sl, H / sh);
  const l = sl * e;
  const h = sh * e;
  x.drawImage(source, (L - l) / 2, (H - h) / 2, l, h);
  try {
    return c.toDataURL("image/jpeg", 0.82);
  } catch {
    // Canevas « contaminé » (origine croisée) : pas de miniature, mais les mesures restent valables.
    return null;
  }
}

/** Forme d'onde calculée sur le fichier (pics par colonne), dessinée en or sur obsidienne, 480 × 270. */
async function ondes(src: string): Promise<{ duree: number; jpeg: string | null } | null> {
  const r = await fetch(src);
  const octets = await r.arrayBuffer();
  if (octets.byteLength > 80 * 1024 * 1024) return null;
  const ctxAudio = new OfflineAudioContext(1, 1, 44100);
  const tampon = await ctxAudio.decodeAudioData(octets);
  const donnees = tampon.getChannelData(0);
  const c = document.createElement("canvas");
  c.width = L;
  c.height = H;
  const x = c.getContext("2d");
  if (!x) return { duree: tampon.duration, jpeg: null };
  x.fillStyle = "#0f0f10";
  x.fillRect(0, 0, L, H);
  const colonnes = 132;
  const pas = Math.max(1, Math.floor(donnees.length / colonnes));
  const pics: number[] = [];
  for (let i = 0; i < colonnes; i++) {
    let p = 0;
    for (let j = i * pas; j < Math.min(donnees.length, (i + 1) * pas); j += 16) p = Math.max(p, Math.abs(donnees[j]));
    pics.push(p);
  }
  const max = Math.max(0.0001, ...pics);
  const g = x.createLinearGradient(0, H * 0.3, 0, H * 0.7);
  g.addColorStop(0, "#e3cda6");
  g.addColorStop(0.5, "#d4af7c");
  g.addColorStop(1, "#e3cda6");
  x.fillStyle = g;
  const l0 = L * 0.08;
  const lc = (L * 0.84) / colonnes;
  pics.forEach((p, i) => {
    const h = Math.max(1.5, (p / max) * H * 0.2);
    x.fillRect(l0 + i * lc, H / 2 - h, Math.max(1, lc * 0.62), h * 2);
  });
  return { duree: tampon.duration, jpeg: c.toDataURL("image/jpeg", 0.85) };
}

/** Analyse un média par le WebView2 (élément vidéo ou audio + canvas) : durée, définition, miniature JPEG. Réutilisée
 * par AETHRYON Index pour les vidéos scannées (`analyserVisibles` dans lib/index-medias.ts). */
export function analyser(a: AAnalyser): Promise<{ duree?: number | null; largeur?: number | null; hauteur?: number | null; echec?: boolean; jpeg: string | null }> {
  return new Promise((resoudre) => {
    let fini = false;
    let lecteur: HTMLMediaElement | null = null;
    const finir = (r: { duree?: number | null; largeur?: number | null; hauteur?: number | null; echec?: boolean; jpeg: string | null }) => {
      if (fini) return;
      fini = true;
      window.clearTimeout(minuterie);
      // Libère le lecteur dans TOUS les cas (échec, délai) : WebView2 limite le nombre de lecteurs vivants (≈ 75) et
      // l'aperçu vidéo au survol de la bibliothèque en a besoin.
      if (lecteur) { lecteur.onerror = null; lecteur.removeAttribute("src"); lecteur.load(); }
      resoudre(r);
    };
    const minuterie = window.setTimeout(() => finir({ echec: true, jpeg: null }), DELAI);
    const src = urlFichier(a.chemin);
    if (a.type === "image") {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => finir({ largeur: img.naturalWidth, hauteur: img.naturalHeight, jpeg: dessiner(img, img.naturalWidth, img.naturalHeight) });
      img.onerror = () => finir({ echec: true, jpeg: null });
      img.src = src;
      return;
    }
    const el = document.createElement(a.type === "audio" ? "audio" : "video") as HTMLVideoElement;
    lecteur = el;
    el.muted = true;
    el.preload = "metadata";
    if (a.type === "video") el.crossOrigin = "anonymous";
    el.onerror = () => finir({ echec: true, jpeg: null });
    el.onloadedmetadata = () => {
      const duree = Number.isFinite(el.duration) ? el.duration : null;
      if (a.type === "audio") {
        ondes(src).then((o) => finir({ duree: duree ?? o?.duree ?? null, jpeg: o?.jpeg ?? null })).catch(() => finir({ duree, jpeg: null }));
        return;
      }
      el.currentTime = Math.min((duree ?? 0) * 0.1, 10);
    };
    el.onseeked = () => {
      const duree = Number.isFinite(el.duration) ? el.duration : null;
      finir({ duree, largeur: el.videoWidth || null, hauteur: el.videoHeight || null, jpeg: dessiner(el, el.videoWidth, el.videoHeight) });
    };
    el.src = src;
  });
}

/** Analyse les médias en attente, un à la fois, quand la bibliothèque change. */
export function Analyseur() {
  const { inst } = useMagasin();
  const occupe = useRef(false);
  const cle = inst ? `${inst.index.misAJour}-${inst.index.medias.length}` : "";
  useEffect(() => {
    if (!inst || occupe.current || inst.plateforme === "maquette") return;
    occupe.current = true;
    (async () => {
      try {
        for (let tour = 0; tour < 50; tour++) {
          const liste = await api.aAnalyser(4);
          if (liste.length === 0) break;
          for (const a of liste) {
            const r = await analyser(a);
            await api.analyseEnregistrer(a.id, { duree: r.duree ?? null, largeur: r.largeur ?? null, hauteur: r.hauteur ?? null, echec: !!r.echec }, r.jpeg).catch(() => {});
          }
        }
      } finally {
        occupe.current = false;
      }
    })();
  }, [cle]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
