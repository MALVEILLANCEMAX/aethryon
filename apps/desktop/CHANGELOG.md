# AETHRYON Desktop — journal des versions

Chaque section « ## <version> — AAAA-MM-JJ » donne les notes de l'annonce de mise à jour
(`downloads/desktop/latest.json`, écrite par `web/scripts/latest-desktop.py`).

## 1.3.0-beta.1 — 2026-10-26

- Nouvelle apparence « Égide », commune au site et à l'extension : la navigation à gauche, la conversion au centre et « Le fil » de tes transferts à droite (masquable), titres en Marcellus, icônes redessinées.
- Six thèmes (Obsidian, Ivory, OLED, Midnight, Minimal, Custom) et un éditeur dans Paramètres › Apparence : accent, fonds, arrondis, densité, taille du texte, animations ; aperçu immédiat, contrastes vérifiés, import et export (Copier, Télécharger), réinitialisation. Le thème s'applique dès l'ouverture, écran de démarrage et menu de la zone de notification compris.
- « Coller un lien » reconnaît la plateforme et dit son état réel (en ligne, en préparation, indisponible, non prise en charge) ; Bluesky et Wikimedia Commons se convertissent aussi depuis AETHRYON Desktop, en MP4 ou en MP3 (Wikimedia : auteur, licence et source écrits dans le fichier).
- Le fil : chaque transfert avec son étape, les octets reçus et le débit réels ; Pause, Reprendre et Annuler pour les conversions lancées depuis AETHRYON Desktop, aussi au clavier (Espace, Suppr).
- La chouette d'AETHRYON garde son dessin officiel : une médaille au repos, un fil qui tourne autour pendant un traitement, un sceau à la réussite ; plus de 3D.
- Animations plus légères ; « Réduire les animations » et le réglage de Windows sont respectés partout.
- Toutes les fonctions restent : bibliothèque et AETHRYON Index, Musique, Cloud, glisser-déposer vers Premiere Pro, mises à jour en un clic. L'extension navigateur 3.8.1 et le panneau AETHRYON 2.0.1 pour Premiere Pro ne changent pas.

## 1.2.0-beta.2 — 2026-10-25

- L'assistant d'installation et de réparation reconnaît le panneau AETHRYON pour Premiere Pro installé par AETHRYON Setup : « Panneau AETHRYON 2.0.1 installé », au lieu de « Paquet absent · paquet du panneau absent ».
- Si le panneau manque, un bouton « Réparer avec AETHRYON Setup » télécharge le setup publié (vérifié) et l'ouvre sur « Réparer » ; si ce n'est pas possible, la page de téléchargement s'ouvre.
- Intégrations et Paramètres affichent l'état réel du panneau, et le bon menu : Fenêtre › Extensions › AETHRYON.

## 1.2.0-beta.1 — 2026-10-25

- Nouveau design « Nocturne » : coque refaite (barre latérale, en-tête avec Premiere Pro, le dossier des médias et le compte) et chouette d'AETHRYON en relief, qui suit le pointeur et réagit à ce que vous faites.
- Accueil : « Coller un lien » en premier et vos vrais chiffres. Bibliothèque pensée pour des milliers de médias (seules les cartes visibles sont dessinées), aperçu au survol et détails (Alt Entrée).
- AETHRYON Index : scannez un dossier, un disque ou tous vos disques ; vos vidéos, sons et images apparaissent dans la Bibliothèque (Tout, Mes dossiers, Scannés), sans qu'aucun fichier soit modifié. « Surveiller ce dossier » les prépare pour Premiere Pro.
- Transferts : octets reçus et débit réels ; Pause et Reprendre pendant la réception, Annuler à toute étape, pour les conversions lancées depuis AETHRYON Desktop.
- Musique : carte « En écoute » et égaliseur qui suit le vrai son du morceau.
- Intégrations : une carte par service (Premiere Pro, extension navigateur, compte) avec son état réel et l'action utile.
- Paramètres rangés en 9 catégories, avec une aide « i » sur chaque option, dont la nouvelle catégorie AETHRYON Index.
- La mise à jour garde vos réglages (dossier des médias, notifications, démarrage avec Windows) ; l'extension navigateur 3.8.1 et le panneau AETHRYON 2.0.1 pour Premiere Pro ne changent pas.

