// Dialogue « Plateformes compatibles » (DESIGN_SYSTEM.md § 10, catalogue complet) : quatre catégories en onglets
// (flèches, Début, Fin), chaque plateforme avec son pictogramme NEUTRE, son nom en toutes lettres, son état réel et ses
// formats ; les formats indisponibles restent visibles, barrés, avec leur raison. Source : lib/plateformes.ts.
import { useState, type KeyboardEvent } from "react";
import { useCatalogue } from "../lib/catalogue";
import { parCategorie, STATUTS, type VuePlateforme } from "../lib/plateformes";
import { typo } from "../lib/format";
import { Bouton, Icone } from "./base";
import { Dialogue } from "./superpositions";

function Ligne({ p }: { p: VuePlateforme }) {
  const s = STATUTS[p.statut];
  return (
    <li className="cat-ligne" data-statut={p.statut}>
      <span className="cat-ico" aria-hidden="true"><Icone nom={p.icone} taille={18} /></span>
      <span className="cat-nom">{p.nom}{p.attribution && <small>Attribution à citer</small>}</span>
      <span className="eg-pastille eg-pastille--petite" data-ton={s.ton}><Icone nom={s.icone} taille={12} />{s.libelle}</span>
      <ul className="pf-formats" aria-label={`Formats ${p.nom}`}>
        {p.formats.map((f) => (
          <li key={f.id} className="pf-format" data-ok={f.ok ? "" : undefined} title={f.raison ?? undefined} aria-label={f.ok ? `${f.nom} : disponible` : `${f.nom} : indisponible. ${f.raison ?? ""}`}>{f.nom}</li>
        ))}
      </ul>
    </li>
  );
}

export function CataloguePlateformes({ onFermer }: { onFermer: () => void }) {
  const c = useCatalogue(true);
  const [onglet, setOnglet] = useState(0);
  const groupes = c ? parCategorie(c) : [];
  const clavier = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = groupes.length;
    if (!n) return;
    const i = e.key === "ArrowRight" ? (onglet + 1) % n : e.key === "ArrowLeft" ? (onglet - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (i < 0) return;
    e.preventDefault();
    setOnglet(i);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-onglet="${i}"]`)?.focus();
  };
  const g = groupes[onglet];
  return (
    <Dialogue titre="Plateformes compatibles" large onFermer={onFermer} actions={<Bouton variante="primary" onClick={onFermer}>Fermer</Bouton>}>
      <p className="cat-intro">{typo("Les mêmes que sur le site et dans l'extension. AETHRYON Desktop convertit en MP4 et en MP3.")}</p>
      {!c ? <p className="cat-intro" aria-busy="true">Lecture du catalogue…</p> : (
        <>
          <div className="cat-onglets" role="tablist" aria-label="Catégories" onKeyDown={clavier}>
            {groupes.map((x, i) => (
              <button key={x.id} type="button" role="tab" id={`cat-o-${x.id}`} data-onglet={i} aria-selected={i === onglet} aria-controls={`cat-p-${x.id}`} tabIndex={i === onglet ? 0 : -1} onClick={() => setOnglet(i)}>
                {x.nom}<span className="cat-n">{x.plateformes.length}</span>
              </button>
            ))}
          </div>
          {g && (
            <div className="cat-panneau" role="tabpanel" id={`cat-p-${g.id}`} aria-labelledby={`cat-o-${g.id}`} tabIndex={0}>
              <ul className="cat-liste">{g.plateformes.map((p) => <Ligne key={p.id} p={p} />)}</ul>
            </div>
          )}
          <p className="cat-version mono">{typo(`Catalogue du ${c.version}`)}</p>
        </>
      )}
    </Dialogue>
  );
}
