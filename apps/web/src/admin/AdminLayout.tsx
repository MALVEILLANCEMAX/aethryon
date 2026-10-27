// AETHRYON Control Center : coque de l'administration. Barre latérale obsidienne (repère or sur la page
// active) et contenu ivoire ; sous 1024 px, barre supérieure + tiroir (dialog natif : focus piégé, Échap).
// Le rôle est vérifié ici pour l'AFFICHAGE seulement (GET /api/admin/me) : la vraie protection est côté
// serveur (garde /api/admin/*, rôle relu en base) et nginx (auth_request avant de servir /admin).
import { Suspense, useEffect, useRef, useState, type ComponentType, type MouseEvent } from "react";
import { ThemeMenu } from "../ui/egide/ThemeMenu.tsx";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { motion } from "motion/react";
import { cn } from "../lib/cn.ts";
import { DUR, EASE, SPRING } from "../lib/motion.ts";
import { useResource } from "../lib/store.ts";
import { useDocumentTitle } from "../lib/hooks.ts";
import { BrandLogo } from "../ui/brand/BrandLogo.tsx";
import { OwlMark } from "../ui/brand/OwlMark.tsx";
import { ButtonLink, Button } from "../ui/Button.tsx";
import { Skeleton } from "../ui/bits.tsx";
import { IconActivity, IconArrowRight, IconClose, IconGauge, IconHome, IconKey, IconLock, IconMenu, IconRefresh, IconShield } from "../ui/Icon.tsx";
import { IconChart, IconScroll, IconServer, IconSettings, IconSliders, IconUsers } from "./icons.tsx";
import { ADMIN_API } from "./data.ts";
import type { AdminMe } from "./types.ts";
import { Monogram } from "./ui.tsx";

type Icon = ComponentType<{ size?: number; className?: string }>;
const NAV: { to: string; label: string; icon: Icon; end?: boolean }[] = [
  { to: "/admin", label: "Vue d'ensemble", icon: IconGauge, end: true },
  { to: "/admin/users", label: "Utilisateurs", icon: IconUsers },
  { to: "/admin/quotas", label: "Quotas", icon: IconSliders },
  { to: "/admin/conversions", label: "Conversions", icon: IconActivity },
  { to: "/admin/api-keys", label: "Clés API", icon: IconKey },
  { to: "/admin/analytics", label: "Statistiques", icon: IconChart },
  { to: "/admin/system", label: "Système", icon: IconServer },
  { to: "/admin/audit", label: "Audit", icon: IconScroll },
  { to: "/admin/securite", label: "Sécurité", icon: IconShield },
  { to: "/admin/settings", label: "Paramètres", icon: IconSettings },
];

function currentLabel(pathname: string): string {
  const hit = [...NAV].reverse().find((n) => (n.end ? pathname === n.to || pathname === `${n.to}/` : pathname.startsWith(n.to)));
  return hit?.label ?? "Control Center";
}

