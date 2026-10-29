// Applications d'AETHRYON (« atelier de nuit », 2026-10-28) : un index de noms à gauche (onglets, tuile du produit),
// la scène à droite (le vrai fragment de l'interface, qui joue sa scène une fois, une phrase, le statut s'il n'est pas
// « Disponible », l'action). Versions, nouveautés et pastilles ont quitté l'accueil : elles vivent sur les pages
// d'installation (/extension, /installer, /aide) et dans « Nouveautés ». Données et actions inchangées depuis les portes.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { cn } from "../../lib/cn.ts";
import { useCalm } from "../../lib/hooks.ts";
import { EXTENSION_AVAILABLE, EXTENSION_STATUS } from "../../lib/extension.ts";
import { DISCORD_INSTALL, DISCORD_PUBLIC, DISCORD_STATUS } from "../../lib/discord.ts";
import { usePrerender, useSiteOrigin } from "../../lib/prerender.ts";
import { isSolution, type SolutionId } from "../../lib/solutions.ts";
import { ANNONCES } from "../../lib/nouveautes.ts";
import { InstallQr } from "../../ui/InstallQr.tsx";
import { TuileProduit } from "../../ui/brand/TuileProduit.tsx";
import { Icone } from "../../ui/egide/Egide.tsx";
import { useT } from "../../i18n/accueil.ts";
import { MqDiscord, MqExtension, MqIphone, MqPremiere, MqTools } from "./Maquettes.tsx";

/** Installateur Windows d'AETHRYON pour Premiere Pro, servi par /downloads/premiere/ (empreinte vérifiée au build) : le MÊME
 *  que l'annonce « AETHRYON pour Premiere Pro » des Nouveautés (une seule source, lib/nouveautes.ts, mise à jour à chaque setup). */
export const PREMIERE_SETUP = ANNONCES.map((a) => a.telechargement?.href).find((h) => h?.startsWith("/downloads/premiere/AETHRYON-Setup-")) ?? "/downloads/premiere/";

type PorteId = "extension" | "premiere" | "iphone" | "discord" | "tools";
/** Porte ↔ ancien sélecteur ?solution= (extension, ios, discord ; « web », l'usage sans rien installer, ouvre Tools). */
const SOLUTION_DE: Partial<Record<PorteId, SolutionId>> = { extension: "extension", iphone: "ios", discord: "discord", tools: "web" };
const PORTE_DE: Record<SolutionId, PorteId> = { extension: "extension", ios: "iphone", discord: "discord", web: "tools" };

interface Porte {
  id: PorteId;
  nom: string;
  court: string;
  /** « Disponible », ou l'état réel (bêta, bientôt) : écrit à côté du nom quand ce n'est pas « Disponible ». */
  statut: string;
  phrase: string;
  maquette: ReactNode;
  actions: ReactNode;
  extra?: ReactNode;
  attrs: Record<string, string>;
}

/** La tuile du produit (famille de PremiereMark) : le « logo » de chaque porte. */
function Lettre({ id, size }: { id: PorteId; size: number }) {
  return <TuileProduit produit={id} size={size} />;
}

