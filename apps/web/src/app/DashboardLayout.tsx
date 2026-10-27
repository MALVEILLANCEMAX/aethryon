// Espace personnel, Égide v2 : navigation latérale (≥ 1024 px) ou onglets (mobile). Changement de section : AUCUNE
// animation (MOTION_GUIDELINES.md § 3 : navigation fréquente, souvent au clavier) ; l'indicateur se pose, sans glisser.
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { cn } from "../lib/cn.ts";
import { signOut } from "../lib/auth.ts";
import { resetAll, useResource } from "../lib/store.ts";
import type { DiscordStatus } from "../lib/types.ts";
import { IconActivity, IconCloud, IconHome, IconKey, IconLogout, IconMusic, IconShield, IconSparkle } from "../ui/Icon.tsx";
import { Button } from "../ui/Button.tsx";
import { PlatformGlyph } from "../ui/brand/PlatformGlyph.tsx";
import { Skeleton } from "../ui/bits.tsx";
import { OwlMark } from "../ui/brand/OwlMark.tsx";
import { Icone } from "../ui/egide/Egide.tsx";
import { DiscordAvatar } from "../ui/DiscordAvatar.tsx";
import { useToast } from "../ui/Toasts.tsx";
import { toastError, useRequireUser } from "./common.tsx";

/** Pictogramme NEUTRE « discussion » du registre des marques (le logo officiel de Discord est réservé à la
 *  présentation du bot, lib/platforms.ts). */
const IconDiscordAccess = ({ size, className }: { size?: number; className?: string }) => <PlatformGlyph id="discord" size={size} className={className} />;
/** Réglages › Apparence : l'icône « thème » du socle Égide. */
const IconApparence = ({ className }: { size?: number; className?: string }) => <Icone nom="theme" className={className} />;

/** Onglet : à l'étroit (< 640 px), sans pictogramme et avec des marges réduites (cinq onglets : la barre défile au-dessous
 *  de 400 px environ, l'onglet actif est ramené dans la partie visible) ; avant, pour que les onglets tiennent
 *  dès 320 px ; pictogrammes à partir de 640 px ; liste verticale à partir de 1024 px. */
const TAB = "relative flex min-h-11 flex-1 items-center justify-center gap-2.5 whitespace-nowrap rounded-control px-2 text-[14px] font-medium transition-colors " +
  "min-[360px]:px-2.5 min-[360px]:text-[14.5px] sm:px-3 sm:text-[15px] md:px-4 lg:flex-none lg:justify-start";

const TABS = [
  { to: "/dashboard", label: "Accueil", icon: IconHome, end: true },
  { to: "/dashboard/cles", label: "Jetons", icon: IconKey, end: false },
  { to: "/dashboard/activite", label: "Activité", icon: IconActivity, end: false },
  { to: "/dashboard/discord", label: "Discord", icon: IconDiscordAccess, end: false },
  { to: "/dashboard/abonnement", label: "Abonnement", icon: IconSparkle, end: false },
  { to: "/dashboard/apparence", label: "Apparence", icon: IconApparence, end: false },
];

