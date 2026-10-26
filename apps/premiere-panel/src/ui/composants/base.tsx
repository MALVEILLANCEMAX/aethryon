// Composants de base du panneau (DESIGN-SYSTEM §6). L'élément natif est toujours dessous (button, input, select,
// role="switch") : clavier et lecteurs d'écran fonctionnent sans script supplémentaire.

import type { ComponentChildren, JSX } from "preact";
import { TRACES, type NomIcone } from "../icones";
import type { EtatMedia } from "../../lib/bibliotheque";
import { LIBELLE_ETAT } from "../../lib/bibliotheque";
import petitLogo from "../../assets/marque/aethryon-petit.svg";
import maitre from "../../assets/marque/aethryon-master.svg";
import logotype from "../../assets/marque/aethryon-logotype-marcellus-ivoire.svg";

export function Icone({ nom, taille = 16, classe = "" }: { nom: NomIcone; taille?: number; classe?: string }) {
  return (
    <svg
      class={"ico " + classe}
      width={taille}
      height={taille}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={(32 / taille).toFixed(2)}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      // Tracés statiques du paquet (jamais une donnée reçue).
      dangerouslySetInnerHTML={{ __html: TRACES[nom] }}
    />
  );
}

export function Chouette({ taille = 20, maitreLogo = false }: { taille?: number; maitreLogo?: boolean }) {
  return <img class="chouette" src={maitreLogo || taille > 24 ? maitre : petitLogo} width={taille} height={taille} alt="" aria-hidden="true" draggable={false} />;
}

/** Logotype officiel (contours Marcellus) : hauteur = 1,0425 × capitales ; largeur = 8,5528 × hauteur. */
export function Logotype({ capitales = 9.5 }: { capitales?: number }) {
  const h = +(capitales * 1.0425).toFixed(2);
  return <img class="logotype" src={logotype} height={h} width={+(h * 8.5528).toFixed(1)} alt="AETHRYON" draggable={false} />;
}

type VarianteBouton = "principal" | "secondaire" | "discret" | "danger";

export function Bouton(p: {
  variante?: VarianteBouton;
  icone?: NomIcone;
  enfants?: ComponentChildren;
  children?: ComponentChildren;
  onClick?: (e: MouseEvent) => void;
  desactive?: boolean;
  raison?: string;
  bloc?: boolean;
  petit?: boolean;
  type?: "button" | "submit";
  titre?: string;
  classe?: string;
}) {
  return (
    <button
      type={p.type || "button"}
      class={`btn btn--${p.variante || "secondaire"}${p.bloc ? " btn--bloc" : ""}${p.petit ? " btn--petit" : ""} ${p.classe || ""}`}
      onClick={p.desactive ? undefined : p.onClick}
      aria-disabled={p.desactive ? "true" : undefined}
      title={p.desactive ? p.raison : p.titre}
    >
      {p.icone && <Icone nom={p.icone} taille={16} />}
      <span class="btn__txt">{p.children ?? p.enfants}</span>
    </button>
  );
}

export function BoutonIcone(p: { icone: NomIcone; libelle: string; onClick?: (e: MouseEvent) => void; classe?: string; actif?: boolean; taille?: number; desactive?: boolean }) {
  return (
    <button
      type="button"
      class={`bi ${p.classe || ""}${p.actif ? " est-actif" : ""}`}
      aria-label={p.libelle}
      title={p.libelle}
      aria-pressed={p.actif === undefined ? undefined : p.actif ? "true" : "false"}
      aria-disabled={p.desactive ? "true" : undefined}
      onClick={p.desactive ? undefined : p.onClick}
    >
      <Icone nom={p.icone} taille={p.taille || 16} />
    </button>
  );
}

export function Segmente<T extends string>(p: { valeur: T; options: { valeur: T; libelle: string; compte?: number }[]; onChange: (v: T) => void; libelle: string; plein?: boolean }) {
  const surTouche = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = p.options.findIndex((o) => o.valeur === p.valeur);
    const j = (i + (e.key === "ArrowRight" ? 1 : p.options.length - 1)) % p.options.length;
    p.onChange(p.options[j]!.valeur);
    const parent = (e.currentTarget as HTMLElement);
    requestAnimationFrame(() => (parent.querySelectorAll("button")[j] as HTMLElement | undefined)?.focus());
  };
  return (
    <div class={`seg${p.plein ? " seg--plein" : ""}`} role="radiogroup" aria-label={p.libelle} onKeyDown={surTouche}>
      {p.options.map((o) => (
        <button type="button" role="radio" aria-checked={o.valeur === p.valeur ? "true" : "false"} tabIndex={o.valeur === p.valeur ? 0 : -1} class={o.valeur === p.valeur ? "est-actif" : ""} onClick={() => p.onChange(o.valeur)}>
          {o.libelle}
          {o.compte !== undefined && <span class="seg__n tab">{o.compte}</span>}
        </button>
      ))}
    </div>
  );
}

export function Interrupteur(p: { actif: boolean; onChange: (v: boolean) => void; libelle: string; desactive?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={p.actif ? "true" : "false"}
      aria-label={p.libelle}
      aria-disabled={p.desactive ? "true" : undefined}
      class={`inter${p.actif ? " est-actif" : ""}`}
      onClick={p.desactive ? undefined : () => p.onChange(!p.actif)}
    >
      <span class="inter__pastille" />
    </button>
  );
}

