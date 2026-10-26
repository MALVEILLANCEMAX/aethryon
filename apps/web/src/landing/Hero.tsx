// Héros AETHRYON V2 (refonte visuelle du 2026-10-11) : obsidienne quadrillée, la promesse en deux phrases
// (« Un lien entre. Un fichier sort. », reprise du film de marque), puis le produit lui-même : un champ où coller un
// lien, reconnu sur l'appareil, avec le parcours animé. Sous le champ, les plateformes (repères selon lib/logos.ts) ;
// les formats ont leur section (« Ce qui sort »). Puis le film de lancement AETHRYON 3.5 (38 s, lecture muette à
// l'écran, son à la demande), comme sur ton-piston.com. Une seule nouveauté annoncée, dans la pastille du haut. Décor :
// quadrillage, croisillons, petites flèches, cube grec en 3D rétro (grand écran). Mouvement réduit : aucune entrée
// animée, pas de démonstration tapée, cube immobile.
import { useCallback, useState } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { useCalm, useConfig } from "../lib/hooks.ts";
import { cn } from "../lib/cn.ts";
import { PLATFORMS, type PlatformId } from "../lib/brand.ts";
import { DUR, EASE } from "../lib/motion.ts";
import { isStaticBoot } from "../lib/prerender.ts";
import { PlatformMark } from "../ui/brand/PlatformMark.tsx";
import { Arrow } from "../ui/Arrows.tsx";
import { RetroObject } from "../ui/retro/RetroObject.tsx";
import { Film } from "./v2/Film.tsx";
import { LinkProbe } from "./v2/LinkProbe.tsx";

export function PlatformBand({ active = null, tone = "dark", className }: { active?: PlatformId | null; tone?: "dark" | "light"; className?: string }) {
  const cfg = useConfig();
  return (
    <ul aria-label="Plateformes prises en charge" className={cn("flex flex-wrap items-center justify-center gap-2.5", className)} data-platform-band="">
      {PLATFORMS.map((p) => {
        const paused = cfg.data?.platforms?.[p.configKey] === false;
        return (
          <li key={p.id}>
            <span className={cn("chip-logo", tone === "light" && "chip-light", paused && "opacity-60")} data-on={active === p.id ? "" : undefined} data-platform={p.id}>
              <PlatformMark id={p.id} size={18} tone={tone} />
              {p.name}
              {paused && <span className="text-[12px] font-normal text-mist">· en pause</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function Hero() {
  const calm = useCalm() || isStaticBoot();
  const [active, setActive] = useState<PlatformId | null>(null);
  const onPlatform = useCallback((p: PlatformId | null) => setActive(p), []);
  const enter = (i: number) => (calm ? {} : {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: DUR.reveal, ease: EASE.soft, delay: 0.05 + i * 0.08 },
  });

  return (
    <section aria-labelledby="hero-title" className="hero-night -mt-px pb-20 pt-28 sm:pb-24 sm:pt-36" data-hero="">
      {/* Repères décoratifs : absents sur petit écran, où ils tomberaient sur l'annonce et le titre. */}
      <span aria-hidden className="hero-cross left-[12%] top-[22%] hidden sm:block" />
      <span aria-hidden className="hero-cross right-[16%] top-[14%] hidden sm:block" />
      <span aria-hidden className="hero-cross bottom-[18%] left-[22%] hidden md:block" />
      <span aria-hidden className="hero-cross bottom-[30%] right-[9%] hidden md:block" />
      {/* Cube grec (relique de la marque) : grand écran seulement, hors du texte. */}
      <div aria-hidden className="pointer-events-none absolute right-[3%] top-[23%] hidden xl:block 2xl:right-[8%]">
        <RetroObject kind="cube" size="lg" className="retro-plinth" follow />
      </div>

      <div className="container-site relative flex flex-col items-center text-center">
        <motion.div {...enter(0)}>
          <Link to="/outils" className="hero-pill" data-hero-pill="">
            <span className="hero-pill-tag"><span className="hero-pill-dot" />Nouveau</span>
            AETHRYON Tools, l'atelier en ligne
            <Arrow shape="coin" className="size-4" />
          </Link>
        </motion.div>

        <motion.h1 {...enter(1)} id="hero-title" className="mt-8 font-display text-[clamp(2.9rem,1.6rem+5.2vw,6.2rem)] font-medium leading-[0.98] tracking-[-0.025em] text-ivory">
          <span className="block">Un lien entre.</span>
          <span className="block text-gold-light">Un fichier sort.</span>
        </motion.h1>
        <motion.p {...enter(2)} className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-mist sm:text-lead">
          YouTube, TikTok et X en vidéo, en son ou en GIF, depuis ton iPhone, ton navigateur ou Discord.
        </motion.p>

        <motion.div {...enter(3)} className="relative mt-10 w-full max-w-[720px] text-left">
          <Arrow shape="courbe" className="absolute -left-[88px] -top-[30px] hidden h-[56px] w-[72px] lg:block" delayed />
          <Arrow shape="boucle" className="absolute -right-[84px] top-[44px] hidden h-[72px] w-[64px] scale-x-[-1] lg:block" delayed />
          <LinkProbe onPlatform={onPlatform} />
        </motion.div>

        <motion.div {...enter(4)} className="mt-8 flex flex-col items-center gap-4">
          <PlatformBand active={active} />
        </motion.div>

        {/* Le film de lancement, sous le champ, comme la démonstration de ton-piston.com (lecture muette à l'écran,
            son à la demande) ; ancre #demo de la navigation. */}
        <motion.div {...enter(5)} className="mt-14 w-full max-w-[960px] sm:mt-16" data-hero-film="">
          <Film />
        </motion.div>
      </div>
    </section>
  );
}
