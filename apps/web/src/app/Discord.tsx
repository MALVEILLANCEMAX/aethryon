// Espace personnel › Discord : liaison d'un compte Discord au compte AETHRYON (docs/DISCORD-BOT.md §17, refonte
// visuelle docs/DESIGN.md §8). États RÉELS lus sur /api/discord : liaison fermée sur ce serveur (« pas encore
// ouverte »), compte non lié (bouton « Lier mon compte Discord » → page d'autorisation de Discord, scope identify
// seulement), compte lié (nom, dates, déliaison confirmée). Bannière du retour de Discord (?liaison=…), annoncée aux
// lecteurs d'écran puis retirée de l'adresse.
// Un panneau obsidienne (comme les cartes produit de l'accueil) montre la liaison elle-même : ton compte AETHRYON et
// ton compte Discord, reliés par un fil d'or quand c'est fait, en pointillé sinon. Puis ce que fait le bot (commandes
// RÉELLES, discord/src/v2/commands.ts, quand la conversion est ouverte) et trois repères de confidentialité.
// Compte lié : le profil Discord RÉEL (image de profil relayée par le site, nom d'affichage, @nom d'utilisateur, tenus
// à jour à chaque utilisation du bot) et ce qui en dépend dans AETHRYON (conversions lancées depuis Discord sur 30 jours,
// médias enregistrés, préférences du bot). Bot public (lib/discord.ts) : les deux liens d'ajout RÉELS de Discord.
// Pictogramme NEUTRE « discussion » (lib/platforms.ts) : le logo officiel de Discord est réservé à la présentation du
// bot. Aucune donnée inventée.
// V3 (2026-10-14) : l'ajout du bot SUR TON COMPTE passe devant (grande carte), le serveur reste une option discrète ;
// la déliaison devient un lien sobre (toujours confirmée) ; ce que le bot voit et conserve, et la livraison des
// fichiers, sont repliés sous une question.
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { motion } from "motion/react";
import { api } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import { DISCORD_CONVERTS, DISCORD_INSTALL, DISCORD_MEDIA, DISCORD_PUBLIC } from "../lib/discord.ts";
import { fmtDate, fmtRelative } from "../lib/format.ts";
import { useCalm, useDocumentTitle, useMe } from "../lib/hooks.ts";
import { invalidate, useResource } from "../lib/store.ts";
import type { DiscordActivity, DiscordLink, DiscordStatus } from "../lib/types.ts";
import { Alert } from "../ui/Alert.tsx";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { IconArrowUpRight, IconLock, IconShield, IconTrash } from "../ui/Icon.tsx";
import { Skeleton } from "../ui/bits.tsx";
import { OwlMark } from "../ui/brand/OwlMark.tsx";
import { PlatformGlyph } from "../ui/brand/PlatformGlyph.tsx";
import { Icone } from "../ui/egide/Egide.tsx";
import { DiscordAvatar } from "../ui/DiscordAvatar.tsx";
import { useToast } from "../ui/Toasts.tsx";
import { LoadError, PageHeader, toastError } from "./common.tsx";
import { LEGAL_PUBLISHED } from "../lib/legal.tsx";

const link = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";

type Tone = "info" | "ok" | "warn" | "bad";
/** Retour de Discord (account, GET /api/discord/callback → ?liaison=…). */
export const RESULTS: Record<string, { tone: Tone; title: string; text: string }> = {
  ok: { tone: "ok", title: "Liaison réussie", text: "Le bot AETHRYON reconnaît maintenant ton compte Discord." },
  annulee: { tone: "info", title: "Liaison annulée", text: "Tu as annulé sur la page de Discord : rien n'a été lié." },
  expiree: {
    tone: "warn", title: "La demande de liaison a expiré",
    text: "Une demande est valable 10 minutes, une seule fois, depuis la session qui l'a lancée. Recommence : c'est immédiat.",
  },
  "deja-liee": {
    tone: "bad", title: "Ce compte Discord est déjà lié à un autre compte AETHRYON",
    text: "Délie-le depuis cet autre compte, ou choisis un autre compte Discord sur la page de Discord.",
  },
  "autre-discord": { tone: "warn", title: "Ton compte est déjà lié à un autre compte Discord", text: "Délie-le ci-dessous pour en lier un autre." },
  echec: { tone: "bad", title: "Discord n'a pas répondu comme prévu", text: "Rien n'a été lié. Réessaie dans quelques instants." },
  fermee: { tone: "info", title: "La liaison n'est pas encore ouverte", text: "Rien n'a été lié." },
};

