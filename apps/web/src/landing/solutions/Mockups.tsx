// Maquettes des cartes produit de l'accueil (landing/v2/Surfaces.tsx), refaites le 2026-10-13 À PARTIR DES VRAIES
// INTERFACES (docs/DESIGN.md §7) : mêmes textes, mêmes contrôles, mêmes états que le produit, en HTML/SVG nets à toute
// taille. Un même exemple traverse les trois (« Coucher de soleil sur la côte », une vidéo TikTok fictive), et chacune
// le dit (« Exemple »). Décoratives pour les lecteurs d'écran : la carte dit tout en texte.
// - iPhone : la feuille de partage, l'action AETHRYON avec la VRAIE icône du raccourci (gris foncé, flèche de
//   téléchargement : raccourci-site/shortcut/src/AETHRYON.cherri), le menu réel (MENU), puis l'alerte réelle
//   « Vidéo enregistrée dans Photos : … ».
// - Extension : la bulle de l'extension (extension/src/content, captures de <notes internes non publiées>) :
//   Format MP4/MP3, Qualité Auto/1080p/720p/480p, « Télécharger », puis « Conversion… » et « Enregistré » ; la pastille
//   chouette sous la vidéo suit les mêmes états.
// - Discord : la carte RÉELLE du bot v2 (discord/src/v2/ui.ts) : « CONVERSION » avec sa barre ▰▱, puis « MÉDIA PRÊT »,
//   le fichier joint, les boutons Enregistrer / Source / Faire un GIF…, la ligne du quota ; logo officiel de Discord,
//   non modifié, dans la présentation du bot (licence des Developer Terms, docs/MARQUES.md).
// Démonstration : UNE fois, quand la carte arrive à l'écran ; jamais au pré-rendu, jamais en mouvement réduit.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useInView } from "motion/react";
import { cn } from "../../lib/cn.ts";
import { useCalm } from "../../lib/hooks.ts";
import { MENU, SHORTCUT_NAME } from "../../lib/brand.ts";
import { DISCORD_PUBLIC } from "../../lib/discord.ts";
import { OwlMark } from "../../ui/brand/OwlMark.tsx";
import { DiscordMark, PlatformGlyph } from "../../ui/brand/PlatformGlyph.tsx";
import { IconArrowUpRight, IconCheck, IconDownload, IconLock, IconPlay } from "../../ui/Icon.tsx";

const EXEMPLE = "Coucher de soleil sur la côte";

