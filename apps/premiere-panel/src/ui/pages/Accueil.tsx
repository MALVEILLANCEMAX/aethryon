// Accueil — la priorité du propriétaire : « importer un clip YouTube, TikTok ou X » dans Premiere.
// Coller un lien → plateforme reconnue à la frappe → carte d'aperçu (serveur AETHRYON) → format, qualité, extrait →
// « Importer dans Premiere » : conversion sur le serveur (MP4 H.264 + AAC), téléchargement en flux dans le dossier
// des médias, import dans le chutier. Chaque étape montre sa progression RÉELLE. Les imports récents restent
// dessous, glissables vers la timeline.

import { useEffect, useRef, useState } from "preact/hooks";
import { EXTRAIT_MAX_S, type Qualite } from "../../api/client";
import { contexte, lireSecondes, type Tache } from "../../etat/app";
import { etatAffiche, idPourChemin, metaCourte, pretPourPremiere, type Media } from "../../lib/bibliotheque";
import { duree, pourcent, taille, typo } from "../../lib/format";
import { NOM_PLATEFORME, plateformeProbable } from "../../lib/urls";
import { Bouton, BoutonIcone, Choix, Icone, IconeEtat, Interrupteur, Onde, Progression, Segmente } from "../composants/base";
import { useApp, useEtat } from "../contexte";

export function Accueil() {
  const connecte = useEtat((e) => e.connexion.etat === "connecte");
  const tache = useEtat((e) => e.tache);
  const lien = useEtat((e) => e.lien);
  return (
    <div class="accueil defile">
      <div class="accueil__col">
        <header class="accueil__intro">
          <h1 class="titre-display">Importer un clip</h1>
          <p class="c2">YouTube, TikTok ou X, converti en MP4 prêt pour Premiere.</p>
        </header>
        <ChampLien />
        {lien && !connecte && <InviteConnexion />}
        {lien && connecte && <CarteApercu />}
        {lien && connecte && !tache && <Options />}
        {tache && <SuiviTache tache={tache} />}
        <Recents />
      </div>
    </div>
  );
}

function ChampLien() {
  const { actions } = useApp();
  const saisie = useEtat((e) => e.saisie);
  const lien = useEtat((e) => e.lien);
  const refus = useEtat((e) => e.refus);
  const ref = useRef<HTMLInputElement>(null);
  const [collageRefuse, setCollageRefuse] = useState(false);
  const probable = lien?.plateforme ?? plateformeProbable(saisie);
  useEffect(() => {
    if (!saisie) ref.current?.focus();
  }, []);
  return (
    <div class="lien">
      <label class={`champ-lien${lien ? " est-reconnu" : refus ? " est-refuse" : ""}`}>
        <span class={`champ-lien__glyphe${probable ? " est-plateforme" : ""}`} key={probable || "lien"}>
          <Icone nom={probable || "lien"} taille={20} />
        </span>
        <input
          ref={ref}
          type="url"
          inputMode="url"
          spellcheck={false}
          autoComplete="off"
          placeholder="Colle un lien YouTube, TikTok ou X"
          aria-label="Lien de la vidéo"
          value={saisie}
          onInput={(e) => actions.saisir((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && lien) void actions.importerDepuisLien();
            if (e.key === "Escape" && saisie) actions.saisir("");
          }}
        />
        {saisie ? (
          <BoutonIcone icone="close" libelle="Effacer le lien" classe="bi--petit" onClick={() => { actions.saisir(""); ref.current?.focus(); }} />
        ) : (
          <button
            type="button"
            class="champ-lien__coller"
            onClick={async () => {
              const ok = await actions.coller();
              if (!ok) {
                setCollageRefuse(true);
                ref.current?.focus();
              }
            }}
          >
            <Icone nom="coller" taille={16} />
            <span>Coller</span>
          </button>
        )}
      </label>
      <p class={`lien__etat${lien ? " est-ok" : refus ? " est-refus" : ""}`} aria-live="polite">
        {lien ? (
          <>
            <Icone nom="check" taille={14} />
            {NOM_PLATEFORME[lien.plateforme]} · {lien.genre === "short" ? "Short reconnu" : lien.genre === "shortlink" ? "lien court reconnu" : lien.plateforme === "twitter" ? "publication reconnue" : "vidéo reconnue"}
            {lien.rang ? ` · vidéo n° ${lien.rang}` : ""}
          </>
        ) : refus ? (
          <>
            <Icone nom="info" taille={14} />
            {refus}
          </>
        ) : collageRefuse ? (
          "Le presse-papiers n’est pas accessible ici : colle avec Ctrl V."
        ) : (
          " "
        )}
      </p>
    </div>
  );
}

