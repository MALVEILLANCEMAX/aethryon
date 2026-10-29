// Bouton de copie PARTAGÉ (empreinte SHA-256, commandes, liens) : principes du « Copy button » d'Arc UI (MIT),
// réécrits pour AETHRYON.
// - Icône copie → coche (IconMorph) ; libellé « Copier » / « Copié » / « Échec » dans une cellule qui réserve la
//   largeur du plus long : rien ne se décale.
// - UNE annonce, dans une région de statut VOISINE du bouton (jamais dedans, jamais de toast en plus).
// - Repli si le presse-papiers est refusé : zone de texte temporaire + execCommand ; sinon, le texte visé est
//   sélectionné et la consigne Ctrl/⌘ + C est annoncée.
// - Retour au repos après 2 s ; minuteur nettoyé au démontage.
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn.ts";
import { CopyCheckIcon } from "./IconMorph.tsx";

type State = "idle" | "copied" | "failed";

/** Copie un texte : Clipboard API, puis zone de texte temporaire (styles posés par CSSOM : permis par la CSP). */
export async function copyPlain(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* repli ci-dessous */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  ta.style.pointerEvents = "none";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  return ok;
}

interface Props {
  text: string;
  /** Nom accessible du bouton (« Copier l'empreinte SHA-256 »). */
  label: string;
  /** Annonce après une copie réussie (« Empreinte SHA-256 copiée »). */
  copied: string;
  /** « icon » : bouton rond (lignes de commande) ; « label » : icône + libellé visible. */
  variant?: "icon" | "label";
  /** Élément dont le texte est sélectionné si la copie automatique échoue. */
  target?: () => HTMLElement | null;
  className?: string;
}

const LABELS: Record<State, string> = { idle: "Copier", copied: "Copié", failed: "Échec" };

export function CopyButton({ text, label, copied, variant = "icon", target, className }: Props) {
  const [state, setState] = useState<State>("idle");
  const [said, setSaid] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    window.clearTimeout(timer.current);
    const ok = await copyPlain(text);
    if (ok) {
      setState("copied");
      setSaid(copied);
    } else {
      setState("failed");
      const el = target?.();
      if (el) window.getSelection()?.selectAllChildren(el);
      setSaid(`Copie impossible${" "}: ${el ? "le texte est sélectionné, " : "sélectionne le texte, puis "}copie-le avec Ctrl ou ⌘ + C.`);
    }
    timer.current = window.setTimeout(() => { setState("idle"); setSaid(""); }, ok ? 2000 : 5000);
  };

  const done = state === "copied";
  return (
    <>
      {variant === "icon" ? (
        <button type="button" onClick={copy} aria-label={label} data-copy={state}
          className={cn("grid size-11 shrink-0 place-items-center rounded-full transition-colors hover:bg-sand/60",
            done ? "text-ok" : state === "failed" ? "text-warn" : "text-ink-soft hover:text-ink", className)}>
          <CopyCheckIcon done={done} />
        </button>
      ) : (
        <button type="button" onClick={copy} aria-label={label} data-copy={state}
          className={cn("inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-ui font-medium transition-colors",
            done ? "border-ok/30 bg-ok-bg text-ok" : state === "failed" ? "border-warn/30 bg-warn-bg text-warn" : "border-line bg-ivory text-ink hover:border-line-strong hover:bg-white",
            className)}>
          <CopyCheckIcon done={done} size={17} />
          {/* Les trois libellés occupent la même cellule : la largeur est celle du plus long, sans décalage. */}
          <span aria-hidden className="grid">
            {(Object.keys(LABELS) as State[]).map((k) => (
              <span key={k} data-on={k === state ? "" : undefined}
                className="col-start-1 row-start-1 translate-y-1 opacity-0 transition-[opacity,translate] duration-180 ease-[var(--ease-soft)] data-on:translate-y-0 data-on:opacity-100 motion-reduce:translate-y-0">
                {LABELS[k]}
              </span>
            ))}
          </span>
        </button>
      )}
      <span role="status" className="sr-only">{said}</span>
    </>
  );
}
