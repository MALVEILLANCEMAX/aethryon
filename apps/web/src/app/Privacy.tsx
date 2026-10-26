// Confidentialité : responsable, données conservées, finalités, durées, destinataires, cookies, extension et bot
// Discord (décrits tels qu'ils fonctionnent RÉELLEMENT : lib/extension.ts et lib/discord.ts décident du texte),
// droits ; export et suppression. Informations légales : lib/legal.tsx (« À compléter » refusé en production).
import { useState } from "react";
import { useNavigate } from "react-router";
import { deleteAccount } from "../lib/auth.ts";
import { useConfig, useDocumentTitle, useMe } from "../lib/hooks.ts";
import { resetAll, useResource } from "../lib/store.ts";
import type { Abonnement } from "../lib/types.ts";
import { Button, ButtonA } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Card } from "../ui/bits.tsx";
import { useToast } from "../ui/Toasts.tsx";
import { toastError } from "./common.tsx";
import { Link } from "react-router";
import { Legal, LEGAL_PUBLISHED } from "../lib/legal.tsx";
import { EXTENSION_AVAILABLE } from "../lib/extension.ts";
import { DISCORD_AUTO, DISCORD_CONVERTS, DISCORD_MEDIA, DISCORD_PHASE } from "../lib/discord.ts";
import { OFFRES_MODE } from "../lib/offres.ts";
import { LegalBody, parse } from "../legal/doc.tsx";
import stockageSource from "../legal/confidentialite-stockage.md?raw";
import venteSource from "../legal/confidentialite-vente.md?raw";

// Textes en Markdown (src/legal) : cookies et stockage (toujours), achats et facturation (vente ouverte et informations
// légales publiées : ils citent l'éditeur, son adresse et son contact). Le titre « ## » devient celui du bloc.
const STOCKAGE = parse(stockageSource);
const VENTE = parse(venteSource);
const titleOf = (blocks: ReturnType<typeof parse>) => { const h = blocks[0]; return h && "text" in h && h.t === "h2" ? h.text : ""; };
const SHOW_VENTE = OFFRES_MODE === "vente" && LEGAL_PUBLISHED;