function InviteConnexion() {
  const { actions } = useApp();
  const etat = useEtat((e) => e.connexion.etat);
  return (
    <div class="carte carte--invite">
      <Icone nom="link" taille={20} classe="c-or" />
      <div class="grow">
        <b>Connecte ton compte AETHRYON</b>
        <p class="c2 petit">L’aperçu et la conversion utilisent ton compte et son quota. Aucun mot de passe n’est saisi dans Premiere.</p>
      </div>
      <Bouton variante="principal" petit onClick={() => actions.naviguer("compte")}>{etat === "attente" ? "Voir le code" : "Se connecter"}</Bouton>
    </div>
  );
}

function CarteApercu() {
  const { actions } = useApp();
  const apercu = useEtat((e) => e.apercu);
  const lien = useEtat((e) => e.lien)!;
  const [squelette, setSquelette] = useState(false);
  useEffect(() => {
    if (apercu.etat !== "chargement") return;
    // Squelette seulement après 300 ms d'attente (DESIGN-SYSTEM §6).
    const t = setTimeout(() => setSquelette(true), 300);
    return () => {
      clearTimeout(t);
      setSquelette(false);
    };
  }, [apercu.etat]);
  if (apercu.etat === "erreur") {
    return (
      <div class="carte carte--erreur" role="alert">
        <Icone nom="error" taille={18} />
        <div class="grow">
          <b>Aperçu impossible</b>
          <p class="petit">{apercu.erreur}</p>
        </div>
        <Bouton petit icone="retry" onClick={actions.rechargerApercu}>Réessayer</Bouton>
      </div>
    );
  }
  const d = apercu.donnees;
  const chargement = apercu.etat !== "pret";
  return (
    <article class={`apercu-lien${chargement ? " est-chargement" : ""}${chargement && squelette ? " est-squelette" : ""}`} aria-busy={chargement ? "true" : "false"}>
      <div class="apercu-lien__image">
        {apercu.miniature ? <img src={apercu.miniature} alt="" draggable={false} /> : <span class="apercu-lien__glyphe"><Icone nom={lien.plateforme} taille={28} /></span>}
        {d?.duration ? <span class="badge badge--duree tab">{duree(d.duration)}</span> : null}
      </div>
      <div class="apercu-lien__texte">
        {chargement ? (
          <>
            <span class="ligne-squelette" style={{ width: "86%" }} />
            <span class="ligne-squelette" style={{ width: "54%" }} />
            <span class="c3 petit">Lecture du lien sur le serveur AETHRYON…</span>
          </>
        ) : (
          <>
            <h2 class="apercu-lien__titre">{typo(d?.title || "Sans titre")}</h2>
            <p class="c3 petit tab">
              {[NOM_PLATEFORME[lien.plateforme], d?.uploader ? typo(d.uploader) : null, d?.duration ? duree(d.duration) : null].filter(Boolean).join(" · ")}
            </p>
            {d?.live && <p class="petit c-alerte"><Icone nom="alert" taille={14} /> Direct en cours : non pris en charge.</p>}
            {d?.limits?.too_long && <p class="petit c-alerte"><Icone nom="alert" taille={14} /> Vidéo trop longue pour le service : choisis un extrait.</p>}
          </>
        )}
      </div>
    </article>
  );
}

const QUALITES_STD: Qualite[] = ["2160", "1440", "1080", "720", "480", "360"];

