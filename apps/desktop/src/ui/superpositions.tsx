// Surfaces flottantes : menu (e-3), dialogue (voile sans flou, focus piégé puis rendu, Échap ferme), toasts
// (5 s, arrêt au survol et au focus, 3 au plus, aria-live poli ; erreur : assertif).
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BoutonIcone, Icone, IconeEtat } from "./base";
import type { NomIcone } from "./traces";
import { typo } from "../lib/format";
import { naviguer, positionAuPoint, premierActif } from "../lib/menu";

// ---- Menu ------------------------------------------------------------------------------------------------------------
// D-SPEC §B.5.4 : sous le pointeur (clic droit), à l'angle de la carte (Maj F10, touche Menu) ou sous un bouton.
// Le focus reste sur le conteneur `role="menu"` ; `aria-activedescendant` désigne l'élément en surbrillance (annoncé
// par les lecteurs d'écran). Flèches en boucle sans les désactivés, Début/Fin, première lettre, Entrée/Espace,
// Échap/Tab rendent le focus. Entrée en 120 ms depuis le coin du pointeur ; AUCUNE animation s'il est ouvert au clavier.

export interface ElementMenu {
  id: string;
  libelle: string;
  icone?: NomIcone;
  kbd?: string;
  /** Pour aria-keyshortcuts (« Control+I »). */
  raccourci?: string;
  danger?: boolean;
  desactive?: boolean;
  /** Raison affichée en infobulle quand l'élément est désactivé. */
  raison?: string;
  separateurAvant?: boolean;
}

export interface EnteteMenu { miniature: string | null; nom: string; meta: string }

let compteurMenus = 0;

