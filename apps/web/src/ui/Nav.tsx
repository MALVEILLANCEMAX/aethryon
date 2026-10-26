// Navigation AETHRYON (docs/DESIGN.md §5) : une pilule FLOTTANTE dès le haut de page, qui prend la teinte de la
// section qu'elle survole (verre obsidienne sur les sections sombres, ivoire sur les claires), se masque en
// descendant et réapparaît en remontant. Au centre, une lueur suit le lien survolé et un trait d'or glisse sous la
// section où l'on se trouve (accueil : suivi du défilement ; ailleurs : la page). Deux actions distinctes :
// « Se connecter » (compte existant, /connexion) et « Commencer » (création du compte, /commencer), magnétique.
import { useEffect, useId, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { cn } from "../lib/cn.ts";
import { useMe } from "../lib/hooks.ts";
import { DUR, EASE, SPRING } from "../lib/motion.ts";
import { BrandLogo } from "./brand/BrandLogo.tsx";
import { IconArrowRight } from "./Icon.tsx";
import { MenuIcon } from "./IconMorph.tsx";
import { ButtonLink } from "./Button.tsx";
import { Magnetic } from "./Magnetic.tsx";
import { TARIFS_LABEL } from "../lib/offres.ts";

// Pages dont le haut est obsidienne : teinte sombre dès le premier rendu (pré-rendu compris), avant toute mesure.
const DARK_TOP = new Set(["/", "/commencer", "/outils"]);
const LINKS = [
  { to: "/#demo", label: "Démo", section: "demo" },
  { to: "/#surfaces", label: "Produit", section: "surfaces" },
  { to: "/outils", label: "Tools", section: null },
  { to: "/#tarifs", label: TARIFS_LABEL, section: "tarifs" },
  { to: "/aide", label: "Aide", section: null },
] as const;
const SPY = LINKS.flatMap((l) => (l.section ? [l.section] : []));
/** Hauteur de lecture sous la barre : la teinte est celle de la section qui passe à cette ligne. */
const PROBE_Y = 36;

/** Teinte de la section sous la barre et section courante de l'accueil, relues au défilement (une fois par image). */
function useWhere(pathname: string) {
  const [dark, setDark] = useState(DARK_TOP.has(pathname));
  const [section, setSection] = useState<string | null>(null);
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const tones = document.querySelectorAll<HTMLElement>(".hero-night, .section-night, [data-tone=dark]");
      let d = false;
      for (const el of tones) {
        const r = el.getBoundingClientRect();
        if (r.top <= PROBE_Y && r.bottom > PROBE_Y) { d = true; break; }
      }
      setDark(d);
      if (pathname !== "/") { setSection(null); return; }
      const line = window.innerHeight * 0.38;
      let cur: string | null = null;
      for (const id of SPY) {
        const r = document.getElementById(id)?.getBoundingClientRect();
        if (r && r.top <= line && r.bottom > line) cur = id;
      }
      setSection(cur);
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    // Les sections de l'accueil arrivent avec les blocs paresseux : une relecture quand le DOM change de taille.
    const ro = new ResizeObserver(queue);
    ro.observe(document.body);
    return () => { window.removeEventListener("scroll", queue); window.removeEventListener("resize", queue); ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [pathname]);
  return { dark, section };
}

export function Nav() {
  const { scrollY } = useScroll();
  const calm = useReducedMotion();
  const [top, setTop] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const me = useMe();
  const signedIn = !!me.data && !me.error;
  const { pathname, hash } = useLocation();
  const { dark: overDark, section } = useWhere(pathname);
  const menuId = useId();
  useMotionValueEvent(scrollY, "change", (y) => {
    const prev = scrollY.getPrevious() ?? 0;
    setTop(y < 24);
    setHidden(!calm && y > 480 && y > prev + 4 && !open);
    if (y < prev - 4) setHidden(false);
  });
  useEffect(() => { setOpen(false); }, [pathname, hash]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  // Section courante : suivie au défilement sur l'accueil (l'ancre de l'adresse ne compte qu'au tout début).
  const isActive = (l: (typeof LINKS)[number]) =>
    l.section ? pathname === "/" && (section ? section === l.section : hash === `#${l.section}`) : pathname.startsWith(l.to);
  const dark = overDark && !open;
  const tone = dark ? "dark" : "light";

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-[max(10px,env(safe-area-inset-top))]">
      <motion.nav
        aria-label="Navigation principale"
        animate={{ y: hidden ? -96 : 0 }}
        transition={SPRING.soft}
        className="nav-shell"
        data-tone={tone}
        data-top={top && !open ? "" : undefined}
      >
        <Link to="/" className="flex min-h-11 items-center rounded-full px-1.5" aria-label="AETHRYON, accueil">
          <BrandLogo size="sm" blink tone={dark ? "ivory" : "ink"} />
        </Link>
        <div className="nav-links hidden md:flex" onPointerLeave={() => setHover(null)}>
          {LINKS.map((l) => {
            const active = isActive(l);
            return (
              <NavLink key={l.to} to={l.to} className="nav-link" data-active={active ? "" : undefined} onPointerEnter={() => setHover(l.to)} onFocus={() => setHover(l.to)} onBlur={() => setHover(null)}>
                {hover === l.to && <motion.span layoutId="nav-lamp" aria-hidden className="nav-lamp" transition={SPRING.glide} />}
                <span className="relative">{l.label}</span>
                {active && <motion.span layoutId="nav-active" aria-hidden className="nav-tick" transition={SPRING.glide} />}
              </NavLink>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5">
          {signedIn ? (
            <ButtonLink to="/dashboard" variant={dark ? "light" : pathname.startsWith("/dashboard") ? "secondary" : "primary"} size="sm" className="hidden h-11 min-[360px]:inline-flex">Mon espace</ButtonLink>
          ) : (
            <>
              {/* Compte existant : action discrète (lien) ; nouveau venu : bouton plein, magnétique. */}
              <Link to="/connexion" className="nav-link hidden sm:inline-flex" data-nav-connexion="">Se connecter</Link>
              {/* Sous 360 px, la barre ne garde que le logo et le menu : l'action est en tête du menu. */}
              <Magnetic className="hidden min-[360px]:inline-flex">
                <ButtonLink to="/commencer" variant={dark ? "light" : "primary"} size="sm" className="h-11 px-4" data-nav-commencer="">Commencer</ButtonLink>
              </Magnetic>
            </>
          )}
          <button
            type="button"
            className="nav-burger md:hidden"
            aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((v) => !v)}
          >
            <MenuIcon open={open} size={20} />
          </button>
        </div>
      </motion.nav>
      <AnimatePresence>
        {/* Voile derrière le menu mobile : la page s'efface, le menu ne se confond plus avec son contenu ; un toucher
            sur le voile referme le menu (Échap aussi). Sous la barre et le menu (z négatif dans l'en-tête). */}
        {open && (
          <motion.div
            key="voile"
            aria-hidden
            data-menu-voile=""
            onClick={() => setOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: DUR.micro } }}
            transition={{ duration: DUR.component, ease: EASE.soft }}
            className="pointer-events-auto fixed inset-0 z-[-1] bg-obsidian/35 md:hidden"
          />
        )}
        {open && (
          <motion.div
            key="menu"
            id={menuId}
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: DUR.micro } }}
            transition={{ duration: DUR.component, ease: EASE.soft }}
            className="pointer-events-auto absolute inset-x-3 top-[calc(max(10px,env(safe-area-inset-top))+70px)] origin-top rounded-[28px] border border-line bg-ivory p-2 shadow-raised md:hidden"
          >
            <motion.ul initial="hidden" animate="shown" variants={{ hidden: {}, shown: { transition: { staggerChildren: 0.04 } } }}>
              <motion.li variants={{ hidden: { opacity: 0, y: -4 }, shown: { opacity: 1, y: 0 } }} className="p-1.5 min-[360px]:hidden">
                {signedIn
                  ? <ButtonLink to="/dashboard" variant="primary" className="w-full" onClick={() => setOpen(false)}>Mon espace</ButtonLink>
                  : <ButtonLink to="/commencer" variant="primary" className="w-full" onClick={() => setOpen(false)}>Commencer</ButtonLink>}
              </motion.li>
              {LINKS.map((l) => (
                <motion.li key={l.to} variants={{ hidden: { opacity: 0, y: -4 }, shown: { opacity: 1, y: 0 } }}>
                  <Link to={l.to} onClick={() => setOpen(false)} className={cn("nav-menu-item", isActive(l) && "is-current")} aria-current={isActive(l) ? "location" : undefined}>
                    {l.label}
                    <IconArrowRight size={18} className="text-gold-text" />
                  </Link>
                </motion.li>
              ))}
              {!signedIn && (
                <motion.li variants={{ hidden: { opacity: 0, y: -4 }, shown: { opacity: 1, y: 0 } }}>
                  <Link to="/connexion" onClick={() => setOpen(false)} className="nav-menu-item sm:hidden">
                    Se connecter
                    <IconArrowRight size={18} className="text-gold-text" />
                  </Link>
                </motion.li>
              )}
            </motion.ul>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
