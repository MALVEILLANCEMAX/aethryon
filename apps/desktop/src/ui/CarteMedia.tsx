// Carte d'un média (mosaïque et ligne), extraite de pages/Bibliotheque.tsx (D-SPEC §B.4.1, §B.5).
// - Survol (pointeur fin seulement) : montée de 2 px en ressort `vif` après 60 ms d'intention, lumière de bord qui suit
//   le pointeur (variables écrites sur la SEULE couche de lumière, une fois par image : pas de recalcul des enfants).
// - Nocturne : la miniature domine ; format en haut à gauche, durée en bas à droite, état en bas à gauche ; la ligne
//   d'informations secondaires n'apparaît qu'au survol, au focus ou à la sélection. Aperçu VIDÉO au survol (souris,
//   450 ms d'intention, muet, une seule carte à la fois, jamais en mouvement réduit) pour les formats que WebView2 lit.
// - Case de sélection (cercle de 20 px), barre d'actions rapides EXISTANTES.
// - Glisser natif : au-delà de 6 px, bouton tenu, la carte (ou la sélection) part par le socle (`onGlisser`) ; jamais
//   de glisser HTML5. Un média non disponible n'est pas glissable (« Pas encore prêt »).
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import type { Media } from "../lib/types";
import { delaiCascade } from "../lib/motion";
import { mouvementReduit } from "../lib/mouvement";
import { urlFichier } from "../lib/api";
import { BoutonIcone, Icone } from "./base";
import { Miniature } from "./Miniature";

export interface PropsCarte {
  m: Media;
  racine: string;
  vue: "grille" | "liste";
  index: number;
  choisi: boolean;
  focusable: boolean;
  pct: number | null;
  pastille: ReactNode;
  quand: string;
  meta: string;
  colonnes?: { duree: string; taille: string };
  /** Glisser possible (socle présent et média disponible). */
  glissable: boolean;
  /** Source d'un glisser en cours (elle ou la sélection dont elle fait partie). */
  source: boolean;
  nouveau: boolean;
  selectionActive: boolean;
  animerEntree: boolean;
  /** Liste virtualisée : taille de l'ensemble et rang (lecteurs d'écran). */
  aria?: { setsize: number; posinset: number };
  onClick: (e: MouseEvent) => void;
  onDoubleClick: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onContextMenu: (e: MouseEvent) => void;
  onFocus: () => void;
  onBascule: () => void;
  onVu: () => void;
  onGlisser: () => void;
  onApercu: () => void;
  onAction: (id: "importer" | "explorateur" | "copier") => void;
  onPlus: (el: HTMLElement) => void;
}

const SEUIL_GLISSER = 6;
/** Formats que WebView2 (Chromium) lit nativement pour l'aperçu au survol. */
const LISIBLES = /^(mp4|m4v|mov|webm)$/i;
const INTENTION_APERCU = 450;
/** Une seule vidéo d'aperçu à la fois dans toute la fenêtre. */
let arreterApercu: (() => void) | null = null;

/** Vidéo d'aperçu (muette, en boucle, depuis 10 % de la durée) ; elle apparaît en fondu dès qu'elle joue. Illisible
 *  (codec, fichier verrouillé) : la miniature reste, sans nouvel essai pour cette carte. */
function VideoApercu({ m, onEchec }: { m: Media; onEchec: () => void }) {
  return (
    <video className="pic-video" src={urlFichier(m.chemin)} muted playsInline autoPlay loop preload="auto" aria-hidden="true" tabIndex={-1}
      onLoadedMetadata={(e) => { const v = e.currentTarget; if (Number.isFinite(v.duration) && v.duration > 6) v.currentTime = Math.min(5, v.duration * 0.1); }}
      onPlaying={(e) => { e.currentTarget.dataset.lecture = ""; }}
      onError={onEchec} />
  );
}

