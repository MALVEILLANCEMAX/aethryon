// AETHRYON Index — écran du scanner (Nocturne-2), chargé à la demande (lib/scanner.ts : son existence fait apparaître
// « Scanner mes disques »). Le scanner est RÉEL (noyau/src/index, desktop/INDEX.md) ; cet écran ne fait que le piloter :
//  1. choix : volumes (icône, nom, type, taille, espace libre, médias déjà indexés, indisponible et pourquoi), dossiers
//     précis, plusieurs disques ou « Tous les disques », types vidéo / audio / images, puis « Lancer le scan » ;
//  2. pendant : la chouette en analyse, les compteurs RÉELS (fichiers parcourus, médias trouvés par type, dossiers,
//     erreurs, débit), le dossier courant ; un pourcentage SEULEMENT en mode Everything (seul total réel), sinon une
//     progression indéterminée ; « Annuler » (le lot en cours est gardé, rien n'est marqué supprimé) ;
//  3. fin : vidéos, audios, images, erreurs consultables, bilan (nouveaux, renommés, supprimés…), « Explorer les médias ».
// Les réglages (exclusions, emplacement de l'index, mode Everything…) sont dans Paramètres › AETHRYON Index.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import "../styles/scanner.css";
import { useMagasin } from "../lib/magasin";
import { api, messageErreur } from "../lib/api";
import { duree as dureeLisible, nombre, pluriel, quand, taille, typo } from "../lib/format";
import {
  basculerVolume, cibleDossier, cibleTous, evenementsIndex, iconeVolume, indexApi, libelleProgression, libelleVolume, occupation, pourcentage, totalMedias, volumeCoche,
  type Cible, type EtatIndex, type IconeVolume, type ProgressionScan, type ReglagesIndex, type ResumeScan, type VolumeIndex,
} from "../lib/index-medias";
import { viserOrigine } from "../lib/origineBibliotheque";
import { viserReglage } from "../lib/reglageCible";
import { Bouton, BoutonIcone, Icone } from "../ui/base";
import { Companion } from "../ui/Companion";
import { useToast } from "../ui/superpositions";

const TRACES_VOLUME: Record<IconeVolume, string> = {
  systeme: '<rect x="3" y="6" width="18" height="12" rx="2.6"/><path d="M3 13.2h18"/><path d="M6.5 9.4h3.2"/><circle cx="16.6" cy="15.6" r=".7" fill="currentColor" stroke="none"/>',
  disque: '<rect x="3" y="6" width="18" height="12" rx="2.6"/><path d="M3 13.2h18"/><circle cx="16.6" cy="15.6" r=".7" fill="currentColor" stroke="none"/>',
  amovible: '<path d="M9.2 3h5.6v4.6H9.2z"/><rect x="7" y="7.6" width="10" height="13.4" rx="2.4"/><path d="M10.6 5.1h.01M13.4 5.1h.01"/>',
  reseau: '<rect x="4" y="3.5" width="16" height="7.5" rx="2"/><path d="M7.5 7.2h.01M12 11v5.5M4.5 20.5h15M12 16.5a2 2 0 1 0 0 4 2 2 0 1 0 0-4"/>',
  optique: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="2.3"/><path d="M7.6 8.6a6 6 0 0 1 3-2.4"/>',
  indisponible: '<rect x="3" y="6" width="18" height="12" rx="2.6" stroke-dasharray="2.6 2.4"/><path d="M8 12h8"/>',
};

function PictoVolume({ v, taille: t = 26 }: { v: IconeVolume; taille?: number }) {
  return <svg className="ico" width={t} height={t} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={(32 / t).toFixed(2)} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: TRACES_VOLUME[v] }} />;
}

const GENRES: Record<string, string> = { fixe: "Disque interne", amovible: "Amovible", reseau: "Réseau", optique: "Optique", memoire: "Mémoire", inconnu: "Volume" };
const TYPES = [{ id: "video", libelle: "Vidéos", icone: "film" }, { id: "audio", libelle: "Audios", icone: "audio" }, { id: "image", libelle: "Images", icone: "image" }] as const;

function genreDe(v: VolumeIndex): string {
  return v.systeme ? "Disque système" : v.substitue ? "Dossier en lecteur (subst)" : GENRES[v.genre] ?? "Volume";
}

