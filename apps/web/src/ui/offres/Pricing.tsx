// Offres V2, UNE composition pour l'accueil (landing/v2/Tarifs.tsx) et l'espace (app/Abonnement.tsx) :
// Gratuit à gauche, sur ivoire ; à droite, UN panneau obsidienne « Premium » : ses limites dites une fois, puis les deux
// billets de même rang (ui/offres/OfferCards.tsx, le composant de la page /premium) : Premium (5 € par an, renouvelé,
// « S'abonner ») et Premium à vie (20 € une seule fois, « Acheter » ; VITE_OFFRE_VIE). Ventes fermées : les mêmes boutons,
// inactifs, avec leur raison, et « Me prévenir ». Ni série de cartes, ni
// sélecteur de période, ni lumière ou animation décorative : les prix en grand, la façon de payer en clair, ce que
// « à vie » veut dire AVANT tout achat. Comparatif détaillé replié dessous. Valeurs : lib/offres.ts (Gratuit : quota et
// simultanéité RÉELS de /api/config ; payantes : prix réels lus chez Stripe quand la vente est ouverte).
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { useConfig, useMe } from "../../lib/hooks.ts";
import { DISCORD_LINE, EVERYWHERE_LINE, exportLimitApplies, formatEuros, HOW, LIFETIME_LINE, LIFETIME_OFFERED, OFFERED_PLANS, OFFRES_MODE, PAY_LINE, PERIOD, VAT_NOTE, visibleRows, type FeatureRow, type OfferPlan, type PaidPlanId, type PlanId } from "../../lib/offres.ts";
import { invalidate, useResource } from "../../lib/store.ts";
import type { Abonnement } from "../../lib/types.ts";
import { Button, ButtonLink } from "../Button.tsx";
import { IconArrowRight, IconBell, IconCheck, IconLock } from "../Icon.tsx";
import { APERCU_LINE, OfferCards, SECURE_LINE } from "./OfferCards.tsx";
import { useToast } from "../Toasts.tsx";

/** « Me prévenir » (une demande par compte : les offres Premium ouvrent ensemble) ; sans compte, la connexion d'abord. */
export function Waitlist({ signedIn }: { signedIn: boolean }) {
  const r = useResource<Abonnement>(signedIn ? "/api/abonnement" : null, 30_000);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!signedIn) {
    return <ButtonLink to="/connexion?suite=%2Fdashboard%2Fabonnement" variant="light" className="h-12" icon={<IconBell size={17} />} data-prevenir="">Me prévenir de l'ouverture</ButtonLink>;
  }
  const on = !!r.data?.prevenir;
  const toggle = async () => {
    setBusy(true);
    try {
      await api("/api/abonnement/prevenir", { method: "POST", body: { actif: !on } });
      invalidate("/api/abonnement");
      toast.show("success", on ? "Alerte retirée" : "C'est noté", on ? undefined : "Un seul e-mail, le jour où Premium ouvrira.");
    } catch {
      toast.show("error", "Le réglage n'a pas été enregistré", "Réessaie dans un instant.");
    } finally { setBusy(false); }
  };
  return (
    <Button variant={on ? "night" : "light"} className="h-12" aria-pressed={on} loading={busy} disabled={!r.data}
      icon={on ? <IconCheck size={17} /> : <IconBell size={17} />} onClick={() => void toggle()} data-prevenir="" data-actif={on ? "" : undefined}>
      {on ? "Tu seras prévenu" : "Me prévenir de l'ouverture"}
    </Button>
  );
}

/** Prix : le montant en grand (chiffres de la police d'affichage), la période dessous ; lu d'un trait. */
function Price({ plan, dark }: { plan: OfferPlan; dark?: boolean }) {
  const amount = formatEuros(plan.price);
  return (
    <p className={cn("tarif-price", dark && "is-dark")}>
      <span className="tarif-amount tabular">{amount}</span>
      <span className="tarif-per">{PERIOD[plan.billing]}</span>
    </p>
  );
}

/** Trois lignes par billet : les premières lignes « carte » que le serveur applique (sans limite d'export appliquée,
 *  l'historique prend sa place). */
