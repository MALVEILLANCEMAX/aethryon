// Navigation AETHRYON, Égide v2 : une barre posée sur le fond du thème (64 px, filet fin dès qu'on a défilé), la marque
// (chouette maître + logotype), cinq liens, le sélecteur de thème, « Se connecter » (compte existant, /connexion) et
// « Commencer » (création, /commencer) en secondaire : l'or est réservé à l'action principale de la page. Sous 760 px :
// marque, thème et menu (liste ancrée qui s'ouvre depuis son bouton ; Échap ou un toucher dehors la ferme).
// Aucune animation au défilement ni au survol hors couleur (MOTION_GUIDELINES.md § 3).
import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { cn } from "../lib/cn.ts";
import { useMe } from "../lib/hooks.ts";
import { choisirThemeSite, THEMES, useThemeActif } from "../lib/apparence.ts";
import { TARIFS_LABEL } from "../lib/offres.ts";
import { Chouette, Icone } from "./egide/Egide.tsx";
import { ThemeMenu } from "./egide/ThemeMenu.tsx";

const LIENS = [
  { to: "/#surfaces", label: "Produit", section: "surfaces" },
  { to: "/#plateformes", label: "Plateformes", section: "plateformes" },
  { to: "/outils", label: "Tools", section: null },
  { to: "/#tarifs", label: TARIFS_LABEL, section: "tarifs" },
  { to: "/aide", label: "Aide", section: null },
] as const;

export function Nav() {
  const me = useMe();
  const connecte = !!me.data && !me.error;
  const { pathname, hash } = useLocation();
  const [ouvert, setOuvert] = useState(false);
  const [defile, setDefile] = useState(false);
  const menuId = useId();
  const bouton = useRef<HTMLButtonElement>(null);
  const liste = useRef<HTMLDivElement>(null);

  useEffect(() => { setOuvert(false); }, [pathname, hash]);
  useEffect(() => {
    const lire = () => setDefile(window.scrollY > 8);
    lire();
    window.addEventListener("scroll", lire, { passive: true });
    return () => window.removeEventListener("scroll", lire);
  }, []);
  useEffect(() => {
    if (!ouvert) return;
    liste.current?.querySelector<HTMLElement>("a")?.focus();
    const touche = (e: KeyboardEvent) => { if (e.key === "Escape") { setOuvert(false); bouton.current?.focus(); } };
    const dehors = (e: PointerEvent) => { const t = e.target as Node; if (!liste.current?.contains(t) && !bouton.current?.contains(t)) setOuvert(false); };
    window.addEventListener("keydown", touche);
    document.addEventListener("pointerdown", dehors, true);
    return () => { window.removeEventListener("keydown", touche); document.removeEventListener("pointerdown", dehors, true); };
  }, [ouvert]);

  const themeActif = useThemeActif();
  const actif = (l: (typeof LIENS)[number]) => (l.section ? pathname === "/" && hash === `#${l.section}` : pathname.startsWith(l.to));

  return (
    <header className={cn("s-tete", defile && "is-defile")}>
      <nav aria-label="Navigation principale" className="s-tete-barre">
        <Link to="/" className="s-tete-marque eg-marque" aria-label="AETHRYON, accueil"><Chouette taille={26} /><span aria-hidden="true">AETHRYON</span></Link>
        <div className="s-tete-liens">
          {LIENS.map((l) => (
            <Link key={l.to} to={l.to} className="s-tete-lien" aria-current={actif(l) ? "page" : undefined}>{l.label}</Link>
          ))}
        </div>
        <div className="s-tete-d">
          <ThemeMenu />
          {connecte ? (
            <Link to="/dashboard" className="eg-btn eg-btn--secondaire s-tete-cta">Mon espace</Link>
          ) : (
            <>
              <Link to="/connexion" className="eg-btn eg-btn--discret s-tete-cnx" data-nav-connexion="">Se connecter</Link>
              <Link to="/commencer" className="eg-btn eg-btn--secondaire s-tete-cta" data-nav-commencer="">Commencer</Link>
            </>
          )}
          <button ref={bouton} type="button" className="eg-btn eg-btn--icone s-tete-menu" aria-label={ouvert ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={ouvert} aria-controls={menuId} onClick={() => setOuvert((v) => !v)}>
            <Icone nom={ouvert ? "croix" : "menu"} />
          </button>
        </div>
      </nav>
      {ouvert && (
        <div ref={liste} id={menuId} className="s-tete-liste">
          <ul>
            {LIENS.map((l) => (
              <li key={l.to}><Link to={l.to} onClick={() => setOuvert(false)} aria-current={actif(l) ? "page" : undefined}>{l.label}<Icone nom="chevron" taille="s" /></Link></li>
            ))}
            {connecte
              ? <li><Link to="/dashboard" onClick={() => setOuvert(false)}>Mon espace<Icone nom="chevron" taille="s" /></Link></li>
              : <>
                  <li><Link to="/connexion" onClick={() => setOuvert(false)}>Se connecter<Icone nom="chevron" taille="s" /></Link></li>
                  <li><Link to="/commencer" onClick={() => setOuvert(false)}>Commencer<Icone nom="chevron" taille="s" /></Link></li>
                </>}
          </ul>
          {/* Téléphone étroit : le choix du thème est ici (le bouton de la barre laisse la place à l'action). */}
          <div className="s-tete-themes" role="group" aria-label="Thème">
            {THEMES.map((t) => (
              <button key={t.id} type="button" aria-pressed={themeActif === t.id} onClick={() => void choisirThemeSite(t.id)}>
                <span className="egw-pastille-theme eg-scope" data-eg-theme={t.id === "custom" ? undefined : t.id} data-custom={t.id === "custom" ? "" : undefined} aria-hidden="true" />{t.nom}
              </button>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
