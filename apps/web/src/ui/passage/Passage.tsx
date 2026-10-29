// Briques des pages intérieures (« Le Passage », pages, 2026-10-28) : le fil d'or de l'accueil devient la colonne de
// chaque page. Frontispice : l'emblème (tuile, objet 3D, médaille), le titre, une seule ligne, et le fil qui se trace une
// fois sous l'en-tête. Seuil : l'arche fine des pages de compte (identité : « arche fine », jamais de temple), la
// chouette à la clé de voûte. Faits : ce qu'on lisait en paragraphe, en repères à icône. Portes : des liens en tuiles.
// Styles : passage.css (jetons Égide : suivent les six thèmes ; aucun attribut style, CSP du site).
import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn.ts";
import { Icone, type NomIcone } from "../egide/Egide.tsx";

export function Frontispice({ embleme, titre, ligne, aside, className, children }: {
  embleme?: ReactNode; titre: ReactNode; ligne?: ReactNode; aside?: ReactNode; className?: string; children?: ReactNode;
}) {
  return (
    <header className={cn("fx", !embleme && "fx--nu", className)}>
      {embleme && <div className="fx-embleme" aria-hidden="true">{embleme}</div>}
      <div className="fx-texte">
        <h1 className="page-title">{titre}</h1>
        {ligne && <p className="fx-ligne">{ligne}</p>}
        {children}
      </div>
      {aside && <div className="fx-aside">{aside}</div>}
      <span className="fx-fil" aria-hidden="true"><span /></span>
    </header>
  );
}

/** L'arche : le contenu (une carte de formulaire) passe sous la voûte ; `couronne` se pose à la clé (la chouette). */
export function Seuil({ children, couronne, className }: { children: ReactNode; couronne?: ReactNode; className?: string }) {
  return (
    <div className={cn("seuil", className)}>
      <span className="seuil-arche" aria-hidden="true" />
      {couronne && <div className="seuil-cle">{couronne}</div>}
      {children}
    </div>
  );
}

export interface Fait { icone: NomIcone; texte: ReactNode }

/** Repères à icône (Phosphor duotone) : un fait par ligne, court. */
export function Faits({ items, className, colonnes = 2 }: { items: readonly Fait[]; className?: string; colonnes?: 2 | 3 }) {
  return (
    <ul className={cn("faits", colonnes === 3 && "faits--3", className)}>
      {items.map((f, i) => (
        <li key={i}><span className="ico-tuile" aria-hidden="true"><Icone nom={f.icone} duo /></span><span>{f.texte}</span></li>
      ))}
    </ul>
  );
}

export interface Porte { to: string; titre: string; note?: ReactNode; tuile: ReactNode; actuelle?: boolean }

/** Liens en tuiles (pages légales, 404) : la tuile, le nom, une note d'état ; la page courante n'est pas un lien. */
export function Portes({ items, label, className }: { items: readonly Porte[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn("portes-pages", className)}>
      <ul>
        {items.map((p) => (
          <li key={p.to}>
            {p.actuelle ? (
              <span className="pp-porte" aria-current="page">{p.tuile}<span className="pp-texte"><b>{p.titre}</b>{p.note && <span>{p.note}</span>}</span></span>
            ) : (
              <Link to={p.to} className="pp-porte">{p.tuile}<span className="pp-texte"><b>{p.titre}</b>{p.note && <span>{p.note}</span>}</span><Icone nom="chevron" className="pp-fleche" /></Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