function Limits({ plan, dark, rows }: { plan: OfferPlan; dark?: boolean; rows: readonly FeatureRow[] }) {
  return (
    <ul className={cn("tarif-limits", dark && "is-dark")} aria-label={`Limites de ${plan.billing === "none" ? plan.name : "Premium"}`}>
      {rows.filter((r) => r.card).slice(0, 3).map((r) => (
        <li key={r.id} data-ligne={r.id}><span>{r.label}</span><b>{r.value(plan)}</b></li>
      ))}
    </ul>
  );
}

type Choose = (p: PaidPlanId) => void;

/** Les offres (toutes, ou Gratuit seule avec `only`). `currentPlan` : l'offre du compte connecté ; `prices` : prix RÉELS
 *  lus chez Stripe (centimes TTC), qui remplacent ceux du catalogue ; `onChoose` : vente ouverte dans l'espace. */
export function PricingPlans({ context, only, currentPlan = "free", prices, onChoose }: {
  context: "accueil" | "espace"; only?: PlanId[]; currentPlan?: PlanId;
  prices?: Partial<Record<PaidPlanId, number | null>>; onChoose?: Choose;
}) {
  const cfg = useConfig();
  const me = useMe();
  const signedIn = !!me.data && !me.error;
  const q = cfg.data?.quotas;
  // Vente ouverte : dans l'espace, seulement si la facturation l'est (onChoose) ; ailleurs, OFFRES=vente.
  const sale = context === "espace" ? !!onChoose : OFFRES_MODE === "vente";
  // Accueil : l'offre du compte connecté (« Ton offre actuelle » au lieu d'un second achat) ; l'espace la donne.
  const abo = useResource<Abonnement>(signedIn && context === "accueil" ? "/api/abonnement" : null, 60_000);
  const accountPlan: PlanId = context === "accueil" ? abo.data?.plan.id ?? "free" : currentPlan;
  const plans = OFFERED_PLANS.filter((p) => !only || only.includes(p.id))
    .map((p) => (p.id === "free" && q ? { ...p, limits: { ...p.limits, daily: q.daily, maxActive: q.maxActive, exportMinutes: q.exportMinutes ?? p.limits.exportMinutes } } : p))
    .map((p) => (p.id !== "free" && typeof prices?.[p.id as PaidPlanId] === "number" ? { ...p, price: prices[p.id as PaidPlanId]! / 100 } : p));
  const rows = visibleRows(q);
  const free = plans.find((p) => p.id === "free");
  const paid = plans.filter((p) => p.id !== "free");
  const isCurrent = (p: OfferPlan) => signedIn && p.id === accountPlan;
  return (
    <div className={cn("tarif", !paid.length && "is-single")} data-offres={context}>
      {free && (
        <article className={cn("tarif-free", isCurrent(free) && "is-current")} data-plan="free" aria-labelledby={`tarif-${context}-free`}>
          <header className="tarif-head">
            <h3 id={`tarif-${context}-free`} className="tarif-name">{free.name}</h3>
            {isCurrent(free) && <span className="tarif-chip">Ton offre</span>}
          </header>
          <Price plan={free} />
          <p className="tarif-how">{HOW.none}</p>
          <Limits plan={free} rows={rows} />
          <div className="tarif-cta">
            {isCurrent(free) ? null
              : context === "espace" ? <ButtonLink to="/dashboard/abonnement" variant="secondary" className="h-12 w-full">Voir mon offre</ButtonLink>
              : <ButtonLink to={signedIn ? "/dashboard" : "/commencer"} variant="primary" className="h-12 w-full" trailing={<IconArrowRight size={16} />} data-cta="free">
                  {signedIn ? "Ouvrir mon espace" : "Créer mon compte gratuit"}
                </ButtonLink>}
          </div>
        </article>
      )}
      {paid.length > 0 && (
        <section className="tarif-paid" aria-labelledby={`tarif-${context}-payantes`} data-plan="payantes">
          <header className="tarif-paid-head">
            <h3 id={`tarif-${context}-payantes`} className="tarif-name is-dark">Premium</h3>
            {!sale && <span className="tarif-chip is-soon">Bientôt</span>}
          </header>
          <p className="tarif-paid-lead">{paid.length > 1 ? "Les mêmes limites. Par an, ou une seule fois." : "Des limites plus larges, renouvelées chaque année."}</p>
          <Limits plan={paid[0]!} dark rows={rows} />
          <OfferCards context={context} look="billet" plans={paid} currentPlan={signedIn ? accountPlan : "free"} signedIn={signedIn}
            sale={sale} onChoose={onChoose} apercuId={sale ? undefined : `tarif-${context}-apercu`} />
          {paid.some((p) => p.id === "vie") && <p className="tarif-life">{LIFETIME_LINE}</p>}
          {!sale && (
            <div className="tarif-wait">
              <p id={`tarif-${context}-apercu`} className="tarif-apercu" data-offres-apercu="">{APERCU_LINE}</p>
              <Waitlist signedIn={signedIn} />
            </div>
          )}
          {sale && <p className="tarif-secure" data-offres-stripe=""><IconLock size={15} />{SECURE_LINE}</p>}
        </section>
      )}
    </div>
  );
}

