//! Section MUSIQUE d'AETHRYON Desktop (cœur) : bibliothèque musicale tirée des médias audio déjà indexés (étiquettes et
//! pochettes lues par `lofty`, gardées À PART des fichiers), playlists, historique, fiches enregistrées et reprise de
//! lecture (`donnees`), appels au relais `/api/music/*` d'account avec la clé « desktop » (`client`), imports autorisés
//! suivis et rapatriés (`imports`). Aucun titre du catalogue commercial n'est jamais téléchargé : le serveur seul
//! décide qu'une source autorise le téléchargement, et le cœur n'envoie que le corps de l'action `importer`.

pub mod client;
pub mod donnees;
pub mod etiquettes;
pub mod imports;
