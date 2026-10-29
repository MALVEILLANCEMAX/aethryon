// Pied de page AETHRYON, « atelier de nuit » (2026-10-28) : des tuiles pleines (devise et mentions, liens vers des pages
// qui existent, état du service et soutien), le nom en grand, l'action en or ; puis la non-affiliation.
import { Link } from "react-router";
import { useConfig, useMe, useStatus } from "../lib/hooks.ts";
import { TRADEMARK_NOTICE } from "../lib/platforms.ts";
import { LEGAL_PUBLISHED } from "../lib/legal.tsx";
import { OFFRES_MODE, TARIFS_LABEL } from "../lib/offres.ts";
import { SOUTIEN_URL } from "../lib/soutien.ts";
import { GITHUB_PUBLIC, GITHUB_URL } from "../lib/github.ts";
import { GithubMark } from "./brand/GithubMark.tsx";
import { ouvrirPreferences } from "../lib/confidentialite.ts";
import { ouvrirNouveautes, VERSION_SITE } from "../lib/nouveautes.ts";
import { TAGLINE } from "../lib/brand.ts";
import { Medaille } from "./egide/Egide.tsx";
import { IconCup } from "./Icon.tsx";
import { Icone } from "./egide/Egide.tsx";
import { useLangue } from "../lib/langue.ts";
import { useT } from "../i18n/accueil.ts";

const TON = { ok: "ok", degraded: "warn", paused: "warn", down: "err" } as const;
// Mention des marques : le texte de référence est le français (lib/platforms.ts) ; ses traductions disent la même chose.
const MARQUES_EN = "AETHRYON is an independent service, not affiliated with or endorsed by Google, TikTok, X, Discord, Apple or Adobe. YouTube and YouTube Shorts are trademarks of Google LLC. TikTok is a trademark of its owners. X is a trademark of X Corp. Discord is a trademark of Discord Inc. iPhone is a trademark of Apple Inc., registered in the U.S. and other countries and regions. Adobe and Premiere Pro are trademarks of Adobe.";
const MARQUES_ES = "AETHRYON es un servicio independiente, sin relación con Google, TikTok, X, Discord, Apple ni Adobe, ni aprobado por ellos. YouTube y YouTube Shorts son marcas de Google LLC. TikTok es una marca de sus titulares. X es una marca de X Corp. Discord es una marca de Discord Inc. iPhone es una marca de Apple Inc., registrada en EE. UU. y en otros países y regiones. Adobe y Premiere Pro son marcas de Adobe.";

