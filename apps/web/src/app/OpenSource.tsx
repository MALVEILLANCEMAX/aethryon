// Page « Open source » (/open-source) : le code d'AETHRYON (Apache-2.0, marque réservée), les téléchargements pour
// ordinateur (Windows réel ; macOS et Linux annoncés « pas encore disponible », sans lien) et les versions du dépôt
// officiel, relevées à la construction (lib/github.ts). Aucun lien vers GitHub tant que le dépôt est privé
// (VITE_GITHUB_PUBLIC=0), aucun chiffre (étoiles, téléchargements) : rien que le site ne puisse prouver.
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useDocumentTitle } from "../lib/hooks.ts";
import { cn } from "../lib/cn.ts";
import {
  CODE_LICENSE, dateLongue, depotNotes, GITHUB_PUBLIC, GITHUB_RELEASES_URL, GITHUB_URL, inline, versionDuFichier,
  type DepotNotes, type DepotVersion,
} from "../lib/github.ts";
import { PREMIERE_SETUP } from "../landing/v2/Surfaces.tsx";
import { ButtonA, ButtonLink } from "../ui/Button.tsx";
import { GithubMark } from "../ui/brand/GithubMark.tsx";
import { OwlMark } from "../ui/brand/OwlMark.tsx";
import { IconArrowUpRight, IconCode, IconDownload, IconLaptop, IconLock, IconShield, IconTag } from "../ui/Icon.tsx";

const SETUP_VERSION = versionDuFichier(PREMIERE_SETUP);
const SETUP_SUMS = PREMIERE_SETUP.replace(/[^/]+$/, "SHA256SUMS");

/** Ce que contient le dépôt (dossiers réels du dépôt officiel). */
const COMPOSANTS: [string, string][] = [
  ["Site et espace personnel", "apps/web"],
  ["Comptes, jetons et quotas", "apps/account"],
  ["Service de conversion", "apps/media-api"],
  ["Extension navigateur", "apps/extension"],
  ["Bot Discord", "apps/discord-bot"],
  ["AETHRYON Desktop", "apps/desktop"],
  ["Panneau pour Premiere Pro", "apps/premiere-panel"],
  ["Installateur Windows", "apps/setup"],
  ["Raccourci iPhone", "shortcuts/ios"],
];

function Inline({ text }: { text: string }) {
  return (
    <>
      {inline(text).map((p, i) =>
        p.t === "code" ? <code key={i} className="os-code">{p.text}</code>
          : p.t === "strong" ? <strong key={i} className="font-medium text-ink">{p.text}</strong>
            : <span key={i}>{p.text}</span>)}
    </>
  );
}

/** Notes d'une version : titres de rubrique, puces, paragraphes, dans l'ordre du dépôt. */
function Notes({ v }: { v: DepotVersion }) {
  const groups: { h: string | null; items: DepotVersion["blocks"] }[] = [];
  for (const b of v.blocks) {
    if (b.t === "h" || !groups.length) groups.push({ h: b.t === "h" ? b.text : null, items: [] });
    if (b.t !== "h") groups[groups.length - 1]!.items.push(b);
  }
  return (
    <div className="os-notes" lang="en">
      {/* Une rubrique sans contenu lisible ici (un tableau, ignoré) n'est pas affichée. */}
      {groups.filter((g) => g.items.length > 0).map((g, i) => (
        <div key={i}>
          {g.h && <h4 className="os-notes-h"><Inline text={g.h} /></h4>}
          {g.items.some((b) => b.t === "li") ? (
            <ul>
              {g.items.map((b, j) => b.t === "li" ? <li key={j}><Inline text={b.text} /></li> : <li key={j} className="is-p"><Inline text={b.text} /></li>)}
            </ul>
          ) : g.items.map((b, j) => <p key={j}><Inline text={b.text} /></p>)}
        </div>
      ))}
    </div>
  );
}

function Version({ v, first }: { v: DepotVersion; first: boolean }) {
  const date = dateLongue(v.date);
  return (
    <li className="os-version" data-depot-version={v.version}>
      <span aria-hidden className="os-version-dot" />
      <details className="os-version-box group" open={first}>
        <summary className="os-version-head">
          <span className="os-version-num tabular">{v.version}</span>
          {v.prerelease && <span className="os-badge">Pré-version</span>}
          {date && <time dateTime={v.date ?? undefined} className="os-version-date">{date}</time>}
          {v.title && <span className="os-version-title" lang="en">{v.title}</span>}
          <span aria-hidden className="os-version-toggle">+</span>
        </summary>
        {v.blocks.length ? <Notes v={v} /> : <p className="os-notes text-muted">Aucune note publiée pour cette version.</p>}
        {v.url && (
          <a href={v.url} target="_blank" rel="noopener noreferrer" className="os-link mt-4" data-github-lien="release">
            <GithubMark size={15} />Voir cette version sur GitHub<IconArrowUpRight size={15} /><span className="sr-only"> (nouvel onglet)</span>
          </a>
        )}
      </details>
    </li>
  );
}

