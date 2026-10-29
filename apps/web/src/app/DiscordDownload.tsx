// /discord/telechargement : page d'arrivée d'un lien de téléchargement du bot Discord qui n'a pas pu servir le
// fichier (account, GET /api/discord/telechargement → ?erreur=…). Le lien lui-même télécharge directement ; cette
// page n'apparaît qu'en cas d'échec et ne demande PAS de connexion (le lien est un secret porteur à usage unique).
// Elle dit ce qui s'est passé et quoi faire, honnêtement (relancer une conversion compte dans le quota).
// « Le Passage » (pages) : la tuile du bot en emblème, l'essentiel en repères à icône plutôt qu'en paragraphes.
import { Link, useLocation } from "react-router";
import { useDocumentTitle } from "../lib/hooks.ts";
import { Alert } from "../ui/Alert.tsx";
import { ButtonLink } from "../ui/Button.tsx";
import { TuileProduit } from "../ui/brand/TuileProduit.tsx";
import { Faits, Frontispice } from "../ui/passage/Passage.tsx";

const link = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";
const AGAIN = "Relance la conversion depuis Discord (elle compte dans ton quota du jour).";

/** Erreurs du lien (account, discord.ts DownloadError). */
export const DOWNLOAD_ERRORS: Record<string, { tone: "warn" | "bad" | "info"; title: string; text: string }> = {
  expire: { tone: "warn", title: "Ce lien a expiré", text: `Un lien de téléchargement reste valable 10 minutes. ${AGAIN}` },
  utilise: { tone: "warn", title: "Ce lien a déjà servi", text: `Chaque lien ne sert qu'une fois. Si le téléchargement n'a pas abouti, ${AGAIN.charAt(0).toLowerCase()}${AGAIN.slice(1)}` },
  invalide: { tone: "bad", title: "Lien de téléchargement invalide", text: "Le lien est incomplet ou inconnu. Utilise le bouton « Télécharger » du message du bot, sans le modifier." },
  "fichier-expire": { tone: "warn", title: "Le fichier n'est plus disponible", text: `Les fichiers sont effacés du serveur environ une heure après la conversion. ${AGAIN}` },
  indisponible: { tone: "bad", title: "Service momentanément indisponible", text: "Le fichier n'a pas pu être récupéré. Ton lien reste valable jusqu'à son expiration : retourne dans Discord et touche à nouveau « Télécharger » dans un instant." },
  limite: { tone: "warn", title: "Trop de téléchargements", text: "Trop de téléchargements depuis ta connexion. Réessaie dans une minute avec le bouton du message du bot." },
  compte: { tone: "bad", title: "Compte indisponible", text: "Ce compte AETHRYON n'est plus lié à Discord, ou il est suspendu : le fichier ne peut pas être remis." },
};

export default function DiscordDownload() {
  useDocumentTitle("Téléchargement depuis Discord");
  const code = new URLSearchParams(useLocation().search).get("erreur") ?? "";
  const e = DOWNLOAD_ERRORS[code];
  return (
    <div className="container-site min-h-[60svh] pb-24 pt-28 sm:pt-32" data-telechargement={e ? code : "aucune"}>
      <Frontispice embleme={<TuileProduit produit="discord" size={72} />} titre="Téléchargement"
        ligne="Les fichiers convertis depuis Discord se téléchargent avec le bouton « Télécharger » du message du bot." />
      {e && (
        <Alert tone={e.tone} title={e.title} className="mt-8 max-w-2xl">
          <p>{e.text}</p>
        </Alert>
      )}
      <Faits className="mt-8 max-w-3xl" items={[
        { icone: "lien", texte: "Un lien à usage unique, valable 10 minutes, sans connexion." },
        { icone: "sablier", texte: "Le fichier reste environ une heure sur le serveur, puis il est effacé." },
        { icone: "discussion", texte: "Le fichier n'est jamais envoyé dans Discord." },
        { icone: "cache", texte: "Ni le lien de la vidéo ni son titre ne sont conservés." },
      ]} />
      <div className="mt-10 flex flex-col items-start gap-x-6 gap-y-2 sm:flex-row sm:items-center">
        <ButtonLink to="/dashboard/discord" variant="primary">Mon espace › Discord</ButtonLink>
        <Link to="/aide" className={`${link} inline-flex min-h-11 items-center text-ui`}>Aide</Link>
      </div>
    </div>
  );
}
