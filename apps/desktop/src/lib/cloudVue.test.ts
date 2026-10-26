import { describe, expect, it } from "vitest";
import { cloudOuvert, envoisActifs, fusionner } from "./compte";
import { dureeLien, envoiPossible, erreurLisible, expiration, fraction, jauge, libelleTransfert, octetsCloud, raisonSansCloud, statutObjet, typeCloud } from "./cloudVue";
import type { EtatCompte, TransfertCloud } from "./types";

const NB = "\u00A0";
const compte = (p: Partial<EtatCompte>): EtatCompte => ({
  relie: true, compte: { email: "a@example.test", nom: "A" }, administrateur: true, cloud: { disponible: true, raison: null },
  cleExpireLe: null, relieLe: null, appairage: null, erreur: null, horsLigne: false, verifieLe: null, ...p,
});
const t = (p: Partial<TransfertCloud>): TransfertCloud => ({
  id: "env-1", sens: "envoi", mediaId: "m", objetId: null, nom: "Clip.mp4", taille: 1000, etape: "attente", fait: 0, total: 1000,
  statut: null, code: null, message: null, chemin: null, creeLe: "2026-10-23T10:00:00Z", finiLe: null, ...p,
});

describe("section CLOUD : visible seulement pour l'administrateur, cloud ouvert", () => {
  it("cloudOuvert", () => {
    expect(cloudOuvert(compte({}))).toBe(true);
    expect(cloudOuvert(compte({ administrateur: false, cloud: { disponible: false, raison: "non_admin" } }))).toBe(false);
    expect(cloudOuvert(compte({ cloud: { disponible: false, raison: "ferme" } }))).toBe(false);
    expect(cloudOuvert(compte({ relie: false }))).toBe(false);
    expect(cloudOuvert(null)).toBe(false);
    // Le serveur dit « disponible » mais le rôle n'est pas administrateur : jamais affiché.
    expect(cloudOuvert(compte({ administrateur: false }))).toBe(false);
  });
  it("explication sobre dans Paramètres", () => {
    expect(raisonSansCloud(compte({ administrateur: false, cloud: { disponible: false, raison: "non_admin" } }))).toMatch(/réservé à l'administrateur/);
    expect(raisonSansCloud(compte({ cloud: { disponible: false, raison: "ferme" } }))).toMatch(/pas activé/);
    expect(raisonSansCloud(compte({}))).toBeNull();
    expect(raisonSansCloud(null)).toBeNull();
  });
});

describe("statuts, expiration, jauge", () => {
  it("libellés du brief", () => {
    expect(statutObjet("sauvegarde").libelle).toBe("Sauvegardé");
    expect(statutObjet("en_attente").libelle).toBe("En attente de sauvegarde");
    expect(statutObjet("envoi_en_cours").libelle).toBe("Envoi en cours");
    expect(statutObjet("echec")).toEqual({ libelle: "Échec de sauvegarde", ton: "erreur" });
    expect(statutObjet("expire").libelle).toBe("Expiré");
  });
  it("« Expire dans X jours » et date", () => {
    // Heure locale (indépendante du fuseau de la machine d'essai).
    const loc = (j: number, h: number) => new Date(2026, 9, j, h, 0, 0).getTime();
    const iso = (t: number) => new Date(t).toISOString();
    const n = loc(23, 12);
    expect(expiration({ statut: "sauvegarde", expireLe: iso(new Date(2026, 10, 22, 12).getTime()) }, n)).toEqual({ court: `Expire dans 30${NB}jours`, date: `le 22${NB}novembre 2026`, proche: false });
    expect(expiration({ statut: "sauvegarde", expireLe: iso(loc(24, 10)) }, n)?.court).toBe("Expire demain");
    expect(expiration({ statut: "sauvegarde", expireLe: iso(loc(23, 13)) }, n)?.court, "dans une heure : aujourd'hui, pas demain").toBe("Expire aujourd'hui");
    expect(expiration({ statut: "sauvegarde", expireLe: iso(loc(23, 11)) }, n)?.court).toBe("Expire aujourd'hui");
    expect(expiration({ statut: "sauvegarde", expireLe: iso(loc(25, 12)) }, n)?.proche).toBe(true);
    expect(expiration({ statut: "expire", expireLe: iso(loc(1, 0)) }, n)).toBeNull();
  });
  it("jauge réelle (sauvegardé + réservé), unités décimales du quota", () => {
    const j = jauge({ max: 9e9, utilise: 2.4e9, reserve: 0.4e9, sauvegarde: 2e9, disponible: 6.6e9 });
    expect([j.sauve, Math.round(j.reserve * 1000) / 1000, j.niveau]).toEqual([2 / 9, 0.044, "normal"]);
    expect([j.utilise, j.disponible, j.max]).toEqual([`2,4${NB}Go`, `6,6${NB}Go`, `9${NB}Go`]);
    expect(jauge({ max: 9e9, utilise: 8.9e9, reserve: 0, sauvegarde: 8.9e9, disponible: 0.1e9 }).niveau).toBe("plein");
    expect(jauge({ max: 9e9, utilise: 8e9, reserve: 0, sauvegarde: 8e9, disponible: 1e9 }).niveau).toBe("haut");
    expect(jauge({ max: 1000, utilise: 1500, reserve: 0, sauvegarde: 1500, disponible: 0 }).sauve).toBe(1);
    expect(octetsCloud(845_654)).toBe(`846${NB}Ko`);
    expect(octetsCloud(14_200_000)).toBe(`14,2${NB}Mo`);
  });
});

describe("transferts : aucune fausse progression", () => {
  it("pourcentage seulement s'il est connu", () => {
    expect(fraction({ fait: 250, total: 1000 })).toBe(0.25);
    expect(fraction({ fait: 0, total: 0 })).toBeNull();
    expect(libelleTransfert(t({ etape: "envoi", fait: 613, total: 1000 })).libelle).toBe(`Envoi en cours · 61${NB}%`);
    expect(libelleTransfert(t({ etape: "confirmation", total: 0 })).libelle).toBe("Vérification par le serveur…");
    expect(libelleTransfert(t({ etape: "attente" })).libelle).toBe("En attente de sauvegarde");
    expect(libelleTransfert(t({ etape: "termine", statut: "sauvegarde" })).libelle).toBe("Sauvegardé");
    expect(libelleTransfert(t({ etape: "termine", statut: "en_attente" })).libelle).toBe("En attente de sauvegarde");
    expect(libelleTransfert(t({ etape: "echec" })).libelle).toBe("Échec de sauvegarde");
    expect(libelleTransfert(t({ sens: "telechargement", etape: "termine" })).libelle).toBe("Téléchargé");
  });
  it("fusion des avis et envois actifs", () => {
    const l = fusionner(fusionner([], t({})), t({ id: "env-2" }));
    expect(fusionner(l, t({ etape: "envoi", fait: 10 }))[0].fait).toBe(10);
    expect(envoisActifs(fusionner(l, t({ etape: "termine" })))).toBe(1);
  });
  it("erreurs de synchronisation lisibles", () => {
    expect(erreurLisible("quota_atteint", "x")).toMatch(/Espace Cloud insuffisant/);
    expect(erreurLisible("http_503", "x")).toMatch(/indisponible/);
    expect(erreurLisible("inconnu", "Message du cœur.")).toBe("Message du cœur.");
    expect(dureeLien(new Date(Date.parse("2026-10-23T12:05:00Z")).toISOString(), Date.parse("2026-10-23T12:00:00Z"))).toMatch(new RegExp(`^valable 5${NB}min, jusqu'à \\d\\d:\\d\\d$`));
  });
  it("envoi possible : disponible et type du cloud", () => {
    expect(envoiPossible({ etat: "disponible", ext: "MP4" }).ok).toBe(true);
    expect(envoiPossible({ etat: "disponible", ext: "png" }).raison).toMatch(/Type non accepté/);
    expect(envoiPossible({ etat: "en-cours", ext: "mp4" }).raison).toBe("Pas encore prêt");
    expect(typeCloud("opus")).toBe("audio/ogg");
  });
});
