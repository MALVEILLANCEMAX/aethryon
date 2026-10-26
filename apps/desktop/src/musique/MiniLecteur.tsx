// Mini-lecteur persistant (toute la fenêtre, après une première lecture) et « Scène » du lecteur (pochette, infos,
// visualisation, file d'attente réorganisable). Capsule de verre sombre posée en bas de la feuille : une petite
// surface flottante (Nocturne), pas une barre pleine largeur. La lune d'or autour de la pochette EST la progression.
// Clavier : Espace (hors champ et hors bouton) lecture/pause ; dans la file, Alt+↑/↓ déplace, Suppr retire.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as KE, type PointerEvent as PE } from "react";
import "../styles/musique-lecteur.css";
import { useMagasin } from "../lib/magasin";
import { useSignalMusique } from "../lib/musiqueSignal";
import { duree, typo } from "../lib/format";
import { animerMiseEnPage, mesurer } from "../lib/motion";
import { mouvementReduit } from "../lib/mouvement";
import * as L from "./lecteur";
import * as F from "./file";
import { infoCloud, infoLocale, registre, synchroniserMedias } from "./registre";
import { IconeM, Pochette } from "./ui";
import { Visualiseur } from "./Visualiseur";
import { BarreLecture } from "./BarreLecture";
import { Commandes, Volume } from "./Commandes";
import { Egaliseur } from "./Egaliseur";

function Lune({ fraction, taille, epaisseur = 2 }: { fraction: number | null; taille: number; epaisseur?: number }) {
  const r = taille / 2 - epaisseur;
  const c = 2 * Math.PI * r;
  return (
    <svg className="mu-lune" width={taille} height={taille} viewBox={`0 0 ${taille} ${taille}`} aria-hidden="true">
      <circle cx={taille / 2} cy={taille / 2} r={r} className="mu-lune-fond" strokeWidth={epaisseur} />
      {fraction != null && <circle cx={taille / 2} cy={taille / 2} r={r} className="mu-lune-arc" strokeWidth={epaisseur} strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, fraction)))} transform={`rotate(-90 ${taille / 2} ${taille / 2})`} />}
    </svg>
  );
}

