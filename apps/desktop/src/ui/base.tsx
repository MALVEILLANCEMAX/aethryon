// Composants de base sur Égide (lot 2) : mêmes signatures qu'avant pour toutes les pages, rendu par les composants du
// socle (design/css/composants.css) : .eg-btn (principal, secondaire, discret, icône), .eg-touche, .eg-pastille,
// .eg-interrupteur, .eg-seg, le fil (.eg-fil) et le méandre (attente sans chouette). L'élément natif est toujours
// dessous (button, input, role="switch") : clavier et lecteurs d'écran inchangés.
// Icônes : le jeu Égide (design/src/icones.ts, grille 24, trait 1,6) dès qu'une icône y a son équivalent ; les autres
// gardent leur tracé d'origine (même grille, même trait) — aucune marque tierce dessinée.
import type { ButtonHTMLAttributes, CSSProperties, KeyboardEvent, ReactNode } from "react";
import { ICONES, type NomIcone as NomEgide } from "../lib/egide";
import { TRACES, type NomIcone as NomTrace } from "./traces";

export type NomIcone = NomTrace | NomEgide;

/** Équivalents Égide des icônes d'avant (mêmes sens, jeu commun aux plateformes). */
const EGIDE: Partial<Record<NomTrace, NomEgide>> = {
  home: "convertir", library: "biblio", transfers: "fil", link: "lien", settings: "reglages", search: "cherche", sort: "trier", grid: "grille",
  list: "liste", play: "lecture", pause: "pause", monitor: "fenetre", import: "importer", download: "convertir", folder: "dossier", reveal: "dossier",
  copy: "copier", external: "ouvrir", convert: "convertir", check: "ok", close: "croix", alert: "alerte", info: "info", clock: "horloge",
  retry: "retour", film: "video", audio: "son", image: "image", log: "fichier", theme: "theme", "chevron-down": "bas", "chevron-right": "chevron",
  plus: "plus", "picto-montage": "chutier", "picto-browser": "navigateur", note: "musique", user: "compte", paste: "coller",
};

const estEgide = (n: string): n is NomEgide => Object.prototype.hasOwnProperty.call(ICONES, n);

export function Icone({ nom, taille = 18, className, style }: { nom: NomIcone; taille?: number; className?: string; style?: CSSProperties }) {
  const e = estEgide(nom) ? nom : EGIDE[nom as NomTrace];
  const commun = {
    className: `ico${className ? " " + className : ""}`, width: taille, height: taille, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    strokeWidth: taille <= 14 ? 2 : 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, focusable: false, style,
  };
  if (e) {
    const formes = ICONES[e] as readonly (readonly [string, Readonly<Record<string, string>>])[];
    return <svg {...commun}>{formes.map(([Tag, a], i) => { const T = Tag as "path"; return <T key={i} {...(a as Record<string, string>)} />; })}</svg>;
  }
  return <svg {...commun} dangerouslySetInnerHTML={{ __html: TRACES[nom as NomTrace] }} />;
}

/** Méandre d'Égide : attente indéterminée SANS chouette, dans un bouton ou une ligne. */
export function Meandre() {
  return <svg className="eg-meandre" viewBox="0 0 22 14" aria-hidden="true" focusable="false"><path d="M1 13V1h20v12H6V6h10v4h-5" /></svg>;
}

type Variante = "primary" | "secondary" | "ghost" | "danger";
const VARIANTES: Record<Variante, string> = { primary: "eg-btn--principal", secondary: "eg-btn--secondaire", ghost: "eg-btn--discret", danger: "eg-btn--danger" };

