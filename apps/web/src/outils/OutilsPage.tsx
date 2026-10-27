// AETHRYON / Tools (/outils, page publique pré-rendue) : « Un lien. Toutes les possibilités. » Un seul panneau d'entrée
// (lien ou fichier), cinq outils RÉELS (chacun ouvre l'éditeur sur lui-même), les médias encore gardés pour le compte
// connecté, et les règles dites une fois : où se fait le traitement, combien de temps rien n'est gardé, ce que ça coûte.
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { cn } from "../lib/cn.ts";
import { useCalm, useDocumentTitle, useMe } from "../lib/hooks.ts";
import { DUR, EASE } from "../lib/motion.ts";
import { isStaticBoot } from "../lib/prerender.ts";
import { useResource } from "../lib/store.ts";
import { IconShield, IconHourglass, IconBolt, IconFolder } from "../ui/Icon.tsx";
import type { ToolsJob, ToolsLimits } from "./api.ts";
import { TOOL_ORDER, type Tool } from "./edit.ts";
import { Intake, type IntakeHandle } from "./Intake.tsx";
import { IconCompress, IconCrop, IconCut, IconGif, IconUpload, IconWave } from "./icons.tsx";
import { Recents } from "./Recents.tsx";

const TOOL_TEXT: Record<Tool, { name: string; line: string; limit: string; Icon: typeof IconCut }> = {
  couper: { name: "Couper", line: "Garde le passage voulu, à l'image près, en MP4, MOV, MKV ou WebM.", limit: "jusqu'à 15 min exportées", Icon: IconCut },
  recadrer: { name: "Recadrer", line: "16:9, 9:16, 1:1, 4:5 ou libre\u00a0; tourne et retourne l'image.", limit: "jusqu'à la 4K", Icon: IconCrop },
  audio: { name: "Audio", line: "Extrais le son en MP3, M4A, WAV, OGG ou FLAC, avec volume et fondus.", limit: "jusqu'à 60 min", Icon: IconWave },
  gif: { name: "GIF", line: "Un passage en GIF\u00a0: largeur et images par seconde au choix.", limit: "30 s au plus", Icon: IconGif },
  compresser: { name: "Compresser", line: "Vise une taille (Discord, messagerie, courriel) et vois un échantillon réel avant.", limit: "8 Mo à 100 Mo", Icon: IconCompress },
};

