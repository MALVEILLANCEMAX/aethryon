// « Ce qui sort » : le parcours animé en grand (trois démonstrations qui s'enchaînent, choisies aussi à la main),
// puis les deux formats réellement proposés, chacun porté par sa relique 3D (disquette : MP4 ; disque : MP3), et
// les adresses acceptées par le service (ytapi : ALLOWED_DOMAINS). Obsidienne, peu de texte.
import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "motion/react";
import { cn } from "../../lib/cn.ts";
import { useCalm } from "../../lib/hooks.ts";
import { inView, reveal, revealGroup } from "../../lib/motion.ts";
import { PLATFORMS, type PlatformId } from "../../lib/brand.ts";
import { PlatformMark } from "../../ui/brand/PlatformMark.tsx";
import { RetroObject } from "../../ui/retro/RetroObject.tsx";
import { Arrow } from "../../ui/Arrows.tsx";
import { Pipeline, usePipeline } from "./Pipeline.tsx";
import { SectionHead } from "./SectionHead.tsx";

const DEMOS: readonly { platform: PlatformId; fmt: "mp4" | "mp3" }[] = [
  { platform: "tiktok", fmt: "mp4" },
  { platform: "youtube", fmt: "mp3" },
  { platform: "x", fmt: "mp4" },
];

/** Adresses acceptées (ytapi/app/config.py ALLOWED_DOMAINS et urls.py), pour se repérer. */
const ACCEPTED: Record<PlatformId, string> = {
  youtube: "youtube.com · youtu.be · Shorts",
  tiktok: "tiktok.com · vm.tiktok.com",
  x: "x.com · twitter.com",
};

export function Formats() {
  const calm = useCalm();
  const stage = useRef<HTMLDivElement>(null);
  const seen = useInView(stage, { amount: 0.5 });
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const demo = DEMOS[i] ?? DEMOS[0]!;
  const step = usePipeline(seen, false, `${i}`);

  // Enchaînement automatique tant que le visiteur n'a rien choisi.
  useEffect(() => {
    if (!seen || !auto || calm) return;
    const t = window.setTimeout(() => setI((v) => (v + 1) % DEMOS.length), 5200);
    return () => clearTimeout(t);
  }, [seen, auto, calm, i]);

  return (
    <section id="formats" aria-labelledby="formats-title" className="section-night seam relative overflow-hidden py-24 sm:py-32">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_35%_at_50%_30%,rgb(212_175_124/0.1),transparent_70%)]" />
      <div className="container-site relative">
        <SectionHead id="formats-title" title="Ce qui sort." center tone="dark" />

        <div ref={stage} className="mx-auto mt-12 max-w-[760px] rounded-[30px] border border-white/10 bg-white/[0.03] px-5 pb-6 pt-8 sm:px-10 sm:pt-10" data-formats-stage="">
          <Pipeline platform={demo.platform} fmt={demo.fmt} step={step} size="lg" />
          <div role="tablist" aria-label="Exemples" className="mt-8 flex flex-wrap justify-center gap-2">
            {DEMOS.map((d, k) => (
              <button key={d.platform} type="button" role="tab" aria-selected={k === i} onClick={() => { setAuto(false); setI(k); }}
                className={cn("chip-logo h-11", k === i && "border-gold")} data-on={k === i ? "" : undefined}>
                <PlatformMark id={d.platform} size={16} tone="dark" />
                {PLATFORMS.find((p) => p.id === d.platform)?.name} → {d.fmt.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <motion.div variants={revealGroup} {...inView("formats-cartes")} className="mt-6 grid gap-4 md:grid-cols-2">
          <motion.article variants={reveal} className="format-card" data-format="mp4">
            <RetroObject kind="disquette" label="MP4" size="md" className="format-object retro-plinth" />
            <div>
              <p className="format-name">MP4</p>
              <p className="format-what">La vidéo, en qualité automatique : lisible partout.</p>
              <ul className="format-where"><li>Photos sur iPhone</li><li>Téléchargements sur ordinateur</li></ul>
            </div>
          </motion.article>
          <motion.article variants={reveal} className="format-card" data-format="mp3">
            <RetroObject kind="disque" label="MP3" size="md" className="format-object retro-plinth" />
            <div>
              <p className="format-name">MP3</p>
              <p className="format-what">Le son seul, avec son titre.</p>
              <ul className="format-where"><li>Fichiers sur iPhone</li><li>Téléchargements sur ordinateur</li></ul>
            </div>
          </motion.article>
        </motion.div>

        <ul className="mt-10 flex flex-col items-center gap-3 text-[13.5px] text-mist sm:flex-row sm:justify-center sm:gap-8" aria-label="Liens acceptés">
          {PLATFORMS.map((p) => (
            <li key={p.id} className="inline-flex items-center gap-2.5"><PlatformMark id={p.id} size={15} tone="dark" className="text-ivory" />{ACCEPTED[p.id]}</li>
          ))}
        </ul>
        <div aria-hidden className="mt-10 flex justify-center"><Arrow shape="bas" className="h-10 w-4" /></div>
      </div>
    </section>
  );
}
