// Composants Égide pour React (site, espace, Control Center) : les MÊMES classes .eg-* que le socle (design/css,
// feuille egide.css), écrites en JSX pour le pré-rendu (aucun attribut style : la taille d'une médaille est une
// classe, jamais une variable en ligne). Icônes : le jeu maison du socle (design/src/icones.ts), aucune marque.
// La chouette : le fichier maître seul, dans un <img>, jamais redessiné ni recoloré (DESIGN_SYSTEM.md § 9).
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ICONES, type NomIcone } from "../../egide/src/icones.ts";
import { cn } from "../../lib/cn.ts";
import { CHOUETTE } from "../../lib/apparence.ts";

export type { NomIcone };

/** Icône maison (grille 24, trait 1,6). Décorative par défaut ; avec `titre`, une image nommée. */
export function Icone({ nom, taille, titre, className }: { nom: NomIcone; taille?: "s" | "l"; titre?: string; className?: string }) {
  return (
    <svg className={cn("eg-i", taille === "s" && "eg-i--s", taille === "l" && "eg-i--l", className)} viewBox="0 0 24 24"
      aria-hidden={titre ? undefined : true} role={titre ? "img" : undefined} aria-label={titre} focusable="false">
      {ICONES[nom].map(([Tag, a], i) => <Tag key={i} {...a} />)}
    </svg>
  );
}

/** La chouette seule (marque : barres, menus), 14 à 26 px, immobile. */
export function Chouette({ taille = 24, className }: { taille?: number; className?: string }) {
  return <img className={cn("eg-chouette", className)} src={CHOUETTE} alt="" width={taille} height={taille} draggable={false} decoding="async" />;
}

type TailleMedaille = 36 | 44 | 56 | 64 | 72;

/** Médaille : la chouette sur une face frappée. Au plus une par vue, hors marque. */
export function Medaille({ taille = 56, className, sceau = false, frappe = false }: { taille?: TailleMedaille; className?: string; sceau?: boolean; frappe?: boolean }) {
  return (
    <span aria-hidden="true" className={cn("eg-medaille", `egw-medaille-${taille}`, sceau && "eg-sceau", frappe && "eg-sceau--frappe", className)}>
      <Chouette taille={Math.round(taille * 0.58)} />
    </span>
  );
}

/** Veille (attente > 400 ms) : la médaille immobile, un fil tourne autour ; immobile en mouvement réduit. */
export function Veille({ libelle = "Chargement" }: { libelle?: string }) {
  return (
    <span className="eg-veille" role="img" aria-label={libelle}>
      <svg className="eg-veille-anneau" viewBox="0 0 56 56" aria-hidden="true" focusable="false"><circle cx="28" cy="28" r="26.5" /></svg>
      <Medaille taille={44} />
    </span>
  );
}

/** Nœud d'état : creux (attente), anneau + point (en cours), plein + coche (terminé), anneau rouge (erreur). */
export function Noeud({ etat = "attente" }: { etat?: "attente" | "cours" | "pause" | "ok" | "err" }) {
  return (
    <span className="eg-noeud" data-etat={etat} aria-hidden="true">
      <svg viewBox="0 0 10 10" focusable="false"><path d="M2 5.2 4.2 7.3 8 3" /></svg>
    </span>
  );
}

/** Le fil (progression), valeur 0 à 1 : ruban et tête déplacés par transform, écrit par CSSOM (jamais d'attribut style,
 *  rien au pré-rendu : le fil y est vide) ; entre deux mesures, 260 ms linéaires (jeton --eg-d-fil). */
export function Fil({ valeur, libelle, epais = false, className }: { valeur: number; libelle: string; epais?: boolean; className?: string }) {
  const run = useRef<HTMLDivElement>(null), tete = useRef<HTMLDivElement>(null);
  const v = Math.max(0, Math.min(1, valeur));
  const pas = Math.round(v * 100);
  useLayoutEffect(() => {
    const t = `translateX(${((v - 1) * 100).toFixed(2)}%)`;
    run.current?.style.setProperty("transform", t);
    tete.current?.style.setProperty("transform", t);
  }, [v]);
  return (
    <div className={cn("eg-fil", epais && "eg-fil--epais", className)} data-p={pas} role="progressbar" aria-label={libelle}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={pas}>
      <div className="eg-fil-piste"><div ref={run} className="eg-fil-run" /></div>
      <div ref={tete} className="eg-fil-tete" />
    </div>
  );
}

/** Pastille d'état : un ton (sens), un mot ; jamais un logo. */
export function Pastille({ ton = "neutre", icone, point = false, children, className }: { ton?: "ok" | "warn" | "err" | "neutre" | "accent"; icone?: NomIcone; point?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn("eg-pastille", className)} data-ton={ton === "neutre" ? undefined : ton}>
      {icone ? <Icone nom={icone} /> : point ? <span className="eg-pastille-point" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** Logotype : la chouette + AETHRYON en capitales espacées (Marcellus). */
export function Marque({ taille = 24, className }: { taille?: number; className?: string }) {
  return <span className={cn("eg-marque", className)}><Chouette taille={taille} />AETHRYON</span>;
}
