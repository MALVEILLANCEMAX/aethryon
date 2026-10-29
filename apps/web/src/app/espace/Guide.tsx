// Guide « Bien démarrer » de l'accueil de l'espace personnel. Les états viennent de lib/onboarding.ts
// (données réelles du serveur uniquement). Ici : l'affichage progressif. L'étape en cours est ouverte ;
// les étapes faites se replient sur une ligne qui dit ce que le serveur a constaté ; quand tout est prêt,
// le guide devient une courte bande « Tout est prêt » que l'on peut rouvrir. Préférence locale (confort) :
// guide masqué par l'utilisateur. Clavier : chaque étape est un bouton de divulgation (aria-expanded).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../../lib/cn.ts";
import { useCalm } from "../../lib/hooks.ts";
import { DUR, EASE } from "../../lib/motion.ts";
import { fmtRelative } from "../../lib/format.ts";
import { MENU, SHORTCUT_NAME } from "../../lib/brand.ts";
import { ICLOUD_REL } from "../../lib/shortcut.ts";
import { readPref, writePref } from "../../lib/prefs.ts";
import { STEP_ORDER, type Guide as GuideData, type StepId, type StepState } from "../../lib/onboarding.ts";
import type { ActivityItem, PublicConfig } from "../../lib/types.ts";
import { Button, ButtonA, ButtonLink } from "../../ui/Button.tsx";
import { Skeleton } from "../../ui/bits.tsx";
import { OwlMark } from "../../ui/brand/OwlMark.tsx";
import { IconAlert, IconArrowRight, IconArrowUpRight, IconCheck, IconChevron, IconDownload, IconKey, IconUser, ShortcutTile } from "../../ui/Icon.tsx";
import { TuileProduit } from "../../ui/brand/TuileProduit.tsx";
import { InstallQr } from "../../ui/InstallQr.tsx";
import { PLATFORM_NAME, StepMarker } from "./parts.tsx";
import { EXTENSION_AVAILABLE, EXTENSION_PAGE, EXTENSION_STATUS } from "../../lib/extension.ts";
import { DISCORD_PUBLIC, DISCORD_STATUS } from "../../lib/discord.ts";

const link = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";
/** Lien autonome (hors phrase) : cible tactile de 44 px. */
const standalone = cn(link, "inline-flex min-h-11 items-center gap-1.5 text-ui");
/** Bouton qui peut passer à la ligne sous 640 px plutôt que de déborder. */
const wrapBtn = "h-auto min-h-12 whitespace-normal py-2 text-left leading-tight sm:whitespace-nowrap";

export const STEP_TITLE: Record<StepId, string> = {
  acces: "Choisir ta façon d'utiliser AETHRYON",
  raccourci: "Installer le raccourci",
  conversion: "Ta première conversion",
  activite: "Retrouver ton activité",
};
const STATE_LABEL: Record<StepState, string> = { done: "Fait", current: "En cours", todo: "À venir" };

/** Prochaine action, en une phrase courte (sous le titre de la page). */
export function nextStepPhrase(g: GuideData): string {
  switch (g.current) {
    case "acces": return "choisir ta façon d'utiliser AETHRYON";
    case "raccourci": return g.noActiveKey ? "créer un nouveau jeton" : g.replaced ? "coller ton nouveau jeton dans le raccourci" : "installer le raccourci";
    case "conversion": return "ta première conversion";
    case "activite": return "retrouver ton activité";
    default: return "";
  }
}

const quoted = (s: string) => `« ${s} »`;
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

interface Props {
  userId: string;
  guide: GuideData | null;
  /** Jetons ou activité illisibles : l'avancement ne peut pas être vérifié. */
  failed: boolean;
  onRetry: () => void;
  keysActive: boolean;
  icloudUrl: string | null;
  platforms?: PublicConfig["platforms"];
  /** Conversion en cours (suivi en direct). */
  busy: boolean;
  /** Première conversion détectée, à saluer une seule fois (sinon null). */
  moment: ActivityItem | null;
  /** L'historique chargé est tronqué : le nombre affiché est un minimum. */
  countIsFloor: boolean;
}

