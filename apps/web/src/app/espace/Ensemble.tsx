// « Vue d'ensemble » de l'espace (V3, 2026-10-14) : quatre états RÉELS, lus d'un coup d'œil, chacun avec UN lien —
// les appareils reliés (jetons du raccourci et de l'extension, /api/keys), Discord (/api/discord, même cache que la
// page Discord et la carte d'identité), l'offre (Free pendant la bêta, limites réelles, alerte « Me prévenir » de
// /api/abonnement) et la sécurité (façons de se connecter, /api/me). Rien d'inventé : une valeur qui n'est pas arrivée
// reste une silhouette ; un serveur plus ancien (route inconnue, 404) se lit comme « rien de relié ».
import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn.ts";
import { DISCORD_PUBLIC } from "../../lib/discord.ts";
import { EXTENSION_AVAILABLE } from "../../lib/extension.ts";
import { fmtRelative } from "../../lib/format.ts";
import { planById } from "../../lib/offres.ts";
import { useResource } from "../../lib/store.ts";
import type { Abonnement, ApiKey, DiscordStatus, Me } from "../../lib/types.ts";
import { Skeleton, StatusDot } from "../../ui/bits.tsx";
import { DiscordAvatar } from "../../ui/DiscordAvatar.tsx";
import { GoogleG, IconBell, IconChat, IconLock, IconPhone, IconPuzzle, IconShield, IconSparkle } from "../../ui/Icon.tsx";
import type { QuotaView } from "../../lib/onboarding.ts";

const link = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";
type Tone = "ok" | "warn" | "bad" | "muted";

function Cell({ id, icon, title, children, to, action, data }: {
  id: string; icon: ReactNode; title: string; children: ReactNode; to: string; action: string; data?: Record<string, string | number>;
}) {
  return (
    <div className="ens-cell" data-ensemble={id} {...data}>
      <h3 className="ens-title"><span className="ens-ico" aria-hidden>{icon}</span>{title}</h3>
      <div className="ens-body">{children}</div>
      <Link to={to} className={cn(link, "ens-link")}>{action}</Link>
    </div>
  );
}

/** Une ligne d'état : nom, pastille, valeur (et un détail discret). */
function Row({ icon, name, tone, value, detail }: { icon: ReactNode; name: string; tone: Tone; value: string; detail?: string | null }) {
  return (
    <li className="ens-row">
      <span className="ens-row-ico" aria-hidden>{icon}</span>
      <span className="ens-row-name">{name}</span>
      <span className="ens-row-value"><StatusDot tone={tone} />{value}</span>
      {detail && <span className="ens-row-detail">{detail}</span>}
    </li>
  );
}

const lastUse = (keys: ApiKey[]) => keys.map((k) => k.lastUsedAt).filter((d): d is string => !!d).sort().at(-1) ?? null;