export default function DashboardLayout() {
  const me = useRequireUser();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [leaving, setLeaving] = useState(false);
  // Compte Discord lié : son image de profil remplace l'initiale sur la carte du compte (même ressource que la page Discord).
  const dc = useResource<DiscordStatus>(me.data ? "/api/discord" : null, 60_000);
  const linked = dc.data?.linked ? dc.data.discord : null;
  // AETHRYON Cloud : onglet seulement pour l'administrateur, et seulement si le serveur répond (cloud ouvert).
  const cloud = useResource<{ actif: boolean }>(me.data?.user.role === "admin" ? "/api/cloud/etat" : null, 5 * 60_000);
  // AETHRYON Music : onglet pour TOUT compte connecté, dès que le relais est ouvert (historique lisible = relais ouvert).
  const musique = useResource<{ entrees: unknown[] }>(me.data ? "/api/music/historique" : null, 5 * 60_000);
  // Barre d'onglets (mobile) : si elle déborde (5 onglets d'un administrateur à 320 px), l'onglet actif est ramené
  // dans la partie visible à chaque changement de page.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [location.pathname, me.data]);
  const logout = async () => {
    setLeaving(true);
    try {
      await signOut();
      resetAll(); // plus aucune donnée du compte en mémoire
      navigate("/", { replace: true });
      toast.show("success", "Déconnecté", "À bientôt !");
    } catch (e) {
      toastError(toast, e, "Déconnexion impossible");
    } finally {
      setLeaving(false);
    }
  };
  if (!me.data) {
    // Erreur réseau ou serveur (401 : redirection vers la connexion, voir useRequireUser).
    if (me.error && me.error.status !== 401) {
      return (
        <div className="container-site pb-24 pt-28 sm:pt-32" data-espace="erreur">
          <h1 className="page-title">Ton espace ne répond pas</h1>
          <p className="mt-3 max-w-xl text-[16.5px] leading-relaxed text-ink-soft" role="alert">
            Le serveur n'a pas pu charger ton compte. Vérifie ta connexion, puis réessaie. Tes jetons et ton activité ne sont pas touchés.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Button variant="primary" onClick={() => void me.reload()}>Réessayer</Button>
            <Link to="/aide#etat" className="inline-flex min-h-11 items-center text-[15px] text-gold-text underline decoration-gold/50 underline-offset-4 hover:decoration-gold-text">État du service</Link>
          </div>
        </div>
      );
    }
    // Chargement : la même silhouette que la page (navigation, titre, deux panneaux), sans texte qui saute.
    return (
      <div className="container-site min-h-[calc(100svh+8rem)] pb-24 pt-28 sm:pt-32" aria-busy="true" data-espace="chargement">
        <span className="sr-only" role="status">Chargement de ton espace…</span>
        <div className="lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-12">
          <div className="mb-8 lg:mb-0">
            <div className="hidden items-center gap-3 lg:flex"><Skeleton className="size-11 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-40" /></div></div>
            <Skeleton className="h-[54px] rounded-full lg:mt-7 lg:h-36 lg:rounded-[22px]" />
          </div>
          <div>
            <Skeleton className="h-11 w-[min(100%,20rem)]" />
            <Skeleton className="mt-4 h-5 w-[min(100%,28rem)]" />
            <Skeleton className="mt-8 h-72 rounded-[28px]" />
            <Skeleton className="mt-5 h-60 rounded-[28px]" />
          </div>
        </div>
      </div>
    );
  }
  const user = me.data.user;
  const logoutBtn = (cls: string) => (
    <button type="button" onClick={logout} disabled={leaving} aria-busy={leaving || undefined} className={cn("min-h-11 items-center gap-2.5 rounded-control px-3 text-[15px] text-ink-soft transition-colors hover:bg-hover hover:text-ink disabled:opacity-60", cls)}>
      <IconLogout size={18} />{leaving ? "Déconnexion…" : "Se déconnecter"}
    </button>
  );
  return (
    <div className="container-site min-h-svh pb-24 pt-28 sm:pt-32">
      <div className="lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-12">
        <aside className="mb-8 lg:mb-0">
          {/* Carte du compte : un panneau du thème, la chouette en marque. */}
          <Link to="/dashboard/compte" className="dash-id hidden lg:flex" data-dash-id="">
            {linked
              ? <DiscordAvatar version={linked.avatarVersion} name={user.name || user.email} size={42} className="dash-id-avatar" />
              : <span className="dash-id-avatar" aria-hidden>{(user.name || user.email).slice(0, 1).toUpperCase()}</span>}
            <div className="min-w-0">
              {/* Nom du lien = « Ton compte, » + le texte visible (WCAG 2.5.3 : le nom accessible contient le libellé). */}
              <span className="sr-only">Ton compte, </span>
              <p className="truncate text-[15px] font-medium text-fg">{user.name}</p>
              <p className="truncate text-[13px] text-fg-2">{user.email}</p>
            </div>
            <OwlMark size={22} surface="dark" className="dash-id-owl" />
          </Link>
          <nav ref={navRef} aria-label="Espace personnel" className="dash-nav flex gap-1 overflow-x-auto rounded-card border border-line bg-surface p-1 lg:mt-5 lg:flex-col lg:p-1.5">
            {TABS.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => cn(TAB, isActive ? "text-ink" : "text-ink-soft hover:text-ink")}>
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute inset-0 rounded-control bg-hover"><span aria-hidden className="dash-tab-tick" /></span>}
                    <Icon size={18} className={cn("relative hidden sm:block", isActive && "text-gold-text")} />
                    <span className="relative">{label}</span>
                  </>
                )}
              </NavLink>
            ))}
            {musique.data && (
              // Chargement complet de la page : sa CSP autorise pochettes, aperçus et lecteurs officiels (nginx).
              <NavLink to="/dashboard/musique" reloadDocument className={({ isActive }) => cn(TAB, isActive ? "text-ink" : "text-ink-soft hover:text-ink")}>
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute inset-0 rounded-control bg-hover"><span aria-hidden className="dash-tab-tick" /></span>}
                    <IconMusic size={18} className={cn("relative hidden sm:block", isActive && "text-gold-text")} />
                    <span className="relative">Musique</span>
                  </>
                )}
              </NavLink>
            )}
            {user.role === "admin" && cloud.data?.actif && (
              // Chargement complet de la page : son en-tête CSP autorise la lecture des aperçus depuis le stockage (nginx).
              <NavLink to="/dashboard/cloud" reloadDocument className={({ isActive }) => cn(TAB, isActive ? "text-ink" : "text-ink-soft hover:text-ink")}>
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute inset-0 rounded-control bg-hover"><span aria-hidden className="dash-tab-tick" /></span>}
                    <IconCloud size={18} className={cn("relative hidden sm:block", isActive && "text-gold-text")} />
                    <span className="relative">Cloud</span>
                  </>
                )}
              </NavLink>
            )}
            {user.role === "admin" && (
              <NavLink to="/admin" className={cn(TAB, "text-ink-soft hover:text-ink")}>
                <IconShield size={18} className="hidden sm:block" />Admin
              </NavLink>
            )}
          </nav>
          {logoutBtn("mt-4 hidden lg:flex")}
        </aside>
        <div>
          <Outlet />
          {logoutBtn("mt-10 flex lg:hidden")}
        </div>
      </div>
    </div>
  );
}
