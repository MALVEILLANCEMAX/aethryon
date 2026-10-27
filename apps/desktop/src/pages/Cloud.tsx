// Section CLOUD (administrateur seulement, chargée à la demande) : espace utilisé et disponible (jauge RÉELLE du
// serveur), fichiers sauvegardés (vidéo et audio, même quota), recherche et filtres (appliqués par account), aperçu
// des fichiers lisibles (lien signé « apercu » de 5 min), « Télécharger » dans le dossier des médias (progression
// réelle, annulation, jamais d'écrasement), « Copier un lien temporaire » (durée affichée), suppression confirmée,
// « Expire dans X jours » et date, statuts du brief, erreurs de synchronisation lisibles, file des envois partis de la
// bibliothèque (menu « Sauvegarder dans le Cloud » ou carte glissée sur « Cloud » dans la navigation).
// Rien n'est simulé : chaque nombre vient du serveur ou du cœur Rust ; aucune clé n'arrive jusqu'ici.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import "../styles/cloud.css";
import { api, messageErreur } from "../lib/api";
import { copier, useMagasin } from "../lib/magasin";
import { useTransfertsCloud } from "../lib/compte";
import { dureeLien, erreurLisible, expiration, FILTRES_STATUTS, FILTRES_TYPES, fraction, jauge, libelleTransfert, octetsCloud, statutObjet, TRIS, type Ton } from "../lib/cloudVue";
import { pluriel, quand, typo } from "../lib/format";
import type { EtatCloud, LienCloud, ListeCloud, ObjetCloud, QuotaCloud, TransfertCloud } from "../lib/types";
import { Bouton, BoutonIcone, Icone, Pastille, Segmente, type EtatPastille } from "../ui/base";
import { Dialogue, Menu, useToast, type ElementMenu } from "../ui/superpositions";
import { Companion } from "../ui/Companion";

const PASTILLE: Record<Ton, EtatPastille> = { ok: "ok", attente: "warn", cours: "running", erreur: "error", eteint: "quiet" };
const ORIGINES: Record<string, string> = { desktop: "depuis le Desktop", ytapi: "téléchargement AETHRYON", extension: "depuis l'extension", site: "depuis le site" };

function iconeType(type: string) {
  return type.startsWith("audio/") ? "audio" : type.startsWith("image/") ? "image" : "film";
}

function Jauge({ q }: { q: QuotaCloud }) {
  const j = jauge(q);
  return (
    <section className="cl-jauge" data-niveau={j.niveau} aria-label="Espace AETHRYON Cloud">
      <div className="cl-jauge-chiffres">
        <div><span className="cl-grand">{j.utilise}</span><span className="cl-unite">{typo(` utilisés sur ${j.max}`)}</span></div>
        <div className="cl-dispo"><b>{j.disponible}</b> disponibles{q.reserve > 0 ? typo(` · ${octetsCloud(q.reserve)} réservés par des envois en cours`) : ""}</div>
      </div>
      <div className="cl-barre" role="meter" aria-valuemin={0} aria-valuemax={q.max} aria-valuenow={q.utilise} aria-valuetext={typo(j.aria)} aria-label="Espace utilisé">
        <i className="cl-barre-sauve" style={{ transform: `scaleX(${j.sauve})` }} />
        <i className="cl-barre-reserve" style={{ transform: `translateX(${j.sauve * 100}%) scaleX(${j.reserve})` }} />
      </div>
      {j.niveau !== "normal" && <p className="cl-jauge-avis" role="note">{typo(j.niveau === "plein" ? "Cloud plein : supprime des fichiers pour faire de la place. Rien n'est supprimé avant son expiration." : "Cloud presque plein : pense à supprimer les fichiers dont tu n'as plus besoin.")}</p>}
    </section>
  );
}

