// Pied de page AETHRYON (obsidienne) : uniquement des liens vers des pages qui existent.
import { Link, useLocation } from "react-router";
import { useConfig, useMe, useStatus } from "../lib/hooks.ts";
import { BrandLogo } from "./brand/BrandLogo.tsx";
import { StatusDot } from "./bits.tsx";
import { TRADEMARK_NOTICE } from "../lib/platforms.ts";
import { LEGAL_PUBLISHED } from "../lib/legal.tsx";
import { PLATFORMS } from "../lib/brand.ts";
import { PlatformMark } from "./brand/PlatformMark.tsx";
import { DISCORD_PUBLIC } from "../lib/discord.ts";
import { OFFRES_MODE, TARIFS_LABEL } from "../lib/offres.ts";
import { IconCup } from "./Icon.tsx";
import { SOUTIEN_URL } from "../lib/soutien.ts";
import { ouvrirPreferences } from "../lib/confidentialite.ts";
import { ouvrirNouveautes, VERSION_SITE } from "../lib/nouveautes.ts";

const TONE = { ok: "ok", degraded: "warn", paused: "warn", down: "bad" } as const;
const LABEL = { ok: "Service opérationnel", degraded: "Service ralenti", paused: "Conversions suspendues", down: "Service indisponible" } as const;

/** Pages qui se terminent sur une section sombre : le pied de page s'y raccorde sans couture. */
const DARK_END = new Set(["/", "/commencer"]);

export function Footer() {
  const { pathname } = useLocation();
  const cfg = useConfig();
  const st = useStatus();
  const me = useMe();
  const signedIn = !!me.data && !me.error;
  const cols: { title: string; links: [string, string][] }[] = [
    { title: "Produit", links: [["/#demo", "Démo"], ["/#surfaces", "Produit"], ["/outils", "AETHRYON Tools"], ["/#tarifs", TARIFS_LABEL], ["/#feuille-de-route", "Feuille de route"], ["/installer", "Installer le raccourci"], ["/aide", "Aide"]] },
    { title: "Compte", links: signedIn
      ? [["/dashboard", "Mon espace"], ["/dashboard/cles", "Mes jetons"], ["/dashboard/activite", "Activité"]]
      : [["/commencer", "Créer un compte"], ["/connexion", "Se connecter"]] },
    { title: "Informations", links: [
      // Pages juridiques publiées seulement quand elles sont complètes ; CGV et remboursement seulement quand la vente
      // est ouverte (OFFRES=vente) : rien ne renvoie à des conditions de vente sans vente.
      ...(LEGAL_PUBLISHED ? [["/mentions-legales", "Mentions légales"], ["/conditions", "Conditions d'utilisation"]] as [string, string][] : []),
      ...(LEGAL_PUBLISHED && OFFRES_MODE === "vente" ? [["/cgv", "Conditions de vente"], ["/remboursement", "Remboursements"]] as [string, string][] : []),
      ["/confidentialite", "Confidentialité"], ["/aide#etat", "État du service"], ["/aide#versions", `Raccourci ${cfg.data?.shortcutVersion ?? "—"}`]] },
  ];
  return (
    // Couture (docs/DESIGN.md §4) seulement après une page claire : l'accueil et « Commencer » finissent déjà sur l'obsidienne.
    <footer className={DARK_END.has(pathname) ? "section-night" : "section-night seam"}>
      <div className="container-site grid gap-12 pb-12 pt-16 md:grid-cols-[1.25fr_2fr] md:pt-20 [border-image:linear-gradient(90deg,transparent,var(--color-night-line),transparent)_1] border-t">
        <div>
          <Link to="/" className="inline-flex min-h-11 items-center" aria-label="AETHRYON, accueil">
            <BrandLogo size="md" tone="ivory" />
          </Link>
          <p className="mt-5 font-display text-[19px] italic text-gold-light">De l'éther à tes mains.</p>
          <p className="mt-3 max-w-sm text-[14.5px] leading-relaxed text-mist">
            Conversion et retouche de médias : raccourci iPhone, extension, {DISCORD_PUBLIC ? "bot Discord" : "bot Discord (en développement)"} et
            AETHRYON Tools (en bêta). Ne convertis que ce que tu as le droit d'utiliser, dans le respect des conditions des plateformes.
          </p>
          <ul className="mt-5 flex flex-wrap gap-2" aria-label="Plateformes prises en charge">
            {PLATFORMS.map((pl) => (
              <li key={pl.id}><span className="chip-logo h-9 text-[13.5px]"><PlatformMark id={pl.id} size={15} tone="dark" />{pl.name}</span></li>
            ))}
          </ul>
          <Link to="/aide#etat" className="mt-4 inline-flex min-h-11 items-center gap-2.5 text-[14px] text-mist transition-colors hover:text-ivory">
            <StatusDot tone={st.data ? TONE[st.data.state] : "muted"} />
            {st.data ? LABEL[st.data.state] : "État du service"}
          </Link>
          {/* Soutien volontaire : lien sortant simple (nouvel onglet, sans référent), rien n'est chargé depuis l'autre site. */}
          <div className="mt-3 max-w-sm" data-soutien="">
            <p className="text-[14px] leading-relaxed text-mist">Sans publicité : si AETHRYON t'est utile, tu peux le soutenir.</p>
            <a href={SOUTIEN_URL} target="_blank" rel="noopener noreferrer"
              className="mt-1 inline-flex min-h-11 items-center gap-2 text-[14.5px] text-gold-light underline decoration-gold/40 underline-offset-4 transition-colors hover:text-ivory hover:decoration-ivory/60"
              data-soutien-lien="">
              <IconCup size={18} className="shrink-0" />Soutenir AETHRYON<span className="sr-only"> (Buy Me a Coffee, nouvel onglet)</span>
            </a>
          </div>
        </div>
        <nav aria-label="Liens du pied de page" className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {cols.map((c) => (
            <div key={c.title}>
              <p className="text-[13px] font-medium text-gold">{c.title}</p>
              <ul className="mt-3">
                {c.links.map(([to, label]) => (
                  <li key={to}><Link to={to} className="flex min-h-11 items-center text-[14.5px] text-mist transition-colors hover:text-ivory">{label}</Link></li>
                ))}
                {/* V3.5 : la fenêtre « Nouveautés » de la version, à rouvrir quand on veut ; préférences de confidentialité. */}
                {c.title === "Produit" && (
                  <li><button type="button" onClick={ouvrirNouveautes} className="flex min-h-11 items-center text-left text-[14.5px] text-mist transition-colors hover:text-ivory" data-ouvrir-nouveautes="">Nouveautés de la {VERSION_SITE}</button></li>
                )}
                {c.title === "Informations" && (
                  <li><button type="button" onClick={ouvrirPreferences} className="flex min-h-11 items-center text-left text-[14.5px] text-mist transition-colors hover:text-ivory" data-ouvrir-preferences="">Préférences de confidentialité</button></li>
                )}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="container-site flex flex-col gap-2 border-t border-night-line py-6 text-[13px] text-mist sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} AETHRYON. Service personnel, sans garantie de disponibilité.</p>
        <p>Aucune publicité ni mesure d'audience : le site ne charge aucune ressource d'un autre site.</p>
      </div>
      {/* Non-affiliation et propriété des marques citées (registre lib/platforms.ts, docs/MARQUES.md). */}
      <p className="container-site pb-8 text-[12px] leading-relaxed text-mist" data-marques="">{TRADEMARK_NOTICE}</p>
    </footer>
  );
}
