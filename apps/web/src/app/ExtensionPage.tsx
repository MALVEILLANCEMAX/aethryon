// Page publique de l'extension navigateur (pré-rendue) : téléchargement DIRECT depuis ce site, jamais une
// boutique d'extensions. Archive versionnée + empreinte SHA-256, guide d'installation manuelle pour Chrome,
// Edge et Brave (mode développeur → charger le dossier extrait), avertissement honnête sur l'installation hors
// store, mises à jour signalées par l'extension (jamais installées toute seule). Sans release publiée
// (EXTENSION_DOWNLOAD=0, src/lib/extension.ts) : aucun lien de téléchargement, la page dit où on en est.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "../lib/cn.ts";
import { useDocumentTitle } from "../lib/hooks.ts";
import { EXTENSION_RELEASE, EXTENSION_SUMS_URL, extensionDownloadUrl, formatDate, formatSize, type ExtensionRelease } from "../lib/extension.ts";
import { ButtonA, ButtonLink } from "../ui/Button.tsx";
import { Card } from "../ui/bits.tsx";
import { Alert } from "../ui/Alert.tsx";
import { CopyButton } from "../ui/CopyButton.tsx";
import { IconArrowRight, IconDownload, IconShield } from "../ui/Icon.tsx";
import { SegmentedControl } from "../ui/SegmentedControl.tsx";
import { OwlMark } from "../ui/brand/OwlMark.tsx";
import { Icone } from "../ui/egide/Egide.tsx";

type Browser = "chrome" | "edge" | "brave";
// Libellés vérifiés le 2026-10-11 : Chrome dans l'interface française de Chromium 153 (extension/tests/browser/install.test.mjs :
// « Mode développeur », « Charger l'extension non empaquetée », icône « Actualiser », « Épingler à la barre d'outils ») ;
// Edge et Brave d'après leurs documentations officielles, NON VÉRIFIÉS sur un vrai navigateur (docs/AUDIT-SECURITE-EXTENSION.md).
const BROWSERS: { id: Browser; name: string; page: string; where: string; keep: string; load: string; pin: string; reload: string }[] = [
  {
    id: "chrome", name: "Chrome", page: "chrome://extensions", where: "en haut à droite",
    keep: "Laisse-le activé.",
    load: "« Charger l'extension non empaquetée »",
    pin: "Pièce de puzzle, puis l'épingle à côté d'AETHRYON.",
    reload: "l'icône ↻ « Actualiser » de la carte AETHRYON",
  },
  {
    id: "edge", name: "Microsoft Edge", page: "edge://extensions", where: "en bas du panneau de gauche",
    keep: "Laisse-le activé ; l'avertissement d'Edge est normal hors boutique.",
    load: "« Charger l'extension décompressée » (« Load unpacked » en anglais)",
    pin: "Pièce de puzzle, puis l'œil à côté d'AETHRYON.",
    reload: "le lien « Recharger » de la carte AETHRYON",
  },
  {
    id: "brave", name: "Brave", page: "brave://extensions", where: "en haut à droite",
    keep: "Laisse-le activé.",
    load: "« Charger l'extension non empaquetée »",
    pin: "Pièce de puzzle, puis l'épingle à côté d'AETHRYON.",
    reload: "l'icône ↻ « Actualiser » de la carte AETHRYON",
  },
];

/** Identifiant de l'extension distribuée (clé publique de son manifeste) : le seul accepté par le serveur. */
const EXTENSION_ID = "necpohicddjeaeaaomaakehcbccapabg";

/** Ce que fait l'extension : une icône Phosphor duotone par atout (ui/ph). */
const ATOUTS = [["video", "MP4 ou MP3"], ["ciseaux", "Extrait de 10 à 60 s"], ["gif", "GIF et image"], ["etincelle", "Retouche dans Tools"]] as const;