function Source({ n }: { n: DepotNotes }) {
  const quand = dateLongue(n.builtAt);
  if (n.source === "releases") return <>Releases publiées sur GitHub, relevées {quand ? `le ${quand}` : "à la mise en ligne de cette page"}.</>;
  if (n.source === "changelog") {
    return <>Journal des modifications du dépôt officiel (CHANGELOG.md{n.ref && n.ref !== "main" ? <>, révision <span className="font-mono text-[13px]">{n.ref}</span></> : null}){n.public ? "" : ", tant que le dépôt n'est pas public"}.</>;
  }
  return <>Aucune source lisible à la construction de cette page.</>;
}

function Platform({ name, children, ready, id }: { name: string; children: ReactNode; ready: boolean; id: string }) {
  return (
    <li className={cn("os-platform", ready ? "is-ready" : "is-soon")} data-plateforme={id}>
      <div className="flex items-center justify-between gap-3">
        <span className="os-platform-ico"><IconLaptop size={22} /></span>
        <span className={cn("os-status", ready ? "is-ok" : "is-soon")}>
          <span aria-hidden className="os-status-dot" />{ready ? "Disponible (bêta)" : "Pas encore disponible"}
        </span>
      </div>
      <h3 className="mt-5 font-display text-[24px] font-medium leading-tight">{name}</h3>
      <div className="mt-2 flex flex-1 flex-col text-[15px] leading-relaxed text-ink-soft">{children}</div>
    </li>
  );
}

