// Pied de page AETHRYON, Égide v2 : la médaille (36 px) et le logotype, la devise, l'état du service, le soutien
// volontaire, puis les liens (uniquement vers des pages qui existent) et les mentions. Sur le fond du thème, séparé
// par un filet : plus de « couture » ivoire / obsidienne.
import { Link } from "react-router";
import { useConfig, useMe, useStatus } from "../lib/hooks.ts";
import { TRADEMARK_NOTICE } from "../lib/platforms.ts";
import { LEGAL_PUBLISHED } from "../lib/legal.tsx";
import { DISCORD_PUBLIC } from "../lib/discord.ts";
import { OFFRES_MODE, TARIFS_LABEL } from "../lib/offres.ts";
import { SOUTIEN_URL } from "../lib/soutien.ts";
import { ouvrirPreferences } from "../lib/confidentialite.ts";
import { ouvrirNouveautes, VERSION_SITE } from "../lib/nouveautes.ts";
import { TAGLINE } from "../lib/brand.ts";
import { Medaille } from "./egide/Egide.tsx";
import { IconCup } from "./Icon.tsx";

const TON = { ok: "ok", degraded: "warn", paused: "warn", down: "err" } as const;
const LIBELLE = { ok: "Service opérationnel", degraded: "Service ralenti", paused: "Conversions suspendues", down: "Service indisponible" } as const;

export function Footer() {
  const cfg = useConfig();
  const st = useStatus();
  const me = useMe();
  const connecte = !!me.data && !me.error;
  const cols: { titre: string; liens: [string, string][] }[] = [
    { titre: "Produit", liens: [["/#demo", "Démonstration"], ["/#surfaces", "Produit"], ["/#plateformes", "Plateformes"], ["/outils", "AETHRYON Tools"], ["/#tarifs", TARIFS_LABEL], ["/#feuille-de-route", "Feuille de route"], ["/installer", "Installer le raccourci"], ["/aide", "Aide"]] },
    { titre: "Compte", liens: connecte
      ? [["/dashboard", "Mon espace"], ["/dashboard/cles", "Mes jetons"], ["/dashboard/activite", "Activité"], ["/dashboard/apparence", "Apparence"]]
      : [["/commencer", "Créer un compte"], ["/connexion", "Se connecter"]] },
    { titre: "Informations", liens: [
      // Pages juridiques publiées seulement quand elles sont complètes ; CGV et remboursement seulement quand la vente
      // est ouverte (OFFRES=vente) : rien ne renvoie à des conditions de vente sans vente.
      ...(LEGAL_PUBLISHED ? [["/mentions-legales", "Mentions légales"], ["/conditions", "Conditions d'utilisation"]] as [string, string][] : []),
      ...(LEGAL_PUBLISHED && OFFRES_MODE === "vente" ? [["/cgv", "Conditions de vente"], ["/remboursement", "Remboursements"]] as [string, string][] : []),
      ["/confidentialite", "Confidentialité"], ["/aide#etat", "État du service"], ["/aide#versions", `Raccourci ${cfg.data?.shortcutVersion ?? "—"}`]] },
  ];
  return (
    <footer className="s-pied">
      <div className="s-pied-haut">
        <div className="s-pied-marque">
          <Link to="/" className="eg-marque s-pied-logo" aria-label="AETHRYON, accueil"><Medaille taille={36} /><span aria-hidden="true">AETHRYON</span></Link>
          <p className="s-pied-devise eg-titre">{TAGLINE}</p>
          <p className="s-pied-texte">
            Conversion et retouche de médias : extension, AETHRYON pour Premiere Pro, {DISCORD_PUBLIC ? "bot Discord" : "bot Discord (en développement)"},
            raccourci iPhone et AETHRYON Tools (en bêta). Ne convertis que ce que tu as le droit d'utiliser, dans le respect des conditions des plateformes.
          </p>
          <Link to="/aide#etat" className="s-pied-etat">
            <span className="eg-pastille" data-ton={st.data ? TON[st.data.state] : undefined}><span className="eg-pastille-point" aria-hidden="true" />{st.data ? LIBELLE[st.data.state] : "État du service"}</span>
          </Link>
          {/* Soutien volontaire : lien sortant simple (nouvel onglet, sans référent), rien n'est chargé depuis l'autre site. */}
          <div className="s-pied-soutien" data-soutien="">
            <p>Sans publicité : si AETHRYON t'est utile, tu peux le soutenir.</p>
            <a href={SOUTIEN_URL} target="_blank" rel="noopener noreferrer" className="eg-btn eg-btn--secondaire" data-soutien-lien="">
              <IconCup size={16} className="shrink-0" />Soutenir AETHRYON<span className="eg-vh"> (Buy Me a Coffee, nouvel onglet)</span>
            </a>
          </div>
        </div>
        <nav aria-label="Liens du pied de page" className="s-pied-cols">
          {cols.map((c) => (
            <div key={c.titre}>
              <p className="s-pied-titre">{c.titre}</p>
              <ul>
                {c.liens.map(([to, label]) => <li key={to}><Link to={to}>{label}</Link></li>)}
                {/* La fenêtre « Nouveautés » de la version, à rouvrir ; préférences de confidentialité. */}
                {c.titre === "Produit" && <li><button type="button" onClick={ouvrirNouveautes} data-ouvrir-nouveautes="">Nouveautés de la {VERSION_SITE}</button></li>}
                {c.titre === "Informations" && <li><button type="button" onClick={ouvrirPreferences} data-ouvrir-preferences="">Préférences de confidentialité</button></li>}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="s-pied-bas">
        <p>© {new Date().getFullYear()} AETHRYON. Service personnel, sans garantie de disponibilité.</p>
        <p>Aucune publicité ni mesure d'audience : le site ne charge aucune ressource d'un autre site.</p>
      </div>
      {/* Non-affiliation et propriété des marques citées (registre lib/platforms.ts, docs/MARQUES.md). */}
      <p className="s-pied-marques" data-marques="">{TRADEMARK_NOTICE}</p>
    </footer>
  );
}
