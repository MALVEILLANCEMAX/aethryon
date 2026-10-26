// Routes : la page d'accueil est chargée tout de suite, les autres pages à la demande (code séparé).
// Le Control Center (/admin) a sa propre coque et son propre code : un utilisateur qui n'ouvre pas
// /admin ne le télécharge jamais (nginx refuse d'ailleurs de servir /admin à un non-administrateur).
// Build sans Control Center (VITE_CONTROL_CENTER=0, site public tant qu'il n'est pas validé) : son code
// n'est pas du tout inclus et /admin reste l'ancienne page d'administration (AdminLegacy).
// Les MÊMES routes servent au navigateur (main.tsx : createBrowserRouter) et au rendu statique des pages
// publiques à la construction (entry-static.tsx : routeur statique) ; nginx sert chaque page publique
// pré-rendue, la coque neutre aux routes de l'application et une vraie 404 au reste (scripts/prerender.mjs
// vérifie que nginx/default.conf et ces routes disent la même chose).
// La page de consentement de l'extension (/extension/autoriser) est présente dans LES DEUX builds : elle ne
// dépend pas du Control Center (seulement des routes /api/extension d'account). De même pour la page d'accord
// d'AETHRYON pour Premiere Pro (/premiere/connecter, routes /api/premiere d'account) : aucun lien ne mène à elle
// sur le site, seul le panneau de Premiere l'ouvre. Idem pour celle d'AETHRYON Desktop (/desktop/connecter).
import { isValidElement, lazy, Suspense, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { matchRoutes, Outlet, useLocation, useParams, type RouteObject } from "react-router";
import { Nav } from "./ui/Nav.tsx";
import { Footer } from "./ui/Footer.tsx";
import { Landing } from "./landing/Landing.tsx";
import { RouteError } from "./app/RouteError.tsx";
import { PREMIUM_PAGE } from "./lib/offres.ts";

/** Page chargée à la demande ET préchargeable : une fois son code chargé (`preload`), elle s'affiche
 *  directement, sans passer par Suspense. Au démarrage sur une page pré-rendue (main.tsx), le premier
 *  rendu remplace ainsi le HTML statique par la même page, jamais par l'attente (PageFallback). */
type Preloadable = ComponentType & { preload: () => Promise<unknown> };
function lazyPage(load: () => Promise<{ default: ComponentType }>): Preloadable {
  let loaded: ComponentType | null = null;
  const preload = () => load().then((m) => { loaded = m.default; return m; });
  const Lazy = lazy(preload);
  // Choix fait une fois par montage : passer de Lazy à la page chargée en cours de vie la remonterait.
  const Page = () => {
    const [C] = useState<ComponentType>(() => loaded ?? Lazy);
    return <C />;
  };
  return Object.assign(Page, { preload });
}

const Login = lazyPage(() => import("./app/Login.tsx"));
const Commencer = lazyPage(() => import("./app/Commencer.tsx"));
const Installer = lazyPage(() => import("./app/Installer.tsx"));
const DashboardLayout = lazyPage(() => import("./app/DashboardLayout.tsx"));
const DashboardHome = lazyPage(() => import("./app/DashboardHome.tsx"));
const Keys = lazyPage(() => import("./app/Keys.tsx"));
const Activity = lazyPage(() => import("./app/Activity.tsx"));
// Liaison Discord (docs/DISCORD-BOT.md §17) : page de l'espace, et page d'arrivée d'un lien de téléchargement
// du bot qui n'a pas pu servir le fichier (sans connexion : le lien est un secret porteur à usage unique).
const Discord = lazyPage(() => import("./app/Discord.tsx"));
const Compte = lazyPage(() => import("./app/Compte.tsx"));
const Abonnement = lazyPage(() => import("./app/Abonnement.tsx"));
// AETHRYON Cloud (administrateur seulement ; page absente pour les autres comptes, 403 côté serveur).
const Cloud = lazyPage(() => import("./app/Cloud.tsx"));
// AETHRYON Music (tout compte connecté ; 404 « music_closed » tant que le relais est coupé).
const Musique = lazyPage(() => import("./app/Musique.tsx"));
// Page publique de l'offre annuelle (AETHRYON Premium), seulement quand les offres payantes sont montrées.
const Premium = lazyPage(() => import("./app/Premium.tsx"));
const DiscordDownload = lazyPage(() => import("./app/DiscordDownload.tsx"));
// Inscription par e-mail et mot de passe oublié (liens reçus par e-mail ; coque neutre, aucun pré-rendu).
const Inscription = lazyPage(() => import("./app/Inscription.tsx"));
const MotDePasseOublie = lazyPage(() => import("./app/MotDePasse.tsx").then((m) => ({ default: m.MotDePasseOublie })));
const NouveauMotDePasse = lazyPage(() => import("./app/MotDePasse.tsx").then((m) => ({ default: m.NouveauMotDePasse })));
const Help = lazyPage(() => import("./app/Help.tsx"));
const Privacy = lazyPage(() => import("./app/Privacy.tsx"));
const ExtensionPage = lazyPage(() => import("./app/ExtensionPage.tsx"));
// Open source : code (Apache-2.0), téléchargements pour ordinateur, versions du dépôt officiel (lib/github.ts).
const OpenSource = lazyPage(() => import("./app/OpenSource.tsx"));
const Conditions = lazyPage(() => import("./app/Conditions.tsx"));
// Pages juridiques de la vente (src/legal/*.md) : publiques, pré-rendues.
const Cgv = lazyPage(() => import("./app/Cgv.tsx"));
const MentionsLegales = lazyPage(() => import("./app/MentionsLegales.tsx"));
const Remboursement = lazyPage(() => import("./app/Remboursement.tsx"));
const NotFound = lazyPage(() => import("./app/NotFound.tsx"));
// Consentement de l'extension navigateur (fenêtre chrome.identity) : hors de la coque du site.
const ExtensionAuthorize = lazy(() => import("./app/ExtensionAuthorize.tsx"));
// Page d'accord du panneau Premiere (ouverte dans le navigateur par Premiere Pro) : hors de la coque, elle aussi.
const PremiereConnect = lazy(() => import("./app/PremiereConnect.tsx"));
// Page d'accord d'AETHRYON Desktop (ouverte par le Desktop, Paramètres › Compte) : même forme, hors de la coque.
const DesktopConnect = lazy(() => import("./app/DesktopConnect.tsx"));
// AETHRYON Tools (docs/OUTILS.md) : la page publique dans la coque ; l'éditeur, plein écran, hors de la coque, dans son
// propre code (téléchargé seulement en l'ouvrant).
const OutilsPage = lazyPage(() => import("./outils/OutilsPage.tsx"));
const Studio = lazy(() => import("./outils/Studio.tsx"));
const StudioRef = lazy(() => import("./outils/Studio.tsx").then((m) => ({ default: m.StudioRef })));
/** Un éditeur par média : passer d'un média à un autre (historique, lien) repart d'un état neuf, jamais de l'ancien. */
function StudioParMedia() {
  const { id = "" } = useParams();
  return <Studio key={id} />;
}

/** Remplacée à la construction par Vite : `false` retire tout le code du Control Center du build. */
const CONTROL_CENTER = import.meta.env.VITE_CONTROL_CENTER !== "0";

function ScrollManager() {
  const { pathname, hash } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    // Premier affichage : le navigateur a déjà placé la page (en haut, sur l'ancre, ou à la position
    // restaurée d'un rechargement) ; une page pré-rendue a pu défiler avant le démarrage du script.
    const initial = first.current;
    first.current = false;
    if (hash) {
      const id = decodeURIComponent(hash.slice(1));
      const t = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
      return () => window.clearTimeout(t);
    }
    if (!initial) window.scrollTo({ top: 0 });
  }, [pathname, hash]);
  return null;
}