/** Navigateur probable du visiteur (après l'affichage : la page pré-rendue montre Chrome par défaut). */
function guessBrowser(): Browser {
  const nav = navigator as Navigator & { brave?: unknown };
  if (/\bEdg\//.test(navigator.userAgent)) return "edge";
  if (nav.brave) return "brave";
  return "chrome";
}

function Code({ children, copy, label, copied = "Commande copiée" }: { children: string; copy?: boolean; label?: string; copied?: string }) {
  const code = useRef<HTMLElement>(null);
  return (
    <div className="flex items-center gap-1 rounded-card border border-line bg-pearl py-1 pl-4 pr-1">
      {/* Retour à la ligne plutôt que défilement : rien ne dépasse sur mobile, et le bouton copie la commande exacte. */}
      <code ref={code} className="min-w-0 flex-1 py-2.5 font-mono text-note text-ink [overflow-wrap:anywhere]">{children}</code>
      {copy && <CopyButton text={children} label={label ?? "Copier"} copied={copied} target={() => code.current} />}
    </div>
  );
}

function DownloadCard({ r }: { r: ExtensionRelease }) {
  const sha = useRef<HTMLElement>(null);
  return (
    <Card className="p-6 sm:p-7" data-extension-download="">
      <div className="flex items-center gap-4">
        <img src="/brand/aethryon/icons/extension-128.png" width={64} height={64} alt="" className="size-16 shrink-0 rounded-card" />
        <div className="min-w-0">
          <p className="font-display text-titre-s leading-tight">AETHRYON pour ordinateur</p>
          <p className="mt-1 text-ui text-ink-soft">
            Version <span className="tabular text-ink">{r.version}</span> · {formatDate(r.released)} · {formatSize(r.size)}
          </p>
        </div>
      </div>
      <ButtonA href={extensionDownloadUrl(r)} download={r.file} variant="primary" size="lg" className="mt-6 w-full" icon={<IconDownload size={19} />}>
        Télécharger l'extension
      </ButtonA>
      <p className="mt-3 text-center text-note text-muted">Chrome ou Edge {r.minChrome}+, Brave · archive ZIP</p>
      <details className="mt-5 border-t border-line pt-4" data-empreinte="">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-note font-medium text-ink-soft [&::-webkit-details-marker]:hidden">Empreinte SHA-256 de l'archive<span aria-hidden className="text-gold-text">+</span></summary>
        <code ref={sha} className="mt-2 block break-all font-mono text-note leading-relaxed text-ink" data-sha256="">{r.sha256}</code>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <CopyButton variant="label" text={r.sha256} label="Copier l'empreinte SHA-256" copied="Empreinte SHA-256 copiée" target={() => sha.current} />
          <a href={EXTENSION_SUMS_URL} className="inline-flex min-h-11 items-center text-note text-gold-text underline decoration-gold/50 underline-offset-4">Fichier SHA256SUMS</a>
        </div>
      </details>
    </Card>
  );
}

function ComingSoonCard() {
  return (
    <Card className="p-6 sm:p-7" data-extension-download="indisponible">
      <div className="flex items-center gap-4">
        <img src="/brand/aethryon/icons/extension-128.png" width={64} height={64} alt="" className="size-16 shrink-0 rounded-card" />
        <div>
          <p className="font-display text-titre-s leading-tight">Bientôt téléchargeable</p>
          <p className="mt-1 text-ui text-ink-soft">En cours de vérification</p>
        </div>
      </div>
      <p className="mt-5 text-ui leading-relaxed text-ink-soft">
        L'extension sera publiée ici quand sa connexion sécurisée au compte AETHRYON aura été validée. En attendant, le raccourci iPhone et ton espace web sont disponibles.
      </p>
      <ButtonLink to="/installer" variant="secondary" className="mt-5 w-full">Installer le raccourci iPhone</ButtonLink>
    </Card>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="relative pb-9 pl-14 last:pb-0">
      <span aria-hidden className="absolute bottom-0 left-[17px] top-10 w-px bg-line [li:last-child_&]:hidden" />
      <span aria-hidden className="absolute left-0 top-0 grid size-9 place-items-center rounded-full border border-line-strong bg-ivory text-ui font-semibold text-ink [font-variant-numeric:lining-nums]">{n}</span>
      <h3 className="pt-1 text-sous font-semibold tracking-[-0.01em]">{title}</h3>
      <div className="mt-2 space-y-3 text-ui leading-relaxed text-ink-soft">{children}</div>
    </li>
  );
}

function Section({ id, title, children, className }: { id: string; title: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className={cn("scroll-mt-28 border-t border-line pt-12", className)}>
      <h2 id={`${id}-titre`} className="font-display text-[clamp(1.6rem,1.3rem+1vw,2.1rem)] leading-tight">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function ExtensionPage() {
  useDocumentTitle("Extension navigateur");
  const r = EXTENSION_RELEASE;
  const [browser, setBrowser] = useState<Browser>("chrome");
  useEffect(() => { setBrowser(guessBrowser()); }, []);
  const b = BROWSERS.find((x) => x.id === browser)!;
  const file = r?.file ?? "aethryon-extension-<version>.zip";

  return (
    <div className="container-site pb-24 pt-28 sm:pt-36">
      <header className="grid grid-cols-[minmax(0,1fr)] items-start gap-10 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-16">
        <div>
          <OwlMark size={46} blink />
          <h1 className="page-title mt-6">L'extension AETHRYON</h1>
          <p className="mt-4 max-w-[38rem] text-corps leading-relaxed text-ink-soft sm:text-lead">Un bouton sous chaque vidéo YouTube, TikTok ou X.</p>
          <ul aria-label="Ce que fait l'extension" className="ext-atouts">
            {ATOUTS.map(([nom, t]) => <li key={t}><span className="ico-tuile" aria-hidden="true"><Icone nom={nom} duo /></span>{t}</li>)}
          </ul>
        </div>
        {r ? <DownloadCard r={r} /> : <ComingSoonCard />}
      </header>

      <Alert tone="warn" landmark="Installation manuelle" title="Installation manuelle, hors store" className="mt-12">
          <p>L'extension n'est sur aucune boutique : installe-la en mode développeur, depuis ce site seulement. Ton navigateur peut la dire non vérifiée ; un ordinateur géré peut bloquer ce mode.</p>
          <p>Ne convertis que ce que tu as le droit d'utiliser.</p>
      </Alert>

      <div className="mt-16 space-y-16">
        <Section id="installation" title="Installer en quelques minutes">
          <SegmentedControl semantics="toggle" label="Navigateur" value={browser} onChange={setBrowser}
            options={BROWSERS.map((x) => ({ value: x.id, label: x.name }))} className="bg-pearl" />
          <ol className="mt-8 max-w-[46rem]" data-guide={browser}>
            <Step n={1} title="Télécharge l'archive">
              <p>{r ? <>Le bouton enregistre <span className="font-mono text-ui text-ink">{file}</span> dans Téléchargements.</> : "Le lien de téléchargement apparaîtra sur cette page à la publication."}</p>
            </Step>
            <Step n={2} title="Extrais-la dans un dossier fixe">
              <p>Windows : clic droit, « Extraire tout… ». Mac : double-clic. Ne déplace plus ce dossier.</p>
            </Step>
            <Step n={3} title={`Ouvre la page des extensions de ${b.name}`}>
              <p>Colle cette adresse dans la barre d'adresse :</p>
              <Code copy label={`Copier ${b.page}`}>{b.page}</Code>
            </Step>
            <Step n={4} title="Active le mode développeur">
              <p>Interrupteur « Mode développeur », {b.where}. {b.keep}</p>
            </Step>
            <Step n={5} title="Charge le dossier extrait">
              <p>{b.load}, puis le dossier extrait (celui qui contient manifest.json).</p>
              <p className="text-ui text-muted">Identifiant attendu : <span className="font-mono text-ink [overflow-wrap:anywhere]">{EXTENSION_ID}</span> (le site refuse tout autre).</p>
            </Step>
            <Step n={6} title="Épingle l'icône et connecte-toi">
              <p>{b.pin}</p>
              <p>Puis « Se connecter à AETHRYON », et confirme sur ce site.</p>
            </Step>
          </ol>
        </Section>

        <details id="verifier" className="group scroll-mt-28 border-t border-line pt-10" data-verifier="">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 font-display text-[clamp(1.35rem,1.2rem+0.6vw,1.7rem)] [&::-webkit-details-marker]:hidden">
            Vérifier l'archive (facultatif)
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full border border-line text-sous text-gold-text transition-transform group-open:rotate-45">+</span>
          </summary>
          <p className="mt-4 max-w-[46rem] text-ui leading-relaxed text-ink-soft">Dans un terminal, dans Téléchargements ; le résultat doit être l'empreinte affichée près du bouton :</p>
          <dl className="mt-5 grid max-w-[46rem] grid-cols-[minmax(0,1fr)] gap-4">
            <div><dt className="mb-1.5 text-ui font-medium text-ink">Windows (PowerShell)</dt><dd><Code copy label="Copier la commande Windows">{`Get-FileHash -Algorithm SHA256 .\\${file}`}</Code></dd></div>
            <div><dt className="mb-1.5 text-ui font-medium text-ink">macOS (Terminal)</dt><dd><Code copy label="Copier la commande macOS">{`shasum -a 256 ${file}`}</Code></dd></div>
            <div><dt className="mb-1.5 text-ui font-medium text-ink">Linux</dt><dd><Code copy label="Copier la commande Linux">{`sha256sum ${file}`}</Code></dd></div>
          </dl>
          <p className="mt-4 max-w-[46rem] text-ui leading-relaxed text-ink-soft">{r ? "Différent ? Supprime l'archive et télécharge-la à nouveau." : "L'empreinte sera publiée avec l'archive."}</p>
        </details>

        <Section id="mises-a-jour" title="Mises à jour">
          <div className="grid max-w-[46rem] gap-3 text-ui leading-relaxed text-ink-soft">
            <p>L'extension te prévient quand une version sort ; elle n'installe jamais rien seule.</p>
            <p>Pour mettre à jour : remplace le dossier par la nouvelle archive, puis {b.reload}. Connexion et réglages sont gardés.</p>
            {r && r.notes.length > 0 && (
              <details className="mt-1 rounded-card border border-line p-4" data-nouveautes="">
                <summary className="flex min-h-11 cursor-pointer items-center text-ui font-medium text-ink">Nouveautés de la version {r.version}</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-ui">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>
              </details>
            )}
          </div>
        </Section>

        <Section id="donnees" title="Ce que l'extension envoie">
          <div className="grid max-w-[46rem] gap-4 text-ui leading-relaxed text-ink-soft">
            <p className="flex gap-3"><IconShield size={20} className="mt-0.5 shrink-0 text-gold-text" />Rien ne part avant ton clic ; alors seulement, le lien et tes réglages vont au service de conversion.</p>
            <p>Ni cookies, ni historique, ni publicité. Détail : <Link to="/confidentialite#extension" className="text-gold-text underline decoration-gold/50 underline-offset-4">Confidentialité</Link>.</p>
          </div>
        </Section>

        <Section id="desinstaller" title="Déconnecter ou désinstaller">
          <div className="grid max-w-[46rem] gap-3 text-ui leading-relaxed text-ink-soft">
            <p>« Se déconnecter » révoque la clé ; sans l'ordinateur, révoque-la dans <Link to="/dashboard/cles" className="text-gold-text underline decoration-gold/50 underline-offset-4">Mes jetons</Link>.</p>
            <p>Pour désinstaller : « Supprimer » dans la page des extensions, puis efface le dossier.</p>
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {r ? (
              <ButtonA href={extensionDownloadUrl(r)} download={r.file} variant="primary" icon={<IconDownload size={18} />}>Télécharger l'extension</ButtonA>
            ) : (
              <ButtonLink to="/installer" variant="primary" trailing={<IconArrowRight size={18} />}>Installer le raccourci iPhone</ButtonLink>
            )}
            <ButtonLink to="/aide" variant="secondary">Aide</ButtonLink>
          </div>
        </Section>
      </div>
    </div>
  );
}
