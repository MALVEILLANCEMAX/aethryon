// Script de démarrage du thème, sans flash, compatible avec la CSP stricte du site (script-src 'self') : construit en
// fichier EXTERNE genere/theme-boot.js (aucun script en ligne), chargé de façon bloquante en tête de <head>.
// Autonome (aucun import : < 1 Ko minifié) : il ne lit que le CACHE écrit par persistance.ts (clé CLE_APPARENCE) et
// n'écrit que des attributs data-eg-* aux valeurs fermées et des variables --eg-* qui sont des couleurs #RRGGBB ou des
// nombres. Rien d'autre n'est jamais posé ; tout écart (JSON abîmé, valeur inattendue) est ignoré. Sans préférence :
// rien n'est fait, la feuille egide.css donne Obsidian.
(() => {
  try {
    const p = JSON.parse(localStorage.getItem("aethryon.apparence.v1") || "null");
    const c = p && p.v === 1 && p.cache;
    if (!c) return;
    const d = document.documentElement;
    for (const k in c.attrs) {
      const v = c.attrs[k];
      if (/^data-eg-[a-z-]{2,24}$/.test(k) && typeof v === "string" && /^[a-z0-9-]{1,16}$/.test(v)) d.setAttribute(k, v);
    }
    for (const k in c.vars) {
      const v = c.vars[k];
      if (/^--eg-[a-z0-9-]{1,32}$/.test(k) && typeof v === "string" && /^(#[0-9A-Fa-f]{6}|\d{1,3}(\.\d{1,4})?(px)?)$/.test(v)) d.style.setProperty(k, v);
    }
  } catch {
    // stockage refusé ou enregistrement abîmé : Obsidian (feuille egide.css)
  }
})();
export {};
