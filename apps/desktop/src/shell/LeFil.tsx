// « Le fil » : la file des transferts, colonne de droite de la coque Égide (DESIGN_SYSTEM.md § 10, composant Tâche).
// Faits RÉELS seulement (lib/transfertsVue.ts) : nœud d'état (attente, en cours, pause, terminé, erreur), étape lisible,
// fil de progression interpolé entre deux mesures du cœur, octets reçus et débit MESURÉ. Commandes réelles :
// pause, reprise et annulation seulement pour les conversions que CE Desktop reçoit (transfertsPilotables) ; aperçu,
// import dans Premiere Pro et Explorateur pour un fichier arrivé. Clavier sur une tâche : Espace (pause / reprise),
// Suppr (annuler), Entrée (aperçu). Mouvement : entrée d'une tâche en fondu + 6 px (@starting-style), nœud qui se
// noue ; rien au clavier ; mouvement réduit : rien ne se déplace.
import { useMemo, useState, type KeyboardEvent } from "react";
import { useMagasin } from "../lib/magasin";
import { api, messageErreur } from "../lib/api";
import { pluriel, taille, typo } from "../lib/format";
import { noeuds } from "../lib/pipeline";
import { bilan, estActive, etatNoeud, lignesDe, mesures, ordreFil, PLATEFORMES, type Ligne } from "../lib/transfertsVue";
import { BoutonIcone, Icone, Progression } from "../ui/base";
import { useToast } from "../ui/superpositions";
import { MedailleChouette } from "../ui/marque";

const MAX = 40;

function Noeud({ etat }: { etat: ReturnType<typeof etatNoeud> }) {
  return (
    <span className="eg-noeud" data-etat={etat} aria-hidden="true">
      <svg viewBox="0 0 10 10"><path d="m2 5.2 2 2 4-4.4" /></svg>
    </span>
  );
}

