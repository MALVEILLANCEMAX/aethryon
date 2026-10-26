import { useDocumentTitle } from "../lib/hooks.ts";
import { AethryonMascot } from "../ui/brand/AethryonMascot.tsx";
import { ButtonLink } from "../ui/Button.tsx";

export default function NotFound() {
  useDocumentTitle("Page introuvable");
  return (
    <section className="container-site flex min-h-svh flex-col items-center justify-center gap-10 pb-16 pt-28 text-center sm:flex-row sm:text-left">
      <AethryonMascot still state="curious" size={200} className="w-[200px] max-w-full shrink-0" />
      <div>
        <p className="font-display text-[18px] text-gold-text [font-variant-numeric:lining-nums]">Erreur 404</p>
        <h1 className="page-title mt-2">Cette page n’existe pas.</h1>
        <p className="mt-3 max-w-md text-ink-soft">Le lien est peut-être incomplet. Reviens à l'accueil ou au parcours d'installation.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3 sm:justify-start">
          <ButtonLink to="/" variant="primary">Retour à l'accueil</ButtonLink>
          <ButtonLink to="/installer" variant="secondary">Installer le raccourci</ButtonLink>
        </div>
      </div>
    </section>
  );
}