/** Ligne de la file : envoi (bibliothèque → Cloud) ou téléchargement (Cloud → dossier des médias). */
function LigneTransfert({ t, onAnnuler, onReessayer, onMontrer }: { t: TransfertCloud; onAnnuler: () => void; onReessayer?: () => void; onMontrer?: () => void }) {
  const l = libelleTransfert(t);
  const f = fraction(t);
  const indet = l.actif && (t.etape === "confirmation" || t.etape === "attente" || f == null);
  const message = t.etape === "echec" ? erreurLisible(t.code, t.message) : t.etape === "termine" && t.sens === "telechargement" ? t.message : null;
  return (
    <div className="cl-tr" data-etape={t.etape} data-sens={t.sens}>
      <span className="cl-tr-ico" aria-hidden="true"><Icone nom={t.sens === "envoi" ? "cloud-up" : "download"} taille={16} /></span>
      <div className="cl-tr-corps">
        <div className="cl-tr-ligne">
          <span className="cl-tr-nom ellipsis">{t.nom}</span>
          <span className="cl-tr-etat" aria-live="polite">{typo(l.libelle)}</span>
        </div>
        {l.actif && (
          <div className={`cl-tr-barre${indet ? " cl-tr-barre--indet" : ""}`} role="progressbar" aria-label={typo(`${t.nom} : ${l.libelle}`)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={f != null && !indet ? Math.floor(f * 100) : undefined}>
            <i style={!indet && f != null ? { transform: `scaleX(${f})` } : undefined} />
          </div>
        )}
        {message && <div className={`cl-tr-msg${t.etape === "echec" ? " bad" : ""}`}>{typo(message)}</div>}
      </div>
      <div className="cl-tr-actions">
        {l.actif && t.etape !== "confirmation" && <Bouton taille="sm" variante="ghost" onClick={onAnnuler}>Annuler</Bouton>}
        {t.etape === "echec" && onReessayer && <Bouton taille="sm" icone="retry" onClick={onReessayer}>Réessayer</Bouton>}
        {t.etape === "termine" && onMontrer && <BoutonIcone nom="reveal" libelle="Afficher dans l'Explorateur" taille="sm" onClick={onMontrer} />}
      </div>
    </div>
  );
}

function Apercu({ o, lien, onFermer }: { o: ObjetCloud; lien: LienCloud; onFermer: () => void }) {
  return (
    <Dialogue titre={o.nom} large onFermer={onFermer} actions={<Bouton variante="primary" onClick={onFermer}>Fermer</Bouton>}>
      <div className="cl-apercu">
        {o.type.startsWith("video/") ? <video controls preload="metadata" src={lien.url} aria-label={typo(`Aperçu de ${o.nom}`)} />
          : o.type.startsWith("audio/") ? <audio controls preload="metadata" src={lien.url} aria-label={typo(`Aperçu de ${o.nom}`)} />
          : <img src={lien.url} alt={typo(`Aperçu de ${o.nom}`)} />}
      </div>
      <p className="t-small c3">{typo(`Lecture depuis le Cloud par un lien signé, ${dureeLien(lien.expireLe)}. Rien n'est enregistré sur cet ordinateur.`)}</p>
    </Dialogue>
  );
}

export default function Cloud() {
  const { inst, aller, actionMedia } = useMagasin();
  const toast = useToast();
  const transferts = useTransfertsCloud();
  const [etat, setEtat] = useState<EtatCloud | null>(null);
  const [liste, setListe] = useState<ListeCloud | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [qDiffere, setQDiffere] = useState("");
  const [type, setType] = useState("");
  const [statut, setStatut] = useState("");
  const [tri, setTri] = useState("recent");
  const [apercu, setApercu] = useState<{ o: ObjetCloud; lien: LienCloud } | null>(null);
  const [aSupprimer, setASupprimer] = useState<ObjetCloud | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ el: HTMLElement; o: ObjetCloud; point?: { x: number; y: number }; clavier?: boolean } | null>(null);
  const requete = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setQDiffere(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const charger = useCallback(async () => {
    const n = ++requete.current;
    try {
      const [e, l] = await Promise.all([api.cloudEtat(), api.cloudObjets({ q: qDiffere, statut, type, tri, page: 1 })]);
      if (n !== requete.current) return;
      setEtat(e);
      setListe(l);
      setErreur(null);
    } catch (x) {
      if (n !== requete.current) return;
      const c = (x as { code?: string })?.code;
      setErreur(erreurLisible(c, messageErreur(x)));
    }
  }, [qDiffere, statut, type, tri]);

  useEffect(() => { void charger(); }, [charger]);

  // Un transfert qui se termine change la bibliothèque du Cloud ou le quota : relecture.
  const finis = transferts.filter((t) => t.finiLe).map((t) => t.id).join(",");
  useEffect(() => { if (finis) void charger(); }, [finis, charger]);

  const quota = liste?.quota ?? etat?.quota ?? null;
  const filtre = qDiffere !== "" || statut !== "" || type !== "";
  const visibles = useMemo(() => transferts.slice().reverse().filter((t) => !t.finiLe || Date.now() - Date.parse(t.finiLe) < 30 * 60_000), [transferts]);

  const telecharger = async (o: ObjetCloud) => {
    try {
      await api.cloudTelecharger(o.id);
      toast({ etat: "attente", titre: "Téléchargement lancé", texte: `« ${o.nom} » arrive dans le dossier des médias.` });
    } catch (x) {
      toast({ etat: "erreur", titre: "Téléchargement impossible", texte: erreurLisible((x as { code?: string })?.code, messageErreur(x)) });
    }
  };
  const copierLien = async (o: ObjetCloud) => {
    setOccupe(o.id);
    try {
      const l = await api.cloudLien(o.id, "telecharger");
      const ok = await copier(l.url);
      toast(ok ? { etat: "ok", titre: "Lien temporaire copié", texte: `${dureeLien(l.expireLe)}. Toute personne qui a ce lien peut télécharger le fichier jusqu'à son échéance.` }
        : { etat: "erreur", titre: "Copie impossible", texte: "Le presse-papiers est indisponible." });
    } catch (x) {
      toast({ etat: "erreur", titre: "Lien non créé", texte: erreurLisible((x as { code?: string })?.code, messageErreur(x)) });
    } finally { setOccupe(null); }
  };
  const ouvrirApercu = async (o: ObjetCloud) => {
    setOccupe(o.id);
    try {
      setApercu({ o, lien: await api.cloudLien(o.id, "apercu") });
    } catch (x) {
      toast({ etat: "erreur", titre: "Aperçu impossible", texte: erreurLisible((x as { code?: string })?.code, messageErreur(x)) });
    } finally { setOccupe(null); }
  };
  const supprimer = async (o: ObjetCloud) => {
    setOccupe(o.id);
    try {
      const r = await api.cloudSupprimer(o.id);
      setASupprimer(null);
      toast({ etat: "ok", titre: r.objet.statut === "suppression_en_attente" ? "Suppression en cours" : "Supprimé du Cloud", texte: r.objet.statut === "suppression_en_attente" ? "L'accès est déjà révoqué ; le stockage confirmera la suppression." : `« ${o.nom} » : toutes ses versions sont effacées. Ta copie locale n'est pas touchée.` });
      void charger();
    } catch (x) {
      toast({ etat: "erreur", titre: "Suppression impossible", texte: erreurLisible((x as { code?: string })?.code, messageErreur(x)) });
    } finally { setOccupe(null); }
  };

  const elementsMenu = (o: ObjetCloud): ElementMenu[] => {
    const pret = o.statut === "sauvegarde";
    return [
      { id: "apercu", libelle: "Aperçu", icone: "play", kbd: "Entrée", raccourci: "Enter", desactive: !pret || !o.apercu, raison: !pret ? "Pas disponible" : "Aperçu impossible pour ce type" },
      { id: "telecharger", libelle: "Télécharger", icone: "download", desactive: !pret, raison: "Pas disponible" },
      { id: "lien", libelle: "Copier un lien temporaire", icone: "link", desactive: !pret, raison: "Pas disponible" },
      { id: "supprimer", libelle: "Supprimer du Cloud…", icone: "trash", kbd: "Suppr", raccourci: "Delete", danger: true, separateurAvant: true, desactive: o.statut === "suppression_en_attente", raison: "Suppression déjà en cours" },
    ];
  };
  const faire = (id: string, o: ObjetCloud) => {
    if (id === "apercu") void ouvrirApercu(o);
    else if (id === "telecharger") void telecharger(o);
    else if (id === "lien") void copierLien(o);
    else if (id === "supprimer") setASupprimer(o);
  };

  const ligne = (o: ObjetCloud) => {
    const s = statutObjet(o.statut);
    const exp = expiration(o);
    const pret = o.statut === "sauvegarde";
    const meta = [o.type.split("/")[1]?.replace("x-matroska", "mkv").replace("quicktime", "mov").replace("mpeg", "mp3").toUpperCase(), octetsCloud(o.taille), ORIGINES[o.origine] ?? null, o.envoyeLe ? `ajouté ${quand(o.envoyeLe).toLowerCase()}` : null].filter(Boolean).join(" · ");
    const ouvrirMenu = (e: MouseEvent) => { e.preventDefault(); setMenu({ el: e.currentTarget as HTMLElement, o, point: { x: e.clientX, y: e.clientY } }); };
    const clavier = (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
        e.preventDefault();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setMenu({ el: e.currentTarget as HTMLElement, o, point: { x: r.left + 12, y: r.top + 12 }, clavier: true });
      } else if (e.key === "Enter" && pret && o.apercu) { e.preventDefault(); void ouvrirApercu(o); }
      else if (e.key === "Delete" && o.statut !== "suppression_en_attente") { e.preventDefault(); setASupprimer(o); }
    };
    return (
      <div key={o.id} className="cl-ligne" role="listitem" tabIndex={0} data-statut={o.statut} data-objet={o.id} aria-busy={occupe === o.id || undefined}
        aria-label={typo(`${o.nom} · ${s.libelle}${exp ? ` · ${exp.court}` : ""}`)} onContextMenu={ouvrirMenu} onKeyDown={clavier}>
        <span className={`tile cl-tile${o.statut === "echec" ? " cl-tile--bad" : ""}`} aria-hidden="true"><Icone nom={iconeType(o.type)} taille={18} /></span>
        <div className="cl-ligne-corps">
          <div className="cl-nom ellipsis" title={o.nom}>{o.nom}</div>
          <div className="cl-meta">{typo(meta)}</div>
          {o.statut === "echec" && <div className="cl-sync" role="note"><Icone nom="alert" taille={14} />{typo(erreurLisible(o.erreur, `Erreur de synchronisation (${o.erreur ?? "inconnue"}).`))}</div>}
        </div>
        <div className="cl-etat">
          <Pastille etat={PASTILLE[s.ton]} libelle={s.libelle} />
          {exp && <div className={`cl-exp${exp.proche ? " cl-exp--proche" : ""}`}>{typo(exp.court)} <span className="c3">{typo(`· ${exp.date}`)}</span></div>}
        </div>
        <div className="cl-actions">
          {pret && o.apercu && <BoutonIcone nom="play" libelle={typo(`Aperçu de « ${o.nom} »`)} taille="sm" onClick={() => ouvrirApercu(o)} disabled={occupe === o.id} />}
          {pret && <BoutonIcone nom="download" libelle={typo(`Télécharger « ${o.nom} » dans le dossier des médias`)} taille="sm" onClick={() => telecharger(o)} />}
          {pret && <BoutonIcone nom="link" libelle={typo(`Copier un lien temporaire vers « ${o.nom} »`)} taille="sm" onClick={() => copierLien(o)} disabled={occupe === o.id} />}
          <BoutonIcone nom="trash" libelle={typo(`Supprimer « ${o.nom} » du Cloud`)} taille="sm" onClick={() => setASupprimer(o)} disabled={o.statut === "suppression_en_attente"} />
        </div>
      </div>
    );
  };

  if (!inst) return null;
  const total = liste?.total ?? 0;
  const retention = etat?.retentionJours ?? 30;

  return (
    <>
      <div className="ph">
        <div className="grow">
          <h1 className="t-display-l">Cloud</h1>
          <p className="sub"><b>{liste ? pluriel(total, "fichier", "fichiers") : "…"}</b>{typo(` · conservés ${retention} jours · réservé à l'administrateur`)}</p>
        </div>
        <Bouton taille="sm" variante="ghost" icone="retry" onClick={() => void charger()}>Actualiser</Bouton>
      </div>

      {quota && <Jauge q={quota} />}
      {erreur && (
        <div className="bandeau bandeau--erreur" role="alert">
          <Icone nom="alert" taille={16} /><span className="grow">{typo(erreur)}</span>
          <Bouton taille="sm" variante="ghost" onClick={() => void charger()}>Réessayer</Bouton>
        </div>
      )}

      {visibles.length > 0 && (
        <section className="cl-file" aria-label="Envois et téléchargements">
          <div className="sec-label">Envois et téléchargements</div>
          <div className="group">
            {visibles.map((t) => {
              const media = t.mediaId ? inst.index.medias.find((m) => m.id === t.mediaId && m.etat === "disponible") : undefined;
              const local = t.chemin ? inst.index.medias.find((m) => m.chemin === t.chemin) : undefined;
              return (
                <LigneTransfert key={t.id} t={t}
                  onAnnuler={() => void api.cloudAnnuler(t.id)}
                  onReessayer={t.sens === "envoi" && media ? () => void api.cloudEnvoyer([media.id]).catch((x) => toast({ etat: "erreur", titre: "Envoi impossible", texte: erreurLisible((x as { code?: string })?.code, messageErreur(x)) })) : undefined}
                  onMontrer={local ? () => void actionMedia(local, "explorateur") : undefined} />
              );
            })}
          </div>
        </section>
      )}

      <div className="toolbar cl-outils">
        <label className="field field--saisie cl-recherche">
          <Icone nom="search" taille={16} />
          <input type="search" value={q} placeholder="Rechercher dans le Cloud" aria-label="Rechercher dans le Cloud" maxLength={100} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }} />
          {q && <BoutonIcone nom="close" libelle="Effacer la recherche" taille="xs" onClick={() => setQ("")} />}
        </label>
        <Segmente<string> libelle="Type de fichier" valeur={type} onChange={setType} options={FILTRES_TYPES.map((f) => ({ id: f.id, libelle: f.libelle }))} />
        <span className="grow" />
        <label className="select select--etiquette">
          <span className="lbl">Afficher</span>
          <select className="select--natif" aria-label="Statut des fichiers" value={statut} onChange={(e) => setStatut(e.target.value)}>
            {FILTRES_STATUTS.map((f) => <option key={f.id} value={f.id}>{f.libelle}</option>)}
          </select>
          <Icone nom="chevron-down" taille={14} />
        </label>
        <label className="select select--etiquette">
          <span className="lbl">Trier</span>
          <select className="select--natif" aria-label="Trier les fichiers" value={tri} onChange={(e) => setTri(e.target.value)}>
            {TRIS.map((t) => <option key={t.id} value={t.id}>{t.libelle}</option>)}
          </select>
          <Icone nom="chevron-down" taille={14} />
        </label>
      </div>

      {liste && liste.items.length > 0 && <div className="group cl-liste" role="list" aria-label="Fichiers du Cloud">{liste.items.map(ligne)}</div>}
      {liste && liste.items.length > 0 && liste.total > liste.items.length && <p className="t-small c3 cl-plus">{typo(`${liste.items.length} fichiers affichés sur ${liste.total} : précisez la recherche.`)}</p>}

      {liste && liste.items.length === 0 && !filtre && (
        <div className="vide cl-vide">
          <Companion lieu="vide" taille={72} />
          <h2 className="t-display-m">Ton Cloud est vide.</h2>
          <p>{typo(`Glisse un média de la bibliothèque sur « Cloud », dans la barre latérale, ou choisis « Sauvegarder dans le Cloud » dans son menu. Chaque fichier y reste ${retention} jours, puis disparaît de lui-même ; ta copie locale ne bouge pas.`)}</p>
          <div className="vide-actions"><Bouton taille="sm" icone="library" onClick={() => aller("bibliotheque")}>Ouvrir la bibliothèque</Bouton></div>
        </div>
      )}
      {liste && liste.items.length === 0 && filtre && (
        <div className="vide cl-vide">
          <h2 className="t-display-m">Aucun fichier ne correspond.</h2>
          <div className="vide-actions"><Bouton taille="sm" variante="ghost" onClick={() => { setQ(""); setStatut(""); setType(""); }}>Effacer les filtres</Bouton></div>
        </div>
      )}

      {menu && <Menu ancre={menu.el} point={menu.point} parClavier={menu.clavier} elements={elementsMenu(menu.o)} libelle={typo(`Actions pour « ${menu.o.nom} »`)} onChoisir={(id) => faire(id, menu.o)} onFermer={() => setMenu(null)} />}
      {apercu && <Apercu o={apercu.o} lien={apercu.lien} onFermer={() => setApercu(null)} />}
      {aSupprimer && (
        <Dialogue titre={typo(`Supprimer « ${aSupprimer.nom} » du Cloud ?`)} onFermer={() => setASupprimer(null)}
          actions={<><Bouton variante="ghost" onClick={() => setASupprimer(null)}>Annuler</Bouton><Bouton variante="danger" onClick={() => void supprimer(aSupprimer)} disabled={occupe === aSupprimer.id}>Supprimer</Bouton></>}>
          <p>{typo("Le fichier est supprimé définitivement du Cloud, avec toutes ses versions, et libère sa place. Les liens temporaires déjà copiés cessent de fonctionner. Ta copie locale n'est jamais touchée.")}</p>
        </Dialogue>
      )}
    </>
  );
}