// V3.5 : panneau de confidentialité (cookie PS1) et fenêtre « Nouveautés », chargés à part une fois la page prête
// (temps libre du navigateur, au plus tard 2,5 s), ou tout de suite si le pied de page les demande.
const PremiereVisite = lazy(() => import("./ui/PremiereVisite.tsx"));
function VisiteDifferee() {
  const [pret, setPret] = useState(false);
  useEffect(() => {
    if (pret) return;
    const go = () => setPret(true);
    window.addEventListener("aethryon:visite", go);
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const id = w.requestIdleCallback ? w.requestIdleCallback(go, { timeout: 2500 }) : window.setTimeout(go, 1200);
    return () => {
      window.removeEventListener("aethryon:visite", go);
      if (w.cancelIdleCallback) w.cancelIdleCallback(id); else window.clearTimeout(id);
    };
  }, [pret]);
  return pret ? <Suspense fallback={null}><PremiereVisite /></Suspense> : null;
}

function PageFallback() {
  // Pleine hauteur : pendant le chargement du code de la page, le pied de page reste sous la ligne de
  // flottaison ; sinon il saute à l'arrivée du contenu (CLS mesuré à 0,15–0,24 sur bureau).
  // Plus haute que l'écran de la couture du pied de page ET de son ombre portée vers le haut (≈ 80 px) : pendant
  // l'attente, ni le pied de page ni son ombre n'apparaissent en bas de l'écran pour repartir ensuite (CLS).
  return <div className="container-site min-h-[calc(100svh+8rem)] pt-40" aria-busy="true"><div className="h-10 w-64 animate-pulse rounded-full bg-sand/70 motion-reduce:animate-none" /></div>;
}

