// Coquille du panneau : en-tête (logo officiel, nom, connexion, réglages), onglets, ligne « Importer dans »,
// la vue courante (fondu de 160 ms) et le toast unique (DESIGN-SYSTEM §6, §7.2).

import { useEffect, useRef } from "preact/hooks";
import type { Page } from "../etat/app";
import { Accueil } from "./pages/Accueil";
import { Bibliotheque } from "./pages/Bibliotheque";
import { Compte } from "./pages/Compte";
import { Reglages } from "./pages/Reglages";
import { Diagnostic } from "./pages/Diagnostic";
import { Bouton, BoutonIcone, Chouette, Choix, Fil, Icone, Logotype } from "./composants/base";
import { classeLargeur, useApp, useEtat } from "./contexte";
import type { ModeChutier } from "../hote/types";

const ONGLETS: { page: Page; libelle: string; icone: "home" | "library" | "link" }[] = [
  { page: "accueil", libelle: "Accueil", icone: "home" },
  { page: "bibliotheque", libelle: "Bibliothèque", icone: "library" },
  { page: "compte", libelle: "Compte", icone: "link" },
];

export function Panneau() {
  const { actions } = useApp();
  const pret = useEtat((e) => e.pret);
  const erreur = useEtat((e) => e.erreurDemarrage);
  const page = useEtat((e) => e.page);
  const largeur = useEtat((e) => e.largeur);
  const classe = classeLargeur(largeur);

  // Navigation au clavier visible seulement après une touche (DESIGN-SYSTEM §8.2 : :focus garanti, anneau au clavier).
  useEffect(() => {
    const clavier = (e: KeyboardEvent) => e.key === "Tab" && document.documentElement.classList.add("clavier");
    const souris = () => document.documentElement.classList.remove("clavier");
    window.addEventListener("keydown", clavier);
    window.addEventListener("pointerdown", souris);
    return () => {
      window.removeEventListener("keydown", clavier);
      window.removeEventListener("pointerdown", souris);
    };
  }, []);

  if (!pret) {
    return (
      <div class="app app--chargement">
        <Chouette taille={32} maitreLogo />
      </div>
    );
  }
  if (erreur) {
    return (
      <div class={`app app--${classe}`}>
        <div class="vide">
          <Chouette taille={40} maitreLogo />
          <h2 class="vide__titre">Le panneau n’a pas pu démarrer</h2>
          <p class="vide__texte">{erreur}</p>
          <div class="vide__actions">
            <Bouton variante="principal" onClick={() => location.reload()}>Recharger le panneau</Bouton>
          </div>
        </div>
      </div>
    );
  }
  const pageSecondaire = page === "reglages" || page === "diagnostic";
  return (
    <div class={`app app--${classe}`}>
      <EnTete />
      {pageSecondaire ? <TitrePage page={page} /> : <Onglets page={page} />}
      {(page === "accueil" || page === "bibliotheque") && <LigneImport />}
      <main class="vue" key={page} id="vue">
        {page === "accueil" && <Accueil />}
        {page === "bibliotheque" && <Bibliotheque />}
        {page === "compte" && <Compte />}
        {page === "reglages" && <Reglages />}
        {page === "diagnostic" && <Diagnostic />}
      </main>
      <ToastUnique />
      <span class="sr-only" aria-live="polite" id="annonces" />
      {/* Accès au clavier : aller directement au contenu */}
      <button type="button" class="sr-only sr-focus" onClick={() => document.getElementById("vue")?.focus()}>
        Aller au contenu
      </button>
    </div>
  );
}

function EnTete() {
  const { actions } = useApp();
  const connexion = useEtat((e) => e.connexion.etat);
  const largeur = useEtat((e) => e.largeur);
  const page = useEtat((e) => e.page);
  const relie = connexion === "connecte";
  return (
    <header class="tete">
      <button type="button" class="tete__marque" onClick={() => actions.naviguer("accueil")} aria-label="AETHRYON — Accueil">
        <Chouette taille={20} />
        {largeur >= 300 && <Logotype capitales={largeur < 360 ? 8.5 : 9.5} />}
      </button>
      <span class="grow" />
      <button type="button" class={`connexion${relie ? " connexion--relie" : ""}`} onClick={() => actions.naviguer("compte")} title={relie ? "Compte connecté" : "Se connecter au compte AETHRYON"}>
        <Fil relie={relie} compact={largeur < 340} />
        <span>{relie ? "Connecté" : connexion === "attente" ? "En attente" : connexion === "inconnu" ? "…" : "Se connecter"}</span>
      </button>
      <BoutonIcone icone="settings" libelle="Réglages" actif={page === "reglages"} onClick={() => actions.naviguer(page === "reglages" ? "accueil" : "reglages")} />
    </header>
  );
}

