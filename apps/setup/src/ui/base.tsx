// Composants de base (DESIGN-SYSTEM.md §6), transposés des fonctions de rendu des maquettes (sources/js/ui.js).
// L'élément natif est toujours dessous (button, input, role="switch") : clavier et lecteurs d'écran inchangés.
import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { TRACES, type NomIcone } from "./traces";

export function Icone({ nom, taille = 18, className, style }: { nom: NomIcone; taille?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg
      className={`ico${className ? " " + className : ""}`}
      width={taille}
      height={taille}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={(32 / taille).toFixed(2)}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
      dangerouslySetInnerHTML={{ __html: TRACES[nom] }}
    />
  );
}

type Variante = "primary" | "secondary" | "ghost" | "danger";

export function Bouton({ variante = "secondary", taille, icone, kbd, chevron, bloc, className, children, ...rest }: {
  variante?: Variante;
  taille?: "sm" | "lg";
  icone?: NomIcone;
  kbd?: string;
  chevron?: boolean;
  bloc?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = ["btn", `btn--${variante}`, taille ? `btn--${taille}` : "", bloc ? "btn--block" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} {...rest}>
      {icone && <Icone nom={icone} taille={taille === "sm" ? 16 : 18} />}
      {children}
      {kbd && <span className="kbd" style={{ marginLeft: 4 }}>{kbd}</span>}
      {chevron && <Icone nom="chevron-down" taille={16} />}
    </button>
  );
}

export function BoutonIcone({ nom, libelle, taille, surMedia, actif, className, ...rest }: {
  nom: NomIcone;
  libelle: string;
  taille?: "sm" | "xs";
  surMedia?: boolean;
  actif?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const t = taille === "sm" ? 16 : taille === "xs" ? 14 : 18;
  const cls = ["iconbtn", taille ? `iconbtn--${taille}` : "", surMedia ? "iconbtn--onmedia" : "", actif ? "is-active" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} aria-label={libelle} data-bulle={libelle} {...rest}>
      <Icone nom={nom} taille={t} />
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export type EtatPastille = "available" | "running" | "imported" | "missing" | "error" | "ok" | "warn" | "quiet";

/** Pictogramme d'état : la forme porte le sens (jamais la couleur seule). */
export function IconeEtat({ etat, pct = 0, taille = 12 }: { etat: EtatPastille; pct?: number; taille?: number }) {
  const s = taille;
  const c = s / 2;
  const r = s / 2 - 1.75;
  if (etat === "available") return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden="true"><circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
  if (etat === "running") {
    const L = 2 * Math.PI * r;
    const on = (L * Math.max(0, Math.min(100, pct))) / 100;
    return (
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden="true" className={pct ? undefined : "tourne"}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeOpacity=".28" strokeWidth="1.75" />
        <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeDasharray={`${(pct ? on : L * 0.3).toFixed(2)} ${L.toFixed(2)}`} transform={`rotate(-90 ${c} ${c})`} />
      </svg>
    );
  }
  if (etat === "imported" || etat === "ok") return <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden="true"><path d="M2.4 6.4l2.4 2.4 4.9-5.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (etat === "missing") return <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.9 1.6" /></svg>;
  if (etat === "error" || etat === "warn") return <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="currentColor" /><path d="M6 3.4v3.2M6 8.4v.2" stroke="#0f0f10" strokeWidth="1.5" strokeLinecap="round" /></svg>;
  return null;
}

const LIBELLES: Record<string, string> = { available: "Disponible", running: "En cours", imported: "Importé", missing: "Introuvable", error: "Erreur" };

export function Pastille({ etat, libelle, pct, grande, icone = true }: { etat: EtatPastille; libelle?: string; pct?: number | null; grande?: boolean; icone?: boolean }) {
  let texte = libelle ?? LIBELLES[etat] ?? "";
  if (etat === "running" && pct != null && !libelle) texte = `En cours · ${Math.round(pct)} %`;
  return (
    <span className={`pill pill--${etat}${grande ? " pill--lg" : ""}`}>
      {icone && etat !== "quiet" && etat !== "ok" && <IconeEtat etat={etat} pct={pct ?? 0} taille={grande ? 13 : 12} />}
      {texte}
    </span>
  );
}

export function Interrupteur({ actif, onChange, libelle, disabled, raison }: { actif: boolean; onChange: (v: boolean) => void; libelle: string; disabled?: boolean; raison?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      aria-label={libelle}
      title={disabled ? raison : undefined}
      disabled={disabled}
      className={`switch${actif ? " on" : ""}`}
      onClick={() => onChange(!actif)}
    />
  );
}

export interface OptionSegment<T extends string> {
  id: T;
  libelle: string;
  n?: number;
}

/** Contrôle segmenté : la pastille glisse (ressort « glide ») ; flèches gauche et droite au clavier. */
export function Segmente<T extends string>({ options, valeur, onChange, libelle }: { options: OptionSegment<T>[]; valeur: T; onChange: (v: T) => void; libelle: string }) {
  const boite = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ x: number; l: number } | null>(null);
  useLayoutEffect(() => {
    const b = boite.current?.querySelector<HTMLButtonElement>(`button[data-id="${valeur}"]`);
    if (b) setInd({ x: b.offsetLeft, l: b.offsetWidth });
  }, [valeur, options.map((o) => o.libelle + (o.n ?? "")).join("|")]);
  const clavier = (e: KeyboardEvent) => {
    const i = options.findIndex((o) => o.id === valeur);
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = options[(i + d + options.length) % options.length];
    onChange(n.id);
    boite.current?.querySelector<HTMLButtonElement>(`button[data-id="${n.id}"]`)?.focus();
  };
  return (
    <div className="seg seg--anime" role="group" aria-label={libelle} ref={boite} onKeyDown={clavier}>
      {ind && <i className="seg-ind" style={{ transform: `translateX(${ind.x - 3}px)`, width: ind.l }} aria-hidden="true" />}
      {options.map((o) => (
        <button key={o.id} type="button" data-id={o.id} aria-pressed={o.id === valeur} tabIndex={o.id === valeur ? 0 : -1} onClick={() => onChange(o.id)}>
          {o.libelle}
          {o.n != null && <span className="n">{o.n}</span>}
        </button>
      ))}
    </div>
  );
}

export function Progression({ valeur, variante, libelle }: { valeur: number | null; variante?: "bad" | "ok" | "wait"; libelle: string }) {
  const indet = valeur == null && variante !== "wait";
  return (
    <div
      className={`progress${variante ? " progress--" + variante : ""}${indet ? " progress--indet" : ""}`}
      role="progressbar"
      aria-label={libelle}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={valeur != null ? Math.round(valeur * 100) : undefined}
      aria-valuetext={libelle}
    >
      <i style={{ ["--p" as string]: valeur ?? 0 }} />
    </div>
  );
}

/** Fil d'or : plein = relié ; pointillé = non relié. */
export function Fil({ relie }: { relie: boolean }) {
  return <div className={`thread${relie ? "" : " off"}`} />;
}
