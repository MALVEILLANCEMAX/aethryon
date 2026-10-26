// Entrée de la future coque UXP + <webview> (plan E3) : compile, non livrée dans le paquet CEP.
import { PRODUCTION } from "./api/client";
import { creerHoteUxpWebview, uxpPresent } from "./hote/uxp-webview";
import { horsPremiere, monter } from "./monter";

if (!uxpPresent()) horsPremiere("Cette interface s’ouvre dans le plugin UXP AETHRYON (webview).");
else monter(creerHoteUxpWebview(), PRODUCTION);
