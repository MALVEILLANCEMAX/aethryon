// Espace › Mon abonnement, modèle V2 (docs/FACTURATION.md) : l'offre RÉELLE du compte (Gratuit, Premium — identifiant
// « annuel » — ou Premium à vie — « vie »), ses détails (prix et période, état, prochain prélèvement ou fin), son usage
// du jour (conversions, minutes d'export de Tools) et, selon le serveur (/api/abonnement dit si la facturation existe ;
// /api/facturation n'est lu qu'alors) :
// - facturation fermée (production aujourd'hui) : les offres en aperçu, « Me prévenir » (enregistré sur le compte) ;
// - Gratuit, facturation ouverte : les offres et le récapitulatif obligatoire avant le paiement ;
// - Premium : actif, résiliation programmée, impayé (délai de grâce) ou résilié ; « Gérer mon abonnement » (accueil du
//   portail client de Stripe), « Résilier votre contrat », « Reprendre l'abonnement », passer à Premium à vie ;
// - Premium à vie : actif, aucun renouvellement, droits compris, historique des achats.
// L'offre affichée vient des droits du compte (account) : la page reste juste même si Stripe ne répond pas.
// Obligations tenues ici (Code de la consommation, docs/FACTURATION.md §7) : récapitulatif puis bouton « Commander avec
// obligation de paiement » (L221-14), moyens de paiement et restriction à la France dits avant ; demande expresse de
// démarrage immédiat avec la reconnaissance de L221-25 et acceptation des CGV (version enregistrée) ; « Résilier votre contrat »
// avec récapitulatif et « Notifier la résiliation » (D215-1 à D215-3) ; « Renoncer au contrat ici » pendant 14 jours,
// puis « Confirmer la rétractation » (D221-5). Accusés de réception par e-mail, depuis le serveur.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { motion } from "motion/react";
import { useCalm, useConfig, useDocumentTitle, useMe } from "../lib/hooks.ts";
import { quotaView } from "../lib/onboarding.ts";
import { formatEuros, HOW, LIFETIME_LINE, LIFETIME_OFFERED, OFFRES_MODE, PERIOD, planById, type OfferPlan, type PaidPlanId } from "../lib/offres.ts";
import { useResource } from "../lib/store.ts";
import type { Abonnement as AbonnementInfo } from "../lib/types.ts";
import { BILLING_URL, confirmReturn, dayLong, money, openPortal, resume, terminate, withdraw, type BillingState, type Facture } from "../lib/facturation.ts";
import { OwlMark } from "../ui/brand/OwlMark.tsx";
import { PricingCommon, PricingCompare, PricingNote, PricingPlans } from "../ui/offres/Pricing.tsx";
import { errText, Recap } from "../ui/offres/Recap.tsx";
import { RollingText } from "../ui/RollingText.tsx";
import { Skeleton } from "../ui/bits.tsx";
import { Alert } from "../ui/Alert.tsx";
import { Button } from "../ui/Button.tsx";
import { useToast } from "../ui/Toasts.tsx";
import { RetroObject } from "../ui/retro/RetroObject.tsx";
import { PageHeader } from "./common.tsx";

const NB = " ";
const link = "text-gold-text underline decoration-gold/50 underline-offset-4 hover:decoration-gold-text";

/** Anneau du quota du jour : la part déjà utilisée, tracée une fois (ressort doux) ; chiffre au centre. */
function QuotaRing({ used, limit }: { used: number; limit: number | null }) {
  const calm = useCalm();
  const share = limit ? Math.min(1, used / limit) : 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="abo-ring" role="img" aria-label={limit ? `${used} conversion${used > 1 ? "s" : ""} sur ${limit} aujourd'hui` : `${used} conversions aujourd'hui, sans limite`}>
      <svg viewBox="0 0 120 120" width="148" height="148" aria-hidden="true">
        <circle cx="60" cy="60" r={r} className="abo-ring-track" />
        <motion.circle cx="60" cy="60" r={r} className="abo-ring-fill" strokeDasharray={c} transform="rotate(-90 60 60)"
          initial={calm ? false : { strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - share) }}
          transition={{ type: "spring", stiffness: 90, damping: 22, delay: 0.15 }} />
      </svg>
      <span className="abo-ring-value" aria-hidden="true">
        <RollingText value={String(used)} className="abo-ring-used" />
        <span className="abo-ring-limit">{limit ? `sur ${limit}` : "illimité"}</span>
      </span>
    </div>
  );
}

