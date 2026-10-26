import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseOwnStatus, chooseQuoteStatus, planXBindings, statusFromHref, type XStatus } from "../../src/content/common/x-status.ts";

const A = "1790000000000000001";
const Q = "1790000000000000044";

test("statusFromHref : liens relatifs ou absolus, suffixes de média, forme /i/web/status", () => {
  assert.deepEqual(statusFromHref(`/alice/status/${A}`), { url: `https://x.com/alice/status/${A}`, id: A, handle: "alice" });
  assert.deepEqual(statusFromHref(`https://twitter.com/alice/status/${A}?s=20`), { url: `https://x.com/alice/status/${A}`, id: A, handle: "alice" });
  for (const suffix of ["/photo/1", "/video/2", "/analytics", "/quotes", "/"]) assert.equal(statusFromHref(`/alice/status/${A}${suffix}`)?.id, A, suffix);
  assert.deepEqual(statusFromHref(`/i/web/status/${A}`), { url: `https://x.com/i/status/${A}`, id: A, handle: null });
  assert.equal(statusFromHref(`/i/status/${A}`)?.handle, null);
});

test("statusFromHref : refus (profil, id invalide, autre hôte, http, schéma dangereux, chemin inconnu)", () => {
  for (const bad of [
    "/alice", "/alice/status/abc", `/alice/status/${A}/extra/path`, `https://evil.example/alice/status/${A}`,
    `http://x.com/alice/status/${A}`, "javascript:alert(1)", "", null, undefined, `/al-ice/status/${A}`, `/alice/status/${A}/photo/0`,
  ]) assert.equal(statusFromHref(bad as string), null, String(bad));
});

test("publication elle-même : horodatage hors citation, sinon lien statistiques ; jamais la citation", () => {
  const links = [
    { href: "/alice", hasTime: false, inQuote: false },
    { href: `/dave/status/${Q}`, hasTime: true, inQuote: true },
    { href: `/alice/status/${A}`, hasTime: true, inQuote: false },
  ];
  assert.equal(chooseOwnStatus(links)?.id, A, "la citation précède dans le DOM mais n'est pas retenue");
  assert.equal(chooseOwnStatus([{ href: `/alice/status/${A}/analytics`, hasTime: false, inQuote: false }])?.id, A);
  assert.equal(chooseOwnStatus([{ href: `/dave/status/${Q}`, hasTime: true, inQuote: true }]), null);
  assert.equal(chooseOwnStatus([{ href: `/alice/status/${A}`, hasTime: false, inQuote: false }]), null, "lien sans horodatage (ex. « afficher le fil ») : pas une preuve");
});

test("publication citée : horodatage dans la citation, sinon tout lien de publication de la citation", () => {
  const own: XStatus = { url: `https://x.com/alice/status/${A}`, id: A, handle: "alice" };
  assert.equal(chooseQuoteStatus([{ href: `/dave/status/${Q}`, hasTime: true, inQuote: true }], own)?.id, Q);
  assert.equal(chooseQuoteStatus([{ href: `/dave/status/${Q}/video/1`, hasTime: false, inQuote: true }], own)?.id, Q);
  assert.equal(chooseQuoteStatus([{ href: `/alice/status/${A}`, hasTime: true, inQuote: true }], own), null, "même publication que la publication qui cite");
  assert.equal(chooseQuoteStatus([{ href: `/dave/status/${Q}`, hasTime: true, inQuote: false }], own), null);
});

test("commandes : aucune sans vidéo ; vidéo citée → lien de la citée ; plusieurs vidéos → videoCount", () => {
  const own: XStatus = { url: `https://x.com/alice/status/${A}`, id: A, handle: "alice" };
  const quoted: XStatus = { url: `https://x.com/dave/status/${Q}`, id: Q, handle: "dave" };
  assert.deepEqual(planXBindings({ own, ownVideos: 0, quote: null }), []);
  assert.deepEqual(planXBindings({ own, ownVideos: 1, quote: null }), [{ status: own, videoCount: 1, placement: "actions" }]);
  assert.deepEqual(planXBindings({ own, ownVideos: 2, quote: null }), [{ status: own, videoCount: 2, placement: "actions" }]);
  assert.deepEqual(planXBindings({ own, ownVideos: 0, quote: { status: quoted, videos: 1 } }), [{ status: quoted, videoCount: 1, placement: "quote" }]);
  assert.deepEqual(planXBindings({ own, ownVideos: 1, quote: { status: quoted, videos: 1 } }), [
    { status: own, videoCount: 1, placement: "actions" },
    { status: quoted, videoCount: 1, placement: "quote" },
  ]);
  assert.deepEqual(planXBindings({ own, ownVideos: 0, quote: { status: null, videos: 1 } }), [], "citation sans lien : on ne devine pas");
  assert.deepEqual(planXBindings({ own: null, ownVideos: 1, quote: null }), [], "publication sans lien : pas de commande");
  assert.deepEqual(planXBindings({ own, ownVideos: 0, quote: { status: quoted, videos: 0 } }), [], "citation sans vidéo");
});
