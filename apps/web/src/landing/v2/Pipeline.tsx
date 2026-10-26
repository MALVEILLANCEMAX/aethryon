// Le parcours en une image animée : repère de la plateforme → chouette AETHRYON → fichier (MP4 ou MP3) →
// « enregistré ». Démonstration (aucune requête) : ce que fait le service, sans paragraphe. Les étapes sont des
// attributs data-* (CSS : visuel-v2.css « pipeline ») ; en mouvement réduit, la dernière étape s'affiche d'emblée.
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { useCalm } from "../../lib/hooks.ts";
import type { PlatformId } from "../../lib/brand.ts";
import { PlatformMark } from "../../ui/brand/PlatformMark.tsx";
import { OwlMark } from "../../ui/brand/OwlMark.tsx";
import { IconCheck, IconFilm, IconMusic } from "../../ui/Icon.tsx";

const NAMES: Record<PlatformId, string> = { youtube: "YouTube", tiktok: "TikTok", x: "X" };
/** Instants (ms) de chaque étape : lien, transmission, fichier, enregistré. */
const AT = [0, 450, 1250, 2350] as const;

export function usePipeline(play: boolean, loop: boolean, key: unknown): number {
  const calm = useCalm();
  const [step, setStep] = useState(calm ? 3 : 0);
  useEffect(() => {
    if (calm) { setStep(3); return; }
    if (!play) return;
    setStep(0);
    let timers: number[] = [];
    const run = () => {
      timers = AT.map((t, i) => window.setTimeout(() => setStep(i), t));
      if (loop) timers.push(window.setTimeout(run, AT[3] + 2600));
    };
    run();
    return () => timers.forEach(clearTimeout);
  }, [play, loop, key, calm]);
  return step;
}

export function Pipeline({ platform, fmt, step, size = "md", tone = "dark", className }: {
  platform: PlatformId;
  fmt: "mp4" | "mp3";
  step: number;
  size?: "sm" | "md" | "lg";
  tone?: "dark" | "light";
  className?: string;
}) {
  const where = fmt === "mp4" ? "Photos" : "Fichiers";
  return (
    <div className={cn("pipeline", `pipeline-${size}`, tone === "light" && "pipeline-light", className)} data-step={step} data-fmt={fmt}
      role="img" aria-label={`Démonstration : un lien ${NAMES[platform]} devient un fichier ${fmt.toUpperCase()}, enregistré dans ${where}.`}>
      <span className="pipe-node pipe-source" data-on={step >= 0 ? "" : undefined}>
        <PlatformMark id={platform} size={size === "lg" ? 30 : 22} tone={tone} />
        <span className="pipe-cap">{NAMES[platform]}</span>
      </span>
      <span className="pipe-wire" data-on={step >= 1 ? "" : undefined}><span /></span>
      <span className="pipe-node pipe-owl" data-on={step >= 1 ? "" : undefined} data-busy={step === 1 || step === 2 ? "" : undefined}>
        <OwlMark size={size === "lg" ? 40 : 30} />
      </span>
      <span className="pipe-wire" data-on={step >= 2 ? "" : undefined}><span /></span>
      <span className="pipe-node pipe-file" data-on={step >= 2 ? "" : undefined} data-done={step >= 3 ? "" : undefined}>
        <span className="pipe-file-icon">{fmt === "mp4" ? <IconFilm size={size === "lg" ? 22 : 18} /> : <IconMusic size={size === "lg" ? 22 : 18} />}</span>
        <span className="pipe-file-text">
          <b>{fmt.toUpperCase()}</b>
          <span className="pipe-bar"><span /></span>
        </span>
        <span className="pipe-check"><IconCheck size={14} /></span>
      </span>
      <span className="pipe-saved" data-on={step >= 3 ? "" : undefined}>Enregistré · {where}</span>
    </div>
  );
}
