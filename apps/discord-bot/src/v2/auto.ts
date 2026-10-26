// Bot v2 (docs/DISCORD-BOT.md §18.6) : cartes AUTOMATIQUES sous les liens publiés dans un serveur. Désactivées par défaut :
// il faut (1) que le propriétaire du bot ouvre la fonction (AUTO_EMBEDS_ENABLED=1, avec l'intent privilégié « Message
// Content » activé dans le Developer Portal) ET (2) qu'un administrateur du serveur l'active (/config). Alors :
// - seulement les liens pris en charge, des plateformes choisies, dans les salons choisis ; rien pour les bots et
//   les webhooks ; une carte par message (la première vidéo), au plus `perHour` par heure et par serveur, jamais deux
//   fois le même lien dans un salon en 10 minutes ;
// - la carte RÉPOND au message, sans notifier personne, avec le lien d'origine et l'auteur (attribution) ; ses
//   boutons agissent pour la personne qui clique, avec SON compte, en privé ; aucune conversion automatique ;
// - le message d'origine n'est jamais supprimé ; son aperçu natif peut être masqué si le serveur le demande et que le
//   bot a « Gérer les messages » ; mode « réaction » : une simple 🦉, et le menu Applications fait le reste.
// Rien n'est journalisé du contenu (ni lien, ni texte, ni identifiant).
import type { GuildSettings } from "../account.ts";
import { linksIn, platformOf, type NativeEmbed } from "./router.ts";
import { detectCard, type Brand, type Features } from "./ui.ts";
import type { V2Reply } from "../replies.ts";

export interface AutoMessage {
  id: string; guildId: string | null; channelId: string; content: string; authorId: string; authorIsBot: boolean;
  /** Aperçus natifs déjà calculés par Discord (souvent absents à l'arrivée du message : la carte reste alors sobre). */
  embeds?: NativeEmbed[];
  webhook: boolean; system: boolean; canManageMessages: boolean;
  reply(r: V2Reply): Promise<unknown>;
  react(emoji: string): Promise<unknown>;
  suppressEmbeds(): Promise<unknown>;
}

export interface AutoDeps {
  brand: Brand;
  features: Features;
  guildSettings: (guildId: string) => Promise<GuildSettings | null>;
  log: (level: "info" | "warn" | "error", msg: string, data?: Record<string, string | number | boolean | null>) => void;
  now?: () => number;
}

export function createAuto(d: AutoDeps) {
  const now = d.now ?? Date.now;
  const seen = new Map<string, number>();             // messages déjà traités (1 h)
  const recent = new Map<string, number>();           // salon + lien (10 min)
  const perGuild = new Map<string, number[]>();       // cartes de l'heure, par serveur
  const sweep = () => {
    const t = now();
    for (const [k, v] of seen) if (t - v > 3_600_000) seen.delete(k);
    for (const [k, v] of recent) if (t - v > 600_000) recent.delete(k);
    for (const [k, v] of perGuild) { const keep = v.filter((x) => t - x < 3_600_000); if (keep.length) perGuild.set(k, keep); else perGuild.delete(k); }
  };

  async function onMessage(m: AutoMessage): Promise<"ignored" | "card" | "reaction" | "limited"> {
    if (!d.features.autoEmbeds || !m.guildId || m.authorIsBot || m.webhook || m.system || !m.content) return "ignored";
    if (seen.has(m.id)) return "ignored";
    const g = await d.guildSettings(m.guildId);
    if (!g?.autoEmbeds) return "ignored";
    if (g.channels.length && !g.channels.includes(m.channelId)) return "ignored";
    const url = linksIn(m.content).find((u) => g.platforms.includes((platformOf(u) ?? "") as GuildSettings["platforms"][number]));
    if (!url) return "ignored";
    seen.set(m.id, now());
    const key = `${m.channelId}|${url}`;
    if (recent.has(key)) return "ignored";
    const t = now();
    const hour = (perGuild.get(m.guildId) ?? []).filter((x) => t - x < 3_600_000);
    if (hour.length >= g.perHour) { d.log("info", "carte automatique : limite horaire du serveur atteinte"); return "limited"; }
    hour.push(t); perGuild.set(m.guildId, hour); recent.set(key, t);
    if (seen.size > 5000 || recent.size > 5000) sweep();
    try {
      if (g.mode === "react") {
        await m.react("🦉");
        return "reaction";
      }
      // Titre, auteur et miniature : seulement ceux de l'aperçu natif de Discord (aucune requête vers la plateforme).
      const e = (m.embeds ?? []).find((x) => x.url === url);
      const meta = { url, platform: platformOf(url), title: e?.title ?? null, creator: e?.author ?? null, thumbnail: e?.thumbnail?.startsWith("https://") ? e.thumbnail : null };
      await m.reply(detectCard(d.brand, meta, "*", d.features, { sharedBy: m.authorId, auto: true, buttons: g.buttons }));
      if (g.original === "suppress" && m.canManageMessages) await m.suppressEmbeds().catch(() => d.log("warn", "aperçu natif non masqué"));
      d.log("info", "carte automatique", { plateforme: platformOf(url) });
      return "card";
    } catch {
      d.log("warn", "carte automatique refusée par Discord (permissions du salon ?)");
      return "ignored";
    }
  }
  return { onMessage, sweep };
}
