// Paramètres › AETHRYON Index (Nocturne-2) : réglages RÉELS du scanner (index_reglages / index_reglages_modifier) —
// emplacement de l'index, du cache et des miniatures (migration sûre, avancement réel `index-migration`), exclusions,
// dossiers cachés et système, liens et jonctions, surveillance en direct, métadonnées, miniatures, nombre de fils,
// taille minimale, mode accéléré Everything (facultatif, état réel). Une valeur refusée par le cœur n'est jamais
// affichée comme enregistrée.
import { useEffect, useState, type FormEvent } from "react";
import { api, messageErreur } from "../lib/api";
import { taille, typo } from "../lib/format";
import { evenementsIndex, indexApi, pourcentage, type EtatIndex, type Migration, type ModifReglagesIndex, type ReglagesIndex as Reglages } from "../lib/index-medias";
import { Bouton, BoutonIcone, Icone, Interrupteur, Segmente } from "../ui/base";
import { useToast } from "../ui/superpositions";
import { Aide } from "../ui/Aide";

const ETAPES: Record<Migration["etape"], string> = { base: "Copie de la base", miniatures: "Copie des miniatures", verification: "Vérification", bascule: "Bascule", termine: "Terminé", erreur: "Erreur" };

export function ReglagesIndex({ onScanner }: { onScanner: () => void }) {
  const toast = useToast();
  const [r, setR] = useState<Reglages | null>(null);
  const [etat, setEtat] = useState<EtatIndex | null>(null);
  const [migration, setMigration] = useState<Migration | null>(null);
  const [exclusion, setExclusion] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const relire = () => {
    indexApi.reglages().then(setR).catch((e) => setErreur(messageErreur(e)));
    indexApi.etat().then(setEtat).catch(() => {});
  };
  useEffect(() => {
    relire();
    const a = evenementsIndex.migration((m) => setMigration(m.etape === "termine" ? null : m));
    const b = evenementsIndex.changement((q) => { if (q === "reglages") relire(); });
    return () => { a.then((u) => u()).catch(() => {}); b.then((u) => u()).catch(() => {}); };
  }, []);

  const modifier = async (m: ModifReglagesIndex) => {
    try { setR(await indexApi.modifierReglages(m)); } catch (e) { toast({ etat: "erreur", titre: "Réglage refusé", texte: messageErreur(e) }); }
  };
  const deplacer = async () => {
    try {
      const d = await api.choisirDossier("Nouvel emplacement de l'index (dossier vide)");
      if (!d) return;
      setMigration({ etape: "base", fait: 0, total: 0, message: null });
      const n = await indexApi.deplacerEmplacement(d);
      setMigration(null);
      toast({ etat: "ok", titre: "Index déplacé", texte: n });
      relire();
    } catch (e) {
      setMigration(null);
      toast({ etat: "erreur", titre: "Index non déplacé", texte: messageErreur(e) });
    }
  };
  const ajouterExclusion = (e: FormEvent) => {
    e.preventDefault();
    const x = exclusion.trim();
    if (!x || !r) return;
    if (r.exclusions.some((y) => y.toLowerCase() === x.toLowerCase())) { setExclusion(""); return; }
    void modifier({ exclusions: [...r.exclusions, x] }).then(() => setExclusion(""));
  };

  if (!r) return <div className="group reg-attente" aria-busy={!erreur}>{erreur && <div className="row"><div className="rd">{typo(erreur)}</div></div>}</div>;
  const ev = etat?.everything;
  const pc = migration ? pourcentage(migration) : null;
  return (
    <div className="group">
      <div className="row reg" data-reglage="index-scanner">
        <span className="tile tile--gold"><Icone nom="scan" taille={16} /></span>
        <div className="grow">
          <div className="rt">{typo(etat ? `${etat.totaux.total} médias indexés` : "Index des médias")}</div>
          <div className="rd">{typo(etat?.dernier ? `Dernier scan : ${etat.dernier.cibles.join(", ")}` : "Aucun scan pour l'instant.")}</div>
        </div>
        <Bouton taille="sm" icone="scan" onClick={onScanner}>Ouvrir le scanner</Bouton>
      </div>
      <div className="row reg" data-reglage="index-emplacement">
        <span className="tile"><Icone nom="folder" taille={16} /></span>
        <div className="grow">
          <div className="rt reg-titre">Emplacement de l'index, du cache et des miniatures<Aide texte="Sur D: par exemple, pour ne pas remplir C:. Le déplacement copie la base et les miniatures, vérifie, bascule, puis seulement supprime l'ancien emplacement. Le dossier choisi doit être vide." /></div>
          <div className="rd reg-chemin"><span className="mono ellipsis" title={etat?.emplacement ?? r.emplacement ?? ""}>{etat?.emplacement ?? r.emplacement ?? "Dossier de l'application"}</span>{etat && <span>{taille(etat.tailleIndex)}</span>}</div>
          {migration && (
            <div className="reg-migration" aria-live="polite">
              <div className={`progress${pc == null ? " progress--indet" : ""}`} role="progressbar" aria-label={`Déplacement de l'index : ${ETAPES[migration.etape]}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pc ?? undefined}>
                <i style={{ ["--p" as string]: pc != null ? pc / 100 : 0 }} />
              </div>
              <span className="rd">{typo(`${ETAPES[migration.etape]}${pc != null ? ` · ${pc} %` : ""}${migration.message ? ` · ${migration.message}` : ""}`)}</span>
            </div>
          )}
        </div>
        <Bouton taille="sm" disabled={!!migration || !!etat?.scan} onClick={() => void deplacer()}>Déplacer…</Bouton>
      </div>
      <div className="row reg row--pile" data-reglage="index-exclusions">
        <span className="tile"><Icone nom="filter" taille={16} /></span>
        <div className="grow">
          <div className="rt reg-titre">Dossiers exclus<Aide texte="Un nom exclu à toute profondeur (node_modules, *.tmp), ou un chemin depuis la racine d'un disque (\Program Files). Une cible choisie explicitement n'est jamais exclue." /></div>
          <div className="reg-puces">
            {r.exclusions.map((x) => (
              <span key={x} className="reg-puce"><span className="mono">{x}</span><BoutonIcone nom="close" libelle={`Ne plus exclure ${x}`} taille="xs" onClick={() => void modifier({ exclusions: r.exclusions.filter((y) => y !== x) })} /></span>
            ))}
          </div>
          <form className="reg-ajout" onSubmit={ajouterExclusion}>
            <label className="field field--saisie"><input value={exclusion} onChange={(e) => setExclusion(e.target.value)} placeholder="Nom ou chemin à exclure" aria-label="Nom ou chemin à exclure" maxLength={260} /></label>
            <Bouton taille="sm" type="submit" icone="plus" disabled={!exclusion.trim()}>Exclure</Bouton>
          </form>
        </div>
      </div>
      <div className="row reg">
        <span className="tile"><Icone nom="shield" taille={16} /></span>
        <div className="grow"><div className="rt reg-titre">Ignorer les dossiers cachés et système<Aide texte="Dossiers marqués cachés ou système par Windows (sauf une cible choisie explicitement)." /></div></div>
        <Interrupteur libelle="Ignorer les dossiers cachés et système" actif={r.exclureCaches} onChange={(v) => void modifier({ exclureCaches: v })} />
      </div>
      <div className="row reg">
        <span className="tile"><Icone nom="link" taille={16} /></span>
        <div className="grow"><div className="rt reg-titre">Suivre les liens et les jonctions<Aide texte="Désactivé par défaut. Même suivis, aucune boucle n'est possible : chaque dossier n'est parcouru qu'une fois." /></div></div>
        <Interrupteur libelle="Suivre les liens et les jonctions" actif={r.suivreLiens} onChange={(v) => void modifier({ suivreLiens: v })} />
      </div>
      <div className="row reg">
        <span className="tile"><Icone nom="retry" taille={16} /></span>
        <div className="grow"><div className="rt reg-titre">Suivre en direct les dossiers scannés<Aide texte="Ajouts, renommages et suppressions dans les DOSSIERS précis scannés (jamais un disque entier), jusqu'à 32 dossiers." /></div></div>
        <Interrupteur libelle="Suivre en direct les dossiers scannés" actif={r.surveiller} onChange={(v) => void modifier({ surveiller: v })} />
      </div>
      <div className="row reg">
        <span className="tile"><Icone nom="info" taille={16} /></span>
        <div className="grow"><div className="rt reg-titre">Lire les métadonnées<Aide texte="Durée, définition, étiquettes audio : lues après le scan, en arrière-plan." /></div></div>
        <Interrupteur libelle="Lire les métadonnées" actif={r.metadonnees} onChange={(v) => void modifier({ metadonnees: v })} />
      </div>
      <div className="row reg">
        <span className="tile"><Icone nom="image" taille={16} /></span>
        <div className="grow"><div className="rt reg-titre">Créer les miniatures<Aide texte="Images et pochettes en arrière-plan ; vidéos par le WebView2, à la demande des cartes visibles." /></div></div>
        <Interrupteur libelle="Créer les miniatures" actif={r.miniatures} onChange={(v) => void modifier({ miniatures: v })} />
      </div>
      <div className="row reg">
        <span className="tile"><Icone nom="sort" taille={16} /></span>
        <div className="grow"><div className="rt reg-titre">Fils de scan<Aide texte="Plus de fils : plus rapide sur un SSD, plus de charge. Le scan garde toujours une priorité basse." /></div></div>
        <Segmente<string> libelle="Fils de scan" valeur={String(r.fils)} onChange={(v) => void modifier({ fils: Number(v) })} options={["1", "2", "3", "4"].map((x) => ({ id: x, libelle: x }))} />
      </div>
      <div className="row reg">
        <span className="tile"><Icone nom="filter" taille={16} /></span>
        <div className="grow"><div className="rt reg-titre">Taille minimale<Aide texte="Ignore les fichiers plus petits (icônes, vignettes d'autres logiciels)." /></div></div>
        <Segmente<string> libelle="Taille minimale" valeur={String(r.tailleMin)} onChange={(v) => void modifier({ tailleMin: Number(v) })}
          options={[{ id: "0", libelle: "Tous" }, { id: "102400", libelle: "100 Ko" }, { id: "1048576", libelle: "1 Mo" }]} />
      </div>
      <div className="row reg row--pile" data-reglage="index-everything">
        <span className="tile"><Icone nom="sparkle" taille={16} /></span>
        <div className="grow">
          <div className="rt reg-titre">Mode accéléré Everything<Aide texte="Facultatif. Si Everything (voidtools) est installé, lancé et sa base chargée, les disques NTFS locaux sont lus dans son index, avec une progression mesurable ; sinon, le scanner natif prend le relais. Everything n'est jamais livré avec AETHRYON." /></div>
          <Segmente<"desactive" | "auto"> libelle="Mode accéléré Everything" valeur={r.everything} onChange={(v) => void modifier({ everything: v })}
            options={[{ id: "desactive", libelle: "Désactivé" }, { id: "auto", libelle: "Automatique" }]} />
          <div className="rd rd--choix">{typo(!ev ? "État d'Everything en lecture…" : ev.disponible ? `Everything ${ev.version ?? ""} ${ev.baseChargee ? "prêt" : "lancé, base en chargement"}.` : `Everything indisponible : ${(ev.raison ?? "non lancé").replace(/\.$/, "")}.`)}</div>
        </div>
      </div>
    </div>
  );
}