export function Menu({ ancre, point, elements, onChoisir, onFermer, aligne = "droite", libelle, entete, parClavier }: {
  /** Élément d'origine : il reprend le focus à la fermeture ; sans `point`, le menu s'ouvre sous lui. */
  ancre: HTMLElement;
  /** Coordonnées du viewport (clic droit, ou angle de la carte + 12 px au clavier). */
  point?: { x: number; y: number };
  elements: ElementMenu[];
  onChoisir: (id: string) => void;
  onFermer: () => void;
  aligne?: "droite" | "gauche";
  libelle?: string;
  entete?: EnteteMenu;
  /** Ouvert au clavier : apparition instantanée. */
  parClavier?: boolean;
}) {
  const boite = useRef<HTMLDivElement>(null);
  const [ident] = useState(() => `menu-${++compteurMenus}`);
  const [pos, setPos] = useState<{ x: number; y: number; origine: string } | null>(null);
  const [hl, setHl] = useState(() => premierActif(elements));
  const fermer = useRef(onFermer);
  fermer.current = onFermer;
  useLayoutEffect(() => {
    // Taille SANS transformation (l'entrée part de scale(.96)) : offsetWidth et offsetHeight.
    const l = boite.current?.offsetWidth || 220;
    const h = boite.current?.offsetHeight || 200;
    const vue = { largeur: window.innerWidth, hauteur: window.innerHeight };
    if (point) {
      setPos(positionAuPoint(point.x, point.y, l, h, vue));
      return;
    }
    const r = ancre.getBoundingClientRect();
    let x = aligne === "droite" ? r.right - l : r.left;
    let y = r.bottom + 6;
    let oy = "top";
    if (y + h > vue.hauteur - 8) { y = r.top - h - 6; oy = "bottom"; }
    x = Math.max(8, Math.min(x, vue.largeur - l - 8));
    setPos({ x, y: Math.max(8, y), origine: `${oy} ${aligne === "droite" ? "right" : "left"}` });
  }, [ancre, aligne, point?.x, point?.y]);
  useLayoutEffect(() => {
    boite.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const dehors = (e: MouseEvent) => {
      if (!boite.current?.contains(e.target as Node) && !(point ? false : ancre.contains(e.target as Node))) fermer.current();
    };
    const defile = (e: Event) => { if (!boite.current?.contains(e.target as Node)) fermer.current(); };
    const flou = () => fermer.current();
    window.addEventListener("mousedown", dehors);
    window.addEventListener("scroll", defile, true);
    window.addEventListener("blur", flou);
    return () => {
      window.removeEventListener("mousedown", dehors);
      window.removeEventListener("scroll", defile, true);
      window.removeEventListener("blur", flou);
    };
  }, [ancre, point]);
  const executer = (i: number) => {
    const el = elements[i];
    if (!el || el.desactive) return;
    onChoisir(el.id);
    onFermer();
  };
  const idElement = (el: ElementMenu) => `${ident}-${el.id}`;
  const actif = hl >= 0 ? elements[hl] : undefined;
  return createPortal(
    <div
      ref={boite}
      className={`menu menu--flottant${parClavier ? " menu--instantane" : ""}`}
      role="menu"
      tabIndex={-1}
      aria-label={libelle}
      aria-activedescendant={actif ? idElement(actif) : undefined}
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, transformOrigin: pos?.origine ?? "top left" }}
      onKeyDown={(e) => {
        const n = naviguer(elements, hl, e.key);
        if (n !== null && !e.ctrlKey && !e.altKey) { e.preventDefault(); setHl(n); return; }
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); executer(hl); }
        else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); onFermer(); ancre.focus({ preventScroll: true }); }
      }}
    >
      {entete && (
        <div className="menu-entete" role="presentation">
          {entete.miniature ? <img src={entete.miniature} alt="" draggable={false} /> : <span className="menu-entete-vide" />}
          <span className="menu-entete-texte"><span className="ellipsis">{entete.nom}</span><span className="menu-entete-meta">{typo(entete.meta)}</span></span>
        </div>
      )}
      {elements.map((el, i) => (
        <div key={el.id} role="none">
          {el.separateurAvant && <div className="sep" role="separator" />}
          <div
            id={idElement(el)}
            role="menuitem"
            aria-disabled={el.desactive || undefined}
            aria-keyshortcuts={el.raccourci}
            title={el.desactive ? el.raison : undefined}
            className={`mi${i === hl ? " is-hl" : ""}${el.danger ? " mi--danger" : ""}${el.desactive ? " mi--off" : ""}`}
            onMouseEnter={() => !el.desactive && setHl(i)}
            onClick={() => executer(i)}
          >
            {el.icone && <Icone nom={el.icone} taille={16} />}
            <span className="mi-lbl">{el.libelle}</span>
            {el.kbd && <span className="kbd">{el.kbd}</span>}
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}

// ---- Dialogue --------------------------------------------------------------------------------------------------------

export function Dialogue({ titre, children, actions, onFermer, large }: { titre: string; children: ReactNode; actions: ReactNode; onFermer: () => void; large?: boolean }) {
  const boite = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const avant = document.activeElement as HTMLElement | null;
    const premier = boite.current?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    (premier ?? boite.current)?.focus();
    return () => avant?.focus?.();
  }, []);
  return createPortal(
    <div className="voile" onMouseDown={(e) => e.target === e.currentTarget && onFermer()}>
      <div
        ref={boite}
        className={`dialog entree-dialogue${large ? " dialog--large" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titre-dialogue"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); onFermer(); }
          if (e.key === "Tab") {
            const f = Array.from(boite.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") ?? []);
            if (f.length === 0) return;
            const i = f.indexOf(document.activeElement as HTMLElement);
            if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
            else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
          }
        }}
      >
        <h2 id="titre-dialogue" className="t-display-m">{titre}</h2>
        <div className="dialog-corps">{children}</div>
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>,
    document.body,
  );
}

// ---- Toasts ----------------------------------------------------------------------------------------------------------

export interface Toast {
  id: number;
  etat: "ok" | "erreur" | "info" | "attente";
  titre: string;
  texte?: string;
  action?: { libelle: string; faire: () => void };
}

const ContexteToasts = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(ContexteToasts);

function ElementToast({ t, onFermer }: { t: Toast; onFermer: () => void }) {
  const [pause, setPause] = useState(false);
  const fermer = useRef(onFermer);
  fermer.current = onFermer;
  useEffect(() => {
    if (pause) return;
    const m = window.setTimeout(() => fermer.current(), t.etat === "erreur" ? 8000 : 5000);
    return () => window.clearTimeout(m);
  }, [pause, t.etat]);
  const icone = t.etat === "ok" ? <span className="toast-ico ok"><IconeEtat etat="ok" taille={14} /></span>
    : t.etat === "erreur" ? <span className="toast-ico bad"><IconeEtat etat="error" taille={14} /></span>
    : t.etat === "attente" ? <span className="toast-ico run"><IconeEtat etat="running" taille={14} /></span>
    : <span className="toast-ico"><Icone nom="info" taille={16} /></span>;
  return (
    <div className="toast entree-toast" role={t.etat === "erreur" ? "alert" : "status"} onMouseEnter={() => setPause(true)} onMouseLeave={() => setPause(false)} onFocus={() => setPause(true)} onBlur={() => setPause(false)}>
      {icone}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="tt">{typo(t.titre)}</div>
        {t.texte && <div className="tb">{typo(t.texte)}</div>}
        {t.action && <button type="button" className="link toast-action" onClick={() => { t.action!.faire(); onFermer(); }}>{t.action.libelle}</button>}
      </div>
      <BoutonIcone nom="close" libelle="Fermer" taille="xs" onClick={onFermer} />
    </div>
  );
}

export function FournisseurToasts({ children }: { children: ReactNode }) {
  const [liste, setListe] = useState<Toast[]>([]);
  const n = useRef(0);
  const ajouter = useCallback((t: Omit<Toast, "id">) => {
    n.current += 1;
    const id = n.current;
    // Une confirmation (réussite ou erreur) remplace le toast « en attente » qu'elle conclut.
    setListe((l) => [...(t.etat === "ok" || t.etat === "erreur" ? l.filter((x) => x.etat !== "attente") : l), { ...t, id }].slice(-3));
  }, []);
  const retirer = useCallback((id: number) => setListe((l) => l.filter((x) => x.id !== id)), []);
  return (
    <ContexteToasts.Provider value={ajouter}>
      {children}
      <div className="toasts" aria-live="polite">
        {liste.map((t) => <ElementToast key={t.id} t={t} onFermer={() => retirer(t.id)} />)}
      </div>
    </ContexteToasts.Provider>
  );
}
