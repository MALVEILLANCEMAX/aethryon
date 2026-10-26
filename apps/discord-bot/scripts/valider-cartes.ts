// Validation RÉELLE des cartes du bot par l'API de Discord, sans rien publier : chaque carte est envoyée avec une rangée
// volontairement invalide (bouton à l'emoji « ☆ », refusé) ; Discord rejette alors le message ET liste toutes les erreurs du
// formulaire. Une carte est valide si la seule erreur est celle de cette rangée témoin.
//   node --experimental-strip-types scripts/valider-cartes.ts <fichier du jeton du bot> <identifiant du salon>
import { readFileSync } from "node:fs";
import * as ui from "../src/v2/ui.ts";
import type { Preview } from "../src/ytapi.ts";

const [tokenFile, channel] = process.argv.slice(2);
const token = readFileSync(tokenFile!, "utf8").trim();
const MB = 1024 * 1024;
const F: ui.Features = { link: true, convert: true, files: true, library: true, guildConfig: true, autoEmbeds: true, preview: true, compress: true, clip: true, gif: true };
const b = { site: "https://raccourci.malvu.fr", emoji: "<:aethryon:1559148807717916752>" };
const URL_ = "https://x.com/NASA/status/1883228395842023524";
const meta = { url: URL_, platform: "x", title: "NASA Marshall - GAME OVER 🕹️ Captured by our #NASAMichoud photographer", creator: "NASA Marshall", durationS: 16.5, thumbnail: "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/x.jpg" };
const preview: Preview = { platform: "twitter", title: meta.title, uploader: meta.creator, durationS: 16.474, thumbnail: meta.thumbnail, isGif: false, live: false, bestH264: 1080, audioAvailable: null, mp3Bytes: {},
  qualities: [{ quality: 1080, estSizeBytes: 1782882, h264: true }, { quality: 720, estSizeBytes: 927278, h264: true }], limits: { tooLong: false, gifAllowed: true, transcodeAllowed: true }, mediaCount: 1, entries: [] };
const today = { used: 3, limit: 10, remaining: 7, resetAt: "2026-10-13T00:00:00+02:00" };
const resolved = { linked: true as const, status: "active" as const, user: { name: "Alice", email: "a•••@example.com" }, discord: { name: "alice_", linkedAt: "2026-10-12T10:36:01Z", lastUsedAt: null }, today, maxActive: 1 };
const item = { id: "s1xxxxxxx", platform: "x" as const, url: URL_, mediaType: "video" as const, title: meta.title, creator: meta.creator, durationS: 16, origin: "discord", savedAt: "2026-10-12T10:00:00Z" };
const base = { meta, fmt: "mp4" as const, quality: "720", jobId: "BFPQJmEfs4X9OdXz", owner: "1234567890123456789", title: meta.title, sizeBytes: 2_290_168, shareAllowed: true };
const DL = "https://raccourci.malvu.fr/api/discord/telechargement?jeton=" + "A".repeat(43);

const cards: Record<string, ui.Features extends never ? never : { components: unknown[]; flags: number }> = {
  "choix (menu Applications)": ui.detectCard(b, meta, "1234567890123456789", F),
  "carte automatique": ui.detectCard(b, meta, "*", F, { auto: true, sharedBy: "1234567890123456789" }),
  "aperçu": ui.previewCard(b, URL_, preview, "1234567890123456789", F, 10 * MB),
  "progression": ui.progressCard(b, "mp4", 40, "downloading", meta),
  "file d'attente": ui.progressCard(b, "gif", null, null, meta, true),
  "résultat (fichier joint)": ui.resultCard(b, { ...base, attachment: { name: "NASA_Marshall_GAME_OVER_1883228342704377856.mp4", type: "video/mp4" } }, F),
  "résultat (lien)": ui.resultCard(b, { ...base, downloadUrl: DL }, F),
  "résultat (trop lourd + compresser)": ui.resultCard(b, { ...base, sizeBytes: 31 * MB, downloadUrl: DL, tooBigForDiscord: true }, F),
  "résultat (compressé, note)": ui.resultCard(b, { ...base, attachment: { name: "a.mp4", type: "video/mp4" }, derived: true, notes: ["Image réduite à 360p pour tenir dans 9,5 Mio."] }, F),
  "résultat (GIF)": ui.resultCard(b, { ...base, fmt: "gif", attachment: { name: "a.gif", type: "image/gif" }, derived: true }, F),
  "résultat (MP3)": ui.resultCard(b, { ...base, fmt: "mp3", attachment: { name: "a.mp3", type: "audio/mpeg" } }, F),
  "résultat (extrait)": ui.resultCard(b, { ...base, clip: { start: 2, end: 8 }, attachment: { name: "a.mp4", type: "video/mp4" } }, F),
  "partagé": ui.sharedCard(b, { ...base, attachment: { name: "a.mp4", type: "video/mp4" } }, "1234567890123456789", F),
  "partagé (MP3)": ui.sharedCard(b, { ...base, fmt: "mp3", attachment: { name: "a.mp3", type: "audio/mpeg" } }, "1234567890123456789", F),
  "partagé (trop lourd, sans lien)": ui.sharedTooBigCard(b, { ...base, sizeBytes: 31 * MB }, "1234567890123456789"),
  "résultat (partage impossible ici)": ui.resultCard(b, { ...base, attachment: { name: "a.mp4", type: "video/mp4" }, shareAllowed: false, refusal: "Ce serveur ne permet pas aux applications de ton compte de publier (permission « Utiliser des applications externes »). Enregistre le fichier pour l'envoyer toi-même." }, F),
  "échec": ui.errorCard(b, "download_failed", meta, "1234567890123456789", "mp4"),
  "échec (YouTube bloque le serveur, reprise)": ui.errorCard(b, "bot_check", { url: "https://www.youtube.com/watch?v=zmW8hgV39IU", platform: "youtube" }, "1234567890123456789", "mp4", 840),
  "échec (limitation, sans délai)": ui.errorCard(b, "upstream_rate_limited", meta, "1234567890123456789", "mp3"),
  "état (YouTube en pause)": ui.simpleCard(b, "ÉTAT", "État d'AETHRYON", "Aucune conversion en cours pour toi.\nSite et comptes : opérationnel · Conversions : opérationnel\n**YouTube : en pause** (la plateforme impose au serveur une vérification anti-robot) · nouvel essai possible à partir de <t:1791843613:t> (<t:1791843613:R>)\n-# Pendant la bêta : 10 conversions par jour et par compte, une à la fois."),
  "historique (échec non compté)": ui.historyCard(b, [{ id: "u2", createdAt: "2026-10-12T22:05:12Z", finishedAt: "2026-10-12T22:05:13Z", fmt: "mp4", platform: "youtube", state: "error", errorCode: "bot_check", errorMessage: "Plateforme temporairement indisponible" }], { used: 0, limit: 10, remaining: 10, resetAt: "2026-10-12T22:00:00Z" }),
  "compte": ui.accountCard(b, resolved, F),
  "lier": ui.linkPanel(b), "lié": ui.linkedCard(b, resolved, F), "non lié": ui.notLinkedCard(b), "délier ?": ui.unlinkConfirm(b), "délié": ui.unlinkedCard(b, true),
  "quota": ui.quotaCard(b, today, 1),
  "historique": ui.historyCard(b, [{ id: "u1", createdAt: "2026-10-12T15:28:47Z", finishedAt: null, fmt: "mp4", platform: "tiktok", state: "done", errorCode: null, errorMessage: null }], today),
  "bibliothèque": ui.savedListCard(b, { items: [item], total: 1, max: 200 }, 0, "1234567890123456789", ""),
  "média enregistré": ui.savedItemCard(b, item, "1234567890123456789", F),
  "tout effacer ?": ui.savedClearConfirm(b, "1234567890123456789", 3),
  "réglages": ui.prefsCard(b, { fmt: "mp4", quality: "auto", visibility: "private", locale: "auto" }),
  "config serveur": ui.configCard(b, { autoEmbeds: false, platforms: ["youtube", "tiktok", "x"], channels: [], buttons: true, share: false, quality: "auto", perHour: 30, original: "keep", mode: "card" }, F),
  ...Object.fromEntries((["accueil", "convertir", "menu", "compte", "bibliotheque", "serveur", "confidentialite"] as const).map((t) => [`aide : ${t}`, ui.helpCard(b, t, F)])),
};

