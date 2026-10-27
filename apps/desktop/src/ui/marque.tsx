// Marque Égide (DESIGN_SYSTEM.md § 9) : la chouette MAÎTRE uniquement — design/assets/aethryon-master.svg, octet pour
// octet celle de brand/master — affichée telle quelle dans un <img> : jamais redessinée, recolorée, déformée ni
// animée. Ses états sont des formes AUTOUR d'elle (CSS d'Égide) : médaille (repos, état vide), veille (chargement :
// un fil tourne autour, la chouette ne bouge pas ; arrêté en mouvement réduit), sceau (succès : frappé une fois).
// Logotype : contours vectoriels Marcellus (couleur du texte du thème).
import type { CSSProperties } from "react";
import { adresseChouette } from "../lib/egide";
import { MARQUE } from "./marque-donnees";

/** La chouette seule (marque : barres, menus, petites tuiles), sans mouvement. */
export function Chouette({ taille, className }: { taille: number; className?: string }) {
  const t = Math.round(taille);
  return <img className={`eg-chouette${className ? " " + className : ""}`} src={adresseChouette()} width={t} height={t} alt="" draggable={false} decoding="async" />;
}

/** Médaille : la chouette sur une face frappée (état vide, repos du Companion). */
export function MedailleChouette({ taille = 56, className, style }: { taille?: number; className?: string; style?: CSSProperties }) {
  const t = Math.max(14, Math.round(taille));
  return (
    <span className={`eg-medaille${className ? " " + className : ""}`} style={{ ["--eg-taille" as string]: `${t}px`, ...style }} aria-hidden="true">
      <Chouette taille={t * 0.58} />
    </span>
  );
}

/** Veille (attente réelle > 400 ms) : la médaille immobile, un fil tourne autour. */
export function VeilleChouette({ taille = 56, libelle }: { taille?: number; libelle?: string }) {
  const t = Math.max(28, Math.round(taille));
  return (
    <span className="eg-veille" style={{ width: t, height: t }} role={libelle ? "img" : undefined} aria-label={libelle} aria-hidden={libelle ? undefined : true}>
      <svg className="eg-veille-anneau" viewBox="0 0 56 56" aria-hidden="true" focusable="false"><circle cx="28" cy="28" r="26.5" /></svg>
      <MedailleChouette taille={t * 0.79} />
    </span>
  );
}

/** Sceau de succès : la médaille frappée une fois (420 ms + un reflet) ; posé sans mouvement si réduit. */
export function SceauChouette({ taille = 44, frappe = true }: { taille?: number; frappe?: boolean }) {
  return <MedailleChouette taille={taille} className={`eg-sceau${frappe ? " eg-sceau--frappe" : ""}`} />;
}

/** Logotype « AETHRYON » (Marcellus en contours) : hauteur de boîte = 1,0425 × capitales, largeur = 8,5528 × hauteur. */
export function Logotype({ capitales, couleur = "currentColor" }: { capitales: number; couleur?: string }) {
  const h = +(capitales * 1.0425).toFixed(2);
  const l = +(h * 8.5528).toFixed(2);
  return (
    <svg className="wordmark" width={l} height={h} viewBox={MARQUE.wordmark.viewBox} role="img" aria-label="AETHRYON">
      <path fill={couleur} d={MARQUE.wordmark.d} />
    </svg>
  );
}