const fmt1 = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

/** Ligne d'état sous le nom de l'offre : ce qui se passe, et quand. */
function statusLine(b: BillingState | null, planId: string, beta: boolean): string {
  if (b?.suspendu === "litige" || b?.vie?.etat === "suspendu") return "Accès payant suspendu : contestation bancaire en cours";
  if (planId === "vie" && b?.vie) return `Actif${NB}· sans renouvellement${NB}· acheté le ${dayLong(b.vie.achete)}`;
  if (planId === "vie") return `Actif${NB}· sans renouvellement`;
  const a = b?.abonnement;
  if (!a || a.etat === "termine") return beta ? `Ton offre actuelle${NB}· gratuite pendant la bêta` : "Ton offre actuelle";
  const prix = b?.prix.annuel ? `${money(b.prix.annuel.montant, b.prix.annuel.devise)} par an` : null;
  if (a.etat === "en_attente") return "Paiement en cours de confirmation";
  if (a.etat === "impaye") return `Paiement refusé${NB}· accès jusqu'au ${dayLong(a.fin)}`;
  if (a.etat === "resilie") return `Résilié${NB}· actif jusqu'au ${dayLong(a.fin)}`;
  return `Renouvellement le ${dayLong(a.renouvellement)}${prix ? `${NB}· ${prix}` : ""}`;
}

/** Détails du contrat, lus d'un trait : offre, prix et période, état, prochaine date (prélèvement, ou fin de l'accès). */
function contractDetails(b: BillingState | null, planId: string, plan: OfferPlan): [key: string, label: string, value: string, etat?: string][] {
  const rows: [string, string, string, string?][] = [["offre", "Offre", plan.name]];
  const a = b?.abonnement ?? null;
  if (b?.suspendu === "litige" || b?.vie?.etat === "suspendu") {
    rows.push(["etat", "État", "Suspendu : contestation bancaire en cours", "suspendu"]);
    return rows;
  }
  if (planId === "vie") {
    rows.push(["prix", "Prix", b?.vie ? `${money(b.vie.montant, b.vie.devise)} payés une fois` : `${formatEuros(plan.price)} ${PERIOD.once}`]);
    rows.push(["etat", "État", "Actif, sans renouvellement", "actif"]);
    if (b?.vie) rows.push(["date", "Acheté le", dayLong(b.vie.achete)]);
    return rows;
  }
  const yearly = b?.prix.annuel ? `${money(b.prix.annuel.montant, b.prix.annuel.devise)} par an` : `${formatEuros(planById("annuel").price)} ${PERIOD.year}`;
  if (a && a.etat !== "termine") {
    rows.push(["prix", "Prix", yearly]);
    if (a.etat === "actif") rows.push(["etat", "État", "Actif", "actif"], ["date", "Prochain prélèvement", dayLong(a.renouvellement)]);
    else if (a.etat === "resilie") rows.push(["etat", "État", a.arretParVie ? "Renouvellement arrêté (Premium à vie)" : "Résiliation programmée", "programmee"], ["date", "Fin de l'accès", dayLong(a.fin)]);
    else if (a.etat === "impaye") rows.push(["etat", "État", "Impayé : délai de grâce pendant les nouvelles tentatives de paiement", "impaye"], ["date", "Accès jusqu'au", dayLong(a.fin)]);
    else rows.push(["etat", "État", "Paiement en cours de confirmation", "attente"]);
    return rows;
  }
  rows.push(["prix", "Prix", `${formatEuros(0)} ${PERIOD.none}`]);
  if (a?.etat === "termine") rows.push(["etat", "État", "Premium résilié : ton compte est sur l'offre Gratuite", "resilie"]);
  return rows;
}