function Shell() {
  return (
    <>
      <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-full focus:bg-obsidian focus:px-5 focus:py-3 focus:text-ivory">Aller au contenu</a>
      <ScrollManager />
      <Nav />
      {/* Au moins un écran plus la couture du pied de page et son ombre portée (≈ 80 px) : pendant un chargement (page,
          sous-page, données), ni le pied de page ni son ombre ne surgissent en bas de l'écran pour repartir (CLS). */}
      <main id="contenu" className="min-h-[calc(100svh+8rem)]">
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
      <VisiteDifferee />
    </>
  );
}

const page = (el: ReactNode) => el;

/** Attente du code du Control Center : silhouette sombre/ivoire, sans texte qui saute. */
function AdminFallback() {
  return (
    <div aria-busy="true" className="min-h-dvh bg-ivory lg:pl-[264px]">
      <span className="sr-only" role="status">Chargement du Control Center…</span>
      <div className="fixed inset-y-0 left-0 hidden w-[264px] bg-obsidian lg:block" />
      <div className="h-14 bg-obsidian lg:hidden" />
    </div>
  );
}

/** Attente du code de l'éditeur : la scène obsidienne, sans texte qui saute. */
function StudioFallback() {
  return (
    <div aria-busy="true" className="fixed inset-0 bg-obsidian">
      <span className="sr-only" role="status">Ouverture de l'éditeur…</span>
    </div>
  );
}

/** Attente du code de la page de consentement : fond ivoire, sans texte qui saute. */
function ConsentFallback() {
  return (
    <div aria-busy="true" className="grid min-h-dvh place-items-center bg-ivory px-4">
      <span className="sr-only" role="status">Chargement…</span>
      <div className="h-[420px] w-full max-w-[540px] animate-pulse rounded-[30px] bg-sand/50 motion-reduce:animate-none" />
    </div>
  );
}