export function Bouton({ variante = "secondary", taille, icone, kbd, chevron, bloc, occupe, className, children, ...rest }: {
  variante?: Variante;
  taille?: "sm" | "lg";
  icone?: NomIcone;
  kbd?: string;
  chevron?: boolean;
  bloc?: boolean;
  /** Action en cours (état « chargement ») : le méandre à la place de l'icône, aria-busy. */
  occupe?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = ["eg-btn", VARIANTES[variante], taille === "sm" ? "eg-btn--petit" : taille === "lg" ? "eg-btn--grand" : "", bloc ? "eg-btn--bloc" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} aria-busy={occupe || undefined} {...rest}>
      {occupe ? <Meandre /> : icone && <Icone nom={icone} taille={taille === "sm" ? 15 : 17} />}
      {children}
      {kbd && <span className="eg-touche" aria-hidden="true">{kbd}</span>}
      {chevron && <Icone nom="chevron-down" taille={15} />}
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
  const cls = ["eg-btn eg-btn--icone", taille === "sm" ? "eg-btn--petit" : taille === "xs" ? "eg-btn--xs" : "", surMedia ? "eg-btn--sur-media" : "", actif ? "eg-btn--actif" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} aria-label={libelle} data-bulle={libelle} {...rest}>
      <Icone nom={nom} taille={t} />
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="eg-touche">{children}</span>;
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
  if (etat === "error" || etat === "warn") return <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M6 3.6v2.9M6 8.3v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
  return null;
}

const LIBELLES: Record<string, string> = { available: "Disponible", running: "En cours", imported: "Importé", missing: "Introuvable", error: "Erreur" };
const TONS: Record<EtatPastille, string> = { available: "neutre", running: "accent", imported: "ok", ok: "ok", missing: "neutre", error: "err", warn: "warn", quiet: "neutre" };

/** Pastille d'état Égide : ton (sens) + pictogramme (forme) + mot. */
export function Pastille({ etat, libelle, pct, grande, icone = true }: { etat: EtatPastille; libelle?: string; pct?: number | null; grande?: boolean; icone?: boolean }) {
  let texte = libelle ?? LIBELLES[etat] ?? "";
  if (etat === "running" && pct != null && !libelle) texte = `En cours · ${Math.round(pct)} %`;
  return (
    <span className={`eg-pastille${grande ? "" : " eg-pastille--petite"}`} data-ton={TONS[etat]} data-etat={etat} data-forme={etat === "missing" ? "pointilles" : undefined}>
      {icone && etat !== "quiet" && <IconeEtat etat={etat} pct={pct ?? 0} taille={grande ? 13 : 12} />}
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
      className="eg-interrupteur"
      onClick={() => onChange(!actif)}
    />
  );
}

export interface OptionSegment<T extends string> {
  id: T;
  libelle: string;
  n?: number;
}

/** Segments Égide (2 à 4 choix exclusifs) : aria-pressed, flèches gauche et droite au clavier. */
export function Segmente<T extends string>({ options, valeur, onChange, libelle }: { options: OptionSegment<T>[]; valeur: T; onChange: (v: T) => void; libelle: string }) {
  const clavier = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = options.findIndex((o) => o.id === valeur);
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = options[(i + d + options.length) % options.length];
    onChange(n.id);
    e.currentTarget.querySelector<HTMLButtonElement>(`button[data-id="${n.id}"]`)?.focus();
  };
  return (
    <div className="eg-seg seg" role="group" aria-label={libelle} onKeyDown={clavier}>
      {options.map((o) => (
        <button key={o.id} type="button" data-id={o.id} aria-pressed={o.id === valeur} tabIndex={o.id === valeur ? 0 : -1} onClick={() => onChange(o.id)}>
          {o.libelle}
          {o.n != null && <span className="n">{o.n}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Le fil d'Égide : la piste, le ruban et le nœud de tête glissent en translateX (interpolation linéaire de 260 ms entre
 * deux mesures RÉELLES, aucune progression inventée). Valeur inconnue : la piste seule et un court ruban qui passe.
 */
export function Progression({ valeur, variante, libelle, epais }: { valeur: number | null; variante?: "bad" | "ok" | "wait"; libelle: string; epais?: boolean }) {
  const p = valeur == null ? 0 : Math.max(0, Math.min(1, valeur));
  const indet = valeur == null && variante !== "wait";
  const decale = { transform: `translateX(${((p - 1) * 100).toFixed(2)}%)` };
  return (
    <div
      className={`eg-fil eg-fil--d${epais ? " eg-fil--epais" : ""}${variante ? " eg-fil--" + variante : ""}${indet ? " eg-fil--indet" : ""}`}
      data-p={p === 0 ? "0" : undefined}
      role="progressbar"
      aria-label={libelle}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={valeur != null ? Math.round(valeur * 100) : undefined}
      aria-valuetext={libelle}
    >
      <div className="eg-fil-piste"><div className="eg-fil-run" style={indet ? undefined : decale} /></div>
      {!indet && <div className="eg-fil-tete" style={decale} />}
    </div>
  );
}

/** Fil de liaison : plein = relié ; pointillé = non relié. */
export function Fil({ relie }: { relie: boolean }) {
  return <div className={`thread${relie ? "" : " off"}`} />;
}