/** Note sous les offres : en aperçu, rien n'est en vente ; en vente, comment on paie, résilie, renonce. */
export function PricingNote({ className, vente = OFFRES_MODE === "vente" }: { className?: string; vente?: boolean }) {
  return (
    <p className={cn("offers-note", className)} data-offres-note="">
      {vente
        ? <>{VAT_NOTE}. Premium{" "}: prélevé le jour de la souscription puis chaque année à la même date, résiliable en ligne, actif jusqu'à la fin de l'année payée.{LIFETIME_OFFERED ? <> Premium à vie{" "}: payé une fois.</> : null} Rétractation possible pendant 14{" "}jours, remboursement intégral. {PAY_LINE}{" "}
          <Link to="/cgv" className="underline decoration-gold/50 underline-offset-4">Conditions générales de vente</Link>.</>
        : <>Prix TTC fixés pour l'ouverture. Aucun paiement n'est possible aujourd'hui{" "}: «{" "}Me prévenir{" "}» enregistre seulement ton souhait.</>}
    </p>
  );
}

/** Ce que toutes les offres partagent, et la règle de Discord : dits UNE fois, sous les offres. */
export function PricingCommon({ className }: { className?: string }) {
  return (
    <div className={cn("offers-common", className)} data-offres-communes="">
      <p>{EVERYWHERE_LINE}</p>
      <p className="offers-common-note">{DISCORD_LINE}</p>
    </div>
  );
}

/** Comparatif détaillé, discret : replié sous les offres, une ligne par critère, une colonne par offre. */
export function PricingCompare({ className }: { className?: string }) {
  const cfg = useConfig();
  const q = cfg.data?.quotas;
  const plans = OFFERED_PLANS.map((p) => (p.id === "free" && q ? { ...p, limits: { ...p.limits, daily: q.daily, maxActive: q.maxActive, exportMinutes: q.exportMinutes ?? p.limits.exportMinutes } } : p));
  const rows = visibleRows(q);
  return (
    <details className={cn("fold offers-compare", className)} data-comparatif="">
      <summary>Comparer les offres en détail</summary>
      <div className="fold-body overflow-x-auto">
        <table className="compare-table">
          <caption className="sr-only">Comparatif des offres {plans.map((p) => p.name).join(", ")}</caption>
          <thead><tr><th scope="col"><span className="sr-only">Critère</span></th>{plans.map((p) => <th key={p.id} scope="col">{p.name}</th>)}</tr></thead>
          <tbody>
            <tr><th scope="row">Prix</th>{plans.map((p) => <td key={p.id}>{p.price ? `${formatEuros(p.price)} ${PERIOD[p.billing]}` : "Gratuit"}</td>)}</tr>
            <tr><th scope="row">Renouvellement</th>{plans.map((p) => <td key={p.id}>{p.billing === "year" ? "automatique, chaque année" : p.billing === "once" ? "aucun" : "—"}</td>)}</tr>
            <tr><th scope="row">Résiliation</th>{plans.map((p) => <td key={p.id}>{p.billing === "year" ? "en ligne, à tout moment" : "—"}</td>)}</tr>
            {rows.map((row) => <tr key={row.id}><th scope="row">{row.label}</th>{plans.map((p) => <td key={p.id}>{row.value(p)}</td>)}</tr>)}
            <tr><th scope="row">Dans Discord</th>{plans.map((p) => <td key={p.id}>Limites de Gratuit</td>)}</tr>
          </tbody>
        </table>
        {exportLimitApplies(q) && <p className="mt-3 text-[13px] text-muted">Minutes d'export pondérées par le coût réel{" "}: 4K ×3,5, 720p et moins ×0,65, GIF ×0,55{" "}; le son ne compte pas.</p>}
      </div>
    </details>
  );
}
