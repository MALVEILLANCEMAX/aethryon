# AETHRYON Desktop — Flux (glisser-déposer) : le socle technique

> Branche `feat/flow-natif` (2026-10-23). Socle SANS visuel : l'agent d'interface branche ses zones, ses cartes et ses
> animations dessus. **Le glisser natif vers Premiere Pro et l'Explorateur est NON DÉMONTRÉ** : il n'existe que sous
> Windows et n'a jamais tourné sur un vrai PC (procédure : `TESTS-MANUELS.md`, section F).

## 1. Ce que fait le socle

| Cas | Comment | Où |
|---|---|---|
| Glisser une carte HORS de la fenêtre (Premiere Pro : panneau Projet ou timeline ; Explorateur) | vrai glisser de fichiers du système (OLE `DoDragDrop`, objet de données du Shell, comme l'Explorateur) ; effets **copie** ou **lien** seulement, jamais de déplacement | `src-tauri/src/glisser.rs` |
| Survol de la fenêtre (nos médias ou des fichiers externes) | événements de dépôt de Tauri 2 (`enter`, `over`, `drop`, `leave`) avec chemins et position ; zone visée retrouvée par la position | `src/lib/flux.ts` |
| Déposer un média sur la zone `premiere` | « Envoyer vers Premiere » : commande `importer` du contrat §5, états RÉELS (envoyé, importé, échec, non connecté, expiré) | `flux.ts`, `noyau/src/service.rs` |
| Déposer des fichiers externes sur la zone `bibliotheque` | COPIE atomique dans le dossier des médias, sans doublon, avec progression ; la bibliothèque les montre « en cours » puis « disponibles » | `noyau/src/flux.rs` |
| Déposer un dossier externe | jamais copié : proposition « Surveiller ce dossier » (commande existante `dossier_ajouter`) | `flux.ts` |

Le glisser-déposer HTML5 de la WebView n'est PAS utilisé : sous Windows, quand le dépôt de fichiers de Tauri est actif
(`dragDropEnabled: true`, réglage par défaut, écrit dans `tauri.conf.json`), les événements `dragover`/`drop` du DOM
ne reçoivent rien. Tout passe par les événements de Tauri.

## 2. Démarrage rapide (React)

```tsx
// Un seul contrôleur pour l'application (par exemple dans magasin.tsx).
import { useEffect, useSyncExternalStore } from "react";
import { creerFlux, type EtatFlux } from "../lib/flux";

let dernier: Instantane | null = null; // tenu à jour par le magasin à chaque setInst(…)
export const flux = creerFlux({
  // Facultatif : ce que l'interface sait déjà (refus immédiat si Premiere n'est pas relié, média « en cours »…).
  contexte: () => ({ premiereConnecte: dernier?.liaison.connecte ?? null, medias: dernier?.index.medias, chutier: dernier?.config.chutierParDefaut }),
});

// UNE fois, au niveau de l'application (fournisseur du magasin) :
useEffect(() => { void flux.demarrer(); return () => { void flux.arreter(); }; }, []);

// Partout ailleurs, seulement l'abonnement :
export const useFlux = (): EtatFlux => useSyncExternalStore(flux.abonner, flux.etat);
```

Zones : n'importe quel élément marqué `data-zone`. Les éléments enfants comptent (recherche par `closest`).

```tsx
<aside data-zone="premiere">…</aside>          {/* envoyer vers Premiere Pro */}
<main data-zone="bibliotheque">…</main>        {/* importer des fichiers, surveiller un dossier */}
```

Départ d'un glisser natif depuis une carte (seuil de quelques pixels, bouton tenu) :

```tsx
function Carte({ m, selection }: { m: Media; selection: string[] }) {
  const depart = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      draggable={false}                       // jamais de glisser HTML5 (image, texte)
      style={{ userSelect: "none" }}
      onPointerDown={(e) => { if (e.button === 0) depart.current = { x: e.clientX, y: e.clientY }; }}
      onPointerMove={(e) => {
        const d = depart.current;
        if (!d || (e.buttons & 1) === 0) return;
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
        depart.current = null;
        const ids = selection.includes(m.id) ? selection : [m.id];
        flux.glisserMedias(ids).catch((err) => toast({ etat: "erreur", titre: "Glisser impossible", texte: err.message }));
      }}
      onPointerUp={() => (depart.current = null)}
      onPointerCancel={() => (depart.current = null)}  // Windows prend la souris au début du glisser
    />
  );
}
```

Échap pendant un glisser natif est géré par Windows (annulation). `flux.annuler()` sert aux autres cas (par exemple
un raccourci de l'interface) : il arrête aussi le glisser natif s'il y en a un.

## 3. API de `src/lib/flux.ts`

### Contrôleur : `creerFlux(options?) → Flux`

| Membre | Rôle |
|---|---|
| `demarrer()` | installe les 6 écouteurs (idempotent) |
| `arreter()` | retire TOUS les écouteurs, minuteries, marques DOM ; coupe les suivis d'envoi (idempotent, sûr même pendant `demarrer`) |
| `etat()` | instantané immuable `EtatFlux` (même objet tant que rien ne change : `useSyncExternalStore`) |
| `abonner(f)` | notifié au plus une fois par image (`requestAnimationFrame`) ; renvoie le désabonnement |
| `glisserMedias(ids)` | lance un glisser natif (IDENTIFIANTS d'index) ; promesse résolue quand Windows a démarré le glisser, rejetée si refus (« n'est pas disponible », « déjà en cours », hors Windows) |
| `annuler()` | éteint le survol en cours et arrête le glisser natif lancé par AETHRYON |
| `accepterProposition(id, chemin?)` / `refuserProposition(id)` | « Surveiller ce dossier » (un dossier précis ou tous) |
| `annulerImport(lot)` | arrête un import ; le fichier en copie est abandonné, son `.part` retiré |
| `oublier(id)` | retire une opération terminée de la liste |
| `definirZone(nom, regle)` | zone propre à l'interface (ex. `transferts`, `export`) : `regle.verdict(classement, contexte, provenance)` et `regle.deposer(classement, contexte)` ; renvoie le retrait |

Options : `contexte()` (voir ci-dessus), `marquerZones` (défaut `true`), `dependances` (essais).

### Fonctions utilisables seules

| Fonction | Rôle |
|---|---|
| `envoyerVersPremiere(ids, chutier?) → SuiviEnvoi` | `etat()`, `abonner(f)`, `fin` (promesse de l'état final), `arreter()` |
| `importerFichiers(chemins, { lot?, surProgression? }) → Promise<BilanImport>` | import de chemins remis par le système (dépôt, sélecteur) |
| `annulerImport(lot)`, `glisserMedias(ids)`, `annulerGlisser()`, `classer(chemins)` | appels directs au cœur |
| `verdictPour(zone, classement, contexte, provenance, regle?)`, `versCss(point, ratio)`, `normaliser`, `memesChemins` | fonctions pures (testées) |

Le bouton « Ajouter des fichiers… » peut passer par le même import : `api.choisirFichiers()` note les chemins choisis
comme « remis par le système », puis `importerFichiers(chemins)` les copie (atomique, sans doublon, progression).
`api.ajouterFichiers` (copie directe, ancienne) reste en place tant que l'interface n'a pas basculé.

## 4. États

### `EtatFlux`

```ts
{ survol: EtatSurvol, glisser: EtatGlisser | null, operations: Operation[] }
```

**`EtatSurvol`** (un glisser au-dessus de la fenêtre) :

| Champ | Valeurs |
|---|---|
| `actif` | `true` entre `enter` et `drop`/`leave` |
| `provenance` | `aethryon` (glisser natif lancé par `glisserMedias`), `externe` (Explorateur, bureau…) |
| `chemins` | chemins remis par Windows |
| `classement` | `null` pendant l'analyse par le cœur, puis `{ medias, fichiers, dossiers, refuses }` |
| `position` | pixels CSS du viewport (convertis depuis les pixels physiques de Tauri par `devicePixelRatio`) |
| `zone` | valeur `data-zone` sous le curseur, ou `null` |
| `verdict` | `{ acceptable, actions, raison, enAttente? }` : ce que ferait un dépôt ICI |

**`EtatGlisser`** (glisser natif d'AETHRYON, y compris HORS de la fenêtre) : `{ jeton, ids, chemins, phase: "demarrage" | "en-cours" }`.
Il disparaît à la fin (`flux-glisser-fin`).

**`Operation`** (suites des dépôts, de la plus ancienne à la plus récente) :

| `type` | Contenu |
|---|---|
| `envoi` | `ids`, `chutier`, `envoi: EtatEnvoi` |
| `import` | `lot`, `fichiers`, `progression` (dernier avis), `bilan` (fin), `erreur` |
| `surveiller` | `dossiers`, `etat: proposee → en-cours → acceptee / refusee / erreur`, `message` |
| `glisser` | `fin: FinGlisser` (dépôt dans une AUTRE application, ou erreur du glisser) |
| `refus` | `zone`, `raison` (dépôt impossible : retour doux à afficher) |
| `zone` | zone de l'interface : `etat: en-cours → fait / erreur`, `message` |

### Verdicts des zones prédéfinies

| Zone | Contenu glissé | Verdict |
|---|---|---|
| `premiere` | médias de la bibliothèque | accepté → `envoyer-premiere` |
| `premiere` | panneau non relié (`contexte.premiereConnecte === false`) | refusé « Premiere Pro n'est pas connecté… » |
| `premiere` | média « en cours » / introuvable (si `contexte.medias`) | refusé « « X » n'est pas disponible pour l'instant. » |
| `premiere` | fichiers externes | refusé « Ajoutez d'abord ces fichiers à la bibliothèque… » |
| `bibliotheque` | fichiers externes importables | accepté → `importer` |
| `bibliotheque` | dossier surveillable | accepté → `surveiller` (proposition, pas de copie) |
| `bibliotheque` | nos médias | refusé « Déjà dans la bibliothèque. » |
| `bibliotheque` | type non pris en charge, trop gros, dossier système… | refusé avec la raison du cœur |
| autre | — | refusé, sauf règle `definirZone` |

`verdict.enAttente === true` : le classement n'est pas encore arrivé (quelques millisecondes ; plus sur un disque réseau).

### `EtatEnvoi` (réel, jamais inventé)

| État | Quand |
|---|---|
| `envoi` | la demande part au cœur |
| `envoye` (`nom`) | commande `importer` déposée pour le panneau |
| `importe` (`message`, `le`) | le panneau a écrit `ok: true` (son message : « 2 importés dans « AETHRYON » (Montage-voyage) ») |
| `echec` (`message`) | le panneau a écrit `ok: false` (« Aucun projet ouvert… ») ou le cœur a refusé (média indisponible…) |
| `non-connecte` (`message`, `age`) | le panneau ne bat plus depuis 15 s : **rien n'est envoyé** |
| `expire` (`message`) | 2 minutes sans réponse (expirée par le Desktop ou par le panneau) |

### `FinGlisser` (événement `flux-glisser-fin`)

`{ jeton, resultat: depose | annule | erreur, effet: copie | lien | aucun, cible: interne | externe | inconnue, application, fichiers, message }`.
**`depose` veut dire qu'une cible a ACCEPTÉ le dépôt** (curseur « + Copier ») ; ce n'est PAS une confirmation d'import
par Premiere Pro (le glisser vers Premiere ne passe pas par le panneau). `application` = exécutable sous le curseur
(« Adobe Premiere Pro.exe », « explorer.exe »), sans dossier, seulement pour un dépôt externe accepté.

## 5. Crochets CSS (posés par le flux, sans aucun style)

| Attribut | Où | Valeurs |
|---|---|---|
| `data-flux-etat` | zone survolée | `accepte`, `refuse`, `attente` |
| `data-flux` | `<html>` | `aethryon` ou `externe` pendant un survol |
| `data-flux-glisser` | `<html>` | présent pendant un glisser natif d'AETHRYON (même hors de la fenêtre) |

`creerFlux({ marquerZones: false })` les désactive (l'interface lit alors seulement `etat()`).

## 6. Commandes et événements Tauri

| Commande | Arguments | Réponse |
|---|---|---|
| `glisser_medias` | `ids: string[]` (200 au plus) | `{ jeton, chemins }` quand `DoDragDrop` a démarré |
| `glisser_annuler` | — | `true` si un glisser était en cours |
| `flux_classer` | `chemins` | `Classement` (seuls les chemins remis par le système sont examinés) |
| `importer_fichiers` | `lot`, `chemins` | `BilanImport` (après la copie) |
| `importer_annuler` | `lot` | `true` si l'import était en cours |
| `envoyer_vers_premiere` | `ids`, `chutier?` | `{ etat: "envoye", nom }` ou `{ etat: "non-connecte", message, age }` |

| Événement | Charge |
|---|---|
| `tauri://drag-enter` / `drag-over` / `drag-drop` / `drag-leave` | `{ paths?, position }` en pixels PHYSIQUES relatifs à la WebView (Tauri) |
| `flux-glisser-fin` | `FinGlisser` |
| `flux-import` | `ProgressionImport` (`etape: verification / copie / termine`, `fait`, `taille`, `faitLot`, `tailleLot`), 10 par seconde au plus |
| `flux-import-fin` | `BilanImport` |
| `resultat-commande` | `ResultatEnvoi` (+ `expire`) — existant |

## 7. Règles du cœur

- **Identifiants, jamais de chemins libres** : `glisser_medias` et `envoyer_vers_premiere` prennent des identifiants
  d'index ; le cœur relit le chemin, vérifie qu'il est dans un dossier surveillé, que le média est « disponible » et
  que c'est un fichier ordinaire existant.
- **Exception cadrée (fichiers externes)** : le cœur note LUI-MÊME les chemins que Windows remet (événement de survol
  ou de dépôt de la fenêtre, sélecteur de fichiers), 10 minutes, 16 lots au plus, en mémoire seulement. Un chemin
  renvoyé par l'interface qui n'y figure pas est refusé « hors périmètre » sans être lu. Le survol permet le classement,
  pas l'import.
- **Import** : fichiers ordinaires seulement (pas de lien symbolique), extensions de l'index (vidéo, audio, image),
  16 Go par fichier, 64 Go par dépôt, 200 fichiers par dépôt, 2 Go laissés libres sur le disque après la copie ;
  COPIE vers `<nom propre et unique>.part` créé en exclusivité, vidé sur le disque, date d'origine gardée, puis renommé
  SANS écrasement (`MoveFileExW` sans remplacement) ; aucun `.part` laissé en cas d'échec ou d'annulation ; doublons
  reconnus (même chemin, fichier déjà dans un dossier surveillé, contenu identique octet par octet à un média de la
  bibliothèque ou du même dépôt) → « déjà là », rien de copié.
- **Envoyer vers Premiere** : rien n'est déposé si le battement du panneau a plus de 15 s (contrat v1.1 §9).

## 8. Pièges connus (Windows, WebView2)

- Cartes : `draggable={false}`, `user-select: none` ; sinon Chromium démarre son propre glisser (image, texte).
- Le glisser natif part d'un `pointermove` bouton TENU ; si le bouton est relâché avant que Windows ne prenne la main,
  rien n'est glissé (`flux-glisser-fin` : `annule`, « Bouton de la souris relâché… »).
- Pendant un glisser natif, la WebView ne reçoit plus d'événements souris (Windows a la souris) : `pointerup` ne vient
  pas ; l'état revient par `flux-glisser-fin`. Prévoir `pointercancel`.
- Un dépôt sur la fenêtre arrive par `tauri://drag-drop`, parfois APRÈS `flux-glisser-fin` (le flux attend 1,5 s).
- Tauri ajoute de lui-même les fichiers (et dossiers) DÉPOSÉS à la portée du protocole `asset:` (comportement de
  Tauri 2.12.4) : l'aperçu d'un fichier externe déposé est donc possible ; rien d'autre n'est ouvert.

## 9. Essais

- `cargo test -p aethryon-noyau` : `flux::tests` (accords, classement, copie atomique, nom unique, doublons, refus,
  dossier refusé, annulation, partiel « en cours », renommage sans écrasement) et `service::tests::flux_de_bout_en_bout`.
- `glisser::windows_impl::essais` (compilés pour Windows, exécutés sous Wine par `scripts/construire.sh`) : image de
  glisser (miniature JPEG décodée et réduite par WIC, alpha opaque, aucune couleur transparente, repli sur l'icône),
  source OLE (Échap, bouton relâché, tenu, annulation). L'objet de données du Shell n'est PAS vérifiable sous Wine 8
  (`BindToHandler` et `SHCreateDataObject` y renvoient E_NOTIMPL) : l'essai le dit et passe.
- `npx vitest run src/lib/flux.test.ts` : événements Tauri SIMULÉS (bus, commandes, zones, temps).
- `node e2e/flux-banc.mjs` : Chromium à 150 %, vrai `flux.ts`, vrai `@tauri-apps/api`, maquette de l'API Tauri, vraies
  zones DOM (`elementFromPoint`, attributs posés et retirés, écouteurs remis à zéro).
- Maquette pour Playwright (`e2e/maquette-tauri.js`) : `window.__maquette.flux.entrer(chemins, x, y)`, `survoler(x, y)`,
  `deposer(chemins, x, y)`, `sortir()`, `deposerAilleurs(application?)`, `relacher()`, `glisser()`, `ecouteurs(evenement?)`
  (coordonnées CSS, converties en pixels physiques comme Tauri). Scénarios : `premiereDeconnecte`, `envoiExpire`,
  `envoiEchec`, `delaiPanneau`, `importLent`.

## 10. NON DÉMONTRÉ (Windows réel requis)

Glisser natif vers Premiere Pro (panneau Projet, timeline) et vers l'Explorateur ; image de glisser ; effets copie/lien ;
nom de l'exécutable cible ; capture de la souris prise à la WebView2 ; événements de dépôt de wry pendant NOTRE glisser ;
dépôt de fichiers depuis l'Explorateur ; `MoveFileExW` sur NTFS avec un antivirus ; mise à l'échelle 125–200 %.
