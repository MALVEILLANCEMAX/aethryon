# AETHRYON Index — moteur du scanner de médias locaux

*Branche `feat/index` (2026-10-25). Moteur seulement : l'écran du scanner est à faire par l'agent d'interface, à partir
de ce document, de `src/lib/index-medias.ts` et de la maquette `e2e/maquette-tauri.js`. Rien n'est publié.*

AETHRYON Index trouve les vidéos, audios et images d'un dossier, d'un ou plusieurs disques, ou de tous les disques
disponibles, les garde dans un index local persistant (SQLite) et les rend cherchables instantanément, dans l'esprit
d'« Everything ». Il fonctionne sans aucun logiciel supplémentaire ; Everything, s'il est installé et lancé, peut
servir d'accélérateur (facultatif, désactivé par défaut).

**Les fichiers d'origine ne sont jamais déplacés, renommés ni modifiés** : le moteur ne fait que lire le disque.
`R\bibliotheque\index.json` et le contrat avec le panneau Premiere (C-CONTRAT-ECHANGES.md §1 à §3) sont **inchangés** :
les fichiers scannés n'y vont jamais.

## 1. Où sont les choses

| Quoi | Où |
|---|---|
| Moteur | `noyau/src/index/` : `mod.rs` (façade `IndexMedias`), `parcours.rs`, `base.rs`, `volumes.rs`, `reglages.rs`, `enrichissement.rs`, `everything.rs`, `priorite.rs`, `essais.rs` |
| Commandes Tauri | `src-tauri/src/commandes_index.rs` (enregistrées dans `appli.rs`) |
| Client TypeScript | `src/lib/index-medias.ts` (+ `index-medias.test.ts`) |
| Maquette (captures, interface) | `e2e/maquette-tauri.js`, bloc « AETHRYON Index » |
| Réglages | `%APPDATA%\AETHRYON\index-medias.json` (privé au Desktop, hors contrat) |
| Index, cache, miniatures | `%LOCALAPPDATA%\AETHRYON\index\` par défaut (`index.sqlite`, `index.sqlite-wal`, `miniatures\<xx>\<n>.jpg`), déplaçable (ex. `D:\AETHRYON\Index`) |

## 2. Fonctionnement

### Volumes
`index_volumes` énumère les lecteurs Windows (`GetLogicalDriveStringsW`) : lettre, nom, type (`fixe`, `amovible`,
`reseau`, `optique`, `memoire`), système de fichiers, taille, espace libre, disponibilité et raison
(lecteur de cartes vide, réseau injoignable), lecteur `subst`, volume système. Chaque lecteur est interrogé sur son
propre fil (4 s au plus) et sans fenêtre « Insérez un disque ». L'identité d'un disque dans l'index est son **numéro
de série** : une clé USB rebranchée sous une autre lettre est reconnue, et ses chemins sont réécrits.

### Scan
- **Asynchrone** : `index_scan_lancer` répond tout de suite avec le numéro du scan. Le parcours tourne sur 1 à 4 fils
  dédiés (`fils`, 2 par défaut) et l'écriture sur un fil à part, jamais sur le fil de l'interface.
- **Priorité basse** : `THREAD_MODE_BACKGROUND_BEGIN` sur chaque fil de l'index (processeur, E/S et mémoire en
  arrière-plan). Le processus entier n'est pas mis en arrière-plan : l'interface, la surveillance des dossiers et le
  battement de 2 s du panneau Premiere en souffriraient.
- **Lecture Windows** : `GetFileInformationByHandleEx(FileIdBothDirectoryInfo)` donne, pour chaque entrée d'un dossier
  et en un seul appel par lot, le nom, la taille, les dates, les attributs, l'étiquette de point d'analyse et
  l'**identifiant de fichier NTFS**, sans ouvrir aucun fichier. Chemins `\\?\` (chemins longs). Repli sur `read_dir`.
- **Annulable** à tout moment (`index_scan_annuler`) : le lot en cours est validé, rien n'est marqué supprimé.
- **Progression réelle** (`index-progression`, 4 fois par seconde) : fichiers vus, dossiers, médias par type, octets,
  erreurs, liens ignorés, exclus, boucles évitées, bilan (nouveaux, modifiés…), débit, dossier courant.
  `mesurable` n'est vrai **que si un total réel existe** (mode Everything) ; sinon la progression est indéterminée et
  `fraction` vaut `null` : l'interface montre une animation indéterminée, jamais un pourcentage inventé.
- **Formats** (configurables par type, `extensions`) : vidéo `mp4 m4v mov mkv webm avi wmv mpg mpeg mpe m2v ts mts
  m2ts flv f4v 3gp 3g2 ogv vob mxf asf divx rm rmvb dv` ; audio `mp3 wav flac m4a aac ogg oga opus aiff aif aifc wma
  alac ape wv mka mpc ac3 caf amr` (l'ALAC est le plus souvent dans un `.m4a`) ; image `png jpg jpeg jpe jfif webp gif
  tif tiff bmp dib heic heif avif`. Un `.ts` n'est retenu que s'il a la forme d'un flux MPEG-TS (le TypeScript est
  ignoré). Fichiers vides, `._*` (macOS), `~$*`, `desktop.ini`, `Thumbs.db` : ignorés.
- **Exclusions** (configurables) : `\Windows`, `\Program Files`, `\Program Files (x86)`, `\ProgramData`,
  `\Windows.old`, `\$WinREAgent`, `\$SysReset`, `\$Windows.~BT`, `\$Windows.~WS`, `\Recovery`, `\PerfLogs`,
  `\Config.Msi` (relatifs à la racine du volume : `D:\Photos\Windows` n'est pas exclu), `AppData`, `$Recycle.Bin`,
  `System Volume Information`, `node_modules`, `.git` (un nom, jokers `*` `?` permis, à toute profondeur), et tout
  dossier caché ou système (`exclureCaches`). Une cible choisie explicitement n'est jamais exclue.
- **Liens symboliques, jonctions, points de montage** : non suivis par défaut (`liensIgnores`). Même suivis
  (`suivreLiens`), aucune boucle n'est possible : chaque dossier ouvert est identifié (volume + identifiant) et n'est
  jamais parcouru deux fois (`bouclesEvitees`) ; profondeur bornée à 128.
- **Erreurs d'accès** comptées et listées (200 premières) sans arrêter le scan ; un disque retiré pendant le scan ne
  fait jamais apparaître « Insérez un disque » (erreurs critiques coupées sur les fils de l'index).
- **Fichiers « en ligne seulement »** (OneDrive) : indexés, jamais ouverts (aucun téléchargement provoqué).

### Index et synchronisation
- SQLite **embarqué** (crate `rusqlite`, SQLite compilé avec l'application), journal WAL, transactions courtes : une
  coupure laisse l'index dans son dernier état validé ; le scan coupé est marqué `interrompu` au lancement suivant et
  proposé à la reprise (`EtatIndex.interrompu` → `lancerScan(interrompu)`, scan incrémental).
- **Incrémental** : un dossier inchangé ne coûte aucune écriture. Taille ou date changée → `modifie` (métadonnées et
  miniature refaites). **Renommé** ou **déplacé** (même identifiant de fichier, même taille, même date, ancien chemin
  disparu) → la même entrée suit le fichier (date d'ajout, métadonnées, miniature gardées). **Supprimé** → `absent`
  (masqué, gardé 7 jours). Sorti du périmètre (exclusion ajoutée, type désactivé) → retiré de l'index (`retires`).
- **Disque débranché** → ses fichiers sont `indisponible`, jamais effacés ; rebranché → `present`. Deux clés USB
  qui prennent tour à tour la même lettre ne sont jamais confondues : dans un dossier rescanné, les entrées de la clé
  absente sont retirées de l'index (elle est réindexée à son retour), ses autres fichiers restent `indisponible`.
- **Doublons d'index** : le même fichier vu par deux chemins (lien physique, lecteur `subst` — qui porte l'identité du
  volume NTFS sous-jacent —, lien suivi) n'apparaît
  qu'une fois (`doublons: n` sur l'entrée de référence ; `doublons: true` dans la requête pour tout voir).
- **Surveillance en direct** des **dossiers** ciblés après un scan (`surveiller`, ReadDirectoryChangesW par `notify`),
  jamais d'un disque entier : ajout, renommage, suppression, dossier déposé d'un coup.

### Métadonnées et miniatures (différées, en arrière-plan, après le scan)
- Audio : étiquettes par `lofty` (titre, artistes, album, année, durée, codec) et pochette intégrée.
- Vidéo : en-têtes MP4/MOV/M4V/3GP (durée, définition, i/s, codecs) ; la **miniature vient du WebView2** (élément vidéo +
  canvas), à la demande des cartes visibles : `etatMiniature: "webview"` → `analyserVisibles`.
- Image : définition ; miniature par le crate `image` (JPEG, PNG, GIF, WebP, BMP, TIFF ; orientation EXIF ; plafonds de
  taille, de pixels et de mémoire). HEIC/HEIF/AVIF : pas de décodeur (`impossible`).
- Miniatures JPEG 320 px dans `<emplacement>\miniatures\`. Les cartes visibles passent devant (`index_miniatures_demander`).

### Mode accéléré Everything (facultatif)
`everything: "auto"` : si Everything (voidtools) est lancé et sa base chargée, les médias des disques NTFS locaux sont
lus dans **son** index par l'IPC documentée du SDK (Everything 1.4, `WM_COPYDATA`, `EVERYTHING_IPC_QUERY2`), par pages de
5 000, avec une progression **mesurable** (Everything donne le total). Sinon, repli automatique et silencieux sur le
scanner natif. Ce qui a été retenu et pourquoi :
- protocole réimplémenté en Rust d'après `everything_ipc.h` et `Everything.c` du SDK officiel (licence MIT) : **aucune
  DLL** livrée ni chargée ; Everything est sous licence MIT et n'est jamais livré avec AETHRYON (l'utilisateur
  l'installe et le lance) ;
- pas d'`es.exe` (outil séparé), pas de SDK3 / tubes nommés d'Everything 1.5 (alpha) ; la fenêtre de l'instance
  « 1.5a » est essayée avec la même IPC, sans garantie ;
- Everything ne donne pas d'identifiant de fichier : en mode Everything, un renommage = suppression + ajout.

### Bibliothèque unifiée
Les médias d'`index.json` (dossiers surveillés) sont recopiés dans l'index à chaque changement de la bibliothèque,
avec la source `bibliotheque` et le **même identifiant** (SHA-1 du chemin). `bibliotheque_requete` sert les deux
sources d'un coup (recherche, filtres, tri, pagination). Un fichier présent des deux côtés est une seule entrée
(`sources: ["index", "bibliotheque"]`). Actions :
- média d'`index.json` (`estImportable`) : commandes existantes (`importer`, `envoyer_vers_premiere`, `media_action`…) ;
- média scanné ailleurs : `index_media_action` (ouvrir, Explorateur), `index_apercu` (lecture), glisser natif
  (`glisser_medias` accepte aussi ses identifiants) ; pour l'importer par le panneau Premiere : « Surveiller ce
  dossier » (`dossier_ajouter(element.dossier)`), qui le fait entrer dans `index.json` (contrat inchangé).

## 3. Commandes Tauri

| Commande | Arguments | Réponse |
|---|---|---|
| `index_volumes` | — | `VolumeIndex[]` (volume + `indexe` : fichiers, par type, indisponibles, dernier scan ; `cible`) |
| `index_reglages` | — | `ReglagesIndex` |
| `index_reglages_modifier` | `modif` (partiel : `cibles`, `types`, `extensions`, `exclusions`, `exclureCaches`, `suivreLiens`, `tailleMin`, `fils`, `everything`, `surveiller`, `metadonnees`, `miniatures`) | `ReglagesIndex` ; clé inconnue ou valeur fausse : refus, rien n'est changé |
| `index_scan_lancer` | `cibles: Cible[] \| null` (null : celles des réglages) | numéro du scan ; refus si un scan tourne |
| `index_scan_annuler` | — | `true` si un scan tournait |
| `index_etat` | — | `EtatIndex` (scan en cours, dernier résumé, scan interrompu, totaux, emplacement, taille, enrichissement, Everything, dossiers surveillés) |
| `index_resume` | `scan: number \| null` | `ResumeScan \| null` |
| `index_rechercher` | `requete: RequeteIndex` | `PageIndex` (sources index et everything) |
| `bibliotheque_requete` | `requete: RequeteIndex` | `PageIndex` (toutes les sources) |
| `index_media_action` | `id`, `action: "ouvrir" \| "explorateur"` | — |
| `index_apercu` | `id` | chemin (ouvert au protocole `asset:`, un fichier à la fois) |
| `index_miniatures_demander` | `ids` (cartes visibles, 200 au plus) | vidéos à analyser par le WebView2 (16 au plus) |
| `index_analyse_enregistrer` | `id`, `analyse {duree, largeur, hauteur, echec}`, `jpeg` (data URL) | — (JPEG décodé, réduit, réencodé) |
| `index_emplacement_deplacer` | `chemin` (dossier vide) | nouvel emplacement ; avancement `index-migration` |
| `index_everything` | — | `EtatEverything` |
| `index_retirer` | `chemin` | nombre de fichiers retirés de l'index (rien n'est touché sur le disque) |

Événements : `index-progression` (`ProgressionScan`), `index-fin` (`ResumeScan`), `index-changement`
(`index`, `bibliotheque`, `reglages`, `miniatures`), `index-enrichissement` (`Enrichissement`, mesurable),
`index-migration` (`Migration`). En fin de scan, fenêtre en arrière-plan : notification Windows « Scan terminé ».

### Requête (`RequeteIndex`)
`texte` (mots, **préfixes**, sans casse ni accents, cherchés dans le nom, l'extension et les étiquettes ; `dansChemin`
pour chercher aussi dans le chemin), `types`, `volumes` (`E:\`), `dossier` (récursif), `tailleMin`/`tailleMax`,
`modifieApres`/`modifieAvant` (ISO 8601), `etats` (défaut : présents et indisponibles), `sources`, `doublons`, `tri`
(`ajout` par défaut, `nom`, `taille`, `date`, `duree`, `chemin`, `type`), `ordre`, `page` (dès 1), `taillePage`
(1 à 500, défaut 100). L'interface ne charge jamais tout : `ChargeurPages` gère le défilement infini.

### États
- Fichier : `present`, `absent` (supprimé, 7 jours), `indisponible` (disque débranché).
- `etatBibliotheque` : état dans `index.json` (`disponible`, `en-cours`, `introuvable`, `erreur`) pour un dossier surveillé.
- Miniature : `a-faire`, `faite`, `echec`, `impossible`, `webview`.
- Scan : `termine`, `annule`, `erreur` ; `interrompu` dans l'historique après une coupure.

## 4. Exemples React

```tsx
import { useEffect, useState } from "react";
import { indexApi, evenementsIndex, libelleProgression, pourcentage, resumeCourt, cibleVolume, basculerVolume, iconeVolume, libelleVolume,
  type Cible, type ProgressionScan, type ResumeScan, type VolumeIndex } from "../lib/index-medias";

