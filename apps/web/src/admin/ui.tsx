// Briques d'interface du Control Center : en-tête de page, panneaux, indicateurs, états (chargement,
// vide, erreur avec nouvel essai), tableaux qui deviennent des cartes sur mobile, pagination, champs,
// confirmations nommant la conséquence, tiroir latéral. Aucune donnée inventée : « — » si absente.
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { ApiError } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import { useDocumentTitle } from "../lib/hooks.ts";
import { Button } from "../ui/Button.tsx";
import { Badge, Skeleton } from "../ui/bits.tsx";
import { Dialog as ConfirmShell } from "../ui/Dialog.tsx";
import { IconAlert, IconChevron, IconClose, IconInfo, IconRefresh } from "../ui/Icon.tsx";
import { IconSearch, IconSortAsc, IconSortDesc } from "./icons.tsx";
import { KEY_STATE, RESULT_LABEL, REVOKED_REASON, ROLE_LABEL, STATE_LABEL, STATUS_LABEL, fmtNum, type Tone } from "./format.ts";

export const linkCls = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";
const fieldCls =
  "h-11 w-full rounded-[12px] border border-field bg-white/75 px-3 text-[15px] text-ink transition-colors placeholder:text-muted " +
  "focus:border-gold-text focus:bg-white focus:outline-none focus-visible:outline-2 focus-visible:outline-gold-text disabled:opacity-60";

// ---- Page et panneaux ------------------------------------------------------------------------------