function Options() {
  const { actions } = useApp();
  const choix = useEtat((e) => e.choix);
  const apercu = useEtat((e) => e.apercu);
  const extrait = useEtat((e) => e.extrait);
  const projet = useEtat((e) => e.projet);
  const chutier = useEtat((e) => e.reglages.chutier);
  const erreurExtrait = useEtat((e) => actions.erreurExtrait(e));
  const pret = apercu.etat === "pret" && !apercu.donnees?.live;
  const qualites = apercu.donnees?.qualities?.filter((q) => q.quality) ?? [];
  const tailles = new Map(qualites.map((q) => [String(q.quality), q.est_size_bytes]));
  const options = [
    { valeur: "1080" as Qualite, libelle: "Auto (jusqu’à 1080p)" },
    ...QUALITES_STD.filter((q) => !qualites.length || qualites.some((x) => String(x.quality) === q)).map((q) => ({
      valeur: q,
      libelle: `${q}p${tailles.get(q) ? ` · ≈ ${taille(tailles.get(q)!)}` : ""}`,
    })),
  ].filter((o, i, t) => t.findIndex((x) => x.valeur === o.valeur && x.libelle === o.libelle) === i);
  const dureeVideo = apercu.donnees?.duration ?? null;
  const d = lireSecondes(extrait.debut);
  const f = lireSecondes(extrait.fin);
  const max = EXTRAIT_MAX_S[choix.format];
  const nomChutier = chutier === "racine" ? "la racine du projet" : chutier === "selection" ? `le chutier ${projet?.chutierSelectionne ? "« " + projet.chutierSelectionne + " »" : "sélectionné"}` : "le chutier AETHRYON";
  return (
    <section class="options" aria-label="Options d’import">
      <div class="options__ligne">
        <Segmente
          libelle="Format"
          valeur={choix.format}
          options={[{ valeur: "mp4", libelle: "Vidéo MP4" }, { valeur: "mp3", libelle: "Audio MP3" }]}
          onChange={(v) => actions.choisir("format", v)}
        />
        {choix.format === "mp4" ? (
          <Choix libelle="Qualité" prefixe="Qualité · " valeur={choix.qualite} options={options} onChange={(v) => actions.choisir("qualite", v)} />
        ) : (
          <Choix
            libelle="Débit"
            prefixe="Débit · "
            valeur={String(choix.bitrate) as "128" | "192" | "320"}
            options={[{ valeur: "128", libelle: "128 kbit/s" }, { valeur: "192", libelle: "192 kbit/s" }, { valeur: "320", libelle: "320 kbit/s" }]}
            onChange={(v) => actions.choisir("bitrate", Number(v) as 128 | 192 | 320)}
          />
        )}
      </div>
      <div class={`extrait${extrait.actif ? " est-ouvert" : ""}`}>
        <div class="extrait__tete">
          <Icone nom="ciseaux" taille={16} classe="c3" />
          <span class="grow">
            Extrait
            <span class="c3 petit"> · facultatif, jusqu’à {max / 60}{" "}min</span>
          </span>
          <Interrupteur libelle="Importer seulement un extrait" actif={extrait.actif} onChange={(v) => actions.changerExtrait({ actif: v })} />
        </div>
        {extrait.actif && (
          <div class="extrait__corps">
            <label class="champ-temps">
              <span>Début</span>
              <input type="text" inputMode="numeric" value={extrait.debut} aria-label="Début de l’extrait (minutes:secondes)" onInput={(e) => actions.changerExtrait({ debut: (e.currentTarget as HTMLInputElement).value })} />
            </label>
            <label class="champ-temps">
              <span>Fin</span>
              <input type="text" inputMode="numeric" value={extrait.fin} aria-label="Fin de l’extrait (minutes:secondes)" onInput={(e) => actions.changerExtrait({ fin: (e.currentTarget as HTMLInputElement).value })} />
            </label>
            {dureeVideo && d != null && f != null && f > d ? (
              <div class="extrait__barre" aria-hidden="true">
                <i style={{ left: `${(Math.min(d, dureeVideo) / dureeVideo) * 100}%`, width: `${(Math.max(0, Math.min(f, dureeVideo) - Math.min(d, dureeVideo)) / dureeVideo) * 100}%` }} />
              </div>
            ) : null}
            <p class={`petit extrait__note${erreurExtrait ? " c-erreur" : " c3"}`}>{erreurExtrait || `${duree((f ?? 0) - (d ?? 0))} sur ${dureeVideo ? duree(dureeVideo) : "?"}`}</p>
          </div>
        )}
      </div>
      <Bouton variante="principal" bloc icone="import" desactive={!pret || !!erreurExtrait} raison={!pret ? "Attends l’aperçu du lien" : erreurExtrait || undefined} onClick={() => void actions.importerDepuisLien()}>
        Importer dans Premiere
      </Bouton>
      <p class="cible petit c3">
        {projet ? <>dans {nomChutier} · <b>{projet.nom}</b></> : "Aucun projet ouvert : le fichier sera enregistré, à importer ensuite."}
      </p>
    </section>
  );
}

const ETAPES: { cle: "conversion" | "telechargement" | "import"; libelle: string }[] = [
  { cle: "conversion", libelle: "Conversion" },
  { cle: "telechargement", libelle: "Téléchargement" },
  { cle: "import", libelle: "Import" },
];