export function Scanner() {
  const [volumes, setVolumes] = useState<VolumeIndex[]>([]);
  const [cibles, setCibles] = useState<Cible[]>([]);
  const [p, setP] = useState<ProgressionScan | null>(null);
  const [fin, setFin] = useState<ResumeScan | null>(null);
  useEffect(() => {
    indexApi.volumes().then(setVolumes);
    indexApi.reglages().then((r) => setCibles(r.cibles));
    const a = evenementsIndex.progression(setP);
    const b = evenementsIndex.fin((r) => { setFin(r); setP(null); });
    return () => { a.then((f) => f()); b.then((f) => f()); };
  }, []);
  const pc = p ? pourcentage(p) : null; // null → animation indéterminée (jamais de pourcentage inventé)
  return (
    <section>
      {volumes.map((v) => (
        <button key={v.racine} disabled={!v.disponible} title={v.message ?? undefined} data-icone={iconeVolume(v)}
          onClick={() => setCibles((c) => basculerVolume(c, v, volumes))}>{libelleVolume(v)}</button>
      ))}
      <button onClick={async () => { await indexApi.modifierReglages({ cibles }); await indexApi.lancerScan(); }}>Lancer le scan</button>
      {p && <p role="status">{libelleProgression(p)} {pc == null ? <progress /> : <progress max={100} value={pc} />}</p>}
      {p && <button onClick={() => indexApi.annulerScan()}>Annuler</button>}
      {fin && <p>{resumeCourt(fin)}</p>}
    </section>
  );
}
```

Bibliothèque unifiée en défilement infini, miniatures des cartes visibles :

```tsx
import { ChargeurPages, indexApi, urlMiniatureIndex, analyserVisibles, estImportable } from "../lib/index-medias";
import { analyser } from "../analyse/Analyseur";