export function AdminPage({ eyebrow, title, lead, actions, children, docTitle }: { eyebrow?: ReactNode; title: string; lead?: ReactNode; actions?: ReactNode; children: ReactNode; docTitle?: string }) {
  useDocumentTitle(`${docTitle ?? title} · Control Center`);
  return (
    <div>
      <header className="flex flex-col gap-4 border-b border-line pb-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {eyebrow && <div className="text-[13px] font-medium text-gold-text">{eyebrow}</div>}
          <h1 className="font-display mt-1.5 text-[30px] font-medium leading-tight tracking-[-0.012em] sm:text-[36px]">{title}</h1>
          {lead && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-soft">{lead}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="mt-6 space-y-5 sm:mt-8 sm:space-y-6">{children}</div>
    </div>
  );
}

export function Panel({ title, description, actions, children, className, id, bodyClassName }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string; bodyClassName?: string }) {
  const hid = useId();
  return (
    <section id={id} aria-labelledby={title ? hid : undefined} className={cn("min-w-0 scroll-mt-24 rounded-[20px] border border-line bg-pearl/55 shadow-card", className)}>
      {(title || actions) && (
        <div className="flex flex-col gap-3 px-4 pt-4 sm:flex-row sm:items-start sm:justify-between sm:px-5 sm:pt-5">
          <div className="min-w-0">
            {title && <h2 id={hid} className="text-[16.5px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>}
            {description && <p className="mt-1 text-[14px] leading-relaxed text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Indicateur chiffré (valeur réelle, ou « — » / « Non mesuré » si absente). */
export function Kpi({ label, value, sub, tone, loading, to, hint }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; loading?: boolean; to?: string; hint?: string }) {
  const body = (
    <>
      <p className="text-[13.5px] text-ink-soft">{label}</p>
      {loading ? <Skeleton className="mt-2.5 h-8 w-20" /> : (
        <p className={cn("tabular mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.01em]", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-ink")}>{value}</p>
      )}
      {sub && !loading && <p className="tabular mt-1 text-[13px] leading-snug text-muted">{sub}</p>}
    </>
  );
  const cls = "block rounded-[18px] border border-line bg-ivory p-4 shadow-card sm:p-5";
  return to ? (
    <Link to={to} title={hint} className={cn(cls, "transition-[border-color,translate] hover:-translate-y-px hover:border-line-strong")}>{body}</Link>
  ) : (
    <div className={cls} title={hint}>{body}</div>
  );
}

export function NotMeasured({ what, className }: { what?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-sand/60 px-2.5 py-1 text-[12.5px] font-medium text-ink-soft ring-1 ring-inset ring-line-strong/60", className)} title={what ? `${what} : non mesuré par le serveur` : "Non mesuré par le serveur"}>
      <IconInfo size={13} />Non mesuré
    </span>
  );
}

// ---- États : chargement, erreur, vide --------------------------------------------------------------

function errorText(e: unknown): { title: string; message: string } {
  if (e instanceof ApiError) {
    if (e.status === 401) return { title: "Session expirée", message: "Reconnecte-toi pour continuer." };
    if (e.status === 403) return { title: "Accès refusé", message: e.message || "Cette action est réservée aux administrateurs." };
    if (e.status === 404) return { title: "Introuvable", message: e.message || "Cet élément n'existe pas ou plus." };
    if (e.status === 0) return { title: "Connexion impossible", message: "Le navigateur n'a pas pu joindre le serveur. Vérifie ta connexion." };
    if (e.status >= 500) return { title: "Le serveur ne répond pas correctement", message: e.message && e.message !== "Une erreur est survenue." ? e.message : `Erreur ${e.status} du service account.` };
    return { title: "Requête refusée", message: e.message };
  }
  return { title: "Erreur inattendue", message: "Réessaie dans un instant." };
}

export function ErrorState({ error, onRetry, compact = false, className }: { error: unknown; onRetry?: () => unknown; compact?: boolean; className?: string }) {
  const { title, message } = errorText(error);
  const [busy, setBusy] = useState(false);
  const retry = async () => { setBusy(true); try { await onRetry?.(); } finally { setBusy(false); } };
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 rounded-[16px] border border-bad/20 bg-bad-bg/70 text-bad sm:flex-row sm:items-center", compact ? "p-3" : "p-4 sm:p-5", className)}>
      <IconAlert size={20} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[14px] leading-snug text-bad/90">{message}{error instanceof ApiError && error.code && error.status > 0 ? <span className="ml-1.5 font-mono text-[12.5px] opacity-80">({error.code})</span> : null}</p>
      </div>
      {onRetry && <Button size="sm" variant="secondary" className="h-11 shrink-0" icon={<IconRefresh size={16} />} loading={busy} onClick={retry}>Réessayer</Button>}
    </div>
  );
}

export function EmptyState({ title, children, icon, className }: { title: string; children?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-[16px] border border-dashed border-line-strong px-4 py-10 text-center", className)}>
      {icon && <span className="grid size-11 place-items-center rounded-full bg-sand/60 text-gold-text">{icon}</span>}
      <p className="text-[15.5px] font-semibold text-ink">{title}</p>
      {children && <div className="max-w-md text-[14px] leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

/** Rendu selon l'état d'une ressource : squelette, erreur avec nouvel essai, vide, ou contenu. */
export function Gate<T>({ r, skeleton, empty, isEmpty, children }: {
  r: { data: T | undefined; error?: unknown; loading: boolean; reload: () => unknown; stale?: boolean };
  skeleton?: ReactNode; empty?: ReactNode; isEmpty?: (d: T) => boolean; children: (d: T) => ReactNode;
}) {
  if (r.data === undefined) {
    if (r.error) return <ErrorState error={r.error} onRetry={r.reload} />;
    return <div aria-busy="true"><span className="sr-only" role="status">Chargement…</span>{skeleton ?? <Skeleton className="h-40" />}</div>;
  }
  return (
    <>
      {r.error ? <ErrorState compact error={r.error} onRetry={r.reload} className="mb-3" /> : null}
      {isEmpty && empty && isEmpty(r.data) ? empty : <div className={cn("transition-opacity duration-200", r.stale && "opacity-60")} aria-busy={r.stale || undefined}>{children(r.data)}</div>}
    </>
  );
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-12" />)}
    </div>
  );
}

// ---- Badges ----------------------------------------------------------------------------------------

export function ToneBadge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return <Badge tone={tone} className={cn("whitespace-nowrap", className)}>{children}</Badge>;
}
export function StateBadge({ state }: { state: string }) {
  const s = STATE_LABEL[state] ?? { label: state, tone: "neutral" as Tone };
  return <ToneBadge tone={s.tone}>{s.label}</ToneBadge>;
}
export function RoleBadge({ role }: { role: string }) {
  return role === "admin" ? <ToneBadge tone="gold">{ROLE_LABEL.admin}</ToneBadge> : <ToneBadge tone="neutral">{ROLE_LABEL[role] ?? role}</ToneBadge>;
}
export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, tone: "neutral" as Tone };
  return <ToneBadge tone={s.tone}>{s.label}</ToneBadge>;
}
export function ResultBadge({ result }: { result: string }) {
  const s = RESULT_LABEL[result] ?? { label: result, tone: "neutral" as Tone };
  return <ToneBadge tone={s.tone}>{s.label}</ToneBadge>;
}
export function KeyBadge({ state, reason }: { state: string; reason?: string | null }) {
  const s = KEY_STATE[state] ?? { label: state, tone: "neutral" as Tone };
  return <ToneBadge tone={s.tone}>{s.label}{state === "revoked" && reason ? ` (${REVOKED_REASON[reason] ?? reason})` : ""}</ToneBadge>;
}

/** Monogramme (les avatars Google ne sont pas stockés, par choix de confidentialité). */
export function Monogram({ initials, name, size = 36, admin = false, className }: { initials?: string | null; name?: string | null; size?: number; admin?: boolean; className?: string }) {
  const txt = (initials || (name ?? "?").split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("") || "?").slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full border font-display font-medium leading-none", admin ? "border-gold bg-obsidian text-gold-light" : "border-line-strong bg-sand/70 text-gold-text", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {txt}
    </span>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cn("rounded-[6px] bg-sand/55 px-1.5 py-0.5 font-mono text-[12.5px] text-ink-soft", className)}>{children}</code>;
}

// ---- Champs ----------------------------------------------------------------------------------------

export function SelectField({ label, value, onChange, options, className, hideLabel = false, ...rest }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string; hideLabel?: boolean;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  const id = useId();
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={id} className={cn("mb-1 block text-[12.5px] font-medium text-ink-soft", hideLabel && "sr-only")}>{label}</label>
      <div className="relative">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(fieldCls, "appearance-none pr-9")} {...rest}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <IconChevron size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
      </div>
    </div>
  );
}

export function SearchField({ label, value, onChange, placeholder, className, list }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string; list?: string }) {
  const id = useId();
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={id} className="mb-1 block text-[12.5px] font-medium text-ink-soft">{label}</label>
      <div className="relative">
        <IconSearch size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input id={id} type="search" list={list} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} className={cn(fieldCls, "pl-9")} />
      </div>
    </div>
  );
}