/** Liste déroulante native (fiable dans CEP : jamais rognée par les bords du panneau), habillée en pilule. */
export function Choix<T extends string>(p: { valeur: T; options: { valeur: T; libelle: string }[]; onChange: (v: T) => void; libelle: string; prefixe?: string; icone?: NomIcone; compact?: boolean; desactive?: boolean }) {
  const courant = p.options.find((o) => o.valeur === p.valeur);
  return (
    <label class={`choix${p.compact ? " choix--icone" : ""}${p.desactive ? " est-desactive" : ""}`} title={p.libelle}>
      {p.icone && <Icone nom={p.icone} taille={16} />}
      {!p.compact && (
        <span class="choix__txt">
          {p.prefixe && <span class="choix__pre">{p.prefixe}</span>}
          {courant?.libelle}
        </span>
      )}
      {!p.compact && <Icone nom="chevron-down" taille={16} classe="choix__chev" />}
      <select aria-label={p.libelle} value={p.valeur} disabled={p.desactive} onChange={(e) => p.onChange((e.currentTarget as HTMLSelectElement).value as T)}>
        {p.options.map((o) => (
          <option value={o.valeur}>{o.libelle}</option>
        ))}
      </select>
    </label>
  );
}

/** Pastille d'état : la forme, le mot et la couleur portent chacun le sens (jamais la couleur seule). */
export function IconeEtat({ etat, progression = 0, taille = 12 }: { etat: EtatMedia; progression?: number; taille?: number }) {
  const s = taille;
  const c = s / 2;
  const r = s / 2 - 1.75;
  if (etat === "disponible") return <svg class="ietat" width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden="true"><circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" stroke-width="1.5" /></svg>;
  if (etat === "en-cours") {
    const L = 2 * Math.PI * r;
    const on = progression > 0 ? L * Math.min(1, progression) : L * 0.28;
    return (
      <svg class={`ietat${progression > 0 ? "" : " ietat--tourne"}`} width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden="true">
        <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" stroke-opacity=".28" stroke-width="1.75" />
        <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-dasharray={`${on.toFixed(2)} ${L.toFixed(2)}`} transform={`rotate(-90 ${c} ${c})`} />
      </svg>
    );
  }
  if (etat === "importe") return <svg class="ietat" width={s} height={s} viewBox="0 0 12 12" aria-hidden="true"><path d="M2.4 6.4l2.4 2.4 4.9-5.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>;
  if (etat === "introuvable") return <svg class="ietat" width={s} height={s} viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="1.9 1.6" /></svg>;
  return <svg class="ietat" width={s} height={s} viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="currentColor" /><path d="M6 3.3v3.3M6 8.4v.3" stroke="var(--ae-obsidian)" stroke-width="1.5" stroke-linecap="round" /></svg>;
}

export function Pastille({ etat, progression }: { etat: EtatMedia; progression?: number }) {
  return (
    <span class={`pastille pastille--${etat}`}>
      <IconeEtat etat={etat} progression={progression} />
      {LIBELLE_ETAT[etat]}
    </span>
  );
}

export function Progression({ valeur, etat = "actif", libelle }: { valeur: number | null; etat?: "actif" | "erreur" | "fini" | "attente"; libelle: string }) {
  const v = valeur == null ? null : Math.max(0, Math.min(1, valeur));
  return (
    <div class={`prog prog--${etat}${v == null ? " prog--indet" : ""}`} role="progressbar" aria-label={libelle} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v == null ? undefined : Math.round(v * 100)}>
      <i style={v == null ? undefined : { transform: `scaleX(${v})` }} />
    </div>
  );
}

/** Fil d'or (DESIGN-SYSTEM §1.2) : plein = relié, pointillé = pas relié. */
export function Fil({ relie, compact = false }: { relie: boolean; compact?: boolean }) {
  return (
    <svg class={`fil${relie ? " fil--relie" : ""}`} width={compact ? 20 : 26} height="10" viewBox="0 0 26 10" aria-hidden="true">
      <circle cx="4" cy="5" r="2.6" fill={relie ? "currentColor" : "none"} stroke="currentColor" stroke-width="1.4" />
      <path d="M7.5 5h11" stroke="currentColor" stroke-width="1.6" stroke-dasharray={relie ? undefined : "1.6 2.2"} stroke-linecap="round" />
      <circle cx="22" cy="5" r="2.6" fill={relie ? "currentColor" : "none"} stroke="currentColor" stroke-width="1.4" />
    </svg>
  );
}

export function EtatVide(p: { titre: string; texte?: ComponentChildren; actions?: ComponentChildren; note?: ComponentChildren; figure?: JSX.Element }) {
  return (
    <div class="vide">
      {p.figure ?? <Chouette taille={40} maitreLogo />}
      <h2 class="vide__titre">{p.titre}</h2>
      {p.texte && <p class="vide__texte">{p.texte}</p>}
      {p.actions && <div class="vide__actions">{p.actions}</div>}
      {p.note && <p class="vide__note">{p.note}</p>}
    </div>
  );
}

/** Onde décorative d'un son (aucun décodage) : déterministe à partir de l'identifiant. */
export function Onde({ graine, barres = 36 }: { graine: string; barres?: number }) {
  let h = 0;
  for (let i = 0; i < graine.length; i++) h = (h * 31 + graine.charCodeAt(i)) | 0;
  const valeurs: number[] = [];
  for (let i = 0; i < barres; i++) {
    h = (h * 1103515245 + 12345) | 0;
    const enveloppe = Math.sin((Math.PI * (i + 0.5)) / barres);
    valeurs.push(0.18 + 0.82 * enveloppe * (0.45 + ((h >>> 8) % 1000) / 1800));
  }
  return (
    <svg class="onde" viewBox={`0 0 ${barres * 4} 40`} preserveAspectRatio="none" aria-hidden="true">
      {valeurs.map((v, i) => (
        <rect x={i * 4 + 1} y={20 - v * 18} width="2" height={v * 36} rx="1" />
      ))}
    </svg>
  );
}
