// Intégrations (Nocturne-2) : une carte par composant relié — Adobe Premiere Pro (marque neutre), extension
// navigateur, compte AETHRYON, AETHRYON Cloud (administrateur, s'il est ouvert). Chaque carte : icône, état RÉEL,
// UNE action principale, et les informations techniques dans une section dépliable (<details>, clavier natif).
// Toutes les fonctions d'avant restent : vérification de compatibilité (re-détection), Réparer (assistant),
// désinstallation du panneau par UPIA (avec confirmation), chutier d'import, journal, dossier du canal local.
import { useState } from "react";
import "../styles/integrations.css";
import { useMagasin } from "../lib/magasin";
import { liaison, versionCourte, versionsPanneau } from "../lib/liaison";
import { BoutonReparerSetup } from "../ui/ReparerSetup";
import { quand, typo } from "../lib/format";
import { api, messageErreur } from "../lib/api";
import { cloudOuvert, useCompte } from "../lib/compte";
import { raisonSansCloud } from "../lib/cloudVue";
import { viserReglage } from "../lib/reglageCible";
import { Bouton, Icone, Pastille, Segmente, type EtatPastille } from "../ui/base";
import { TuileIntegration } from "../ui/PremiereMark";
import { Dialogue, useToast } from "../ui/superpositions";
import type { Chutier } from "../lib/types";
import type { NomIcone } from "../ui/traces";

function Carte({ icone, titre, etat, libelleEtat, phrase, actions, details, statut, large }: {
  icone: React.ReactNode; titre: string; etat: EtatPastille; libelleEtat: string; phrase: string; actions?: React.ReactNode; details?: React.ReactNode; statut: string; large?: boolean;
}) {
  return (
    <article className={`int-carte carte-n${large ? " int-carte--large" : ""}`} data-statut={statut} aria-label={titre}>
      <div className="int-carte-tete">
        {icone}
        <div className="int-carte-texte">
          <h2 className="int-carte-titre">{titre}</h2>
          <div className="int-carte-etat"><Pastille etat={etat} libelle={libelleEtat} /></div>
        </div>
      </div>
      <p className="int-phrase">{typo(phrase)}</p>
      {actions && <div className="int-actions">{actions}</div>}
      {details && (
        <details className="int-details">
          <summary><Icone nom="chevron-right" taille={14} />Informations techniques</summary>
          <div className="int-details-corps">{details}</div>
        </details>
      )}
    </article>
  );
}

function Pictogramme({ nom }: { nom: NomIcone }) {
  return <span className="int-picto" aria-hidden="true"><Icone nom={nom} taille={24} /></span>;
}

function Verif({ ok, titre, detail }: { ok: boolean | null; titre: string; detail: string }) {
  return (
    <li className="int-verif" data-ok={ok === true ? "" : undefined} data-ko={ok === false ? "" : undefined}>
      <Icone nom={ok ? "check" : ok === false ? "close" : "clock"} taille={14} />
      <span><b>{typo(titre)}</b><span>{typo(detail)}</span></span>
    </li>
  );
}