export function CarteMedia(p: PropsCarte) {
  const { m } = p;
  const lumiere = useRef<HTMLSpanElement>(null);
  const depart = useRef<{ x: number; y: number } | null>(null);
  const aGlisse = useRef(false);
  const image = useRef<number | null>(null);
  const dispo = m.etat === "disponible";
  // Fin d'un glisser : la carte revient en ressort `retour` (380 ms) ; le reste du temps, le ressort `vif` (survol).
  const [retour, setRetour] = useState(false);
  const [apercu, setApercu] = useState(false);
  const [illisible, setIllisible] = useState(false);
  const intention = useRef<number | undefined>(undefined);
  const etaitSource = useRef(p.source);
  useEffect(() => {
    if (etaitSource.current && !p.source) {
      setRetour(true);
      const t = window.setTimeout(() => setRetour(false), 400);
      etaitSource.current = p.source;
      return () => window.clearTimeout(t);
    }
    etaitSource.current = p.source;
  }, [p.source]);

  useEffect(() => () => { if (image.current != null) cancelAnimationFrame(image.current); window.clearTimeout(intention.current); }, []);
  // L'aperçu s'arrête dès que la carte part en glisser, n'est plus disponible ou disparaît.
  useEffect(() => { if (p.source || !dispo) setApercu(false); }, [p.source, dispo]);
  useEffect(() => {
    if (!apercu) return;
    const arreter = () => setApercu(false);
    if (arreterApercu && arreterApercu !== arreter) arreterApercu();
    arreterApercu = arreter;
    return () => { if (arreterApercu === arreter) arreterApercu = null; };
  }, [apercu]);
  const lisible = p.vue === "grille" && m.type === "video" && dispo && !illisible && LISIBLES.test(m.ext);
  const finApercu = () => { window.clearTimeout(intention.current); setApercu(false); };

  const finAppui = (el: HTMLElement) => {
    depart.current = null;
    delete el.dataset.appui;
  };

  const evenements = {
    "data-media": m.id,
    role: "option",
    "aria-selected": p.choisi,
    "aria-setsize": p.aria?.setsize,
    "aria-posinset": p.aria?.posinset,
    tabIndex: p.focusable ? 0 : -1,
    title: dispo ? undefined : "Pas encore prêt",
    "data-dispo": dispo ? "" : undefined,
    "data-glisser": p.source ? "source" : undefined,
    "data-retour": retour ? "" : undefined,
    draggable: false,
    // Le clic qui suit un glisser (relâchement) n'ouvre rien, même sur un bouton d'action.
    onClickCapture: (e: MouseEvent) => {
      if (aGlisse.current) { aGlisse.current = false; e.stopPropagation(); e.preventDefault(); }
    },
    onClick: (e: MouseEvent) => p.onClick(e),
    onDoubleClick: () => dispo && p.onDoubleClick(),
    onKeyDown: p.onKeyDown,
    onContextMenu: p.onContextMenu,
    onFocus: () => { p.onFocus(); if (p.nouveau) p.onVu(); },
    onMouseEnter: () => { if (p.nouveau) p.onVu(); },
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      if (!lisible || e.pointerType !== "mouse" || mouvementReduit()) return;
      window.clearTimeout(intention.current);
      intention.current = window.setTimeout(() => setApercu(true), INTENTION_APERCU);
    },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      aGlisse.current = false;
      // Souris et stylet seulement : au doigt, un balayage fait défiler la grille (aucun touch-action imposé).
      finApercu();
      if (e.button !== 0 || e.pointerType === "touch" || !p.glissable || (e.target as Element).closest(".mcard-case")) return;
      depart.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.dataset.appui = "";
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const el = e.currentTarget;
      // Lumière de bord : une écriture par image, sur la couche de lumière seulement.
      if (lumiere.current && e.pointerType === "mouse" && image.current == null) {
        const r = el.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        image.current = requestAnimationFrame(() => {
          image.current = null;
          lumiere.current?.style.setProperty("--mx", `${x}px`);
          lumiere.current?.style.setProperty("--my", `${y}px`);
        });
      }
      const d = depart.current;
      if (!d || (e.buttons & 1) === 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < SEUIL_GLISSER) return;
      finAppui(el);
      aGlisse.current = true;
      p.onGlisser();
    },
    // Sous Windows, le glisser natif prend la souris : pointerup ne vient pas, l'état revient par le socle.
    onPointerUp: (e: PointerEvent<HTMLElement>) => finAppui(e.currentTarget),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => finAppui(e.currentTarget),
    onPointerLeave: (e: PointerEvent<HTMLElement>) => { finApercu(); if (!(e.buttons & 1)) finAppui(e.currentTarget); },
  };

  const caseSelection = (
    <span className="mcard-case" aria-hidden="true" data-coche={p.choisi ? "" : undefined}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); p.onBascule(); }}>
      <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.6 6.3l2.3 2.3 4.6-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );
  const nom = (
    <span className="mn ellipsis">{p.nouveau && <span className="point-nouveau" aria-label="Nouveau" role="img" />}{m.nom}<span className="mx">.{m.ext}</span></span>
  );

  if (p.vue === "liste") {
    return (
      <article className={`lrow${p.choisi ? " is-selected" : ""}${p.nouveau ? " is-nouveau" : ""}`} {...evenements}>
        <Miniature m={m} racine={p.racine} badges={false} className="thumb--liste" pct={p.pct} />
        <div className="lrow-nom">{nom}<span className="lrow-meta ellipsis">{p.meta}</span></div>
        <span className="lrow-col tab">{p.colonnes?.duree}</span>
        <span className="lrow-col lrow-fmt">{m.ext.toUpperCase()}</span>
        <span className="lrow-col lrow-taille tab">{p.colonnes?.taille}</span>
        <span className="lrow-col lrow-quand ellipsis">{p.quand}</span>
        <span className="lrow-etat">{p.pastille}</span>
        <BoutonIcone nom="more" libelle="Plus d'actions" taille="sm" tabIndex={-1} onClick={(e) => { e.stopPropagation(); p.onPlus(e.currentTarget); }} />
      </article>
    );
  }

  const survol = dispo ? (
    <>
      <div className="scrim" />
      <div className="hoverbar">
        <button type="button" className="playbig" aria-label={`Prévisualiser ${m.nom}`} tabIndex={-1} onClick={(e) => { e.stopPropagation(); p.onApercu(); }}><Icone nom="play" taille={16} /></button>
        <span style={{ flex: 1 }} />
        {/* Média scanné hors des dossiers surveillés : pas d'import direct par le panneau (contrat) → action masquée. */}
        {!(m.indexe && !m.indexe.sources.includes("bibliotheque")) && <BoutonIcone nom="import" libelle="Importer dans Premiere (Ctrl I)" taille="sm" surMedia tabIndex={-1} onClick={(e) => { e.stopPropagation(); p.onAction("importer"); }} />}
        <BoutonIcone nom="reveal" libelle="Afficher dans l'Explorateur" taille="sm" surMedia tabIndex={-1} onClick={(e) => { e.stopPropagation(); p.onAction("explorateur"); }} />
        <BoutonIcone nom="copy" libelle="Copier le chemin (Ctrl Maj C)" taille="sm" surMedia tabIndex={-1} onClick={(e) => { e.stopPropagation(); p.onAction("copier"); }} />
        <BoutonIcone nom="more" libelle="Plus d'actions" taille="sm" surMedia tabIndex={-1} onClick={(e) => { e.stopPropagation(); p.onPlus(e.currentTarget); }} />
      </div>
    </>
  ) : undefined;

  return (
    <article
      className={`mcard${p.choisi ? " is-selected" : ""}${p.animerEntree ? " entree-carte" : ""}${p.nouveau ? " is-nouveau" : ""}${m.etat === "en-cours" ? " is-arrivee" : ""}`}
      style={p.animerEntree ? { animationDelay: `${delaiCascade(p.index)}ms` } : undefined}
      data-erreur={m.etat === "erreur" ? "" : undefined}
      {...evenements}
    >
      <div className="mcard-media">
        <Miniature m={m} racine={p.racine} pct={p.pct} survol={survol} centre video={apercu && !illisible ? <VideoApercu m={m} onEchec={() => { setIllisible(true); setApercu(false); }} /> : undefined} />
        <span className="mcard-lumiere" ref={lumiere} aria-hidden="true" />
        {(p.selectionActive || dispo) && caseSelection}
        {p.pastille && <span className="mcard-pastille">{p.pastille}</span>}
      </div>
      <div className="mcard-texte">
        <div className="mt">{nom}</div>
        <div className="mm ellipsis">{[p.meta, p.quand].filter(Boolean).join(" · ")}</div>
      </div>
    </article>
  );
}