## 1.1.0-beta.3 — 2026-10-24

- « Coller un lien » sur l'Accueil : collez le lien d'une vidéo YouTube, TikTok ou X et choisissez Vidéo MP4 ou Audio MP3 ; AETHRYON Desktop la convertit avec votre compte relié (mêmes quotas que l'extension), l'avancement réel s'affiche dans Transferts, puis le fichier arrive dans la bibliothèque.
- Depuis l'extension navigateur 3.8.1, « Envoyer vers › Premiere Pro » passe par AETHRYON Desktop, sans téléchargement par le navigateur : il convertit la vidéo ou l'audio, l'enregistre dans la bibliothèque, puis le panneau AETHRYON l'importe dans Premiere Pro (chutier AETHRYON).
- Écran de démarrage : si l'ouverture prend du temps, la chouette d'AETHRYON et les vraies étapes du démarrage s'affichent, sans attente ajoutée ni faux pourcentage.
- Nouveau menu de la zone de notification (clic droit sur l'icône d'AETHRYON) : Ouvrir AETHRYON, Ouvrir le dossier des médias, Quitter AETHRYON, aussi au clavier ; le menu classique de Windows reste en secours.
- Le setup installe aussi l'extension navigateur 3.8.1 et le panneau AETHRYON 2.0.1 pour Premiere Pro, qui importe désormais les fichiers envoyés par AETHRYON Desktop (« Envoyer vers Premiere » de la bibliothèque compris).

## 1.1.0-beta.2 — 2026-10-24

- Musique : nouvelle section (Ctrl 3) qui rassemble vos fichiers audio déjà présents dans la bibliothèque, par titres, albums et artistes, avec la qualité réelle de chaque fichier.
- Lecteur intégré : file d'attente, aléatoire, répétition, playlists réorganisables à la souris ou au clavier, reprise de la lecture là où vous l'aviez laissée, touches multimédia de Windows.
- Liens musicaux : Spotify, Apple Music, SoundCloud et Deezer s'ouvrent dans leur lecteur officiel ou dans leur application, sans aucun téléchargement ; les liens YouTube Music sont refusés.
- Imports seulement depuis les sources qui l'autorisent (Internet Archive et Wikimedia Commons sous licence libre, podcasts, fichiers audio dont vous déclarez avoir les droits), avec un compte relié et dès que le service est ouvert.
- Liaison au compte AETHRYON, dès son ouverture sur le site : Paramètres › Compte, un code à confirmer sur le site ; la clé est gardée chiffrée par Windows et révocable dans « Mes jetons ».
- AETHRYON Cloud, réservé à l'administrateur et ouvert plus tard : sauvegarde de 30 jours, jauge du quota, aperçu, téléchargement et lien temporaire.

## 1.1.0-beta.1 — 2026-10-23

- Bibliothèque renouvelée : cartes avec case de sélection, menu contextuel sous le pointeur et complet au clavier.
- Glisser-déposer vers Premiere Pro : faites glisser une carte de la bibliothèque dans Premiere Pro ou l'Explorateur ; déposez des fichiers sur la fenêtre pour les ajouter.
- Transferts en pipeline : chaque envoi de l'extension montre ses étapes réelles, de la demande jusqu'à Premiere Pro.
- La chouette d'AETHRYON accompagne votre travail dans la barre latérale (réglage « Présence de la chouette » : Discrète, Expressive, Muette).
- Mouvement réduit respecté partout : jamais une fausse progression.
- Le setup installe aussi l'extension navigateur 3.8.0 dans le dossier AETHRYON.

## 1.0.0-beta.4 — 2026-10-21

- Mise à jour en un clic de l'extension navigateur : « Mettre à jour » dans l'extension, AETHRYON Desktop télécharge, vérifie et installe la nouvelle version.
- Paramètres › Mises à jour : « Rechercher les mises à jour » et « Mettre à jour » (setup vérifié, puis fermeture propre).
- Avis discret dans la barre latérale quand une nouvelle version est publiée.
- Téléchargements en HTTPS seulement, sans redirection, empreinte SHA-256 vérifiée avant toute installation.

## 1.0.0-beta.3 — 2026-10-18

- Fenêtre sans bordure blanche (ombre et coins par DWM) ; installé par AETHRYON Setup v2.
