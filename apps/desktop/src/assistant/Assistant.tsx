// Parcours d'installation et de réparation (brief §3) : Bienvenue → Détection → Configuration → Installation →
// Terminé. Chaque étape de l'écran « Installation » est une opération RÉELLE du cœur Rust (assistant.rs), avec sa
// durée réelle ; la progression vient de l'événement `assistant-progression`. Aucune barre factice, aucune
// compatibilité supposée : seule la version lue dans l'exe de Premiere compte.
import { useEffect, useRef, useState } from "react";
import { api, evenements, messageErreur } from "../lib/api";
import { dossierAmical, taille, typo } from "../lib/format";
import { versionCourte } from "../lib/liaison";
import type { Diagnostic, Etape, EtatEtape, Instantane, OptionsAssistant, Rapport } from "../lib/types";
import { Bouton, Fil, Icone, IconeEtat, Interrupteur, Pastille, Segmente } from "../ui/base";
import { Chouette } from "../ui/marque";
import { Dialogue, useToast } from "../ui/superpositions";
import { BoutonsLegende } from "../shell/Fenetre";
import { LICENCES } from "../lib/licences";
import { mouvementReduit } from "../lib/mouvement";
import { BoutonReparerSetup } from "../ui/ReparerSetup";

type Ecran = "bienvenue" | "detection" | "configuration" | "installation" | "termine";
const ETAPES_REGLE = ["Bienvenue", "Détection", "Configuration", "Installation", "Terminé"];
/** Opérations prévues de chaque étape (assistant.rs) : affichées « à venir » tant qu'elles n'ont pas commencé. */
const PREVUES: string[][] = [
  ["Adobe Premiere Pro", "Creative Cloud Desktop", "Panneau AETHRYON", "Dossier des médias"],
  ["AETHRYON Desktop", "Panneau Premiere Pro (AETHRYON Setup)"],
  ["Liaison navigateur (Native Messaging) : Chrome, Edge, Brave", "Démarrage avec Windows", "Désinstallation dans Paramètres Windows"],
  ["Préférences", "Bibliothèque et échanges avec le panneau"],
  ["Panneau AETHRYON relu", "Fichiers", "Clés du registre"],
];

function Regle({ i, suite }: { i: number; suite?: string }) {
  return (
    <div className="ruler">
      <div className="ticks">{ETAPES_REGLE.map((_, k) => <i key={k} className={k < i ? "done" : k === i ? "cur" : ""} />)}</div>
      <span className="lbl"><b>{ETAPES_REGLE[i]}</b> · {i + 1} sur 5{suite ? ` · ${suite}` : ""}</span>
    </div>
  );
}

