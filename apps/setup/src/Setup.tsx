// AETHRYON Setup : Bienvenue → Détection → Configuration → Installation → Terminé, et le mode « maintenance »
// (Réparer, Mettre à jour, Désinstaller) quand AETHRYON est déjà installé. Tout ce qui est affiché vient du moteur :
// détection réelle, étapes réelles, durées et octets mesurés. Aucune barre factice, aucune compatibilité supposée.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, messageErreur, type Pont } from "./lib/api";
import { dossierAmical, taille, typo } from "./lib/format";
import { mouvementReduit } from "./lib/mouvement";
import type { Action, Avancement, Detection, Etape, EtatInitial, Etat, Notifications, Operation, Options } from "./lib/types";
import { Bouton, Fil, Icone, IconeEtat, Interrupteur, Pastille, Segmente } from "./ui/base";
import { Chouette } from "./ui/marque";
import { Dialogue, useToast } from "./ui/superpositions";

type Ecran = "chargement" | "erreur" | "bienvenue" | "detection" | "configuration" | "installation" | "termine" | "maintenance" | "confirmer" | "desinstallation" | "desinstalle";
const REGLE = ["Bienvenue", "Détection", "Configuration", "Installation", "Terminé"];
/** Opérations prévues de chaque étape (operations.rs), affichées « à venir » tant qu'elles n'ont pas commencé. */
const PREVUES: string[][] = [
  ["Paquet AETHRYON", "Extension Premiere Pro : signature", "Espace disque", "Dossier des médias inscriptible", "Premiere Pro et AETHRYON Desktop"],
  ["AETHRYON Desktop", "Extension Premiere Pro", "Programme de maintenance"],
  ["Applications installées", "Raccourci du menu Démarrer", "Démarrage avec Windows"],
  ["Préférences partagées", "AETHRYON Desktop prêt à l'emploi", "Inventaire de l'installation"],
  ["Fichiers installés relus", "Extension : fichiers conformes", "Registre relu", "Préférences relues", "PlayerDebugMode non modifié", "Nettoyage"],
];
const VERBES: Record<Operation, [string, string]> = {
  installer: ["Installation", "installation"],
  reparer: ["Réparation", "réparation"],
  mettreAJour: ["Mise à jour", "mise à jour"],
};