const chargeur = new ChargeurPages(indexApi.bibliotheque, { types: ["video"], tri: "ajout" }, 120);
await chargeur.reinitialiser({ texte: "plage" });            // première page
await chargeur.suivante();                                   // au bas de la liste
const visibles = chargeur.elements.slice(0, 24).map((e) => e.id);
await analyserVisibles(visibles, analyser);                  // vidéos : WebView2 ; images et pochettes : cœur
const src = urlMiniatureIndex(chargeur.elements[0]);         // <img src={src ?? repli} />
// Rafraîchir quand « index-changement » arrive (« index », « miniatures », « bibliotheque »).
```

## 5. Mesures (Linux, conteneur limité à 4 processeurs, compilation optimisée, `mesure_debit`)

| Mesure | Valeur |
|---|---|
| Premier scan, 100 000 fichiers (80 000 médias), 4 000 dossiers | 4,6 s, **21 800 fichiers/s** |
| Scan incrémental sans changement | 0,27 s, **375 000 fichiers/s** |
| Mémoire maximale du processus pendant le scan | **23 Mo** (VmHWM) |
| Recherche par préfixe (4 000 résultats / 32 000 résultats / aucun) | 25 ms / 57 ms / 0,3 ms (compte total compris) |
| Page 50, triée par nom, sur 80 000 | 13 ms |
| Taille de l'index | 32 Mo (424 octets par média) |

Sous Windows, le débit dépend du disque (HDD, SSD, réseau) et du cache du système : **NON MESURÉ** sur un vrai NTFS.

## 6. Limites connues

- Le vrai Windows (NTFS réel, disques amovibles, Everything réel, priorité d'arrière-plan, WebView2 pour les vidéos) est
  **NON DÉMONTRÉ** : procédure dans `TESTS-MANUELS.md` §H (essais 64 à 82).
- Volumes montés dans un dossier (sans lettre) : non énumérés (choisir le dossier comme cible). Deux disques clonés
  avec le même numéro de série : vus comme un seul volume.
- FAT32, exFAT, réseau : pas d'identifiant de fichier stable → un renommage y est vu comme suppression + ajout, et les
  doublons n'y sont pas détectés.
- Recherche : par mots et préfixes de mots (`clip` trouve « clip 7-3 été.mp4 », `lip` non), comme un moteur plein texte.
- Miniatures : HEIC/HEIF/AVIF, AVI/WMV/FLV non produites ; vidéos seulement à la demande (WebView2).
- Surveillance en direct : dossiers ciblés seulement (32 au plus) ; les disques entiers se rafraîchissent par un scan
  incrémental. État « indisponible » mis à jour à l'ouverture de l'écran du scanner (`index_volumes`), au démarrage et
  avant chaque scan.
- Import dans Premiere d'un média scanné hors des dossiers surveillés : par « Surveiller ce dossier » ou le glisser
  natif (le contrat avec le panneau n'a pas changé).

## 7. Licences des dépendances ajoutées (18 crates, toutes de crates.io)

`rusqlite` 0.41 (MIT), `libsqlite3-sys` 0.39 (MIT, SQLite compilé avec l'application ; SQLite : domaine public),
`hashlink`, `fallible-iterator`, `fallible-streaming-iterator`, `vcpkg` (MIT OU Apache-2.0) ; `zune-jpeg`, `zune-core`
(MIT OU Apache-2.0 OU Zlib), `gif`, `image-webp`, `half`, `weezl`, `quick-error` (MIT OU Apache-2.0), `tiff`, `fax`,
`color_quant`, `crunchy` (MIT). `image` 0.25, `png` et `libc` étaient déjà dans l'arbre (MIT OU Apache-2.0).
Everything : rien n'est livré (IPC seulement ; SDK et Everything sous licence MIT).
