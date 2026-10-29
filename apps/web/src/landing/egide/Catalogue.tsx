// Catalogue des plateformes (Égide v2) : UNE source (lib/catalogue.ts ← catalogue des interfaces ← registre de ytapi).
// Onglets par catégorie (flèches du clavier), légende, une ligne par plateforme : pictogramme NEUTRE du socle (jamais
// un logo), état réel, formats ouverts ; les formats fermés restent visibles, barrés, avec leur raison (nom accessible
// et info-bulle). Wikimedia Commons : auteur, licence et lien source joints au fichier. Sans JavaScript : toutes les
// catégories sont écrites (data-sans-js). Dans l'en-tête, la disquette (MP4) et le disque (MP3) rétro en 3D (ui/retro,
// revenus le 2026-10-28) : posés sur le registre sur ordinateur, à côté du titre sur téléphone.
// « Le Passage », étape 2 (décision du propriétaire, 2026-10-28) : le REGISTRE montre en grand les plateformes ouvertes
// (pictogramme, nom, formats, réserve) ; le catalogue complet (en essai, bientôt, indisponibles, refusées) est replié
// dans une section dépliable, toujours écrite dans la page.
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useConfig } from "../../lib/hooks.ts";
import { CATEGORIES, EN_LIGNE, etatAffiche, ETATS, FORMATS, NOM_FORMAT, PLATEFORMES, raisonFormat, raisonPlateforme, type EtatAffiche, type Plateforme } from "../../lib/catalogue.ts";
import { Icone, type NomIcone } from "../../ui/egide/Egide.tsx";
import { useT } from "../../i18n/accueil.ts";

const ICONE_CATEGORIE: Record<string, NomIcone> = { populaires: "partager", musique: "son", streaming: "lecture", autres: "archive" };
const ICONES_CATALOGUE = new Set(["video", "vertical", "post", "image", "direct", "archive", "onde"]);

function Etat({ e }: { e: EtatAffiche }) {
  return <span className="s-etat-pf" data-etat={e}><Icone nom={ETATS[e].icone} taille="s" />{ETATS[e].libelle}</span>;
}

function Ligne({ p, coupees }: { p: Plateforme; coupees?: Partial<Record<"youtube" | "tiktok" | "twitter", boolean>> }) {
  const e = etatAffiche(p, coupees);
  const montrerFormats = e === "en-ligne" || e === "temp" || e === "bientot";
  return (
    <li className="s-pf" data-etat={e} data-plateforme={p.id}>
      <span className="s-pf-ico" aria-hidden="true"><Icone nom={(ICONES_CATALOGUE.has(p.icone) ? p.icone : "video") as NomIcone} /></span>
      <span className="s-pf-nom"><b>{p.nom}</b><Etat e={e} /></span>
      {montrerFormats && (
        <ul className="s-fmts" aria-label={`Formats pour ${p.nom}`}>
          {FORMATS.map((f) => e === "en-ligne" && p.formats_compatibles.includes(f)
            ? <li key={f} className="s-fmt">{NOM_FORMAT[f]}</li>
            : <li key={f} className="s-fmt is-off" title={raisonFormat(p, f, e)}><s aria-hidden="true">{NOM_FORMAT[f]}</s><span className="eg-vh">{NOM_FORMAT[f]} indisponible : {raisonFormat(p, f, e)}</span></li>)}
        </ul>
      )}
      {e === "en-ligne" && p.fonctions_indisponibles.length > 0 && <small className="s-pf-raison">{FORMATS.filter((f) => !p.formats_compatibles.includes(f)).map((f) => raisonFormat(p, f, e)).join(" ")}</small>}
      {e === "en-ligne" && p.attribution_obligatoire && <small className="s-pf-raison">Auteur, licence et lien source joints au fichier.</small>}
      {e !== "en-ligne" && <small className="s-pf-raison">{raisonPlateforme(p, e)}</small>}
    </li>
  );
}

/** Une plateforme ouverte, en grand : son nom en lettres (aucun logo, aucun pictogramme de remplacement) et ses formats ;
 *  la raison d'un format absent est dans l'infobulle et pour les lecteurs d'écran. */
function Plaque({ p }: { p: Plateforme }) {
  return (
    <li className="rg-pf" data-plateforme-ouverte={p.id}>
      <b className="rg-nom">{p.nom}</b>
      <ul className="rg-fmts" aria-label={`Formats pour ${p.nom}`}>
        {FORMATS.map((f) => p.formats_compatibles.includes(f)
          ? <li key={f}><span className="eg-etiquette">{NOM_FORMAT[f]}</span></li>
          : <li key={f}><span className="eg-etiquette is-off" title={raisonFormat(p, f, "en-ligne")}><s aria-hidden="true">{NOM_FORMAT[f]}</s><span className="eg-vh">{NOM_FORMAT[f]} indisponible : {raisonFormat(p, f, "en-ligne")}</span></span></li>)}
      </ul>
    </li>
  );
}

