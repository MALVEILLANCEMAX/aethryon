// AETHRYON Cloud dans l'espace (src/lib/cloud.ts) : unités décimales du quota, jauge réelle, « Expire dans X jours » en
// jours de calendrier, durée des liens signés, erreurs lisibles ; chemin de retour de la page d'accord du Desktop.
//   node --test web/tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { dureeLien, erreurCloud, expiration, jaugeCloud, octets, STATUTS } from "../src/lib/cloud.ts";
import { safeReturnPath } from "../src/lib/safe.ts";

const NB = "\u00a0";

test("octets décimaux, deux décimales sous 10 Go", () => {
  assert.equal(octets(0), `0${NB}Go`);
  assert.equal(octets(845_654), `846${NB}Ko`);
  assert.equal(octets(14_200_000), `14,2${NB}Mo`);
  assert.equal(octets(8_960_000_000), `8,96${NB}Go`);
  assert.equal(octets(9e9), `9${NB}Go`);
  assert.equal(octets(2.4e9), `2,4${NB}Go`);
});

test("jauge : sauvegardé + réservé, niveaux, texte pour les lecteurs d'écran", () => {
  const j = jaugeCloud({ max: 9e9, utilise: 2.4e9, reserve: 0.4e9, sauvegarde: 2e9, disponible: 6.6e9 });
  assert.equal(j.niveau, "normal");
  assert.equal(j.aria, `2,4${NB}Go utilisés sur 9${NB}Go, 6,6${NB}Go disponibles`);
  assert.equal(jaugeCloud({ max: 9e9, utilise: 8.96e9, reserve: 0, sauvegarde: 8.96e9, disponible: 0.04e9 }).niveau, "plein");
});

test("expiration en jours de calendrier, date en clair ; rien pour un objet non sauvegardé", () => {
  const n = new Date(2026, 9, 23, 12).getTime();
  const iso = (j: number, h: number, m = 9) => new Date(2026, m, j, h).toISOString();
  assert.deepEqual(expiration({ statut: "sauvegarde", expireLe: iso(22, 12, 10) }, n), { court: `Expire dans 30${NB}jours`, date: `le 22${NB}novembre 2026`, proche: false });
  assert.equal(expiration({ statut: "sauvegarde", expireLe: iso(23, 13) }, n)?.court, "Expire aujourd'hui");
  assert.equal(expiration({ statut: "sauvegarde", expireLe: iso(24, 9) }, n)?.court, "Expire demain");
  assert.equal(expiration({ statut: "expire", expireLe: iso(1, 0) }, n), null);
  assert.equal(STATUTS.en_attente.label, "En attente de sauvegarde");
});

test("liens signés et erreurs", () => {
  assert.match(dureeLien(new Date(Date.parse("2026-10-23T12:05:00Z")).toISOString(), Date.parse("2026-10-23T12:00:00Z")), new RegExp(`^5${NB}min, jusqu'à \\d\\d:\\d\\d$`));
  assert.match(erreurCloud("envoi_abandonne"), /jamais arrivé/);
  assert.equal(erreurCloud("inconnu", "Message du serveur."), "Message du serveur.");
});

test("page d'accord du Desktop : le retour après la connexion est accepté", () => {
  assert.equal(safeReturnPath("/desktop/connecter?code=BCDF-GHJK", "https://raccourci.malvu.fr"), "/desktop/connecter?code=BCDF-GHJK");
});
