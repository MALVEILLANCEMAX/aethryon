// Page publique /premium (pré-rendue ; seulement avec les offres affichées : OFFRES=apercu ou vente). Deux cartes de même
// rang (ui/offres/OfferCards.tsx, le composant des offres de l'accueil et de l'espace) : « Premium » 5 € par an
// (« S'abonner ») et « Premium à vie » 20 € une seule fois (« Acheter » ; VITE_OFFRE_VIE=0 la masque). Avantages :
// EXACTEMENT les lignes de lib/offres.ts (mêmes valeurs qu'account/src/plans.ts) où Premium diffère de Gratuit, et
// seulement celles que le serveur applique (export de Tools : visibleRows, /api/config) ; identiques pour les deux.
// - vente (OFFRES=vente) : sans compte, connexion (ou création du compte) puis retour ici, l'offre présélectionnée ;
//   connecté, le récapitulatif légal (ui/offres/Recap.tsx, le même que dans l'espace) puis la page de paiement de Stripe ;
//   offre du compte : « Ton offre actuelle » et « Mon abonnement » ; refus du serveur : message dans la carte.
// - aperçu (production aujourd'hui, ventes fermées) : les mêmes cartes, boutons inactifs avec leur raison, la mention
//   « Les paiements ouvrent très bientôt… » et « Me prévenir de l'ouverture ». AUCUN appel au paiement.
// Direction artistique (docs/DESIGN.md) : ivoire, cartes obsidienne, or rare ; la chouette maître (OwlMark), immobile en
// mouvement réduit ; aucune animation qui part seule.
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { BILLING_URL, type BillingState } from "../lib/facturation.ts";
import { useConfig, useDocumentTitle, useMe } from "../lib/hooks.ts";
import {
  formatEuros, LIFETIME_OFFERED, OFFERED_PLANS, OFFRES_MODE, planById, PREMIUM_TITLE, visibleRows, type OfferPlan, type PaidPlanId, type PlanId,
} from "../lib/offres.ts";
import { useResource } from "../lib/store.ts";
import type { Abonnement as AbonnementInfo } from "../lib/types.ts";
import { IconLock } from "../ui/Icon.tsx";
import { OwlMark } from "../ui/brand/OwlMark.tsx";
import { APERCU_LINE, OfferCards, premiumTarget, SECURE_LINE, type OfferNote } from "../ui/offres/OfferCards.tsx";
import { PricingCommon, PricingCompare, PricingNote, Waitlist } from "../ui/offres/Pricing.tsx";
import { Recap } from "../ui/offres/Recap.tsx";

const NB = " ";
const isPaid = (v: string | null): v is PaidPlanId => v === "annuel" || (v === "vie" && LIFETIME_OFFERED);

