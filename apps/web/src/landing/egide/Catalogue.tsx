// Catalogue des plateformes (Égide v2) : UNE source (lib/catalogue.ts ← catalogue des interfaces ← registre de ytapi).
// Onglets par catégorie (flèches du clavier), légende, une ligne par plateforme : pictogramme NEUTRE du socle (jamais
// un logo), état réel, formats ouverts ; les formats fermés restent visibles, barrés, avec leur raison (nom accessible
// et info-bulle). Wikimedia Commons : auteur, licence et lien source joints au fichier. Sans JavaScript : toutes les
// catégories sont écrites (data-sans-js).
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useConfig } from "../../lib/hooks.ts";
import { CATEGORIES, etatAffiche, ETATS, FORMATS, NOM_FORMAT, PLATEFORMES, raisonFormat, raisonPlateforme, type EtatAffiche, type Plateforme } from "../../lib/catalogue.ts";
import { Icone, type NomIcone } from "../../ui/egide/Egide.tsx";

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

const trier = (l: readonly Plateforme[], coupees?: Partial<Record<"youtube" | "tiktok" | "twitter", boolean>>) =>
  [...l].sort((a, b) => ETATS[etatAffiche(a, coupees)].ordre - ETATS[etatAffiche(b, coupees)].ordre);

export function Catalogue() {
  const id = useId();
  const cfg = useConfig();
  const coupees = cfg.data?.platforms;
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
  return (
    <section id="plateformes" aria-labelledby="t-pf" className="s-section">
      <div className="s-section-tete">
        <h2 id="t-pf" className="eg-titre s-h2">Plateformes</h2>
        <p>Ce qui fonctionne aujourd'hui, ce qui arrive, et ce qu'AETHRYON ne fera pas.</p>
      </div>
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
        <p className="s-pf-note">Pictogrammes génériques : AETHRYON n'emploie aucun logo de ces plateformes, et n'est affilié à aucune d'elles.</p>
      </div>
    </section>
  );
}
