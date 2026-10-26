// Compte — connexion par page d'accord (V2-CONNEXION.md) : le navigateur par défaut s'ouvre sur le site AETHRYON,
// le panneau montre le code à vérifier et attend l'accord ; aucune saisie de mot de passe dans Premiere. Une fois
// connecté : quota du jour, 5 dernières conversions, « Se déconnecter » (révoque la clé sur le serveur, puis l'efface).

import { useEffect, useState } from "preact/hooks";
import { dateRelative, typo } from "../../lib/format";
import { NOM_PLATEFORME, type Plateforme } from "../../lib/urls";
import { Bouton, Chouette, Fil, Icone, Progression } from "../composants/base";
import { useApp, useEtat } from "../contexte";

export function Compte() {
  const connexion = useEtat((e) => e.connexion);
  return (
    <div class="compte defile">
      <div class="compte__col">
        {connexion.etat === "connecte" ? <Connecte /> : connexion.etat === "attente" ? <Attente /> : <Deconnecte />}
      </div>
    </div>
  );
}

function Figure({ relie }: { relie: boolean }) {
  return (
    <div class={`figure-lien${relie ? " est-relie" : ""}`} aria-hidden="true">
      <span class="figure-lien__bout"><Chouette taille={26} maitreLogo /></span>
      <span class="figure-lien__fil" />
      <span class="figure-lien__bout"><Icone nom="picto-montage" taille={24} /></span>
    </div>
  );
}

function Deconnecte() {
  const { actions } = useApp();
  const erreur = useEtat((e) => e.connexion.erreur);
  const indisponible = useEtat((e) => e.connexion.indisponible);
  const tropDOrdinateurs = useEtat((e) => e.connexion.tropDOrdinateurs);
  const [enCours, setEnCours] = useState(false);
  return (
    <section class="compte__bloc compte__bloc--centre">
      <Figure relie={false} />
      <h1 class="titre-display">{indisponible ? "Pas encore disponible" : "Connecte ton compte"}</h1>
      <p class="c2">AETHRYON pour Premiere convertit tes vidéos avec ton compte AETHRYON et son quota.</p>
      {indisponible && (
        <div class="note note--alerte" role="status">
          <Icone nom="info" taille={16} />
          <span>
            La connexion de Premiere Pro à ton compte n’est pas encore ouverte sur le serveur AETHRYON. Elle le sera après
            sa mise à jour. En attendant, la bibliothèque, l’aperçu, le glisser-déposer et l’import de fichiers locaux
            fonctionnent sans compte.
          </span>
        </div>
      )}
      {erreur && (
        <p class="note note--erreur" role="alert">
          <Icone nom="error" taille={16} />
          <span>{erreur}</span>
        </p>
      )}
      {tropDOrdinateurs && (
        <Bouton icone="external" bloc onClick={() => void actions.ouvrirEspace()}>Ouvrir «{" "}Mes jetons{" "}»</Bouton>
      )}
      <Bouton
        variante="principal"
        icone="external"
        bloc
        desactive={enCours}
        onClick={async () => {
          setEnCours(true);
          await actions.connecter();
          setEnCours(false);
        }}
      >
        {indisponible ? "Réessayer" : "Se connecter"}
      </Bouton>
      <ul class="puces petit c2">
        <li><Icone nom="external" taille={14} />Une page s’ouvre dans ton navigateur, sur le site AETHRYON.</li>
        <li><Icone nom="shield" taille={14} />Vérifie le code, puis clique «{" "}Autoriser{" "}». Aucun mot de passe n’est saisi dans Premiere.</li>
        <li><Icone nom="power" taille={14} />Tu peux révoquer l’accès à tout moment, ici ou dans ton espace.</li>
      </ul>
    </section>
  );
}

function Attente() {
  const { actions } = useApp();
  const attente = useEtat((e) => e.connexion.attente)!;
  const [reste, setReste] = useState(Math.max(0, attente.expireA - Date.now()));
  useEffect(() => {
    const t = setInterval(() => setReste(Math.max(0, attente.expireA - Date.now())), 1000);
    return () => clearInterval(t);
  }, [attente.expireA]);
  const mn = Math.floor(reste / 60000);
  const s = Math.floor((reste % 60000) / 1000);
  return (
    <section class="compte__bloc compte__bloc--centre">
      <Figure relie={false} />
      <h1 class="titre-display">Vérifie ce code</h1>
      <p class="c2">Sur la page ouverte dans ton navigateur, le même code doit s’afficher. Clique alors «{" "}Autoriser{" "}».</p>
      <p class="code-appairage tab" aria-label={`Code : ${attente.code.split("").join(" ")}`}>{attente.code}</p>
      <p class="attente petit c3" aria-live="polite">
        <span class="attente__point" aria-hidden="true" />
        En attente de ton accord · expire dans {mn}:{String(s).padStart(2, "0")}
      </p>
      <div class="compte__actions">
        <Bouton icone="external" onClick={() => void actions.rouvrirPageAccord()}>Rouvrir la page</Bouton>
        <Bouton variante="discret" onClick={actions.annulerConnexion}>Annuler</Bouton>
      </div>
    </section>
  );
}

