// Formats et libellés du Control Center (français, espaces insécables, chiffres alignés).
export { fmtDate, fmtDateTime, fmtRelative, fmtTime } from "../lib/format.ts";

const nf = new Intl.NumberFormat("fr-FR");
const nf1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const dtFull = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" });
const hourFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Paris" });

export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : nf.format(n));
export const fmtDec = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : nf1.format(n));
export const fmtFull = (iso: string | null | undefined) => (iso ? dtFull.format(new Date(iso)) : "—");

/** Jour (« 12 oct. ») d'une date ISO ou d'un jour AAAA-MM-JJ (lu comme midi UTC : pas de décalage de jour). */
export function fmtDay(v: string, withWeekday = false): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00Z`) : new Date(v);
  return (withWeekday ? weekdayFmt : dayFmt).format(d);
}
/** « 14 h » à l'heure pile, sinon « 14 h 05 ». */
export const fmtHour = (iso: string) => hourFmt.format(new Date(iso)).replace(/:00$/, " h").replace(":", " h ");

/** Taux : le contrat donne un ratio 0–1 ; une valeur > 1 est lue comme un pourcentage déjà calculé. */
/** Ratio 0–1 (taux de réussite…) → pourcentage. L'unité vient du contrat, jamais de la valeur. */
export function toPct(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(1, v)) * 100;
}
/** Valeur déjà en pourcentage (progression d'un job fournie par ytapi), bornée à 0–100. */
export function clampPct(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, v));
}
export function fmtPct(v: number | null | undefined, alreadyPct = false): string {
  const p = alreadyPct ? (v ?? null) : toPct(v);
  if (p === null || !Number.isFinite(p)) return "—";
  return `${nf1.format(Math.round(p * 10) / 10)} %`;
}

export function fmtDuration(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  if (s < 1) return "< 1 s";
  if (s < 10) return `${nf1.format(Math.round(s * 10) / 10)} s`;
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = Math.round(s % 60);
    return r ? `${m} min ${String(r).padStart(2, "0")} s` : `${m} min`;
  }
  if (s < 86_400) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
  }
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  return h ? `${d} j ${h} h` : `${d} j`;
}

export function fmtBytes(b: number | null | undefined): string {
  if (b === null || b === undefined || !Number.isFinite(b)) return "—";
  const units = ["o", "Kio", "Mio", "Gio", "Tio"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? nf.format(v) : nf1.format(v)} ${units[i]}`;
}

export const fmtMs = (ms: number | null | undefined) => (ms === null || ms === undefined || !Number.isFinite(ms) ? "—" : `${nf.format(Math.round(ms))} ms`);

export const PLATFORM_LABEL: Record<string, string> = { youtube: "YouTube", tiktok: "TikTok", twitter: "X", x: "X", other: "Autre" };
export const platformLabel = (p: string | null | undefined) => (p ? PLATFORM_LABEL[p] ?? p : "—");
export const fmtFormat = (f: string | null | undefined) => (f ? f.toUpperCase() : "—");

export type Tone = "neutral" | "gold" | "ok" | "warn" | "bad";

export const STATE_LABEL: Record<string, { label: string; tone: Tone }> = {
  reserved: { label: "Réservée", tone: "neutral" },
  running: { label: "En cours", tone: "gold" },
  done: { label: "Terminée", tone: "ok" },
  error: { label: "Échec", tone: "bad" },
  cancelled: { label: "Annulée", tone: "neutral" },
  refunded: { label: "Remboursée", tone: "warn" },
};

export const ROLE_LABEL: Record<string, string> = { admin: "Administrateur", user: "Utilisateur" };
export const STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Actif", tone: "ok" },
  suspended: { label: "Suspendu", tone: "bad" },
};

export const KEY_STATE: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Actif", tone: "ok" },
  revoked: { label: "Révoqué", tone: "bad" },
  expired: { label: "Expiré", tone: "warn" },
};
export const REVOKED_REASON: Record<string, string> = {
  user: "par l'utilisateur",
  rotation: "régénéré",
  admin: "par un administrateur",
  account_deleted: "compte supprimé",
  replay: "code de connexion rejoué",
  unlink: "liaison Discord retirée",
  released: "fin de conversion Discord",
};
/** Types de clés (docs/ADMIN.md §6). */
export const KEY_KIND: Record<string, string> = { shortcut: "Raccourci", extension: "Extension", discord: "Discord" };

export const RESULT_LABEL: Record<string, { label: string; tone: Tone }> = {
  ok: { label: "Réussi", tone: "ok" },
  refused: { label: "Refusé", tone: "warn" },
  error: { label: "Erreur", tone: "bad" },
};

/** Libellés des actions connues du journal ; toute autre action s'affiche telle quelle (code). */
export const ACTION_LABEL: Record<string, string> = {
  "role.bootstrap": "Rôle administrateur (amorçage)",
  "user.role": "Rôle modifié",
  "user.promote": "Promu administrateur",
  "user.demote": "Rétrogradé",
  "user.suspend": "Compte suspendu",
  "user.reactivate": "Compte réactivé",
  "user.status": "Statut modifié",
  "quota.update": "Quota modifié",
  "quota.grant": "Bonus accordé",
  "quota.reset": "Compteur remis à zéro",
  "quota.global": "Quotas globaux modifiés",
  "quotas.global": "Quotas globaux modifiés",
  "key.revoke": "Jeton révoqué",
  "job.cancel": "Conversion annulée",
  "conversion.cancel": "Conversion annulée",
  "settings.update": "Réglages modifiés",
  "admin.access_denied": "Accès refusé au Control Center",
};
export const TARGET_TYPE_LABEL: Record<string, string> = { user: "Utilisateur", key: "Jeton", job: "Conversion", setting: "Réglage", quota: "Quota" };

/** Motifs de refus d'authentification (agrégés) : libellé connu, sinon le code. */
export const AUTH_REASON: Record<string, string> = {
  unknown: "Jeton inconnu",
  unknown_key: "Jeton inconnu",
  invalid: "Jeton invalide",
  invalid_key: "Jeton invalide",
  malformed: "Jeton mal formé",
  missing: "Jeton absent",
  revoked: "Jeton révoqué",
  expired: "Jeton expiré",
  suspended: "Compte suspendu",
  user_suspended: "Compte suspendu",
  rate_limited: "Trop de tentatives",
};

/** Métriques déclarées « non mesurées » par le serveur (docs/ADMIN.md §8). */
export const METRIC_LABEL: Record<string, string> = {
  cpu: "CPU des conteneurs",
  memory: "Mémoire des conteneurs",
  ram: "Mémoire des conteneurs",
  network: "Trafic réseau",
  bandwidth: "Trafic réseau",
  bytesServed: "Volume servi",
  avgDurationS: "Durée moyenne",
  durationByPlatform: "Durée par plateforme",
  p90S: "Durée (90e centile)",
  signups: "Inscriptions",
  conversions: "Conversions",
  formats: "Formats",
  topErrors: "Erreurs les plus fréquentes",
  quota: "Utilisation des quotas",
  successByPlatform: "Réussite par plateforme",
};
export const metricLabel = (k: string) => METRIC_LABEL[k] ?? k;

/** Libellé de cible lisible (type + identifiant raccourci). */
export function shortId(id: string | null | undefined, n = 8): string {
  if (!id) return "—";
  return id.length > n + 2 ? `${id.slice(0, n)}…` : id;
}
