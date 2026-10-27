// Sélecteur rapide de thème (site public et espace) : un bouton icône (nom accessible = thème actuel), un menu ancré qui
// s'ouvre DEPUIS lui (scale .97 → 1 + fondu, @starting-style ; rien en mouvement réduit), six choix radio, puis
// « Personnaliser » (Réglages › Apparence). Clavier : flèches, Début / Fin, Échap rend le focus au bouton ; le choix est
// appliqué tout de suite et gardé (aethryon.apparence.v1) ; aucun flash au chargement (theme-boot.js).
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn.ts";
import { choisirThemeSite, THEMES, useThemeActif } from "../../lib/apparence.ts";
import { Icone } from "./Egide.tsx";

export function ThemeMenu({ className, personnaliser = "/dashboard/apparence" }: { className?: string; personnaliser?: string }) {
  const actif = useThemeActif();
  const [ouvert, setOuvert] = useState(false);
  const bouton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const nom = THEMES.find((t) => t.id === actif)?.nom ?? "Obsidian";

  // Position : sous le bouton, aligné à droite (CSSOM, jamais d'attribut style).
  useLayoutEffect(() => {
    if (!ouvert || !bouton.current || !menu.current) return;
    const r = bouton.current.getBoundingClientRect();
    menu.current.style.setProperty("--eg-menu-haut", `${Math.round(r.bottom + 8)}px`);
    menu.current.style.setProperty("--eg-menu-droite", `${Math.max(16, Math.round(window.innerWidth - r.right))}px`);
    const choisi = menu.current.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.current.querySelector<HTMLElement>("[role^=menuitem]");
    choisi?.focus();
  }, [ouvert]);

  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !bouton.current?.contains(t)) setOuvert(false);
    };
    const fermer = () => setOuvert(false);
    document.addEventListener("pointerdown", dehors, true);
    window.addEventListener("resize", fermer);
    window.addEventListener("scroll", fermer, { passive: true });
    return () => { document.removeEventListener("pointerdown", dehors, true); window.removeEventListener("resize", fermer); window.removeEventListener("scroll", fermer); };
  }, [ouvert]);

  const fermerVersBouton = () => { setOuvert(false); bouton.current?.focus(); };
  const clavier = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const aller = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
    if (e.key === "ArrowDown") aller(i + 1);
    else if (e.key === "ArrowUp") aller(i - 1);
    else if (e.key === "Home") aller(0);
    else if (e.key === "End") aller(items.length - 1);
    else if (e.key === "Escape") { e.preventDefault(); fermerVersBouton(); }
    else if (e.key === "Tab") setOuvert(false);
  };

  return (
    <>
      <button ref={bouton} type="button" className={cn("eg-btn eg-btn--icone", className)} aria-haspopup="menu" aria-expanded={ouvert}
        aria-controls={ouvert ? `${id}-menu` : undefined} aria-label={`Thème : ${nom}`} title={`Thème : ${nom}`} onClick={() => setOuvert((o) => !o)} data-theme-menu="">
        <Icone nom="theme" />
      </button>
      {ouvert && (
        <div ref={menu} id={`${id}-menu`} className="eg-menu egw-menu-theme" data-ancre="droite" role="menu" aria-label="Thème" onKeyDown={clavier}>
          {THEMES.map((t) => (
            <button key={t.id} type="button" role="menuitemradio" aria-checked={actif === t.id} tabIndex={-1} className="eg-menu-item egw-menu-theme-item"
              onClick={() => { void choisirThemeSite(t.id); fermerVersBouton(); }}>
              <span className="egw-pastille-theme eg-scope" data-eg-theme={t.id === "custom" ? undefined : t.id} data-custom={t.id === "custom" ? "" : undefined} aria-hidden="true" />
              <span className="egw-menu-theme-nom">{t.nom}</span>
              {actif === t.id && <Icone nom="ok" taille="s" className="egw-menu-coche" />}
            </button>
          ))}
          <Link to={personnaliser} role="menuitem" tabIndex={-1} className="eg-menu-item egw-menu-sep" onClick={() => setOuvert(false)}>
            <Icone nom="reglages" taille="s" />Personnaliser
          </Link>
        </div>
      )}
    </>
  );
}