/** Control Center : déclaré dans une fonction pour que ses imports disparaissent du build s'il est désactivé. */
function controlCenterRoute(): RouteObject {
  const AdminLayout = lazy(() => import("./admin/AdminLayout.tsx"));
  const AdminOverview = lazy(() => import("./admin/pages/Overview.tsx"));
  const AdminUsers = lazy(() => import("./admin/pages/Users.tsx"));
  const AdminUserDetail = lazy(() => import("./admin/pages/UserDetail.tsx"));
  const AdminQuotas = lazy(() => import("./admin/pages/Quotas.tsx"));
  const AdminConversions = lazy(() => import("./admin/pages/Conversions.tsx"));
  const AdminKeys = lazy(() => import("./admin/pages/ApiKeys.tsx"));
  const AdminAnalytics = lazy(() => import("./admin/pages/Analytics.tsx"));
  const AdminSystem = lazy(() => import("./admin/pages/System.tsx"));
  const AdminAudit = lazy(() => import("./admin/pages/Audit.tsx"));
  const AdminSecurite = lazy(() => import("./admin/pages/Securite.tsx"));
  const AdminSettings = lazy(() => import("./admin/pages/Settings.tsx"));
  const AdminNotFound = lazy(() => import("./admin/pages/NotFound.tsx"));
  return {
    path: "/admin",
    caseSensitive: true,
    element: <Suspense fallback={<AdminFallback />}><AdminLayout /></Suspense>,
    errorElement: <RouteError plein />,
    children: [{ errorElement: <RouteError compact />, children: [
      { index: true, element: <AdminOverview /> },
      { path: "users", element: <AdminUsers /> },
      { path: "users/:id", element: <AdminUserDetail /> },
      { path: "quotas", element: <AdminQuotas /> },
      { path: "conversions", element: <AdminConversions /> },
      { path: "api-keys", element: <AdminKeys /> },
      { path: "analytics", element: <AdminAnalytics /> },
      { path: "system", element: <AdminSystem /> },
      { path: "audit", element: <AdminAudit /> },
      { path: "securite", element: <AdminSecurite /> },
      { path: "settings", element: <AdminSettings /> },
      { path: "*", element: <AdminNotFound /> },
    ] }],
  };
}

/** Ancienne page /admin (dans la coque du site), pour un build sans Control Center. */
function legacyAdminRoutes(): RouteObject[] {
  const AdminLegacy = lazy(() => import("./app/AdminLegacy.tsx"));
  return [{ path: "/admin", element: page(<AdminLegacy />) }];
}

/** Sensible à la casse, comme nginx : /Aide est une 404 des deux côtés (jamais le HTML d'une page puis
 *  une autre page une fois l'application démarrée). */
function caseSensitive(list: RouteObject[]): RouteObject[] {
  return list.map((r) => ({ ...r, caseSensitive: true, ...(r.children ? { children: caseSensitive(r.children) } : {}) }) as RouteObject);
}

/** Charge le code des pages préchargeables de cette adresse (démarrage sur une page pré-rendue). */
/** Pages dont le code est chargé d'avance, au repos, après l'affichage : une navigation vers elles s'affiche aussitôt,
 *  sans attente. Le code seulement (aucune donnée, aucune requête à l'API). */
const IDLE_PUBLIC = ["/", "/outils", "/aide", "/installer", "/extension", "/connexion", "/commencer", "/confidentialite", "/conditions"];
const IDLE_ESPACE = ["/dashboard", "/dashboard/cles", "/dashboard/activite", "/dashboard/compte", "/dashboard/abonnement", "/dashboard/discord"];

/** Préchargement du code des pages : au repos (pages principales ; celles de l'espace quand on y est), et dès qu'un doigt
 *  ou un pointeur se pose sur un lien interne (avant la fin du toucher). Rien en mode économie de données ni en 2G,
 *  hors l'intention explicite (doigt posé sur le lien). */
export function installPrefetch(): void {
  const done = new Set<string>();
  const go = (path: string) => { if (done.has(path)) return; done.add(path); void preloadRoute(path).catch(() => done.delete(path)); };
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  const thrifty = !!conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? "");
  const intent = (e: Event) => {
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!(a instanceof HTMLAnchorElement) || a.target === "_blank" || a.origin !== location.origin || a.hasAttribute("download")) return;
    go(a.pathname);
  };
  document.addEventListener("pointerdown", intent, { capture: true, passive: true });
  if (thrifty) return;
  document.addEventListener("pointerover", intent, { capture: true, passive: true });
  const idle = (fn: () => void) => { if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(fn, { timeout: 5000 }); else setTimeout(fn, 1); };
  window.setTimeout(() => idle(() => {
    for (const p of IDLE_PUBLIC) go(p);
    if (location.pathname.startsWith("/dashboard")) for (const p of IDLE_ESPACE) go(p);
  }), 2500);
}