export default function Premium() {
  const premium = planById("annuel");
  const life = planById("vie");
  const price = `${formatEuros(premium.price).replace(" €", `${NB}€`)}/an`;
  useDocumentTitle(LIFETIME_OFFERED ? `${PREMIUM_TITLE} — ${price} ou ${formatEuros(life.price).replace(" €", `${NB}€`)} à vie` : `${PREMIUM_TITLE} — ${price}`);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const cfg = useConfig();
  const me = useMe();
  const signedIn = !!me.data && !me.error;
  const vente = OFFRES_MODE === "vente";
  const abo = useResource<AbonnementInfo>(signedIn ? "/api/abonnement" : null, 60_000);
  // Vente ouverte et compte connecté : l'état de la facturation (prix réels, ventes ouvertes, contrats) ; jamais en aperçu.
  const billing = useResource<BillingState>(vente && signedIn && abo.data?.checkout ? BILLING_URL : null, 30_000);
  const b = billing.data ?? null;
  const current: PlanId = signedIn ? b?.offre.id ?? abo.data?.plan.id ?? "free" : "free";

  // Offre choisie (présélectionnée au retour de la connexion : /premium?offre=…) et récapitulatif ouvert.
  const [selected, setSelected] = useState<PaidPlanId | null>(null);
  const [recap, setRecap] = useState(false);
  const [failed, setFailed] = useState<Partial<Record<PaidPlanId, string>>>({});
  useEffect(() => {
    const o = params.get("offre");
    if (!isPaid(o)) return;
    setSelected(o);
    if (vente) setRecap(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Le choix est lu : l'adresse redevient /premium (un rechargement ne rouvre pas le récapitulatif).
  useEffect(() => { if (signedIn && params.get("offre")) setParams({}, { replace: true }); }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = cfg.data?.quotas;
  // Gratuit : valeurs RÉELLES de /api/config quand la page les a (comme les offres).
  const free: OfferPlan = (() => {
    const f = planById("free");
    return q ? { ...f, limits: { ...f.limits, daily: q.daily, maxActive: q.maxActive, exportMinutes: q.exportMinutes ?? f.limits.exportMinutes } } : f;
  })();
  const rows = visibleRows(q).filter((r) => r.value(premium) !== r.value(free));
  // Prix : ceux que Stripe facturera quand le serveur les donne, sinon ceux du catalogue (lib/offres.ts).
  const plans = OFFERED_PLANS.filter((p) => p.id !== "free").map((p) => {
    const real = b?.prix[p.id as PaidPlanId];
    return real ? { ...p, price: real.montant / 100 } : p;
  });

  // Ce que le serveur dit avant tout paiement : chaque refus est écrit dans la carte de l'offre, jamais un écran blanc.
  const notes: Partial<Record<PaidPlanId, OfferNote>> = {};
  for (const p of plans) {
    const id = p.id as PaidPlanId;
    let n: OfferNote | null = null;
    if (vente && signedIn) {
      if (abo.data && !abo.data.checkout) n = { text: "Le paiement n'est pas ouvert sur ce serveur pour le moment : rien ne peut être prélevé.", blocks: true };
      else if (billing.error) n = { text: "Le service de paiement ne répond pas pour le moment. Ton offre actuelle reste valable ; réessaie dans un instant.", blocks: true };
      else if (b && b.vente === false) n = { text: "Les ventes sont fermées pour le moment : aucun paiement n'est possible.", blocks: true };
      else if (b && !b.prix[id]) n = { text: "Cette offre n'est pas disponible pour le moment.", blocks: true };
    }
    if (!n && failed[id]) n = { text: failed[id]!, blocks: false };
    if (n) notes[id] = { ...n, text: n.text.replace(/ ([:;?!])/g, `${NB}$1`) };
  }

  const choose = (id: PaidPlanId) => {
    setFailed((f) => ({ ...f, [id]: undefined }));
    if (!signedIn) { navigate(premiumTarget(id, false)); return; }
    setSelected(id);
    setRecap(true);
  };
  const recapPlan = recap && selected && current !== selected && !(current === "vie") ? selected : null;
  const canRecap = !!(recapPlan && b && b.vente !== false && b.prix[recapPlan] && !notes[recapPlan]?.blocks);

  return (
    <div className="container-site pb-24 pt-28 sm:pt-36" data-page-premium="" data-offres-mode={OFFRES_MODE}>
      <header className="premium-head">
        <OwlMark size={46} blink />
        <h1 className="page-title mt-6" data-premium-titre="">{PREMIUM_TITLE}</h1>
        <p className="premium-lead">
          {LIFETIME_OFFERED
            ? <>Des limites plus larges pour ton compte. Par an, ou une seule fois{NB}: les mêmes avantages.</>
            : <>Des limites plus larges pour ton compte, renouvelées chaque année.</>}
        </p>
      </header>

      {!vente && (
        <div className="premium-apercu" data-premium-apercu="">
          <p id="premium-apercu-raison">{APERCU_LINE}</p>
          <Waitlist signedIn={signedIn} />
        </div>
      )}

      <div className={vente ? "mt-12" : "mt-8"}>
        <OfferCards context="premium" look="carte" plans={plans} rows={rows} currentPlan={current} signedIn={signedIn} sale={vente}
          onChoose={vente && signedIn ? choose : undefined} selected={selected} notes={notes} apercuId={vente ? undefined : "premium-apercu-raison"} />
      </div>
      {vente && <p className="premium-secure" data-premium-stripe=""><IconLock size={15} />{SECURE_LINE}</p>}

      {canRecap && recapPlan && b && (
        <div className="mt-10">
          <Recap plan={recapPlan} billing={b} annualOpen={b.abonnement?.etat === "actif"} onCancel={() => setRecap(false)}
            onError={(m) => setFailed((f) => ({ ...f, [recapPlan]: m }))} />
        </div>
      )}

      <PricingCommon className="mt-14" />
      <PricingCompare className="mt-5" />
      <PricingNote className="mt-5" />
    </div>
  );
}