export function Footer() {
  const cfg = useConfig();
  const st = useStatus();
  const me = useMe();
  const connecte = !!me.data && !me.error;
  const t = useT();
  const langue = useLangue();
  const f = t.pied;
  const produit: [string, string][] = [["/", f.convertir], ["/#applications", t.applications], ["/outils", f.outils],
    ["/installer", f.installerRaccourci], ["/#plateformes", t.plateformes], ["/#tarifs", langue === "fr" ? TARIFS_LABEL : t.tarifs]];
  const compte: [string, string][] = connecte
    ? [["/dashboard", t.monEspace], ["/dashboard/cles", f.jetons], ["/dashboard/activite", f.activite], ["/dashboard/apparence", f.apparence]]
    : [["/commencer", t.creerCompte], ["/connexion", t.seConnecter]];
  // Pages juridiques publiées seulement quand elles sont complètes ; CGV et remboursement seulement quand la vente est
  // ouverte (OFFRES=vente) : rien ne renvoie à des conditions de vente sans vente.
  const infos: [string, string][] = [
    ...(LEGAL_PUBLISHED ? [["/mentions-legales", f.mentions], ["/conditions", f.conditions]] as [string, string][] : []),
    ...(LEGAL_PUBLISHED && OFFRES_MODE === "vente" ? [["/cgv", f.cgv], ["/remboursement", f.remboursements]] as [string, string][] : []),
    ["/confidentialite", f.confidentialite], ["/aide", t.aide], ["/aide#versions", f.raccourci(cfg.data?.shortcutVersion ?? "—")]];
  return (
    <footer className="s-pied pd">
      {/* « Atelier de nuit » (2026-10-28) : un tableau de tuiles pleines, sans filet ; le nom revient en grand, l'or ne
          marque que l'action. */}
      <div className="pd-tuiles">
        <div className="pd-tuile pd-devise">
          {/* Le nom est déjà écrit en grand dans la tuile voisine : ici, la chouette seule. */}
          <Link to="/" className="pd-logo" aria-label="AETHRYON, accueil"><Medaille taille={44} /></Link>
          <p className="pd-phrase">{langue === "fr" ? TAGLINE : f.tagline}</p>
          <p className="pd-promesse">{f.promesse}</p>
          {/* L'action du pied de page : une pilule, comme les commandes de l'accueil (plus de grand aplat d'or). */}
          <Link to={connecte ? "/dashboard" : "/commencer"} className="ac-bouton pd-action" data-pied-action="">
            <Icone nom={connecte ? "compte" : "etincelle"} taille="s" />{connecte ? t.ouvrirMonEspace : f.commencer}
          </Link>
          <p className="pd-petit">{f.copyright(new Date().getFullYear())}</p>
        </div>
        <nav aria-label={f.liens} className="pd-tuile pd-liens">
          <ul>{produit.map(([to, label]) => <li key={to}><Link to={to}>{label}</Link></li>)}</ul>
          <ul>
            {compte.map(([to, label]) => <li key={to}><Link to={to}>{label}</Link></li>)}
            {infos.map(([to, label]) => <li key={to}><Link to={to}>{label}</Link></li>)}
            {/* Préférences de confidentialité, Nouveautés de la version, film de lancement : à rouvrir. */}
            <li><button type="button" onClick={ouvrirPreferences} data-ouvrir-preferences="">{t.confidentialite}</button></li>
            <li><button type="button" onClick={ouvrirNouveautes} data-ouvrir-nouveautes="">{t.nouveautes(VERSION_SITE)}</button></li>
            <li><a href="/media/film/aethryon-v35-1080.mp4" data-film-lien="">{f.film}</a></li>
          </ul>
        </nav>
        <div className="pd-tuile pd-etat">
          <Link to="/aide#etat" className="s-pied-etat">
            <span className="eg-pastille" data-ton={st.data ? TON[st.data.state] : undefined}><span className="eg-pastille-point" aria-hidden="true" />{st.data ? t.etats[st.data.state] : t.etatService}</span>
          </Link>
          {/* Soutien volontaire : lien sortant simple (nouvel onglet, sans référent), rien n'est chargé depuis l'autre site. */}
          <div className="s-pied-soutien" data-soutien="">
            <a href={SOUTIEN_URL} target="_blank" rel="noopener noreferrer" className="pd-soutien" data-soutien-lien="">
              <IconCup size={18} className="shrink-0" />{f.soutenir}<span className="eg-vh">{f.soutenirSr}</span>
            </a>
            {/* Dépôt officiel (code Apache-2.0) : seulement quand il est public (VITE_GITHUB_PUBLIC=1), sinon 404 pour le visiteur. */}
            {GITHUB_PUBLIC && (
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="pd-soutien" data-pied-github="">
                <GithubMark size={18} />{t.github}<span className="eg-vh">{t.githubSr}</span>
              </a>
            )}
          </div>
        </div>
        <div className="pd-tuile pd-nom" aria-hidden="true"><span>AETHRYON</span></div>
      </div>
      {/* Non-affiliation et propriété des marques citées (registre lib/platforms.ts, docs/MARQUES.md). */}
      <p className="s-pied-marques pd-marques" data-marques="">{langue === "en" ? MARQUES_EN : langue === "es" ? MARQUES_ES : TRADEMARK_NOTICE}</p>
    </footer>
  );
}