const ETATS_CONVERSION: Record<string, { libelle: string; classe: string }> = {
  done: { libelle: "Terminée", classe: "st-importe" },
  error: { libelle: "Échec", classe: "st-erreur" },
  running: { libelle: "En cours", classe: "st-en-cours" },
  reserved: { libelle: "En cours", classe: "st-en-cours" },
  cancelled: { libelle: "Annulée", classe: "c3" },
  refunded: { libelle: "Non comptée", classe: "c3" },
};

function Connecte() {
  const { actions } = useApp();
  const c = useEtat((e) => e.connexion);
  const [confirmer, setConfirmer] = useState(false);
  useEffect(() => {
    if (!confirmer) return;
    const t = setTimeout(() => setConfirmer(false), 5000);
    return () => clearTimeout(t);
  }, [confirmer]);
  const q = c.moi?.quota;
  const protection = c.protection === "dpapi" ? "protégée par Windows (DPAPI)" : c.protection === "acl" ? "fichier réservé à ton compte Windows" : c.protection === "memoire" ? "gardée en mémoire pour cette session" : "";
  return (
    <>
      <section class="compte__bloc">
        <div class="compte__identite">
          <Figure relie />
          <div class="grow">
            <h1 class="compte__nom">{typo(c.compte?.nom || "Compte AETHRYON")}</h1>
            {c.compte?.email && <p class="c2 petit ell">{c.compte.email}</p>}
          </div>
        </div>
        <p class="micro c3">
          Clé «{" "}Premiere{" "}»{c.expireLe ? ` valable jusqu’au ${dateRelative(c.expireLe).replace(/^Aujourd’hui à.*/, "aujourd’hui")}` : ""}{protection ? ` · ${protection}` : ""}
        </p>
      </section>
      <section class="compte__bloc" aria-label="Quota du jour">
        <h2 class="sous-titre">Aujourd’hui</h2>
        {c.moiChargement && !q ? (
          <p class="c3 petit">Lecture du quota…</p>
        ) : c.moiErreur && !q ? (
          <p class="note note--erreur"><Icone nom="error" taille={16} /><span>{c.moiErreur}</span></p>
        ) : q ? (
          q.illimite ? (
            <p class="chiffre-phrase"><span class="chiffre">∞</span> conversions sans limite</p>
          ) : (
            <>
              <p class="chiffre-phrase">
                <span class="chiffre tab">{q.restant ?? 0}</span> {(q.restant ?? 0) > 1 ? "conversions restantes" : "conversion restante"}
              </p>
              <Progression libelle="Quota utilisé" valeur={q.limite ? q.utilise / q.limite : 0} etat={q.restant === 0 ? "erreur" : "actif"} />
              <p class="micro c3 tab">{q.utilise} sur {q.limite}{q.reinitialiseLe ? ` · remis à zéro ${dateRelative(q.reinitialiseLe).toLowerCase()}` : ""}</p>
            </>
          )
        ) : null}
      </section>
      <section class="compte__bloc" aria-label="Dernières conversions">
        <div class="sous-titre-ligne">
          <h2 class="sous-titre">5 dernières conversions</h2>
          <button type="button" class="lien-texte" onClick={() => void actions.chargerMoi()}>
            <Icone nom="retry" taille={14} />
            Actualiser
          </button>
        </div>
        {c.moi && c.moi.recentes.length ? (
          <ul class="conversions">
            {c.moi.recentes.slice(0, 5).map((r) => {
              const pf = (r.plateforme === "x" ? "twitter" : r.plateforme) as Plateforme | null;
              const e = ETATS_CONVERSION[r.etat] || { libelle: r.etat, classe: "c3" };
              return (
                <li class="conversion">
                  <span class="conversion__glyphe">{pf && NOM_PLATEFORME[pf] ? <Icone nom={pf} taille={16} /> : <Icone nom="film" taille={16} />}</span>
                  <span class="grow">
                    <span class="ell">{pf && NOM_PLATEFORME[pf] ? NOM_PLATEFORME[pf] : "Fichier"} · {r.format.toUpperCase()}</span>
                    <span class="micro c3 ell">{dateRelative(r.creeLe)}{r.etat === "error" && r.erreur ? ` · ${typo(r.erreur)}` : ""}</span>
                  </span>
                  <span class={`micro ${e.classe}`}>{e.libelle}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p class="c3 petit">{c.moi ? "Aucune conversion pour l’instant." : "—"}</p>
        )}
      </section>
      <section class="compte__bloc compte__bloc--actions">
        <Bouton icone="external" titre="Ouvre la page « Mes jetons » de ton espace AETHRYON dans le navigateur" onClick={() => void actions.ouvrirEspace()}>
          Mes jetons
        </Bouton>
        {confirmer ? (
          <Bouton variante="danger" icone="power" onClick={() => { setConfirmer(false); void actions.deconnecter(); }}>Confirmer : révoquer et déconnecter</Bouton>
        ) : (
          <Bouton variante="danger" icone="power" onClick={() => setConfirmer(true)}>Se déconnecter</Bouton>
        )}
      </section>
      <p class="micro c3 compte__note">Le panneau voit ton quota et tes 5 dernières conversions ; jamais tes mots de passe ni tes données de navigation.</p>
    </>
  );
}

