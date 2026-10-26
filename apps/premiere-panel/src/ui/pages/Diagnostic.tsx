// Diagnostic intégré (décision du propriétaire n° 4) : un seul essai sur son PC, un rapport copiable.

import { useEffect, useState } from "preact/hooks";
import type { EssaiDiag } from "../../etat/diagnostic";
import { Bouton, Icone, IconeEtat } from "../composants/base";
import { useApp, useEtat } from "../contexte";

const ICONES: Record<EssaiDiag["etat"], { etat: "disponible" | "en-cours" | "importe" | "erreur" | "introuvable"; mot: string }> = {
  attente: { etat: "disponible", mot: "Non lancé" },
  "en-cours": { etat: "en-cours", mot: "En cours" },
  ok: { etat: "importe", mot: "Réussi" },
  echec: { etat: "erreur", mot: "Échec" },
  "a-faire": { etat: "introuvable", mot: "À faire" },
};

export function Diagnostic() {
  const { actions } = useApp();
  const diag = useEtat((e) => e.diag);
  const [copie, setCopie] = useState<null | boolean>(null);
  useEffect(() => () => actions.diagnostic.arreterGlisser(), []);
  const automatiques = diag.essais.filter((x) => x.id !== "glisserProjet" && x.id !== "glisserTimeline");
  const glisser = diag.essais.filter((x) => x.id === "glisserProjet" || x.id === "glisserTimeline");
  const fait = automatiques.some((x) => x.etat === "ok" || x.etat === "echec");
  return (
    <div class="diag defile">
      <div class="diag__col">
        <p class="c2">
          Un essai à faire une fois sur ce PC : il vérifie ce que Premiere accepte vraiment, sans rien supposer. Ouvre d’abord un projet (et une séquence pour l’essai de la timeline).
        </p>
        <Bouton variante="principal" bloc icone="shield" desactive={diag.enCours} raison="Diagnostic en cours" onClick={() => void actions.diagnostic.lancer()}>
          {diag.enCours ? "Diagnostic en cours…" : fait ? "Relancer le diagnostic" : "Lancer le diagnostic"}
        </Bouton>
        <ul class="essais" aria-live="polite">
          {automatiques.map((x) => <Ligne x={x} />)}
        </ul>

        <h2 class="sous-titre">Glisser-déposer (essai manuel)</h2>
        <p class="petit c3">Glisse la carte d’essai vers Premiere : le panneau relit ensuite le projet ou la séquence pour prouver que le fichier est bien arrivé.</p>
        <ul class="essais">
          {glisser.map((x) => <Ligne x={x} />)}
        </ul>
        {diag.glisser ? (
          <CarteEssai />
        ) : (
          <div class="diag__boutons">
            <Bouton petit icone="drag" onClick={() => void actions.diagnostic.essayerGlisser("projet")}>Essayer : panneau Projet</Bouton>
            <Bouton petit icone="drag" onClick={() => void actions.diagnostic.essayerGlisser("timeline")}>Essayer : timeline</Bouton>
          </div>
        )}

        <h2 class="sous-titre">Rapport</h2>
        <pre class="rapport" tabIndex={0} aria-label="Rapport de diagnostic">{actions.diagnostic.rapport()}</pre>
        <div class="diag__boutons">
          <Bouton petit icone="copy" onClick={async () => setCopie(await actions.diagnostic.copierRapport())}>Copier le rapport</Bouton>
          {copie !== null && <span class={`petit ${copie ? "st-importe" : "st-erreur"}`}>{copie ? "Copié" : "Copie impossible : sélectionne le texte"}</span>}
        </div>
        <p class="micro c3">Le rapport est aussi enregistré dans %LOCALAPPDATA%\AETHRYON\journaux. Il ne contient ni clé ni mot de passe.</p>
      </div>
    </div>
  );
}

function Ligne({ x }: { x: EssaiDiag }) {
  const i = ICONES[x.etat];
  return (
    <li class={`essai essai--${x.etat}`}>
      <span class={`essai__icone st-${i.etat}`}><IconeEtat etat={i.etat} taille={14} /></span>
      <div class="essai__texte">
        <div class="essai__tete">
          <b>{x.titre}</b>
          <span class={`micro st-${i.etat}`}>{i.mot}</span>
        </div>
        {x.detail && <p class="micro c2">{x.detail}</p>}
      </div>
    </li>
  );
}

function CarteEssai() {
  const { actions } = useApp();
  const g = useEtat((e) => e.diag.glisser)!;
  const [reste, setReste] = useState(Math.ceil((g.finA - Date.now()) / 1000));
  useEffect(() => {
    const t = setInterval(() => setReste(Math.max(0, Math.ceil((g.finA - Date.now()) / 1000))), 500);
    return () => clearInterval(t);
  }, [g.finA]);
  return (
    <div class="carte-essai">
      <div
        class="carte-essai__poignee"
        draggable
        onDragStart={(e) => {
          if (!e.dataTransfer || !actions.diagnostic.preparerGlisserEssai(e.dataTransfer).length) e.preventDefault();
        }}
      >
        <Icone nom="film" taille={20} />
        <span>
          <b>Glisse-moi {g.mode === "projet" ? "dans le panneau Projet" : "sur la timeline"}</b>
          <span class="micro c3 ell">{g.chemin.split(/[\\/]/).pop()}</span>
        </span>
        <Icone nom="drag" taille={16} classe="c3" />
      </div>
      <div class="carte-essai__pied">
        <span class="micro c3 tab">Vérification toutes les secondes · {reste}{" "}s</span>
        <Bouton petit variante="discret" onClick={actions.diagnostic.arreterGlisser}>Arrêter</Bouton>
      </div>
    </div>
  );
}