/** File d'attente : glisser une ligne par sa poignée (souris ou doigt), ou Alt+↑/↓ au clavier ; Suppr retire. */
function FileAttente({ l }: { l: L.EtatLecteur }) {
  const venir = F.aVenir(l.file);
  const boite = useRef<HTMLOListElement>(null);
  const avant = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [glisse, setGlisse] = useState<{ de: number; vers: number; dy: number } | null>(null);
  const cle = (e: HTMLElement) => e.dataset.cle ?? null;
  useLayoutEffect(() => {
    const els = boite.current ? [...boite.current.querySelectorAll<HTMLElement>("[data-cle]")] : [];
    animerMiseEnPage(avant.current, els, cle);
    avant.current = new Map();
  });
  const noter = () => { if (boite.current) avant.current = mesurer(boite.current.querySelectorAll<HTMLElement>("[data-cle]"), cle); };
  const info = (ref: string) => {
    const p = ref.startsWith("loc:") ? registre.pistes.get(ref.slice(4)) : null;
    if (p) return infoLocale(p);
    const o = ref.startsWith("cloud:") ? registre.cloud.get(ref.slice(6)) : null;
    return o ? infoCloud(o) : { ref, titre: "Morceau indisponible", artistes: "", album: null, pochette: null, dureeS: null, qualite: null, source: "local" as const };
  };
  const hauteurLigne = 52;
  const debut = (i: number) => (e: PE<HTMLButtonElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    setGlisse({ de: i, vers: i, dy: 0 });
    const bouge = (ev: PointerEvent) => {
      const dy = ev.clientY - y0;
      const vers = Math.max(0, Math.min(venir.length - 1, i + Math.round(dy / hauteurLigne)));
      setGlisse({ de: i, vers, dy });
    };
    const fin = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", bouge);
      window.removeEventListener("pointerup", fin);
      const vers = Math.max(0, Math.min(venir.length - 1, i + Math.round((ev.clientY - y0) / hauteurLigne)));
      setGlisse(null);
      if (vers !== i) { noter(); L.deplacerAVenir(i, vers); }
    };
    window.addEventListener("pointermove", bouge);
    window.addEventListener("pointerup", fin);
  };
  const clavier = (i: number) => (e: KE<HTMLLIElement>) => {
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const vers = i + (e.key === "ArrowUp" ? -1 : 1);
      if (vers < 0 || vers >= venir.length) return;
      L.deplacerAVenir(i, vers);
      requestAnimationFrame(() => boite.current?.querySelector<HTMLElement>(`[data-index="${vers}"]`)?.focus());
    } else if (e.key === "Delete") {
      // Au clavier : aucune animation (réponse immédiate).
      e.preventDefault();
      L.retirerAVenir(i);
    } else if (e.key === "Enter") {
      L.allerA(i);
    }
  };
  if (!venir.length) return <p className="mu-file-vide">{typo(l.file.repetition === "tout" ? "La file recommencera au début." : "Rien à suivre : la lecture s'arrêtera à la fin de ce morceau.")}</p>;
  return (
    <ol className="mu-file" ref={boite} aria-label="À suivre (Alt + flèches pour déplacer, Suppr pour retirer)">
      {venir.map((ref, i) => {
        const x = info(ref);
        const deplace = glisse?.de === i;
        const decale = glisse && !deplace ? (glisse.de < glisse.vers && i > glisse.de && i <= glisse.vers ? -hauteurLigne : glisse.de > glisse.vers && i < glisse.de && i >= glisse.vers ? hauteurLigne : 0) : 0;
        return (
          <li key={`${ref}#${i}`} data-cle={`${ref}#${venir.slice(0, i).filter((r) => r === ref).length}`} data-index={i} tabIndex={0} className="mu-file-ligne" data-glisse={deplace ? "" : undefined}
            style={deplace ? { transform: `translateY(${glisse!.dy}px)` } : decale ? { transform: `translateY(${decale}px)` } : undefined}
            onKeyDown={clavier(i)} onDoubleClick={() => L.allerA(i)} aria-label={typo(`${x.titre}, ${x.artistes}`)}>
            <button type="button" className="mu-poignee" aria-label={typo(`Déplacer « ${x.titre} »`)} onPointerDown={debut(i)} tabIndex={-1}><IconeM nom="poignee" taille={16} /></button>
            <Pochette url={x.pochette} titre={x.titre} taille={36} />
            <div className="mu-file-texte"><div className="ellipsis">{x.titre}</div><div className="ellipsis c3">{x.artistes}</div></div>
            <span className="mu-chiffre c3">{duree(x.dureeS)}</span>
            <button type="button" className="mu-bt mu-bt--petit" aria-label={typo(`Retirer « ${x.titre} » de la file`)} onClick={() => { noter(); L.retirerAVenir(i); }}><IconeM nom="close" taille={14} /></button>
          </li>
        );
      })}
    </ol>
  );
}

