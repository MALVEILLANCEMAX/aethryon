// Paramètres › Compte : relier ce Desktop au compte AETHRYON par un code et la page d'accord du site (comme Premiere
// Pro), voir le compte relié, se déconnecter. La clé reste dans le cœur Rust (coffre DPAPI) : cette page n'en voit
// rien. Chargée à la demande (budget du JS de démarrage).
import { useState } from "react";
import "../styles/compte.css";
import { api, messageErreur } from "../lib/api";
import { copier, useMagasin } from "../lib/magasin";
import { cloudOuvert, definirCompte, useCompte } from "../lib/compte";
import { dateJour, raisonSansCloud } from "../lib/cloudVue";
import { heureCourte, quand, typo } from "../lib/format";
import { Bouton, BoutonIcone, Icone } from "../ui/base";
import { Dialogue, useToast } from "../ui/superpositions";
import { Chouette } from "../ui/marque";

const ETATS_FIN: Record<string, string> = {
  refuse: "Liaison refusée sur le site AETHRYON : rien n'a été relié.",
  expire: "Le code a expiré (10 minutes) : recommencez la liaison.",
  "deja-utilise": "Ce code a déjà servi : par sécurité, recommencez la liaison.",
};

export default function CompteReglages() {
  const e = useCompte();
  const { aller } = useMagasin();
  const toast = useToast();
  const [occupe, setOccupe] = useState(false);
  const [quitter, setQuitter] = useState(false);

  const faire = async (f: () => Promise<import("../lib/types").EtatCompte>, titreErreur: string) => {
    setOccupe(true);
    try {
      definirCompte(await f());
    } catch (x) {
      toast({ etat: "erreur", titre: titreErreur, texte: messageErreur(x) });
    } finally {
      setOccupe(false);
    }
  };

  if (!e) return null;
  const a = e.appairage;
  const enAttente = a?.etat === "en-attente" || a?.etat === "autorise";
  const sansCloud = raisonSansCloud(e);

  return (
    <section data-reglage="compte">
      <div className="group">
        {e.relie ? (
          <>
            <div className="row" data-compte="relie">
              <span className="tile tile--gold"><Chouette taille={18} /></span>
              <div className="grow">
                <div className="rt">{typo(`Relié à ${e.compte?.email ?? "ton compte"}`)}</div>
                <div className="rd">{typo([e.compte?.nom || null, e.relieLe ? `relié ${quand(e.relieLe).toLowerCase()}` : null, e.cleExpireLe ? `accès valable jusqu'au ${dateJour(e.cleExpireLe)}` : null].filter(Boolean).join(" · "))}</div>
                {e.horsLigne && <div className="rd compte-hors-ligne" role="note">{typo(`Site AETHRYON injoignable : état connu ${e.verifieLe ? quand(e.verifieLe).toLowerCase() : "au dernier lancement"}.`)}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <Bouton taille="sm" disabled={occupe} onClick={() => void faire(api.compteRafraichir, "Vérification impossible")}>Vérifier la liaison</Bouton>
                  <Bouton taille="sm" variante="danger" disabled={occupe} onClick={() => setQuitter(true)}>Se déconnecter…</Bouton>
                </div>
              </div>
            </div>
            <div className="row tight" data-compte="cloud">
              <span className="tile"><Icone nom="cloud" taille={16} /></span>
              <div className="grow">
                <div className="rt">AETHRYON Cloud</div>
                <div className="rd">{typo(cloudOuvert(e) ? "Sauvegarde temporaire de 30 jours, réservée à l'administrateur : la section Cloud est dans la barre latérale." : sansCloud ?? "État du Cloud inconnu : vérifie la liaison.")}</div>
              </div>
              {cloudOuvert(e) && <Bouton taille="sm" icone="cloud" onClick={() => aller("cloud")}>Ouvrir le Cloud</Bouton>}
            </div>
          </>
        ) : a && enAttente ? (
          <div className="row row--pile appairage" data-compte="appairage" aria-live="polite">
            <div className="appairage-code" aria-label={typo(`Code de liaison : ${a.codeUtilisateur.split("").join(" ")}`)}>{a.codeUtilisateur}</div>
            <div className="grow">
              <div className="rt">{a.etat === "autorise" ? "Autorisé : liaison en cours…" : "En attente de ton accord sur le site AETHRYON…"}</div>
              <div className="rd">{typo(`La page d'accord s'est ouverte dans ton navigateur : vérifie que le code est le même, puis autorise. Le code expire à ${heureCourte(a.expireLe)}.`)}</div>
              {a.message && <div className="rd appairage-avis" role="note">{typo(a.message)}</div>}
              <div className="appairage-url">
                <span className="mono ellipsis" title={a.url}>{a.url}</span>
                <BoutonIcone nom="copy" libelle="Copier l'adresse de la page d'accord" taille="xs" onClick={() => void copier(a.url).then((ok) => toast(ok ? { etat: "ok", titre: "Adresse copiée" } : { etat: "erreur", titre: "Copie impossible" }))} />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Bouton taille="sm" variante="ghost" disabled={occupe} onClick={() => void faire(api.compteAnnuler, "Annulation impossible")}>Annuler</Bouton>
              </div>
            </div>
          </div>
        ) : (
          <div className="row" data-compte="non-relie">
            <span className="tile"><Icone nom="link" taille={16} /></span>
            <div className="grow">
              <div className="rt reg-titre">Relier ce Desktop à ton compte
                <button type="button" className="reg-aide" aria-label={typo("Aide : tu l'autorises sur le site AETHRYON, dans ton navigateur ; aucun mot de passe n'est saisi ici. La liaison ouvre l'import musical et, pour l'administrateur, AETHRYON Cloud.")}
                  data-bulle={typo("Tu l'autorises sur le site AETHRYON, dans ton navigateur : aucun mot de passe n'est saisi ici. La liaison ouvre l'import musical et, pour l'administrateur, AETHRYON Cloud.")}><Icone nom="info" taille={13} /></button>
              </div>
              {a && !enAttente && <div className="rd appairage-avis" role="alert">{typo(ETATS_FIN[a.etat] ?? a.message ?? "La liaison n'a pas abouti.")}</div>}
              {!a && e.erreur && <div className="rd appairage-avis" role="alert">{typo(e.erreur)}</div>}
            </div>
            <Bouton taille="sm" variante="primary" icone="link" disabled={occupe} onClick={() => void faire(api.compteRelier, "Liaison impossible")}>{a ? "Recommencer" : "Relier ce Desktop…"}</Bouton>
          </div>
        )}
      </div>
      {quitter && (
        <Dialogue titre="Déconnecter ce Desktop ?" onFermer={() => setQuitter(false)}
          actions={<><Bouton variante="ghost" onClick={() => setQuitter(false)}>Annuler</Bouton><Bouton variante="danger" disabled={occupe} onClick={async () => { await faire(api.compteDeconnecter, "Déconnexion impossible"); setQuitter(false); }}>Se déconnecter</Bouton></>}>
          <p>{typo("L'accès de ce Desktop à ton compte est révoqué sur le site et effacé de cet ordinateur : la section Cloud disparaît. Les envois en cours s'arrêtent. Tes médias locaux et tes fichiers du Cloud restent en place.")}</p>
        </Dialogue>
      )}
    </section>
  );
}
