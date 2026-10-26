// Page d'erreur des routes (errorElement, routes.tsx) — remplace « Unexpected Application Error » de React Router :
// jamais de trace technique pour l'utilisateur. Dans le code principal (jamais chargée à la demande : elle doit
// s'afficher justement quand un fichier manque).
// - Code de page introuvable (onglet ouvert avant un déploiement, coupure réseau) : « Mise à jour d'AETHRYON… », puis
//   un seul rechargement contrôlé à la même adresse dès que le serveur répond (lib/version.ts). Si cela ne suffit
//   pas : « Une nouvelle version d'AETHRYON est disponible. » et « Actualiser ». Sans réseau : on le dit, et on
//   reprend de soi-même au retour du réseau.
// - Toute autre erreur : « Cette page n'a pas pu s'afficher. », « Actualiser » et « Retour à l'accueil ».
// `plein` : hors de la coque du site (la coque elle-même, le Control Center, la page de consentement) ; `compact` :
// dans une coque qui a déjà ses marges (espace personnel, pages du Control Center). Le titre reçoit le focus (lecteurs
// d'écran) sans anneau : ce n'est pas un élément interactif.
import { useEffect, useRef, useState } from "react";
import { useRouteError } from "react-router";
import { cn } from "../lib/cn.ts";
import { isChunkLoadError, recoverFromChunkError, reloadPage } from "../lib/version.ts";
import { Button } from "../ui/Button.tsx";
import { OwlMark } from "../ui/brand/OwlMark.tsx";

type State = "verification" | "nouvelle" | "hors-ligne" | "erreur";

const TEXT: Record<State, { title: string; lead: string }> = {
  verification: { title: "Mise à jour d'AETHRYON…", lead: "Une nouvelle version vient d'être publiée : la page se recharge dans un instant, au même endroit." },
  nouvelle: { title: "Une nouvelle version d'AETHRYON est disponible.", lead: "Actualise la page pour continuer : tu restes au même endroit." },
  "hors-ligne": { title: "Connexion perdue", lead: "Cette page n'a pas pu se charger. Elle reprendra d'elle-même dès le retour du réseau." },
  erreur: { title: "Cette page n'a pas pu s'afficher.", lead: "Actualise la page. Si le problème revient, réessaie dans quelques minutes." },
};

export function RouteError({ plein = false, compact = false }: { plein?: boolean; compact?: boolean }) {
  const error = useRouteError();
  const chunk = isChunkLoadError(error);
  const [state, setState] = useState<State>(chunk ? "verification" : "erreur");
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!chunk) {
      console.error("AETHRYON : erreur d'affichage", error);
      return;
    }
    const ac = new AbortController();
    const run = () => {
      setState("verification");
      void recoverFromChunkError(ac.signal).then((r) => {
        if (ac.signal.aborted || r === "recharge") return;
        setState(r === "hors-ligne" ? "hors-ligne" : "nouvelle");
      });
    };
    run();
    // Retour du réseau : nouvel essai (la garde de lib/version.ts empêche toute boucle).
    window.addEventListener("online", run);
    return () => { ac.abort(); window.removeEventListener("online", run); };
  }, [chunk, error]);

  // Un message qui demande d'agir reçoit le focus (lecteurs d'écran, clavier).
  useEffect(() => { if (state !== "verification") heading.current?.focus(); }, [state]);

  const t = TEXT[state];
  const busy = state === "verification";
  return (
    <div className={cn("route-error", plein && "is-plein", compact && "is-compact")} data-route-error={state}>
      <section className="route-error-card" aria-labelledby="route-error-title" aria-busy={busy || undefined}>
        <span className="route-error-owl" aria-hidden><OwlMark size={34} surface="dark" /></span>
        <h1 id="route-error-title" ref={heading} tabIndex={-1} className="route-error-title">{t.title}</h1>
        <p className="route-error-lead" role={busy ? "status" : undefined}>{t.lead}</p>
        {busy ? (
          <span className="route-error-progress" aria-hidden><span /></span>
        ) : (
          <div className="route-error-actions">
            <Button variant="primary" className="h-12 px-6" onClick={() => reloadPage(true)} data-actualiser="">
              {state === "hors-ligne" ? "Réessayer" : "Actualiser"}
            </Button>
            {state === "erreur" && <a href="/" className="route-error-home">Retour à l'accueil</a>}
          </div>
        )}
      </section>
    </div>
  );
}