function secondes(ms: number | null | undefined): string {
  if (ms == null) return "";
  return ms < 100 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

function ecoule(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} écoulées`;
}

/** « 26.5.2.13 » → « 26.5.2 » */
function versionCourte(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.split(".").slice(0, 3).join(".");
}

/** « [25.0,99.9] » → « 25.0 » */
function minimum(intervalle: string): string {
  return intervalle.replace(/^[[(]/, "").split(",")[0].trim() || intervalle;
}

function dateFr(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function Regle({ i, suite }: { i: number; suite?: string }) {
  return (
    <div className="ruler">
      <div className="ticks">{REGLE.map((_, k) => <i key={k} className={k < i ? "done" : k === i ? "cur" : ""} />)}</div>
      <span className="lbl"><b>{REGLE[i]}</b> · {i + 1} sur 5{suite ? ` · ${suite}` : ""}</span>
    </div>
  );
}

function Legende({ onFermer }: { onFermer: () => void }) {
  const [p, setP] = useState<Pont | null>(null);
  useEffect(() => { api().then(setP).catch(() => {}); }, []);
  return (
    <div className="captions" style={{ ["--cap-h" as string]: "40px" }}>
      <button type="button" aria-label="Réduire" title="Réduire" onClick={() => p?.fenetre("reduire")}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button type="button" className="fermer" aria-label="Fermer" title="Fermer" onClick={onFermer}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M.5.5l9 9M9.5.5l-9 9" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
    </div>
  );
}

function Barre({ titre, onFermer }: { titre: string; onFermer: () => void }) {
  return (
    <div className="inst-bar" data-tauri-drag-region>
      <Chouette taille={16} />
      <span data-tauri-drag-region>{titre}</span>
      <span className="grow" data-tauri-drag-region />
      <Legende onFermer={onFermer} />
    </div>
  );
}

// ---- Étapes réelles (installation et désinstallation) -----------------------------------------------------------

function classeEtape(e: Etat): string {
  return e === "termine" ? "done" : e === "ignore" ? "done is-ignore" : e === "echec" || e === "annule" ? "done is-erreur" : e === "enCours" ? "cur" : "todo";
}

function NoeudEtape({ e }: { e: Etat }) {
  if (e === "termine") return <Icone nom="check" taille={14} />;
  if (e === "echec" || e === "annule") return <b aria-hidden="true">!</b>;
  if (e === "ignore") return <b aria-hidden="true">–</b>;
  return null;
}

function IconeSous({ e }: { e: Etat }) {
  if (e === "termine") return <IconeEtat etat="ok" taille={14} />;
  if (e === "enCours") return <IconeEtat etat="running" taille={14} />;
  if (e === "echec" || e === "annule") return <IconeEtat etat="error" taille={14} />;
  if (e === "ignore") return <Icone nom="close" taille={14} />;
  return <Icone nom="clock" taille={14} />;
}

function Etapes({ etapes, prevues, octets }: { etapes: Etape[]; prevues?: string[][]; octets?: number }) {
  return (
    <div className="steps" aria-live="polite">
      {etapes.map((e, k) => {
        const detail = e.etat === "enCours" || e.etat === "echec" || e.etat === "annule";
        const restantes = e.etat === "enCours" ? (prevues?.[k] ?? []).filter((l) => !e.sous.some((s) => s.libelle.startsWith(l))) : [];
        const n = e.sous.length + restantes.length;
        const fini = e.sous.filter((s) => s.etat !== "enCours").length;
        return (
          <div key={e.cle} className={`stp ${classeEtape(e.etat)}`}>
            <div className="rail"><span className="node"><NoeudEtape e={e.etat} /></span></div>
            <div className="sbody">
              <div className="st">{e.titre}<span className="t">{e.etat === "enCours" ? `${fini} sur ${Math.max(n, 1)}` : e.etat === "attente" ? "" : secondes(e.dureeMs)}</span></div>
              {!detail && <div className="sd">{typo(e.etat === "termine" && e.resume ? e.resume : e.description)}</div>}
              {detail && (
                <div className="subs">
                  {e.sous.map((s, j) => (
                    <div key={j} className={`sub ${s.etat === "termine" ? "ok" : s.etat === "enCours" ? "run" : s.etat === "echec" || s.etat === "annule" ? "bad" : "wait"}`}>
                      <IconeSous e={s.etat} />
                      <div className="sub-texte">
                        <span>{typo(s.libelle)}{s.etat === "enCours" ? "…" : ""}</span>
                        {s.detail && s.etat !== "enCours" && <span className="sub-msg">{typo(s.detail)}</span>}
                      </div>
                      <span className="t">{s.etat === "enCours" ? "" : secondes(s.dureeMs)}</span>
                    </div>
                  ))}
                  {restantes.map((l) => (
                    <div key={l} className="sub wait"><Icone nom="clock" taille={14} /><div className="sub-texte"><span>{l}</span></div></div>
                  ))}
                  {e.etat === "enCours" && octets != null && e.total > 1_000_000 && (
                    <div className="octets" role="progressbar" aria-label="Octets écrits" aria-valuemin={0} aria-valuemax={e.total} aria-valuenow={e.fait}>
                      <i style={{ ["--p" as string]: Math.min(1, e.fait / e.total) }} />
                      <span>{taille(e.fait)} sur {taille(e.total)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Application ----------------------------------------------------------------------------------------------------

export function Setup() {
  const toast = useToast();
  const [pont, setPont] = useState<Pont | null>(null);
  const [init, setInit] = useState<EtatInitial | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ecran, setEcran] = useState<Ecran>("chargement");
  const [det, setDet] = useState<Detection | null>(null);
  const [cherche, setCherche] = useState(false);
  const [manuel, setManuel] = useState<string | null>(null);
  const [opts, setOpts] = useState<Options | null>(null);
  const [espace, setEspace] = useState<number | null>(null);
  const [operation, setOperation] = useState<Operation>("installer");
  const [action, setAction] = useState<Action>("reparer");
  const [av, setAv] = useState<Avancement | null>(null);
  const [annulation, setAnnulation] = useState(false);
  const [licence, setLicence] = useState(false);
  const [quitter, setQuitter] = useState(false);
  const [garder, setGarder] = useState(true);
  const [confirme, setConfirme] = useState(false);
  const [medias, setMedias] = useState<[number, number] | null>(null);
  // Extension navigateur (dossier géré) : gardée à la désinstallation, sauf si l'utilisateur coche la case.
  const [retirerNavigateur, setRetirerNavigateur] = useState(false);
  // Lancé par AETHRYON Desktop (« Mettre à jour », --mettre-a-jour) : la mise à jour part dès l'ouverture.
  const [majDirecte, setMajDirecte] = useState(false);

  useEffect(() => {
    let vivant = true;
    (async () => {
      try {
        const p = await api();
        const e = await p.etatInitial();
        if (!vivant) return;
        setPont(p);
        setInit(e);
        setDet(e.detection);
        setOpts(e.options);
        setAction(e.actions[0] ?? "desinstaller");
        setEcran(e.mode === "maintenance" ? (e.demande === "desinstaller" ? "confirmer" : "maintenance") : "bienvenue");
        if (e.mode === "maintenance" && e.demande === "mettreAJour" && e.actions.includes("mettreAJour")) setMajDirecte(true);
        // La fenêtre n'apparaît qu'après le premier rendu : jamais d'éclair blanc.
        requestAnimationFrame(() => requestAnimationFrame(() => p.pret().catch(() => {})));
      } catch (e) {
        setErreur(messageErreur(e));
        setEcran("erreur");
        api().then((p) => p.pret()).catch(() => {});
      }
    })();
    return () => { vivant = false; };
  }, []);

  useEffect(() => {
    if (!pont || !opts?.dossierMedias) return;
    pont.espaceLibre(opts.dossierMedias).then(setEspace).catch(() => setEspace(null));
  }, [pont, opts?.dossierMedias]);

  useEffect(() => {
    if (ecran !== "confirmer" || !pont || !opts) return;
    pont.inventaireMedias(opts.dossierMedias).then(setMedias).catch(() => setMedias(null));
  }, [ecran, pont, opts]);

  useEffect(() => {
    if (!majDirecte || !pont || !opts) return;
    setMajDirecte(false);
    void lancer("mettreAJour");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [majDirecte, pont, opts]);

  const enCours = (ecran === "installation" || ecran === "desinstallation") && !!av && !av.termine;
  const fermer = () => {
    if (enCours) setQuitter(true);
    else pont?.fenetre("fermer");
  };

  const detecter = async (exe: string | null = manuel) => {
    if (!pont) return;
    setCherche(true);
    try {
      setDet(await pont.detecter(exe));
    } catch (e) {
      toast({ etat: "erreur", titre: "Détection impossible", texte: messageErreur(e) });
    } finally {
      setCherche(false);
    }
  };

  const lancer = async (op: Operation) => {
    if (!pont || !opts) return;
    setOperation(op);
    setEcran("installation");
    setAv(null);
    setAnnulation(false);
    try {
      const fin = await pont.lancer(op, opts, setAv);
      setAv(fin);
      if (fin.succes) window.setTimeout(() => setEcran("termine"), mouvementReduit() ? 0 : 450);
    } catch (e) {
      toast({ etat: "erreur", titre: `${VERBES[op][0]} interrompue`, texte: messageErreur(e) });
    }
  };

  const desinstaller = async () => {
    if (!pont) return;
    setEcran("desinstallation");
    setAv(null);
    try {
      const fin = await pont.desinstaller(garder, !retirerNavigateur, setAv);
      setAv(fin);
      window.setTimeout(() => setEcran("desinstalle"), mouvementReduit() ? 0 : 450);
    } catch (e) {
      toast({ etat: "erreur", titre: "Désinstallation interrompue", texte: messageErreur(e) });
    }
  };

  const ouvrir = (quoi: "premiere" | "aethryon" | "journal" | "medias" | "navigateur") =>
    pont?.ouvrir(quoi).catch((e) => toast({ etat: "erreur", titre: "Ouverture impossible", texte: messageErreur(e) }));

  const titreFenetre =
    ecran === "maintenance" ? "Maintenance d'AETHRYON"
    : ecran === "confirmer" || ecran === "desinstallation" || ecran === "desinstalle" ? "Désinstallation d'AETHRYON"
    : operation === "reparer" ? "Réparation d'AETHRYON"
    : operation === "mettreAJour" ? "Mise à jour d'AETHRYON"
    : "Installation d'AETHRYON";
  const barre = <Barre titre={titreFenetre} onFermer={fermer} />;
  const dialogueQuitter = quitter && (
    <Dialogue titre="Arrêter maintenant ?" onFermer={() => setQuitter(false)} actions={<>
      <Bouton variante="ghost" onClick={() => setQuitter(false)}>Continuer</Bouton>
      <Bouton variante="danger" onClick={() => { setQuitter(false); setAnnulation(true); pont?.annuler(); }}>Arrêter et tout remettre en l'état</Bouton>
    </>}>
      <p>{typo("Ce qui a déjà été copié ou écrit sera retiré, et l'état d'avant sera rétabli. La fenêtre restera ouverte pour vous montrer le résultat.")}</p>
    </Dialogue>
  );

  if (ecran === "chargement") return <div className="inst" aria-busy="true" />;

  if (ecran === "erreur" || !init || !opts || !det) {
    return (
      <div className="inst">
        {barre}
        <div className="inst-body inst-body--centre">
          <Chouette taille={72} />
          <h1 className="t-display-l" style={{ marginTop: 28 }}>Le setup ne peut pas démarrer</h1>
          <p className="c2" style={{ marginTop: 10, maxWidth: 560 }}>{typo(erreur ?? "État inconnu.")}</p>
          <p className="t-small c3" style={{ marginTop: 14 }}>{typo("Rien n'a été installé ni modifié. Téléchargez de nouveau AETHRYON Setup, puis réessayez.")}</p>
        </div>
      </div>
    );
  }

  const premiere = det.principale;
  const charge = init.charge;
  const versionSetup = `AETHRYON ${charge.version}`;

  // ---- 1. Bienvenue ---------------------------------------------------------------------------------------------
  if (ecran === "bienvenue") {
    return (
      <div className="inst inst--halo">
        <div className="arch" />
        {barre}
        <div className="inst-body inst-body--centre">
          <div className="revele" style={{ animationDelay: "0ms" }}><Chouette taille={112} vivante /></div>
          <h1 className="t-display-xl revele" style={{ marginTop: 34, animationDelay: "120ms" }}>Bienvenue dans AETHRYON</h1>
          <p className="t-lead c2 revele" style={{ marginTop: 12, animationDelay: "220ms" }}>Vos médias. Votre espace de création.</p>
          <div className="revele" style={{ marginTop: 34, animationDelay: "320ms" }}>
            <Bouton variante="primary" taille="lg" className="btn--reflet" style={{ minWidth: 184 }} onClick={() => setEcran("detection")}>Commencer</Bouton>
          </div>
        </div>
        <div className="inst-foot inst-foot--bare">
          <span className="t-small c3">{versionSetup} · {det.windows ?? "Windows · 64 bits"}</span>
          <span className="grow" />
          <button type="button" className="link link--quiet t-small" onClick={() => setLicence(true)}>Licence et confidentialité</button>
        </div>
        {licence && (
          <Dialogue titre="Licence et confidentialité" large onFermer={() => setLicence(false)} actions={<Bouton variante="primary" onClick={() => setLicence(false)}>Fermer</Bouton>}>
            <p>{typo("AETHRYON Setup installe l'extension AETHRYON pour Premiere Pro et, si vous le choisissez, AETHRYON Desktop, dans votre profil Windows : aucun droit d'administrateur, aucun compte, aucun envoi de données. Le setup n'utilise pas le réseau.")}</p>
            <p className="t-small c2" style={{ marginTop: 10 }}>{typo("Bêta personnelle. Le setup n'est pas encore signé : Windows peut afficher un avertissement SmartScreen. L'extension est signée par un certificat auto-signé AETHRYON, horodaté.")}</p>
            <p className="t-small c3" style={{ marginTop: 10 }}>{typo("Composants tiers : Tauri (MIT ou Apache 2.0), React (MIT), Inter et Playfair Display (SIL Open Font License 1.1), WebView2 de Microsoft (fourni par Windows).")}</p>
          </Dialogue>
        )}
      </div>
    );
  }

  // ---- 2. Détection ---------------------------------------------------------------------------------------------
  if (ecran === "detection") {
    const introuvable = !premiere;
    const min = minimum(det.intervalleExtension);
    const titre = introuvable ? "Premiere Pro n'a pas été trouvé" : premiere.compatible === true ? "Premiere Pro est compatible" : premiere.compatible === false ? "Premiere Pro doit être mis à jour" : "Premiere Pro a été trouvé";
    const pPremiere = !premiere ? <Pastille etat="missing" libelle="Introuvable" /> : premiere.compatible === true ? <Pastille etat="ok" libelle="Compatible" /> : premiere.compatible === false ? <Pastille etat="error" libelle="Trop ancien" /> : <Pastille etat="warn" libelle="Version illisible" />;
    const requis = charge.tailleExtension + (charge.versionDesktop ? charge.tailleDesktop : 0);
    const ext = det.extensionEstLien ? <Pastille etat="warn" libelle="Lien de développement" /> : det.extensionPresente ? <Pastille etat="available" libelle={`Présente · ${det.extensionPresente}`} /> : <Pastille etat="available" libelle="À installer" />;
    return (
      <div className="inst">
        {barre}
        <div className="inst-body">
          <div className="step-head">
            <h1 className="t-display-l">{titre}</h1>
            <p>{typo(introuvable ? `AETHRYON a cherché Premiere Pro ${min} ou plus récent dans les dossiers d'Adobe et dans le registre de Windows, sans résultat.` : "AETHRYON a vérifié ce PC. Rien n'a encore été installé ni modifié.")}</p>
          </div>
          <div className="group det">
            <div className="row"><span className={`tile${premiere?.compatible ? " tile--gold" : ""}`}><Icone nom="picto-montage" taille={20} /></span>
              <div className="grow"><div className="rt">Adobe Premiere Pro {pPremiere}</div>
                <div className="rd">{premiere
                  ? <>{typo(`Version ${versionCourte(premiere.version) ?? "illisible"} · extension prise en charge à partir de ${min}${premiere.beta ? " · version bêta" : ""}${det.premiereOuvert ? " · ouvert : redémarrez-le après l'installation" : ""}`)}<br /><span className="mono">{premiere.dossier}</span></>
                  : typo(`L'extension AETHRYON a besoin de Premiere Pro ${min} ou plus récent.`)}</div>
              </div>
            </div>
            <div className="row"><span className="tile"><Icone nom="download" taille={18} /></span>
              <div className="grow"><div className="rt">Creative Cloud Desktop {det.creativeCloud ? <Pastille etat="ok" libelle="Présent" /> : <Pastille etat="quiet" libelle="Introuvable" />}</div>
                <div className="rd">{typo(introuvable ? (det.creativeCloud ? "Vous pouvez y installer ou mettre à jour Premiere Pro." : "Il permet d'installer Premiere Pro.") : "Pas nécessaire : l'extension s'installe directement dans votre profil.")}</div>
              </div>
            </div>
            {!introuvable && (
              <>
                <div className="row"><span className="tile"><Icone nom="shield" taille={18} /></span>
                  <div className="grow"><div className="rt">Extension AETHRYON {ext}</div>
                    <div className="rd">{typo(`Signée et horodatée · ${charge.versionExtension}${charge.extensionRemplacant ? " (provisoire)" : ""} · sans droits d'administrateur${det.playerDebugMode.length ? " · mode débogage CEP déjà activé sur ce PC, laissé tel quel" : ""}`)}<br /><span className="mono">{det.dossierExtensions}</span></div>
                  </div>
                </div>
                <div className="row"><span className="tile"><Icone nom="power" taille={18} /></span>
                  <div className="grow"><div className="rt">Composants AETHRYON <Pastille etat="available" libelle={det.ancienneBeta ? "À remplacer" : "À installer"} /></div>
                    <div className="rd">{typo([det.webview2 ? `WebView2 ${versionCourte(det.webview2)} présent` : "WebView2 introuvable", `${taille(requis)} requis`, det.espaceLibre != null ? `${taille(det.espaceLibre)} libres` : null, det.ancienneBeta ? `bêta ${det.ancienneBeta} (installateur NSIS) remplacée` : null].filter(Boolean).join(" · "))}</div>
                    {det.ancienneBeta && <div className="rd">{typo("Ancien plugin UXP « AETHRYON » : s'il apparaît encore dans Premiere Pro, retirez-le dans l'application Creative Cloud Desktop, parmi les plugins installés. Ce setup ne pilote pas Creative Cloud.")}</div>}
                  </div>
                </div>
              </>
            )}
          </div>
          {introuvable ? (
            <div className="choices">
              <div className="choice"><span className="num">1</span><div className="grow"><div className="ct">Installer ou mettre à jour Premiere Pro, puis relancer la recherche</div><div className="cd">Depuis Creative Cloud Desktop. Cette fenêtre peut rester ouverte.</div></div></div>
              <div className="choice"><span className="num">2</span><div className="grow"><div className="ct">Premiere Pro est installé dans un autre dossier</div><div className="cd">Indiquez le dossier qui contient Adobe Premiere Pro.exe.</div></div>
                <Bouton taille="sm" onClick={async () => { const d = await pont?.choisirPremiere(); if (d) { setManuel(d); await detecter(d); } }}>Indiquer le dossier…</Bouton></div>
              <div className="choice"><span className="num">3</span><div className="grow"><div className="ct">Continuer sans Premiere Pro</div><div className="cd">{typo("L'extension sera prête dès que Premiere Pro sera installé ; AETHRYON Desktop fonctionne seul.")}</div></div></div>
            </div>
          ) : (
            <div className="det-note"><Icone nom="check" taille={16} />Analyse terminée en {secondes(det.dureeMs)}<span style={{ color: "var(--line-3)" }}>·</span>
              <button type="button" className="link link--quiet" disabled={cherche} onClick={() => detecter()}>{cherche ? "Recherche…" : "Rechercher à nouveau"}</button></div>
          )}
        </div>
        <div className="inst-foot">
          <Regle i={1} />
          <span className="grow" />
          <Bouton variante="ghost" onClick={() => setEcran("bienvenue")}>Retour</Bouton>
          {introuvable ? (
            <>
              <Bouton onClick={() => setEcran("configuration")}>Continuer sans Premiere Pro</Bouton>
              <Bouton variante="primary" icone="retry" disabled={cherche} onClick={() => detecter()}>{cherche ? "Recherche…" : "Rechercher à nouveau"}</Bouton>
            </>
          ) : (
            <Bouton variante="primary" style={{ minWidth: 120 }} onClick={() => setEcran("configuration")}>Continuer</Bouton>
          )}
        </div>
      </div>
    );
  }

  // ---- 3. Configuration -----------------------------------------------------------------------------------------
  if (ecran === "configuration") {
    const sansDesktop = !opts.desktop;
    const raison = sansDesktop ? "Nécessite AETHRYON Desktop." : undefined;
    const notif: Record<Notifications, string> = { toutes: "Toutes : médias prêts, imports réussis et erreurs.", importantes: "Importantes : médias prêts et erreurs.", aucune: "Aucune notification Windows." };
    const pale = sansDesktop ? { color: "var(--text-2)" } : undefined;
    return (
      <div className="inst">
        {barre}
        <div className="inst-body">
          <div className="step-head"><h1 className="t-display-l">Configuration</h1><p>Tout reste modifiable ensuite, dans Paramètres.</p></div>
          <div className="group-title" style={{ marginTop: 22 }}>Dossier des médias</div>
          <div className="folder">
            <span className="tile tile--gold" style={{ width: 36, height: 36 }}><Icone nom="folder" taille={20} /></span>
            <div style={{ flex: 1, minWidth: 0 }}><div className="ff">{dossierAmical(opts.dossierMedias)}</div><div className="fp mono ellipsis" title={opts.dossierMedias}>{opts.dossierMedias}</div></div>
            {espace != null && <span className="t-small c3" style={{ marginRight: 6 }}>{taille(espace)} libres</span>}
            <Bouton taille="sm" onClick={async () => { const d = await pont?.choisirDossier(); if (d) setOpts({ ...opts, dossierMedias: d }); }}>Modifier…</Bouton>
          </div>
          <div className="group-title" style={{ marginTop: 18 }}>Composants et options</div>
          <div className="group">
            <div className="row"><div className="grow"><div className="rt">Installer AETHRYON Desktop</div><div className="rd">{typo(charge.versionDesktop ? `Bibliothèque, aperçu et transferts · ${taille(charge.tailleDesktop)}. L'extension Premiere Pro est installée dans tous les cas.` : "Absent de ce setup.")}</div></div>
              <Interrupteur libelle="Installer AETHRYON Desktop" actif={opts.desktop} disabled={!charge.versionDesktop} onChange={(v) => setOpts({ ...opts, desktop: v })} /></div>
            <div className="row"><div className="grow"><div className="rt" style={pale}>Surveiller le dossier des médias</div><div className="rd">Les fichiers déposés apparaissent dans AETHRYON et dans Premiere Pro.</div></div>
              <Interrupteur libelle="Surveiller le dossier des médias" actif={opts.surveillance && !sansDesktop} disabled={sansDesktop} raison={raison} onChange={(v) => setOpts({ ...opts, surveillance: v })} /></div>
            <div className="row"><div className="grow"><div className="rt" style={pale}>Lancer AETHRYON au démarrage de Windows</div><div className="rd">Discret, dans la zone de notification.</div></div>
              <Interrupteur libelle="Lancer AETHRYON au démarrage de Windows" actif={opts.demarrageAuto && !sansDesktop} disabled={sansDesktop} raison={raison} onChange={(v) => setOpts({ ...opts, demarrageAuto: v })} /></div>
            <div className="row"><div className="grow"><div className="rt" style={pale}>Notifications</div><div className="rd">{notif[opts.notifications]}</div></div>
              <Segmente<Notifications> libelle="Notifications" valeur={opts.notifications} onChange={(v) => setOpts({ ...opts, notifications: v })}
                options={[{ id: "toutes", libelle: "Toutes" }, { id: "importantes", libelle: "Importantes" }, { id: "aucune", libelle: "Aucune" }]} /></div>
          </div>
        </div>
        <div className="inst-foot">
          <Regle i={2} />
          <span className="grow" />
          <Bouton variante="ghost" onClick={() => setEcran("detection")}>Retour</Bouton>
          <Bouton variante="primary" style={{ minWidth: 120 }} onClick={() => lancer("installer")}>Installer</Bouton>
        </div>
      </div>
    );
  }

  // ---- 4. Installation (et réparation, mise à jour) -------------------------------------------------------------
  if (ecran === "installation") {
    const [Nom, nom] = VERBES[operation];
    const fini = !!av?.termine;
    const echec = fini && !av!.succes;
    const restaure = av?.retourArriere ?? [];
    const rateRestaure = restaure.filter((r) => r.startsWith("ÉCHEC"));
    const etapes: Etape[] = av?.etapes ?? ["Vérification", "Installation", "Enregistrement des composants", "Configuration", "Validation"].map((t, i) => ({ cle: String(i), titre: t, description: "", etat: "attente", sous: [], fait: 0, total: 0, dureeMs: null, resume: null }));
    return (
      <div className="inst">
        {barre}
        <div className="inst-body" style={{ paddingTop: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Chouette taille={56} traitement={!fini} />
            <div className="step-head">
              <h1 className="t-display-l" style={{ marginBottom: 4 }}>{echec ? (av!.annule ? `${Nom} annulée` : `${Nom} interrompue`) : fini ? `${Nom} terminée` : `${Nom} en cours`}</h1>
              <p>{typo(echec ? (av!.erreur ?? "Une étape a échoué.") : "Chaque ligne est une opération réelle, mesurée sur ce PC.")}</p>
            </div>
          </div>
          {echec && (
            <div className={`retour${rateRestaure.length ? " retour--partiel" : ""}`} role="status">
              <IconeEtat etat={rateRestaure.length ? "warn" : "ok"} taille={14} />
              <span>{typo(rateRestaure.length
                ? `Retour arrière incomplet : ${rateRestaure.length} élément(s) à vérifier (voir le journal).`
                : `Retour arrière fait : ${restaure.length} opération(s) défaite(s), ce PC est revenu à l'état d'avant la ${nom}.`)}</span>
            </div>
          )}
          <Etapes etapes={etapes} prevues={PREVUES} octets={1} />
        </div>
        <div className="inst-foot">
          <Regle i={3} suite={ecoule(av?.ecouleMs ?? 0)} />
          <span className="grow" />
          <Bouton variante="ghost" icone="log" onClick={() => ouvrir("journal")}>Afficher le journal</Bouton>
          {echec ? (
            <>
              <Bouton onClick={() => setEcran(init.mode === "maintenance" ? "maintenance" : "configuration")}>Retour</Bouton>
              <Bouton variante="primary" icone="retry" onClick={() => lancer(operation)}>Réessayer</Bouton>
            </>
          ) : (
            <Bouton disabled={fini || annulation} onClick={() => { setAnnulation(true); pont?.annuler(); }}>{annulation ? "Annulation…" : "Annuler"}</Bouton>
          )}
        </div>
        {dialogueQuitter}
      </div>
    );
  }

  // ---- 5. Terminé -----------------------------------------------------------------------------------------------
  if (ecran === "termine" && av?.resultat) {
    return <Termine av={av} det={det} operation={operation} barre={barre} ouvrir={ouvrir} />;
  }

  // ---- Maintenance : Réparer, Mettre à jour, Désinstaller --------------------------------------------------------
  if (ecran === "maintenance") {
    const inst = det.installation;
    const inv = inst?.inventaire;
    const quand = dateFr(inv?.installeLe);
    const plusRecente = init.actions.length === 1;
    const cartes: { id: Action; titre: string; texte: string; icone: "repair" | "update" | "trash" }[] = [];
    if (init.actions.includes("reparer")) cartes.push({ id: "reparer", titre: "Réparer", icone: "repair", texte: "Revérifie chaque fichier et l'extension signée, puis réécrit les réglages Windows. Vos médias et vos préférences restent." });
    if (init.actions.includes("mettreAJour")) cartes.push({ id: "mettreAJour", titre: `Mettre à jour vers ${charge.version}`, icone: "update", texte: `Remplace la version ${inst?.version ?? ""} installée. Vos médias et vos préférences restent.` });
    cartes.push({ id: "desinstaller", titre: "Désinstaller", icone: "trash", texte: "Retire AETHRYON de ce PC. Vous choisirez ensuite de garder ou non vos médias." });
    const valider = () => {
      if (action === "desinstaller") { setGarder(true); setConfirme(false); setEcran("confirmer"); return; }
      lancer(action === "mettreAJour" ? "mettreAJour" : "reparer");
    };
    return (
      <div className="inst">
        {barre}
        <div className="inst-body" style={{ paddingTop: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Chouette taille={56} vivante />
            <div className="step-head">
              <h1 className="t-display-l" style={{ marginBottom: 4 }}>AETHRYON est déjà installé</h1>
              <p>{typo(`Version ${inst?.version ?? "inconnue"}${quand ? `, installée le ${quand}` : ""}${plusRecente ? `. Elle est plus récente que ce setup (${charge.version}) : il ne peut que la désinstaller.` : "."}`)}</p>
            </div>
          </div>
          <div className="group det" style={{ marginTop: 18 }}>
            <div className="row"><span className="tile tile--gold"><Icone nom="picto-montage" taille={20} /></span>
              <div className="grow"><div className="rt">Extension Premiere Pro {inv?.versionExtension ? <Pastille etat="ok" libelle={`Installée · ${inv.versionExtension}`} /> : <Pastille etat="missing" libelle="Absente" />}</div>
                <div className="rd"><span className="mono">{inv?.dossierExtension ?? det.dossierExtensions}</span></div></div></div>
            <div className="row"><span className="tile"><Icone nom="power" taille={18} /></span>
              <div className="grow"><div className="rt">AETHRYON Desktop {inv?.versionDesktop ? <Pastille etat="ok" libelle={`Installé · ${inv.versionDesktop}`} /> : <Pastille etat="quiet" libelle="Non installé" />}</div>
                <div className="rd">{typo(`Dossier des médias : ${dossierAmical(opts.dossierMedias)}`)}</div></div></div>
          </div>
          <div className="choices" role="radiogroup" aria-label="Que voulez-vous faire ?">
            {cartes.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={action === c.id} className={`choice choice--action${action === c.id ? " is-choisi" : ""}${c.id === "desinstaller" ? " choice--danger" : ""}`} onClick={() => setAction(c.id)}>
                <span className="tile"><Icone nom={c.icone} taille={18} /></span>
                <div className="grow"><div className="ct">{c.titre}</div><div className="cd">{typo(c.texte)}</div></div>
                <span className="radio" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
        <div className="inst-foot">
          <span className="t-small c3">Ce setup : {versionSetup}</span>
          <span className="grow" />
          <Bouton variante="ghost" onClick={() => pont?.fenetre("fermer")}>Fermer</Bouton>
          <Bouton variante={action === "desinstaller" ? "danger" : "primary"} style={{ minWidth: 132 }} onClick={valider}>
            {action === "reparer" ? "Réparer" : action === "mettreAJour" ? "Mettre à jour" : "Désinstaller…"}
          </Bouton>
        </div>
      </div>
    );
  }

  // ---- Désinstallation : confirmation -------------------------------------------------------------------------------
  if (ecran === "confirmer") {
    const dossier = det.installation?.inventaire?.options.dossierMedias ?? opts.dossierMedias;
    const n = medias?.[0] ?? null;
    const t = medias?.[1] ?? null;
    const compte = n == null ? "" : n === 0 ? "vide" : `${n} fichier${n > 1 ? "s" : ""}, ${taille(t ?? 0)}`;
    return (
      <div className="inst">
        {barre}
        <div className="inst-body">
          <div className="step-head">
            <h1 className="t-display-l">Désinstaller AETHRYON ?</h1>
            <p>{typo("L'extension Premiere Pro, AETHRYON Desktop, le raccourci, le démarrage avec Windows et les préférences seront retirés. Le journal reste dans votre profil, pour mémoire.")}</p>
          </div>
          <div className="group-title" style={{ marginTop: 22 }}>Vos médias · {dossierAmical(dossier)}{compte ? ` · ${compte}` : ""}</div>
          <div className="choices" role="radiogroup" aria-label="Vos médias" style={{ marginTop: 8 }}>
            <button type="button" role="radio" aria-checked={garder} className={`choice choice--action${garder ? " is-choisi" : ""}`} onClick={() => { setGarder(true); setConfirme(false); }}>
              <span className="tile tile--gold"><Icone nom="folder" taille={18} /></span>
              <div className="grow"><div className="ct">Garder mes médias</div><div className="cd">{typo("Le dossier reste tel quel, avec tous ses fichiers.")}<br /><span className="mono">{dossier}</span></div></div>
              <span className="radio" aria-hidden="true" />
            </button>
            <button type="button" role="radio" aria-checked={!garder} className={`choice choice--action choice--danger${!garder ? " is-choisi" : ""}`} onClick={() => setGarder(false)}>
              <span className="tile"><Icone nom="trash" taille={18} /></span>
              <div className="grow"><div className="ct">Supprimer aussi mes médias</div><div className="cd">{typo(n ? `Les ${compte} de ce dossier seront supprimés définitivement, sans passer par la corbeille.` : "Le dossier des médias sera supprimé.")}</div></div>
              <span className="radio" aria-hidden="true" />
            </button>
          </div>
          {!garder && (
            <label className="confirmation">
              <input type="checkbox" checked={confirme} onChange={(e) => setConfirme(e.target.checked)} />
              <span>{typo("Je confirme la suppression définitive de mes médias.")}</span>
            </label>
          )}
          <label className="confirmation">
            <input type="checkbox" checked={retirerNavigateur} onChange={(e) => setRetirerNavigateur(e.target.checked)} />
            <span>{typo("Retirer aussi l'extension navigateur (dossier AETHRYON\\extension). Sans cette case, elle reste : Chrome peut toujours la charger.")}</span>
          </label>
        </div>
        <div className="inst-foot">
          <span className="t-small c3">{typo("Rien n'est retiré avant votre confirmation.")}</span>
          <span className="grow" />
          <Bouton variante="ghost" onClick={() => (init.demande === "desinstaller" ? pont?.fenetre("fermer") : setEcran("maintenance"))}>{init.demande === "desinstaller" ? "Annuler" : "Retour"}</Bouton>
          <Bouton variante="danger" style={{ minWidth: 132 }} disabled={!garder && !confirme} onClick={desinstaller}>Désinstaller</Bouton>
        </div>
      </div>
    );
  }

  // ---- Désinstallation : progression, puis fin --------------------------------------------------------------------
  if (ecran === "desinstallation" || (ecran === "desinstalle" && av)) {
    const fini = ecran === "desinstalle";
    const r = av?.resultat;
    const restes = r?.avertissements ?? [];
    if (fini && r) {
      return (
        <div className="inst inst--halo">
          {barre}
          <div className="inst-body inst-body--centre" style={{ paddingTop: 84 }}>
            <Chouette taille={88} />
            <h1 className="t-display-xl revele" style={{ marginTop: 30 }}>{restes.length ? "AETHRYON est presque désinstallé." : "AETHRYON a été désinstallé."}</h1>
            <div className="facts revele" style={{ animationDelay: "80ms" }}>
              <div><div className="fl">Version retirée</div><div className="fv">AETHRYON {r.version}</div></div>
              <div><div className="fl">Vos médias</div><div className="fv">{garder ? `Gardés · ${dossierAmical(r.dossierMedias)}` : "Supprimés"}</div></div>
              <div><div className="fl">Extension navigateur</div><div className="fv">{retirerNavigateur ? "Retirée" : "Gardée"}</div></div>
              <div><div className="fl">Restes</div><div className="fv">{restes.length ? `${restes.length} élément(s) verrouillé(s)` : "Aucun"}</div></div>
            </div>
            {restes.length > 0 && <p className="t-small c2" style={{ marginTop: 18, maxWidth: 600 }}>{typo(restes.join(" ; "))}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 30 }}>
              {garder && <Bouton taille="lg" icone="folder" onClick={() => ouvrir("medias")}>Ouvrir mes médias</Bouton>}
              <Bouton variante="primary" taille="lg" style={{ minWidth: 140 }} onClick={() => pont?.fenetre("fermer")}>Fermer</Bouton>
            </div>
          </div>
          <div className="inst-foot inst-foot--bare">
            <span className="t-small c3">{typo("Le journal de la désinstallation reste dans %LOCALAPPDATA%\\AETHRYON\\journaux.")}</span>
          </div>
        </div>
      );
    }
    return (
      <div className="inst">
        {barre}
        <div className="inst-body" style={{ paddingTop: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Chouette taille={56} traitement />
            <div className="step-head"><h1 className="t-display-l" style={{ marginBottom: 4 }}>Désinstallation en cours</h1><p>{typo(garder ? "Vos médias sont gardés." : "Vos médias seront supprimés.")}</p></div>
          </div>
          <Etapes etapes={av?.etapes ?? []} />
        </div>
        <div className="inst-foot">
          <span className="t-small c3">{ecoule(av?.ecouleMs ?? 0)}</span>
          <span className="grow" />
          <Bouton variante="ghost" icone="log" onClick={() => ouvrir("journal")}>Afficher le journal</Bouton>
        </div>
        {dialogueQuitter}
      </div>
    );
  }

  return <div className="inst" />;
}

/** Chargement unique de l'extension navigateur depuis son dossier géré : le setup ne peut pas piloter Chrome. */
function ExtensionNavigateur({ version, dossier, ouvrir }: { version: string; dossier: string; ouvrir: () => void }) {
  const [copie, setCopie] = useState<string | null>(null);
  const copier = (t: string) => navigator.clipboard?.writeText(t).then(() => setCopie(t), () => setCopie(null));
  return (
    <div className="nav-ext monte" style={{ ["--d" as string]: "940ms" }} data-navigateur={version}>
      <div className="nav-ext-titre">{typo(`Extension navigateur ${version} : à charger une seule fois`)}</div>
      <ol className="nav-ext-pas">
        <li>{typo("Dans Chrome, Edge ou Brave, ouvrez ")}<button type="button" className="mono lien" onClick={() => copier("chrome://extensions")}>chrome://extensions</button>{typo(copie === "chrome://extensions" ? " (copié : collez-le dans la barre d'adresse)." : " (cliquez pour copier).")}</li>
        <li>{typo("Activez « Mode développeur », puis « Charger l'extension non empaquetée ».")}</li>
        <li>{typo("Choisissez ce dossier : ")}<button type="button" className="mono lien" onClick={() => copier(dossier)} title="Copier le chemin">{dossier}</button>{copie === dossier ? typo(" (copié)") : ""}</li>
      </ol>
      <p className="t-small c3">{typo("Ensuite, « Mettre à jour » dans l'extension passe par AETHRYON Desktop : plus aucun ZIP à télécharger.")} <button type="button" className="lien" onClick={ouvrir}>Ouvrir le dossier</button></p>
    </div>
  );
}

function Termine({ av, det, operation, barre, ouvrir }: { av: Avancement; det: Detection; operation: Operation; barre: ReactNode; ouvrir: (q: "premiere" | "aethryon" | "journal" | "medias" | "navigateur") => void }) {
  const r = av.resultat!;
  const [clin, setClin] = useState(0);
  const anime = useRef(!mouvementReduit());
  useEffect(() => {
    if (!anime.current) return;
    const t = window.setTimeout(() => setClin(1), 650);
    return () => window.clearTimeout(t);
  }, []);
  const p = det.principale;
  const relie = !!r.versionExtension && p?.compatible === true;
  const titre = operation === "reparer" ? "AETHRYON est réparé." : operation === "mettreAJour" ? "AETHRYON est à jour." : "AETHRYON est prêt.";
  const note = useMemo(() => {
    const l: string[] = [];
    if (r.versionExtension) l.push("Dans Premiere Pro : menu Fenêtre › Extensions › AETHRYON.");
    if (r.premiereOuvert) l.push("Premiere Pro était ouvert : redémarrez-le pour charger l'extension.");
    else if (!p) l.push("L'extension apparaîtra dès que Premiere Pro sera installé.");
    if (r.ancienneBetaRemplacee) l.push(`Bêta ${r.ancienneBetaRemplacee} remplacée. Si l'ancien plugin UXP « AETHRYON » apparaît encore dans Premiere Pro, retirez-le dans l'application Creative Cloud Desktop, parmi les plugins installés.`);
    return l.join(" ");
  }, [r, p]);
  return (
    <div className={`inst inst--halo inst--fin${anime.current ? " anime" : ""}`}>
      {barre}
      <div className="inst-body" style={{ padding: "58px 80px 0", textAlign: "center" }}>
        <div className="liaison">
          <span className="end"><Chouette taille={72} clin={clin} /><span className="cap">{r.versionDesktop ? "AETHRYON Desktop" : "AETHRYON"}</span></span>
          <div className="mid"><div className="fil-trace"><Fil relie={relie} /></div><span className={`seal${relie ? "" : " seal--attente"}`}>{relie ? <Icone nom="check" taille={18} /> : <b>!</b>}</span></div>
          <span className="end end--app"><Icone nom="picto-montage" taille={34} /><span className="cap">{p ? `Premiere Pro ${versionCourte(p.version) ?? ""}` : "Premiere Pro"}</span></span>
        </div>
        <h1 className="t-display-xl monte" style={{ marginTop: 52, ["--d" as string]: "700ms" }}>{titre}</h1>
        <div className="facts monte" style={{ ["--d" as string]: "760ms" }}>
          <div><div className="fl">Version installée</div><div className="fv">AETHRYON {r.version}</div></div>
          <div><div className="fl">Extension Premiere Pro</div><div className="fv" style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
            {r.versionExtension ? <><span style={{ color: "var(--state-ok)", display: "inline-flex" }}><IconeEtat etat="ok" taille={13} /></span>Extension {r.versionExtension}{r.extensionRemplacant ? " (provisoire)" : ""} installée</> : "Non installée"}
          </div></div>
          <div><div className="fl">Dossier configuré</div><div className="fv">{dossierAmical(r.dossierMedias)}</div></div>
        </div>
        <div className="monte" style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 30, ["--d" as string]: "820ms" }}>
          {r.versionDesktop && <Bouton variante="primary" taille="lg" onClick={() => ouvrir("aethryon")}>Ouvrir AETHRYON</Bouton>}
          {p && <Bouton variante={r.versionDesktop ? "secondary" : "primary"} taille="lg" onClick={() => ouvrir("premiere")}>Ouvrir Premiere Pro</Bouton>}
        </div>
        <p className="t-small c3 monte" style={{ marginTop: 18, ["--d" as string]: "880ms" }}>{typo(note)}</p>
        {r.versionNavigateur && r.dossierNavigateur && <ExtensionNavigateur version={r.versionNavigateur} dossier={r.dossierNavigateur} ouvrir={() => ouvrir("navigateur")} />}
      </div>
      <div className="inst-foot inst-foot--bare">
        <span className="t-small c3">{typo("Réparer ou désinstaller : Paramètres Windows › Applications › AETHRYON › Modifier, ou relancez ce setup.")}</span>
      </div>
    </div>
  );
}