function Onglets({ page }: { page: Page }) {
  const { actions } = useApp();
  const n = useEtat((e) => e.medias.length);
  const largeur = useEtat((e) => e.largeur);
  const compteurs = largeur >= 360;
  return (
    <nav class="onglets" aria-label="Sections">
      {ONGLETS.map((o) => {
        const actif = o.page === page;
        return (
          <button type="button" class={`onglet${actif ? " est-actif" : ""}`} aria-current={actif ? "page" : undefined} onClick={() => actions.naviguer(o.page)} title={o.libelle}>
            <span>{o.libelle}</span>
            {o.page === "bibliotheque" && n > 0 && compteurs && <span class="onglet__n tab">{n}</span>}
          </button>
        );
      })}
    </nav>
  );
}

function TitrePage({ page }: { page: Page }) {
  const { actions } = useApp();
  const retour = useEtat((e) => e.retour);
  const titre = page === "reglages" ? "Réglages" : "Diagnostic";
  return (
    <div class="titre-page">
      <BoutonIcone icone="chevron-left" libelle={page === "diagnostic" ? "Retour aux réglages" : "Retour"} onClick={() => actions.naviguer(page === "diagnostic" ? "reglages" : retour)} />
      <h1>{titre}</h1>
      <span class="grow" />
      <BoutonIcone icone="close" libelle="Fermer" onClick={() => actions.naviguer(retour)} />
    </div>
  );
}

const MODES: { valeur: ModeChutier; libelle: string }[] = [
  { valeur: "aethryon", libelle: "AETHRYON" },
  { valeur: "selection", libelle: "Chutier sélectionné" },
  { valeur: "racine", libelle: "Racine du projet" },
];

function LigneImport() {
  const { actions } = useApp();
  const projet = useEtat((e) => e.projet);
  const verifie = useEtat((e) => e.projetVerifie);
  const mode = useEtat((e) => e.reglages.chutier);
  const largeur = useEtat((e) => e.largeur);
  if (verifie && !projet) {
    return (
      <div class="ligne-import ligne-import--alerte" role="status">
        <Icone nom="alert" taille={16} />
        <span class="ell">Aucun projet ouvert dans Premiere</span>
      </div>
    );
  }
  const options = MODES.map((m) => (m.valeur === "selection" && projet?.chutierSelectionne ? { ...m, libelle: `Sélection (${projet.chutierSelectionne})` } : m));
  return (
    <div class="ligne-import">
      <Icone nom="import" taille={16} classe="c3" />
      {largeur >= 340 && <span class="ligne-import__lib">Importer dans</span>}
      <Choix valeur={mode} options={options} onChange={(v) => actions.changerReglage("chutier", v)} libelle="Chutier de destination" />
      {projet && <span class="ligne-import__projet ell">· {projet.nom}</span>}
    </div>
  );
}

function ToastUnique() {
  const { actions } = useApp();
  const toast = useEtat((e) => e.toast);
  const ref = useRef<HTMLDivElement>(null);
  if (!toast) return null;
  const icone = toast.type === "ok" ? "check" : toast.type === "erreur" ? "error" : toast.type === "attention" ? "alert" : "info";
  return (
    <div
      ref={ref}
      key={toast.id}
      class={`toast toast--${toast.type}`}
      role={toast.type === "erreur" ? "alert" : "status"}
      aria-live={toast.type === "erreur" ? "assertive" : "polite"}
      onMouseEnter={() => actions.suspendreToast(true)}
      onMouseLeave={() => actions.suspendreToast(false)}
      onFocusCapture={() => actions.suspendreToast(true)}
    >
      <span class="toast__icone">
        <Icone nom={icone} taille={14} />
      </span>
      <div class="toast__corps">
        <b>{toast.titre}</b>
        {toast.texte && <span>{toast.texte}</span>}
      </div>
      {toast.action && (
        <button type="button" class="toast__action" onClick={() => { toast.action!.faire(); actions.fermerToast(); }}>
          {toast.action.libelle}
        </button>
      )}
      <BoutonIcone icone="close" libelle="Fermer" classe="bi--petit" onClick={actions.fermerToast} />
    </div>
  );
}