function SuiviTache({ tache }: { tache: Tache }) {
  const { actions } = useApp();
  const ordre = { conversion: 0, telechargement: 1, import: 2, termine: 3, erreur: -1, annule: -1 } as const;
  const rang = ordre[tache.phase];
  const actif = rang >= 0 && rang < 3;
  const etapeErreur = tache.phase === "erreur" ? (tache.chemin ? 2 : tache.octets ? 1 : 0) : -1;
  return (
    <section class={`tache tache--${tache.phase}`} aria-live="polite">
      <header class="tache__tete">
        <span class="tache__icone">
          {tache.phase === "termine" ? <span class="sceau"><Icone nom="check" taille={14} /></span> : tache.phase === "erreur" ? <Icone nom="error" taille={18} /> : tache.phase === "annule" ? <Icone nom="close" taille={18} /> : <IconeEtat etat="en-cours" taille={16} />}
        </span>
        <div class="grow">
          <b class="ell2">{typo(tache.titre)}</b>
          <span class="c3 petit">{tache.phase === "termine" ? tache.message : tache.phase === "erreur" ? tache.erreur : tache.phase === "annule" ? tache.message : tache.libelle}</span>
        </div>
        {actif ? <Bouton petit variante="discret" onClick={actions.annulerImportEnCours}>Annuler</Bouton> : <BoutonIcone icone="close" libelle="Fermer" onClick={actions.fermerTache} />}
      </header>
      <ol class="etapes">
        {ETAPES.map((e, i) => {
          const fait = rang > i || tache.phase === "termine";
          const enCours = rang === i;
          const erreur = etapeErreur === i;
          let valeur: number | null = fait ? 1 : 0;
          let detail = fait ? "Fait" : "";
          if (enCours && e.cle === "conversion") {
            valeur = tache.conversion;
            detail = pourcent(tache.conversion * 100);
          }
          if (enCours && e.cle === "telechargement") {
            const o = tache.octets;
            valeur = o && o.total ? o.recus / o.total : null;
            detail = o ? (o.total ? `${taille(o.recus)} sur ${taille(o.total)}` : taille(o.recus)) : "";
          }
          if (enCours && e.cle === "import") {
            valeur = null;
            detail = "Premiere…";
          }
          if (erreur) detail = "Échec";
          return (
            <li class={`etape${fait ? " est-faite" : ""}${enCours ? " est-en-cours" : ""}${erreur ? " est-erreur" : ""}`}>
              <div class="etape__tete">
                <span>{e.libelle}</span>
                <span class="c3 tab">{detail}</span>
              </div>
              <Progression libelle={e.libelle} valeur={erreur ? Math.max(0.04, valeur ?? 0) : valeur} etat={erreur ? "erreur" : fait ? "fini" : enCours ? "actif" : "attente"} />
            </li>
          );
        })}
      </ol>
      {tache.phase === "termine" && tache.chemin && (
        <CarteGlissable chemin={tache.chemin} titre={tache.titre} />
      )}
      {tache.phase === "termine" && (
        <div class="tache__suite">
          <Bouton petit icone="library" onClick={() => actions.naviguer("bibliotheque")}>Voir dans la bibliothèque</Bouton>
          {tache.chemin && <Bouton petit variante="discret" icone="reveal" onClick={() => actions.afficherDansExplorateur(tache.chemin!)}>Explorateur</Bouton>}
        </div>
      )}
      {tache.phase === "erreur" && (
        <div class="tache__suite">
          <Bouton petit icone="retry" onClick={() => { actions.fermerTache(); void actions.importerDepuisLien(); }}>Réessayer</Bouton>
        </div>
      )}
    </section>
  );
}

/** Le clip qui vient d'arriver, glissable tout de suite vers la timeline ou le panneau Projet. */
function CarteGlissable({ chemin, titre }: { chemin: string; titre: string }) {
  const { actions } = useApp();
  const id = idPourChemin(chemin);
  const mini = useEtat((e) => e.miniatures[id]);
  const present = useEtat((e) => e.medias.some((m) => m.id === id));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (present && !mini) actions.demanderMiniature(id);
  }, [present, mini]);
  return (
    <div
      ref={ref}
      class="glissable"
      draggable
      title="Glisse vers la timeline ou le panneau Projet"
      onDragStart={(e) => {
        if (!e.dataTransfer || !actions.glisser(e.dataTransfer, [id])) e.preventDefault();
        else ref.current?.classList.add("est-glisse");
      }}
      onDragEnd={() => {
        ref.current?.classList.remove("est-glisse");
        actions.finGlisser();
      }}
    >
      <span class="recent__mini">{mini ? <img src={mini} alt="" draggable={false} /> : <Icone nom="film" taille={16} />}</span>
      <span class="grow">
        <span class="ell glissable__nom">{typo(titre)}</span>
        <span class="micro c3">Glisse-le vers la timeline ou le panneau Projet</span>
      </span>
      <Icone nom="drag" taille={16} classe="c3" />
    </div>
  );
}

