// Centre d'aide : diagnostics, état réel du service, vérification du jeton, version et nouveautés.
// « Le Passage » (pages, 2026-10-28) : l'état du service dans l'en-tête, les problèmes groupés par produit (tuile du
// produit, icône du symptôme), une recherche instantanée (avec JavaScript), l'historique des versions replié.
import { useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../lib/api.ts";
import { fmtDateTime } from "../lib/format.ts";
import { useConfig, useDocumentTitle, useMe, useStatus } from "../lib/hooks.ts";
import { Button } from "../ui/Button.tsx";
import { ShortcutTile } from "../ui/Icon.tsx";
import { StatusDot } from "../ui/bits.tsx";
import { TuileGlyphe, TuileProduit, type Produit } from "../ui/brand/TuileProduit.tsx";
import { Icone, type NomIcone } from "../ui/egide/Egide.tsx";
import { Frontispice } from "../ui/passage/Passage.tsx";
import { useToast } from "../ui/Toasts.tsx";
import { toastError } from "./common.tsx";
import { SHORTCUT_NAME } from "../lib/brand.ts";
import { useShortcutUrl } from "../lib/shortcut.ts";
import { InstallButtons, InstallTextLink } from "../ui/InstallLinks.tsx";
import { CHANGELOG } from "../lib/changelog.ts";
import { usePrerender } from "../lib/prerender.ts";

const link = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";

const DIAGNOSTICS: { q: string; ico: NomIcone; mots: string; a: React.ReactNode }[] = [
  {
    q: "« Jeton refusé »", ico: "cle", mots: "jeton refuse token cle revoque expire",
    a: <>Le jeton collé dans le raccourci est inconnu, révoqué ou expiré. Vérifie-le ci-dessous, ou régénère-le dans <Link to="/dashboard/cles" className={link}>Mes jetons</Link>. Pour le changer : app Raccourcis › appui long sur « {SHORTCUT_NAME} » › Modifier, puis remplace le jeton dans le champ de texte du haut ; ou supprime le raccourci et réinstalle-le <InstallTextLink />.</>,
  },
  {
    q: "Le raccourci n'apparaît pas dans la feuille de partage", ico: "partager", mots: "feuille partage favoris actions",
    a: <>Fais défiler la feuille de partage jusqu'en bas, touche « Modifier les actions », puis ajoute « {SHORTCUT_NAME} » à tes favoris. Vérifie aussi que le raccourci est bien présent dans l'app Raccourcis.</>,
  },
  {
    q: "Le lien d'installation ne s'ouvre pas", ico: "lien", mots: "installation icloud lien fichier signe fiable",
    a: <>Le lien iCloud officiel s'ouvre dans l'app Raccourcis : ouvre-le depuis Safari plutôt que depuis une app (messagerie, réseau social). En secours, télécharge le fichier signé, puis ouvre-le depuis les téléchargements de Safari (icône en forme de flèche) ou depuis l'app Fichiers › Téléchargements. Si l'iPhone indique que le raccourci n'est pas fiable, mets à jour iOS : les fichiers signés sont acceptés depuis iOS 15.</>,
  },
  {
    q: "L'iPhone ne récupère pas le fichier", ico: "telephone", mots: "fichier enregistre recupere telechargement donnees",
    a: <>Si la conversion apparaît dans ton activité mais que rien n'est enregistré, réinstalle d'abord la dernière version du raccourci <InstallTextLink />. Ensuite, ouvre Réglages › Raccourcis › Avancé et active « Autoriser le partage de grandes quantités de données », puis réessaie. Si le problème continue, fais une capture de l'écran affiché par le raccourci et transmets-la à l'administrateur.</>,
  },
  {
    q: "Le fichier n'est pas dans Photos", ico: "image", mots: "photos mp3 fichiers autorisation",
    a: <>Les MP3 vont dans Fichiers (à l'endroit choisi), seules les vidéos MP4 vont dans Photos. Au premier enregistrement, iOS demande l'autorisation d'accéder à Photos : si tu l'as refusée, active-la dans Réglages › Confidentialité et sécurité › Photos › Raccourcis.</>,
  },
  {
    q: "« Limite atteinte »", ico: "jauge", mots: "limite quota conversions minuit",
    a: <>Pendant la bêta, le nombre de conversions par jour est limité et une seule conversion peut tourner à la fois. Le compteur repart à zéro à minuit (heure de Paris). Suivre une conversion ou télécharger son fichier ne compte pas.</>,
  },
  {
    q: "« Service temporairement indisponible »", ico: "alerte", mots: "service indisponible suspendu serveur youtube bloque",
    a: <>Les conversions sont suspendues ou le serveur ne répond pas. L'état du service, en haut de cette page, se met à jour automatiquement. Réessaie un peu plus tard ; les conversions YouTube peuvent aussi être bloquées temporairement par YouTube.</>,
  },
  {
    q: "AETHRYON Tools refuse mon fichier", ico: "fichier", mots: "tools fichier refuse format taille 4k",
    a: <>Tools accepte les vidéos et les sons courants (MP4, MOV, MKV, WebM, MP3, M4A, WAV, OGG, FLAC, AAC) jusqu'à 1 Go, 60 minutes et la 4K. Un fichier abîmé, protégé ou d'un autre type est refusé à la vérification, avant toute retouche, et la conversion comptée pour l'import t'est rendue. Convertis-le d'abord dans un format courant, ou coupe-le s'il est trop long.</>,
  },
  {
    q: "L'envoi d'un fichier dans Tools s'est interrompu", ico: "televerser", mots: "tools envoi interrompu reprendre",
    a: <>Rouvre-le depuis <Link to="/outils" className={link}>Tools</Link>, « Tes médias », bouton « Reprendre », et choisis le même fichier : seuls les morceaux qui manquent repartent. Un envoi resté 30 minutes sans nouvelles est abandonné, effacé, et la conversion comptée t'est rendue.</>,
  },
  {
    q: "Combien de temps mes médias restent-ils dans Tools ?", ico: "sablier", mots: "tools medias duree conserves supprimes heures",
    a: <>Au plus tard 2 heures après ta dernière action dans l'éditeur, qui les garde tant qu'il est ouvert (6 heures au plus). « Supprimer » les efface aussitôt, avec leurs exports, et un redémarrage du serveur les efface aussi : télécharge tes exports dès qu'ils sont prêts.</>,
  },
  {
    q: "Un lien ne s'ouvre pas dans Tools", ico: "ouvrir", mots: "tools lien video privee plateforme importer",
    a: <>Tools ouvre les vidéos YouTube, TikTok et X que la plateforme fournit au serveur d'AETHRYON. Si elle refuse (vidéo privée, retirée, réservée à un compte, ou plateforme qui bloque temporairement le serveur), le message en donne la raison. Si tu as la vidéo sur ton appareil, importe le fichier : il passe par le même éditeur.</>,
  },
];

/** Un problème : l'icône du symptôme, la question, la réponse qui se déplie (pré-rendue : lisible sans JavaScript). */
function Diag({ q, a, ico }: { q: string; a: React.ReactNode; ico: NomIcone }) {
  const [open, setOpen] = useState(false);
  const prerender = usePrerender();
  const answer = <p className="aide-r">{a}</p>;
  return (
    <div className="aide-q" data-ouvert={open || undefined}>
      <h3>
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="aide-q-bouton">
          <span className="ico-tuile" aria-hidden="true"><Icone nom={ico} duo /></span>
          <span className="aide-q-texte">{q}</span>
          <span className="aide-chevron" aria-hidden="true"><Icone nom="bas" /></span>
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

const GROUPES: { id: string; titre: string; produit: Produit; debut: number; fin: number }[] = [
  { id: "raccourci", titre: "Raccourci iPhone", produit: "iphone", debut: 0, fin: 7 },
  { id: "tools", titre: "AETHRYON Tools", produit: "tools", debut: 7, fin: DIAGNOSTICS.length },
];
/** Recherche tolérante : sans accents ni majuscules, sur la question et ses mots-clés. */
const plat = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const TONE = { ok: "ok", degraded: "warn", paused: "warn", down: "bad" } as const;
const LABEL = { ok: "Opérationnel", degraded: "Ralenti", paused: "Conversions suspendues", down: "Indisponible" } as const;

/** État du service, en tête de page : la pastille, l'heure de la vérification, Actualiser (l'icône tourne une fois). */
function EtatService() {
  const status = useStatus();
  const [tour, setTour] = useState(0);
  return (
    <section id="etat" aria-labelledby="etat-titre" className="aide-etat scroll-mt-28" data-etat={status.data?.state ?? "attente"}>
      <div className="min-w-0">
        <h2 id="etat-titre" className="aide-etat-titre">État du service</h2>
        {/* Hauteur réservée pendant l'attente : la page pré-rendue s'affiche avant la réponse, qui ne déplace rien. */}
        <div className="aide-etat-corps">
          {status.data ? (
            <>
              <p className="aide-etat-ligne"><StatusDot tone={TONE[status.data.state]} /><b>{LABEL[status.data.state]}</b></p>
              {status.data.state !== "ok" && <p className="aide-etat-msg">{status.data.message}</p>}
              <p className="aide-etat-date">Vérifié le {fmtDateTime(status.data.checkedAt)}</p>
            </>
          ) : (
            <p className="aide-etat-date">{status.error ? "Impossible de joindre le service pour l'instant." : "Vérification…"}</p>
          )}
        </div>
      </div>
      <button type="button" className="aide-actualiser" aria-label="Actualiser l'état du service" title="Actualiser" onClick={() => { setTour((t) => t + 1); void status.reload(); }}>
        <Icone key={tour} nom="actualiser" className={tour ? "aide-tourne" : undefined} />
      </button>
    </section>
  );
}

export default function Help() {
  useDocumentTitle("Aide et documentation");
  const cfg = useConfig();
  const shortcut = useShortcutUrl();
  const me = useMe();
  const toast = useToast();
  const prerender = usePrerender();
  const [secret, setSecret] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [cherche, setCherche] = useState("");
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
  const mots = plat(cherche.trim()).split(/\s+/).filter(Boolean);
  const garde = (d: (typeof DIAGNOSTICS)[number]) => mots.every((m) => plat(`${d.q} ${d.mots}`).includes(m));
  const trouves = DIAGNOSTICS.filter(garde).length;
  return (
    <div className="container-site pb-24 pt-28 sm:pt-36">
      <Frontispice
        embleme={<TuileGlyphe glyphe="bouee" size={72} />}
        titre="Aide et documentation"
        ligne="Une réponse pour chaque problème courant."
        aside={<EtatService />}
      />

      <div className="aide-grille">
        <section aria-labelledby="diag-title" className="min-w-0">
          <h2 id="diag-title" className="sr-only">Diagnostics</h2>
          {/* Recherche : seulement avec JavaScript (le HTML pré-rendu montre toutes les réponses). */}
          {!prerender && (
            <div className="aide-cherche">
              <Icone nom="cherche" className="aide-cherche-ico" />
              <input type="search" aria-label="Chercher un problème" placeholder="Décris le problème : jeton, Photos, Tools…" value={cherche}
                onChange={(e) => setCherche(e.target.value)} autoComplete="off" spellCheck={false} />
              <span className="sr-only" aria-live="polite">{mots.length ? `${trouves} réponse${trouves > 1 ? "s" : ""}` : ""}</span>
            </div>
          )}
          {GROUPES.map((g) => {
            const items = DIAGNOSTICS.slice(g.debut, g.fin).filter(garde);
            if (!items.length) return null;
            return (
              <section key={g.id} aria-labelledby={`aide-${g.id}`} className="aide-groupe">
                <h3 id={`aide-${g.id}`} className="aide-groupe-titre"><TuileProduit produit={g.produit} size={34} />{g.titre}</h3>
                <div className="aide-liste">{items.map((d) => <Diag key={d.q} q={d.q} a={d.a} ico={d.ico} />)}</div>
              </section>
            );
          })}
          {mots.length > 0 && trouves === 0 && (
            <div className="aide-vide">
              <span className="ico-tuile" aria-hidden="true"><Icone nom="cherche" duo /></span>
              <p>Rien ne correspond à « {cherche.trim()} ».</p>
              <Button size="sm" variant="ghost" className="h-11" onClick={() => setCherche("")}>Tout afficher</Button>
            </div>
          )}
        </section>

        <div className="aide-cote">
          <section className="aide-panneau" aria-labelledby="aide-jeton">
            <h2 id="aide-jeton" className="aide-panneau-titre"><span className="ico-tuile" aria-hidden="true"><Icone nom="cle" duo /></span>Vérifier mon jeton</h2>
            {me.data ? (
              <form onSubmit={check} className="mt-4">
                <label htmlFor="help-check" className="text-note text-ink-soft">Colle ton jeton : il n'est ni affiché ni conservé.</label>
                <div className="mt-2 flex gap-2">
                  <input id="help-check" type="password" autoComplete="off" spellCheck={false} placeholder="ytc_…" value={secret} onChange={(e) => setSecret(e.target.value)} className="h-12 min-w-0 flex-1 rounded-card border border-field bg-surface px-3.5 font-mono text-ui placeholder:text-muted" />
                  <Button type="submit" variant="secondary" disabled={secret.trim().length < 10}>Vérifier</Button>
                </div>
                <p className="mt-3 min-h-[22px] text-ui" aria-live="polite">{result}</p>
              </form>
            ) : (
              <p className="mt-3 text-ui text-ink-soft"><Link to="/connexion?suite=%2Faide" className={link}>Connecte-toi</Link> pour vérifier un jeton.</p>
            )}
          </section>
          <section className="aide-panneau scroll-mt-28" aria-labelledby="versions">
            <h2 id="versions" className="aide-panneau-titre"><ShortcutTile size={40} className="shrink-0 rounded-[11px]" />Raccourci {shortcut.version ?? "…"}</h2>
            <p className="mt-3 text-ui text-ink-soft">Version actuelle : <span className="tabular inline-block min-w-[3ch] text-center text-ink">{shortcut.version ?? "…"}</span>. Pour mettre à jour : supprime l'ancien raccourci, réinstalle-le et colle ton jeton. Jeton perdu ? <Link to="/installer" className={link}>Installer</Link> en crée un.</p>
            <InstallButtons className="mt-4" label={shortcut.version ? `Installer la version ${shortcut.version}` : undefined} />
            <details className="aide-histo">
              <summary>Ce qui a changé<Icone nom="bas" className="aide-histo-ico" /></summary>
              <ul>
                {CHANGELOG.map((c) => (
                  <li key={c.version}>
                    <p className="text-ui font-medium text-ink">Version {c.version} <span className="font-normal text-muted">({c.date})</span></p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-ui text-ink-soft marker:text-gold">{c.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                  </li>
                ))}
              </ul>
            </details>
          </section>
        </div>
      </div>
    </div>
  );
}
