// Rendu statique des pages publiques, À LA CONSTRUCTION (vite build --ssr, puis scripts/prerender.mjs) :
// mêmes routes et mêmes composants que dans le navigateur, avec le routeur statique de react-router. Les
// données de l'API (/api/config, /api/me…) ne sont PAS lues : chaque composant rend son état d'attente,
// exactement comme le navigateur avant la réponse du serveur (« … », phrase générale ; jamais de chiffre
// inventé). Aucun script n'est produit (hydrate={false}) : la CSP du site reste intacte.
import { StrictMode } from "react";
import { prerenderToNodeStream } from "react-dom/static";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { MotionConfig } from "motion/react";
import { preloadRoute, routes } from "./routes.tsx";
import { ToastProvider } from "./ui/Toasts.tsx";
import { PrerenderContext, type PrerenderInfo } from "./lib/prerender.ts";
import { DEFAULT_SOLUTION, SOLUTION_IDS } from "./lib/solutions.ts";
import { LEGAL_PUBLISHED } from "./lib/legal.tsx";
import { toText } from "./legal/doc.tsx";
import { CGV_BLOCKS } from "./app/Cgv.tsx";
import { PREMIUM_PAGE } from "./lib/offres.ts";

export { routes, DEFAULT_SOLUTION };

/** Pages publiques pré-rendues (dist/index.html, dist/aide/index.html…), servies telles quelles par nginx
 *  (une `location = <chemin>` chacune) et seules adresses du plan du site (sitemap.xml). Toute autre route
 *  est une route de l'application : coque neutre (dist/app.html). */
export const PUBLIC_PAGES = ["/", "/aide", "/installer", "/confidentialite", "/connexion", "/commencer", "/extension", "/conditions", "/outils", "/cgv", "/mentions-legales", "/remboursement",
  // AETHRYON Premium : seulement quand les offres payantes sont montrées (OFFRES=apercu ou vente).
  ...(PREMIUM_PAGE ? ["/premium"] : [])] as const;

/** Versions texte des pages juridiques, écrites dans dist/ (scripts/prerender.mjs) : les CGV en texte, jointes par le
 *  serveur à la confirmation de chaque commande (account/src/facturation.ts, termsAttachment). Seulement quand les
 *  informations légales sont publiées (sinon aucun fichier : rien d'incomplet ne part chez un client). */
export function legalTexts(origin: string): Record<string, string> {
  return LEGAL_PUBLISHED ? { "legal/cgv.txt": toText(CGV_BLOCKS, origin) } : {};
}

/** Liens directs vers une solution (/?solution=extension#solutions) : l'accueil pré-rendu avec cette surface
 *  marquée (dist/accueil-solution-<id>.html), que nginx sert selon le paramètre (map $arg_solution, même
 *  règle que l'application : valeur exacte, sensible à la casse ; sinon l'accueil). Lien canonique : /. */
export const HOME_VARIANTS = SOLUTION_IDS.filter((id) => id !== DEFAULT_SOLUTION)
  .map((id) => ({ id, path: `/?solution=${id}`, file: `accueil-solution-${id}.html` }));

/** Une adresse qu'aucune route ne connaît : la page 404 de l'application (dist/404.html). */
export const NOT_FOUND_PATH = "/__page-introuvable__";

export interface StaticPage {
  /** Contenu de <div id="root"> (attributs style compris : scripts/prerender.mjs les retire, CSP). */
  html: string;
  /** Titre posé par la page (useDocumentTitle). */
  title: string;
}

export async function render(path: string, origin: string): Promise<StaticPage> {
  await preloadRoute(path); // code des pages chargé d'avance : rendu direct, sans Suspense
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(new URL(path, origin)));
  if (context instanceof Response) throw new Error(`${path} : redirection ${context.status} inattendue au pré-rendu`);
  const router = createStaticRouter(handler.dataRoutes, context);
  const info: PrerenderInfo = { origin };
  const errors: unknown[] = [];
  const { prelude } = await prerenderToNodeStream(
    <StrictMode>
      <PrerenderContext.Provider value={info}>
        <MotionConfig reducedMotion="user">
          <ToastProvider>
            <StaticRouterProvider router={router} context={context} hydrate={false} />
          </ToastProvider>
        </MotionConfig>
      </PrerenderContext.Provider>
    </StrictMode>,
    {
      onError: (e) => { errors.push(e); },
      // Jamais de Suspense « détaché » : au-delà de cette taille, React écrirait le contenu à part avec un
      // <script> qui le met en place (interdit par la CSP, et rien ne doit dépendre de JavaScript ici).
      progressiveChunkSize: Number.POSITIVE_INFINITY,
    },
  );
  const chunks: Buffer[] = []; // décodés en une fois : un caractère accentué peut tomber entre deux morceaux
  for await (const chunk of prelude) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  const html = Buffer.concat(chunks).toString("utf8");
  if (errors.length) throw new Error(`${path} : erreur de rendu\n${errors.map((e) => (e instanceof Error ? e.stack : String(e))).join("\n")}`);
  if (!info.title) throw new Error(`${path} : aucun titre (useDocumentTitle) n'a été posé par la page`);
  return { html, title: info.title };
}