export function TextField({ label, hint, error, className, inputClassName, id: idProp, ...rest }: { label: string; hint?: ReactNode; error?: string | null; className?: string; inputClassName?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={id} className="mb-1 block text-[13.5px] font-medium text-ink-soft">{label}</label>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} className={cn(fieldCls, error && "border-bad focus:border-bad", inputClassName)} {...rest} />
      {error ? <p id={`${id}-err`} className="mt-1.5 flex gap-1.5 text-[13px] text-bad"><IconAlert size={15} className="mt-0.5 shrink-0" />{error}</p>
        : hint ? <p id={`${id}-hint`} className="mt-1.5 text-[13px] leading-snug text-muted">{hint}</p> : null}
    </div>
  );
}

/** Interrupteur accessible (role="switch"). */
export function Switch({ checked, onChange, label, description, disabled, id: idProp }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode; disabled?: boolean; id?: string }) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[15px] font-medium text-ink">{label}</label>
        {description && <p id={`${id}-d`} className="mt-0.5 text-[13.5px] leading-snug text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-d` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative inline-flex h-11 w-[60px] shrink-0 items-center rounded-full transition-colors disabled:opacity-50", "before:absolute before:inset-x-0 before:top-1/2 before:h-7 before:-translate-y-1/2 before:rounded-full before:transition-colors", checked ? "before:bg-obsidian" : "before:bg-beige")}
      >
        <motion.span aria-hidden layout transition={{ type: "spring", stiffness: 520, damping: 36 }} className={cn("relative size-5 rounded-full shadow-sm", checked ? "ml-[34px] bg-gold" : "ml-[6px] bg-white")} />
        <span className="sr-only">{checked ? "Activé" : "Désactivé"}</span>
      </button>
    </div>
  );
}

/** Explication d'une action indisponible (liée par aria-describedby au bouton). */
export function DisabledReason({ id, children }: { id: string; children: ReactNode }) {
  return <p id={id} className="mt-1.5 flex gap-1.5 text-[13px] leading-snug text-muted"><IconInfo size={15} className="mt-0.5 shrink-0" />{children}</p>;
}

// ---- Tableau / cartes --------------------------------------------------------------------------------

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Colonne-titre des cartes mobiles (une seule). */
  primary?: boolean;
  hideOnMobile?: boolean;
  align?: "right";
  sortKey?: string;
  className?: string;
}

export interface SortState { key: string; dir: "asc" | "desc" }

