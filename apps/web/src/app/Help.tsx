// Centre d'aide : diagnostics, état réel du service, vérification du jeton, version et nouveautés.
import { useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import { fmtDateTime } from "../lib/format.ts";
import { useConfig, useDocumentTitle, useMe, useStatus } from "../lib/hooks.ts";
import { Button } from "../ui/Button.tsx";
import { IconChevron } from "../ui/Icon.tsx";
import { Card, StatusDot } from "../ui/bits.tsx";
import { useToast } from "../ui/Toasts.tsx";
import { toastError } from "./common.tsx";
import { SHORTCUT_NAME } from "../lib/brand.ts";
import { useShortcutUrl } from "../lib/shortcut.ts";
import { InstallButtons, InstallTextLink } from "../ui/InstallLinks.tsx";
import { CHANGELOG } from "../lib/changelog.ts";
import { usePrerender } from "../lib/prerender.ts";

const link = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";

const DIAGNOSTICS: { q: string; a: React.ReactNode }[] = [
  {
    q: "« Jeton refusé »",
    a: <>Le jeton collé dans le raccourci est inconnu, révoqué ou expiré. Vérifie-le ci-dessous, ou régénère-le dans <Link to="/dashboard/cles" className={link}>Mes jetons</Link>. Pour le changer : app Raccourcis › appui long sur « {SHORTCUT_NAME} » › Modifier, puis remplace le jeton dans le champ de texte du haut ; ou supprime le raccourci et réinstalle-le <InstallTextLink />.</>,
  },
  {
    q: "Le raccourci n'apparaît pas dans la feuille de partage",
    a: <>Fais défiler la feuille de partage jusqu'en bas, touche « Modifier les actions », puis ajoute « {SHORTCUT_NAME} » à tes favoris. Vérifie aussi que le raccourci est bien présent dans l'app Raccourcis.</>,
  },
  {
    q: "Le lien d'installation ne s'ouvre pas",
    a: <>Le lien iCloud officiel s'ouvre dans l'app Raccourcis : ouvre-le depuis Safari plutôt que depuis une app (messagerie, réseau social). En secours, télécharge le fichier signé, puis ouvre-le depuis les téléchargements de Safari (icône en forme de flèche) ou depuis l'app Fichiers › Téléchargements. Si l'iPhone indique que le raccourci n'est pas fiable, mets à jour iOS : les fichiers signés sont acceptés depuis iOS 15.</>,
  },
  {
    q: "L'iPhone ne récupère pas le fichier",
    a: <>Si la conversion apparaît dans ton activité mais que rien n'est enregistré, réinstalle d'abord la dernière version du raccourci <InstallTextLink />. Ensuite, ouvre Réglages › Raccourcis › Avancé et active « Autoriser le partage de grandes quantités de données », puis réessaie. Si le problème continue, fais une capture de l'écran affiché par le raccourci et transmets-la à l'administrateur.</>,
  },
  {
    q: "Le fichier n'est pas dans Photos",
    a: <>Les MP3 vont dans Fichiers (à l'endroit choisi), seules les vidéos MP4 vont dans Photos. Au premier enregistrement, iOS demande l'autorisation d'accéder à Photos : si tu l'as refusée, active-la dans Réglages › Confidentialité et sécurité › Photos › Raccourcis.</>,
  },
  {
    q: "« Limite atteinte »",
    a: <>Pendant la bêta, le nombre de conversions par jour est limité et une seule conversion peut tourner à la fois. Le compteur repart à zéro à minuit (heure de Paris). Suivre une conversion ou télécharger son fichier ne compte pas.</>,
  },
  {
    q: "« Service temporairement indisponible »",
    a: <>Les conversions sont suspendues ou le serveur ne répond pas. L'état du service, en haut de cette page, se met à jour automatiquement. Réessaie un peu plus tard ; les conversions YouTube peuvent aussi être bloquées temporairement par YouTube.</>,
  },
  {
    q: "AETHRYON Tools refuse mon fichier",
    a: <>Tools accepte les vidéos et les sons courants (MP4, MOV, MKV, WebM, MP3, M4A, WAV, OGG, FLAC, AAC) jusqu'à 1 Go, 60 minutes et la 4K. Un fichier abîmé, protégé ou d'un autre type est refusé à la vérification, avant toute retouche, et la conversion comptée pour l'import t'est rendue. Convertis-le d'abord dans un format courant, ou coupe-le s'il est trop long.</>,
  },
  {
    q: "L'envoi d'un fichier dans Tools s'est interrompu",
    a: <>Rouvre-le depuis <Link to="/outils" className={link}>Tools</Link>, « Tes médias », bouton « Reprendre », et choisis le même fichier : seuls les morceaux qui manquent repartent. Un envoi resté 30 minutes sans nouvelles est abandonné, effacé, et la conversion comptée t'est rendue.</>,
  },
  {
    q: "Combien de temps mes médias restent-ils dans Tools ?",
    a: <>Au plus tard 2 heures après ta dernière action dans l'éditeur, qui les garde tant qu'il est ouvert (6 heures au plus). « Supprimer » les efface aussitôt, avec leurs exports, et un redémarrage du serveur les efface aussi : télécharge tes exports dès qu'ils sont prêts.</>,
  },
  {
    q: "Un lien ne s'ouvre pas dans Tools",
    a: <>Tools ouvre les vidéos YouTube, TikTok et X que la plateforme fournit au serveur d'AETHRYON. Si elle refuse (vidéo privée, retirée, réservée à un compte, ou plateforme qui bloque temporairement le serveur), le message en donne la raison. Si tu as la vidéo sur ton appareil, importe le fichier : il passe par le même éditeur.</>,
  },
];

function Diag({ q, a }: { q: string; a: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const prerender = usePrerender();
  const answer = <p className="px-5 pb-5 text-[15.5px] leading-relaxed text-ink-soft">{a}</p>;
  return (
    <div className="border-b border-line last:border-b-0">
      <h3>
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="group flex min-h-[64px] w-full items-center justify-between gap-6 px-5 py-4 text-left text-[16.5px] font-medium transition-colors hover:bg-pearl">
          {q}
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-full border border-line text-gold-text transition-[rotate] duration-300", open && "rotate-180")}><IconChevron size={17} /></span>
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.26 }} className="overflow-hidden">
            {answer}
          </motion.div>
        )}
      </AnimatePresence>
      {/* Pré-rendu : la réponse est dans le HTML, masquée (robots ; lecteurs sans JavaScript : sans-js.css). */}
      {prerender && !open && <div data-sans-js="">{answer}</div>}
    </div>
  );
}