function Scene({ onFermer }: { onFermer: () => void }) {
  const l = L.useLecteur();
  const i = l.info;
  const d = l.duree ?? i?.dureeS ?? null;
  const boite = useRef<HTMLDivElement>(null);
  const [sortie, setSortie] = useState(false);
  const fermer = () => { if (mouvementReduit()) onFermer(); else setSortie(true); };
  useEffect(() => {
    const prec = document.activeElement as HTMLElement | null;
    boite.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); fermer(); } };
    window.addEventListener("keydown", k, true);
    return () => { window.removeEventListener("keydown", k, true); prec?.focus?.(); };
  }, []);
  return (
    <div className="mu-scene-voile" onPointerDown={(e) => { if (e.target === e.currentTarget) fermer(); }}>
      <div className="mu-scene" ref={boite} role="dialog" aria-modal="true" aria-label="Lecteur" tabIndex={-1} data-sortie={sortie ? "" : undefined}
        onAnimationEnd={() => { if (sortie) onFermer(); }}>
        <button type="button" className="mu-bt mu-scene-fermer" aria-label="Fermer le lecteur" onClick={fermer}><IconeM nom="chevron-down" taille={18} /></button>
        <div className="mu-scene-gauche">
          <div className="mu-scene-poch">
            <Lune fraction={d ? l.position / d : null} taille={316} epaisseur={2.5} />
            <Pochette url={i?.pochette ?? null} titre={i?.titre ?? "AETHRYON"} taille={280} />
          </div>
          <div className="mu-scene-infos">
            <h2 className="mu-scene-titre">{i?.titre ?? "Rien en lecture"}</h2>
            <p className="mu-scene-artiste">{i?.artistes}</p>
            <p className="mu-scene-meta">{[i?.album, i?.qualite, i?.source === "cloud" ? "Écoute depuis le Cloud" : null].filter(Boolean).join(" · ")}</p>
          </div>
          <Visualiseur hauteur={56} barres={56} className="mu-scene-visu" />
          {!l.visualisable && i && <p className="mu-visu-note">{typo(i.source === "cloud" ? "Visualisation coupée pour l'écoute Cloud (lien signé du stockage)." : "Visualisation indisponible pour ce fichier.")}</p>}
          <BarreLecture l={l} />
          <Commandes l={l} grand />
          <div className="mu-scene-bas"><Volume l={l} /></div>
          {l.erreur && <p className="mu-erreur" role="alert">{typo(l.erreur)}</p>}
        </div>
        <section className="mu-scene-droite" aria-label="File d'attente">
          <div className="mu-scene-tete"><h3 className="sec-label">À suivre</h3><button type="button" className="btn btn--ghost btn--sm" onClick={L.vider}>Vider la file</button></div>
          <FileAttente l={l} />
        </section>
      </div>
    </div>
  );
}

export default function MiniLecteur() {
  const { inst, aller, section } = useMagasin();
  const l = L.useLecteur();
  const [scene, setScene] = useState(false);
  // La carte « En écoute » de Musique montre déjà le morceau et ses commandes : la capsule s'efface (inerte).
  const efface = useSignalMusique().ecoute && section === "musique";
  const capsule = useRef<HTMLDivElement>(null);
  // `inert` (absent des types de React 18) : ni focus ni lecteur d'écran sur la capsule effacée.
  useEffect(() => { capsule.current?.toggleAttribute("inert", efface); }, [efface, l.file.ordre.length]);
  useEffect(() => { if (inst) synchroniserMedias(inst.index.medias); }, [inst]);
  // Espace : lecture/pause partout, sauf dans un champ ou sur un bouton (où Espace garde son rôle).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== " " || e.ctrlKey || e.altKey || e.metaKey) return;
      if (t && (t.closest("input, textarea, select, button, [role=slider], [role=menuitem], [contenteditable]") || document.querySelector(".voile, .menu--flottant"))) return;
      e.preventDefault();
      L.basculer();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const i = l.info;
  if (!l.file.ordre.length) return null;
  const d = l.duree ?? i?.dureeS ?? null;
  return (
    <>
      <div className="mu-mini" role="region" aria-label="Lecteur" data-lecture={l.enLecture ? "" : undefined} data-efface={efface ? "" : undefined} ref={capsule}>
        <button type="button" className="mu-mini-poch" aria-label="Ouvrir le lecteur" onClick={() => setScene(true)}>
          <Lune fraction={d ? l.position / d : null} taille={52} />
          <Pochette url={i?.pochette ?? null} titre={i?.titre ?? "AETHRYON"} taille={40} rond />
        </button>
        <div className="mu-mini-texte">
          <button type="button" className="mu-mini-titre ellipsis" onClick={() => aller("musique")} title={i?.titre ?? ""}>{i?.titre ?? (l.erreur ? "Morceau indisponible" : "Chargement…")}</button>
          <div className="mu-mini-artiste ellipsis">{l.erreur ? <span className="mu-erreur-court">{typo(l.erreur)}</span> : <><Egaliseur actif={l.enLecture && !efface} className="mu-mini-eq" />{i?.artistes}</>}</div>
        </div>
        <Commandes l={l} />
        <BarreLecture l={l} compact />
        <Volume l={l} />
        <button type="button" className="mu-bt" aria-label="File d'attente et lecteur" data-bulle="File d'attente" onClick={() => setScene(true)}><IconeM nom="file" taille={18} /></button>
      </div>
      {scene && <Scene onFermer={() => setScene(false)} />}
    </>
  );
}