export function DataTable<T>({ rows, columns, rowKey, caption, sort, onSort, onRowClick, rowLabel, minWidth = 760, mobileDetails = true }: {
  rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; caption: string; sort?: SortState; onSort?: (key: string) => void;
  onRowClick?: (r: T) => void; rowLabel?: (r: T) => string; minWidth?: number;
  /** Bouton « Détails » sur les cartes mobiles (inutile si la colonne-titre est déjà un lien). */
  mobileDetails?: boolean;
}) {
  const primary = columns.find((c) => c.primary) ?? columns[0]!;
  const rest = columns.filter((c) => c !== primary && !c.hideOnMobile);
  return (
    <>
      {/* ≥ 768 px : vrai tableau (défilement horizontal DANS son conteneur si besoin) */}
      <div role="region" aria-label={`${caption} (tableau défilant)`} tabIndex={0} className="relative hidden overflow-x-auto rounded-[16px] border border-line bg-ivory focus-visible:outline-2 focus-visible:outline-offset-2 md:block">
        <table className="w-full text-left text-[14px]" style={{ minWidth }}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line bg-pearl/60 text-[12.5px] text-ink-soft">
              {columns.map((c) => {
                const active = sort && c.sortKey && sort.key === c.sortKey;
                return (
                  <th key={c.id} scope="col" aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined} className={cn("px-3.5 py-2.5 font-medium first:pl-4 last:pr-4", c.align === "right" && "text-right")}>
                    {c.sortKey && onSort ? (
                      <button type="button" onClick={() => onSort(c.sortKey!)} className={cn("-mx-1.5 inline-flex min-h-11 items-center gap-1 rounded-[8px] px-1.5 transition-colors hover:bg-sand/60 hover:text-ink", active && "text-ink")}>
                        {c.header}
                        {active ? (sort!.dir === "asc" ? <IconSortAsc size={14} /> : <IconSortDesc size={14} />) : <IconSortDesc size={14} className="opacity-30" />}
                      </button>
                    ) : c.header}
                  </th>
                );
              })}
              {onRowClick && mobileDetails ? <th scope="col" className="px-3.5 py-2.5 pr-4"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? (e) => { if (!(e.target as HTMLElement).closest("a, button, input, select")) onRowClick(r); } : undefined} className={cn("align-middle transition-colors", onRowClick && "cursor-pointer hover:bg-pearl/70")}>
                {columns.map((c) => (
                  <td key={c.id} className={cn("px-3.5 py-2.5 first:pl-4 last:pr-4", c.align === "right" && "text-right", c.className)}>{c.cell(r)}</td>
                ))}
                {onRowClick && mobileDetails ? (
                  <td className="px-3.5 py-2 pr-4 text-right">
                    {/* Contrôle clavier (WCAG 2.1.1) : le clic sur la ligne n'est qu'un raccourci pour la souris. */}
                    <button type="button" onClick={() => onRowClick(r)} className="inline-flex min-h-11 items-center rounded-full border border-line px-3.5 text-[13.5px] font-medium text-ink transition-colors hover:bg-pearl">
                      Détails{rowLabel ? <span className="sr-only"> : {rowLabel(r)}</span> : null}
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* < 768 px : cartes empilées, chaque valeur avec son libellé */}
      <ul className="space-y-2.5 md:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} className="rounded-[16px] border border-line bg-ivory p-3.5 shadow-card">
            <div className="min-w-0">{primary.cell(r)}</div>
            {rest.length > 0 && (
              <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-2.5 text-[13.5px]">
                {rest.map((c) => (
                  <div key={c.id} className="min-w-0">
                    <dt className="text-[12px] text-muted">{c.header}</dt>
                    <dd className="mt-0.5 min-w-0 break-words text-ink">{c.cell(r)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {onRowClick && mobileDetails && (
              <button type="button" onClick={() => onRowClick(r)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-line text-[14px] font-medium text-ink transition-colors hover:bg-pearl">
                Détails{rowLabel ? <span className="sr-only"> : {rowLabel(r)}</span> : null}
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export function Pagination({ page, pageSize, total, onPage, label = "Pagination" }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; label?: string }) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  if (total === 0) return null;
  if (page > pages) {
    // Liste raccourcie entre-temps (filtre, suppression) : la page demandée n'existe plus.
    return (
      <nav aria-label={label} className="flex flex-col items-center justify-between gap-3 pt-4 sm:flex-row">
        <p className="text-[13.5px] text-muted" role="status">Cette page n'existe plus ({fmtNum(total)} résultat{total > 1 ? "s" : ""}).</p>
        <Button size="sm" variant="ghost" className="h-11" onClick={() => onPage(pages)}>Aller à la dernière page</Button>
      </nav>
    );
  }
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label={label} className="flex flex-col items-center justify-between gap-3 pt-4 sm:flex-row">
      <p className="tabular text-[13.5px] text-muted" aria-live="polite">{fmtNum(from)}–{fmtNum(to)} sur {fmtNum(total)}</p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" className="h-11" disabled={page <= 1} onClick={() => onPage(page - 1)}>Précédent</Button>
        <span className="tabular min-w-[84px] text-center text-[13.5px] text-ink-soft">Page {page} / {pages}</span>
        <Button size="sm" variant="ghost" className="h-11" disabled={page >= pages} onClick={() => onPage(page + 1)}>Suivant</Button>
      </div>
    </nav>
  );
}

/** Rangée de filtres, au-dessus du contenu qu'ils filtrent. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div role="group" aria-label="Filtres" className={cn("grid grid-cols-2 gap-3 rounded-[18px] border border-line bg-pearl/50 p-3 sm:p-4 lg:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]", className)}>{children}</div>;
}

// ---- Listes clé / valeur, jauge ----------------------------------------------------------------------

export function KeyValues({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-line text-[14px]", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
          <dt className="shrink-0 text-ink-soft">{k}</dt>
          <dd className="tabular min-w-0 break-words text-right text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Jauge (remplissage or → avertissement → danger selon le niveau). */
export function Meter({ value, max, label, className, warnAt = 0.8, badAt = 1 }: { value: number; max: number; label: string; className?: string; warnAt?: number; badAt?: number }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const level = max > 0 ? value / max : 0;
  const tone = level >= badAt ? "bg-bad" : level >= warnAt ? "bg-warn" : "bg-gold";
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className={cn("h-2 overflow-hidden rounded-full bg-sand", className)}>
      <div className={cn("h-full origin-left rounded-full transition-transform duration-500 ease-[var(--ease-soft)] motion-reduce:transition-none", tone)} style={{ transform: `scaleX(${ratio})` }} />
    </div>
  );
}

// ---- Confirmation et tiroir --------------------------------------------------------------------------

/** Confirmation d'une action sensible : le titre nomme l'action, le texte sa conséquence. L'erreur du
 *  serveur (ex. dernier administrateur) s'affiche dans la boîte, qui reste ouverte. */
export function ConfirmDialog({ open, onClose, title, consequence, confirmLabel, tone = "danger", onConfirm, children }: {
  open: boolean; onClose: () => void; title: string; consequence: ReactNode; confirmLabel: string; tone?: "danger" | "primary";
  onConfirm: () => Promise<unknown>; children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { if (open) { setError(null); setBusy(false); } }, [open]);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmShell open={open} onClose={() => { if (!busy) onClose(); }} title={title} description={consequence}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Annuler</Button><Button variant={tone} loading={busy} onClick={go}>{confirmLabel}</Button></>}>
      {children}
      {error ? <ErrorState compact error={error} className={children ? "mt-4" : undefined} /> : null}
    </ConfirmShell>
  );
}

/** Tiroir latéral (dialog natif : focus piégé, Échap, arrière-plan inerte). Plein écran sous 640 px. */
export function Drawer({ open, onClose, title, subtitle, children, footer }: { open: boolean; onClose: () => void; title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const hid = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { opener.current = document.activeElement; d.showModal(); }
    else if (!open && d.open) { d.close(); (opener.current as HTMLElement | null)?.focus?.(); }
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={hid}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-full overflow-visible bg-transparent p-0 text-ink backdrop:bg-obsidian/45 sm:w-[min(560px,100vw)]"
    >
      {open && (
        <motion.div
          initial={{ opacity: 0, x: 28 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: "spring", stiffness: 340, damping: 34 }}
          className="flex h-full flex-col border-l border-line bg-ivory shadow-raised"
        >
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 id={hid} className="font-display text-[22px] font-medium leading-tight">{title}</h2>
              {subtitle && <div className="mt-1 text-[13.5px] text-muted">{subtitle}</div>}
            </div>
            <button type="button" onClick={onClose} aria-label="Fermer" className="-mr-1.5 grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-sand/60 hover:text-ink">
              <IconClose size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">{footer}</div>}
        </motion.div>
      )}
    </dialog>
  );
}

/** Lien de retour discret (fil d'Ariane minimal). */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex min-h-11 items-center gap-1.5 text-[14px] text-ink-soft transition-colors hover:text-ink">
      <span aria-hidden>←</span>{children}
    </Link>
  );
}

/** Heure de la dernière mise à jour + bouton d'actualisation. */
export function RefreshButton({ onRefresh, at, label = "Actualiser" }: { onRefresh: () => Promise<unknown> | unknown; at?: number | null; label?: string }) {
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await onRefresh(); } finally { setBusy(false); } };
  return (
    <div className="flex items-center gap-3">
      {at ? <span className="tabular text-[13px] text-muted" aria-live="polite">Mis à jour à {new Date(at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span> : null}
      <Button size="sm" variant="secondary" className="h-11" icon={<IconRefresh size={16} />} loading={busy} onClick={go}>{label}</Button>
    </div>
  );
}