/** Formulaire légal : récapitulatif (nom, e-mail, contrat, effet) puis bouton de confirmation (résilier, renoncer). */
function LegalPanel({ id, title, lead, rows, confirm, onConfirm, onCancel }: {
  id: string; title: string; lead: ReactNode; rows: [string, ReactNode][]; confirm: string; onConfirm: () => Promise<void>; onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "start", behavior: "smooth" }); ref.current?.focus(); }, []);
  return (
    <section ref={ref} tabIndex={-1} className="abo-recap" aria-labelledby={`${id}-titre`} data-panneau={id}>
      <h2 id={`${id}-titre`} className="font-display text-[26px] font-medium">{title}</h2>
      <p className="max-w-[42rem] text-[15px] text-ink-soft">{lead}</p>
      <dl className="abo-recap-list">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <div className="flex flex-wrap gap-3">
        <Button variant="danger" className="h-12" loading={busy} onClick={() => { setBusy(true); void onConfirm().finally(() => setBusy(false)); }} data-confirmer={id}>{confirm}</Button>
        <Button variant="ghost" className="h-12" onClick={onCancel}>Annuler</Button>
      </div>
    </section>
  );
}

/** Historique : factures (Premium) et reçus (Premium à vie), liens hébergés par Stripe ; montants PAYÉS. */
function History() {
  const r = useResource<{ factures: Facture[] }>("/api/facturation/factures", 60_000);
  const list = r.data?.factures ?? [];
  if (!r.data) return r.error ? <p className="mt-10 text-[14px] text-muted">L'historique des paiements est indisponible pour le moment.</p> : null;
  return (
    <section className="mt-10" aria-labelledby="abo-historique" data-factures="">
      <h2 id="abo-historique" className="font-display text-[22px] font-medium">Historique des paiements</h2>
      {list.length === 0 ? <p className="mt-3 text-[15px] text-muted">Aucun paiement pour l'instant.</p> : (
        <ul className="abo-invoices mt-4">
          {list.map((f) => (
            <li key={f.id}>
              <span className="tabular">{dayLong(f.date)}</span>
              <span className="text-ink-soft">{f.objet}{f.numero ? `${NB}· ${f.numero}` : ""}</span>
              <b className="tabular">{money(f.montant, f.devise)}</b>
              <span>{f.statut === "paid" ? "Payé" : f.statut === "open" ? "À payer" : f.statut === "void" ? "Annulé" : f.statut === "rembourse" ? "Remboursé" : f.statut ?? ""}</span>
              {f.lien && <a href={f.lien} target="_blank" rel="noopener noreferrer" className={link}>Voir<span className="sr-only"> {f.numero ? `la facture ${f.numero}` : "le reçu"} (Stripe, nouvel onglet)</span></a>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Panel = { kind: "recap"; plan: PaidPlanId } | { kind: "resilier" } | { kind: "retracter" } | null;

export default function Abonnement() {
  useDocumentTitle("Mon abonnement");
  const me = useMe();
  const cfg = useConfig();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const abo = useResource<AbonnementInfo>("/api/abonnement", 60_000);
  const billing = useResource<BillingState>(abo.data?.checkout ? BILLING_URL : null, 30_000);
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "info" | "warn"; text: string } | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const d = me.data;
  const b = billing.data ?? null;
  const q = d ? quotaView(d.today) : null;
  const open = !!b?.disponible;
  // Nouveaux achats (offres, récapitulatif, « Passer à vie ») : seulement si les ventes sont ouvertes ; la gestion des
  // contrats en cours (résiliation, rétractation, factures) reste là quand elles sont fermées.
  const vente = open && b?.vente !== false;
  // L'offre vient des droits du compte (account) : juste même si la facturation ne répond pas.
  const planId = b?.offre.id ?? abo.data?.plan.id ?? "free";
  const plan = planById(planId);
  const daily = planId === "free" ? cfg.data?.quotas.daily ?? plan.limits.daily : plan.limits.daily;
  const maxActive = planId === "free" ? cfg.data?.quotas.maxActive ?? plan.limits.maxActive : plan.limits.maxActive;
  const a = b?.abonnement && b.abonnement.etat !== "termine" ? b.abonnement : null;
  const life = planId === "vie";
  const exp = d?.exportMinutes;

  // Retour de la page de paiement, du portail ou d'une résiliation : messages, puis adresse nettoyée.
  useEffect(() => {
    const paiement = params.get("paiement"), session = params.get("session"), offre = params.get("offre");
    if (!paiement && !params.get("resiliation") && !offre) return;
    if (paiement === "annule") setNotice({ tone: "info", text: "Paiement annulé : rien n'a été prélevé." });
    if (params.get("resiliation") === "faite") setNotice({ tone: "ok", text: "Résiliation enregistrée : ton offre reste active jusqu'à la fin de la période payée." });
    if (paiement === "retour" && session) {
      setNotice({ tone: "info", text: "Paiement reçu : confirmation en cours…" });
      void confirmReturn(session).then(
        (s) => setNotice(s.offre.id !== "free" ? { tone: "ok", text: `Bienvenue dans AETHRYON ${s.offre.nom}. La confirmation t'a été envoyée par e-mail.` } : { tone: "info", text: "Paiement en cours de confirmation : cette page se mettra à jour." }),
        () => setNotice({ tone: "warn", text: "La confirmation tarde : si le paiement a abouti, ton offre s'affichera dans quelques minutes." }),
      );
    }
    if (offre === "annuel" || offre === "vie") setPanel({ kind: "recap", plan: offre });
    setParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (key: string, run: () => Promise<unknown>, ok?: string) => {
    setActing(key);
    try { await run(); if (ok) toast.show("success", ok); } catch (e) { toast.show("error", "Action impossible", errText(e)); } finally { setActing(null); }
  };
  const goPortal = (action: "accueil" | "paiement" | "factures" | "resilier") => act(`portail-${action}`, async () => window.location.assign(await openPortal(action)));
  const w = b?.retractation ?? null;

  return (
    <div data-page-abonnement="" data-facturation={open ? "ouverte" : "fermee"} data-offre={planId}>
      {/* Phrase fixe : elle ne dépend pas de la réponse de la facturation (sa disparition faisait remonter la page). */}
      <PageHeader title="Mon abonnement" lead="Ton offre, son prix, son état et ton usage du jour." />

      {notice && <Alert tone={notice.tone} live className="mt-6">{notice.text}</Alert>}
      {abo.data?.checkout && billing.error && <Alert tone="warn" className="mt-6">Le service de paiement ne répond pas pour le moment. Ton offre ci-dessous reste valable.</Alert>}

      <section className="abo-hero mt-8" aria-labelledby="abo-offre" data-abo-offre={planId}>
        <div className="abo-plan">
          <span className="abo-owl" aria-hidden><OwlMark size={26} surface="dark" /></span>
          <h2 id="abo-offre" className="abo-plan-name">{plan.name}<span className="sr-only">, ton offre actuelle</span></h2>
          <p className="abo-plan-meta"><span aria-hidden className="offer-dot" />{statusLine(b, planId, !open)}</p>
          {open && (
            <dl className="abo-details" data-abo-details="">
              {contractDetails(b, planId, plan).map(([k, label, value, etat]) => (
                <div key={k} data-abo-detail={k}><dt>{label}</dt><dd>{etat ? <span className="abo-state" data-etat={etat}>{value}</span> : value}</dd></div>
              ))}
            </dl>
          )}
          <ul className="abo-limits" aria-label="Ce que comprend ton offre">
            <li><b>{daily}</b> conversions par jour</li>
            {exp && exp.limit === null
              ? <li>Export Tools <b>sans limite</b> quotidienne</li>
              : <li><b>{exp?.limit ?? plan.limits.exportMinutes}</b> min d'export Tools par jour</li>}
            <li><b>{maxActive}</b> à la fois</li>
            <li><b>{plan.limits.historyDays === 365 ? "1 an" : `${plan.limits.historyDays} jours`}</b> d'historique</li>
          </ul>
          {life && <p className="abo-plan-note">{LIFETIME_LINE}</p>}
          {a?.arretParVie && <p className="abo-plan-note">Ton abonnement Premium ne sera pas renouvelé{NB}: il s'arrête le {dayLong(a.fin)}.</p>}
          {!a && !life && <p className="abo-plan-note">{open ? "Aucune carte enregistrée, aucun prélèvement." : "Aucune carte enregistrée, aucun paiement, rien à résilier."}</p>}
        </div>
        <div className="abo-quota" data-abo-quota={q ? q.used : undefined}>
          <div className="abo-quota-row">
            <RetroObject kind="sablier" size="sm" className="retro-plinth abo-sablier" />
            {q ? <QuotaRing used={q.used} limit={q.limit} /> : <Skeleton night className="size-[148px] rounded-full" />}
          </div>
          <p className="abo-quota-note">{q?.exhausted ? "Quota du jour atteint." : "Aujourd'hui."} Repart à minuit, heure de Paris.</p>
          {exp && <p className="abo-quota-note" data-minutes-export={exp.used}>Export Tools{NB}: {fmt1(exp.used)}{exp.limit !== null ? ` sur ${exp.limit}` : ""}{NB}min aujourd'hui.</p>}
        </div>
      </section>

      {/* Premium en cours : ses actions. « Gérer mon abonnement » : accueil du portail client de Stripe (factures, moyen de
          paiement, résiliation) ; les boutons légaux restent ici (D215-1 à D215-3). */}
      {open && a && (
        <div className="abo-actions mt-6" data-abo-actions="">
          {a.etat === "resilie" && !a.arretParVie && <Button variant="primary" loading={acting === "reprendre"} onClick={() => void act("reprendre", resume, "Abonnement repris")} data-reprendre="">Reprendre l'abonnement</Button>}
          <Button variant={a.etat === "resilie" ? "secondary" : "primary"} loading={acting === "portail-accueil"} onClick={() => void goPortal("accueil")} data-gerer="">Gérer mon abonnement</Button>
          {a.etat === "impaye" && <Button variant="secondary" loading={acting === "portail-paiement"} onClick={() => void goPortal("paiement")}>Mettre à jour le paiement</Button>}
          {vente && !life && LIFETIME_OFFERED && b?.prix.vie && <Button variant="secondary" onClick={() => setPanel({ kind: "recap", plan: "vie" })} data-passer="vie">Passer à Premium à vie</Button>}
          {a.etat !== "resilie" && <Button variant="ghost" onClick={() => setPanel({ kind: "resilier" })} data-resilier="">Résilier votre contrat</Button>}
        </div>
      )}
      {vente && !life && LIFETIME_OFFERED && a && a.etat !== "resilie" && b?.prix.vie && (
        <p className="mt-3 text-[13.5px] text-muted">Premium à vie{NB}: {money(b.prix.vie.montant, b.prix.vie.devise)} une seule fois{NB}; ton abonnement Premium ne sera plus renouvelé.</p>
      )}
      {open && w && d && <div className="mt-4"><Button variant="ghost" onClick={() => setPanel({ kind: "retracter" })} data-renoncer="">Renoncer au contrat ici</Button></div>}

      {panel?.kind === "resilier" && a && d && (
        <div className="mt-8">
          <LegalPanel id="resilier" title="Résilier votre contrat" confirm="Notifier la résiliation" onCancel={() => setPanel(null)}
            lead={<>Aucun nouveau prélèvement. Ton offre reste active jusqu'à la fin de l'année payée, puis ton compte passe sur l'offre Gratuite. Un accusé de réception part par e-mail.</>}
            rows={[["Nom", d.user.name], ["E-mail", d.user.email], ["Contrat", <>AETHRYON {planById("annuel").name}{NB}· <span className="font-mono text-[13px]">{a.reference}</span></>], ["Fin d'accès", dayLong(a.fin ?? a.renouvellement)]]}
            onConfirm={() => act("resilier", async () => { await terminate(); setPanel(null); setNotice({ tone: "ok", text: "Résiliation enregistrée. L'accusé de réception t'a été envoyé par e-mail." }); })} />
        </div>
      )}
      {panel?.kind === "retracter" && d && w && (
        <div className="mt-8">
          <LegalPanel id="retracter" title="Renoncer au contrat" confirm="Confirmer la rétractation" onCancel={() => setPanel(null)}
            lead={w.contrat === "vie"
              ? <>L'offre Premium à vie s'arrête tout de suite et ton compte repasse sur l'offre Gratuite. Le montant payé t'est remboursé en entier, sur ton moyen de paiement. Un accusé de réception daté part par e-mail.</>
              : <>L'abonnement Premium s'arrête tout de suite et ton compte repasse sur l'offre Gratuite. Le montant payé t'est remboursé en entier (CGV 8.4), sur ton moyen de paiement. Un accusé de réception daté part par e-mail.</>}
            rows={[["Nom", d.user.name], ["E-mail", d.user.email],
              ["Contrat", <>AETHRYON {planById(w.contrat).name}{NB}· <span className="font-mono text-[13px]">{w.contrat === "vie" ? b?.vie?.reference : a?.reference}</span></>],
              ["Possible jusqu'au", dayLong(w.jusqua)]]}
            onConfirm={() => act("retracter", async () => { await withdraw(w.contrat); setPanel(null); setNotice({ tone: "ok", text: "Rétractation enregistrée. Le remboursement et l'accusé de réception suivent par e-mail." }); })} />
        </div>
      )}

      {/* Gratuit (ou Premium terminé) : les offres. Premium à vie : rien à vendre. */}
      {!a && !life && (
        <section className="mt-12" aria-labelledby="abo-offres">
          <h2 id="abo-offres" className="font-display text-[26px] font-medium">Les offres</h2>
          <div className="mt-7">
            <PricingPlans context="espace" currentPlan={planId}
              prices={vente ? { annuel: b?.prix.annuel?.montant ?? null, vie: b?.prix.vie?.montant ?? null } : undefined}
              onChoose={vente ? (p) => setPanel({ kind: "recap", plan: p }) : undefined} />
          </div>
          <PricingCommon className="mt-6" />
          <PricingCompare className="mt-5" />
          <PricingNote className="mt-5" vente={vente} />
        </section>
      )}
      {panel?.kind === "recap" && vente && b && !life && <div className="mt-8"><Recap plan={panel.plan} billing={b} annualOpen={!!a && a.etat === "actif"} onCancel={() => setPanel(null)} /></div>}

      {open && (b?.abonnement || b?.vie) && <History />}

      {!open && OFFRES_MODE !== "reelles" && (
        <details className="fold mt-8" data-abo-pourquoi="">
          <summary>Quand ouvrira Premium{NB}?</summary>
          <div className="fold-body"><p>
            Quand leur cadre juridique et le paiement seront prêts. D'ici là, rien n'est vendu ni demandé{NB}; avec l'alerte, tu recevras un seul e-mail à l'ouverture. {HOW.year}{LIFETIME_OFFERED ? ` ${HOW.once}` : ""}
          </p></div>
        </details>
      )}
      {open && b?.mode === "test" && <p className="mt-8 text-[13px] text-muted" data-mode-test="">Mode test{NB}: aucun paiement réel n'est possible sur ce serveur.</p>}
    </div>
  );
}