export default function OpenSource() {
  useDocumentTitle("Open source");
  const notes = depotNotes();

  return (
    <>
      <section aria-labelledby="os-titre" className="hero-night os-hero -mt-px pb-20 pt-28 sm:pb-24 sm:pt-36" data-open-source="">
        <span aria-hidden className="hero-cross left-[9%] top-[26%] hidden sm:block" />
        <span aria-hidden className="hero-cross right-[11%] top-[18%] hidden sm:block" />
        <div className="container-site relative grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="os-rise">
            <p className="outils-mark">AETHRYON <span aria-hidden="true">/</span> Open source</p>
            <h1 id="os-titre" className="mt-6 font-display text-[clamp(2.5rem,1.4rem+4.4vw,4.9rem)] font-medium leading-[1] tracking-[-0.025em] text-ivory">
              <span className="block">{GITHUB_PUBLIC ? "Le code est ouvert." : "Le code, en préparation."}</span>
              <span className="block text-gold-light">La chouette reste chez elle.</span>
            </h1>
            <p className="mt-6 max-w-[38rem] text-[17px] leading-relaxed text-mist sm:text-lead">
              {GITHUB_PUBLIC
                ? <>Site, compte, service de conversion, extension, bot Discord et Desktop&nbsp;: tout le code d'AETHRYON est publié sous licence {CODE_LICENSE}. Le nom, la chouette et les visuels restent réservés.</>
                : <>Site, compte, service de conversion, extension, bot Discord et Desktop&nbsp;: le code d'AETHRYON sera publié sous licence {CODE_LICENSE}. Le nom, la chouette et les visuels restent réservés.</>}
            </p>
            {GITHUB_PUBLIC ? (
              <div className="mt-9 flex flex-wrap gap-3" data-github-actions="">
                <ButtonA href={GITHUB_URL} target="_blank" rel="noopener noreferrer" variant="light" size="lg" icon={<GithubMark size={19} />} data-github-lien="code">
                  Voir le code source<span className="sr-only"> sur GitHub (nouvel onglet)</span>
                </ButtonA>
                <ButtonA href={GITHUB_RELEASES_URL} target="_blank" rel="noopener noreferrer" variant="night" size="lg" icon={<IconTag size={19} />} data-github-lien="releases">
                  Releases<span className="sr-only"> sur GitHub (nouvel onglet)</span>
                </ButtonA>
              </div>
            ) : (
              <p className="os-pending mt-9" data-github-prive="">
                <IconLock size={18} className="shrink-0 text-gold-light" />
                Le dépôt GitHub est en préparation&nbsp;: ses liens apparaîtront ici dès qu'il sera public.
              </p>
            )}
          </div>
          <aside aria-label="En bref" className="os-facts os-rise is-late">
            <OwlMark size={40} blink />
            <dl className="mt-6 grid gap-4">
              <div><dt>Code</dt><dd>Licence {CODE_LICENSE}</dd></div>
              <div><dt>Marque et visuels</dt><dd>Réservés (nom, chouette, logotype)</dd></div>
              <div><dt>Plateformes prises en charge</dt><dd>YouTube, TikTok et X</dd></div>
              <div><dt>Contributions</dt><dd>{GITHUB_PUBLIC ? "Bienvenues, sur GitHub" : "À l'ouverture du dépôt"}</dd></div>
            </dl>
          </aside>
        </div>
      </section>

      <section aria-labelledby="telecharger-titre" id="telecharger" className="section-light scroll-mt-24 py-20 sm:py-24">
        <div className="container-site">
          <p className="os-kicker"><IconDownload size={16} />Télécharger</p>
          <h2 id="telecharger-titre" className="os-h2">AETHRYON sur ordinateur</h2>
          <p className="mt-3 max-w-[40rem] text-[16.5px] leading-relaxed text-ink-soft">
            AETHRYON Desktop et le panneau pour Premiere Pro s'installent avec AETHRYON Setup. Seuls les fichiers réellement publiés sont proposés ici.
          </p>
          <ul className="os-platforms mt-10">
            <Platform id="windows" name="Windows" ready>
              <p>AETHRYON Setup{SETUP_VERSION ? <> <span className="tabular text-ink">{SETUP_VERSION}</span></> : null}&nbsp;: AETHRYON Desktop et le panneau pour Premiere Pro. Windows&nbsp;11.</p>
              <p className="mt-2 text-[13.5px] text-muted">L'installateur n'est pas encore signé&nbsp;: Windows affiche un avertissement avant de l'ouvrir.</p>
              <div className="mt-auto pt-6">
                <ButtonA href={PREMIERE_SETUP} download variant="primary" className="w-full" icon={<IconDownload size={18} />} data-telecharger="windows">
                  Télécharger pour Windows
                </ButtonA>
                <a href={SETUP_SUMS} className="os-link mt-3 justify-center" data-telecharger="sha256">
                  <IconShield size={15} />Empreintes SHA-256
                </a>
              </div>
            </Platform>
            <Platform id="macos" name="macOS" ready={false}>
              <p>Aucune version pour Mac n'est publiée pour l'instant. Elle apparaîtra ici quand elle existera.</p>
            </Platform>
            <Platform id="linux" name="Linux" ready={false}>
              <p>Aucune version pour Linux n'est publiée pour l'instant. Elle apparaîtra ici quand elle existera.</p>
            </Platform>
          </ul>
          <p className="mt-8 text-[15px] leading-relaxed text-ink-soft">
            Sur iPhone, AETHRYON passe par un <Link to="/installer" className="os-inline-link">raccourci</Link>&nbsp;; dans Chrome, Edge ou Brave, par l'<Link to="/extension" className="os-inline-link">extension</Link>.
          </p>
        </div>
      </section>

      <section aria-labelledby="code-titre" id="code" className="section-light os-band scroll-mt-24 py-20 sm:py-24">
        <div className="container-site grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <p className="os-kicker"><IconCode size={16} />Code source</p>
            <h2 id="code-titre" className="os-h2">Un seul dépôt, tout AETHRYON.</h2>
            <p className="mt-3 max-w-[34rem] text-[16.5px] leading-relaxed text-ink-soft">
              Le dépôt officiel réunit chaque partie du service, ses essais et sa documentation. Les forks sont bienvenus sous la licence du code, à condition de changer de nom et de visuels.
            </p>
            {GITHUB_PUBLIC && (
              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonA href={GITHUB_URL} target="_blank" rel="noopener noreferrer" variant="primary" icon={<GithubMark size={18} />} data-github-lien="code">
                  Voir le code source<span className="sr-only"> sur GitHub (nouvel onglet)</span>
                </ButtonA>
                <ButtonLink to="#versions" variant="secondary" icon={<IconTag size={18} />}>Versions</ButtonLink>
              </div>
            )}
          </div>
          <ul className="os-components" aria-label="Contenu du dépôt">
            {COMPOSANTS.map(([nom, dossier]) => (
              <li key={dossier}><span>{nom}</span><span className="font-mono text-[13px] text-muted">{dossier}</span></li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="versions-titre" id="versions" className="section-light scroll-mt-24 pb-24 pt-20 sm:pb-28 sm:pt-24">
        <div className="container-site max-w-[60rem]">
          <p className="os-kicker"><IconTag size={16} />Versions</p>
          <h2 id="versions-titre" className="os-h2">Ce qui a changé</h2>
          <p className="mt-3 text-[14.5px] leading-relaxed text-muted" data-depot-source={notes.source}>
            Source&nbsp;: <Source n={notes} /> Notes rédigées en anglais dans le dépôt.
          </p>
          {notes.entries.length ? (
            <ol className="os-timeline mt-10">
              {notes.entries.map((v, i) => <Version key={v.version} v={v} first={i === 0} />)}
            </ol>
          ) : (
            <p className="mt-10 rounded-[18px] border border-line bg-pearl/60 p-6 text-[15.5px] text-ink-soft" data-depot-vide="">
              Aucune version publiée pour l'instant.
            </p>
          )}
          {GITHUB_PUBLIC && (
            <a href={GITHUB_RELEASES_URL} target="_blank" rel="noopener noreferrer" className="os-link mt-10" data-github-lien="releases">
              <GithubMark size={15} />Toutes les releases sur GitHub<IconArrowUpRight size={15} /><span className="sr-only"> (nouvel onglet)</span>
            </a>
          )}
        </div>
      </section>
    </>
  );
}