export default function Integrations({ onReparer }: { onReparer: () => void }) {
  const { inst, rafraichir, modifierConfig, aller } = useMagasin();
  const compte = useCompte();
  const toast = useToast();
  const [verif, setVerif] = useState<"" | "en-cours" | "fait">("");
  const [confirmer, setConfirmer] = useState(false);
  const [retrait, setRetrait] = useState(false);
  const [reglages, setReglages] = useState(false);
  if (!inst) return null;
  const l = liaison(inst);
  const p = inst.premiere.principale;
  const b = inst.liaison.panneau;
  const vp = versionsPanneau(inst);
  const versionPanneau = vp.installee;
  const nmTous = inst.nativeMessaging;
  const nm = nmTous.filter((n) => n.enregistre).map((n) => n.navigateur);
  const glisser = p?.glisser === true;
  const chutier = inst.config.chutierParDefaut;
  const nomChutier = chutier === "aethryon" ? "AETHRYON" : chutier === "selection" ? "Chutier sélectionné" : "Racine du projet";

  const verifier = async () => {
    setVerif("en-cours");
    try {
      await api.redetecter();
      rafraichir();
      setVerif("fait");
    } catch (e) {
      setVerif("");
      toast({ etat: "erreur", titre: "Vérification impossible", texte: messageErreur(e) });
    }
  };

  const desinstaller = async () => {
    setRetrait(true);
    try {
      const r = await api.panneauDesinstaller();
      toast(r.ok ? { etat: "ok", titre: "Ancien panneau UXP retiré", texte: "Creative Cloud a retiré l'ancien plugin UXP AETHRYON." } : { etat: "erreur", titre: "Panneau non retiré", texte: r.message });
      rafraichir();
    } catch (e) {
      toast({ etat: "erreur", titre: "Désinstallation impossible", texte: messageErreur(e) });
    } finally {
      setRetrait(false);
      setConfirmer(false);
    }
  };

  const ouvrirPremiere = async () => {
    try {
      await api.ouvrirPremiere();
      toast({ etat: "info", titre: "Premiere Pro s'ouvre", texte: "Puis : Fenêtre › Extensions › AETHRYON." });
    } catch (e) {
      toast({ etat: "erreur", titre: "Premiere Pro ne s'ouvre pas", texte: messageErreur(e) });
    }
  };

  // ---- Premiere Pro : état, phrase courte, action principale selon l'état réel ----------------------------------
  const etatPremiere: [EtatPastille, string] = l.statut === "connecte" ? ["ok", "Connecté"]
    : l.statut === "panneau-ferme" ? ["available", "Panneau fermé"]
    : l.statut === "panneau-absent" ? ["quiet", "Panneau non installé"]
    : l.statut === "incompatible" ? ["error", "Version trop ancienne"]
    : ["missing", l.statut === "inconnu" ? "Non vérifiable ici" : "Introuvable"];
  const phrasePremiere = l.statut === "connecte"
    ? (b?.projetOuvert && b.projet ? `Panneau ouvert dans ${b.projet}.prproj : les imports arrivent dans « ${nomChutier} ».` : "Panneau ouvert ; aucun projet n'est ouvert dans Premiere Pro.")
    : l.statut === "panneau-ferme" ? `${inst.panneauCep?.libelle ?? "Le panneau est installé"} : ouvrez-le dans Premiere Pro › Fenêtre › Extensions › AETHRYON.`
    : l.statut === "panneau-absent" ? "Premiere Pro est présent ; le panneau AETHRYON n'est pas installé : AETHRYON Setup l'installe."
    : l.statut === "incompatible" ? "Le panneau demande Premiere Pro 25.6 ou plus récent."
    : l.statut === "inconnu" ? "La détection de Premiere Pro ne fonctionne que sous Windows."
    : "Premiere Pro n'a pas été trouvé dans les dossiers d'Adobe ni dans le registre.";
  const boutonVerifier = <Bouton taille="sm" icone="shield" occupe={verif === "en-cours"} disabled={verif === "en-cours"} onClick={verifier}>{verif === "en-cours" ? "Vérification…" : "Vérifier la compatibilité"}</Bouton>;
  const actionsPremiere = (
    <>
      {l.statut === "panneau-absent" && <BoutonReparerSetup />}
      {l.statut === "panneau-ferme" && <Bouton taille="sm" variante="primary" icone="external" onClick={() => void ouvrirPremiere()}>Ouvrir Premiere Pro</Bouton>}
      {(l.statut === "introuvable" || l.statut === "incompatible") && <Bouton taille="sm" variante="primary" icone="repair" onClick={onReparer}>Réparer</Bouton>}
      {boutonVerifier}
      {l.statut === "connecte" && <Bouton taille="sm" variante="ghost" icone="settings" onClick={() => setReglages(true)}>Paramètres d'import</Bouton>}
      {l.statut !== "introuvable" && l.statut !== "incompatible" && l.statut !== "panneau-absent" && <Bouton taille="sm" variante="ghost" icone="repair" onClick={onReparer}>Réparer</Bouton>}
    </>
  );
  const detailsPremiere = (
    <>
      <dl className="int-faits">
        <div><dt>Premiere Pro</dt><dd>{p?.version ? versionCourte(p.version) : p ? "Version illisible" : "Non détecté"}{p?.beta ? " (bêta)" : ""}</dd></div>
        <div><dt>Panneau AETHRYON</dt><dd title={inst.panneauCep?.dossier}>{versionPanneau ?? (vp.present ? "Installé" : "Non installé")}</dd>
          <dd className="int-fait-note">{typo(vp.present ? "Extension CEP posée par AETHRYON Setup" : "« Réparer avec AETHRYON Setup » l'installe")}</dd></div>
        <div><dt>Chutier d'import</dt><dd>{nomChutier}</dd></div>
        <div><dt>Canal local</dt><dd>Fichiers locaux, sans port</dd></div>
      </dl>
      <ul className="int-verifs">
        <Verif ok={p?.compatible ?? null} titre="Version de Premiere Pro" detail={p?.compatible ? `Premiere ${versionCourte(p.version)} : 25.6 ou plus récent` : p?.compatible === false ? "Premiere 25.6 ou plus récent requis" : "Version de Premiere non vérifiée"} />
        <Verif ok={l.statut === "connecte" && !!b?.projetOuvert} titre="Import dans le projet actif" detail={l.statut === "connecte" ? (b?.projetOuvert ? "Projet ouvert ; confirmé par le panneau à chaque import" : "Ouvrez un projet dans Premiere") : "Quand le panneau est ouvert"} />
        <Verif ok={inst.creativeCloud.upia ? true : null} titre="Creative Cloud Desktop" detail={inst.creativeCloud.upia ? "Présent : installe et met à jour Premiere Pro" : "Introuvable ; le panneau AETHRYON n'en dépend pas"} />
        <Verif ok={glisser ? true : null} titre="Glisser-déposer vers le projet et la timeline" detail={glisser ? `Premiere ${versionCourte(p?.version)} le permet ; activé par le panneau` : `Premiere 27.0 ou plus récent${p?.version ? " · s'activera après mise à jour" : ""}`} />
      </ul>
      {verif === "fait" && (
        <p className="int-verifie" role="status">
          {typo(p ? `Vérifié à l'instant : ${p.exe}${p.version ? `, version ${p.version}` : ", version illisible"}.` : `Vérifié à l'instant : Premiere Pro introuvable (${inst.premiere.cherche.slice(0, 2).join(" ; ")}).`)}
        </p>
      )}
      <p className="int-texte">{typo("Le panneau et AETHRYON Desktop échangent par des fichiers de votre profil Windows. Aucun port réseau n'est ouvert : aucune page web ne peut s'y connecter et aucun jeton n'est exposé. L'import n'est jamais automatique.")}</p>
      <div className="int-actions int-actions--details">
        <Bouton taille="sm" variante="ghost" icone="settings" onClick={() => setReglages(true)}>Paramètres d'import</Bouton>
        <Bouton taille="sm" variante="ghost" icone="folder" onClick={() => void api.ouvrirDossier("racine")}>Ouvrir le dossier du canal</Bouton>
        <Bouton taille="sm" variante="ghost" icone="log" onClick={() => void api.ouvrirDossier("journaux")}>Journal</Bouton>
        {inst.config.premiere.ccxInstalle && inst.creativeCloud.upia && <Bouton taille="sm" variante="danger" icone="trash" onClick={() => setConfirmer(true)}>Retirer l'ancien panneau UXP</Bouton>}
      </div>
    </>
  );

  // ---- Compte et Cloud ------------------------------------------------------------------------------------------
  const relie = !!compte?.relie;
  const cloud = cloudOuvert(compte);
  const gererCompte = () => { viserReglage("compte"); aller("parametres"); };

  return (
    <div className="int">
      <div className="ph int-ph">
        <div className="grow">
          <h1 className="t-display-l">Intégrations</h1>
          <p className="sub">{typo("Ce qu'AETHRYON Desktop relie, et dans quel état.")}</p>
        </div>
      </div>
      <div className="int-grille">
        <Carte large statut={l.statut} titre="Adobe Premiere Pro" icone={<TuileIntegration taille={52} />} etat={etatPremiere[0]} libelleEtat={etatPremiere[1]} phrase={phrasePremiere}
          actions={actionsPremiere} details={detailsPremiere} />
        <Carte statut={nm.length ? "relie" : "non-relie"} titre="Extension navigateur" icone={<Pictogramme nom="picto-browser" />} etat={nm.length ? "ok" : "warn"} libelleEtat={nm.length ? "Liaison enregistrée" : "Liaison non enregistrée"}
          phrase={nm.length ? `« Envoyer vers : Premiere Pro » arrive dans Transferts, puis dans la bibliothèque (${nm.join(", ")}).` : "L'hôte local d'AETHRYON Desktop n'est enregistré pour aucun navigateur sur ce PC."}
          actions={nm.length ? <Bouton taille="sm" icone="transfers" onClick={() => aller("transferts")}>Voir les transferts</Bouton> : <Bouton taille="sm" variante="primary" icone="repair" onClick={onReparer}>Réparer la liaison</Bouton>}
          details={(
            <>
              <ul className="int-verifs">
                {nmTous.length ? nmTous.map((n) => <Verif key={n.navigateur} ok={n.enregistre} titre={n.navigateur} detail={n.enregistre ? "Hôte local enregistré" : n.message ?? "Non enregistré : « Réparer » l'enregistre"} />)
                  : <Verif ok={null} titre="Navigateurs" detail="Aucun navigateur pris en charge détecté sur ce PC" />}
              </ul>
              <p className="int-texte">{typo("L'extension écrit un transfert que ce PC suit dans Transferts ; le fichier arrive ensuite dans la bibliothèque. Aucun port réseau, aucun jeton échangé.")}</p>
            </>
          )} />
        <Carte statut={relie ? "relie" : "non-relie"} titre="Compte AETHRYON" icone={<Pictogramme nom="user" />} etat={relie ? (compte?.horsLigne ? "warn" : "ok") : "quiet"}
          libelleEtat={relie ? (compte?.horsLigne ? "Relié · hors ligne" : "Relié") : "Non relié"}
          phrase={relie ? `Relié à ${compte?.compte?.email ?? "votre compte"}.` : "Relier ce Desktop ouvre l'import musical et, pour l'administrateur, AETHRYON Cloud."}
          actions={relie ? <Bouton taille="sm" icone="settings" onClick={gererCompte}>Gérer le compte</Bouton> : <Bouton taille="sm" variante="primary" icone="link" onClick={gererCompte}>Relier ce Desktop…</Bouton>}
          details={(
            <p className="int-texte">{typo(relie
              ? [compte?.compte?.nom || null, compte?.relieLe ? `relié ${quand(compte.relieLe).toLowerCase()}` : null, compte?.verifieLe ? `vérifié ${quand(compte.verifieLe).toLowerCase()}` : null, "La clé reste dans le coffre de Windows (DPAPI), jamais dans l'interface."].filter(Boolean).join(" · ")
              : "Vous l'autorisez sur le site AETHRYON, dans votre navigateur : aucun mot de passe n'est saisi ici.")}</p>
          )} />
        {relie && (
          <Carte statut={cloud ? "ouvert" : "ferme"} titre="AETHRYON Cloud" icone={<Pictogramme nom="cloud" />} etat={cloud ? "ok" : "quiet"} libelleEtat={cloud ? "Ouvert" : "Indisponible"}
            phrase={cloud ? "Sauvegarde temporaire de 30 jours, réservée à l'administrateur." : raisonSansCloud(compte) ?? "État du Cloud inconnu : vérifiez la liaison."}
            actions={cloud ? <Bouton taille="sm" icone="cloud" onClick={() => aller("cloud")}>Ouvrir le Cloud</Bouton> : undefined}
            details={cloud ? <p className="int-texte">{typo("Même espace pour les vidéos et la musique ; vérification par le serveur avant « Sauvegardé ». Une copie téléchargée sur ce PC n'est jamais supprimée.")}</p> : undefined} />
        )}
      </div>
      <p className="int-note">{typo("Autres logiciels de montage : non pris en charge. AETHRYON Desktop ne relie que Premiere Pro.")}</p>

      {confirmer && (
        <Dialogue titre="Retirer l'ancien panneau UXP ?" onFermer={() => setConfirmer(false)}
          actions={<><Bouton variante="ghost" onClick={() => setConfirmer(false)}>Annuler</Bouton><Bouton variante="danger" disabled={retrait} onClick={desinstaller}>{retrait ? "Désinstallation…" : "Désinstaller"}</Bouton></>}>
          <p>{typo("Creative Cloud retire l'ancien plugin UXP « AETHRYON » de la bêta 1. Le panneau AETHRYON actuel (extension CEP posée par AETHRYON Setup), vos médias et AETHRYON Desktop restent en place.")}</p>
        </Dialogue>
      )}
      {reglages && (
        <Dialogue titre="Paramètres d'import" onFermer={() => setReglages(false)} actions={<Bouton variante="primary" onClick={() => setReglages(false)}>Terminé</Bouton>}>
          <p style={{ marginBottom: 14 }}>{typo("Chutier où le panneau range les médias que vous importez depuis AETHRYON.")}</p>
          <Segmente<Chutier> libelle="Chutier d'import" valeur={chutier} onChange={(v) => modifierConfig({ chutierParDefaut: v })}
            options={[{ id: "aethryon", libelle: "AETHRYON" }, { id: "selection", libelle: "Chutier sélectionné" }, { id: "racine", libelle: "Racine" }]} />
          <p className="t-small c3" style={{ marginTop: 12 }}>{typo("L'import n'est jamais automatique : il part toujours d'une demande de votre part.")}</p>
        </Dialogue>
      )}
    </div>
  );
}
