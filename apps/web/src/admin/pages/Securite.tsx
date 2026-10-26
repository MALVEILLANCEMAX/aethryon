// Sécurité (GET /api/admin/securite, account/src/antibot.ts, migration 016) : défis déclenchés, validés, échoués,
// requêtes limitées (toutes les réponses 429 de l'API, protections existantes comprises), blocages temporaires et
// événements suspects récents. Chiffres RÉELS uniquement : un compteur jamais incrémenté vaut 0, rien n'est estimé.
// Aucune donnée personnelle : sujet = empreinte non réversible, IP tronquée (/24, /48), jamais d'adresse e-mail.
import { useState } from "react";
import { IconInfo, IconShield } from "../../ui/Icon.tsx";
import { useAdmin, usePolling } from "../data.ts";
import { fmtDateTime, fmtNum, fmtRelative, type Tone } from "../format.ts";
import { AdminPage, DataTable, EmptyState, Gate, Kpi, Mono, Panel, RefreshButton, SkeletonRows, ToneBadge, type Column } from "../ui.tsx";

interface Metric { total: number; parAction: Record<string, number> }
interface SecEvent { id: number; at: string; kind: string; action: string; subject: string; ipPrefix: string | null; detail: string | null }
interface Report {
  mode: "off" | "observe" | "on";
  cap: "ok" | "indisponible" | "coupe";
  capConfigured: boolean;
  reglages: { ticketTtlS: number; passTtlS: number; blockS: number; loginFailures: number; travauxSeuil: number; echecsBlocage: number; eventDays: number; counterDays: number };
  maintenant: { sujetsBloques: number; ticketsEnAttente: number; laissezPasser: number };
  jour: Record<string, Metric>; semaine: Record<string, Metric>; mois: Record<string, Metric>;
  parJour: { day: string; metric: string; n: number }[];
  evenements: SecEvent[];
}

const MODE: Record<Report["mode"], { label: string; tone: Tone }> = {
  on: { label: "Active", tone: "ok" },
  observe: { label: "Observation (aucun défi demandé)", tone: "warn" },
  off: { label: "Coupée (ANTIBOT=off)", tone: "neutral" },
};
const CAP: Record<Report["cap"], { label: string; tone: Tone }> = {
  ok: { label: "Cap répond", tone: "ok" },
  indisponible: { label: "Cap ne répond pas", tone: "bad" },
  coupe: { label: "Cap non configuré", tone: "neutral" },
};
const KIND: Record<string, { label: string; tone: Tone }> = {
  preuve_refusee: { label: "Preuve refusée", tone: "warn" },
  rejeu: { label: "Rejeu d'un jeton", tone: "bad" },
  blocage: { label: "Blocage temporaire", tone: "bad" },
  bloque: { label: "Action bloquée", tone: "bad" },
  limite: { label: "Requête limitée (429)", tone: "warn" },
};
const ACTION: Record<string, string> = {
  inscription: "Inscription", connexion: "Connexion", mot_de_passe: "Mot de passe oublié", travaux: "Travaux (Tools, Music)",
  auth: "Authentification", inscription_api: "Inscription", keys: "Clés", outils: "Tools", music: "Music", extension: "Extension",
  premiere: "Premiere", desktop: "Desktop", discord: "Discord", admin: "Administration", facturation: "Facturation", cloud: "Cloud",
};
const METRIC: Record<string, string> = {
  challenge_issued: "Défis déclenchés", challenge_passed: "Défis validés", challenge_failed: "Preuves refusées",
  challenge_replay: "Rejeux refusés", challenge_expired: "Défis expirés", challenge_observed: "Défis en observation",
  verify_unavailable: "Cap indisponible", rate_limited: "Requêtes limitées (429)", block_started: "Blocages temporaires",
  blocked: "Actions bloquées", observed_block: "Blocages en observation", login_failed: "Connexions refusées",
};
const PERIODS = [{ id: "jour", label: "Aujourd'hui" }, { id: "semaine", label: "7 jours" }, { id: "mois", label: "30 jours" }] as const;

const n = (m: Record<string, Metric>, k: string) => m[k]?.total ?? 0;

