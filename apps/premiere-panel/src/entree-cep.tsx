// Entrée de la coque CEP (paquet livré) : uniquement l'hôte CEP, jamais la maquette.
import { PRODUCTION } from "./api/client";
import { cepPresent, creerHoteCep } from "./hote/cep";
import { horsPremiere, monter } from "./monter";

if (!cepPresent()) {
  horsPremiere("Ce panneau s’ouvre dans Adobe Premiere Pro : Fenêtre › Extensions › AETHRYON.");
} else {
  try {
    monter(creerHoteCep(), PRODUCTION);
  } catch (e) {
    horsPremiere("Le panneau AETHRYON n’a pas pu démarrer : " + (e instanceof Error ? e.message : String(e)));
  }
}
