# AETHRYON Setup — journal des versions

## 2.0.0-beta.8 — 2026-10-25

- AETHRYON Desktop 1.2.0-beta.2 : son assistant reconnaît le panneau AETHRYON 2.0.1 posé par ce setup (il cherchait encore l'ancien paquet UXP) et propose « Réparer avec AETHRYON Setup » s'il manque.
- Extension navigateur 3.8.1 (archive publiée, identique) et extension CEP 2.0.1 inchangées.

## 2.0.0-beta.7 — 2026-10-25

- AETHRYON Desktop 1.2.0-beta.1 « Nocturne » (nouveau design, AETHRYON Index, Transferts avec pause et reprise, Musique, Intégrations, Paramètres).
- Réparer et Mettre à jour gardent les réglages changés dans AETHRYON Desktop (dossier des médias, surveillance, démarrage avec Windows, notifications) ; avant, ils revenaient aux choix faits à l'installation.
- Extension navigateur 3.8.1 (archive publiée, identique) et extension CEP 2.0.1 inchangées.

## 2.0.0-beta.6 — 2026-10-24

- AETHRYON Desktop 1.1.0-beta.3 (« Coller un lien », relais « Envoyer vers › Premiere Pro » de l'extension, écran de démarrage, menu de la zone de notification).
- Extension CEP 2.0.1 (AETHRYON pour Premiere Pro) : le panneau importe les fichiers que lui envoie AETHRYON Desktop (commande « importer ») et écrit le résultat réel.
- Extension navigateur 3.8.1 posée dans le dossier géré (%LOCALAPPDATA%\AETHRYON\extension).

## 2.0.0-beta.5 — 2026-10-24

- AETHRYON Desktop 1.1.0-beta.2 (section Musique, liaison au compte AETHRYON, AETHRYON Cloud pour l'administrateur).
- Extension navigateur 3.8.0 inchangée, posée dans le dossier géré (%LOCALAPPDATA%\AETHRYON\extension).

## 2.0.0-beta.4 — 2026-10-23

- AETHRYON Desktop 1.1.0-beta.1 (bibliothèque renouvelée, glisser-déposer vers Premiere Pro, transferts en pipeline, chouette).
- Extension navigateur 3.8.0 posée dans le dossier géré (%LOCALAPPDATA%\AETHRYON\extension).

## 2.0.0-beta.3 — 2026-10-21

- Installe aussi l'extension navigateur dans son dossier géré (%LOCALAPPDATA%\AETHRYON\extension) et explique, à la fin, le chargement unique dans Chrome (« Charger l'extension non empaquetée »).
- `--mettre-a-jour` : lancé par AETHRYON Desktop, le setup part directement sur « Mettre à jour » de son mode maintenance.
- Désinstallation : le dossier de l'extension navigateur n'est retiré que si on le demande (case, ou `--supprimer-extension-navigateur`).
- AETHRYON Desktop 1.0.0-beta.4.

## 2.0.0-beta.2 — 2026-10-18

- Vraie extension CEP 2.0.0 signée ; remplace la bêta NSIS 1.0.0-beta.2.
