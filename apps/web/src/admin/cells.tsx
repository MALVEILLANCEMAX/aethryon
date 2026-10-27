// Cellules et colonnes partagées entre les pages (utilisateurs, conversions, jetons, journal).
import { Link } from "react-router";
import { ACTION_LABEL, TARGET_TYPE_LABEL, fmtBytes, fmtDateTime, fmtDuration, fmtNum, fmtRelative, platformLabel, shortId } from "./format.ts";
import type { AdminKey, AuditEvent, Conversion, UserRow } from "./types.ts";
import { KeyBadge, Mono, Monogram, ResultBadge, StateBadge, ToneBadge, type Column } from "./ui.tsx";

export function UserCell({ u }: { u: Pick<UserRow, "id" | "name" | "email" | "initials" | "role"> }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Monogram initials={u.initials} name={u.name || u.email} admin={u.role === "admin"} />
      <div className="min-w-0">
        <Link to={`/admin/users/${encodeURIComponent(u.id)}`} className="group flex min-h-11 min-w-0 flex-col justify-center">
          <span className="truncate font-medium text-ink underline-offset-4 group-hover:underline">{u.name || "Sans nom"}</span>
          <span className="truncate text-[13px] text-muted">{u.email}</span>
        </Link>
      </div>
    </div>
  );
}

export function TodayCell({ u }: { u: Pick<UserRow, "todayUsed" | "dailyLimit" | "unlimited"> }) {
  return (
    <span className="tabular whitespace-nowrap">
      {fmtNum(u.todayUsed)}
      <span className="text-muted"> / {u.unlimited ? "illimité" : u.dailyLimit === null ? "—" : fmtNum(u.dailyLimit)}</span>
    </span>
  );
}

export function UserLink({ id, email }: { id: string | null | undefined; email: string | null | undefined }) {
  if (!id) return <span className="text-muted">—</span>;
  return <Link to={`/admin/users/${encodeURIComponent(id)}`} className="flex min-h-11 min-w-0 items-center text-ink underline-offset-4 hover:underline"><span className="truncate">{email ?? "Compte supprimé"}</span></Link>;
}

export function ActionCell({ action }: { action: string }) {
  const label = ACTION_LABEL[action];
  return (
    <div className="min-w-0">
      {label && <p className="text-ink">{label}</p>}
      <Mono className={label ? "mt-0.5 inline-block" : undefined}>{action}</Mono>
    </div>
  );
}

export function TargetCell({ e }: { e: Pick<AuditEvent, "targetType" | "target"> }) {
  if (!e.target && !e.targetType) return <span className="text-muted">—</span>;
  const type = e.targetType ? TARGET_TYPE_LABEL[e.targetType] ?? e.targetType : null;
  const inner = <>{type && <span className="text-ink-soft">{type} </span>}{e.target && <Mono>{shortId(e.target, 12)}</Mono>}</>;
  if (e.targetType === "user" && e.target) return <Link to={`/admin/users/${encodeURIComponent(e.target)}`} className="inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:underline">{inner}</Link>;
  return <span>{inner}</span>;
}