export function LeFil({ ouvert, onFermer }: { ouvert: boolean; onFermer: () => void }) {
  const { inst, rafraichir, ouvrirApercu, importer, actionMedia, aller, demandes, etatsVus } = useMagasin();
  const toast = useToast();
  const [occupe, setOccupe] = useState<string | null>(null);
  const lignes = useMemo(() => (inst ? ordreFil(lignesDe(inst)).slice(0, MAX) : []), [inst]);
  if (!inst) return null;
  const pilotables = new Set(inst.transfertsPilotables ?? []);
  const actives = lignes.filter(estActive);
  const b = bilan(actives);

  const piloter = async (l: Ligne, action: "pause" | "reprendre" | "annuler") => {
    if (!l.transfert) return;
    setOccupe(`${l.transfert.id}:${action}`);
    try {
      await api.transfertPiloter(l.transfert.id, action);
      if (action === "annuler") toast({ etat: "info", titre: "Transfert annulé", texte: typo(`« ${l.nom} » : le fichier partiel est supprimé.`) });
      rafraichir();
    } catch (e) {
      toast({ etat: "erreur", titre: action === "annuler" ? "Annulation impossible" : action === "pause" ? "Pause impossible" : "Reprise impossible", texte: messageErreur(e) });
    } finally {
      setOccupe(null);
    }
  };

  const clavier = (l: Ligne) => (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget) return;
    const t = l.transfert;
    const pilotable = !!t && pilotables.has(t.id);
    if (e.key === " " && pilotable && t!.etat === "telechargement") { e.preventDefault(); void piloter(l, t!.pause ? "reprendre" : "pause"); }
    else if (e.key === "Delete" && pilotable && estActive(l)) { e.preventDefault(); void piloter(l, "annuler"); }
    else if (e.key === "Enter" && l.media?.etat === "disponible") { e.preventDefault(); ouvrirApercu(l.media.id); }
  };

  const tache = (l: Ligne) => {
    const t = l.transfert;
    const m = l.media;
    const x = mesures(l);
    const etat = etatNoeud(l);
    const active = estActive(l);
    const pilotable = !!t && pilotables.has(t.id);
    const pct = x.frac != null ? Math.round(x.frac * 100) : null;
    const annule = t?.etat === "erreur" && t.code === "annule";
    const p = t ? noeuds(t, m, inst.imports.imports, demandes, inst.resultats, etatsVus.get(t.id) ?? null) : null;
    const etape = active ? x.etape : t?.etat === "pret" ? (t.premiere === "importe" ? "Dans Premiere Pro" : "Terminé") : annule ? "Annulé" : "Échec";
    const plateforme = t?.plateforme ? PLATEFORMES[t.plateforme] ?? null : t ? null : "Navigateur";
    const format = t?.format ? t.format.toUpperCase() : m ? m.ext.toUpperCase() : null;
    const recu = !active && t?.etat === "pret" && m ? m.taille : null;
    return (
      <li key={l.cle} className="tache" data-etat={etat} data-transfert={t?.id ?? undefined} tabIndex={0} onKeyDown={clavier(l)}
        aria-label={typo(`${l.nom}, ${etape}${pct != null && active ? `, ${pct} %` : ""}`)}>
        <Noeud etat={etat} />
        <div className="t-corps">
          <div className="t-l1">
            <b className="t-titre" title={l.nom}>{t?.titre && t.titre !== t.fichierAttendu ? t.titre : l.nom}</b>
            <span className="t-pc mono">{active ? (pct != null ? `${pct} %` : "") : recu != null ? typo(taille(recu)) : ""}</span>
          </div>
          <div className="t-l2">
            {format && <span><Icone nom={format === "MP3" ? "son" : format === "GIF" ? "gif" : "video"} taille={13} />{format}</span>}
            {plateforme && <span>{plateforme}</span>}
            <span className="t-etape">{x.pause ? "En pause" : etape}</span>
          </div>
          {(etat === "cours" || etat === "pause") && (
            <div className="t-prog">
              <Progression valeur={x.pause ? x.frac ?? 0 : x.frac} variante={x.pause ? "wait" : undefined} libelle={typo(`Progression : ${l.nom}${pct != null ? `, ${pct} %` : ""}`)} />
              {(x.octets || x.vitesse) && <div className="t-l3 mono"><span>{typo(x.octets ?? "")}</span><span>{typo(x.vitesse ?? "")}</span></div>}
            </div>
          )}
          {t?.etat === "erreur" && !annule && (t.erreur || p?.bandeau) && <p className="t-err">{typo(t.erreur ?? p?.bandeau ?? "")}</p>}
          <div className="t-acts">
            {pilotable && t!.etat === "telechargement" && (t!.pause
              ? <BoutonIcone nom="play" libelle="Reprendre" taille="xs" disabled={occupe === `${t!.id}:reprendre`} onClick={() => void piloter(l, "reprendre")} />
              : <BoutonIcone nom="pause" libelle="Mettre en pause" taille="xs" disabled={!!occupe} onClick={() => void piloter(l, "pause")} />)}
            {pilotable && active && <BoutonIcone nom="close" libelle="Annuler le transfert" taille="xs" disabled={occupe === `${t!.id}:annuler`} onClick={() => void piloter(l, "annuler")} />}
            {!active && m?.etat === "disponible" && <BoutonIcone nom="play" libelle="Aperçu" taille="xs" onClick={() => ouvrirApercu(m.id)} />}
            {!active && m?.etat === "disponible" && p?.importable && <BoutonIcone nom="import" libelle="Importer dans Premiere Pro" taille="xs" onClick={() => void importer([m.id])} />}
            {!active && m && m.etat !== "introuvable" && <BoutonIcone nom="reveal" libelle="Afficher dans l'Explorateur" taille="xs" onClick={() => void actionMedia(m, "explorateur")} />}
            {t?.etat === "erreur" && !annule && t.origine === "desktop" && <button type="button" className="eg-btn eg-btn--discret eg-btn--petit" onClick={() => aller("accueil")}><Icone nom="retry" taille={14} />Relancer</button>}
          </div>
        </div>
      </li>
    );
  };

  const resume = actives.length
    ? [pluriel(actives.length, "en cours", "en cours"), b.recus ? `${b.recus} reçus` : null].filter(Boolean).join("  ")
    : lignes.length ? "Tout est arrivé" : "";
  return (
    <aside className="colonne-fil" aria-label="Le fil" data-ouvert={ouvert ? "" : undefined}>
      <div className="fil-tete">
        <h2 className="eg-titre">Le fil</h2>
        <small className="mono fil-resume" aria-live="polite">{typo(resume)}</small>
        <BoutonIcone nom="close" libelle="Masquer le fil" taille="xs" className="fil-masquer" onClick={onFermer} />
      </div>
      {lignes.length === 0 ? (
        <div className="fil-vide">
          <MedailleChouette taille={56} />
          <b>Rien dans le fil</b>
          <span>{typo("Tes conversions apparaissent ici, de la réception à l'import.")}</span>
        </div>
      ) : (
        <ol className="taches">{lignes.map(tache)}</ol>
      )}
      {lignes.some((l) => !estActive(l)) && (
        <div className="fil-pied"><button type="button" className="lien-or" onClick={() => aller("transferts")}>Tous les transferts<Icone nom="arrow-right" taille={14} /></button></div>
      )}
    </aside>
  );
}