/** Commandes RÉELLES du bot (discord/src/v2/commands.ts), quand la conversion est ouverte : libellé court et pictogramme
 *  (le détail reste dans la description de chaque commande, affichée par Discord). */
const COMMANDS: { name: string; text: string; icon: "video" | "son" | "gif" | "biblio" | "info" | "ciseaux"; media?: true }[] = [
  { name: "/convert", text: "MP4 ou MP3", icon: "video" },
  { name: "/audio", text: "Le son, en MP3", icon: "son" },
  { name: "/preview", text: "Aperçu privé", icon: "info", media: true },
  { name: "/clip", text: "Un extrait", icon: "ciseaux", media: true },
  { name: "/gif", text: "Un GIF", icon: "gif", media: true },
  { name: "/saved", text: "Ta bibliothèque", icon: "biblio", media: true },
];

type LinkState = "lie" | "non-lie" | "fermee" | "chargement";

/** Le fil entre les deux comptes : or et continu une fois lié, pointillé sinon (tracé une fois, hors mouvement réduit). */
function Wire({ state }: { state: LinkState }) {
  const calm = useCalm();
  const linked = state === "lie";
  return (
    <span className={cn("dl-wire", linked ? "is-linked" : "is-open")} aria-hidden>
      <svg viewBox="0 0 120 12" preserveAspectRatio="none" className="dl-wire-svg">
        <line x1="2" y1="6" x2="118" y2="6" className="dl-wire-base" />
        {linked && (
          <motion.line x1="2" y1="6" x2="118" y2="6" className="dl-wire-gold"
            initial={calm ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: [0.22, 0.8, 0.26, 1], delay: 0.15 }} />
        )}
      </svg>
      <span className="dl-wire-node">{linked ? <IconLock size={12} /> : <span className="dl-wire-dot" />}</span>
    </span>
  );
}

/** Nom montré pour le compte Discord : le nom d'affichage s'il existe, sinon le nom d'utilisateur. */
const shownName = (d: DiscordLink) => d.displayName || d.name;

/** La liaison en image : ton compte AETHRYON, le fil, ton compte Discord (image de profil et nom réels une fois lié). */
function LinkDiagram({ state, name, discord }: { state: LinkState; name: string; discord: DiscordLink | null }) {
  return (
    <div className="dl-diagram" aria-hidden>
      <span className="dl-node">
        <span className="dl-node-tile is-owl"><OwlMark size={26} surface="dark" /></span>
        <span className="dl-node-text"><b>AETHRYON</b><span>{name}</span></span>
      </span>
      <Wire state={state} />
      <span className={cn("dl-node is-right", state !== "lie" && "is-pending")}>
        {discord ? (
          <span className="dl-node-tile is-avatar">
            <DiscordAvatar version={discord.avatarVersion} name={shownName(discord)} size={58} />
            <span className="dl-node-badge"><PlatformGlyph id="discord" size={12} /></span>
          </span>
        ) : <span className="dl-node-tile"><PlatformGlyph id="discord" size={22} /></span>}
        <span className="dl-node-text">
          <b>{discord ? shownName(discord) : "Discord"}</b>
          <span>{discord ? `@${discord.name}` : state === "fermee" ? "Pas encore ouverte" : "À relier"}</span>
        </span>
      </span>
    </div>
  );
}

const PREF_FMT: Record<string, string> = { mp4: "MP4", mp3: "MP3" };
const PREF_QUALITY: Record<string, string> = { auto: "qualité auto", "1080": "1080p au plus", "720": "720p au plus" };
const PREF_VISIBILITY: Record<string, string> = { private: "résultat privé", share: "partage proposé" };

