// Les deux offres payantes, UN composant pour la page /premium (cartes obsidienne pleines, avantages compris), pour
// l'accueil et pour l'espace (billets posés dans le panneau Premium de ui/offres/Pricing.tsx, sans les avantages, dits une
// fois au-dessus). Même rang visuel pour les deux : « Premium » 5 € par an (bouton « S'abonner ») et « Premium à vie »
// 20 € une seule fois (bouton « Acheter », masquée par VITE_OFFRE_VIE=0). Textes, prix du catalogue et avantages :
// lib/offres.ts (mêmes valeurs qu'account/src/plans.ts) ; prix réels lus chez Stripe quand la vente est ouverte.
// États d'un bouton :
// - vente fermée (aperçu, production aujourd'hui) : le MÊME bouton, aria-disabled, avec sa raison écrite ; aucun appel
//   au paiement ;
// - vente ouverte : `onChoose` (la page ouvre le récapitulatif légal) ou un lien (sans compte : connexion, puis retour sur
//   /premium avec l'offre présélectionnée ; avec compte : /premium?offre=…) ;
// - offre du compte : « Ton offre actuelle » et « Mon abonnement », jamais un second paiement ;
// - refus du serveur (ventes fermées, offre indisponible, Stripe injoignable) : message dans la carte.
import type { MouseEvent, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { formatEuros, HOW, LIFETIME_LINE, PERIOD, PREMIUM_RENEW_LINE, type FeatureRow, type OfferPlan, type PaidPlanId, type PlanId } from "../../lib/offres.ts";
import { Button, ButtonLink } from "../Button.tsx";
import { IconArrowRight, IconCheck } from "../Icon.tsx";

/** Libellé du bouton d'achat de chaque offre. */
export const BUY_LABEL: Record<PaidPlanId, string> = { annuel: "S'abonner", vie: "Acheter" };
/** La mention de l'aperçu (ventes fermées), dite une fois près des cartes. */
export const APERCU_LINE = "Les paiements ouvrent très bientôt\u00a0: aucun prélèvement n'est possible aujourd'hui.";
/** La ligne sous les cartes quand la vente est ouverte. */
export const SECURE_LINE = "Paiement sécurisé par Stripe. Un code promo\u00a0? Saisis-le sur la page de paiement.";

/** Adresse de /premium avec l'offre présélectionnée ; sans compte, la connexion d'abord, puis retour ici. */
export const premiumTarget = (id: PaidPlanId, signedIn: boolean) => {
  const to = `/premium?offre=${id}`;
  return signedIn ? to : `/connexion?suite=${encodeURIComponent(to)}`;
};

/** Message d'une carte : `blocks` vrai, le bouton est inactif (le serveur refuse) ; sinon, on peut réessayer. */
export interface OfferNote { text: string; blocks: boolean }

export interface OfferCardsProps {
  context: "premium" | "accueil" | "espace";
  /** « carte » : carte obsidienne pleine (page /premium) ; « billet » : posé dans le panneau Premium, sans avantages. */
  look: "carte" | "billet";
  /** Offres payantes proposées, prix réels compris (lib/offres.ts OFFERED_PLANS). */
  plans: readonly OfferPlan[];
  /** Avantages (look « carte ») : lignes de lib/offres.ts où Premium diffère de Gratuit. */
  rows?: readonly FeatureRow[];
  currentPlan: PlanId;
  signedIn: boolean;
  /** Vente ouverte sur ce site (OFFRES=vente et, dans l'espace, facturation ouverte). Faux : aperçu. */
  sale: boolean;
  onChoose?: (id: PaidPlanId) => void;
  selected?: PaidPlanId | null;
  notes?: Partial<Record<PaidPlanId, OfferNote>>;
  /** Identifiant de la mention de l'aperçu (APERCU_LINE), lue par les lecteurs d'écran avec chaque bouton inactif. */
  apercuId?: string;
}

const stop = (e: MouseEvent) => e.preventDefault();

function Price({ plan }: { plan: OfferPlan }) {
  return (
    <p className="tarif-price is-dark offer-price">
      <span className="tarif-amount tabular">{formatEuros(plan.price)}</span>
      <span className="tarif-per">{PERIOD[plan.billing]}</span>
    </p>
  );
}

function Action({ plan, props }: { plan: OfferPlan; props: OfferCardsProps }) {
  const { context, currentPlan, signedIn, sale, onChoose, notes, apercuId } = props;
  const id = plan.id as PaidPlanId;
  const note = notes?.[id];
  const reasonId = `offre-${context}-${id}-raison`;
  const label = BUY_LABEL[id];
  const sr = <span className="sr-only"> — {plan.name}, {formatEuros(plan.price)} {PERIOD[plan.billing]}</span>;
  const own = (text: ReactNode) => (
    <>
      <p className="tarif-current offer-own" data-offre-actuelle={id}><IconCheck size={17} />{text}</p>
      {context !== "espace" && <ButtonLink to="/dashboard/abonnement" variant="night" className="h-12 w-full" data-mon-abonnement="">Mon abonnement</ButtonLink>}
    </>
  );
  if (signedIn && currentPlan === id) return own("Ton offre actuelle");
  if (signedIn && currentPlan === "vie") return own("Compris dans Premium à vie");
  const inert = !sale || !!note?.blocks;
  let button: ReactNode;
  if (inert) {
    // Inactif mais lisible : aria-disabled (le bouton reste atteignable au clavier et dit pourquoi), aucun lien, aucun appel.
    button = (
      <Button variant="light" className="offer-btn h-12 w-full" aria-disabled="true" onClick={stop}
        aria-describedby={[reasonId, !sale && apercuId].filter(Boolean).join(" ")} data-offre-action={id} data-inactif="">
        {label}{sr}
      </Button>
    );
  } else if (onChoose) {
    button = <Button variant="light" className="offer-btn h-12 w-full" trailing={<IconArrowRight size={16} />} onClick={() => onChoose(id)} data-offre-action={id}>{label}{sr}</Button>;
  } else {
    button = <ButtonLink to={premiumTarget(id, signedIn)} variant="light" className="offer-btn h-12 w-full" trailing={<IconArrowRight size={16} />} data-offre-action={id}>{label}{sr}</ButtonLink>;
  }
  return (
    <>
      {button}
      {!sale && <p id={reasonId} className="offer-reason" data-offre-raison="">Pas encore ouvert{"\u00a0"}: aucun paiement possible.</p>}
      {sale && note && <p id={reasonId} role={note.blocks ? "status" : "alert"} className="offer-note" data-offre-message={id}>{note.text}</p>}
    </>
  );
}

export function OfferCards(props: OfferCardsProps) {
  const { context, look, plans, rows = [], currentPlan, signedIn, selected } = props;
  const card = look === "carte";
  return (
    <div className={cn("offer-cards", `is-${look}`, plans.length === 1 && "is-single")} data-offres-cartes={context}>
      {plans.map((p) => {
        const id = p.id as PaidPlanId;
        const current = signedIn && currentPlan === id;
        const chosen = selected === id && !current;
        return (
          <article key={id} className={cn("offer-card", `is-${look}`, current && "is-current", chosen && "is-selected")}
            data-plan={id} data-offre-carte={id} data-selectionnee={chosen ? "" : undefined} aria-labelledby={`offre-${context}-${id}`}>
            <header className="offer-head">
              {card ? <h2 id={`offre-${context}-${id}`} className="offer-name">{p.name}</h2> : <h4 id={`offre-${context}-${id}`} className="offer-name">{p.name}</h4>}
              {current ? <span className="offer-chip">Ton offre</span> : chosen ? <span className="offer-chip">Sélectionnée</span> : null}
            </header>
            <Price plan={p} />
            <div className="offer-how">
              {card
                ? <p>{id === "annuel" ? PREMIUM_RENEW_LINE : HOW.once}</p>
                : <p>{HOW[p.billing]}</p>}
              {card && id === "vie" && <p className="offer-how-note" data-premium-vie="">{LIFETIME_LINE}</p>}
            </div>
            <div className="offer-cta"><Action plan={p} props={props} /></div>
            {card && rows.length > 0 && (
              <ul className="offer-rows" aria-label={`Ce que comprend ${p.name}`} data-premium-avantages="">
                {rows.map((r) => (
                  <li key={r.id} data-ligne={r.id}><IconCheck size={16} className="offer-tick" /><span>{r.label}</span><b>{r.value(p)}</b></li>
                ))}
              </ul>
            )}
          </article>
        );
      })}
    </div>
  );
}