/** Étapes jouées une fois à l'arrivée à l'écran (délais en ms) ; `rest` : étape du pré-rendu et du mouvement réduit. */
function useSteps(ref: React.RefObject<HTMLElement | null>, delays: number[], rest: number): number {
  const calm = useCalm();
  const seen = useInView(ref, { once: true, amount: 0.55 });
  const [step, setStep] = useState(rest);
  useEffect(() => {
    if (!seen || calm) return;
    setStep(0);
    const ids = delays.map((d, i) => window.setTimeout(() => setStep(i + 1), d));
    return () => ids.forEach((id) => window.clearTimeout(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, calm]);
  return step;
}

/** Mention honnête posée sur la maquette. */
function Tag({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return <span className={cn("pv-tag", light && "is-light")}>{children}</span>;
}

/** Image de la vidéo d'exemple : un coucher de soleil dessiné (aucune image réelle de tiers). */
function Poster({ className, play = true }: { className?: string; play?: boolean }) {
  return (
    <span aria-hidden className={cn("pv-poster", className)}>
      <span className="pv-poster-sun" /><span className="pv-poster-sea" />
      {play && <span className="pv-poster-play"><IconPlay size={14} /></span>}
    </span>
  );
}

/** Icône RÉELLE du raccourci AETHRYON dans l'app Raccourcis : tuile gris foncé, flèche de téléchargement. */
export function ShortcutGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 64 64" className="pv-shortcut">
      <rect width="64" height="64" rx="15" className="pv-shortcut-tile" />
      <path d="M32 15v24m-10-10 10 10 10-10M20 47h24" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---- iPhone ---------------------------------------------------------------------------------------------------
// Étapes : 0 feuille de partage · 1 menu du raccourci · 2 MP4 choisi · 3 alerte « Vidéo enregistrée dans Photos ».
export function MockIphone() {
  const root = useRef<HTMLElement>(null);
  const step = useSteps(root, [700, 1500, 2600], 2);
  return (
    <figure ref={root} className="pv pv-iphone" data-mock="ios" data-step={step}>
      <div className="pv-phone" aria-hidden="true">
        <div className="pv-screen">
          <span className="pv-island" />
          <div className="pv-app">
            <Poster className="pv-app-poster" />
            <span className="pv-app-bar"><span /></span>
          </div>
          <div className="pv-sheet">
            <div className="pv-sheet-head">
              <Poster className="pv-sheet-thumb" play={false} />
              <span className="pv-sheet-meta"><b>{EXEMPLE}</b><span>tiktok.com</span></span>
            </div>
            <div className="pv-sheet-apps">{[0, 1, 2, 3].map((i) => <span key={i} />)}</div>
            <ul className="pv-sheet-actions">
              <li><span>Copier</span><span className="pv-sheet-ico" /></li>
              <li className="is-hit"><span>{SHORTCUT_NAME}</span><ShortcutGlyph size={22} /></li>
              <li><span className="pv-line" /><span className="pv-sheet-ico" /></li>
            </ul>
          </div>
          <span className="pv-dim" />
          <div className="pv-menu">
            <p className="pv-menu-title">{SHORTCUT_NAME}</p>
            <p className="pv-menu-row is-on">{MENU.mp4}<IconCheck size={13} /></p>
            <p className="pv-menu-row">{MENU.mp3}</p>
          </div>
          <div className="pv-alert">
            <p className="pv-alert-title">{SHORTCUT_NAME}</p>
            <p className="pv-alert-text">Vidéo enregistrée dans Photos : {EXEMPLE}</p>
            <p className="pv-alert-ok">OK</p>
          </div>
        </div>
      </div>
      <Tag>Exemple · le vrai menu du raccourci</Tag>
    </figure>
  );
}

// ---- Extension ------------------------------------------------------------------------------------------------
// Étapes : 0 bulle ouverte · 1 « Télécharger » pressé · 2 conversion en cours · 3 enregistré.
export function MockBrowser() {
  const root = useRef<HTMLElement>(null);
  const step = useSteps(root, [900, 1300, 2700], 0);
  const busy = step === 1 || step === 2;
  const done = step === 3;
  return (
    <figure ref={root} className="pv pv-ext" data-mock="extension" data-step={step}>
      <div className="pv-window" aria-hidden="true">
        <div className="pv-window-bar">
          <span className="pv-dots"><span /><span /><span /></span>
          <span className="pv-address"><IconLock size={10} />tiktok.com/@atelier/video/…</span>
        </div>
        <div className="pv-page">
          <Poster className="pv-page-video" />
          <div className="pv-page-actions">
            <span className="pv-pill" /><span className="pv-pill" />
            <span className={cn("pv-ext-pill", done && "is-done")}>
              <span className="pv-owl-disc"><OwlMark size={13} surface="dark" /></span>
              {done ? "Enregistré" : busy ? (step === 1 ? "0 %" : "64 %") : "Télécharger"}
            </span>
          </div>
        </div>
      </div>
      <div className="pv-pop" aria-hidden="true">
        <div className="pv-pop-head">
          <span className="pv-owl-disc is-lg"><OwlMark size={15} surface="dark" /></span>
          <span className="pv-pop-brand">AETHRYON</span>
          <span className="pv-pop-platform"><PlatformGlyph id="tiktok" size={11} />TikTok</span>
        </div>
        <p className="pv-pop-title">{EXEMPLE}</p>
        <p className="pv-pop-label">Format</p>
        <div className="pv-seg"><span className="is-on">MP4</span><span>MP3</span></div>
        <p className="pv-pop-label">Qualité</p>
        <div className="pv-chips"><span className="is-on">Auto</span><span>1080p</span><span>720p</span><span>480p</span></div>
        <span className={cn("pv-pop-btn", step === 1 && "is-pressed")}><IconDownload size={13} />Télécharger</span>
        <div className={cn("pv-pop-status", busy && "is-busy", done && "is-done")}>
          {done ? <><IconCheck size={13} />Enregistré</> : <>Conversion… {step === 1 ? 0 : 64} %<span className="pv-pop-bar"><span /></span></>}
        </div>
      </div>
      <Tag>Exemple · la bulle réelle de l'extension</Tag>
    </figure>
  );
}

// ---- Discord --------------------------------------------------------------------------------------------------
// Étapes : 0 « En file d'attente » · 1 « Téléchargement… » ▰▰▰▰▰▱▱▱▱▱ · 2 « MÉDIA PRÊT ».
export function MockDiscord() {
  const root = useRef<HTMLElement>(null);
  const step = useSteps(root, [700, 1900], 2);
  const done = step === 2;
  return (
    <figure ref={root} className="pv pv-discord" data-mock="discord" data-state={step}>
      <div className="pv-dc">
        <div className="pv-dc-bar">
          <span className="pv-dc-hash">#</span><span>général</span>
          {/* Présentation du bot : logo officiel de Discord, non modifié, avec son nom (registre lib/platforms.ts). */}
          <span className="pv-dc-mark" data-discord-mark=""><DiscordMark tone="white" height={18} />Discord</span>
        </div>
        <div className="pv-dc-body" aria-hidden="true">
          <p className="pv-dc-cmd"><span className="pv-dc-elbow" /><span className="pv-dc-av is-user" /><span><b>Léa</b> a utilisé <span className="pv-dc-slash">/convert</span></span></p>
          <div className="pv-dc-msg">
            <span className="pv-dc-av"><OwlMark size={20} surface="dark" /></span>
            <div className="min-w-0 flex-1">
              <p className="pv-dc-name">AETHRYON <span className="pv-dc-app">APP</span></p>
              <div key={step} className={cn("pv-dc-card", step < 2 && "is-progress")}>
                <p className="pv-dc-head"><span className="pv-dc-head-owl"><OwlMark size={11} surface="dark" /></span>AETHRYON · {done ? "MÉDIA PRÊT" : "CONVERSION"}</p>
                {done ? (
                  <>
                    <p className="pv-dc-title">{EXEMPLE}</p>
                    <p className="pv-dc-sub">TikTok · MP4 · 3,1 Mo</p>
                    <Poster className="pv-dc-video" />
                    <p className="pv-dc-ok">✓ Ton fichier est prêt.</p>
                    <p className="pv-dc-btns"><span>⭐ Enregistrer</span><span>Source<IconArrowUpRight size={11} /></span><span>Faire un GIF…</span></p>
                    <p className="pv-dc-foot">AETHRYON · 9 conversions restantes aujourd'hui · ni le lien ni le titre ne sont conservés</p>
                  </>
                ) : (
                  <>
                    <p className="pv-dc-title">{step === 0 ? "En file d'attente" : "Téléchargement…"}</p>
                    <p className="pv-dc-sub">TikTok · MP4{step === 1 && <><br /><span className="pv-dc-bar-text">▰▰▰▰▰▱▱▱▱▱ 48 %</span></>}</p>
                    <p className="pv-dc-foot">Ce message se met à jour tout seul. Il n'est visible que par toi.</p>
                  </>
                )}
              </div>
              <p className="pv-dc-only">Visible seulement par toi</p>
            </div>
          </div>
        </div>
      </div>
      <Tag light>{DISCORD_PUBLIC ? "Exemple · la carte réelle du bot" : "Exemple · la carte réelle du bot, en test privé"}</Tag>
    </figure>
  );
}