/** Ce qui est relié à Discord dans AETHRYON : chiffres RÉELS lus sur /api/discord (account, discord.activity). */
function ActivityStrip({ a }: { a: DiscordActivity }) {
  const fmt = PREF_FMT[a.prefs.fmt] ?? a.prefs.fmt.toUpperCase();
  const prefs = [fmt, a.prefs.fmt === "mp4" ? PREF_QUALITY[a.prefs.quality] : null, PREF_VISIBILITY[a.prefs.visibility]].filter(Boolean).join(", ");
  return (
    <dl className="dl-stats" data-discord-activite="">
      <div>
        <dt>Depuis Discord, 30 derniers jours</dt>
        <dd><b data-stat="conversions">{a.conversions30d.toLocaleString("fr-FR")}</b>{a.conversions30d > 1 ? " conversions" : " conversion"}</dd>
      </div>
      <div>
        <dt>Bibliothèque <code>/saved</code></dt>
        <dd><b data-stat="saved">{a.saved.toLocaleString("fr-FR")}</b>{a.saved > 1 ? " médias enregistrés" : " média enregistré"}</dd>
      </div>
      <div>
        <dt>Préférences du bot <code>/settings</code></dt>
        <dd className="is-text" data-stat="prefs">{prefs}</dd>
      </div>
    </dl>
  );
}

/** Ajout du bot : les deux liens RÉELS de Discord (lib/discord.ts), ouverts dans un nouvel onglet. Le compte personnel
 *  d'abord (aucune permission sur un serveur, le bot te suit partout) ; le serveur ensuite, en une ligne. Bot déjà en
 *  service (compte lié ET utilisé) : une seule ligne discrète, pour l'ajouter ailleurs. */
function Install({ compact }: { compact: boolean }) {
  const go = <span className="sr-only"> (discord.com, nouvel onglet)</span>;
  if (compact) {
    return (
      <section aria-labelledby="discord-ajouter" className="mt-8" data-ajouter="">
        <div className="dl-add-compact">
          <span className="dl-add-tile is-small" aria-hidden><PlatformGlyph id="discord" size={17} /></span>
          <h2 id="discord-ajouter" className="dl-add-compact-title">Ajouter le bot ailleurs</h2>
          <span className="dl-add-compact-links">
            <a href={DISCORD_INSTALL.user} target="_blank" rel="noopener noreferrer" data-install="user">Sur ton compte<IconArrowUpRight size={14} />{go}</a>
            <a href={DISCORD_INSTALL.guild} target="_blank" rel="noopener noreferrer" data-install="guild">Sur un serveur<IconArrowUpRight size={14} />{go}</a>
          </span>
        </div>
      </section>
    );
  }
  return (
    <section aria-labelledby="discord-ajouter" className="mt-10" data-ajouter="">
      <h2 id="discord-ajouter" className="font-display text-[24px] font-medium">Ajouter le bot</h2>
      <div className="dl-add mt-4">
        <a href={DISCORD_INSTALL.user} target="_blank" rel="noopener noreferrer" className="dl-add-main" data-install="user">
          <span className="dl-add-tile" aria-hidden><PlatformGlyph id="discord" size={22} /></span>
          <span className="dl-add-copy">
            <span className="dl-add-chip">Conseillé</span>
            <b>Sur ton compte Discord</b>
            <span>Partout : tes serveurs et tes messages privés. Aucune permission sur un serveur.</span>
          </span>
          <span className="dl-install-go">Ajouter à mon compte<IconArrowUpRight size={15} />{go}</span>
        </a>
        <a href={DISCORD_INSTALL.guild} target="_blank" rel="noopener noreferrer" className="dl-add-alt" data-install="guild">
          <span className="dl-add-alt-text"><b>Sur un serveur</b>, pour tous ses membres.</span>
          <span className="dl-add-alt-go">Ajouter à un serveur<IconArrowUpRight size={14} />{go}</span>
        </a>
      </div>
    </section>
  );
}

