// Réglages : dossier des médias (partagé avec l'extension navigateur et AETHRYON Desktop), chutier de destination,
// qualité et format par défaut, import automatique des fichiers envoyés par le navigateur (DÉSACTIVÉ par défaut),
// animations, langue, état d'AETHRYON Desktop (facultatif), diagnostic et version.

import { useEffect, useState } from "preact/hooks";
import type { Qualite } from "../../api/client";
import type { Animations } from "../../etat/app";
import type { ModeChutier } from "../../hote/types";
import { dateRelative, taille } from "../../lib/format";
import { VERSION } from "../../version";
import { Bouton, Choix, Icone, Interrupteur, Segmente } from "../composants/base";
import { useApp, useEtat } from "../contexte";

const QUALITES: { valeur: Qualite; libelle: string }[] = [
  { valeur: "1080", libelle: "Auto (jusqu’à 1080p)" },
  { valeur: "2160", libelle: "2160p (4K)" },
  { valeur: "1440", libelle: "1440p" },
  { valeur: "720", libelle: "720p" },
  { valeur: "480", libelle: "480p" },
  { valeur: "360", libelle: "360p" },
];

export function Reglages() {
  const { actions, hote } = useApp();
  const r = useEtat((e) => e.reglages);
  const dossier = useEtat((e) => e.dossierMedias);
  const env = useEtat((e) => e.env);
  const desktop = useEtat((e) => e.desktop);
  const projet = useEtat((e) => e.projet);
  const largeur = useEtat((e) => e.largeur);
  const [libre, setLibre] = useState<number | null>(null);
  useEffect(() => {
    let vivant = true;
    void hote.fichiers.espaceLibre(dossier).then((n) => vivant && setLibre(n));
    return () => {
      vivant = false;
    };
  }, [dossier]);
  const parDefaut = !r.dossierMedias;
  const segments = largeur < 400;
  const nomDossier = dossier.split(/[\\/]/).filter(Boolean).slice(-2).join(" › ");

  return (
    <div class="reglages defile">
      <div class="reglages__col">
        <section class="groupe">
          <h2 class="groupe__titre">Import</h2>
          <div class="reglage reglage--pile">
            <div class="reglage__texte">
              <span class="reglage__nom">Chutier de destination</span>
              <span class="reglage__aide">{r.chutier === "selection" ? `Le chutier sélectionné dans le panneau Projet${projet?.chutierSelectionne ? ` (actuellement « ${projet.chutierSelectionne} »)` : ""} ; à défaut, AETHRYON.` : r.chutier === "racine" ? "À la racine du projet, sans chutier." : "Un chutier « AETHRYON », créé au premier import."}</span>
            </div>
            <Segmente<ModeChutier>
              libelle="Chutier de destination"
              plein
              valeur={r.chutier}
              options={[{ valeur: "aethryon", libelle: "AETHRYON" }, { valeur: "selection", libelle: segments ? "Sélection" : "Chutier sélectionné" }, { valeur: "racine", libelle: "Racine" }]}
              onChange={(v) => actions.changerReglage("chutier", v)}
            />
          </div>
          <div class="reglage">
            <div class="reglage__texte">
              <span class="reglage__nom">Format par défaut</span>
            </div>
            <Segmente libelle="Format par défaut" valeur={r.format} options={[{ valeur: "mp4", libelle: "MP4" }, { valeur: "mp3", libelle: "MP3" }]} onChange={(v) => actions.changerReglage("format", v)} />
          </div>
          <div class="reglage">
            <div class="reglage__texte">
              <span class="reglage__nom">Qualité par défaut</span>
              <span class="reglage__aide">Toujours en MP4 H.264 + AAC, prêt pour Premiere.</span>
            </div>
            <Choix libelle="Qualité par défaut" valeur={r.qualite} options={QUALITES} onChange={(v) => actions.changerReglage("qualite", v)} />
          </div>
        </section>

        <section class="groupe">
          <h2 class="groupe__titre">Dossier des médias</h2>
          <div class="dossier">
            <span class="dossier__icone"><Icone nom="folder" taille={18} /></span>
            <div class="dossier__texte">
              <span class="reglage__nom ell">{nomDossier}</span>
              <span class="mono ell" title={dossier}>{dossier}</span>
              <span class="reglage__aide">
                {libre != null ? `${taille(libre)} libres · ` : ""}
                {parDefaut ? "Dossier par défaut, partagé avec l’extension navigateur et AETHRYON Desktop." : "Dossier choisi ici."}
              </span>
            </div>
          </div>
          <div class="groupe__actions">
            <Bouton petit icone="folder" onClick={() => void actions.choisirDossierMedias()}>Modifier…</Bouton>
            {!parDefaut && <Bouton petit variante="discret" onClick={() => void actions.dossierParDefaut()}>Revenir au dossier par défaut</Bouton>}
            <Bouton petit variante="discret" icone="reveal" onClick={() => actions.afficherDansExplorateur(dossier)}>Explorateur</Bouton>
          </div>
        </section>

        <section class="groupe">
          <h2 class="groupe__titre">Extension navigateur</h2>
          <div class="reglage">
            <div class="reglage__texte">
              <span class="reglage__nom">Importer automatiquement les fichiers envoyés</span>
              <span class="reglage__aide">
                Quand l’extension navigateur envoie une vidéo «{" "}vers Premiere Pro{" "}», elle arrive dans le dossier des médias. Désactivé : elle attend dans la bibliothèque, tu l’importes toi-même.
              </span>
            </div>
            <Interrupteur libelle="Importer automatiquement les fichiers envoyés par le navigateur" actif={r.importAuto} onChange={(v) => actions.changerReglage("importAuto", v)} />
          </div>
        </section>

        <section class="groupe">
          <h2 class="groupe__titre">Affichage</h2>
          <div class="reglage reglage--pile">
            <div class="reglage__texte">
              <span class="reglage__nom">Réduire les animations</span>
              <span class="reglage__aide">Système : suit le réglage «{" "}Effets d’animation{" "}» de Windows.</span>
            </div>
            <Segmente<Animations>
              libelle="Réduire les animations"
              plein
              valeur={r.animations}
              options={[{ valeur: "systeme", libelle: "Système" }, { valeur: "reduites", libelle: "Oui" }, { valeur: "completes", libelle: "Non" }]}
              onChange={(v) => actions.changerReglage("animations", v)}
            />
          </div>
          <div class="reglage">
            <div class="reglage__texte">
              <span class="reglage__nom">Langue</span>
              <span class="reglage__aide">D’autres langues viendront plus tard.</span>
            </div>
            <Choix libelle="Langue" valeur="fr" options={[{ valeur: "fr", libelle: "Français" }]} onChange={() => {}} desactive />
          </div>
        </section>

        <section class="groupe">
          <h2 class="groupe__titre">AETHRYON Desktop <span class="c3 groupe__mention">facultatif</span></h2>
          <div class="reglage">
            <span class={`etat-desktop${desktop.connecte ? " est-connecte" : ""}`} aria-hidden="true" />
            <div class="reglage__texte">
              <span class="reglage__nom">{desktop.connecte ? `Connecté${desktop.version ? ` · ${desktop.version}` : ""}` : desktop.installe ? "Installé, non lancé" : "Non installé"}</span>
              <span class="reglage__aide">
                {desktop.connecte
                  ? "Sa bibliothèque et ses miniatures sont lues par le panneau."
                  : "Le panneau fonctionne sans lui : il lit lui-même le dossier des médias."}
                {desktop.battement && !desktop.connecte ? ` Dernier signe : ${dateRelative(desktop.battement).toLowerCase()}.` : ""}
              </span>
            </div>
          </div>
        </section>

        <section class="groupe">
          <h2 class="groupe__titre">Diagnostic</h2>
          <div class="reglage">
            <div class="reglage__texte">
              <span class="reglage__nom">Vérifier ce PC une fois</span>
              <span class="reglage__aide">Lecture vidéo, glisser vers le projet et la timeline, import, réseau, signature. Produit un rapport à copier.</span>
            </div>
            <Bouton petit icone="shield" onClick={() => actions.naviguer("diagnostic")}>Lancer</Bouton>
          </div>
        </section>

        <p class="reglages__pied micro c3">
          AETHRYON pour Premiere Pro {VERSION} · coque {env?.hote === "cep" ? "CEP" : env?.hote ?? "?"} · Premiere {env?.premiereVersion ?? "?"}
          <br />
          Le panneau n’envoie aucune donnée de navigation ; seuls les liens que tu colles partent vers le serveur AETHRYON.
        </p>
      </div>
    </div>
  );
}
