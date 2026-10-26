// Miniature 16:9 d'un média : la miniature EST la carte (DESIGN-SYSTEM.md §6). Badge de format, durée, états
// (en cours : image à 55 % et fil de progression ; introuvable : 22 % et pointillé ; erreur : pictogramme terre cuite).
import { useState, type ReactNode } from "react";
import type { Media } from "../lib/types";
import { urlMiniature } from "../lib/api";
import { duree } from "../lib/format";
import { Icone, IconeEtat } from "./base";
import { Couverture } from "./Couverture";

export function Miniature({ m, racine, pct, badges = true, survol, centre, className, video }: {
  m: Media;
  racine: string;
  pct?: number | null;
  badges?: boolean;
  survol?: ReactNode;
  centre?: boolean;
  className?: string;
  /** Aperçu au survol (vidéo muette, posée sur la miniature). */
  video?: ReactNode;
}) {
  const [rate, setRate] = useState(false);
  const url = rate ? null : urlMiniature(racine, m);
  const portrait = (m.hauteur ?? 0) > (m.largeur ?? 0);
  const cls = ["thumb", portrait ? "portrait" : "", m.etat === "en-cours" ? "is-running" : "", m.etat === "introuvable" ? "is-missing" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      {url ? (
        <img className="pic" src={url} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setRate(true)} />
      ) : m.etat !== "erreur" && m.etat !== "introuvable" ? (
        <Couverture m={m} taille={className === "thumb--liste" ? 16 : 28} />
      ) : (
        <div className="ph-ico" style={m.etat === "erreur" ? { color: "var(--state-bad)", opacity: 0.8 } : undefined}>
          <Icone nom={m.type === "audio" ? "audio" : m.type === "image" ? "image" : "film"} taille={28} />
        </div>
      )}
      {/* Aperçu vidéo au survol : juste au-dessus de l'image, sous les badges et les actions (ordre du DOM). */}
      {video}
      {badges && <span className="badge badge--fmt">{m.ext.toUpperCase()}</span>}
      {badges && m.duree != null && m.type !== "image" && <span className="badge badge--dur">{duree(m.duree)}</span>}
      {m.etat === "en-cours" && (
        <div className="runline"><i style={{ ["--p" as string]: pct ?? 0 }} className={pct == null ? "indet" : undefined} /></div>
      )}
      {m.etat === "en-cours" && centre && (
        <div className="center-chip">
          <span><IconeEtat etat="running" pct={pct != null ? pct * 100 : 0} />{pct != null ? `Téléchargement · ${Math.round(pct * 100)} %` : "Réception en cours"}</span>
        </div>
      )}
      {m.etat === "introuvable" && <div className="ph-ico" style={{ color: "var(--ae-mist)" }}><Icone nom="missing" taille={26} /></div>}
      {survol}
    </div>
  );
}