/** Liste compacte de conversions (une ligne chacune, lien vers le détail) : lisible aussi sur iPhone. */
export function ConversionList({ items, href }: { items: Conversion[]; href: (c: Conversion) => string }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((c) => (
        <li key={c.id}>
          <Link to={href(c)} className="-mx-2 flex min-h-11 items-center gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-pearl">
            <div className="min-w-0 flex-1">
              <p className="tabular truncate text-[14px] text-ink">{fmtDateTime(c.createdAt)} <span className="text-muted">· {fmtRelative(c.createdAt)}</span></p>
              <p className="truncate text-[12.5px] text-muted">
                {platformLabel(c.platform)} · {c.fmt.toUpperCase()}{c.durationS !== null ? <> · {fmtDuration(c.durationS)}</> : null}
                {c.errorCode ? <> · <Mono>{c.errorCode}</Mono></> : null}
              </p>
            </div>
            <StateBadge state={c.state} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Colonnes d'une liste de conversions. */
export function conversionColumns({ user = true, sortable = false, compact = false }: { user?: boolean; sortable?: boolean; compact?: boolean } = {}): Column<Conversion>[] {
  const cols: Column<Conversion>[] = [
    { id: "date", header: "Date", primary: true, sortKey: sortable ? "createdAt" : undefined, cell: (c) => (
      <div className="min-w-0">
        <p className="tabular whitespace-nowrap text-ink">{fmtDateTime(c.createdAt)}</p>
        <p className="text-[12.5px] text-muted">{fmtRelative(c.createdAt)}</p>
      </div>
    ) },
  ];
  if (user) cols.push({ id: "user", header: "Utilisateur", cell: (c) => <div className="max-w-[220px]"><UserLink id={c.userId} email={c.userEmail} /></div> });
  if (compact) cols.push({ id: "source", header: "Source", cell: (c) => <span className="whitespace-nowrap">{platformLabel(c.platform)} · <span className="font-medium">{c.fmt.toUpperCase()}</span></span> });
  else cols.push(
    { id: "platform", header: "Plateforme", cell: (c) => platformLabel(c.platform) },
    { id: "fmt", header: "Format", cell: (c) => <span className="font-medium">{c.fmt.toUpperCase()}</span> },
  );
  cols.push(
    { id: "state", header: "État", cell: (c) => <StateBadge state={c.state} /> },
    { id: "error", header: "Erreur", cell: (c) => (c.errorCode ? <Mono>{c.errorCode}</Mono> : <span className="text-muted">—</span>) },
    { id: "duration", header: "Durée", align: "right", sortKey: sortable ? "durationS" : undefined, cell: (c) => <span className="tabular whitespace-nowrap">{fmtDuration(c.durationS)}</span> },
  );
  if (!compact) cols.push({ id: "size", header: "Taille", align: "right", hideOnMobile: true, cell: (c) => <span className="tabular whitespace-nowrap text-ink-soft">{fmtBytes(c.sizeBytes)}</span> });
  return cols;
}

export function keyColumns({ owner = true, onRevoke }: { owner?: boolean; onRevoke?: (k: AdminKey) => void } = {}): Column<AdminKey>[] {
  const cols: Column<AdminKey>[] = [
    { id: "name", header: "Jeton", primary: true, cell: (k) => (
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate font-medium text-ink">{k.name || "Sans nom"}</p>
          {k.kind === "extension" && <ToneBadge tone="gold">Extension</ToneBadge>}
          {k.kind === "discord" && <ToneBadge tone="neutral">Discord</ToneBadge>}
          {k.kind === "premiere" && <ToneBadge tone="gold">Premiere</ToneBadge>}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2">
          <Mono>{k.start ? `${k.start}…` : "ytc_…"}</Mono>
          {(k.kind === "extension" || k.kind === "premiere") && k.deviceLabel && <span className="truncate text-[12.5px] text-muted">{k.deviceLabel}</span>}
        </p>
      </div>
    ) },
  ];
  if (owner) cols.push({ id: "owner", header: "Propriétaire", cell: (k) => <div className="max-w-[220px]"><UserLink id={k.userId} email={k.userEmail} /></div> });
  cols.push(
    { id: "state", header: "État", cell: (k) => <KeyBadge state={k.state} reason={k.revokedReason} /> },
    { id: "created", header: "Créé", cell: (k) => <span className="tabular whitespace-nowrap text-ink-soft">{fmtDateTime(k.createdAt)}</span> },
    { id: "expires", header: "Expire", cell: (k) => <span className="tabular whitespace-nowrap text-ink-soft">{k.expiresAt ? fmtDateTime(k.expiresAt) : "jamais"}</span> },
    { id: "used", header: "Dernière utilisation", cell: (k) => <span className="whitespace-nowrap text-ink-soft">{k.lastUsedAt ? fmtRelative(k.lastUsedAt) : "jamais"}</span> },
  );
  if (onRevoke) {
    cols.push({ id: "actions", header: "Actions", align: "right", cell: (k) => (k.state === "active" ? (
      <button type="button" onClick={() => onRevoke(k)} className="inline-flex min-h-11 items-center rounded-full border border-bad/25 bg-bad-bg px-4 text-[13.5px] font-medium text-bad transition-colors hover:border-bad/45">
        Révoquer<span className="sr-only"> le jeton {k.name}</span>
      </button>
    ) : k.revokedAt ? <span className="whitespace-nowrap text-[13px] text-muted">le {fmtDateTime(k.revokedAt)}</span> : <span className="text-muted">—</span>) });
  }
  return cols;
}

export function auditColumns(): Column<AuditEvent>[] {
  return [
    { id: "at", header: "Date", primary: true, cell: (e) => (
      <div className="min-w-0">
        <p className="tabular whitespace-nowrap text-ink">{fmtDateTime(e.at)}</p>
        <p className="text-[12.5px] text-muted">{fmtRelative(e.at)}</p>
      </div>
    ) },
    { id: "actor", header: "Acteur", cell: (e) => (e.actorId || e.actorLabel ? <span className="block max-w-[220px] truncate">{e.actorLabel ?? shortId(e.actorId)}</span> : <span className="text-ink-soft">Système</span>) },
    { id: "action", header: "Action", cell: (e) => <ActionCell action={e.action} /> },
    { id: "target", header: "Cible", cell: (e) => <TargetCell e={e} /> },
    { id: "result", header: "Résultat", cell: (e) => <ResultBadge result={e.result} /> },
  ];
}

/** Détails d'un événement du journal : objet JSON (avant/après…) lisible, sans rien interpréter. */
export function AuditDetails({ details }: { details: unknown }) {
  let v = details;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { /* texte brut */ } }
  if (v === null || v === undefined || v === "") return <p className="text-[13.5px] text-muted">Aucun détail.</p>;
  if (typeof v !== "object") return <p className="break-words text-[13.5px] text-ink-soft">{String(v)}</p>;
  return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[12px] border border-line bg-surface p-3 font-mono text-[12.5px] leading-relaxed text-ink-soft">{JSON.stringify(v, null, 2)}</pre>;
}
