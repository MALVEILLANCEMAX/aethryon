// Conditions d'utilisation d'AETHRYON (/conditions) : page publique pré-rendue, accessible sans connexion (URL
// demandée par le Discord Developer Portal). Contenu fidèle au service RÉEL : chaque fonction décrite existe, et ce
// qui n'existe pas encore est dit comme tel — l'extension selon sa publication (lib/extension.ts, EXTENSION_DOWNLOAD),
// le bot Discord selon sa phase réelle (lib/discord.ts, DISCORD_PHASE), les quotas lus sur le serveur (/api/config,
// jamais de chiffre inventé). Les informations légales viennent de lib/legal.tsx : celles qui manquent restent
// visibles et bloquent la construction de production (scripts/check-dist.mjs). Aucune animation.
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useConfig, useDocumentTitle } from "../lib/hooks.ts";
import { Legal, LEGAL_PUBLISHED } from "../lib/legal.tsx";
import { EXTENSION_AVAILABLE, EXTENSION_PAGE } from "../lib/extension.ts";
import { DISCORD_AUTO, DISCORD_CONVERTS, DISCORD_MEDIA, DISCORD_PHASE } from "../lib/discord.ts";
import { OFFRES_MODE } from "../lib/offres.ts";

/** Vente ouverte (OFFRES=vente) : les offres payantes existent, régies en plus par les CGV (/cgv). */
const VENTE = OFFRES_MODE === "vente";

const ARTICLES = [
  ["objet", "Objet et acceptation"],
  ["editeur", "Qui édite AETHRYON"],
  ["service", "Le service de conversion"],
  ["compte", "Ton compte"],
  ["raccourci", "Raccourci iPhone"],
  ["extension", "Extension navigateur"],
  ["discord", "Bot Discord"],
  ["quotas", "Quotas et limites techniques"],
  ["droits", "Droits d’auteur et conditions des plateformes"],
  ["interdits", "Utilisations interdites"],
  ["disponibilite", "Disponibilité et responsabilité"],
  ["suspension", "Suspension et suppression de compte"],
  ["donnees", "Données personnelles"],
  ["modifications", "Modification des conditions"],
  ["droit", "Droit applicable et contact"],
] as const;

const link = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";

function Article({ n, id, children }: { n: number; id: (typeof ARTICLES)[number][0]; children: ReactNode }) {
  const title = ARTICLES.find(([a]) => a === id)![1];
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="scroll-mt-28 border-t border-line pb-2 pt-9">
      <h2 id={`${id}-titre`} className="font-display text-[clamp(1.45rem,1.25rem+0.7vw,1.8rem)] font-medium leading-tight">
        <span className="mr-2 text-gold-text [font-variant-numeric:lining-nums]">{n}.</span>{title}
      </h2>
      <div className="mt-4 space-y-3.5 text-[16px] leading-[1.7] text-ink-soft [&_strong]:font-semibold [&_strong]:text-ink">{children}</div>
    </section>
  );
}