const trier = (l: readonly Plateforme[], coupees?: Partial<Record<"youtube" | "tiktok" | "twitter", boolean>>) =>
  [...l].sort((a, b) => ETATS[etatAffiche(a, coupees)].ordre - ETATS[etatAffiche(b, coupees)].ordre);

export function Catalogue() {
  const id = useId();
  const cfg = useConfig();
  const coupees = cfg.data?.platforms;
  const t = useT();
  const [cat, setCat] = useState<string>("populaires");
  const onglets = useRef<(HTMLButtonElement | null)[]>([]);
  const clavier = (e: KeyboardEvent, i: number) => {
    const n = e.key === "ArrowRight" ? (i + 1) % CATEGORIES.length : e.key === "ArrowLeft" ? (i - 1 + CATEGORIES.length) % CATEGORIES.length
      : e.key === "Home" ? 0 : e.key === "End" ? CATEGORIES.length - 1 : -1;
    if (n < 0) return;
    e.preventDefault();
    setCat(CATEGORIES[n]!.id);
    onglets.current[n]?.focus();
  };
  const ouvertes = EN_LIGNE.filter((p) => etatAffiche(p, coupees) === "en-ligne");
  return (
    <section id="plateformes" aria-labelledby="t-pf" className="at-section pf">
      <h2 id="t-pf" className="at-h2">{t.ceQuiMarche}</h2>
      {/* Les plateformes ouvertes, dites en une phrase (leurs noms, jamais leurs logos) ; les formats une seule fois. */}
      <p className="pf-noms" data-plateformes-ouvertes="">
        {ouvertes.map((p, i) => (
          <span key={p.id} data-plateforme-ouverte={p.id}>{p.nom}{i < ouvertes.length - 2 ? ", " : i === ouvertes.length - 2 ? t.et : "."}</span>
        ))}
      </p>
      <p className="pf-formats">{t.formatsPartout}</p>
      <details className="rg-autres">
      <summary><span>{t.detailPlateformes(PLATEFORMES.length - EN_LIGNE.length)}</span><Icone nom="bas" taille="s" /></summary>
      {/* Les plateformes ouvertes, format par format (un format absent : barré, avec sa raison). */}
      <ul className="rg" aria-label="Formats des plateformes ouvertes">{ouvertes.map((p) => <Plaque key={p.id} p={p} />)}</ul>
      <div className="s-catalogue">
        <div className="s-onglets" role="tablist" aria-label="Catégories de plateformes">
          {CATEGORIES.map((c, i) => (
            <button key={c.id} ref={(el) => { onglets.current[i] = el; }} role="tab" type="button" id={`${id}-t-${c.id}`} aria-controls={`${id}-p`}
              aria-selected={cat === c.id} tabIndex={cat === c.id ? 0 : -1} onClick={() => setCat(c.id)} onKeyDown={(e) => clavier(e, i)}>
              <Icone nom={ICONE_CATEGORIE[c.id] ?? "liste"} taille="s" />{c.nom}<span className="eg-mono">{PLATEFORMES.filter((p) => p.categorie === c.id).length}</span>
            </button>
          ))}
        </div>
        <ul className="s-legende" aria-label="Légende">
          {(Object.keys(ETATS) as EtatAffiche[]).map((e) => <li key={e}><Etat e={e} /></li>)}
        </ul>
        <div id={`${id}-p`} role="tabpanel" aria-labelledby={`${id}-t-${cat}`} tabIndex={0} data-js-only="">
          <ul className="s-pfs">{trier(PLATEFORMES.filter((p) => p.categorie === cat), coupees).map((p) => <Ligne key={p.id} p={p} coupees={coupees} />)}</ul>
        </div>
        {/* Sans JavaScript : toutes les catégories, écrites dans le HTML pré-rendu. */}
        <div data-sans-js="">
          {CATEGORIES.map((c) => (
            <div key={c.id} className="s-pfs-cat">
              <h3>{c.nom}</h3>
              <ul className="s-pfs">{trier(PLATEFORMES.filter((p) => p.categorie === c.id)).map((p) => <Ligne key={p.id} p={p} />)}</ul>
            </div>
          ))}
        </div>
      </div>
      </details>
      <p className="s-pf-note">{t.nonAffilie}</p>
    </section>
  );
}