const witness = { type: 1, components: [{ type: 2, style: 2, label: "témoin", custom_id: "ae:temoin", emoji: { name: "☆" } }] };
let bad = 0;
for (const [name, card] of Object.entries(cards)) {
  // Pièces jointes citées par la carte (attachment://nom) : envoyées pour de bon (petits fichiers), comme le fait le bot.
  const names = [...new Set([...JSON.stringify(card.components).matchAll(/attachment:\/\/([^"]+)/g)].map((m) => m[1]!))];
  const body = { flags: card.flags, components: [...card.components, witness], allowed_mentions: { parse: [] },
    ...(names.length ? { attachments: names.map((filename, id) => ({ id, filename })) } : {}) };
  const headers: Record<string, string> = { authorization: `Bot ${token}`, "user-agent": "AETHRYON-validation (raccourci.malvu.fr, 1.0)" };
  let payload: string | FormData;
  if (names.length) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(body));
    names.forEach((n, i) => form.append(`files[${i}]`, new Blob([new Uint8Array(64)]), n));
    payload = form;
  } else { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, { method: "POST", headers, body: payload });
  const data = await res.json().catch(() => ({})) as { id?: string; errors?: unknown; retry_after?: number };
  if (res.status === 200 && data.id) {
    // Ne devrait jamais arriver (le témoin est invalide) : message retiré aussitôt.
    await fetch(`https://discord.com/api/v10/channels/${channel}/messages/${data.id}`, { method: "DELETE", headers: { authorization: `Bot ${token}` } });
    console.log(`?? ${name} : publié puis retiré (le témoin n'a pas été refusé)`); bad++; continue;
  }
  if (res.status === 429) { console.log(`limite de débit, attente ${data.retry_after}s`); await new Promise((r) => setTimeout(r, ((data.retry_after ?? 2) + 0.5) * 1000)); continue; }
  const paths: string[] = [];
  const walk = (o: unknown, p: string) => {
    if (!o || typeof o !== "object") return;
    const r = o as Record<string, unknown>;
    if (Array.isArray(r._errors)) { paths.push(`${p} ${(r._errors as { code: string }[]).map((e) => e.code).join(",")}`); return; }
    for (const [k, v] of Object.entries(r)) walk(v, p ? `${p}.${k}` : k);
  };
  walk(data.errors, "");
  const own = `components.${card.components.length}.components.0.emoji.name COMPONENT_INVALID_EMOJI`;
  const others = paths.filter((p) => p !== own);
  if (res.status === 400 && paths.includes(own) && !others.length) console.log(`ok  ${name}`);
  else { bad++; console.log(`KO  ${name} : statut ${res.status} ${others.join(" ; ") || JSON.stringify(data).slice(0, 200)}`); }
  await new Promise((r) => setTimeout(r, 1300));
}
console.log(bad ? `${bad} carte(s) refusée(s)` : `${Object.keys(cards).length} cartes acceptées par Discord (rien publié)`);
process.exit(bad ? 1 : 0);