function List({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-gold">{children}</ul>;
}

/** Article 7 : ce que fait RÉELLEMENT le bot, selon la phase fixée à la construction (lib/discord.ts). */
function DiscordState() {
  if (DISCORD_PHASE === "inactif") {
    return (
      <>
        <p><strong>État actuel.</strong> L'application « AETHRYON » existe sur Discord, mais elle ne propose encore <strong>aucune commande</strong> : pas de commande slash, aucun message lu, aucun lien ni fichier traité, aucun quota consommé. Aucun programme du bot n'est en service : AETHRYON ne reçoit aucune donnée par son intermédiaire.</p>
        <p><strong>Avant toute ouverture.</strong> Si des commandes sont proposées, cette section décrira avant leur ouverture ce qu'elles font, les liens et fichiers traités et l'usage du quota de ton compte AETHRYON. Le bot ne pourra agir pour ton compte qu'après une liaison que tu auras explicitement acceptée.</p>
      </>
    );
  }
  if (DISCORD_MEDIA) {
    return (
      <>
        <p><strong>Commandes.</strong> Le bot AETHRYON répond à /help (ce qu'il sait faire) et /status (état du service). Une fois ton compte relié, il convertit (/convert, /audio), découpe un extrait (/clip), crée un GIF (/gif), montre un aperçu (/preview), affiche ton compte, ton quota et ton historique (/account, /quota, /history), garde tes médias enregistrés et tes préférences (/saved, /settings) ; le menu « Applications › Convertir avec AETHRYON » d'un message fait de même sans copier le lien. Ses réponses ne sont visibles que par toi.</p>
        <p><strong>Liaison.</strong> Pour utiliser ces commandes, relie d'abord ton compte Discord à ton compte AETHRYON, depuis ton espace ou avec /account, avec la connexion Discord. Tu peux supprimer la liaison à tout moment, depuis ton espace ou avec /account : le bot ne peut alors plus agir pour ton compte.</p>
        <p><strong>Conversion.</strong> Chaque conversion, extrait ou GIF demandé à partir d'un lien compte dans le quota de ton compte, comme toute autre conversion (article 8), et suit les mêmes règles (articles 9 et 10) ; un GIF tiré d'une vidéo que tu viens de convertir et la compression pour Discord ne comptent pas. Le fichier est joint à ta réponse privée s'il tient dans la limite d'envoi de Discord ; sinon, le bot te donne un lien de téléchargement personnel, utilisable une seule fois pendant 10 minutes : ne le partage pas. La compression pour Discord réduit l'image pour tenir dans cette limite, et le bot le dit.</p>
        <p><strong>Partage.</strong> « Partager ici », ou l'option « Tout le monde ici » de /convert et /audio, publie le fichier dans la conversation, avec le lien d'origine et ton nom, là où c'est permis : sur un serveur où AETHRYON est installé, sauf si ses administrateurs l'ont désactivé (/config) ; sur un serveur où seul ton compte l'a installé, si ton rôle permet d'utiliser des applications externes ; dans une conversation privée ou de groupe. Tu es responsable de ce que tu partages : ne partage que des contenus que tu as le droit de diffuser (article 9). Un fichier envoyé dans Discord y est conservé par Discord, selon ses règles.</p>
        <p><strong>Bibliothèque.</strong> « Enregistrer » garde une référence du média (lien, titre, auteur), jamais le fichier ; tu la retires quand tu veux avec /saved.</p>
        <p><strong>Serveurs.</strong> /config est réservé aux personnes autorisées à gérer le serveur{DISCORD_AUTO ? " ; elles peuvent y activer des cartes automatiques sous les liens publiés dans les salons choisis. Ces cartes ne convertissent rien d'elles-mêmes : chaque bouton agit avec le compte de la personne qui clique. Le message d'origine n'est jamais supprimé ; son aperçu peut être masqué seulement si le serveur l'a choisi" : ""}. Aucune donnée personnelle n'est enregistrée avec ces réglages.</p>
      </>
    );
  }
  return (
    <>
      <p><strong>Commandes.</strong> Le bot AETHRYON répond à /ping (vérifier qu'il répond), /help (ce qu'il sait faire) et /status (état du service). Ses réponses ne sont visibles que par toi ; il ne lit pas les messages des salons et n'envoie jamais de message de lui-même.</p>
      {DISCORD_PHASE === "informations" ? (
        <p><strong>Conversion.</strong> /convert et /account existent mais ne convertissent rien encore : la liaison de ton compte Discord à ton compte AETHRYON n'est pas ouverte, et aucun quota n'est consommé. Cette section décrira la conversion avant son ouverture.</p>
      ) : (
        <>
          <p><strong>Liaison.</strong> Pour convertir depuis Discord, relie d'abord ton compte Discord à ton compte AETHRYON depuis ton espace, avec la connexion Discord. Tu peux supprimer la liaison à tout moment, depuis ton espace : le bot ne peut alors plus agir pour ton compte.</p>
          <p><strong>Conversion.</strong> /convert accepte le lien d'une vidéo YouTube, TikTok ou X et le format voulu. La conversion compte dans le quota de ton compte, comme toute autre conversion (article 8), et suit les mêmes règles (articles 9 et 10). Le fichier n'est jamais envoyé dans Discord : le bot te donne un lien de téléchargement personnel, utilisable une seule fois pendant 10 minutes et visible seulement par toi : ne le partage pas. Le bot n'agit que pour le compte AETHRYON que tu as relié. /account affiche l'état de ta liaison et ton quota.</p>
        </>
      )}
    </>
  );
}

/** Article 8 : les limites RÉELLES du serveur (/api/config), jamais de chiffre inventé ; phrase générale sinon. */
function Quotas() {
  const q = useConfig().data?.quotas;
  return (
    <>
      <p>Pendant la bêta, chaque compte dispose de :</p>
      <List>
        <li>{q ? <><strong>{q.daily} conversions par jour</strong>, remises à zéro à minuit, heure de Paris ;</> : <>un nombre limité de <strong>conversions par jour</strong>, remis à zéro à minuit, heure de Paris ;</>}</li>
        <li>{q ? <><strong>{q.maxActive === 1 ? "une conversion" : `${q.maxActive} conversions`} à la fois</strong> ;</> : <>un nombre limité de <strong>conversions simultanées</strong> ;</>}</li>
        <li>{q ? <><strong>{q.maxKeys} jetons personnels</strong> au plus pour le raccourci{EXTENSION_AVAILABLE ? ", et trois extensions connectées" : ""}.</> : <>un nombre limité de <strong>jetons personnels</strong>.</>}</li>
      </List>
      <p>Ce quota est commun à tous les accès : une conversion compte de la même façon qu'elle vienne du raccourci, {EXTENSION_AVAILABLE ? "de l'extension" : "plus tard de l'extension"} ou {DISCORD_CONVERTS ? "du bot Discord" : "plus tard du bot Discord"}. La durée et la taille des vidéos, ainsi que le rythme des demandes, sont aussi limités par le serveur. Les limites en vigueur sont affichées dans ton espace ; elles peuvent évoluer, notamment pour préserver le service.</p>
    </>
  );
}

export default function Conditions() {
  useDocumentTitle("Conditions d'utilisation");
  // Informations légales pas encore fournies (production) : aucune page juridique incomplète, une annonce honnête.
  if (!LEGAL_PUBLISHED) {
    return (
      <div className="container-site max-w-3xl pb-24 pt-28 sm:pt-36" data-conditions-attente="">
        <h1 className="page-title">Conditions d’utilisation</h1>
        <p className="mt-4 text-[17px] leading-relaxed text-ink-soft">
          Les conditions d'utilisation d'AETHRYON sont en cours de finalisation : elles seront publiées ici, complètes, avant
          l'ouverture publique du service. Ce que le service conserve et comment tout effacer est déjà décrit sur la page{" "}
          <Link to="/confidentialite" className={link}>Confidentialité</Link>.
        </p>
      </div>
    );
  }
  return (
    <div className="container-site pb-24 pt-28 sm:pt-36">
      <header className="max-w-3xl">
        <h1 className="page-title">Conditions d’utilisation</h1>
        <p className="mt-4 text-[17px] leading-relaxed text-ink-soft sm:text-lead">
          Les règles d'utilisation d'AETHRYON : le site et ton espace personnel, le raccourci iPhone, l'extension navigateur et le bot Discord. Écrites en français clair, sans renvoi caché.
        </p>
        <dl className="mt-6 grid gap-x-8 gap-y-2 text-[14.5px] sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">En vigueur depuis le</dt><dd className="text-ink"><Legal k="dateEffet" /></dd>
          <dt className="text-muted">Éditeur</dt><dd className="text-ink"><Legal k="editeur" /></dd>
        </dl>
      </header>

      <div className="mt-12 grid gap-10 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-16">
        <nav aria-label="Sommaire" className="lg:sticky lg:top-28 lg:self-start">
          <p className="text-[13px] font-semibold text-ink">Sommaire</p>
          <ol className="mt-3 grid gap-1 border-l border-line text-[14.5px] sm:grid-cols-2 lg:grid-cols-1">
            {ARTICLES.map(([id, title], i) => (
              <li key={id}>
                <a href={`#${id}`} className="-ml-px flex min-h-11 items-center gap-2 border-l border-transparent py-1 pl-4 text-ink-soft transition-colors hover:border-gold hover:text-ink">
                  <span className="w-5 shrink-0 text-gold-text [font-variant-numeric:lining-nums]">{i + 1}.</span>{title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="max-w-3xl">
          <Article n={1} id="objet">
            <p>AETHRYON est un service en ligne qui convertit une vidéo publiée sur YouTube, TikTok ou X en fichier <strong>MP4</strong> (vidéo) ou <strong>MP3</strong> (son seul), à partir de son lien. Ces conditions s'appliquent à tous ses accès : le site raccourci.malvu.fr et ton espace personnel, le raccourci iPhone, l'extension navigateur et le bot Discord.</p>
            <p>En créant un compte ou en utilisant l'un de ces accès, tu acceptes ces conditions. Si tu ne les acceptes pas, n'utilise pas le service.</p>
            {VENTE
              ? <p>Le service est en <strong>bêta</strong>, réservé à un nombre limité de comptes. L'offre Gratuite est sans paiement. Les offres payantes (Premium et Premium à vie) sont régies en plus par les <Link to="/cgv" className={link}>conditions générales de vente</Link>, qui prévalent pour elles.</p>
              : <p>Le service est en <strong>bêta</strong> : il est gratuit, réservé à un nombre limité de comptes, et ne propose aucune fonction payante.</p>}
          </Article>

          <Article n={2} id="editeur">
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
              <dt className="text-ink">Éditeur</dt><dd><Legal k="editeur" /></dd>
              <dt className="text-ink">Directeur de la publication</dt><dd><Legal k="directeur" /></dd>
              <dt className="text-ink">Statut</dt><dd><Legal k="statut" /></dd>
              <dt className="text-ink">Adresse</dt><dd><Legal k="adresse" /></dd>
              <dt className="text-ink">Contact</dt><dd><Legal k="contact" /></dd>
              <dt className="text-ink">Hébergement</dt><dd><Legal k="hebergeur" /></dd>
            </dl>
            <p>AETHRYON n'est ni affilié à YouTube (Google), TikTok, X ou Discord, ni approuvé ou soutenu par eux. Leurs noms servent uniquement à indiquer avec quels services AETHRYON est compatible.</p>
          </Article>

          <Article n={3} id="service">
            <p>Tu fournis le lien d'une vidéo et le format voulu. Le serveur récupère la vidéo, la convertit, puis met le fichier à ta disposition. Le fichier est supprimé du serveur environ une heure après la conversion : enregistre-le sur ton appareil.</p>
            <List>
              <li><strong>YouTube</strong> : vidéos et Shorts, pas les playlists ni les directs.</li>
              <li><strong>TikTok</strong> : vidéos, liens courts compris, pas les diaporamas photo ni les directs.</li>
              <li><strong>X</strong> : publications qui contiennent une vidéo.</li>
            </List>
            <p>Certaines vidéos ne peuvent pas être converties (vidéo privée ou supprimée, accès restreint, blocage du serveur par la plateforme, durée ou taille trop grandes). Le service ne contourne aucune protection technique, comme un système de gestion des droits (DRM).</p>
            <p>Ton espace personnel affiche tes jetons, ton quota du jour et l'historique de tes conversions (date, format, plateforme et état, sans le lien ni le titre des vidéos).</p>
          </Article>

          <Article n={4} id="compte">
            <p>Le compte se crée et se connecte avec un compte Google dont l'adresse e-mail est vérifiée, ou avec ton adresse e-mail, vérifiée par un lien envoyé avant la création du compte, et un mot de passe. Avec Google, AETHRYON ne reçoit ni ton mot de passe Google, ni d'accès à ton compte Google ; ton mot de passe AETHRYON n'est gardé que sous forme hachée. La création de comptes peut être fermée quand le nombre maximal de comptes de la bêta est atteint.</p>
            <p>Tu es responsable de l'usage fait avec ton compte et tes jetons personnels. Un jeton fonctionne comme un mot de passe : ne le partage jamais. S'il a pu être vu par quelqu'un d'autre, révoque-le dans « Mes jetons » et crée-en un nouveau.</p>
          </Article>

          <Article n={5} id="raccourci">
            <p>Le raccourci AETHRYON fonctionne avec l'app Raccourcis d'Apple, présente d'origine sur iPhone. Il s'installe depuis ce site (lien iCloud ou fichier signé) et se relie à ton compte par un jeton personnel que tu crées dans ton espace. Les vidéos sont enregistrées dans Photos, les fichiers MP3 dans Fichiers.</p>
            <p>L'app Raccourcis et iOS relèvent des conditions d'Apple, qui n'est pas partie à ces conditions.</p>
          </Article>

          <Article n={6} id="extension">
            {EXTENSION_AVAILABLE ? (
              <>
                <p>L'extension navigateur AETHRYON ajoute un bouton sous les vidéos YouTube, TikTok et X, dans Chrome, Microsoft Edge ou Brave. Elle utilise ton compte et ton quota, comme le raccourci.</p>
                <List>
                  <li>Elle se télécharge <strong>uniquement depuis ce site</strong> (page <Link to={EXTENSION_PAGE} className={link}>Extension</Link>), sous forme d'archive ZIP accompagnée de son empreinte SHA-256. Une archive obtenue ailleurs n'est pas l'extension officielle.</li>
                  <li>Tu l'installes toi-même, en mode développeur. Elle n'est publiée sur aucune boutique d'extensions et n'est donc pas examinée par Google, Microsoft ou Brave. Les mises à jour ne sont jamais installées sans toi : l'extension te signale une nouvelle version, que tu installes de la même façon.</li>
                  <li>Elle ne se connecte à ton compte qu'avec ton accord explicite, donné sur une page de ce site. Elle reçoit alors une clé personnelle valable 30 jours au plus, que tu peux révoquer à tout moment dans « Mes jetons » ; la déconnecter depuis l'extension la révoque aussi. Trois appareils au plus par compte.</li>
                  <li>Elle n'agit que sur YouTube, TikTok et X, et n'envoie rien tant que tu ne demandes pas un téléchargement. Le détail des données est sur la page <Link to="/confidentialite#extension" className={link}>Confidentialité</Link>.</li>
                  <li>Tu peux l'utiliser pour toi-même ; ne la redistribue pas, en particulier modifiée ou sous le nom d'AETHRYON.</li>
                </List>
              </>
            ) : (
              <>
                <p>L'extension navigateur AETHRYON est <strong>en développement : elle n'est pas encore distribuée</strong>. Lorsqu'elle le sera :</p>
                <List>
                  <li>elle se téléchargera <strong>uniquement depuis ce site</strong>, sous forme d'archive ZIP accompagnée de son empreinte SHA-256. Une archive obtenue ailleurs ne sera pas l'extension officielle ;</li>
                  <li>tu l'installeras toi-même, en mode développeur, sur Chrome, Microsoft Edge ou Brave. Elle ne sera publiée sur aucune boutique d'extensions et ne sera donc pas examinée par Google, Microsoft ou Brave ;</li>
                  <li>elle ne se connectera à ton compte qu'avec ton accord explicite, donné sur une page de ce site, et tu pourras la déconnecter ou révoquer son accès à tout moment ;</li>
                  <li>tu pourras l'utiliser pour toi-même ; ne la redistribue pas, en particulier modifiée ou sous le nom d'AETHRYON.</li>
                </List>
                <p>Ces conditions seront mises à jour avant sa publication si nécessaire.</p>
              </>
            )}
          </Article>

          <Article n={7} id="discord">
            <DiscordState />
            <p><strong>Règles.</strong> Les Conditions d'utilisation et les règles de Discord, ainsi que celles du serveur où tu te trouves, s'appliquent à toute utilisation du bot. Le bot ne doit pas servir à les contourner, ni à contourner les conditions de YouTube, TikTok ou X, ni à envoyer des messages en masse.</p>
            <p><strong>Aide et retrait de l'accès.</strong> Pour toute question : <Legal k="contact" /> ou la page <Link to="/aide" className={link}>Aide</Link>. Pour retirer le bot d'un serveur que tu administres : paramètres du serveur, puis « Intégrations ». Si tu l'as ajouté à ton compte : paramètres utilisateur, puis « Applications autorisées ».</p>
          </Article>

          <Article n={8} id="quotas">
            <Quotas />
          </Article>

          <Article n={9} id="droits">
            <p>Ne convertis que des contenus pour lesquels tu disposes des droits ou des autorisations nécessaires, par exemple tes propres vidéos ou des contenus dont l'auteur autorise la copie. Tu es seul responsable de l'usage que tu fais des fichiers obtenus.</p>
            <p>Les conditions d'utilisation de YouTube, TikTok, X et Discord continuent de s'appliquer à toi ; elles peuvent interdire ou restreindre le téléchargement de leurs contenus. Ni ces conditions, ni le fait que le service fonctionne, ni la distribution directe de l'extension ne t'autorisent à les enfreindre.</p>
            <p>Un titulaire de droits peut signaler un usage abusif à <Legal k="contact" />. Les fichiers ne sont pas conservés au-delà d'environ une heure, et un compte peut être suspendu en cas d'abus (article 12).</p>
          </Article>

          <Article n={10} id="interdits">
            <p>Il est interdit d'utiliser AETHRYON pour :</p>
            <List>
              <li>convertir des contenus sans en avoir les droits ou les autorisations, ou contourner une protection technique ;</li>
              <li>partager ton compte ou tes jetons, ou les mettre à la disposition d'autres personnes ;</li>
              <li>créer plusieurs comptes ou automatiser des demandes pour dépasser les quotas ;</li>
              <li>revendre l'accès au service ou les fichiers obtenus, ou les exploiter commercialement ;</li>
              <li>tenter d'accéder aux comptes d'autres personnes ou aux parties non publiques du service, le surcharger ou l'attaquer ;</li>
              <li>envoyer des liens vers des contenus illicites ;</li>
              <li>distribuer une copie modifiée du raccourci ou de l'extension en la présentant comme officielle.</li>
            </List>
          </Article>

          <Article n={11} id="disponibilite">
            {VENTE
              ? <p>L'offre Gratuite est fournie <strong>sans garantie de disponibilité</strong> : elle peut être interrompue, limitée ou arrêtée, notamment pour une maintenance ou si une plateforme bloque le serveur. Pour les offres payantes, la <strong>garantie légale de conformité</strong> s'applique (<Link to="/cgv#article-10" className={link}>conditions générales de vente, article 10</Link>). Dans tous les cas, aucune garantie n'est donnée qu'une vidéo donnée puisse être convertie, ni sur la qualité obtenue, qui dépend de la plateforme d'origine.</p>
              : <p>Le service est fourni gratuitement pendant la bêta, <strong>sans garantie de disponibilité</strong>. Il peut être interrompu, limité ou arrêté, notamment pour une maintenance ou si une plateforme bloque le serveur. Aucune garantie n'est donnée qu'une vidéo donnée puisse être convertie, ni sur la qualité obtenue, qui dépend de la plateforme d'origine.</p>}
            <p>Dans les limites permises par le droit applicable, l'éditeur n'est pas responsable de l'usage que tu fais des fichiers, des décisions des plateformes, ni des pertes de fichiers non enregistrés sur ton appareil. Rien dans ces conditions ne limite ou n'exclut une responsabilité ou un droit que la loi ne permet pas de limiter ou d'exclure.</p>
          </Article>

          <Article n={12} id="suspension">
            <p><strong>De ton côté</strong>, tu peux supprimer ton compte à tout moment depuis la page <Link to="/confidentialite#donnees" className={link}>Confidentialité</Link> : tes jetons et ton historique sont effacés.</p>
            <p><strong>De notre côté</strong>, un compte peut être suspendu, et ses jetons cesser de fonctionner, en cas de manquement à ces conditions, d'abus, de risque pour le service ou d'obligation légale. Il peut être supprimé si le manquement est grave ou se répète. Sauf urgence ou obligation légale, l'éditeur t'en informe à l'adresse e-mail de ton compte ; tu peux contester la décision en écrivant à <Legal k="contact" />.</p>
            <p>Si le service s'arrête définitivement, une information est publiée sur ce site dans la mesure du possible.</p>
          </Article>

          <Article n={13} id="donnees">
            <p>Les données traitées, leurs finalités, leurs durées de conservation et tes droits sont détaillés sur la page <Link to="/confidentialite" className={link}>Confidentialité</Link>.</p>
          </Article>

          <Article n={14} id="modifications">
            <p>Ces conditions peuvent évoluer, par exemple à l'ouverture de l'extension ou du bot Discord, ou pour suivre la loi. La date d'entrée en vigueur figure en haut de cette page. Un changement important est annoncé sur le site avant de s'appliquer. Si tu n'acceptes pas la nouvelle version, tu peux supprimer ton compte ; continuer à utiliser le service vaut acceptation.</p>
          </Article>

          <Article n={15} id="droit">
            <p>Droit applicable : <Legal k="droit" />.</p>
            <p>En cas de difficulté, écris d'abord à <Legal k="contact" /> pour chercher une solution amiable. À défaut d'accord, le litige relève des juridictions désignées par les règles applicables.</p>
          </Article>
        </div>
      </div>
    </div>
  );
}
