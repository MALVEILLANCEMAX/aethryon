import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { MotionConfig } from "motion/react";
import { ToastProvider } from "./ui/Toasts.tsx";
import { VerificationHost } from "./ui/VerificationHost.tsx";
import { installPrefetch, preloadRoute, routes } from "./routes.tsx";
import { captureFold, setStaticBoot } from "./lib/prerender.ts";
import { watchVersion } from "./lib/version.ts";
import "./styles.css";

const container = document.getElementById("root")!;
// Page publique pré-rendue (scripts/prerender.mjs) : son vrai contenu est déjà affiché. L'application le
// REMPLACE en un seul rendu (createRoot vide le conteneur au moment d'insérer la page, sans étape vide).
// Pas hydrateRoot : le HTML statique n'a ni les attributs style (CSP), ni les données de l'API, ni
// l'appareil réel ; il ne peut pas être identique au premier rendu du navigateur.
const prerendered = container.firstElementChild !== null;
// nginx fusionne les barres obliques (//aide sert /aide) : le routeur doit lire la même adresse.
if (location.pathname.includes("//")) {
  history.replaceState(history.state, "", location.pathname.replace(/\/{2,}/g, "/") + location.search + location.hash);
}
const router = createBrowserRouter(routes);
// Anciennes versions (lib/version.ts) : version servie surveillée ; un code de page introuvable est récupéré par
// un seul rechargement contrôlé (RouteError), jamais par une boucle.
watchVersion(router);

/** Le premier rendu est fait : les entrées animées reprennent pour la suite (navigations). */
function StaticBootDone() {
  useEffect(() => setStaticBoot(false), []);
  return null;
}

async function start() {
  if (prerendered) {
    // Mesure sur le HTML statique encore affiché : quels blocs sont sous la ligne de flottaison (révélations).
    captureFold(container);
    setStaticBoot(true);
    // Code de la page chargé AVANT le rendu : sinon Suspense afficherait l'attente à la place du contenu.
    // En cas d'échec, la page passe par Suspense comme une navigation ordinaire (et réessaie le chargement).
    await preloadRoute(location.pathname).catch(() => undefined);
  }
  createRoot(container).render(
    <StrictMode>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
        {/* Vérification de sécurité (anti-bot) : au-dessus de toute page, chargée seulement sur défi du serveur. */}
        <VerificationHost />
      </MotionConfig>
      <StaticBootDone />
    </StrictMode>,
  );
  // Code des autres pages chargé d'avance (au repos, ou au toucher d'un lien) : les navigations s'affichent sans attente.
  installPrefetch();
}

void start();