export default function OutilsPage() {
  useDocumentTitle("Tools");
  const calm = useCalm() || isStaticBoot();
  const me = useMe();
  const signedIn = !!me.data && !me.error;
  const media = useResource<{ items: ToolsJob[]; limits: ToolsLimits }>(signedIn ? "/api/outils/medias" : null, 20_000);
  const intake = useRef<IntakeHandle>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const enter = (i: number) => (calm ? {} : {
    initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: DUR.reveal, ease: EASE.soft, delay: 0.05 + i * 0.08 },
  });

  // Glisser-déposer n'importe où sur la page.
  useEffect(() => {
    const has = (e: globalThis.DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    const onEnter = (e: globalThis.DragEvent) => { if (!has(e)) return; depth.current += 1; setDragging(true); };
    const onLeave = (e: globalThis.DragEvent) => { if (!has(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); };
    const onOver = (e: globalThis.DragEvent) => { if (has(e)) e.preventDefault(); };
    const onDrop = (e: globalThis.DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) intake.current?.openFile(f);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  const choose = (t: Tool) => {
    setTool(t);
    document.getElementById("entree")?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
    window.setTimeout(() => intake.current?.focus(), calm ? 0 : 380);
  };

  const remaining = me.data?.today && !me.data.today.unlimited ? me.data.today.remaining ?? null : null;
  const limits = media.data?.limits ?? null;
  const keepH = limits?.keepMin ? Math.round(limits.keepMin / 60) : 2;
  const keepMaxH = limits?.keepMaxMin ? Math.round(limits.keepMaxMin / 60) : 6;

  return (
    <>
      <section aria-labelledby="outils-titre" className="hero-night outils-hero -mt-px pb-16 pt-28 sm:pb-20 sm:pt-36" data-outils-hero="">
        <span aria-hidden className="hero-cross left-[10%] top-[24%] hidden sm:block" />
        <span aria-hidden className="hero-cross right-[12%] top-[16%] hidden sm:block" />
        <span aria-hidden className="hero-cross bottom-[22%] right-[18%] hidden md:block" />
        <div className="container-site relative flex flex-col items-center text-center">
          <motion.p {...enter(0)} className="outils-mark">AETHRYON <span aria-hidden="true">/</span> Tools</motion.p>
          <motion.h1 {...enter(1)} id="outils-titre" className="mt-6 font-display text-[clamp(2.7rem,1.5rem+5vw,5.6rem)] font-medium leading-[0.98] tracking-[-0.025em] text-fg">
            <span className="block">Un lien.</span>
            <span className="block">Toutes les possibilités.</span>
          </motion.h1>
          <motion.p {...enter(2)} className="mt-6 max-w-[36rem] text-[17px] leading-relaxed text-fg-2 sm:text-lead">
            Coupe, recadre, extrais le son, fais un GIF ou compresse, à partir d'un lien YouTube, TikTok ou X, ou d'un fichier.
          </motion.p>
          <motion.div {...enter(3)} id="entree" className="relative mt-10 w-full max-w-[760px] text-left">
            {tool && (
              <p className="outils-chosen">Outil choisi&nbsp;: <b>{TOOL_TEXT[tool].name}</b> <button type="button" className="outils-chosen-x" onClick={() => setTool(null)}>changer</button></p>
            )}
            <Intake ref={intake} tool={tool} limits={limits} remaining={remaining} />
          </motion.div>
        </div>
        {dragging && (
          <div className="outils-drop" aria-hidden="true">
            <span className="outils-drop-box"><IconUpload size={30} /><span>Lâche ton fichier pour l'ouvrir dans l'éditeur</span></span>
          </div>
        )}
      </section>

      <section aria-labelledby="outils-liste" className="section-light outils-tools">
        <div className="container-site">
          <h2 id="outils-liste" className="outils-h2">Cinq outils, un seul atelier.</h2>
          <ul className="tool-grid">
            {TOOL_ORDER.map((t) => {
              const x = TOOL_TEXT[t];
              return (
                <li key={t}>
                  <button type="button" className={cn("tool-tile", tool === t && "is-on")} onClick={() => choose(t)} aria-pressed={tool === t} data-tool-tile={t}>
                    <span className="tool-tile-ico"><x.Icon size={24} /></span>
                    <span className="tool-tile-name">{x.name}</span>
                    <span className="tool-tile-line">{x.line}</span>
                    <span className="tool-tile-limit">{x.limit}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {signedIn && <Recents items={media.data?.items ?? null} loading={media.loading} reload={media.reload} keepH={keepH} keepMaxH={keepMaxH} />}

      <section aria-labelledby="outils-regles" className="section-light outils-rules">
        <div className="container-site">
          <h2 id="outils-regles" className="outils-h2">Ce qu'il faut savoir</h2>
          <ul className="rule-grid">
            <li><IconHourglass size={22} /><p><b>Gardé {keepH} h.</b> Après ta dernière action ({keepMaxH} h au plus), le média et ses exports sont effacés, ou plus tôt lors d'une mise à jour du service.</p></li>
            <li><IconFolder size={22} /><p><b>Une conversion par média.</b> Ouvrir un lien ou importer un fichier compte une fois ; ses exports sont inclus.</p></li>
            <li><IconShield size={22} /><p><b>À toi seul.</b> Seul ton compte y accède. N'importe que ce que tu as le droit d'utiliser.</p></li>
            <li><IconBolt size={22} /><p><b>Sans service tiers.</b> L'aperçu se joue dans ton navigateur, l'export se fait sur le serveur d'AETHRYON.</p></li>
          </ul>
          <p className="outils-limits">Fichiers jusqu'à {limits?.maxUploadMb ? `${limits.maxUploadMb >= 1024 ? `${limits.maxUploadMb / 1024} Go` : `${limits.maxUploadMb} Mo`}` : "1 Go"} et {Math.round((limits?.maxDurationS ?? 3600) / 60)}&nbsp;min · vidéo exportée jusqu'à {Math.round((limits?.videoMaxS ?? 900) / 60)}&nbsp;min · GIF {limits?.gifMaxS ?? 30}&nbsp;s · MP4, MOV, WebM, MKV, MP3, M4A, WAV, OGG, FLAC. <Link to="/aide" className="underline decoration-line-strong underline-offset-4 hover:decoration-ink">Aide</Link></p>
        </div>
      </section>
    </>
  );
}