export default function Securite() {
  const r = useAdmin<Report>("/securite", 15_000);
  usePolling(r.reload, 30_000);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["id"]>("jour");

  const columns: Column<SecEvent>[] = [
    { id: "at", header: "Date", primary: true, cell: (e) => (
      <div className="min-w-0">
        <p className="tabular whitespace-nowrap text-ink">{fmtDateTime(e.at)}</p>
        <p className="text-[12.5px] text-muted">{fmtRelative(e.at)}</p>
      </div>
    ) },
    { id: "kind", header: "Événement", cell: (e) => { const k = KIND[e.kind] ?? { label: e.kind, tone: "neutral" as Tone }; return <ToneBadge tone={k.tone}>{k.label}</ToneBadge>; } },
    { id: "action", header: "Action", cell: (e) => ACTION[e.action] ?? e.action },
    { id: "subject", header: "Sujet", cell: (e) => <Mono>{e.subject}</Mono> },
    { id: "ip", header: "Réseau (tronqué)", cell: (e) => (e.ipPrefix ? <Mono>{e.ipPrefix}</Mono> : <span className="text-muted">—</span>) },
    { id: "detail", header: "Détail", cell: (e) => <span className="block max-w-[280px] truncate text-ink-soft">{e.detail ?? "—"}</span> },
  ];

  return (
    <AdminPage
      eyebrow="Protection"
      title="Sécurité"
      lead="Vérifications de sécurité (Cap, auto-hébergé) et limites de débit du site. Chiffres réels relevés par le serveur ; ni adresse e-mail ni adresse IP complète ne sont conservées."
      actions={<RefreshButton onRefresh={r.reload} />}
    >
      <Gate r={r} skeleton={<SkeletonRows rows={6} />}>
        {(d) => {
          const m = d[period];
          const issued = n(m, "challenge_issued"), passed = n(m, "challenge_passed");
          const failed = n(m, "challenge_failed") + n(m, "challenge_replay");
          return (
            <div className="space-y-5">
              <Panel title="État" description="Interrupteur ANTIBOT de la composition et santé du conteneur Cap (réseau interne).">
                <div className="flex flex-wrap items-center gap-2">
                  <ToneBadge tone={MODE[d.mode].tone}><IconShield size={13} />{MODE[d.mode].label}</ToneBadge>
                  <ToneBadge tone={CAP[d.cap].tone}>{CAP[d.cap].label}</ToneBadge>
                  <span className="text-[13.5px] text-muted">
                    {fmtNum(d.maintenant.sujetsBloques)} sujet(s) bloqué(s) · {fmtNum(d.maintenant.laissezPasser)} laissez-passer actif(s) · {fmtNum(d.maintenant.ticketsEnAttente)} ticket(s) en attente
                  </span>
                </div>
              </Panel>

              <div role="tablist" aria-label="Période" className="flex gap-1.5">
                {PERIODS.map((p) => (
                  <button key={p.id} role="tab" aria-selected={period === p.id} type="button" onClick={() => setPeriod(p.id)}
                    className={`min-h-10 rounded-full px-4 text-[14px] transition-colors ${period === p.id ? "bg-obsidian text-ivory" : "border border-line text-ink-soft hover:border-line-strong"}`}>
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label="Défis déclenchés" value={fmtNum(issued)} sub={d.mode === "observe" ? `${fmtNum(n(m, "challenge_observed"))} en observation` : undefined} />
                <Kpi label="Défis validés" value={fmtNum(passed)} tone={passed ? "ok" : undefined} />
                <Kpi label="Défis échoués" value={fmtNum(failed)} sub={`dont ${fmtNum(n(m, "challenge_replay"))} rejeu(x), ${fmtNum(n(m, "challenge_expired"))} expiré(s)`} tone={failed ? "warn" : undefined} />
                <Kpi label="Requêtes limitées (429)" value={fmtNum(n(m, "rate_limited"))} sub={`${fmtNum(n(m, "block_started"))} blocage(s) temporaire(s)`} tone={n(m, "rate_limited") ? "warn" : undefined} />
              </div>

              <Panel title="Détail par action" description="Défis et refus de la période, par action protégée ou groupe de routes.">
                <ul className="grid gap-2 text-[14px] sm:grid-cols-2">
                  {Object.entries(m).flatMap(([metric, v]) => Object.entries(v.parAction).map(([a, count]) => (
                    <li key={`${metric}-${a}`} className="flex items-center justify-between gap-3 rounded-[12px] border border-line px-3 py-2">
                      <span className="min-w-0 truncate text-ink-soft">{METRIC[metric] ?? metric} · {ACTION[a] ?? a}</span>
                      <span className="tabular font-semibold text-ink">{fmtNum(count)}</span>
                    </li>
                  )))}
                </ul>
                {Object.keys(m).length === 0 && <p className="text-[14px] text-muted">Aucun événement sur la période.</p>}
              </Panel>

              <Panel title="Événements suspects récents" description={`50 derniers ; conservés ${d.reglages.eventDays} jours (compteurs : ${d.reglages.counterDays} jours).`}>
                {d.evenements.length
                  ? <DataTable caption="Événements suspects récents" rows={d.evenements} columns={columns} rowKey={(e) => String(e.id)} minWidth={860} />
                  : <EmptyState icon={<IconShield size={20} />} title="Aucun événement suspect">Rien à signaler sur la période conservée.</EmptyState>}
              </Panel>

              <p className="flex gap-2 text-[13px] leading-relaxed text-muted">
                <IconInfo size={16} className="mt-0.5 shrink-0" />
                Réglages : ticket {d.reglages.ticketTtlS} s · laissez-passer {Math.round(d.reglages.passTtlS / 60)} min · blocage {Math.round(d.reglages.blockS / 60)} min après {d.reglages.echecsBlocage} preuves refusées · défi de connexion après {d.reglages.loginFailures} échecs · défi des travaux au-delà de {d.reglages.travauxSeuil} en 10 min. Désactivation rapide : docs/SECURITE-ANTIBOT.md.
              </p>
            </div>
          );
        }}
      </Gate>
    </AdminPage>
  );
}