const TONE = { ok: "ok", degraded: "warn", paused: "warn", down: "bad" } as const;
const LABEL = { ok: "Opérationnel", degraded: "Ralenti", paused: "Conversions suspendues", down: "Indisponible" } as const;

export default function Help() {
  useDocumentTitle("Aide et documentation");
  const status = useStatus();
  const cfg = useConfig();
  const shortcut = useShortcutUrl();
  const me = useMe();
  const toast = useToast();
  const [secret, setSecret] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ valid: boolean; status: string; name?: string }>("/api/keys/check", { method: "POST", body: { secret: secret.trim() } });
      setSecret("");
      if (r.valid) setResult(cfg.data?.keysActive
        ? `Ce jeton est actif (« ${r.name} ») et le service de conversion l'accepte. Si le raccourci le refuse, vérifie qu'il a été collé en entier.`
        : `Ce jeton est actif sur ton compte (« ${r.name} »), mais le service de conversion n'accepte pas encore les jetons personnels.`);
      else {
        setResult(r.status === "revoked" ? "Ce jeton a été révoqué : génère-en un nouveau." : r.status === "expired" ? "Ce jeton a expiré : génère-en un nouveau." : "Ce jeton n'est pas reconnu sur ton compte.");
        toast.show("error", "Jeton invalide", "Génère une nouvelle clé depuis ton espace personnel.");
      }
    } catch (err) { toastError(toast, err, "Vérification impossible"); }
  };
  return (
    <div className="container-site pb-24 pt-28 sm:pt-36">
      <p className="text-[14px] font-medium text-gold-text">Documentation</p>
      <h1 className="page-title mt-3">Aide et documentation</h1>
      <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-ink-soft">Problèmes courants, état du service, version du raccourci.</p>

      <div className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby="diag-title" className="order-2 min-w-0 lg:order-1">
          <h2 id="diag-title" className="sr-only">Diagnostics</h2>
          <div className="overflow-hidden rounded-[22px] border border-line bg-ivory shadow-card">
            {DIAGNOSTICS.map((d) => <Diag key={d.q} q={d.q} a={d.a} />)}
          </div>
        </section>
        <div className="order-1 min-w-0 space-y-4 lg:order-2">
          <Card as="section" className="scroll-mt-28 p-6">
            <h2 id="etat" className="font-display text-[22px] font-medium">État du service</h2>
            {/* Hauteur de l'état chargé (état, message d'une ligne, date : 27,2 + 8 + 24 + 8 + 20,8 px) réservée
                pendant l'attente : la page pré-rendue s'affiche avant la réponse, qui arrive sans rien déplacer. */}
            <div className="min-h-[88px]">
              {status.data ? (
                <>
                  <p className="mt-3 flex items-center gap-2.5 text-[17px] font-semibold"><StatusDot tone={TONE[status.data.state]} />{LABEL[status.data.state]}</p>
                  <p className="mt-2 text-[15px] text-ink-soft">{status.data.message}</p>
                  <p className="mt-2 text-[13px] text-muted">Vérifié le {fmtDateTime(status.data.checkedAt)}</p>
                </>
              ) : (
                <p className="mt-3 text-[15px] text-muted">{status.error ? "Impossible de joindre le service pour l'instant." : "Vérification…"}</p>
              )}
            </div>
            <Button size="sm" variant="ghost" className="mt-4 h-11" onClick={() => void status.reload()}>Actualiser</Button>
          </Card>
          <Card as="section" className="p-6">
            <h2 className="font-display text-[22px] font-medium">Vérifier mon jeton</h2>
            {me.data ? (
              <form onSubmit={check} className="mt-3">
                <label htmlFor="help-check" className="text-[14.5px] text-ink-soft">Colle ton jeton : il n'est ni affiché ni conservé.</label>
                <div className="mt-2 flex gap-2">
                  <input id="help-check" type="password" autoComplete="off" spellCheck={false} placeholder="ytc_…" value={secret} onChange={(e) => setSecret(e.target.value)} className="h-12 min-w-0 flex-1 rounded-[14px] border border-field bg-white/70 px-3.5 font-mono text-[15px] placeholder:text-muted" />
                  <Button type="submit" variant="secondary" disabled={secret.trim().length < 10}>Vérifier</Button>
                </div>
                <p className="mt-3 min-h-[22px] text-[15px]" aria-live="polite">{result}</p>
              </form>
            ) : (
              <p className="mt-3 text-[15px] text-ink-soft"><Link to="/connexion?suite=%2Faide" className={link}>Connecte-toi</Link> pour vérifier un jeton.</p>
            )}
          </Card>
          <Card as="section" className="scroll-mt-28 p-6">
            <h2 id="versions" className="font-display text-[22px] font-medium">Version du raccourci</h2>
            <p className="mt-2 text-[15px] text-ink-soft">Version actuelle : <span className="tabular inline-block min-w-[3ch] text-center text-ink">{shortcut.version ?? "…"}</span>. Pour mettre à jour : supprime l'ancien raccourci, réinstalle-le et colle ton jeton. Jeton perdu ? <Link to="/installer" className={link}>Installer</Link> en crée un.</p>
            <InstallButtons className="mt-4" label={shortcut.version ? `Installer la version ${shortcut.version}` : undefined} />
            <ul className="mt-4 space-y-4">
              {CHANGELOG.map((c) => (
                <li key={c.version}>
                  <p className="text-[15px] font-medium">Version {c.version} <span className="font-normal text-muted">({c.date})</span></p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-[14.5px] text-ink-soft marker:text-gold">{c.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