function Block({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-line py-8">
      <h2 className="font-display text-[24px] font-medium">{title}</h2>
      <div className="mt-3 space-y-3 text-[16px] leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}

/** Bot Discord : ce qu'il traite RÉELLEMENT, selon la phase fixée à la construction (lib/discord.ts). */
function DiscordData() {
  if (DISCORD_PHASE === "inactif") {
    return <p>L'application « AETHRYON » existe sur Discord mais ne propose encore aucune commande, et aucun programme du bot n'est en service : AETHRYON ne reçoit ni ne conserve aucune donnée par son intermédiaire. Si tu l'ajoutes à un serveur ou à ton compte, c'est Discord qui traite les données de ton compte Discord, selon sa propre politique de confidentialité. Avant l'ouverture de toute commande, cette section décrira les données traitées, leurs finalités et leur durée de conservation.</p>;
  }
  if (DISCORD_MEDIA) return <DiscordMediaData />;
  return (
    <>
      <p>{DISCORD_PHASE === "informations"
        ? "Le bot répond aux commandes /ping, /help et /status ; /convert et /account indiquent seulement que la liaison à un compte AETHRYON n'est pas encore ouverte."
        : "Le bot répond aux commandes /ping, /help et /status, et convertit une vidéo avec /convert une fois ton compte Discord relié à ton compte AETHRYON."}</p>
      <ul className="list-disc space-y-2 pl-5">
        <li>Quand tu utilises une commande, Discord transmet au bot ton identifiant Discord, ceux du serveur et du salon, et ce que tu as saisi dans la commande. Le bot s'en sert uniquement pour te répondre, par un message visible seulement par toi.</li>
        <li>Ton identifiant Discord sert aussi, en mémoire seulement, à limiter le nombre de commandes par personne (5 par 30 secondes) : il est oublié ensuite. Les journaux techniques du bot ne contiennent ni identifiant, ni lien, ni texte saisi.</li>
        <li>Le bot ne lit pas les messages des salons (aucun accès à leur contenu) et n'envoie jamais de message de lui-même. Pour /status, il lit l'état public du service, sans donnée personnelle.</li>
        {DISCORD_PHASE === "conversion" && <>
          <li>Liaison : si tu relies ton compte Discord à ton compte AETHRYON (Espace › Discord), AETHRYON conserve l'identifiant, le nom d'utilisateur, le nom d'affichage et la référence de l'image de profil de ton compte Discord (mis à jour quand tu utilises le bot), avec la date de la liaison et celle de la dernière utilisation du bot. Ton image de profil s'affiche dans ton espace en passant par le site : ton navigateur ne contacte pas Discord, et le serveur n'en garde une copie qu'une heure au plus, en mémoire. Discord les transmet après ton accord (autorisation « identify » seulement) ; le jeton de connexion fourni par Discord est jeté aussitôt. AETHRYON ne reçoit ni ton adresse e-mail Discord, ni tes serveurs, ni tes messages. Délier ton compte, depuis ton espace, efface ces informations aussitôt ; supprimer ton compte AETHRYON aussi.</li>
          <li>Conversion : avec /convert, le lien de la vidéo et le format partent vers le service de conversion, comme avec le raccourci. La conversion compte dans ton quota et apparaît dans ton historique (date, format, plateforme et état, jamais le lien ni le titre). Le fichier n'est jamais envoyé dans Discord : le bot t'affiche un lien de téléchargement personnel, utilisable une seule fois pendant 10 minutes.</li>
        </>}
      </ul>
      <p>Discord traite par ailleurs les données de ton compte Discord selon sa propre politique de confidentialité.</p>
    </>
  );
}

/** Bot v2 (docs/DISCORD-BOT.md §18) : ce qu'il traite, ce qu'AETHRYON conserve, combien de temps, comment l'effacer. */
function DiscordMediaData() {
  return (
    <>
      <p>Le bot répond à /help et /status ; une fois ton compte Discord relié à ton compte AETHRYON, il convertit (/convert, /audio, /clip, /gif), montre un aperçu (/preview), affiche ton compte, ton quota et ton historique (/account, /quota, /history), garde tes médias enregistrés et tes préférences (/saved, /settings), et répond au menu « Applications › Convertir avec AETHRYON » d'un message. /config sert aux administrateurs d'un serveur.</p>
      <ul className="list-disc space-y-2 pl-5">
        <li>Quand tu utilises une commande, un bouton ou le menu « Applications », Discord transmet au bot ton identifiant Discord et ton profil public (noms et image), ceux du serveur et du salon, ce que tu as saisi et, pour le menu, le message choisi (texte, liens et aperçus). Le bot s'en sert uniquement pour te répondre ; ses réponses ne sont visibles que par toi, sauf si tu choisis de les partager (« Partager ici », option « Tout le monde ici ») là où c'est permis.</li>
        <li>Ton identifiant Discord sert aussi, en mémoire seulement, à limiter le nombre d'actions par personne : il est oublié ensuite. Les journaux techniques du bot ne contiennent ni identifiant, ni lien, ni titre, ni texte saisi.</li>
        <li>{DISCORD_AUTO
          ? "Le bot ne lit les messages d'un salon que si un administrateur du serveur a activé les cartes automatiques (/config), dans les salons qu'il a choisis : il y repère seulement les liens YouTube, TikTok ou X, n'en conserve rien (ni texte, ni lien, ni auteur) et répond par une carte sous le message, qu'il ne supprime jamais."
          : "Le bot ne lit pas les messages des salons et n'y publie rien de lui-même : il répond seulement à tes commandes, à tes clics et au menu « Applications »."}</li>
        <li>Liaison : si tu relies ton compte Discord à ton compte AETHRYON (depuis ton espace ou avec /account), AETHRYON conserve l'identifiant, le nom d'utilisateur, le nom d'affichage et la référence de l'image de profil de ton compte Discord (mis à jour quand tu utilises le bot), avec la date de la liaison et celle de la dernière utilisation du bot. Ton image de profil s'affiche dans ton espace en passant par le site : ton navigateur ne contacte pas Discord, et le serveur n'en garde une copie qu'une heure au plus, en mémoire. Discord les transmet après ton accord (autorisation « identify » seulement) ; le jeton de connexion fourni par Discord est jeté aussitôt. AETHRYON ne reçoit ni ton adresse e-mail Discord, ni tes serveurs, ni tes messages. Délier ton compte (depuis ton espace ou avec /account) efface ces informations aussitôt ; supprimer ton compte AETHRYON aussi.</li>
        <li>Conversion, extraits et GIF : le lien de la vidéo et les réglages choisis partent vers le service de conversion, comme avec le raccourci. Chaque conversion apparaît dans ton historique (date, format, plateforme et état, jamais le lien ni le titre). Le fichier produit reste au plus une heure sur le serveur d'AETHRYON. S'il tient dans la limite d'envoi de Discord, il est joint à ta réponse privée : Discord le conserve alors avec ce message, selon ses propres règles ; sinon, le bot t'affiche un lien de téléchargement personnel, utilisable une seule fois pendant 10 minutes.</li>
        <li>Aperçu : /preview et le bouton « Aperçu » envoient le lien au service, qui lit seulement les informations publiques de la vidéo (titre, auteur, durée, miniature, tailles estimées) ; rien n'en est conservé.</li>
        <li>Bibliothèque : quand tu cliques « Enregistrer », AETHRYON conserve dans ton compte une référence du média (son lien, son titre, son auteur, sa durée, sa plateforme et la date), 200 au plus, jamais le fichier. Elle n'est visible que par toi et reste gardée jusqu'à ce que tu la retires (/saved, « Retirer » ou « Tout effacer ») ou que tu supprimes ton compte ; délier Discord ne l'efface pas. Elle figure dans l'export de tes données.</li>
        <li>Préférences : /settings garde ton format, ta qualité, ta visibilité et ta langue par défaut avec ton compte, jusqu'à sa suppression.</li>
        <li>Réglages de serveur : /config enregistre, pour un serveur, son identifiant, les salons choisis et les options retenues, sans donnée personnelle ; ils sont effacés quand le bot quitte le serveur, ou après 400 jours sans modification.</li>
      </ul>
      <p>Discord traite par ailleurs les données de ton compte Discord selon sa propre politique de confidentialité.</p>
    </>
  );
}

export default function Privacy() {
  useDocumentTitle("Confidentialité");
  const me = useMe();
  const abo = useResource<Abonnement>(me.data ? "/api/abonnement" : null, 60_000);
  const cfg = useConfig();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await deleteAccount();
      resetAll();
      setConfirm(false);
      toast.show("success", "Compte supprimé", "Tes jetons et ton historique ont été effacés.");
      navigate("/", { replace: true });
    } catch (e) {
      toastError(toast, e, "Suppression impossible");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="container-site max-w-3xl pb-24 pt-28 sm:pt-36">
      <h1 className="page-title">Confidentialité</h1>
      <p className="mt-3 text-[17px] text-ink-soft">Ce que le service conserve, combien de temps, et comment tout effacer.</p>

      <div className="mt-10">
        {LEGAL_PUBLISHED && (
          <Block id="responsable" title="Responsable du traitement">
          <p>Le responsable du traitement des données d'AETHRYON est <Legal k="editeur" />. Pour toute question ou pour exercer tes droits : <Legal k="contact" />.</p>
          </Block>
        )}
        <Block title="Ce qui est conservé">
          <p>À la connexion Google : l'identifiant de ton compte Google, ton adresse e-mail (uniquement si Google l'a vérifiée) et ton nom affiché. Ta photo de profil n'est pas conservée, et aucun accès à ton compte Google n'est gardé : les jetons d'accès Google ne sont jamais enregistrés.</p>
          <p>À l'inscription par e-mail : ton adresse e-mail, vérifiée par un code à 6 chiffres ou un lien à usage unique AVANT la création du compte, le nom que tu choisis et ton mot de passe, uniquement sous forme hachée : personne ne peut le lire, pas même l'administrateur. Du code et du lien d'inscription, seule une empreinte est gardée, effacée au plus tard un jour après leur expiration.</p>
          <p>Tes jetons API, uniquement sous forme d'empreinte : le service ne peut pas les retrouver ni les afficher après leur création.</p>
          <p>Un historique léger des conversions : date, format, plateforme et état. Le lien et le titre des vidéos ne sont pas conservés, ni dans ton historique ni dans les journaux techniques liés à ton compte.</p>
          <p>Si tu actives « Me prévenir » (Espace › Abonnement) : ta demande et sa date, rattachées à ton compte, pour t'envoyer un seul e-mail le jour où Premium ouvrira. Aucune carte ni aucun moyen de paiement n'est demandé ni conservé.</p>
          <p>Pour que la limite quotidienne ne puisse pas être contournée en supprimant puis recréant un compte, une empreinte irréversible de ton adresse e-mail et le nombre de conversions du jour sont gardés 2 jours, même après la suppression du compte.</p>
        </Block>
        <Block id="finalites" title="Pourquoi ces données">
          <ul className="list-disc space-y-2 pl-5">
            <li>Te fournir le service : ton compte, tes jetons, tes conversions et ton historique. {LEGAL_PUBLISHED ? <>Base : l'exécution des <Link to="/conditions" className="text-gold-text underline decoration-gold/50 underline-offset-4">Conditions d'utilisation</Link> que tu acceptes en créant ton compte.</> : "Base : l'exécution du service que tu demandes en créant ton compte."}</li>
            <li>Te prévenir de l'ouverture de Premium, seulement si tu l'as demandé (« Me prévenir »). Base : ton consentement, que tu retires quand tu veux depuis ton espace.</li>
            <li>Faire respecter les quotas et empêcher les abus (empreinte de l'adresse e-mail, limites de débit). Base : l'intérêt légitime à garder un service gratuit utilisable par tous.</li>
            <li>Assurer la sécurité et le bon fonctionnement du service (journaux techniques, journal d'administration). Base : l'intérêt légitime.</li>
          </ul>
          <p>Aucune donnée n'est vendue, utilisée pour de la publicité ou pour du profilage.</p>
        </Block>
        <Block title="Durées de conservation">
          <p>Historique des conversions : {`90`} jours{OFFRES_MODE === "vente" ? " (1 an pour un compte Premium ou Premium à vie)" : ""}. Sessions de connexion : 30 jours sans activité. Journal d'administration : 365 jours. Liens reçus par e-mail : 30 minutes pour l'inscription, une heure pour un nouveau mot de passe, une seule fois. Code d'inscription : 10 minutes, 5 essais au plus. Alerte « Me prévenir » : jusqu'à ce que tu la retires ou que tu supprimes ton compte. Les fichiers convertis sont supprimés du serveur environ une heure après la conversion (réglage par défaut du serveur) ; ceux d'AETHRYON Tools suivent les durées de <a href="#outils" className="text-gold-text underline decoration-gold/50 underline-offset-4">la section Tools</a>.</p>
        </Block>
        <Block id="destinataires" title="Qui reçoit des données">
          <ul className="list-disc space-y-2 pl-5">
            <li>{LEGAL_PUBLISHED ? <>L'hébergeur du service, qui stocke les données pour le compte de l'éditeur : <Legal k="hebergeur" />.</> : "L'hébergeur du service, qui stocke les données pour le compte de l'éditeur."}</li>
            <li>Google, uniquement pour la connexion : c'est toi qui te connectes chez Google, qui transmet ensuite à AETHRYON ton identifiant, ton adresse e-mail vérifiée et ton nom.</li>
            <li>Brevo, relais d'envoi des e-mails du compte (code et lien d'inscription, mot de passe oublié, avis d'ouverture demandé) : il reçoit ton adresse et le contenu de ces e-mails, pour les acheminer. Brevo ajoute à ces e-mails sa propre mesure d'ouverture (une image invisible chargée depuis ses serveurs) et fait passer leurs liens par ses serveurs pour compter les clics ; la version texte de l'e-mail n'en contient pas, et AETHRYON n'utilise pas ces mesures. AETHRYON n'envoie aucun e-mail publicitaire ; l'avis d'ouverture ne part qu'à qui l'a demandé, une fois.</li>
            <li>Les plateformes (YouTube, TikTok, X) reçoivent la demande de la vidéo que tu convertis, faite par le serveur d'AETHRYON : elles ne reçoivent ni ton adresse e-mail ni ton identité AETHRYON.</li>
          </ul>
        </Block>
        <Block id="cookies" title={titleOf(STOCKAGE)}>
          <LegalBody blocks={STOCKAGE.slice(1)} />
        </Block>
        {SHOW_VENTE && (
          <Block id="achats" title={titleOf(VENTE)}>
            <LegalBody blocks={VENTE.slice(1)} />
          </Block>
        )}
        <Block id="extension" title={EXTENSION_AVAILABLE ? "Extension navigateur" : "Extension navigateur (en développement)"}>
          <p>{EXTENSION_AVAILABLE
            ? "L'extension AETHRYON se télécharge uniquement depuis ce site (page Extension) : elle n'est publiée sur aucune boutique d'extensions. Avant toute connexion, elle t'affiche les informations ci-dessous et te demande de les accepter. Voici exactement ce qu'elle fait."
            : "L'extension AETHRYON pour Chrome est en développement : elle n'est publiée sur aucune boutique d'extensions. Voici exactement ce qu'elle fait."}</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Tu la connectes à ton compte depuis ce site, sur une page de consentement. Elle reçoit une clé personnelle (même compte et même quota que le raccourci) que le service ne conserve que sous forme d'empreinte, avec le nom de l'appareil (par exemple « Chrome · Windows »), la date de liaison et la dernière utilisation. Cette clé expire au bout de 30 jours ; tu peux la révoquer à tout moment dans « Mes jetons », et la déconnexion depuis l'extension la révoque aussi. Trois appareils au plus par compte.</li>
            <li>Dans ton navigateur, l'extension garde cette clé, ton adresse e-mail et ton nom (pour l'affichage) dans son stockage local, inaccessible aux sites web. Tes réglages sont synchronisés par Chrome si tu as activé la synchronisation. La liste des derniers téléchargements est effacée à la fermeture du navigateur.</li>
            <li>Sur YouTube, TikTok et X uniquement, elle lit la page pour repérer la vidéo affichée et proposer son bouton. Rien n'est envoyé tant que tu ne cliques pas sur « Télécharger » : seuls le lien de la vidéo choisie et le format demandé partent alors vers le service de conversion, comme avec le raccourci, et le fichier est enregistré par ton navigateur dans le dossier Téléchargements.</li>
            <li>Pour un extrait, elle lit aussi l'instant de lecture et la durée de la vidéo sur la page ; seuls le début et la fin de l'extrait (en secondes) partent avec le lien, et pour un GIF, la demande de le tirer de l'extrait. « Image » copie l'image affichée de la vidéo (ou, si la page l'interdit et que tu as cliqué sur l'icône de l'extension, une capture de l'onglet recadrée sur la vidéo) : elle est enregistrée sur ton ordinateur et n'est envoyée nulle part. « Miniature » la fait télécharger par ton navigateur depuis les serveurs d'images de la plateforme. « Ouvrir dans Tools » envoie au site l'identifiant du fichier déjà converti, pour l'ouvrir dans AETHRYON Tools.</li>
            <li>Pour afficher ton quota et ton activité récente, elle demande au service le nombre de conversions du jour et tes 5 dernières conversions (date, plateforme, format, état, sans lien ni titre).</li>
            <li>Pour afficher la vidéo repérée, elle en charge la miniature depuis les serveurs d'images de la plateforme, comme la page que tu regardes.</li>
            {EXTENSION_AVAILABLE && <li>Deux fois par jour au plus, elle lit sur ce site le fichier public qui décrit sa dernière version, pour te signaler une mise à jour. Cette lecture n'envoie rien de personnel, et rien n'est jamais téléchargé ni installé sans toi.</li>}
            <li>Si tu choisis « Envoyer vers Premiere Pro » et l'autorises, elle informe AETHRYON Desktop, le logiciel installé sur ton ordinateur, de l'avancement de l'envoi : titre de la vidéo, plateforme, format, état et nom du fichier. Cet échange reste sur ton ordinateur ; ni clé, ni adresse de fichier, ni donnée de compte n'y passe.</li>
            <li>Elle ne lit aucun cookie (ni des plateformes, ni de ce site), ni ton historique de navigation, et n'a aucun accès à ton compte Google. Aucune publicité, aucun outil de mesure d'audience, aucune vente ni transmission de données à des tiers.</li>
            <li>Durées : le code de connexion à usage unique n'est valable que 2 minutes et son empreinte est effacée 24 heures après. Une clé révoquée ou expirée cesse aussitôt de fonctionner et est effacée au plus tard 30 jours après.</li>
          </ul>
        </Block>
        <Block id="discord" title="Bot Discord">
          <DiscordData />
        </Block>
        <Block id="outils" title="AETHRYON Tools">
          <ul className="list-disc space-y-2 pl-5">
            <li>Pour retoucher une vidéo ou un son, tu ouvres un lien ou tu importes un fichier. Le fichier (importé avec son nom, ou récupéré depuis la plateforme) est gardé sur le serveur d'AETHRYON, dans un espace réservé à ton compte : aucun autre compte ne peut l'ouvrir, le lire ni le télécharger. Il n'est ni analysé, ni partagé, ni utilisé pour autre chose que les exports que tu demandes (découpe, recadrage, son, GIF, compression), faits par le logiciel FFmpeg sur ce serveur.</li>
            <li>Durées : un média et ses exports sont effacés au plus tard 2 heures après ta dernière action dans l'éditeur (l'éditeur ouvert les garde, 6 heures au plus), ou aussitôt que tu les supprimes depuis « Tes médias ». Un redémarrage du serveur les efface aussi. Un envoi de fichier abandonné est effacé au bout de 30 minutes.</li>
            <li>Ton historique note chaque média ouvert comme une conversion (date, format, plateforme ou « Fichier importé », état, mention Tools), sans lien, titre ni nom de fichier. Les exports ne comptent pas comme des conversions : leur durée est notée en minutes d'export, pondérées par leur coût (4K plus, son rien), sans nom ni contenu, et effacée au bout de 90 jours.</li>
            <li>Quand tu colles un lien, l'aperçu (titre, durée, miniature) est demandé à la plateforme par le serveur d'AETHRYON. La miniature t'est transmise par ce serveur, qui la garde 10 minutes en mémoire : ton navigateur ne contacte pas la plateforme.</li>
            <li>Depuis le bot Discord, « Ouvrir dans Tools » crée un lien utilisable par ton seul compte AETHRYON, valable 55 minutes ; seule une empreinte en est conservée, effacée après son expiration.</li>
          </ul>
        </Block>
        <Block title="Droits sur les contenus">
          <p>Ne convertis que des contenus pour lesquels tu disposes des droits ou des autorisations nécessaires, et respecte les conditions d'utilisation des plateformes. Le service ne contourne aucune protection.</p>
        </Block>
        <Block id="donnees" title="Tes données et tes droits">
          <p>Tu peux accéder à tes données, les rectifier, les effacer, les récupérer dans un format réutilisable, t'opposer à un traitement ou en demander la limitation. Depuis ton espace : export et suppression ci-dessous ; {LEGAL_PUBLISHED ? <>pour le reste, écris à <Legal k="contact" />.</> : "l'adresse de contact pour le reste sera indiquée ici dès sa publication."} Tu peux aussi adresser une réclamation à la CNIL (cnil.fr).</p>
          {me.data ? (
            <Card className="p-6">
              <p className="text-[15.5px] text-ink-soft">Connecté en tant que <span className="text-ink">{me.data.user.email}</span>.</p>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <ButtonA href="/api/account/export" download="youtube-converter-mes-donnees.json" variant="secondary">Exporter mes données</ButtonA>
                <Button variant="danger" onClick={() => setConfirm(true)}>Supprimer mon compte</Button>
              </div>
            </Card>
          ) : (
            <p>Connecte-toi pour exporter tes données ou supprimer ton compte.</p>
          )}
          <p className="text-[14px]">Version du raccourci : {cfg.data?.shortcutVersion ?? "—"}.</p>
        </Block>
      </div>

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Supprimer ton compte ?"
        description={`${abo.data?.plan.id === "vie" ? "Ton offre Premium à vie est liée à ce compte : elle disparaît avec lui, sans remboursement. " : abo.data?.plan.id === "annuel" ? "Ton abonnement Premium est arrêté tout de suite, sans remboursement de la période en cours. " : ""}Ton compte, tes jetons et ton historique seront effacés définitivement. Le raccourci de ton iPhone${EXTENSION_AVAILABLE ? " et l'extension cesseront" : " cessera"} de fonctionner${DISCORD_MEDIA ? ", la liaison de ton compte Discord sera supprimée, ainsi que tes médias enregistrés et tes préférences" : DISCORD_CONVERTS ? " et la liaison de ton compte Discord sera supprimée" : ""}. Si ta connexion date de plus de 24 heures, reconnecte-toi d'abord.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Annuler</Button>
            <Button variant="danger" loading={busy} onClick={remove}>Supprimer définitivement</Button>
          </>
        }
      />
    </div>
  );
}