function CarteVolume({ v, coche, onBasculer }: { v: VolumeIndex; coche: boolean; onBasculer: () => void }) {
  const occ = occupation(v);
  const nom = libelleVolume(v);
  const indexe = v.indexe.fichiers ? `${pluriel(v.indexe.fichiers, "média indexé", "médias indexés")}${v.indexe.dernierScan ? ` · ${quand(v.indexe.dernierScan).toLowerCase()}` : ""}` : "Jamais scanné";
  return (
    <button type="button" className="sc-volume" aria-pressed={coche} disabled={!v.disponible} onClick={onBasculer} data-icone={iconeVolume(v)}
      title={!v.disponible ? v.message ?? undefined : undefined}>
      <span className="sc-volume-tete">
        <span className="sc-volume-picto"><PictoVolume v={iconeVolume(v)} /></span>
        <span className="sc-coche" aria-hidden="true">{coche && <Icone nom="check" taille={14} />}</span>
      </span>
      <span className="sc-volume-nom ellipsis">{nom}</span>
      <span className="sc-volume-type ellipsis">{typo([genreDe(v), v.systemeFichiers].filter(Boolean).join(" · "))}</span>
      {v.disponible ? (
        <>
          {occ != null && <span className="sc-jauge" aria-hidden="true"><i style={{ transform: `scaleX(${occ.toFixed(3)})` }} /></span>}
          <span className="sc-volume-libre">{v.taille ? typo(`${taille(v.libre ?? 0)} libres sur ${taille(v.taille)}`) : "Taille inconnue"}</span>
          <span className="sc-volume-index">{typo(indexe)}</span>
        </>
      ) : <span className="sc-volume-indispo">{typo(v.message ?? "Indisponible")}</span>}
    </button>
  );
}

function Chiffre({ n, libelle, ton }: { n: number | string; libelle: string; ton?: "bad" }) {
  return <div className="sc-chiffre" data-ton={ton}><dd>{typeof n === "number" ? nombre(n) : n}</dd><dt>{libelle}</dt></div>;
}

/** Dossier courant : le début et la fin restent lisibles (« C:\Users\…\Rushes 2024\Jour 12 »). */
function cheminCourt(c: string, max = 72): string {
  if (c.length <= max) return c;
  const morceaux = c.split("\\");
  let fin = morceaux.slice(-2).join("\\");
  if (fin.length > max - 8) fin = fin.slice(-(max - 8));
  return `${morceaux[0]}\\…\\${fin}`;
}