export function Ensemble({ me, quota }: { me: Me; quota: QuotaView }) {
  const keys = useResource<{ keys: ApiKey[] }>("/api/keys", 10_000);
  const dc = useResource<DiscordStatus>("/api/discord", 15_000);
  const abo = useResource<Abonnement>("/api/abonnement", 60_000);
  const active = keys.data?.keys.filter((k) => k.status === "active") ?? null;
  const shortcuts = active?.filter((k) => k.kind === "shortcut") ?? [];
  const extensions = active?.filter((k) => k.kind === "extension") ?? [];
  const discord: DiscordStatus | undefined = dc.data ?? (dc.error?.status === 404 ? { enabled: false, linked: false, discord: null } : undefined);
  const prevenir = !!abo.data?.prevenir;
  const plan = planById(abo.data?.plan.id ?? "free");
  const login = me.login;

  return (
    <section aria-labelledby="ensemble-title" className="ens" data-ensemble-vue="">
      <h2 id="ensemble-title" className="ens-head">Vue d'ensemble</h2>
      <div className="ens-grid"><div className="ens-cells">
        <Cell id="appareils" icon={<IconPhone size={17} />} title="Appareils" to="/dashboard/cles" action="Gérer mes jetons"
          data={{ "data-jetons-actifs": me.keys.active }}>
          {!active && keys.loading ? <Skeleton className="h-16 w-full" /> : (
            <ul className="ens-rows">
              <Row icon={<IconPhone size={15} />} name="Raccourci iPhone" tone={shortcuts.length ? "ok" : "muted"}
                value={shortcuts.length ? "Relié" : "Pas encore relié"}
                detail={shortcuts.length ? (lastUse(shortcuts) ? `Utilisé ${fmtRelative(lastUse(shortcuts)!)}` : "Pas encore utilisé") : null} />
              <Row icon={<IconPuzzle size={15} />} name="Extension" tone={extensions.length ? "ok" : "muted"}
                value={extensions.length ? "Reliée" : EXTENSION_AVAILABLE ? "Pas reliée" : "En développement"}
                detail={extensions.length ? extensions[0]!.deviceLabel ?? (lastUse(extensions) ? `Utilisée ${fmtRelative(lastUse(extensions)!)}` : null) : null} />
            </ul>
          )}
          <p className="ens-note tabular">{me.keys.active} {me.keys.active > 1 ? "jetons actifs" : "jeton actif"} sur {me.keys.max}</p>
        </Cell>

        <Cell id="discord" icon={<IconChat size={17} />} title="Discord" to="/dashboard/discord"
          action={discord?.linked ? "Gérer la liaison" : discord?.enabled ? "Relier mon compte" : DISCORD_PUBLIC ? "Ajouter le bot" : "En savoir plus"}>
          {!discord ? (
            dc.error ? <p className="ens-muted">Impossible de vérifier pour l'instant.</p> : <Skeleton className="h-12 w-full" />
          ) : discord.linked && discord.discord ? (
            <div className="ens-discord">
              <DiscordAvatar version={discord.discord.avatarVersion} name={discord.discord.displayName || discord.discord.name} size={40} className="ens-avatar" />
              <div className="min-w-0">
                <p className="ens-strong truncate">{discord.discord.displayName || discord.discord.name}</p>
                <p className="ens-muted truncate">@{discord.discord.name}</p>
              </div>
              <p className="ens-state"><StatusDot tone="ok" />Lié{discord.discord.lastUsedAt ? `, bot utilisé ${fmtRelative(discord.discord.lastUsedAt)}` : ", bot pas encore utilisé"}</p>
            </div>
          ) : (
            <p className="ens-state"><StatusDot tone="muted" />{discord.enabled ? "Aucun compte lié" : "Liaison pas encore ouverte"}</p>
          )}
        </Cell>

        <Cell id="abonnement" icon={<IconSparkle size={17} />} title="Abonnement" to="/dashboard/abonnement" action={plan.id === "free" ? "Voir les offres" : "Gérer mon offre"} data={{ "data-offre": plan.id }}>
          <p className="ens-strong">Offre {plan.name}</p>
          <p className="ens-muted">
            {plan.id === "free" && abo.data?.plan.beta ? "Gratuit pendant la bêta\u00a0: " : ""}{quota.unlimited ? "sans limite quotidienne" : `${quota.baseDaily} conversions par jour`}, {me.maxActive} à la fois{me.exportMinutes?.limit ? `, ${me.exportMinutes.limit}\u00a0min d'export Tools par jour` : ""}, {me.keys.max} jetons au plus.
          </p>
          {prevenir && plan.id === "free" && (
            <p className="ens-state mt-2"><IconBell size={14} className="text-gold-text" />Alerte activée{"\u00a0"}: Premium</p>
          )}
        </Cell>

        <Cell id="securite" icon={<IconShield size={17} />} title="Sécurité" to="/dashboard/compte" action="Connexion et mot de passe">
          {login ? (
            <ul className="ens-rows">
              <Row icon={<GoogleG size={14} />} name="Google" tone={login.google ? "ok" : "muted"} value={login.google ? "Activé" : "Non utilisé"} />
              <Row icon={<IconLock size={15} />} name="Mot de passe" tone={login.password ? "ok" : "muted"} value={login.password ? "Défini" : "Aucun"} />
            </ul>
          ) : null}
          <p className="ens-note truncate" title={me.user.email}>{me.user.email}</p>
        </Cell>
      </div></div>
    </section>
  );
}
