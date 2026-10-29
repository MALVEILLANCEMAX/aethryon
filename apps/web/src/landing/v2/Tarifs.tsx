// Section « Tarifs » de l'accueil (2026-10-29) : la seule offre réelle, dite en un mot (« Gratuit », pas « 0 € » : demande
// du propriétaire), le sceau de la chouette à côté, ce qu'elle comprend (valeurs réelles de /api/config et des offres), et
// UNE action. Premium n'a ici qu'une ligne : tant que la vente est fermée (OFFRES=apercu), ni prix ni bouton d'achat sur
// l'accueil ; ses prix et ses conditions restent sur /premium, là où l'on décide. OFFRES=vente : la même ligne mène aux
// offres. OFFRES=reelles : l'offre gratuite seule. Textes : français, anglais ou espagnol.
import { Link } from "react-router";
import { useConfig, useMe } from "../../lib/hooks.ts";
import { OFFRES_MODE, planById, PREMIUM_PAGE } from "../../lib/offres.ts";
import { useT } from "../../i18n/accueil.ts";
import { Medaille } from "../../ui/egide/Egide.tsx";

export function Tarifs() {
  const cfg = useConfig();
  const me = useMe();
  const t = useT();
  const connecte = !!me.data && !me.error;
  const q = cfg.data?.quotas;
  const gratuit = planById("free");
  const quotidien = q?.daily ?? gratuit.limits.daily;
  const parallele = q?.maxActive ?? gratuit.limits.maxActive;
  return (
    <section id="tarifs" aria-labelledby="tarifs-title" className="at-section px" data-offres-mode={OFFRES_MODE}>
      <div className="px-texte">
        <h2 id="tarifs-title" className="at-h2">{t.tarifsTitre}</h2>
        <p className="px-lead">{t.tarifsLead}</p>
        {PREMIUM_PAGE && (
          <p className="px-premium" data-premium-ligne="">
            {OFFRES_MODE === "vente"
              ? <>{t.premiumLigneVente} <Link to="/premium">{t.voirOffresPremium}</Link></>
              : <>{t.premiumLigneApercu} <Link to="/premium">{t.enSavoirPlus}</Link></>}
          </p>
        )}
      </div>
      <div className="px-offre" data-plan="free">
        <p className="px-chiffre"><span className="px-mot">{t.gratuit}</span><span className="eg-vh">{t.gratuitSr}</span></p>
        <Medaille taille={72} sceau className="px-sceau" />
        <ul className="px-inclus">
          <li data-ligne="conversions"><b className="tabular">{quotidien}</b>{t.inclusConversions(quotidien).slice(String(quotidien).length)}</li>
          <li data-ligne="parallel"><b className="tabular">{parallele}</b>{t.inclusParallele(parallele).slice(String(parallele).length)}</li>
          <li data-ligne="history">{t.inclusHistorique(gratuit.limits.historyDays)}</li>
          <li>{t.inclusPartout}</li>
        </ul>
        <Link to={connecte ? "/dashboard" : "/commencer"} className="ac-bouton" data-tarif-action="">{connecte ? t.ouvrirMonEspace : t.creerMonCompte}</Link>
      </div>
    </section>
  );
}
