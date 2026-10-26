// Les façons d'utiliser AETHRYON (docs/DESIGN.md §7) : trois cartes obsidienne de même hauteur, chacune avec
// son statut honnête, une ligne utile (les navigateurs, les commandes…), UNE action, et l'interface réelle du produit
// qui monte depuis le bas de la carte (landing/solutions/Mockups.tsx). Relief discret au survol (pointeur fin).
// Puis AETHRYON Tools (l'atelier du site, en bande : il n'a pas d'appareil à installer) et un bandeau : un seul compte
// pour tout, avec les vraies limites du service (lues dans /api/config).
import { useEffect, useRef, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { motion, useInView } from "motion/react";
import { cn } from "../../lib/cn.ts";
import { useCalm, useConfig, useMe } from "../../lib/hooks.ts";
import { inView, reveal, revealGroup } from "../../lib/motion.ts";
import { EXTENSION_AVAILABLE, EXTENSION_STATUS } from "../../lib/extension.ts";
import { DISCORD_INSTALL, DISCORD_PUBLIC, DISCORD_STATUS } from "../../lib/discord.ts";
import { OFFICIAL_LOGOS } from "../../lib/logos.ts";
import type { RegistryId } from "../../lib/platforms.ts";
import { PlatformMark } from "../../ui/brand/PlatformMark.tsx";
import { OwlMark } from "../../ui/brand/OwlMark.tsx";
import { PremiereMark } from "../../ui/brand/PremiereMark.tsx";
import { ButtonA, ButtonLink } from "../../ui/Button.tsx";
import { IconArrowRight, IconArrowUpRight } from "../../ui/Icon.tsx";
import { useTilt } from "../../ui/useTilt.ts";
import { MockBrowser, MockDiscord, MockIphone } from "../solutions/Mockups.tsx";
import { InstallQr } from "../../ui/InstallQr.tsx";
import { useSiteOrigin } from "../../lib/prerender.ts";
import { DEFAULT_SOLUTION, isSolution, type SolutionId } from "../../lib/solutions.ts";
import { SectionHead } from "./SectionHead.tsx";
import { IconCompress, IconCrop, IconCut, IconGif, IconWave } from "../../outils/icons.tsx";

type Tone = "ok" | "beta" | "dev";

/** Sur ordinateur, on n'installe pas le raccourci ici : le QR code ouvre le guide d'installation sur l'iPhone. */
function InstallFromDesktop() {
  const url = `${useSiteOrigin()}/installer`;
  return (
    <div className="surface-qr" data-install-qr="">
      <InstallQr url={url} className="size-[84px] shrink-0" />
      <p>Sur ordinateur&nbsp;: scanne-le avec ton iPhone pour installer.</p>
    </div>
  );
}

/** Installateur Windows d'AETHRYON pour Premiere Pro (extension + Desktop), servi par /downloads/premiere/
 *  (scripts/fetch-downloads.sh, empreinte vérifiée). */
export const PREMIERE_SETUP = "/downloads/premiere/AETHRYON-Setup-2.0.0-beta.8.exe";

function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cn("surface-status", `is-${tone}`)}><span aria-hidden className="surface-status-dot" />{children}</span>;
}

function Card({ id, panel, focus, marks, name, status, tone, title, meta, action, extra, children }: {
  id: string;
  /** Identifiant du lien direct /?solution=… ; `focus` : c'est la surface visée. */
  panel: SolutionId;
  focus: { id: SolutionId; explicit: boolean };
  marks: RegistryId[];
  name: string;
  status: string;
  tone: Tone;
  title: string;
  /** Une ligne utile, en clair (navigateurs pris en charge, commandes…). */
  meta: ReactNode;
  action: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  const calm = useCalm();
  const ref = useRef<HTMLElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.35 });
  useTilt(ref);
  return (
    <motion.article ref={ref} variants={reveal} className={cn("surface-card", focus.explicit && focus.id === panel && "is-focus")} data-surface-card={id} data-entered={seen && !calm ? "" : undefined} aria-labelledby={`surface-${id}`}>
      <div className="surface-copy">
        <header className="surface-head">
          <span className="surface-name">
            <span className="surface-marks">{marks.map((m) => <PlatformMark key={m} id={m} size={18} bot={m === "discord"} tone="dark" />)}</span>
            {name}
          </span>
          <Status tone={tone}>{status}</Status>
        </header>
        <h3 id={`surface-${id}`} className="surface-title">{title}</h3>
        <div className="surface-meta">{meta}</div>
        <div className="surface-action">{action}</div>
      </div>
      <div className="surface-visual" data-panel={focus.id === panel ? panel : undefined}>{children}{extra}</div>
    </motion.article>
  );
}

