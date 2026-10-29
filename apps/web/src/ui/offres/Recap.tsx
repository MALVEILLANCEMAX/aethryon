// Récapitulatif légal avant le paiement (Code de la consommation, docs/FACTURATION.md §7) : ce que tu paies, ce que tu
// reçois, quand, comment arrêter ; demande expresse de démarrage immédiat (L221-25) et acceptation des CGV (version
// enregistrée), puis « Commander avec obligation de paiement » (L221-14) → page de paiement de Stripe. Le MÊME pour la page
// /premium (app/Premium.tsx) et pour Espace › Mon abonnement (app/Abonnement.tsx). Prix : ceux que Stripe facturera, lus par
// le serveur (/api/facturation), jamais ceux du navigateur.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../lib/api.ts";
import { startCheckout, money, type BillingState } from "../../lib/facturation.ts";
import { useCalm } from "../../lib/hooks.ts";
import { CGV_VERSION, LEGAL_PUBLISHED } from "../../lib/legal.tsx";
import { LIFETIME_LINE, PAY_LINE, planById, VAT_NOTE, type PaidPlanId } from "../../lib/offres.ts";
import { Button } from "../Button.tsx";
import { useToast } from "../Toasts.tsx";

const NB = " ";
const link = "text-gold-text underline decoration-gold/50 underline-offset-4 hover:decoration-gold-text";

/** Message d'une erreur du serveur (déjà en français), sinon un message générique. */
export const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Une erreur est survenue. Réessaie dans un instant.");

/** `onError` : l'erreur du serveur (ventes fermées, offre indisponible, Stripe injoignable…) est aussi rendue à la page,
 *  qui l'affiche dans la carte de l'offre. */
export function Recap({ plan, billing, annualOpen, onCancel, onError }: {
  plan: PaidPlanId; billing: BillingState; annualOpen: boolean; onCancel: () => void; onError?: (message: string) => void;
}) {
  const toast = useToast();
  const calm = useCalm();
  const [consent, setConsent] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const p = planById(plan);
  const price = billing.prix[plan];
  const life = plan === "vie";
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" });
    ref.current?.focus({ preventScroll: true });
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  const pay = async () => {
    setBusy(true);
    try {
      window.location.assign(await startCheckout(plan, consent, terms ? CGV_VERSION : null));
    } catch (e) {
      toast.show("error", "Le paiement n'a pas pu commencer", errText(e));
      onError?.(errText(e));
      setBusy(false);
    }
  };
  const rights = `${p.limits.daily} conversions par jour (jusqu'à ${p.limits.monthly?.toLocaleString("fr-FR")} sur 30 jours), ${p.limits.exportMinutes}${NB}min d'export Tools par jour, ${p.limits.maxActive} à la fois, sur le web, Tools, l'extension et l'iPhone${NB}; dans Discord, les limites de Gratuit.`;
  return (
    <section ref={ref} tabIndex={-1} className="abo-recap" aria-labelledby="abo-recap-titre" data-recap={plan}>
      <h2 id="abo-recap-titre" className="font-display text-titre-m">Récapitulatif{NB}: AETHRYON {p.name}</h2>
      <dl className="abo-recap-list">
        <div><dt>Prix</dt><dd>{price ? <><b>{money(price.montant, price.devise)}</b> {life ? "une seule fois" : "par an"}, {VAT_NOTE === "Prix TTC" ? "TTC" : VAT_NOTE}</> : "Offre indisponible pour le moment"}</dd></div>
        <div><dt>Ce que tu reçois</dt><dd>{rights}</dd></div>
        {billing.codesPromo && <div data-recap-promo=""><dt>Code promo</dt><dd>{life
          ? <>À saisir sur la page de paiement de Stripe{NB}: le montant à payer, remise comprise, y est affiché avant validation.</>
          : <>À saisir sur la page de paiement de Stripe{NB}: la remise vaut pour le premier paiement{NB}; chaque renouvellement est au prix ci-dessus.</>}</dd></div>}
        {life ? (
          <>
            <div><dt>Paiement</dt><dd>Une seule fois, aujourd'hui, par carte bancaire sur une page sécurisée de Stripe. Aucun abonnement, aucun renouvellement.</dd></div>
            <div><dt>«{NB}Premium à vie{NB}»</dt><dd>{LIFETIME_LINE}</dd></div>
            {annualOpen && <div><dt>Ton abonnement Premium</dt><dd>Il ne sera pas renouvelé{NB}; sa période en cours n'est pas remboursée.</dd></div>}
            <div><dt>Rétractation</dt><dd>14 jours pour renoncer, depuis ton espace{NB}: remboursement intégral.</dd></div>
          </>
        ) : (
          <>
            <div><dt>Prélèvement</dt><dd>Aujourd'hui, puis chaque année à la même date, par carte bancaire (page sécurisée de Stripe). Rappel par e-mail un à trois mois avant chaque renouvellement.</dd></div>
            <div><dt>Résiliation</dt><dd>En ligne, à tout moment, depuis ton espace (Mon abonnement){NB}: l'offre reste active jusqu'à la fin de l'année payée.</dd></div>
            <div><dt>Rétractation</dt><dd>14 jours pour renoncer, depuis ton espace{NB}: remboursement intégral.</dd></div>
          </>
        )}
        <div><dt>Qui peut acheter</dt><dd>Les résidents de France métropolitaine{NB}: l'adresse de facturation est demandée et vérifiée. Une commande facturée hors de France est annulée et remboursée.</dd></div>
      </dl>
      {/* Demande expresse (L221-25), le même texte pour les deux offres (CONSENT_TEXT_VERSION v3 côté serveur). */}
      <label className="abo-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-consentement="" />
        <span>Je demande que mon accès Premium commence dès maintenant, avant la fin de mon délai de rétractation de 14{NB}jours. Je reconnais qu'une fois le contrat entièrement exécuté, je ne pourrai plus me rétracter.</span>
      </label>
      {/* Acceptation des CGV : version enregistrée avec la commande ; le texte s'ouvre à côté, le récapitulatif reste. */}
      <label className="abo-consent">
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} data-cgv="" />
        <span>J'ai lu et j'accepte les{" "}
          <a href="/cgv" target="_blank" rel="noopener" className={link}>conditions générales de vente</a> (version {CGV_VERSION}) et la{" "}
          <a href="/remboursement" target="_blank" rel="noopener" className={link}>politique de remboursement</a>.</span>
      </label>
      <p className="text-note text-muted">
        {PAY_LINE} Ta carte n'est jamais vue par AETHRYON.{" "}
        {LEGAL_PUBLISHED ? <><Link to="/conditions" className={link}>Conditions d'utilisation</Link>{NB}· <Link to="/mentions-legales" className={link}>Mentions légales</Link>{NB}· </> : null}
        <Link to="/confidentialite" className={link}>Confidentialité</Link>.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" className="h-12" disabled={!consent || !terms || !price} loading={busy} onClick={() => void pay()} data-commander="">Commander avec obligation de paiement</Button>
        <Button variant="ghost" className="h-12" onClick={onCancel}>Annuler</Button>
      </div>
    </section>
  );
}
