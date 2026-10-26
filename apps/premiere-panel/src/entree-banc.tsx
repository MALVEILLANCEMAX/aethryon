// Entrée BANC (essai de bout en bout) : Premiere simulé, réseau et disque réels par Node. Jamais livrée.
import type { ConfigServeur } from "./api/client";
import { creerHoteBanc } from "./hote/banc";
import { horsPremiere, monter } from "./monter";

const config = (window as unknown as { __AETHRYON_BANC_CONFIG__?: ConfigServeur }).__AETHRYON_BANC_CONFIG__;
if (!window.__banc || !config) horsPremiere("Banc d’essai : pont Node absent.");
else {
  const app = monter(creerHoteBanc(), config);
  (window as unknown as { __app: typeof app }).__app = app;
}