export default function EcranScanner({ onFermer }: { onFermer: () => void }) {
  const { aller } = useMagasin();
  const toast = useToast();
  const [volumes, setVolumes] = useState<VolumeIndex[] | null>(null);
  const [reglages, setReglages] = useState<ReglagesIndex | null>(null);
  const [etat, setEtat] = useState<EtatIndex | null>(null);
  const [cibles, setCibles] = useState<Cible[]>([]);
  const [p, setP] = useState<ProgressionScan | null>(null);
  const [fin, setFin] = useState<ResumeScan | null>(null);
  const [lancement, setLancement] = useState(false);
  const [annulation, setAnnulation] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const relire = () => {
    indexApi.volumes().then(setVolumes).catch((e) => setErreur(messageErreur(e)));
    indexApi.etat().then((e) => { setEtat(e); if (e.scan) setP(e.scan); }).catch(() => {});
  };
  useEffect(() => {
    relire();
    indexApi.reglages().then((r) => { setReglages(r); setCibles(r.cibles); }).catch((e) => setErreur(messageErreur(e)));
    const fins = [
      evenementsIndex.progression((x) => { setP(x.phase === "termine" ? null : x); }),
      evenementsIndex.fin((r) => { setFin(r); setP(null); setAnnulation(false); relire(); }),
      evenementsIndex.changement((q) => { if (q === "volumes" || q === "reglages" || q === "index") relire(); }),
    ];
    return () => { fins.forEach((f) => f.then((u) => u()).catch(() => {})); };
  }, []);

  // (La chouette suit le scan depuis la coque — lib/activiteScan.ts —, même quand cet écran est fermé.)

  const dossiers = cibles.filter((c) => c.genre === "dossier");
  const tous = cibles.some((c) => c.genre === "tous");
  const disponibles = (volumes ?? []).filter((v) => v.disponible);
  const types = reglages?.types ?? { video: true, audio: true, image: true };
  const aucunType = !types.video && !types.audio && !types.image;
  const pret = cibles.length > 0 && !aucunType && !lancement;

  const enregistrerCibles = async (c: Cible[]) => {
    setCibles(c);
    try { setReglages(await indexApi.modifierReglages({ cibles: c })); } catch (e) { toast({ etat: "erreur", titre: "Cibles non enregistrées", texte: messageErreur(e) }); }
  };
  const basculerType = async (t: "video" | "audio" | "image") => {
    try { setReglages(await indexApi.modifierReglages({ types: { [t]: !types[t] } })); } catch (e) { toast({ etat: "erreur", titre: "Réglage non enregistré", texte: messageErreur(e) }); }
  };
  const ajouterDossier = async () => {
    try {
      const d = await api.choisirDossier("Dossier à scanner");
      if (d && !dossiers.some((x) => x.chemin.toLowerCase() === d.toLowerCase())) await enregistrerCibles([...cibles, cibleDossier(d)]);
    } catch (e) { toast({ etat: "erreur", titre: "Sélection impossible", texte: messageErreur(e) }); }
  };
  const lancer = async (c?: Cible[]) => {
    setLancement(true); setErreur(null); setFin(null);
    try {
      if (!c) await indexApi.modifierReglages({ cibles });
      await indexApi.lancerScan(c ?? cibles);
      const e = await indexApi.etat();
      setEtat(e);
      if (e.scan) setP(e.scan);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setLancement(false);
    }
  };
  const annuler = async () => {
    setAnnulation(true);
    try { await indexApi.annulerScan(); } catch (e) { setAnnulation(false); toast({ etat: "erreur", titre: "Annulation impossible", texte: messageErreur(e) }); }
  };
  const explorer = () => { viserOrigine("scannes"); aller("bibliotheque"); };
  const reglagesIndex = () => { viserReglage("index"); aller("parametres"); };

  const pc = p ? pourcentage(p) : null;
  const everything = etat?.modeEverything === "auto" ? (etat.everything.disponible && etat.everything.baseChargee ? `Everything ${etat.everything.version ?? ""} prêt : progression mesurable sur les disques NTFS` : `Everything indisponible (${(etat.everything.raison ?? "non lancé").replace(/\.$/, "")}) : scanner natif`) : null;
  const resumeCibles = useMemo(() => {
    if (tous) return `Tous les disques disponibles (${disponibles.length})`;
    const v = cibles.filter((c) => c.genre === "volume").map((c) => c.chemin.replace(/\\$/, ""));
    const l = [...v, ...dossiers.map((d) => d.chemin)];
    return l.length ? l.join(" · ") : "Aucune cible";
  }, [cibles, tous, disponibles.length]);

  let corps: ReactNode;
  if (p) {
    // ---- Pendant le scan ----------------------------------------------------------------------------------------------
    corps = (
      <section className="sc-scan carte-n" aria-label="Scan en cours" aria-busy="true">
        <div className="sc-scan-chouette"><Companion lieu="vide" taille={132} /></div>
        <div className="sc-scan-corps">
          <span className="surtitre">{p.mode === "everything" ? "Lecture de l'index d'Everything" : p.phase === "rapprochement" ? "Mise à jour de l'index" : "Analyse en cours"}</span>
          <h2 className="sc-scan-titre" aria-live="polite">{nombre(totalMedias(p.medias))} <span>{totalMedias(p.medias) > 1 ? "médias trouvés" : "média trouvé"}</span></h2>
          <div className={`progress sc-barre${pc == null ? " progress--indet" : ""}`} role="progressbar" aria-label={typo(libelleProgression(p))} aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={pc ?? undefined} aria-valuetext={typo(pc == null ? `${libelleProgression(p)} · progression indéterminée` : `${pc} %`)}>
            <i style={{ ["--p" as string]: pc != null ? pc / 100 : 0 }} />
          </div>
          <p className="sc-scan-ligne">{typo(libelleProgression(p))}{pc != null ? null : <span className="sc-note"> · {typo("total inconnu : la progression exacte n'existe qu'en mode Everything")}</span>}</p>
          <dl className="sc-chiffres">
            <Chiffre n={p.medias.video} libelle="Vidéos" />
            <Chiffre n={p.medias.audio} libelle="Audios" />
            <Chiffre n={p.medias.image} libelle="Images" />
            <Chiffre n={p.fichiersVus} libelle="Fichiers parcourus" />
            <Chiffre n={p.dossiers} libelle="Dossiers" />
            <Chiffre n={p.erreurs} libelle="Erreurs d'accès" ton={p.erreurs ? "bad" : undefined} />
          </dl>
          {p.dossierCourant && <p className="sc-courant mono" title={p.dossierCourant}><Icone nom="folder" taille={13} />{cheminCourt(p.dossierCourant)}</p>}
          <div className="sc-actions">
            <Bouton variante="danger" icone="close" occupe={annulation} disabled={annulation} onClick={() => void annuler()}>{annulation ? "Annulation…" : "Annuler le scan"}</Bouton>
            <span className="sc-note">{typo(`${nombre(Math.round(p.debit))} fichiers par seconde · ${dureeLisible(p.ecouleMs / 1000)} · priorité basse : l'ordinateur reste utilisable`)}</span>
          </div>
        </div>
      </section>
    );
  } else if (fin) {
    // ---- Résumé de fin ------------------------------------------------------------------------------------------------
    const b = fin.bilan;
    const bilan = [[b.nouveaux, "nouveau", "nouveaux"], [b.modifies, "modifié", "modifiés"], [b.renommes, "renommé", "renommés"], [b.deplaces, "déplacé", "déplacés"], [b.supprimes, "supprimé", "supprimés"],
      [b.doublons, "doublon", "doublons"], [b.retrouves, "retrouvé", "retrouvés"], [b.indisponibles, "indisponible", "indisponibles"]] as const;
    corps = (
      <section className="sc-fin carte-n" aria-label="Résumé du scan" data-etat={fin.etat}>
        <div className="sc-scan-chouette"><Companion lieu="vide" taille={132} /></div>
        <div className="sc-scan-corps">
          <span className="surtitre">{fin.etat === "termine" ? "Scan terminé" : fin.etat === "annule" ? "Scan annulé" : "Scan interrompu"}</span>
          <h2 className="sc-scan-titre">{nombre(fin.totalMedias)} <span>{fin.totalMedias > 1 ? "médias trouvés" : "média trouvé"}</span></h2>
          {fin.etat === "annule" && <p className="sc-scan-ligne">{typo("Les médias déjà trouvés sont gardés ; rien n'a été marqué supprimé.")}</p>}
          {fin.message && <p className="sc-scan-ligne sc-erreur">{typo(fin.message)}</p>}
          <dl className="sc-chiffres sc-chiffres--fin">
            <Chiffre n={fin.medias.video} libelle="Vidéos" />
            <Chiffre n={fin.medias.audio} libelle="Audios" />
            <Chiffre n={fin.medias.image} libelle="Images" />
            <Chiffre n={fin.erreurs} libelle="Erreurs" ton={fin.erreurs ? "bad" : undefined} />
          </dl>
          <p className="sc-scan-ligne">{typo([bilan.filter(([n]) => n > 0).map(([n, un, plusieurs]) => `${nombre(n)} ${n > 1 ? plusieurs : un}`).join(" · ") || "Aucun changement depuis le dernier scan",
            `${nombre(fin.fichiersVus)} fichiers parcourus en ${dureeLisible(fin.dureeMs / 1000)}`].join(" · "))}</p>
          {fin.volumesIndisponibles.length > 0 && <p className="sc-scan-ligne sc-note">{typo(`Indisponibles (gardés, pas supprimés) : ${fin.volumesIndisponibles.join(", ")}`)}</p>}
          {fin.erreursListe.length > 0 && (
            <details className="sc-erreurs">
              <summary><Icone nom="chevron-right" taille={14} />{typo(`Voir les erreurs (${nombre(fin.erreurs)}${fin.erreurs > fin.erreursListe.length ? `, ${fin.erreursListe.length} premières` : ""})`)}</summary>
              <ul>{fin.erreursListe.map((x, i) => <li key={`${x.chemin}${i}`}><span className="mono ellipsis" title={x.chemin}>{x.chemin}</span><span>{typo(x.message)}</span></li>)}</ul>
            </details>
          )}
          <div className="sc-actions">
            <Bouton variante="primary" taille="lg" icone="library" onClick={explorer}>Explorer les médias</Bouton>
            <Bouton icone="scan" onClick={() => setFin(null)}>Nouveau scan</Bouton>
          </div>
        </div>
      </section>
    );
  } else {
    // ---- Choix des cibles ---------------------------------------------------------------------------------------------
    corps = (
      <>
        {etat?.interrompu && etat.interrompu.length > 0 && (
          <div className="sc-bandeau carte-n" role="note">
            <Icone nom="alert" taille={18} />
            <span className="grow">{typo("Un scan a été interrompu (fermeture ou coupure). La reprise est incrémentale : rien n'est refait inutilement.")}</span>
            <Bouton taille="sm" variante="primary" icone="retry" onClick={() => void lancer(etat.interrompu!)}>Reprendre</Bouton>
          </div>
        )}
        <section className="sc-bloc" aria-labelledby="sc-volumes-titre">
          <div className="sc-bloc-tete">
            <h2 id="sc-volumes-titre" className="sc-h2">Disques</h2>
            <button type="button" className="sc-tous" aria-pressed={tous} onClick={() => void enregistrerCibles(tous ? dossiers : [cibleTous(), ...dossiers])} disabled={!disponibles.length}>
              <span className="sc-coche" aria-hidden="true">{tous && <Icone nom="check" taille={12} />}</span>Tous les disques
            </button>
          </div>
          {volumes == null ? <div className="sc-volumes" aria-busy="true">{[0, 1, 2].map((k) => <span key={k} className="sc-volume sc-volume--attente" />)}</div> : (
            <div className="sc-volumes">
              {volumes.map((v) => <CarteVolume key={v.racine} v={v} coche={volumeCoche(cibles, v)} onBasculer={() => void enregistrerCibles(basculerVolume(cibles, v, volumes))} />)}
            </div>
          )}
        </section>
        <section className="sc-bloc" aria-labelledby="sc-dossiers-titre">
          <div className="sc-bloc-tete">
            <h2 id="sc-dossiers-titre" className="sc-h2">Dossiers précis</h2>
            <Bouton taille="sm" icone="plus" onClick={() => void ajouterDossier()}>Ajouter un dossier…</Bouton>
          </div>
          {dossiers.length ? (
            <ul className="sc-dossiers">
              {dossiers.map((d) => (
                <li key={d.chemin} className="sc-dossier"><Icone nom="folder" taille={16} /><span className="mono ellipsis" title={d.chemin}>{d.chemin}</span>
                  <BoutonIcone nom="close" libelle={`Retirer ${d.chemin}`} taille="xs" onClick={() => void enregistrerCibles(cibles.filter((c) => c !== d))} /></li>
              ))}
            </ul>
          ) : <p className="sc-note">{typo("Aucun : un dossier précis (rushes, photos…) se scanne en quelques secondes et reste surveillé ensuite.")}</p>}
        </section>
        <section className="sc-bloc" aria-labelledby="sc-types-titre">
          <div className="sc-bloc-tete"><h2 id="sc-types-titre" className="sc-h2">Médias à chercher</h2></div>
          <div className="sc-types" role="group" aria-label="Types de médias">
            {TYPES.map((t) => (
              <button key={t.id} type="button" className="sc-type" aria-pressed={types[t.id]} onClick={() => void basculerType(t.id)}>
                <Icone nom={t.icone} taille={18} /><span>{t.libelle}</span><span className="sc-type-ext">{(reglages?.extensions[t.id] ?? []).slice(0, 5).map((x) => x.toUpperCase()).join(" · ")}…</span>
              </button>
            ))}
          </div>
        </section>
        <div className="sc-lancer carte-n">
          <div className="grow">
            <div className="sc-lancer-titre">{typo(resumeCibles)}</div>
            <div className="sc-note">{typo(aucunType ? "Choisis au moins un type de média." : everything ?? "Scanner natif : priorité basse, fichiers jamais modifiés ni déplacés.")}</div>
            {erreur && <div className="sc-erreur" role="alert">{typo(erreur)}</div>}
          </div>
          <Bouton variante="primary" taille="lg" icone="scan" disabled={!pret} occupe={lancement} onClick={() => void lancer()}>Lancer le scan</Bouton>
        </div>
        {etat?.dernier && (
          <div className="sc-dernier" role="note">
            <span>{typo(`Dernier scan ${quand(etat.dernier.fin).toLowerCase()} · ${pluriel(etat.totaux.total, "média indexé", "médias indexés")}${etat.dernier.erreurs ? ` · ${pluriel(etat.dernier.erreurs, "erreur", "erreurs")}` : ""}`)}</span>
            <Bouton taille="sm" variante="ghost" icone="library" onClick={explorer}>Explorer les médias</Bouton>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="sc">
      <div className="sc-tete">
        <BoutonIcone nom="chevron-left" libelle="Retour" taille="sm" onClick={onFermer} />
        <div className="grow">
          <h1 className="t-display-l">Scanner mes disques</h1>
          <p className="sub">{typo("AETHRYON Index trouve tes vidéos, sons et images sur ce PC ; rien n'est déplacé ni modifié.")}</p>
        </div>
        <Bouton taille="sm" variante="ghost" icone="settings" onClick={reglagesIndex}>Réglages de l'index</Bouton>
        {!p && !fin && <span className="sc-tete-chouette"><Companion lieu="vide" taille={88} /></span>}
      </div>
      {corps}
    </div>
  );
}