function secondes(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

function ecoule(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} écoulées`;
}

function useWindows(): string {
  const [v, setV] = useState("Windows");
  useEffect(() => {
    const uad = (navigator as unknown as { userAgentData?: { getHighEntropyValues?: (h: string[]) => Promise<{ platform?: string; platformVersion?: string }> } }).userAgentData;
    uad?.getHighEntropyValues?.(["platformVersion"]).then((r) => {
      if (r.platform !== "Windows") return;
      const majeur = Number((r.platformVersion ?? "0").split(".")[0]);
      setV(majeur >= 13 ? "Windows 11" : majeur > 0 ? "Windows 10" : "Windows");
    }).catch(() => {});
  }, []);
  return v;
}

export function Assistant({ inst, reparation, onTerminer }: { inst: Instantane; reparation: boolean; onTerminer: () => void }) {
  const toast = useToast();
  const windows = useWindows();
  const [ecran, setEcran] = useState<Ecran>(reparation ? "detection" : "bienvenue");
  const [diag, setDiag] = useState<Diagnostic | null>(null);
  const [cherche, setCherche] = useState(false);
  const [manuel, setManuel] = useState<string | null>(null);
  const [sansPanneau, setSansPanneau] = useState(false);
  const [opts, setOpts] = useState<OptionsAssistant>({
    dossierMedias: inst.config.dossierMedias,
    surveillance: inst.config.surveillance,
    demarrageAuto: reparation ? inst.config.demarrageAuto : true,
    installerPanneau: true,
    notifications: inst.config.notifications.importReussi ? "toutes" : !inst.config.notifications.mediaPret && !inst.config.notifications.erreurs ? "aucune" : "importantes",
  });
  const [etapes, setEtapes] = useState<Etape[]>([]);
  const [rapport, setRapport] = useState<Rapport | null>(null);
  const [debut, setDebut] = useState(0);
  const [maintenant, setMaintenant] = useState(Date.now());
  const [annulation, setAnnulation] = useState(false);
  const [licence, setLicence] = useState(false);
  const [espace, setEspace] = useState<number | null>(null);
  const [webview, setWebview] = useState<string | null>(null);

  const detecter = async (exe: string | null = manuel) => {
    setCherche(true);
    try {
      const d = await api.diagnostic(exe);
      setDiag(d);
      setEspace(d.espaceLibre);
    } catch (e) {
      toast({ etat: "erreur", titre: "Détection impossible", texte: messageErreur(e) });
    } finally {
      setCherche(false);
    }
  };

  useEffect(() => {
    api.webview2().then(setWebview).catch(() => {});
    const fin = evenements.assistant((e) => setEtapes(e));
    return () => { fin.then((u) => u()).catch(() => {}); };
  }, []);

  useEffect(() => {
    if (ecran === "detection" && !diag && !cherche) detecter();
  }, [ecran]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ecran !== "installation" || rapport) return;
    const t = window.setInterval(() => setMaintenant(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [ecran, rapport]);

  const premiere = diag?.premiere.principale ?? null;
  // Le panneau (extension CEP) est posé par AETHRYON Setup : l'assistant le vérifie ; absent, il propose « Réparer avec AETHRYON Setup ».
  const panneauPossible = !!premiere && premiere.compatible !== false && !sansPanneau;
  const reparer = reparation ? "Réparation" : "Installation";

  const installer = async () => {
    setEcran("installation");
    setEtapes([]);
    setRapport(null);
    setAnnulation(false);
    setDebut(Date.now());
    setMaintenant(Date.now());
    try {
      const r = await api.assistantExecuter({ ...opts, installerPanneau: opts.installerPanneau && panneauPossible }, manuel);
      setRapport(r);
      setEtapes(r.etapes);
      if (r.annule) {
        toast({ etat: "info", titre: `${reparer} annulée`, texte: "Les opérations déjà faites restent en place ; « Réparer » les reprend." });
        setEcran("configuration");
      } else if (r.reussi) {
        window.setTimeout(() => setEcran("termine"), mouvementReduit() ? 0 : 450);
      }
    } catch (e) {
      toast({ etat: "erreur", titre: `${reparer} interrompue`, texte: messageErreur(e) });
    }
  };

  const changerDossier = async () => {
    try {
      const d = await api.choisirDossier("Dossier des médias AETHRYON");
      if (d) setOpts((o) => ({ ...o, dossierMedias: d }));
    } catch (e) {
      toast({ etat: "erreur", titre: "Sélection impossible", texte: messageErreur(e) });
    }
  };

  const indiquerPremiere = async () => {
    try {
      const exe = await api.choisirPremiere();
      if (exe) {
        setManuel(exe);
        await detecter(exe);
      }
    } catch (e) {
      toast({ etat: "erreur", titre: "Dossier refusé", texte: messageErreur(e) });
    }
  };

  const terminer = async () => {
    try {
      await api.assistantFin();
    } catch { /* l'état sera relu par l'application */ }
    await api.modeFenetre("app").catch(() => {});
    onTerminer();
  };

  const barre = (
    <div className="inst-bar" data-tauri-drag-region>
      <Chouette taille={16} />
      <span data-tauri-drag-region>{reparation ? "Réparation d'AETHRYON" : "Installation d'AETHRYON"}</span>
      <span className="grow" data-tauri-drag-region />
      <BoutonsLegende hauteur={40} sansAgrandir />
    </div>
  );

  // ---- 1. Bienvenue -------------------------------------------------------------------------------------------------
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
          <span className="t-small c3">AETHRYON Desktop {inst.version} · {windows} · 64 bits</span>
          <span className="grow" />
          <button type="button" className="link link--quiet t-small" onClick={() => setLicence(true)}>Licence et confidentialité</button>
        </div>
        {licence && (
          <Dialogue titre="Licence et confidentialité" large onFermer={() => setLicence(false)} actions={<Bouton variante="primary" onClick={() => setLicence(false)}>Fermer</Bouton>}>
            <p>{typo("AETHRYON Desktop travaille sur ce PC : aucun compte, aucun envoi de données. Les journaux restent dans votre profil Windows, sans secret. Le panneau Premiere Pro et AETHRYON Desktop échangent par des fichiers locaux, sans port réseau.")}</p>
            <p className="t-small c2" style={{ marginTop: 10 }}>{typo("Version bêta personnelle, non signée : Windows peut afficher un avertissement SmartScreen à l'ouverture de l'installateur.")}</p>
            <dl className="licences" style={{ marginTop: 14 }}>{LICENCES.map(([n, l]) => <div key={n}><dt>{n}</dt><dd>{typo(l)}</dd></div>)}</dl>
          </Dialogue>
        )}
      </div>
    );
  }

  // ---- 2. Détection -------------------------------------------------------------------------------------------------
  if (ecran === "detection") {
    const introuvable = diag && !premiere;
    const titre = !diag ? "Recherche de Premiere Pro…" : introuvable ? "Premiere Pro n'a pas été trouvé" : premiere!.compatible === true ? "Premiere Pro est compatible" : premiere!.compatible === false ? "Premiere Pro doit être mis à jour" : "Premiere Pro a été trouvé";
    const pPremiere = !premiere ? <Pastille etat="missing" libelle="Introuvable" /> : premiere.compatible === true ? <Pastille etat="ok" libelle="Compatible" /> : premiere.compatible === false ? <Pastille etat="error" libelle="Trop ancien" /> : <Pastille etat="warn" libelle="Version illisible" />;
    const cc = diag?.creativeCloud.upia;
    const glisser = premiere?.glisser === true;
    const pied = (
      <div className="inst-foot">
        <Regle i={1} />
        <span className="grow" />
        <Bouton variante="ghost" onClick={() => (reparation ? terminer() : setEcran("bienvenue"))}>{reparation ? "Annuler" : "Retour"}</Bouton>
        {introuvable ? (
          <>
            <Bouton onClick={() => { setSansPanneau(true); setEcran("configuration"); }}>Continuer sans le panneau</Bouton>
            <Bouton variante="primary" icone="retry" disabled={cherche} onClick={() => detecter()}>{cherche ? "Recherche…" : "Rechercher à nouveau"}</Bouton>
          </>
        ) : (
          <Bouton variante="primary" style={{ minWidth: 120 }} disabled={!diag} onClick={() => { setSansPanneau(premiere?.compatible === false); setEcran("configuration"); }}>Continuer</Bouton>
        )}
      </div>
    );
    return (
      <div className="inst">
        {barre}
        <div className="inst-body">
          <div className="step-head">
            <h1 className="t-display-l">{titre}</h1>
            <p>{typo(introuvable ? (diag!.plateforme === "windows" ? "AETHRYON a cherché Premiere Pro 25.6 ou plus récent dans les dossiers d'Adobe et dans le registre de Windows, sans résultat." : "La détection de Premiere Pro fonctionne sous Windows seulement.") : "AETHRYON a vérifié ce PC. Rien n'a encore été installé ni modifié.")}</p>
          </div>
          {diag && (
            <div className="group det">
              <div className="row"><span className={`tile${premiere?.compatible ? " tile--gold" : ""}`}><Icone nom="picto-montage" taille={20} /></span>
                <div className="grow"><div className="rt">Adobe Premiere Pro {pPremiere}</div>
                  <div className="rd">{premiere ? <>{typo(`Version ${versionCourte(premiere.version) ?? "illisible"} · panneau AETHRYON pris en charge à partir de 25.6${premiere.beta ? " · version bêta" : ""}`)}<br /><span className="mono">{premiere.dossier}</span></> : "Le panneau AETHRYON a besoin de Premiere Pro 25.6 ou plus récent."}</div>
                </div>
              </div>
              <div className="row"><span className="tile"><Icone nom="download" taille={18} /></span>
                <div className="grow"><div className="rt">Creative Cloud Desktop {cc ? <Pastille etat="ok" libelle="Présent" /> : <Pastille etat="missing" libelle="Introuvable" />}</div>
                  <div className="rd">{cc ? "Vous pouvez y installer ou mettre à jour Premiere Pro." : "Utile pour installer Premiere Pro ; le panneau AETHRYON n'en dépend pas."}</div>
                </div>
              </div>
              {!introuvable && (
                <>
                  <div className="row"><span className="tile"><Icone nom="shield" taille={18} /></span>
                    <div className="grow"><div className="rt">Composants AETHRYON {diag.panneau ? <Pastille etat="ok" libelle="Installé" /> : <Pastille etat="error" libelle="Panneau absent" />}</div>
                      <div className="rd" data-panneau={diag.panneau ? "installe" : "absent"}>{typo([diag.panneau ? diag.panneau.libelle : "Panneau AETHRYON absent : AETHRYON Setup l'installe", webview ? `WebView2 ${webview} présent` : "WebView2 présent", espace != null ? `${taille(espace)} libres` : null].filter(Boolean).join(" · "))}</div>
                    </div>
                    {!diag.panneau && <BoutonReparerSetup />}
                  </div>
                  <div className="row"><span className="tile"><Icone nom="drag" taille={18} /></span>
                    <div className="grow"><div className="rt" style={glisser ? undefined : { color: "var(--text-2)" }}>Glisser-déposer vers la timeline {glisser ? <Pastille etat="ok" libelle="Disponible" /> : <Pastille etat="quiet" libelle="Premiere 27.0 et plus" />}</div>
                      <div className="rd">{typo(glisser ? "Pris en charge par votre version : le panneau l'activera." : `Non disponible avec ${versionCourte(premiere?.version) ?? "cette version"}. S'activera de lui-même après une mise à jour de Premiere.`)}</div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          {introuvable && (
            <div className="choices">
              <div className="choice"><span className="num">1</span><div className="grow"><div className="ct">Installer ou mettre à jour Premiere Pro, puis relancer la recherche</div><div className="cd">Depuis Creative Cloud Desktop. Cette fenêtre peut rester ouverte.</div></div></div>
              <div className="choice"><span className="num">2</span><div className="grow"><div className="ct">Premiere Pro est installé dans un autre dossier</div><div className="cd">Indiquez le dossier qui contient Adobe Premiere Pro.exe.</div></div><Bouton taille="sm" onClick={indiquerPremiere}>Indiquer le dossier…</Bouton></div>
              <div className="choice"><span className="num">3</span><div className="grow"><div className="ct">Continuer sans le panneau</div><div className="cd">{typo("AETHRYON Desktop fonctionne seul ; il proposera le panneau dès que Premiere sera détecté.")}</div></div></div>
            </div>
          )}
          {diag && !introuvable && (
            <div className="det-note"><Icone nom="check" taille={16} />Analyse terminée en {secondes(diag.dureeMs)}<span style={{ color: "var(--line-3)" }}>·</span><button type="button" className="link link--quiet" disabled={cherche} onClick={() => detecter()}>Rechercher à nouveau</button></div>
          )}
          {!diag && <div className="det-note" role="status"><IconeEtat etat="running" />Analyse du PC…</div>}
        </div>
        {pied}
      </div>
    );
  }

  // ---- 3. Configuration ---------------------------------------------------------------------------------------------
  if (ecran === "configuration") {
    const raisonPanneau = sansPanneau ? "Vous avez choisi de continuer sans le panneau." : !premiere ? "Premiere Pro n'a pas été trouvé." : premiere.compatible === false ? "Premiere Pro 25.6 ou plus récent est nécessaire." : null;
    const cep = diag?.panneau ?? null;
    const notif = { toutes: "Toutes : médias prêts, imports réussis et erreurs.", importantes: "Importantes : médias prêts et erreurs.", aucune: "Aucune notification Windows." }[opts.notifications];
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
            <Bouton taille="sm" onClick={changerDossier}>Modifier…</Bouton>
          </div>
          <div className="group-title" style={{ marginTop: 18 }}>Options</div>
          <div className="group">
            <div className="row"><div className="grow"><div className="rt">Surveiller le dossier des médias</div><div className="rd">Les fichiers déposés apparaissent dans AETHRYON et dans Premiere Pro.</div></div>
              <Interrupteur libelle="Surveiller le dossier des médias" actif={opts.surveillance} onChange={(v) => setOpts({ ...opts, surveillance: v })} /></div>
            <div className="row"><div className="grow"><div className="rt">Lancer AETHRYON au démarrage de Windows</div><div className="rd">Discret, dans la zone de notification.</div></div>
              <Interrupteur libelle="Lancer AETHRYON au démarrage de Windows" actif={opts.demarrageAuto} onChange={(v) => setOpts({ ...opts, demarrageAuto: v })} /></div>
            <div className="row"><div className="grow"><div className="rt" style={raisonPanneau ? { color: "var(--text-2)" } : undefined}>Panneau Premiere Pro {cep ? <Pastille etat="ok" libelle="Installé" /> : raisonPanneau ? null : <Pastille etat="error" libelle="Absent" />}</div>
              <div className="rd">{typo(cep ? `${cep.libelle} par AETHRYON Setup.${diag?.premiere.enCours ? " Premiere Pro est ouvert : redémarrez-le ensuite." : ""}` : raisonPanneau ?? "Panneau AETHRYON absent : AETHRYON Setup l'installe.")}</div></div>
              {!cep && !raisonPanneau && <BoutonReparerSetup />}</div>
            <div className="row"><div className="grow"><div className="rt">Notifications</div><div className="rd">{notif}</div></div>
              <Segmente<OptionsAssistant["notifications"]> libelle="Notifications" valeur={opts.notifications} onChange={(v) => setOpts({ ...opts, notifications: v })}
                options={[{ id: "toutes", libelle: "Toutes" }, { id: "importantes", libelle: "Importantes" }, { id: "aucune", libelle: "Aucune" }]} /></div>
          </div>
        </div>
        <div className="inst-foot">
          <Regle i={2} />
          <span className="grow" />
          <Bouton variante="ghost" onClick={() => setEcran("detection")}>Retour</Bouton>
          <Bouton variante="primary" style={{ minWidth: 120 }} onClick={installer}>{reparation ? "Réparer" : "Installer"}</Bouton>
        </div>
      </div>
    );
  }

  // ---- 4. Installation ----------------------------------------------------------------------------------------------
  if (ecran === "installation") {
    const fini = !!rapport;
    const echec = fini && !rapport!.reussi && !rapport!.annule;
    const premiereErreur = etapes.flatMap((e) => e.operations).find((o) => o.etat === "erreur");
    const classe = (e: EtatEtape) => (e === "ok" ? "done" : e === "ignore" ? "done is-ignore" : e === "a-confirmer" ? "done is-warn" : e === "erreur" ? "done is-erreur" : e === "en-cours" ? "cur" : "todo");
    const noeud = (e: EtatEtape) => (e === "ok" ? <Icone nom="check" taille={14} /> : e === "a-confirmer" || e === "erreur" ? <b aria-hidden="true">!</b> : e === "ignore" ? <b aria-hidden="true">–</b> : null);
    const ico = (e: EtatEtape) => (e === "ok" ? <IconeEtat etat="ok" taille={14} /> : e === "en-cours" ? <IconeEtat etat="running" taille={14} /> : e === "erreur" ? <IconeEtat etat="error" taille={14} /> : e === "a-confirmer" ? <IconeEtat etat="warn" taille={14} /> : e === "ignore" ? <Icone nom="close" taille={14} /> : <Icone nom="clock" taille={14} />);
    const affichees: Etape[] = etapes.length ? etapes : ETAPES_REGLE.map((_, i) => ({ numero: i + 1, titre: ["Vérification", "Installation", "Enregistrement des composants", "Configuration", "Validation"][i], description: "", etat: "attente", dureeMs: 0, operations: [] }));
    return (
      <div className="inst">
        {barre}
        <div className="inst-body" style={{ paddingTop: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Chouette taille={56} traitement={!fini} />
            <div className="step-head">
              <h1 className="t-display-l" style={{ marginBottom: 4 }}>{echec ? `${reparer} incomplète` : fini ? `${reparer} terminée` : `${reparer} en cours`}</h1>
              <p>{typo(echec ? (premiereErreur?.message ?? "Une étape a échoué : le détail est affiché ci-dessous.") : "Environ une minute. Vous pouvez continuer à travailler.")}</p>
            </div>
          </div>
          <div className="steps" aria-live="polite">
            {affichees.map((e, k) => {
              const montrerOps = e.etat === "en-cours" || e.etat === "erreur" || e.etat === "a-confirmer";
              return (
                <div key={e.numero} className={`stp ${classe(e.etat)}`}>
                  <div className="rail"><span className="node">{noeud(e.etat)}</span></div>
                  <div className="sbody">
                    <div className="st">{e.titre}<span className="t">{e.etat === "en-cours" ? `${e.operations.length} sur ${Math.max(e.operations.length, PREVUES[k]?.length ?? 0)}` : e.dureeMs ? secondes(e.dureeMs) : ""}</span></div>
                    {!montrerOps && <div className="sd">{e.description || ["Premiere Pro, Creative Cloud, panneau AETHRYON, dossier des médias.", "AETHRYON Desktop et le panneau Premiere Pro.", "Liaison navigateur, démarrage avec Windows, désinstallation.", "Dossier des médias et préférences.", "Panneau, fichiers et clés relus."][k]}</div>}
                    {montrerOps && e.operations.length > 0 && (
                      <div className="subs">
                        {e.operations.map((o, j) => (
                          <div key={j} className={`sub ${o.etat === "ok" ? "ok" : o.etat === "en-cours" ? "run" : o.etat === "erreur" ? "bad" : o.etat === "a-confirmer" ? "warn" : "wait"}`}>
                            {ico(o.etat)}
                            <div className="sub-texte"><span>{o.libelle}{o.etat === "en-cours" ? "…" : ""}</span>{o.message && o.etat !== "ok" && o.etat !== "en-cours" && <span className="sub-msg">{typo(o.message)}</span>}</div>
                            <span className="t">{o.etat === "en-cours" ? "" : secondes(o.dureeMs)}</span>
                          </div>
                        ))}
                        {e.etat === "en-cours" && (PREVUES[k] ?? []).filter((l) => !e.operations.some((o) => o.libelle === l)).map((l) => (
                          <div key={l} className="sub wait"><Icone nom="clock" taille={14} /><div className="sub-texte"><span>{l}</span></div></div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="inst-foot">
          <Regle i={3} suite={ecoule((fini ? rapport!.dureeMs + debut : maintenant) - debut)} />
          <span className="grow" />
          <Bouton variante="ghost" icone="log" onClick={() => api.ouvrirDossier("journaux").catch(() => {})}>Afficher le journal</Bouton>
          {echec ? (
            <>
              <Bouton onClick={() => setEcran("configuration")}>Retour</Bouton>
              <Bouton variante="primary" icone="retry" onClick={installer}>Réessayer</Bouton>
            </>
          ) : (
            <Bouton disabled={fini || annulation} onClick={() => { setAnnulation(true); api.assistantAnnuler(); }}>{annulation ? "Annulation…" : "Annuler"}</Bouton>
          )}
        </div>
      </div>
    );
  }

  // ---- 5. Terminé ---------------------------------------------------------------------------------------------------
  return <Termine rapport={rapport} inst={inst} onOuvrir={terminer} />;
}

function Termine({ rapport, inst, onOuvrir }: { rapport: Rapport | null; inst: Instantane; onOuvrir: () => void }) {
  const toast = useToast();
  const [clin, setClin] = useState(0);
  const anime = useRef(!mouvementReduit());
  useEffect(() => {
    if (!anime.current) return;
    const t = window.setTimeout(() => setClin(1), 650);
    return () => window.clearTimeout(t);
  }, []);
  const p = rapport?.premiere ?? null;
  const statut = rapport?.panneau.statut ?? "ignore";
  const relie = statut === "installe";
  const extension = statut === "installe" ? <><span style={{ color: "var(--state-ok)", display: "inline-flex" }}><IconeEtat etat="ok" taille={13} /></span>Panneau AETHRYON {rapport?.panneau.version} installé</>
    : statut === "a-confirmer" ? <><span style={{ color: "var(--state-warn)", display: "inline-flex" }}><IconeEtat etat="warn" taille={13} /></span>À confirmer dans Creative Cloud</>
    : statut === "non-installe" ? <><span style={{ color: "var(--state-bad)", display: "inline-flex" }}><IconeEtat etat="error" taille={13} /></span>Panneau non installé</>
    : <>Non installé (sans Premiere Pro)</>;
  return (
    <div className={`inst inst--halo inst--fin${anime.current ? " anime" : ""}`}>
      <div className="inst-bar" data-tauri-drag-region>
        <Chouette taille={16} />
        <span data-tauri-drag-region>Installation d'AETHRYON</span>
        <span className="grow" data-tauri-drag-region />
        <BoutonsLegende hauteur={40} sansAgrandir />
      </div>
      <div className="inst-body" style={{ padding: "58px 80px 0", textAlign: "center" }}>
        <div className="liaison">
          <span className="end"><Chouette taille={72} clin={clin} /><span className="cap">AETHRYON Desktop</span></span>
          <div className="mid"><div className="fil-trace"><Fil relie={relie} /></div><span className={`seal${relie ? "" : " seal--attente"}`}>{relie ? <Icone nom="check" taille={18} /> : <b>!</b>}</span></div>
          <span className="end end--app"><Icone nom="picto-montage" taille={34} /><span className="cap">{p ? `Premiere Pro ${versionCourte(p.version) ?? ""}` : "Premiere Pro"}</span></span>
        </div>
        <h1 className="t-display-xl monte" style={{ marginTop: 52, ["--d" as string]: "700ms" }}>AETHRYON est prêt.</h1>
        <div className="facts monte" style={{ ["--d" as string]: "760ms" }}>
          <div><div className="fl">Version installée</div><div className="fv">AETHRYON Desktop {rapport?.version ?? inst.version}</div></div>
          <div><div className="fl">Extension Premiere Pro</div><div className="fv" style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>{extension}</div></div>
          <div><div className="fl">Dossier configuré</div><div className="fv">{dossierAmical(rapport?.dossierMedias ?? inst.config.dossierMedias)}</div></div>
        </div>
        <div className="monte" style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 30, ["--d" as string]: "820ms" }}>
          <Bouton variante="primary" taille="lg" onClick={onOuvrir}>Ouvrir AETHRYON</Bouton>
          {p && <Bouton taille="lg" onClick={() => api.ouvrirPremiere().catch((e) => toast({ etat: "erreur", titre: "Premiere Pro ne s'ouvre pas", texte: messageErreur(e) }))}>Ouvrir Premiere Pro</Bouton>}
        </div>
        <p className="t-small c3 monte" style={{ marginTop: 18, ["--d" as string]: "880ms" }}>
          {typo(statut === "installe" ? "Dans Premiere Pro : menu Fenêtre › Extensions › AETHRYON." : rapport?.panneau.message ?? "")}
        </p>
        {statut === "non-installe" && <div className="monte" style={{ marginTop: 12, ["--d" as string]: "900ms" }}><BoutonReparerSetup /></div>}
      </div>
      <div className="inst-foot inst-foot--bare">
        <span className="t-small c3">{typo("Réparer ou désinstaller : Paramètres Windows › Applications, ou AETHRYON › Paramètres.")}</span>
      </div>
    </div>
  );
}
