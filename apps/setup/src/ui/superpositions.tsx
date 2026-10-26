// Surfaces flottantes : menu (e-3), dialogue (voile sans flou, focus piégé puis rendu, Échap ferme), toasts
// (5 s, arrêt au survol et au focus, 3 au plus, aria-live poli ; erreur : assertif).
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BoutonIcone, Icone, IconeEtat } from "./base";
import type { NomIcone } from "./traces";
import { typo } from "../lib/format";

// ---- Menu ------------------------------------------------------------------------------------------------------------

export interface ElementMenu {
  id: string;
  libelle: string;
  icone?: NomIcone;
  kbd?: string;
  danger?: boolean;
  desactive?: boolean;
  separateurAvant?: boolean;
}

export function Menu({ ancre, elements, onChoisir, onFermer, aligne = "droite" }: {
  ancre: HTMLElement;
  elements: ElementMenu[];
  onChoisir: (id: string) => void;
  onFermer: () => void;
  aligne?: "droite" | "gauche";
}) {
  const boite = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [hl, setHl] = useState(0);
  useLayoutEffect(() => {
    const r = ancre.getBoundingClientRect();
    const m = boite.current?.getBoundingClientRect();
    const l = m?.width ?? 220;
    const h = m?.height ?? 200;
    let x = aligne === "droite" ? r.right - l : r.left;
    let y = r.bottom + 6;
    if (y + h > window.innerHeight - 8) y = r.top - h - 6;
    x = Math.max(8, Math.min(x, window.innerWidth - l - 8));
    setPos({ x, y: Math.max(8, y) });
  }, [ancre, aligne]);
  useEffect(() => {
    boite.current?.focus();
    const dehors = (e: MouseEvent) => {
      if (!boite.current?.contains(e.target as Node) && !ancre.contains(e.target as Node)) onFermer();
    };
    window.addEventListener("mousedown", dehors);
    return () => window.removeEventListener("mousedown", dehors);
  }, [ancre, onFermer]);
  const actifs = elements.map((e, i) => (e.desactive ? -1 : i)).filter((i) => i >= 0);
  return createPortal(
    <div
      ref={boite}
      className="menu menu--flottant"
      role="menu"
      tabIndex={-1}
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999 }}
      onKeyDown={(e) => {
        const k = actifs.indexOf(hl);
        if (e.key === "ArrowDown") { e.preventDefault(); setHl(actifs[(k + 1) % actifs.length]); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setHl(actifs[(k - 1 + actifs.length) % actifs.length]); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const el = elements[hl]; if (el && !el.desactive) { onChoisir(el.id); onFermer(); } }
        else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); onFermer(); ancre.focus(); }
      }}
    >
      {elements.map((el, i) => (
        <div key={el.id}>
          {el.separateurAvant && <div className="sep" />}
          <div
            role="menuitem"
            aria-disabled={el.desactive}
            className={`mi${i === hl ? " is-hl" : ""}${el.danger ? " mi--danger" : ""}${el.desactive ? " mi--off" : ""}`}
            onMouseEnter={() => !el.desactive && setHl(i)}
            onClick={() => { if (!el.desactive) { onChoisir(el.id); onFermer(); } }}
          >
            {el.icone && <Icone nom={el.icone} taille={16} />}
            {el.libelle}
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