/** Emplacement réservé : fichier déposé en attente de copie (ou en échec), avant son entrée dans l'index. */
export function Emplacement({ nom, etat, pct, message, onFermer }: { nom: string; etat: "attente" | "copie" | "echec"; pct: number | null; message?: string | null; onFermer?: () => void }) {
  return (
    <article className="mcard emplacement" data-etat={etat} data-place={nom} aria-label={etat === "echec" ? `${nom} : ${message ?? "échec de la copie"}` : `${nom} : copie en cours`}>
      <div className="mcard-media">
        <div className="thumb is-running">
          <span className="emplacement-halo" />
          {etat === "echec" ? <div className="ph-ico emplacement-ko"><Icone nom="alert" taille={24} /></div> : <div className="center-chip"><span>{etat === "attente" ? "En attente" : pct != null ? `Copie… ${Math.round(pct * 100)} %` : "Copie…"}</span></div>}
          {etat === "copie" && <div className="runline"><i style={{ ["--p" as string]: pct ?? 0 }} className={pct == null ? "indet" : undefined} /></div>}
        </div>
      </div>
      <div>
        <div className="mt"><span className="mn ellipsis">{nom}</span></div>
        <div className="mm ellipsis">{etat === "echec" ? message ?? "Copie interrompue" : "Copie dans la bibliothèque"}</div>
        {etat === "echec" && onFermer && <div className="row2"><button type="button" className="link" onClick={onFermer}>Fermer</button></div>}
      </div>
    </article>
  );
}