export function Guide(props: Props) {
  const { userId, guide, failed, onRetry } = props;
  const [hidden, setHidden] = useState(() => readPref(userId, "guide-masque") === "1");
  const [reopened, setReopened] = useState(false);

  if (!guide) {
    if (failed) {
      return (
        <section aria-labelledby="guide-title" className="rounded-panel border border-line bg-pearl/60 p-5 sm:p-7" data-guide="erreur">
          <h2 id="guide-title" className="font-display text-titre-m leading-tight">Bien démarrer</h2>
          <p className="mt-3 flex gap-2.5 text-ui leading-relaxed text-ink-soft" role="alert">
            <IconAlert size={18} className="mt-1 shrink-0 text-bad" />
            Ton avancement n'a pas pu être vérifié : le serveur n'a pas répondu. Tes jetons et ton activité ne sont pas touchés.
          </p>
          <Button variant="secondary" size="sm" className="mt-4 h-11" onClick={onRetry}>Réessayer</Button>
        </section>
      );
    }
    return <GuideSkeleton />;
  }

  if (guide.ready) {
    return (
      <section aria-labelledby="guide-title" className="rounded-panel border border-line bg-pearl/50 p-4 sm:p-5" data-guide="pret">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3.5">
            {props.moment ? (
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-ivory ring-1 ring-line" data-moment="">
                <OwlMark size={30} wink={1} />
              </span>
            ) : (
              <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-gold text-on-accent"><IconCheck size={20} strokeWidth={2.2} /></span>
            )}
            <div className="min-w-0">
              <h2 id="guide-title" className="font-display text-titre-s leading-tight">
                {props.moment ? "Première conversion terminée !" : "Tout est prêt"}
              </h2>
              <p className="mt-1 text-ui leading-relaxed text-ink-soft" role={props.moment ? "status" : undefined}>
                {props.moment
                  ? `Tout est prêt. Vérifie sur ton iPhone que ${props.moment.fmt === "mp3" ? "le fichier est bien dans Fichiers" : "la vidéo est bien dans Photos"}.`
                  : "Ton raccourci est relié à ton compte et ta première conversion est terminée."}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-11 self-start sm:self-center" aria-expanded={reopened} aria-controls="guide-etapes"
            trailing={<IconChevron size={16} className={cn("transition-transform duration-300", reopened && "rotate-180")} />}
            onClick={() => setReopened((v) => !v)}>
            {reopened ? "Masquer les étapes" : "Revoir les étapes"}
          </Button>
        </div>
        <div id="guide-etapes">
          {reopened && <div className="mt-5 border-t border-line pt-6"><Steps {...props} guide={guide} /></div>}
        </div>
      </section>
    );
  }

  const toggleHidden = () => {
    const next = !hidden;
    writePref(userId, "guide-masque", next ? "1" : null);
    setHidden(next);
  };
  return (
    <section aria-labelledby="guide-title" className="rounded-panel border border-line bg-surface p-4 shadow-card min-[400px]:p-5 sm:p-7" data-guide="en-cours">
      <div className="flex items-start justify-between gap-2">
        <h2 id="guide-title" className="font-display pt-1 text-titre-s leading-tight min-[400px]:text-titre-m">Bien démarrer</h2>
        {/* Sous 400 px, le texte visible se réduit au verbe ; le nom accessible reste complet (et le contient). */}
        <Button variant="quiet" size="sm" className="-mr-2 h-11 shrink-0 px-3" aria-label={hidden ? "Afficher le guide" : "Masquer le guide"} aria-expanded={!hidden} aria-controls="guide-etapes" onClick={toggleHidden}>
          {hidden ? "Afficher" : "Masquer"}<span className="hidden min-[400px]:inline">{"\u00a0"}le guide</span>
        </Button>
      </div>
      <p className="mt-1 max-w-xl text-ui leading-relaxed text-ink-soft">Chaque étape se coche toute seule, d'après ce que ton compte enregistre.</p>
      <Progress done={guide.doneCount} className="mt-4" />
      <div id="guide-etapes">
        {hidden ? (
          <p className="mt-4 text-ui text-ink-soft" data-guide-masque="">
            Guide masqué. Prochaine étape : <span className="font-medium text-ink">{STEP_TITLE[guide.current!]}</span>.
          </p>
        ) : (
          <div className="mt-7"><Steps {...props} guide={guide} /></div>
        )}
      </div>
    </section>
  );
}