function Recents() {
  const { actions } = useApp();
  const recents = useEtat((e) => e.recents);
  const medias = useEtat((e) => e.medias);
  const ctx = useEtat((e) => contexte(e));
  const miniatures = useEtat((e) => e.miniatures);
  const largeur = useEtat((e) => e.largeur);
  const lien = useEtat((e) => e.lien);
  const tache = useEtat((e) => e.tache);
  const parId = new Map(medias.map((m) => [m.id, m]));
  const max = largeur >= 760 ? 8 : 5;
  let liste = recents.map((r) => parId.get(idPourChemin(r.chemin))).filter((m): m is Media => !!m).slice(0, max);
  const depuisDossier = !liste.length;
  if (depuisDossier) {
    // Aucun import récent : les derniers fichiers arrivés dans le dossier des médias (navigateur, Desktop…).
    liste = medias.filter((m) => m.etatSource !== "introuvable").sort((a, b) => String(b.ajouteLe || "").localeCompare(String(a.ajouteLe || ""))).slice(0, 4);
  }
  return (
    <>
      {depuisDossier && !lien && !tache && <CommentCaMarche />}
      {liste.length > 0 && (
        <section class="recents" aria-label={depuisDossier ? "Derniers médias du dossier" : "Imports récents"}>
          <header class="recents__tete">
            <h2>{depuisDossier ? "Dans ton dossier" : "Récents"}</h2>
            <button type="button" class="lien-texte" onClick={() => actions.naviguer("bibliotheque")}>
              Tout voir
              <Icone nom="chevron-right" taille={14} />
            </button>
          </header>
          <ul class="recents__liste">
            {liste.map((m) => (
              <LigneRecente m={m} etat={etatAffiche(m, ctx)} pret={pretPourPremiere(m, ctx)} mini={miniatures[m.id]} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function CommentCaMarche() {
  return (
    <ol class="etapes-guide" aria-label="Comment ça marche">
      <li>
        <span class="etapes-guide__n tab">1</span>
        <span><b>Colle un lien</b><span class="c3"> YouTube, TikTok ou X</span></span>
      </li>
      <li>
        <span class="etapes-guide__n tab">2</span>
        <span><b>Choisis</b><span class="c3"> MP4 ou MP3, la qualité, un extrait</span></span>
      </li>
      <li>
        <span class="etapes-guide__n tab">3</span>
        <span><b>Importe</b><span class="c3"> : converti sur le serveur AETHRYON, le clip arrive dans ton projet</span></span>
      </li>
    </ol>
  );
}

function LigneRecente({ m, etat, pret, mini }: { m: Media; etat: ReturnType<typeof etatAffiche>; pret: boolean; mini?: string }) {
  const { actions } = useApp();
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!mini && m.type !== "audio") actions.demanderMiniature(m.id);
  }, [m.id, mini]);
  return (
    <li
      ref={ref}
      class={`recent${pret ? " est-glissable" : ""} etat-${etat}`}
      draggable={pret}
      onDragStart={(e) => {
        if (!e.dataTransfer || !actions.glisser(e.dataTransfer, [m.id])) e.preventDefault();
        else ref.current?.classList.add("est-glisse");
      }}
      onDragEnd={() => {
        ref.current?.classList.remove("est-glisse");
        actions.finGlisser();
      }}
      title={pret ? "Glisse vers le panneau Projet ou la timeline" : undefined}
    >
      <span class="recent__mini">
        {mini ? <img src={mini} alt="" draggable={false} /> : m.type === "audio" ? <Onde graine={m.id} barres={16} /> : <Icone nom="film" taille={16} />}
      </span>
      <span class="recent__texte">
        <span class="ell recent__nom">{typo(m.origine?.titre || m.nom)}</span>
        <span class="ell c3 micro tab">{metaCourte(m)}</span>
      </span>
      <span class={`recent__etat st-${etat}`} title={etat === "disponible" ? undefined : etat}>
        {etat !== "disponible" && <IconeEtat etat={etat} />}
      </span>
      {pret && (
        <span class="recent__actions">
          <BoutonIcone icone="import" libelle="Importer dans le projet" classe="bi--petit" onClick={() => void actions.importerMedias([m.id])} />
          <span class="recent__poignee" aria-hidden="true"><Icone nom="drag" taille={14} /></span>
        </span>
      )}
    </li>
  );
}
