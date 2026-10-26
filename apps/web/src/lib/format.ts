// Formats d'affichage en français.
const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

export const fmtDate = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const fmtDateTime = (iso: string | null | undefined) => (iso ? dateTimeFmt.format(new Date(iso)) : "—");
export const fmtTime = (iso: string | null | undefined) => (iso ? timeFmt.format(new Date(iso)) : "—");

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "jamais";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 31) return `il y a ${d} j`;
  return fmtDate(iso);
}

export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