/** Avancement : quatre segments (les étapes vérifiables), le texte dit la même chose. */
function Progress({ done, className }: { done: number; className?: string }) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-ui text-ink-soft", className)} data-progress={done}>
      <span aria-hidden className="flex gap-1">
        {STEP_ORDER.map((id, i) => <span key={id} className={cn("h-1.5 w-7 rounded-full", i < done ? "bg-gold" : "bg-sand ring-1 ring-inset ring-line-strong/60")} />)}
      </span>
      <span className="tabular whitespace-nowrap">{done} {done > 1 ? "étapes faites" : "étape faite"} sur 4</span>
    </p>
  );
}

export function GuideSkeleton() {
  return (
    <section aria-busy="true" aria-label="Bien démarrer, chargement" className="rounded-panel border border-line bg-pearl/50 p-5 sm:p-7" data-guide="chargement">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-3 h-4 w-full max-w-md" />
      <div className="mt-8 space-y-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <Skeleton className={cn("h-5", i === 1 ? "w-2/3" : "w-1/2")} />
          </div>
        ))}
      </div>
    </section>
  );
}

// ---- Étapes ------------------------------------------------------------------------------------

function Steps(props: Props & { guide: GuideData }) {
  const { guide } = props;
  const calm = useCalm();
  const cur = guide.current;
  const [open, setOpen] = useState<Partial<Record<StepId, boolean>>>(() => (cur ? { [cur]: true } : {}));
  const heads = useRef<Partial<Record<StepId, HTMLButtonElement | null>>>({});
  // L'étape en cours change (le serveur a constaté un progrès) : elle s'ouvre, les autres se replient.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setOpen(cur ? { [cur]: true } : {});
  }, [cur]);
  const toggle = (id: StepId) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const goTo = (id: StepId) => {
    setOpen((o) => ({ ...o, [id]: true }));
    window.requestAnimationFrame(() => heads.current[id]?.focus());
  };

  const content = stepContent(props, goTo);
  return (
    <ol className="relative" aria-label="Étapes pour bien démarrer">
      {STEP_ORDER.map((id, i) => {
        const state = guide.steps[id];
        const isOpen = !!open[id];
        const c = content[id];
        return (
          <li key={id} className="relative pb-7 pl-[52px] sm:pl-14" data-step={id} data-state={state}>
            {/* fil de progression : or sous une étape faite */}
            <span aria-hidden className={cn("absolute bottom-1 left-[17.5px] top-11 w-px transition-colors duration-500", state === "done" ? "bg-gold" : "bg-line-strong/70")} />
            <StepMarker state={state} n={i + 1} className="absolute left-0 top-1" label={`Étape ${i + 1} : ${STATE_LABEL[state].toLowerCase()}`} />
            <h3>
              <button
                ref={(el) => { heads.current[id] = el; }}
                type="button"
                aria-expanded={isOpen}
                aria-controls={`etape-${id}`}
                onClick={() => toggle(id)}
                className="group flex min-h-11 w-full items-center justify-between gap-3 rounded-card text-left"
              >
                <span className={cn("text-corps font-semibold leading-snug tracking-[-0.01em] transition-colors group-hover:text-ink", state === "todo" ? "text-ink-soft" : "text-ink")}>
                  {STEP_TITLE[id]}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {/* Doublon visuel du repère (image nommée « Étape n : … ») : hors du nom du bouton. */}
                  <span aria-hidden className={cn("hidden text-note sm:inline", state === "done" ? "text-gold-text" : state === "current" ? "font-medium text-ink" : "text-muted")}>{STATE_LABEL[state]}</span>
                  <IconChevron size={16} aria-hidden className={cn("text-muted transition-transform duration-300", isOpen && "rotate-180")} />
                </span>
              </button>
            </h3>
            {!isOpen && c.summary && <p className={cn("mt-0.5 text-ui leading-relaxed", state === "todo" ? "text-muted" : "text-ink-soft")} data-summary="">{c.summary}</p>}
            <div id={`etape-${id}`}>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    key="corps"
                    initial={calm ? false : { height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={calm ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
                    transition={{ duration: DUR.component, ease: EASE.soft }}
                    className={cn("overflow-hidden", state === "current" && "-ml-[52px] pl-[52px] sm:ml-0 sm:pl-0")}
                  >
                    <div className={cn("relative mt-2 text-ui leading-relaxed text-ink-soft", state === "current" && "-ml-[52px] rounded-panel border border-line bg-ivory p-4 shadow-card sm:ml-0 sm:p-5")}>
                      {c.body}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </li>
        );
      })}
      <AccountLandmark />
    </ol>
  );
}

/** Étape 5 : repère toujours accessible (aucune donnée du serveur ne peut la « cocher »). */
function AccountLandmark() {
  return (
    <li className="relative pl-[52px] sm:pl-14" data-step="compte" data-state="repere">
      <span aria-hidden className="absolute left-0 top-1 grid size-9 place-items-center rounded-full border border-dashed border-line-strong bg-ivory text-ink-soft"><IconUser size={17} /></span>
      <h3 className="flex min-h-11 items-center justify-between gap-3">
        <span className="text-corps font-semibold leading-snug tracking-[-0.01em]">Gérer ton compte</span>
        <span className="hidden shrink-0 text-note text-muted sm:inline">À tout moment</span>
      </h3>
      <p className="text-ui leading-relaxed text-ink-soft">
        Ta connexion et ton mot de passe, tes jetons, l'export de tes données et la suppression du compte, quand tu veux.
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-5" aria-label="Gérer ton compte">
        <li><Link to="/dashboard/compte" className={standalone}>Connexion et mot de passe</Link></li>
        <li><Link to="/dashboard/cles" className={standalone}>Mes jetons</Link></li>
        <li><a href="/api/account/export" download="youtube-converter-mes-donnees.json" className={standalone}>Exporter mes données</a></li>
        <li><Link to="/confidentialite#donnees" className={standalone}>Données et suppression</Link></li>
      </ul>
    </li>
  );
}

// ---- Contenu de chaque étape (textes et actions selon l'état réel) ------------------------------

const PLATFORM_KEYS = [["youtube", "YouTube"], ["tiktok", "TikTok"], ["twitter", "X"]] as const;

function stepContent(p: Props & { guide: GuideData }, goTo: (id: StepId) => void): Record<StepId, { summary: ReactNode; body: ReactNode }> {
  const g = p.guide;
  const s = g.steps;
  const latest = g.latest;
  const suspended = PLATFORM_KEYS.filter(([k]) => p.platforms?.[k] === false).map(([, n]) => n);
  const names = g.activeKeys.map((k) => quoted(k.name || "Sans nom"));

  return {
    acces: {
      summary: s.acces === "done"
        ? "Raccourci iPhone : ton compte a un jeton."
        : EXTENSION_AVAILABLE
          ? DISCORD_PUBLIC
            ? "Le raccourci iPhone, l'extension pour ordinateur et le bot Discord sont disponibles."
            : "Le raccourci iPhone et l'extension pour ordinateur sont disponibles ; le bot Discord est en développement."
          : DISCORD_PUBLIC
            ? "Le raccourci iPhone et le bot Discord sont disponibles ; l'extension est en développement."
            : "Le raccourci iPhone est disponible ; l'extension et le bot Discord sont en développement.",
      body: (
        <>
          <p>Un seul compte pour tous les accès : le même quota et le même historique, où que tu convertisses.</p>
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-card border border-line bg-pearl/40" aria-label="Façons d'utiliser AETHRYON" data-access-choice="">
            <AccessRow icon={<TuileProduit produit="iphone" size={40} />} name="Raccourci iPhone" status="Disponible" dot="ready" featured
              desc="Depuis la feuille de partage, avec l'app Raccourcis d'Apple." id="ios"
              action={s.raccourci === "done" ? null : <Button variant="primary" size="sm" className="h-11" trailing={<IconArrowRight size={16} />} onClick={() => goTo("raccourci")}>Utiliser l'iPhone</Button>} />
            <AccessRow icon={<TuileProduit produit="web" size={40} />} name="Espace web" status="Tu es ici" dot="ready" id="web"
              desc="Tes jetons, ton quota et ton activité, sur ce site." />
            <AccessRow icon={<TuileProduit produit="extension" size={40} />} name="Extension navigateur" status={EXTENSION_STATUS.label} dot={EXTENSION_STATUS.state} id="extension"
              desc={EXTENSION_AVAILABLE ? "Sur ordinateur, un bouton sous la vidéo, dans Chrome, Edge ou Brave." : "Sur ordinateur, un bouton sous la vidéo. Pas encore installable."}
              action={EXTENSION_AVAILABLE ? <ButtonLink to={EXTENSION_PAGE} variant="secondary" size="sm" className="h-11">Installer</ButtonLink> : null} />
            <AccessRow icon={<TuileProduit produit="discord" size={40} />} name="Bot Discord" status={DISCORD_STATUS.label} dot={DISCORD_STATUS.state} id="discord"
              desc={DISCORD_PUBLIC ? "/convert dans Discord, avec ton compte : sur tes serveurs ou en message privé." : "Une commande dans Discord. Pas encore ouvert."}
              action={DISCORD_PUBLIC ? <ButtonLink to="/dashboard/discord" variant="secondary" size="sm" className="h-11">Ajouter le bot</ButtonLink> : null} />
          </ul>
        </>
      ),
    },

    raccourci: {
      summary: s.raccourci === "done" && g.usedKey
        ? `Raccourci relié : ${quoted(g.usedKey.name || "Sans nom")} a servi ${fmtRelative(g.usedKey.lastUsedAt)}.`
        : g.noActiveKey ? "Aucun jeton actif : crée-en un nouveau."
        : g.replaced ? "Ton nouveau jeton n'a pas encore servi."
        : "Un jeton personnel relie le raccourci à ton compte.",
      body: (
        <>
          <p>Le raccourci {SHORTCUT_NAME} s'ajoute à l'app Raccourcis de ton iPhone. Un jeton personnel le relie à ton compte.</p>
          {!p.keysActive && <p className="mt-3 text-ui text-warn">Le service de conversion n'accepte pas encore les jetons personnels : cette étape se cochera après son ouverture.</p>}
          <ol className="mt-5 space-y-5" aria-label="Installer le raccourci">
            <SubStep n={1} state={g.sub.create} title="Crée ton jeton">
              {g.sub.create === "done" ? (
                <p>{names.length === 1 ? `Jeton actif : ${names[0]}.` : `${names.length} jetons actifs : ${names.join(" et ")}.`}</p>
              ) : (
                <>
                  <p>{g.noActiveKey ? "Tes jetons précédents sont révoqués ou expirés : crée-en un nouveau." : "Il relie le raccourci à ton compte et s'affiche une seule fois."}</p>
                  <ButtonLink to="/dashboard/cles" variant="primary" size="sm" className="mt-3 h-11" icon={<IconKey size={17} />}>Créer mon jeton</ButtonLink>
                </>
              )}
            </SubStep>
            <SubStep n={2} state={g.sub.copy} title="Copie-le">
              {g.sub.copy === "done" ? (
                <p>Copié et collé : le service de conversion l'a bien reçu.</p>
              ) : (
                <p>Il s'affiche une seule fois, à sa création. Tu ne l'as plus ? Régénère-le dans <Link to="/dashboard/cles" className={link}>Mes jetons</Link> : l'ancien cessera de fonctionner.</p>
              )}
            </SubStep>
            <SubStep n={3} state={g.sub.install} title="Installe le raccourci et colle ton jeton">
              {g.sub.install === "done" && g.usedKey ? (
                <p>Ton raccourci s'est connecté {fmtRelative(g.usedKey.lastUsedAt)}.</p>
              ) : (
                <>
                  {g.replaced ? (
                    <p>Ton jeton actuel n'a pas encore servi. Remplace l'ancien dans le raccourci : app Raccourcis, appui long sur {quoted(SHORTCUT_NAME)}, puis Modifier. Ou réinstalle-le.</p>
                  ) : (
                    <p>Ouvre le lien sur ton iPhone : à l'import, l'app Raccourcis te demande ton jeton. Colle-le.</p>
                  )}
                  <div className="-ml-10 mt-3 flex flex-col gap-2 sm:ml-0 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5">
                    {p.icloudUrl ? (
                      <ButtonA href={p.icloudUrl} rel={ICLOUD_REL} variant={g.sub.install === "current" ? "primary" : "secondary"} className={wrapBtn}
                        icon={<ShortcutTile size={20} className="shrink-0" />} trailing={<IconArrowUpRight size={16} className="hidden sm:block" />} data-install="icloud">
                        Installer dans Raccourcis
                      </ButtonA>
                    ) : (
                      <ButtonLink to="/installer" variant={g.sub.install === "current" ? "primary" : "secondary"} className={wrapBtn} icon={<IconDownload size={18} className="shrink-0" />} data-install="parcours">
                        Installer le raccourci
                      </ButtonLink>
                    )}
                    {p.icloudUrl && <Link to="/installer" className={standalone}>Parcours guidé pas à pas</Link>}
                  </div>
                  {/* Ordinateur : on n'installe pas le raccourci ici ; le QR code ouvre le guide sur l'iPhone. */}
                  <div className="mt-4 hidden items-center gap-4 rounded-card border border-line bg-pearl/60 p-3.5 lg:flex" data-guide-qr="">
                    <InstallQr url={`${window.location.origin}/installer`} className="size-[112px] shrink-0" />
                    <p className="text-ui leading-relaxed text-ink-soft">Sur ordinateur ? Scanne ce code avec l'appareil photo de ton iPhone : il ouvre le guide d'installation sur le téléphone.</p>
                  </div>
                </>
              )}
            </SubStep>
          </ol>
          {s.raccourci !== "done" && <p className="mt-5 border-t border-line pt-4 text-ui text-muted">Cette étape se coche dès que ton raccourci utilise ton jeton.</p>}
        </>
      ),
    },

    conversion: {
      summary: s.conversion === "done" && g.latestDone
        ? `Conversion ${g.latestDone.fmt.toUpperCase()}${g.latestDone.platform ? ` depuis ${PLATFORM_NAME[g.latestDone.platform] ?? g.latestDone.platform}` : ""} terminée ${fmtRelative(g.latestDone.finishedAt ?? g.latestDone.createdAt)}.`
        : "Depuis la feuille de partage de l'iPhone.",
      body: (
        <>
          <p>
            Dans YouTube, TikTok ou X, touche Partager, puis {quoted(SHORTCUT_NAME)}, et choisis {quoted(MENU.mp4)} ou {quoted(MENU.mp3)}.
          </p>
          {suspended.length > 0 && (
            <p className="mt-3 text-ui text-warn">En ce moment, {suspended.join(" et ")} {suspended.length > 1 ? "sont suspendus" : "est suspendu"} sur le service.</p>
          )}
          {s.conversion !== "done" && p.busy && (
            <p className="mt-3 text-ui font-medium text-gold-text">Une conversion est en cours sur le serveur.</p>
          )}
          {s.conversion !== "done" && !p.busy && latest?.state === "error" && (
            <div className="mt-3 rounded-card border border-bad/20 bg-bad-bg px-4 py-3 text-ui text-bad">
              <p>Ta dernière tentative a échoué{latest.errorMessage ? ` : ${latest.errorMessage}` : "."}</p>
              {latest.errorCode && <p className="mt-1 text-note wrap-anywhere">Code : <code className="select-all font-mono">{latest.errorCode}</code>. <Link to="/aide" className="underline underline-offset-4">Aide</Link></p>}
            </div>
          )}
          {s.conversion !== "done" && <p className="mt-4 border-t border-line pt-4 text-ui text-muted">Cette étape se coche quand une conversion se termine sur le serveur.</p>}
        </>
      ),
    },

    activite: {
      summary: s.activite === "done"
        ? `${p.countIsFloor ? "Au moins " : ""}${plural(g.conversions, "conversion", "conversions")} dans ton activité.`
        : "Ta première conversion y apparaîtra.",
      body: (
        <>
          <p>Chaque conversion s'inscrit dans ton activité : date, format, plateforme et état. Le lien et le titre de la vidéo ne sont jamais enregistrés.</p>
          <Link to="/dashboard/activite" className={cn(standalone, "mt-1")}>Ouvrir l'activité<IconArrowRight size={15} /></Link>
        </>
      ),
    },
  };
}

function AccessRow({ id, icon, name, status, dot, desc, action, featured = false }: {
  id: string; icon: ReactNode; name: string; status: string; dot: "ready" | "dev" | "soon"; desc: string; action?: ReactNode; featured?: boolean;
}) {
  return (
    <li className={cn("flex flex-col gap-3 p-4 sm:flex-row sm:items-center", featured ? "bg-ivory" : "")} data-access={id}>
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        {/* Tuile du produit (ui/brand/TuileProduit.tsx), la même que sur le site public (« Le Passage », pages). */}
        <span aria-hidden className={cn("access-tile hidden min-[400px]:grid", featured && "is-featured")}>{icon}</span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className={cn("text-ui font-medium", featured ? "text-ink" : "text-ink-soft")}>{name}</span>
            <span className={cn("access-status", dot === "ready" ? "is-ok" : dot === "dev" ? "is-dev" : "is-soon")}><span aria-hidden className="access-status-dot" />{status}</span>
          </p>
          <p className="mt-0.5 text-ui leading-relaxed text-muted">{desc}</p>
        </div>
      </div>
      {action && <div className="shrink-0 [&>*]:w-full sm:[&>*]:w-auto">{action}</div>}
    </li>
  );
}

function SubStep({ n, state, title, children }: { n: number; state: StepState; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3" data-substep={n} data-state={state}>
      <StepMarker state={state} n={n} small className="mt-0.5" label={`Sous-étape ${n} : ${state === "done" ? "faite" : state === "current" ? "à faire" : "plus tard"}`} />
      <div className="min-w-0">
        <p className={cn("text-ui font-semibold", state === "todo" ? "text-ink-soft" : "text-ink")}>{title}</p>
        <div className="mt-1 text-ui leading-relaxed text-ink-soft">{children}</div>
      </div>
    </li>
  );
}