function SideNav({ me, marker, onNavigate }: { me: AdminMe; marker: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-6 pt-6">
        <Link to="/admin" onClick={onNavigate} className="inline-flex min-h-11 items-center" aria-label="AETHRYON, vue d'ensemble du Control Center">
          <BrandLogo size="sm" tone="ivory" />
        </Link>
        <p className="mt-1.5 text-[13px] font-semibold text-accent-text">Control Center</p>
      </div>
      <nav aria-label="Control Center" className="flex-1 overflow-y-auto px-3">
        <ul className="space-y-0.5">
          {NAV.map(({ to, label, icon: I, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                onClick={onNavigate}
                className={({ isActive }) => cn(
                  "relative flex min-h-11 items-center gap-3 rounded-[12px] px-3.5 text-[14.5px] transition-colors",
                  isActive ? "bg-hover text-fg" : "text-fg-2 hover:bg-hover hover:text-fg",
                )}
              >
                {({ isActive }) => (
                  <>
                    {isActive && <motion.span layoutId={marker} aria-hidden className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-gold" transition={SPRING.snappy} />}
                    <I size={18} className={cn("shrink-0", isActive && "text-gold")} />
                    <span>{label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="border-t border-line px-4 py-4">
        <div className="flex items-center gap-3 px-1">
          <Monogram name={me.name || me.email} admin size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium text-fg">{me.name || "Administrateur"}</p>
            <p className="truncate text-[12.5px] text-fg-2">{me.email}</p>
          </div>
          {/* Thème (Égide) : le même choix que sur le site et dans l'espace, gardé sur cet appareil. */}
          <ThemeMenu />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <Link to="/dashboard" onClick={onNavigate} className="flex min-h-11 items-center justify-center gap-1.5 rounded-control border border-line-strong text-[13px] text-fg-2 transition-colors hover:border-control hover:text-fg">Mon espace</Link>
          <Link to="/" onClick={onNavigate} className="flex min-h-11 items-center justify-center gap-1.5 rounded-control border border-line-strong text-[13px] text-fg-2 transition-colors hover:border-control hover:text-fg"><IconHome size={15} />Le site</Link>
        </div>
      </div>
    </div>
  );
}

function MobileDrawer({ open, onClose, me }: { open: boolean; onClose: () => void; me: AdminMe }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    // Écran repassé en mise en page large : le tiroir se ferme (jamais de modale masquée par display:none).
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => { if (mq.matches) onClose(); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [onClose]);
  return (
    <dialog
      ref={ref}
      aria-label="Menu du Control Center"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="m-0 h-dvh max-h-dvh w-[min(300px,86vw)] max-w-none bg-transparent p-0 backdrop:bg-[var(--eg-scrim)] lg:hidden"
    >
      {open && (
        <motion.div initial={{ x: -28, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: DUR.component, ease: EASE.soft }} className="bg-surface text-fg relative h-full shadow-raised">
          <button type="button" onClick={onClose} aria-label="Fermer le menu" className="absolute right-3 top-5 z-10 grid size-11 place-items-center rounded-full text-fg-2 transition-colors hover:bg-hover hover:text-fg">
            <IconClose size={19} />
          </button>
          <SideNav me={me} marker="admin-nav-drawer" onNavigate={onClose} />
        </motion.div>
      )}
    </dialog>
  );
}

function skipTo(e: MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  const main = document.getElementById("admin-contenu");
  main?.focus({ preventScroll: true });
  main?.scrollIntoView({ block: "start" });
}

function GuardScreen({ kind, onRetry }: { kind: "login" | "forbidden" | "error"; onRetry?: () => unknown }) {
  const { pathname, search } = useLocation();
  useDocumentTitle(kind === "forbidden" ? "Accès réservé" : kind === "login" ? "Connexion requise" : "Control Center indisponible");
  const content = {
    login: {
      title: "Connexion requise",
      text: "Connecte-toi avec un compte administrateur pour ouvrir le Control Center.",
    },
    forbidden: {
      title: "Accès réservé",
      text: "Le Control Center d'AETHRYON est réservé aux administrateurs. Ton compte n'a pas ce rôle : aucune donnée d'administration ne t'est envoyée par le serveur.",
    },
    error: {
      title: "Control Center injoignable",
      text: "Le serveur n'a pas pu confirmer ton rôle pour l'instant. Réessaie dans un instant ; si le problème continue, consulte l'état du service.",
    },
  }[kind];
  return (
    <main id="admin-contenu" tabIndex={-1} className="grid min-h-dvh place-items-center bg-ivory px-4 py-16 focus:outline-none">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.reveal, ease: EASE.soft }} className="w-full max-w-[460px] rounded-[28px] border border-line bg-pearl/60 p-7 text-center shadow-raised sm:p-9">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-sunken text-gold"><IconLock size={24} /></span>
        <p className="mt-5 text-[13px] font-semibold text-accent-text">Control Center</p>
        <h1 className="font-display mt-2 text-[30px] font-medium leading-tight">{content.title}</h1>
        <p className="mt-3 text-[15.5px] leading-relaxed text-ink-soft">{content.text}</p>
        <div className="mt-7 flex flex-col justify-center gap-2.5 sm:flex-row">
          {kind === "login" && <ButtonLink to={`/connexion?suite=${encodeURIComponent(pathname + search)}`} variant="primary" trailing={<IconArrowRight size={17} />}>Se connecter</ButtonLink>}
          {kind === "forbidden" && <ButtonLink to="/dashboard" variant="primary">Retour à mon espace</ButtonLink>}
          {kind === "error" && <Button variant="primary" icon={<IconRefresh size={17} />} onClick={() => void onRetry?.()}>Réessayer</Button>}
          <ButtonLink to="/" variant="ghost">Accueil du site</ButtonLink>
        </div>
      </motion.div>
    </main>
  );
}

function ContentFallback() {
  return (
    <div aria-busy="true" className="space-y-5">
      <span className="sr-only" role="status">Chargement…</span>
      <Skeleton className="h-9 w-64" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
      <Skeleton className="h-64" />
    </div>
  );
}

/** Squelette affiché pendant le chargement du code de l'administration et la vérification du rôle. */
export function AdminBoot() {
  return (
    <div aria-busy="true" className="min-h-dvh bg-ivory lg:pl-[264px]">
      <span className="sr-only" role="status">Chargement du Control Center…</span>
      <div className="fixed inset-y-0 left-0 hidden w-[264px] bg-sunken lg:block" />
      <div className="h-14 bg-sunken lg:hidden" />
      <div className="mx-auto max-w-[1320px] px-4 py-8 sm:px-6 lg:px-10"><ContentFallback /></div>
    </div>
  );
}

export default function AdminLayout() {
  const me = useResource<AdminMe>(`${ADMIN_API}/me`, 60_000);
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); window.scrollTo({ top: 0 }); }, [pathname]);

  if (!me.data) {
    if (me.error?.status === 401) return <GuardScreen kind="login" />;
    if (me.error?.status === 403) return <GuardScreen kind="forbidden" />;
    if (me.error) return <GuardScreen kind="error" onRetry={me.reload} />;
    return <AdminBoot />;
  }
  if (me.data.role !== "admin") return <GuardScreen kind="forbidden" />;

  return (
    <div className="min-h-dvh bg-ivory">
      <a href="#admin-contenu" onClick={skipTo} className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-full focus:bg-gold focus:px-5 focus:py-3 focus:text-on-accent">Aller au contenu</a>

      {/* ≥ 1024 px : barre latérale fixe */}
      <aside className="bg-surface text-fg fixed inset-y-0 left-0 z-30 hidden w-[264px] border-r border-line lg:block">
        <SideNav me={me.data} marker="admin-nav-desktop" />
      </aside>

      {/* < 1024 px : barre supérieure + tiroir */}
      <header className="bg-surface text-fg sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line px-2 pt-[env(safe-area-inset-top)] lg:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label="Ouvrir le menu du Control Center" aria-expanded={open} className="grid size-11 place-items-center rounded-full text-fg-2 transition-colors hover:bg-hover hover:text-fg">
          <IconMenu size={20} />
        </button>
        <Link to="/admin" className="flex min-h-11 items-center gap-2 rounded-full px-1" aria-label="Control Center, vue d'ensemble">
          <OwlMark size={24} surface="dark" />
          <span className="text-[13px] font-semibold text-accent-text">Control Center</span>
        </Link>
        <span aria-hidden className="ml-auto truncate pr-2 text-[13.5px] text-fg-2">{currentLabel(pathname)}</span>
      </header>
      <MobileDrawer open={open} onClose={() => setOpen(false)} me={me.data} />

      <div className="lg:pl-[264px]">
        <main id="admin-contenu" tabIndex={-1} className="mx-auto w-full max-w-[1320px] px-4 pb-20 pt-6 focus:outline-none sm:px-6 sm:pt-8 lg:px-10 lg:pt-10">
          <motion.div key={pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.component, ease: EASE.soft }}>
            <Suspense fallback={<ContentFallback />}>
              <Outlet context={me.data} />
            </Suspense>
          </motion.div>
        </main>
      </div>
    </div>
  );
}
