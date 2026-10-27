// Héros Égide v2 (démonstration validée par le propriétaire, docs/design/demo-egide) : texte à gauche (5/12), LA SCÈNE à
// droite (7/12) : la démonstration interactive du vrai parcours. Un fil d'or, tracé une fois au chargement, relie le
// titre à la scène (seul moment non déclenché par l'utilisateur avec le récit ; déjà tracé en mouvement réduit).
// Plus de médaille 3D ni d'objet WebGL : la chouette n'apparaît que dans la scène (attente, sceau du fichier prêt).
import { Link } from "react-router";
import { useConfig } from "../lib/hooks.ts";
import { EN_LIGNE } from "../lib/catalogue.ts";
import { Icone } from "../ui/egide/Egide.tsx";
import { Scene } from "./egide/Scene.tsx";

const LIEUX = [["navigateur", "Navigateur"], ["fenetre", "Windows"], ["chutier", "Premiere Pro"], ["telephone", "iPhone"], ["bulle", "Discord"]] as const;

/** Plateformes en ligne aujourd'hui (catalogue) : X garde l'identifiant historique « x » du site. */
export function PlatformBand({ className }: { className?: string }) {
  const cfg = useConfig();
  return (
    <ul aria-label="Plateformes en ligne" className={className ?? "s-bande"} data-platform-band="">
      {EN_LIGNE.map((p) => {
        const coupee = (p.id === "youtube" || p.id === "tiktok" || p.id === "twitter") && cfg.data?.platforms?.[p.id] === false;
        return (
          <li key={p.id} data-platform={p.id === "twitter" ? "x" : p.id}>
            {p.nom}{coupee && <span className="s-bande-pause"> (en pause)</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="s-hero" data-hero="">
      <svg className="s-fil-hero" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path pathLength={1} vectorEffect="non-scaling-stroke" d="M4 97 H30 C 40 97, 40.5 22, 44.8 21" />
      </svg>
      <div className="s-texte">
        <h1 id="hero-title" className="s-titre eg-titre">Un lien entre.<br />Un fichier sort.</h1>
        <p className="s-sous">
          Vidéo, son ou GIF depuis YouTube, TikTok, X, Bluesky et Wikimedia Commons. Pour un extrait de YouTube, TikTok
          ou X, AETHRYON ne reçoit que le passage choisi, jamais la vidéo entière.
        </p>
        <PlatformBand />
        <ul className="s-lieux" aria-label="Disponible sur">
          {LIEUX.map(([i, l]) => <li key={l}><Icone nom={i} taille="s" />{l}</li>)}
        </ul>
        <p className="s-hero-liens">
          <a href="#film" className="s-lien-film"><Icone nom="lecture" taille="s" />Voir le film « Le Passage »</a>
          <Link to="/outils" className="s-lien-discret" data-hero-pill="">AETHRYON Tools, l'atelier en ligne (bêta)</Link>
        </p>
      </div>
      <Scene />
    </section>
  );
}