export default function Discord() {
  useDocumentTitle("Discord");
  const toast = useToast();
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const st = useResource<DiscordStatus>("/api/discord", 15_000);
  // Résultat du retour de Discord : lu une fois, puis retiré de l'adresse (un rechargement ne le réaffiche pas).
  const [result, setResult] = useState<string | null>(() => new URLSearchParams(location.search).get("liaison"));
  useEffect(() => {
    if (new URLSearchParams(location.search).has("liaison")) navigate({ pathname: location.pathname, hash: location.hash }, { replace: true });
  }, [location.search, location.pathname, location.hash, navigate]);
  const [starting, setStarting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const banner = result ? RESULTS[result] ?? null : null;
  // Retour de Discord : le focus va sur la bannière (lue par les lecteurs d'écran, même présente dès l'affichage).
  const bannerRef = useRef<HTMLDivElement>(null);
  const announced = useRef(false);
  useEffect(() => {
    if (banner && !announced.current) { announced.current = true; bannerRef.current?.focus(); }
  }, [banner]);

  const startLink = async () => {
    setStarting(true);
    setResult(null);
    try {
      const { url } = await api<{ url: string }>("/api/discord/link", { method: "POST" });
      window.location.assign(url); // page d'autorisation de Discord, puis retour ici
    } catch (e) {
      setStarting(false);
      toastError(toast, e, "Liaison impossible");
      void st.reload();
    }
  };

  const unlink = async () => {
    setUnlinking(true);
    try {
      await api("/api/discord/unlink", { method: "POST" });
      setConfirm(false);
      setResult(null);
      toast.show("success", "Compte Discord délié", "Le bot AETHRYON ne reconnaît plus ce compte Discord.");
      invalidate("/api/discord");
    } catch (e) {
      toastError(toast, e, "Déliaison impossible");
    } finally {
      setUnlinking(false);
    }
  };

  // Serveur sans liaison Discord (account plus ancien : /api/discord inconnue, 404) : c'est « pas encore ouverte ».
  const data: DiscordStatus | undefined = st.data ?? (st.error?.status === 404 ? { enabled: false, linked: false, discord: null } : undefined);
  const state: LinkState = data ? (data.linked ? "lie" : data.enabled ? "non-lie" : "fermee") : "chargement";
  const who = me.data?.user.name || me.data?.user.email || "Ton compte";
  const commands = COMMANDS.filter((c) => !c.media || DISCORD_MEDIA);
  return (
    <div data-discord={state}>
      <PageHeader title="Discord" lead={DISCORD_PUBLIC ? "Le bot AETHRYON dans Discord, avec ton compte." : "Relie ton compte Discord au bot AETHRYON."} />

      {banner && (
        <div ref={bannerRef} tabIndex={-1} className="mt-6 rounded-[20px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-text" data-liaison={result}>
          <Alert tone={banner.tone} title={banner.title} live>
            <p>{banner.text}</p>
          </Alert>
        </div>
      )}

      <section className="dl-panel mt-8" aria-labelledby="discord-etat" data-dl-panel="">
        <h2 id="discord-etat" className="sr-only">État de la liaison</h2>
        {st.loading && !data ? (
          <div className="dl-body" aria-busy="true" aria-label="Chargement de la liaison Discord">
            <Skeleton night className="h-7 w-56 max-w-full" /><Skeleton night className="mt-3 h-4 w-full max-w-md" /><Skeleton night className="mt-6 h-11 w-60" />
          </div>
        ) : st.error && !data ? (
          <div className="dl-body dl-error">
            <LoadError onRetry={() => void st.reload()}>La liaison Discord n'a pas pu être chargée : le serveur n'a pas répondu. Rien n'a changé.</LoadError>
          </div>
        ) : data ? (
          <div className="dl-body">
            <LinkDiagram state={state} name={who} discord={data.linked ? data.discord : null} />
            {data.linked && data.discord ? (
              <div className="dl-copy">
                <span className="dl-chip is-ok"><span aria-hidden className="dl-chip-dot" />Compte Discord lié</span>
                <p className="dl-title" data-discord-affichage="">{shownName(data.discord)}</p>
                <p className="dl-name" data-discord-nom="">@{data.discord.name}</p>
                <p className="dl-meta">
                  <span>Lié le {fmtDate(data.discord.linkedAt)}</span>
                  <span>{data.discord.lastUsedAt ? `Bot utilisé ${fmtRelative(data.discord.lastUsedAt)}` : "Pas encore utilisé par le bot"}</span>
                </p>
                {!data.enabled && <p className="dl-text">La liaison est fermée sur le serveur pour le moment : tu peux tout de même délier ton compte.</p>}
                <button type="button" className="dl-unlink" onClick={() => setConfirm(true)}>
                  Délier ce compte Discord<span className="sr-only"> (@{data.discord.name})</span>
                </button>
              </div>
            ) : !data.enabled ? (
              <div className="dl-copy">
                <span className="dl-chip"><span aria-hidden className="dl-chip-dot" />Pas encore ouverte</span>
                <p className="dl-title">La liaison n'est pas encore ouverte</p>
                <p className="dl-text">Le bot AETHRYON pour Discord est en développement. Quand la liaison ouvrira, tu relieras ton compte ici, en un clic. En attendant, rien n'est demandé ni conservé.</p>
              </div>
            ) : (
              <div className="dl-copy">
                <span className="dl-chip"><span aria-hidden className="dl-chip-dot" />Non lié</span>
                <p className="dl-title">Aucun compte Discord lié</p>
                <p className="dl-text">
                  {DISCORD_CONVERTS ? "Le bot convertit alors avec ton quota et ton historique. Discord ne transmet que ton identifiant." : "Le bot affiche alors ton quota du jour. Discord ne transmet que ton identifiant."}
                </p>
                <div className="dl-actions">
                  <Button variant="light" loading={starting} onClick={startLink} trailing={<IconArrowUpRight size={17} />}>
                    {starting ? "Ouverture de Discord…" : "Lier mon compte Discord"}
                  </Button>
                </div>
              </div>
            )}
            {data.linked && data.activity && <ActivityStrip a={data.activity} />}
          </div>
        ) : null}
      </section>

      {DISCORD_PUBLIC && <Install compact={!!(data?.linked && data.discord?.lastUsedAt)} />}

      {DISCORD_CONVERTS && (
        <section aria-labelledby="discord-commandes" className="mt-10" data-commandes="">
          <h2 id="discord-commandes" className="font-display text-[24px] font-medium">Ce que fait le bot</h2>
          <ul className="dl-commands mt-4">
            {commands.map((c) => (
              <li key={c.name}><span className="dl-command-ico" aria-hidden><Icone nom={c.icon} /></span><code>{c.name}</code><span>{c.text}</span></li>
            ))}
          </ul>
        </section>
      )}

      <details className="fold mt-8" data-conserve="">
        <summary>Ce que le bot voit et conserve</summary>
        <div className="fold-body">
          <ul className="dl-facts">
            <li><span className="dl-fact-ico"><IconShield size={18} /></span><b>Ton identifiant, tes noms et la référence de ton image Discord</b><span>mis à jour quand tu utilises le bot, avec les dates de liaison et de dernier usage. L'image passe par le site, pas par Discord.</span></li>
            <li><span className="dl-fact-ico"><IconLock size={18} /></span><b>Jamais tes messages</b><span>ni ton e-mail, ni tes serveurs ; le jeton de connexion de Discord est jeté dès que ton identifiant est lu.</span></li>
            <li><span className="dl-fact-ico"><IconTrash size={18} /></span><b>Délier efface tout</b><span>tout de suite, comme la suppression du compte. Tes conversions restent dans ton historique.</span></li>
          </ul>
          <p className="mt-5">Avant tout ajout, Discord te montre ce que le bot demande. Sur un serveur, il faut pouvoir le gérer{"\u00a0"}; ses administrateurs règlent le bot avec <code>/config</code>.</p>
          {DISCORD_CONVERTS && (
            <p className="mt-3">
              {DISCORD_MEDIA
                ? "Le fichier arrive dans la conversation, ou par un lien personnel valable 10 minutes s'il dépasse la limite de Discord. Réponses privées par défaut\u00a0; «\u00a0Partager ici\u00a0» les montre au salon si le serveur le permet."
                : "Le bot donne un lien de téléchargement personnel, valable 10 minutes. Ses réponses ne sont visibles que par toi."}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-5 text-[14.5px]">
            <Link to="/confidentialite" className={`${link} inline-flex min-h-11 items-center`}>Confidentialité</Link>
            {LEGAL_PUBLISHED && <Link to="/conditions" className={`${link} inline-flex min-h-11 items-center`}>Conditions d'utilisation</Link>}
          </div>
        </div>
      </details>

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Délier ton compte Discord ?"
        description={<>Le bot AETHRYON ne reconnaîtra plus {data?.discord ? <>le compte <span className="font-medium text-ink">@{data.discord.name}</span></> : "ce compte Discord"} : il ne pourra plus afficher ton quota ni lancer de conversion, et les liens de téléchargement en attente cesseront de fonctionner. Tes conversions passées restent dans ton historique. Tu pourras le relier à tout moment.</>}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Annuler</Button>
            <Button variant="danger" loading={unlinking} onClick={unlink}>Délier</Button>
          </>
        }
      />
    </div>
  );
}
