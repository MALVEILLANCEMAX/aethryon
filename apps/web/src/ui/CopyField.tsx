// Affichage d'un secret (jeton) avec copie. La copie part d'un geste explicite (clic) : Clipboard API,
// puis repli execCommand('copy') sur la sélection, puis consigne de copie manuelle.
import { useRef, useState } from "react";
import { cn } from "../lib/cn.ts";
import { Button } from "./Button.tsx";
import { CopyCheckIcon } from "./IconMorph.tsx";

export async function copyText(text: string, fallbackEl?: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* repli ci-dessous */ }
  if (fallbackEl) {
    fallbackEl.focus();
    fallbackEl.select();
    fallbackEl.setSelectionRange(0, text.length);
    try { if (document.execCommand("copy")) return true; } catch { /* repli manuel */ }
  }
  return false;
}

interface Props { value: string; label: string; onCopied?: () => void; onCopyFailed?: () => void; className?: string }

export function CopyField({ value, label, onCopied, onCopyFailed, className }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const copy = async () => {
    const ok = await copyText(value, input.current);
    if (ok) { setState("copied"); onCopied?.(); }
    else {
      setState("manual");
      input.current?.select();
      onCopyFailed?.();
    }
  };
  return (
    <div className={className}>
      <label className="text-sm font-medium text-ink-soft" htmlFor="secret-field">{label}</label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="secret-field"
          ref={input}
          readOnly
          value={value}
          spellCheck={false}
          autoComplete="off"
          onFocus={(e) => e.currentTarget.select()}
          className="h-12 min-w-0 flex-1 rounded-[14px] border border-field bg-white/80 px-3.5 font-mono text-[13.5px] tracking-tight text-ink selection:bg-gold-light"
        />
        <Button variant={state === "copied" ? "secondary" : "primary"} onClick={copy} icon={<CopyCheckIcon done={state === "copied"} size={18} className={state === "copied" ? "text-ok" : undefined} />} className={cn("sm:w-[200px]")}>
          {state === "copied" ? "Jeton copié" : "Copier le jeton"}
        </Button>
      </div>
      {state === "manual" && (
        <p className="mt-2 text-sm text-warn">La copie automatique est bloquée par le navigateur : le jeton est sélectionné, copie-le avec « Copier » ou Ctrl/⌘ + C.</p>
      )}
    </div>
  );
}