export function Stations() {
  const calm = useCalm();
  const t = useT();
  const P = t.portes;
  const prerender = usePrerender();
  const origine = useSiteOrigin();
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const demande = params.get("solution");
  const explicite = isSolution(demande) ? PORTE_DE[demande] : null;
  const [ouverte, setOuverte] = useState<PorteId>(explicite ?? "extension");
  const [joue, setJoue] = useState<PorteId | null>(null);
  const onglets = useRef<(HTMLButtonElement | null)[]>([]);
  const scene = useRef<HTMLDivElement>(null);
  const focusSol: SolutionId = explicite ? SOLUTION_DE[explicite] ?? "ios" : "ios";

  const PORTES: Porte[] = [
    {
      id: "extension", nom: P.extension.nom, court: P.extension.court,
      statut: EXTENSION_AVAILABLE ? "Disponible" : EXTENSION_STATUS.label,
      phrase: P.extension.phrase,
      maquette: <MqExtension />, attrs: { "data-surface-card": "extension" },
      actions: <Link to="/extension" className="eg-btn eg-btn--principal">{EXTENSION_AVAILABLE ? P.extension.installer : P.extension.decouvrir}<Icone nom="chevron" taille="s" /></Link>,
    },
    {
      id: "premiere", nom: P.premiere.nom, court: P.premiere.court, statut: "Disponible",
      phrase: P.premiere.phrase,
      maquette: <MqPremiere />, attrs: { "data-surface-premiere": "" },
      extra: <p className="pt-note">{P.premiere.note}</p>,
      actions: <a href={PREMIERE_SETUP} download className="eg-btn eg-btn--principal" data-premiere-download=""><Icone nom="importer" taille="s" />{P.premiere.action}</a>,
    },
    {
      id: "iphone", nom: P.iphone.nom, court: P.iphone.court, statut: "Disponible",
      phrase: P.iphone.phrase,
      maquette: <MqIphone />, attrs: { "data-surface-card": "iphone" },
      extra: <div className="pt-qr" data-install-qr="" data-device="desktop"><InstallQr url={`${origine}/installer`} className="size-[76px] shrink-0" /><p>{P.iphone.qr}</p></div>,
      actions: <Link to="/installer" className="eg-btn eg-btn--principal">{P.iphone.action}<Icone nom="chevron" taille="s" /></Link>,
    },
    {
      id: "discord", nom: P.discord.nom, court: P.discord.court, statut: DISCORD_STATUS.label,
      phrase: P.discord.phrase,
      maquette: <MqDiscord />, attrs: { "data-surface-card": "discord" },
      actions: DISCORD_PUBLIC ? (
        <>
          <a href={DISCORD_INSTALL.user} target="_blank" rel="noopener noreferrer" className="eg-btn eg-btn--principal" data-install="user">
            {P.discord.ajouter}<Icone nom="ouvrir" taille="s" /><span className="eg-vh">{P.discord.nouvelOnglet}</span>
          </a>
          <a href={DISCORD_INSTALL.guild} target="_blank" rel="noopener noreferrer" className="eg-btn eg-btn--secondaire" data-install="guild">
            {P.discord.serveur}<span className="eg-vh">{P.discord.nouvelOnglet}</span>
          </a>
        </>
      ) : <Link to="/aide#etat" className="eg-btn eg-btn--secondaire">{P.discord.ou}</Link>,
    },
    {
      id: "tools", nom: P.tools.nom, court: P.tools.court, statut: "Bêta",
      phrase: P.tools.phrase,
      maquette: <MqTools />, attrs: { "data-surface-tools": "" },
      actions: <Link to="/outils" className="eg-btn eg-btn--principal">{P.tools.action}<Icone nom="chevron" taille="s" /></Link>,
    },
  ];

  // Ancre #porte-<id> (panneau de l'accueil) : cette porte s'ouvre ; le navigateur fait défiler jusqu'à son onglet.
  useEffect(() => {
    const m = /^#porte-(extension|premiere|iphone|discord|tools)$/.exec(hash);
    if (m) setOuverte(m[1] as PorteId);
  }, [hash]);

  // iPhone ou iPad : la porte du raccourci s'ouvre d'elle-même (après le premier rendu : le HTML pré-rendu reste stable).
  useEffect(() => {
    if (explicite) return;
    if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) setOuverte("iphone");
  }, [explicite]);

  // Lien direct ?solution= : l'accueil défile jusqu'à la porte ouverte (comme l'ancien sélecteur).
  useEffect(() => {
    if (!explicite) return;
    const t = window.setTimeout(() => {
      scene.current?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }, 450);
    return () => clearTimeout(t);
  }, [explicite]);

  // La maquette de la porte ouverte joue sa scène une fois, quand elle est à l'écran.
  useEffect(() => {
    const el = scene.current;
    if (!el || calm) return;
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setJoue(ouverte); io.disconnect(); } }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [ouverte, calm]);

  const ouvrir = (id: PorteId) => setOuverte(id);
  const clavier = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = e.key === "ArrowDown" || e.key === "ArrowRight" ? (i + 1) % PORTES.length
      : e.key === "ArrowUp" || e.key === "ArrowLeft" ? (i - 1 + PORTES.length) % PORTES.length
      : e.key === "Home" ? 0 : e.key === "End" ? PORTES.length - 1 : -1;
    if (n < 0) return;
    e.preventDefault();
    ouvrir(PORTES[n]!.id);
    onglets.current[n]?.focus();
  };

  return (
    <section id="applications" aria-labelledby="t-partout" className="at-section ap">
      {/* Anciennes ancres de l'accueil : /#surfaces, /#solutions et /#demo arrivent ici. */}
      <span id="surfaces" aria-hidden="true" /><span id="solutions" aria-hidden="true" />
      <h2 id="t-partout" className="at-h2">{t.partout}</h2>
      <div className="ap-grille">
        <div className="ap-index" role="tablist" aria-label={t.facons} aria-orientation="vertical">
          {PORTES.map((p, i) => {
            const on = p.id === ouverte;
            return (
              <button key={p.id} ref={(el) => { onglets.current[i] = el; }} type="button" role="tab" id={`porte-${p.id}`} aria-controls={`panneau-${p.id}`}
                aria-selected={on} tabIndex={on ? 0 : -1} className="ap-nom" data-porte={p.id} onClick={() => ouvrir(p.id)} onKeyDown={(e) => clavier(e, i)}>
                <Lettre id={p.id} size={40} />
                <span>{p.court}</span>
              </button>
            );
          })}
        </div>

        <div className="ap-scene" ref={scene}>
          {PORTES.map((p) => {
            const on = p.id === ouverte;
            const sol = SOLUTION_DE[p.id];
            return (
              // Pré-rendu : les portes fermées n'ont pas l'attribut hidden (la règle [hidden] de Tailwind est !important) ;
              // data-sans-js les masque avec JavaScript (styles.css) et les montre sans (sans-js.css) : toutes lisibles.
              <article key={p.id} id={`panneau-${p.id}`} role="tabpanel" aria-labelledby={`porte-${p.id}`} hidden={!on && !prerender} data-sans-js={on ? undefined : ""}
                className={cn("ap-panneau", explicite === p.id && "is-focus")} data-statut={p.statut} {...p.attrs}>
                {/* Lien direct ?solution= (et accueil par défaut : le raccourci iPhone) : la surface visée est marquée. */}
                {sol && sol === focusSol && <div hidden data-panel={sol} />}
                <div className="ap-maquette" aria-hidden="true" data-ui="" data-joue={joue === p.id ? "" : undefined}>{p.maquette}</div>
                <div className="ap-info">
                  <h3 className="ap-titre">{p.nom}{p.statut !== "Disponible" && <span className="ap-statut"> · {t.statuts[p.statut] ?? p.statut}</span>}</h3>
                  <p className="ap-phrase">{p.phrase}</p>
                  {p.extra}
                  <div className="ap-actions">{p.actions}</div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
