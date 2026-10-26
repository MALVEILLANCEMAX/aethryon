# Journal des versions — extension AETHRYON

Distribution directe depuis https://raccourci.malvu.fr/extension (ZIP à installer en mode développeur), jamais
sur un store. Chaque section `## <version> — AAAA-MM-JJ` alimente `release/latest.json` (scripts/zip.mjs) :
garder des lignes courtes, en français, qui disent ce qui change pour l'utilisateur.

## 3.8.1 — 2026-10-24

- « Envoyer vers › Premiere Pro » passe par AETHRYON Desktop, sans téléchargement par le navigateur : il convertit la vidéo (ou l'audio choisi) et le panneau AETHRYON l'importe dans Premiere Pro.
- Les vraies étapes s'affichent : envoyé à AETHRYON Desktop, conversion, réception du fichier, import, puis « Importé dans Premiere Pro ».
- Il faut AETHRYON Desktop 1.1.0-beta.3 et AETHRYON pour Premiere Pro à jour (AETHRYON Setup 2.0.0-beta.6) ; avec un Desktop plus ancien, un message dit de le mettre à jour.
- Si Premiere Pro n'est pas ouvert, s'il n'a aucun projet, ou si AETHRYON Desktop n'est pas relié à ton compte, un message clair dit quoi faire.

## 3.8.0 — 2026-10-23

- Extrait plus simple : une seule réglette, avec la durée du passage dans une bulle et la plage « 0:12.5 → 0:42.5 » en haut.
- La loupe est remplacée par une lentille qui n'apparaît que pendant le glisser : descends dedans pour régler à l'image près ; rien ne bouge quand tu lâches.
- « Début ici » et « Fin ici » reprennent l'instant du lecteur ; des durées en un clic : 15 s, 30 s, 1 min, 2 min ou Personnalisé.
- « Ajuster finement » ouvre le réglage précis : borne, ±1 image, champs Début, Fin et Durée.
- La limite du serveur n'apparaît qu'à l'approche ; au-delà, la poignée résiste et l'autre borne ne bouge plus toute seule.
- En GIF, le passage est gardé : seul son début est exporté, et c'est dit ; revenir en MP4 retrouve le passage entier.
- Le bouton dit tout (« Exporter 0:30 en MP4 ») et reste visible en bas du popup.

## 3.6.1 — 2026-10-21

- Bouton « Mettre à jour » dans le popup et les réglages : avec AETHRYON Desktop, la nouvelle version se télécharge, se vérifie et s'installe en un clic, plus besoin de récupérer le ZIP.
- Les vraies étapes s'affichent (téléchargement, vérification, installation), puis l'extension redémarre d'elle-même.
- Une seule fois : si ton navigateur charge l'extension depuis un autre dossier, le popup donne le chemin exact du dossier AETHRYON à charger.
- Sans AETHRYON Desktop, ou sans l'autorisation, la page de téléchargement reste proposée, comme avant.

## 3.6.0 — 2026-10-20

- Extrait repensé : une réglette à deux poignées sur toute la vidéo, même de 9 h, et une loupe pour régler à la milliseconde.
- Début et fin se tapent aussi au format 01:30:45.500 ; « 1:20 » ou « 80 » suffisent, et « Début = lecteur » / « Fin = lecteur » reprennent l'instant de la vidéo.
- Au clavier : flèches (1 image ou 100 ms), Maj (1 s), Alt (10 ms), Début et Fin, Tab d'une poignée à l'autre.
- La réglette suit le lecteur de la page : instant courant, clic pour y aller, lecture du passage.
- Plus de limite fixe de 30 s : la durée maximale d'un extrait et ton quota du jour viennent du serveur.
- Le passage exact part au serveur, qui ne récupère que cette portion ; les vraies étapes s'affichent, avec un pourcentage seulement quand il est mesuré.
- « Annuler » arrête la récupération ; un message clair dit quand une vidéo ne permet pas l'extraction partielle.
- Le même éditeur dans le popup, sur la vidéo de l'onglet.

## 3.5.2 — 2026-10-18

- Nouveau choix « Envoyer vers » › « Premiere Pro » (menu sous les vidéos, popup, réglages) : la vidéo ou l'audio va dans Téléchargements › AETHRYON.
- Le fichier arrive dans AETHRYON Desktop et dans le panneau AETHRYON de Premiere, prêt à importer : rien n'est importé sans toi.
- Avec AETHRYON Desktop, l'envoi est suivi en direct ; Chrome te demande une fois d'autoriser ce lien local, qui ne transmet ni compte ni jeton.
- Sans AETHRYON Desktop, le fichier arrive quand même, avec une ligne discrète : « Installe AETHRYON Desktop pour suivre l'envoi ».
- Vers Premiere, la vidéo arrive toujours en MP4 H.264 avec un son AAC, le format que Premiere lit ; « Auto » s'arrête à 1080p.
- Ton choix est gardé ; « Téléchargements » reste la destination par défaut et ne change rien aux autres fichiers.
- L'extension n'est plus marquée « bêta ».

## 3.5.1 — 2026-10-18 (jamais publiée)

- Version de travail, jamais distribuée : la destination « Premiere Pro » est reprise dans la 3.5.2, sans import automatique.

## 3.5.0 — 2026-10-16

- Un menu clair sous chaque vidéo : télécharger (MP4, avec la qualité), extraire l'audio (MP3, avec le débit), extrait rapide, image, miniature, continuer dans AETHRYON Tools.
- Seules les actions possibles sont proposées : une plateforme en pause ou un outil indisponible n'apparaît pas.
- Extrait rapide sur le lecteur de la page : choisis le début et la fin, revois le passage, puis exporte-le en MP4, MP3 ou GIF.
- « Continuer dans AETHRYON Tools » garde le passage choisi : l'éditeur s'ouvre avec ce début et cette fin.
- Pendant une conversion, le menu montre son avancement, avec « Annuler » puis « Afficher » une fois le fichier prêt.
- YouTube : une barre AETHRYON sous la vidéo, que tu peux replier en pastille ; ton choix est gardé.
- Popup : accès direct à AETHRYON Tools depuis la carte de ton compte.
- Au clavier : flèches pour passer d'une ligne à l'autre, → pour ouvrir, ← ou Échap pour revenir.

## 3.0.0 — 2026-10-15

- Popup repensé : la vidéo de l'onglet (durée, instant de lecture), un travail en cours affiché en premier, ou un lien à coller.
- Extrait instantané depuis l'instant de lecture : avant, autour ou après, de 10 à 60 s, en MP4, MP3 ou GIF.
- Image de la vidéo en PNG et miniature de la plateforme, enregistrées dans Téléchargements.
- « Ouvrir dans AETHRYON Tools » : le média déjà récupéré s'ouvre dans l'éditeur du site, sans nouveau téléchargement.
- Centre de téléchargements : extrait, GIF, image, miniature ; « Afficher dans le dossier » ; reprise après une mise en veille du navigateur.
- Outils rapides sous les vidéos (réglables), et réglages de l'extrait par défaut.
- La notice sur tes données décrit ces nouveautés : elle est redemandée une fois après la mise à jour ; connexion et réglages sont gardés.

## 1.0.0 — 2026-10-11

- Première version privée, à installer à la main depuis le site AETHRYON (aucun store).
- Télécharge en MP4 ou MP3 les vidéos YouTube, TikTok et X, avec le même compte et le même quota que le raccourci iPhone.
- Page d'accueil : installation confirmée, icône à épingler, notice sur tes données à accepter avant toute connexion.
- Connexion sécurisée au compte, révocable à tout moment dans « Mes jetons » ; raison affichée en cas de déconnexion.
- Quota du jour visible en haut du popup, avec l'heure de remise à zéro.
- Avis de nouvelle version : l'extension te prévient, sans jamais rien télécharger ni installer d'elle-même.
