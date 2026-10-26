// Dates « métier » : le quota quotidien se remet à zéro à minuit, heure de Paris.
const TZ = "Europe/Paris";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** Jour AAAA-MM-JJ à Paris pour l'instant donné. */
export function parisDay(at: Date = new Date()): string {
  return dayFmt.format(at);
}

/** Instant du prochain minuit à Paris (gère les changements d'heure). */
export function nextParisMidnight(at: Date = new Date()): Date {
  const today = parisDay(at);
  // Cherche la première minute dont le jour parisien diffère, par pas d'une heure puis d'une minute.
  let t = at.getTime();
  const hour = 3_600_000;
  while (parisDay(new Date(t)) === today) t += hour;
  t -= hour;
  while (parisDay(new Date(t)) === today) t += 60_000;
  const d = new Date(t);
  d.setUTCSeconds(0, 0);
  return d;
}

export function nowIso(): string {
  return new Date().toISOString();
}