export function preloadRoute(pathname: string): Promise<unknown> {
  return Promise.all((matchRoutes(routes, pathname) ?? []).map(({ route }) => {
    const type = isValidElement(route.element) ? (route.element.type as Partial<Preloadable>) : undefined;
    return typeof type?.preload === "function" ? type.preload() : undefined;
  }));
}

export const routes: RouteObject[] = caseSensitive([
  {
    path: "/extension/autoriser",
    element: <Suspense fallback={<ConsentFallback />}><ExtensionAuthorize /></Suspense>,
    errorElement: <RouteError plein />,
  },
  {
    path: "/premiere/connecter",
    element: <Suspense fallback={<ConsentFallback />}><PremiereConnect /></Suspense>,
    errorElement: <RouteError plein />,
  },
  {
    path: "/desktop/connecter",
    element: <Suspense fallback={<ConsentFallback />}><DesktopConnect /></Suspense>,
    errorElement: <RouteError plein />,
  },
  {
    path: "/outils/studio",
    element: <Suspense fallback={<StudioFallback />}><StudioRef /></Suspense>,
    errorElement: <RouteError plein />,
  },
  {
    path: "/outils/studio/:id",
    element: <Suspense fallback={<StudioFallback />}><StudioParMedia /></Suspense>,
    errorElement: <RouteError plein />,
  },
  {
    element: <Shell />,
    errorElement: <RouteError plein />,
    // Erreur d'une page : affichée DANS la coque (navigation et pied de page restent).
    children: [{ errorElement: <RouteError />, children: [
      { path: "/", element: page(<Landing />) },
      { path: "/connexion", element: page(<Login />) },
      { path: "/commencer", element: page(<Commencer />) },
      { path: "/installer", element: page(<Installer />) },
      {
        path: "/dashboard",
        element: page(<DashboardLayout />),
        // Erreur d'une page de l'espace : affichée dans l'espace (menu de l'espace conservé).
        children: [{ errorElement: <RouteError compact />, children: [
          { index: true, element: page(<DashboardHome />) },
          { path: "cles", element: page(<Keys />) },
          { path: "activite", element: page(<Activity />) },
          { path: "discord", element: page(<Discord />) },
          { path: "compte", element: page(<Compte />) },
          { path: "abonnement", element: page(<Abonnement />) },
          { path: "cloud", element: page(<Cloud />) },
          { path: "musique", element: page(<Musique />) },
        ] }],
      },
      { path: "/discord/telechargement", element: page(<DiscordDownload />) },
      { path: "/inscription", element: page(<Inscription />) },
      { path: "/mot-de-passe", element: page(<MotDePasseOublie />) },
      { path: "/mot-de-passe/nouveau", element: page(<NouveauMotDePasse />) },
      { path: "/aide", element: page(<Help />) },
      { path: "/confidentialite", element: page(<Privacy />) },
      { path: "/extension", element: page(<ExtensionPage />) },
      { path: "/open-source", element: page(<OpenSource />) },
      { path: "/conditions", element: page(<Conditions />) },
      { path: "/cgv", element: page(<Cgv />) },
      { path: "/mentions-legales", element: page(<MentionsLegales />) },
      { path: "/remboursement", element: page(<Remboursement />) },
      { path: "/outils", element: page(<OutilsPage />) },
      ...(PREMIUM_PAGE ? [{ path: "/premium", element: page(<Premium />) }] : []),
      ...(CONTROL_CENTER ? [] : legacyAdminRoutes()),
      { path: "*", element: page(<NotFound />) },
    ] }],
  },
  ...(CONTROL_CENTER ? [controlCenterRoute()] : []),
]);
