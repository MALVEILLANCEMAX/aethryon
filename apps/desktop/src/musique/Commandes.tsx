// Commandes du lecteur (lecture/pause, précédent, suivant, aléatoire, répétition) et volume : partagées par le
// mini-lecteur, la scène et la carte « En écoute » de Musique (module à part : ouvrir Musique ne charge pas le
// mini-lecteur). Le bouton principal dit l'état par sa forme ET son nom (« Lecture » / « Pause »).
import type { CSSProperties } from "react";
import "../styles/musique-lecteur.css";
import * as L from "./lecteur";
import * as F from "./file";
import { IconeM } from "./ui";

export function Commandes({ l, grand }: { l: L.EtatLecteur; grand?: boolean }) {
  const t = grand ? 22 : 18;
  const rep = l.file.repetition;
  return (
    <div className={`mu-cmd${grand ? " mu-cmd--grand" : ""}`}>
      <button type="button" className="mu-bt" aria-pressed={l.file.aleatoire} aria-label={l.file.aleatoire ? "Lecture aléatoire activée" : "Lecture aléatoire"} data-bulle="Aléatoire" onClick={L.aleatoire}><IconeM nom="aleatoire" taille={t - 2} /></button>
      <button type="button" className="mu-bt" aria-label="Morceau précédent" data-bulle="Précédent" onClick={L.precedentManuel}><IconeM nom="precedent" taille={t} /></button>
      <button type="button" className="mu-bt mu-bt--lecture" aria-label={l.enLecture ? "Pause" : "Lecture"} data-chargement={l.chargement ? "" : undefined} onClick={L.basculer}>
        <IconeM nom={l.enLecture ? "pause" : "play"} taille={grand ? 26 : 20} />
      </button>
      <button type="button" className="mu-bt" aria-label="Morceau suivant" data-bulle="Suivant" onClick={L.suivantManuel} disabled={!F.aVenir(l.file).length && rep === "non"}><IconeM nom="suivant" taille={t} /></button>
      <button type="button" className="mu-bt mu-bt--rep" aria-pressed={rep !== "non"} data-un={rep === "un" ? "" : undefined}
        aria-label={rep === "non" ? "Répétition désactivée" : rep === "tout" ? "Répéter toute la file" : "Répéter ce morceau"} data-bulle={rep === "un" ? "Répéter ce morceau" : "Répéter"} onClick={() => L.repetition()}>
        <IconeM nom="repeter" taille={t - 2} />{rep === "un" && <span className="mu-un" aria-hidden="true">1</span>}
      </button>
    </div>
  );
}

export function Volume({ l }: { l: L.EtatLecteur }) {
  const v = l.muet ? 0 : l.volume;
  return (
    <div className="mu-vol">
      <button type="button" className="mu-bt" aria-label={l.muet ? "Rétablir le son" : "Couper le son"} data-bulle={l.muet ? "Son coupé" : "Couper le son"} onClick={L.muet}><IconeM nom={v === 0 ? "muet" : "volume"} taille={16} /></button>
      <input type="range" className="mu-curseur mu-curseur--vol" min={0} max={1} step={0.02} value={v} aria-label="Volume" aria-valuetext={`${Math.round(v * 100)} %`}
        style={{ ["--p" as string]: v } as CSSProperties} onChange={(e) => L.volume(Number(e.target.value))} />
    </div>
  );
}

