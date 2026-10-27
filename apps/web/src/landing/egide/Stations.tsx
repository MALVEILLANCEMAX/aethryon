// « Là où tu travailles » (Égide v2) : les façons réelles d'utiliser AETHRYON, posées sur un fil (un nœud plein =
// disponible, un nœud en cours = bêta). Statuts publics VRAIS (lib/extension.ts, lib/discord.ts : l'extension, le bot
// Discord et AETHRYON pour Premiere Pro « Disponible » ; Tools en bêta), une action réelle chacune, jamais de lien de
// store ni d'invitation qui n'existe pas. Lien direct /?solution=… (ancien sélecteur) : la station visée est marquée
// (data-panel) et l'accueil y défile. Puis le bandeau du compte : les vraies limites du service (/api/config).
import { useEffect, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { cn } from "../../lib/cn.ts";
import { useConfig, useMe } from "../../lib/hooks.ts";
import { EXTENSION_AVAILABLE, EXTENSION_STATUS } from "../../lib/extension.ts";
import { DISCORD_INSTALL, DISCORD_PUBLIC, DISCORD_STATUS } from "../../lib/discord.ts";
import { useSiteOrigin } from "../../lib/prerender.ts";
import { DEFAULT_SOLUTION, isSolution, type SolutionId } from "../../lib/solutions.ts";
import { ANNONCES } from "../../lib/nouveautes.ts";
import { InstallQr } from "../../ui/InstallQr.tsx";
import { PremiereMark } from "../../ui/brand/PremiereMark.tsx";
import { Icone, Noeud, Pastille, type NomIcone } from "../../ui/egide/Egide.tsx";

/** Installateur Windows d'AETHRYON pour Premiere Pro, servi par /downloads/premiere/ (empreinte vérifiée au build) : le MÊME
 *  que l'annonce « AETHRYON pour Premiere Pro » des Nouveautés (une seule source, lib/nouveautes.ts, mise à jour à chaque setup). */
export const PREMIERE_SETUP = ANNONCES.map((a) => a.telechargement?.href).find((h) => h?.startsWith("/downloads/premiere/AETHRYON-Setup-")) ?? "/downloads/premiere/";

function Station({ id, panel, focus, icone, nom, statut, ton, texte, meta, children, attrs }: {
  id: string; panel?: SolutionId; focus: { id: SolutionId; explicit: boolean }; icone: NomIcone | ReactNode; nom: string;
  statut: string; ton: "ok" | "cours" | "attente"; texte: string; meta?: ReactNode; children: ReactNode; attrs?: Record<string, string>;
}) {
  return (
    <article className={cn("s-poste", panel && focus.explicit && focus.id === panel && "is-focus")} aria-labelledby={`poste-${id}`} {...attrs}>
      <Noeud etat={ton === "ok" ? "ok" : ton === "cours" ? "cours" : "attente"} />
      <h3 id={`poste-${id}`} className="s-poste-nom">
        {typeof icone === "string" ? <Icone nom={icone as NomIcone} /> : icone}
        {nom} <Pastille ton={ton === "ok" ? "ok" : "accent"}>{statut}</Pastille>
      </h3>
      <p className="s-poste-texte">{texte}</p>
      {meta}
      <div className="s-poste-action">{children}</div>
      {panel && focus.id === panel && <div hidden data-panel={panel} />}
    </article>
  );
}

function Puces({ items, mono = false, libelle }: { items: string[]; mono?: boolean; libelle: string }) {
  return <ul className="s-poste-puces" aria-label={libelle}>{items.map((t) => <li key={t} className={cn(mono && "eg-mono")}>{t}</li>)}</ul>;
}

export function Stations() {
  const cfg = useConfig();
  const me = useMe();
  const connecte = !!me.data && !me.error;
  const q = cfg.data?.quotas;
  const origine = useSiteOrigin();
  const [params] = useSearchParams();
  const demande = params.get("solution");
  const focus = { id: isSolution(demande) ? demande : DEFAULT_SOLUTION, explicit: isSolution(demande) };
  useEffect(() => {
    if (!focus.explicit) return;
    const t = window.setTimeout(() => {
      const el = document.querySelector(`[data-panel="${focus.id}"]`)?.closest("[data-surface-card], [data-account-strip]");
      el?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }, 450);
    return () => clearTimeout(t);
  }, [focus.explicit, focus.id]);

  return (
    <section id="surfaces" aria-labelledby="t-partout" className="s-section s-partout">
      {/* Anciennes ancres de l'accueil : /#solutions et /#demo arrivent ici ou sur la scène. */}
      <span id="solutions" aria-hidden="true" />
      <div className="s-section-tete">
        <h2 id="t-partout" className="eg-titre s-h2">Là où tu travailles</h2>
        <p>Un seul compte : le même quota, le même historique, partout.</p>
      </div>
      <div className="s-postes">
        <Station id="extension" panel="extension" focus={focus} icone="navigateur" nom="Extension navigateur"
          statut={EXTENSION_AVAILABLE ? "Disponible" : EXTENSION_STATUS.label} ton={EXTENSION_AVAILABLE ? "ok" : "attente"}
          texte="Un bouton sous la vidéo, le passage choisi sur la frise." attrs={{ "data-surface-card": "extension" }}
          meta={<Puces libelle="Navigateurs pris en charge" items={["Chrome", "Edge", "Brave"]} />}>
          <Link to="/extension" className="eg-btn eg-btn--secondaire">{EXTENSION_AVAILABLE ? "Installer l'extension" : "Découvrir l'extension"}<Icone nom="chevron" taille="s" /></Link>
        </Station>
        <article className="s-poste" aria-labelledby="poste-premiere" data-surface-premiere="">
          <Noeud etat="ok" />
          <h3 id="poste-premiere" className="s-poste-nom">
            <PremiereMark size={22} className="s-poste-mark" />AETHRYON pour Premiere Pro <Pastille ton="ok">Disponible</Pastille>
          </h3>
          <p className="s-poste-texte">Colle un lien YouTube, TikTok ou X dans le panneau : le clip arrive dans le chutier de ton choix. Windows 11, Premiere Pro 25.6 ou plus récent.</p>
          <p className="s-poste-note">Installateur pas encore signé : Windows affiche un avertissement avant de l'ouvrir. Adobe et Premiere Pro sont des marques d'Adobe ; AETHRYON n'est pas affilié à Adobe.</p>
          <div className="s-poste-action">
            <a href={PREMIERE_SETUP} download className="eg-btn eg-btn--secondaire" data-premiere-download=""><Icone nom="convertir" taille="s" />Télécharger pour Windows</a>
          </div>
        </article>
        <Station id="iphone" panel="ios" focus={focus} icone="telephone" nom="Raccourci iPhone" statut="Disponible" ton="ok"
          texte="Depuis la feuille de partage : Partager, AETHRYON, MP4 ou MP3." attrs={{ "data-surface-card": "iphone" }}
          meta={<div className="s-poste-qr" data-install-qr="" data-device="desktop"><InstallQr url={`${origine}/installer`} className="size-[72px] shrink-0" /><p>Sur ordinateur : scanne-le avec ton iPhone.</p></div>}>
          <Link to="/installer" className="eg-btn eg-btn--secondaire">Installer le raccourci<Icone nom="chevron" taille="s" /></Link>
        </Station>
        <Station id="discord" panel="discord" focus={focus} icone="bulle" nom="Bot Discord" statut={DISCORD_STATUS.label} ton={DISCORD_PUBLIC ? "ok" : "attente"}
          texte="Le lien dans un salon, le fichier en réponse." attrs={{ "data-surface-card": "discord" }}
          meta={<Puces mono libelle="Commandes du bot" items={["/convert", "/audio", "/clip", "/gif"]} />}>
          {DISCORD_PUBLIC ? (
            <>
              <a href={DISCORD_INSTALL.user} target="_blank" rel="noopener noreferrer" className="eg-btn eg-btn--secondaire" data-install="user">
                Ajouter à Discord<Icone nom="ouvrir" taille="s" /><span className="eg-vh"> (discord.com, nouvel onglet)</span>
              </a>
              <a href={DISCORD_INSTALL.guild} target="_blank" rel="noopener noreferrer" className="eg-btn eg-btn--discret" data-install="guild">
                Sur un serveur<span className="eg-vh"> (discord.com, nouvel onglet)</span>
              </a>
            </>
          ) : <Link to="/#feuille-de-route" className="eg-btn eg-btn--discret">Voir où il en est</Link>}
        </Station>
        <article className="s-poste" aria-labelledby="poste-tools" data-surface-tools="">
          <Noeud etat="cours" />
          <h3 id="poste-tools" className="s-poste-nom"><Icone nom="ciseaux" />AETHRYON Tools <Pastille ton="accent">Bêta</Pastille></h3>
          <p className="s-poste-texte">Couper, recadrer, extraire le son, faire un GIF ou compresser, dans le navigateur.</p>
          <div className="s-poste-action"><Link to="/outils" className="eg-btn eg-btn--discret">Ouvrir Tools<Icone nom="chevron" taille="s" /></Link></div>
        </article>
      </div>

      <div className={cn("s-compte", focus.explicit && focus.id === "web" && "is-focus")} data-account-strip="">
        {focus.id === "web" && <div hidden data-panel="web" />}
        <ul className="s-compte-faits" aria-label="Un compte pour tout">
          <li><b className="tabular">{q?.daily ?? 10}</b> conversions par jour</li>
          <li><b className="tabular">{q?.maxActive ?? 1}</b> à la fois</li>
          <li><b>1</b> historique partagé</li>
        </ul>
        <Link to={connecte ? "/dashboard" : "/commencer"} className="eg-btn eg-btn--principal">{connecte ? "Ouvrir mon espace" : "Créer mon compte gratuit"}</Link>
      </div>
    </section>
  );
}