/** Puces en texte (noms des navigateurs, commandes) : usage nominatif, aucun logo de marque (docs/MARQUES.md). */
function Chips({ items, mono = false, label }: { items: string[]; mono?: boolean; label: string }) {
  return (
    <ul className="surface-chips" aria-label={label}>
      {items.map((t) => <li key={t} className={cn(mono && "is-mono")}>{t}</li>)}
    </ul>
  );
}

export function Surfaces() {
  const cfg = useConfig();
  const me = useMe();
  const signedIn = !!me.data && !me.error;
  const q = cfg.data?.quotas;
  // Lien direct (/?solution=…, ancien sélecteur de solutions) : la surface visée est marquée, et l'accueil y défile.
  const [params] = useSearchParams();
  const asked = params.get("solution");
  const focus = { id: isSolution(asked) ? asked : DEFAULT_SOLUTION, explicit: isSolution(asked) };
  useEffect(() => {
    if (!focus.explicit) return;
    // Après le défilement natif vers l'ancre (#solutions) : sinon il l'emporte sur celui-ci.
    const t = window.setTimeout(() => {
      const el = document.querySelector(`[data-panel="${focus.id}"]`)?.closest("[data-surface-card], [data-account-strip]");
      el?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }, 450);
    return () => clearTimeout(t);
  }, [focus.explicit, focus.id]);
  // Navigateurs : le logo de Chrome en mode « logos officiels », sinon le pictogramme « navigateur ».
  const browserMarks: RegistryId[] = OFFICIAL_LOGOS ? ["chrome", "brave"] : ["chrome"];
  return (
    <section id="surfaces" aria-labelledby="surfaces-title" className="section-light seam py-24 sm:py-32">
      {/* Ancienne ancre de l'accueil (« Solutions ») : les liens /#solutions arrivent ici. */}
      <span id="solutions" aria-hidden="true" className="block" />
      <div className="container-site">
        <SectionHead id="surfaces-title" title="Quatre façons de l'utiliser." lead="Un seul compte : le même quota, le même historique, partout." />
        <motion.div variants={revealGroup} {...inView("surfaces")} className="surface-grid mt-12 sm:mt-14">
          <Card id="iphone" panel="ios" focus={focus} marks={["iphone"]} name="Raccourci iPhone" status="Disponible" tone="ok"
            title="Depuis la feuille de partage."
            meta={<p className="surface-flow"><span>Partager</span><span aria-hidden>›</span><span>AETHRYON</span><span aria-hidden>›</span><span>MP4 · MP3</span></p>}
            action={<ButtonLink to="/installer" variant="light" size="sm" className="h-11" trailing={<IconArrowRight size={16} />}>Installer le raccourci</ButtonLink>}
            extra={<InstallFromDesktop />}>
            <MockIphone />
          </Card>
          <Card id="extension" panel="extension" focus={focus} marks={browserMarks} name="Extension navigateur" status={EXTENSION_AVAILABLE ? "Disponible" : EXTENSION_STATUS.label} tone={EXTENSION_AVAILABLE ? "ok" : "dev"}
            title="Un bouton sous chaque vidéo."
            meta={<Chips label="Navigateurs pris en charge" items={["Chrome", "Edge", "Brave"]} />}
            action={<ButtonLink to="/extension" variant="light" size="sm" className="h-11" trailing={<IconArrowRight size={16} />}>{EXTENSION_AVAILABLE ? "Installer l'extension" : "Découvrir l'extension"}</ButtonLink>}>
            <MockBrowser />
          </Card>
          <Card id="discord" panel="discord" focus={focus} marks={["discord"]} name="Bot Discord" status={DISCORD_STATUS.label} tone={DISCORD_PUBLIC ? "ok" : "dev"}
            title="/convert, sans quitter ton serveur."
            meta={<Chips mono label="Commandes du bot" items={["/convert", "/audio", "/clip", "/gif"]} />}
            action={DISCORD_PUBLIC ? (
              // Liens RÉELS de Discord (lib/discord.ts) : sur son compte (partout), ou sur un serveur (administrateurs).
              <>
                <ButtonA href={DISCORD_INSTALL.user} target="_blank" rel="noopener noreferrer" variant="light" size="sm" className="h-11" trailing={<IconArrowUpRight size={16} />} data-install="user">
                  Ajouter à Discord<span className="sr-only"> (discord.com, nouvel onglet)</span>
                </ButtonA>
                <a href={DISCORD_INSTALL.guild} target="_blank" rel="noopener noreferrer" className="surface-alt" data-install="guild">
                  Sur un serveur<span className="sr-only"> (discord.com, nouvel onglet)</span>
                </a>
              </>
            ) : <ButtonLink to="/#feuille-de-route" variant="night" size="sm" className="h-11" trailing={<IconArrowRight size={16} />}>Voir où il en est</ButtonLink>}>
            <MockDiscord />
          </Card>
        </motion.div>
        <motion.div {...inView("surfaces-tools")} variants={reveal} className="mt-4">
          <section className="outils-band" aria-labelledby="surfaces-tools-title" data-surface-tools="">
            <div className="outils-band-icons" aria-hidden="true">
              <IconCut size={18} /><IconCrop size={18} /><IconWave size={18} /><IconGif size={18} /><IconCompress size={18} />
            </div>
            <div className="min-w-0">
              <h3 id="surfaces-tools-title" className="outils-band-title">AETHRYON Tools</h3>
              <p className="outils-band-text">Couper, recadrer, extraire le son, faire un GIF ou compresser, dans le navigateur.</p>
            </div>
            <Link to="/outils" className="outils-band-go">Ouvrir Tools</Link>
          </section>
        </motion.div>
        <motion.div {...inView("surfaces-premiere")} variants={reveal} className="mt-4">
          {/* AETHRYON pour Premiere Pro : disponible depuis le 2026-10-18 (décision du propriétaire). Icône propre à
              AETHRYON (PremiereMark) ; « Premiere Pro » en texte seulement, ni logo ni icône d'Adobe (docs/MARQUES.md). */}
          <section className="outils-band premiere-band" aria-labelledby="surfaces-premiere-title" data-surface-premiere="">
            <PremiereMark size={48} className="premiere-band-mark" />
            <div className="min-w-0">
              <h3 id="surfaces-premiere-title" className="outils-band-title">
                AETHRYON pour Premiere Pro <Status tone="ok">Disponible</Status>
              </h3>
              <p className="outils-band-text">L'extension pour Premiere Pro : colle un lien YouTube, TikTok ou X, prévisualise la vidéo et importe-la dans le chutier de ton choix, avec ton compte AETHRYON. Windows 11, Premiere Pro 25.6 ou plus récent.</p>
              <p className="premiere-band-note">L'installateur n'est pas encore signé : Windows affiche un avertissement avant de l'ouvrir. Adobe et Premiere Pro sont des marques d'Adobe ; AETHRYON n'est pas affilié à Adobe.</p>
            </div>
            <a href={PREMIERE_SETUP} download className="premiere-band-go" data-premiere-download="">Télécharger pour Windows</a>
          </section>
        </motion.div>
        <motion.div {...inView("surfaces-compte")} variants={reveal} className={cn("surface-account mt-4", focus.explicit && focus.id === "web" && "is-focus")} data-account-strip="">
          {focus.id === "web" && <div hidden data-panel="web" />}
          <span className="grid size-14 shrink-0 place-items-center rounded-[18px] bg-obsidian"><OwlMark size={32} surface="dark" /></span>
          <ul className="surface-facts" aria-label="Un compte pour tout">
            <li><b className="tabular">{q?.daily ?? 10}</b> conversions par jour</li>
            <li><b className="tabular">{q?.maxActive ?? 1}</b> à la fois</li>
            <li><b>1</b> historique partagé</li>
          </ul>
          <ButtonLink to={signedIn ? "/dashboard" : "/commencer"} variant="primary" className="w-full sm:w-auto" trailing={<IconArrowRight size={16} />}>{signedIn ? "Ouvrir mon espace" : "Créer mon compte"}</ButtonLink>
        </motion.div>
      </div>
    </section>
  );
}
