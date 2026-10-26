// Bot v2 (docs/DISCORD-BOT.md §18) : commandes, en JSON de l'API Discord. Une commande n'est enregistrée QUE si sa
// fonction marche vraiment (drapeaux de bot.env) : moins de commandes, toutes utiles. Noms anglais (exigés en
// minuscules par Discord), descriptions anglaises et françaises. Portée :
// - « guild » : serveur de test (commandes de serveur : ni integration_types ni contexts, réservés aux commandes globales) ;
// - « global » : installation serveur ET utilisateur (integration_types [0, 1], contexts [0, 1, 2]) ; /config reste
//   serveur seulement avec la permission « Gérer le serveur ». Jamais enregistré sans l'accord du propriétaire.
import type { Features } from "./ui.ts";

type Choice = { name: string; value: string | number; name_localizations?: { fr: string } };
type Option = {
  type: number; name: string; description: string; description_localizations?: { fr: string }; required?: boolean;
  choices?: Choice[]; max_length?: number; min_value?: number; max_value?: number; autocomplete?: boolean; options?: Option[];
};
export interface CommandJson {
  name: string; type: 1 | 3; description?: string; description_localizations?: { fr: string }; name_localizations?: { fr: string };
  options?: Option[]; default_member_permissions?: string; integration_types?: number[]; contexts?: number[]; nsfw?: boolean;
}

const STRING = 3, INTEGER = 4, SUB = 1;
const url = (fr = "Lien de la vidéo (YouTube, TikTok ou X)"): Option => ({ type: STRING, name: "url", description: "Video link (YouTube, TikTok or X)", description_localizations: { fr }, required: true, max_length: 500 });
const fmt: Option = { type: STRING, name: "format", description: "Format", description_localizations: { fr: "Format" },
  choices: [{ name: "MP4 (video)", value: "mp4", name_localizations: { fr: "MP4 (vidéo)" } }, { name: "MP3 (audio)", value: "mp3", name_localizations: { fr: "MP3 (son)" } }] };
const quality: Option = { type: STRING, name: "quality", description: "Video quality (MP4)", description_localizations: { fr: "Qualité de la vidéo (MP4)" },
  choices: [{ name: "Auto (best)", value: "auto", name_localizations: { fr: "Automatique (la meilleure)" } }, { name: "1080p max", value: "1080", name_localizations: { fr: "1080p au plus" } }, { name: "720p max (lighter)", value: "720", name_localizations: { fr: "720p au plus (plus léger)" } }] };
const visibility: Option = { type: STRING, name: "visibility", description: "Who sees the result", description_localizations: { fr: "Qui voit le résultat" },
  choices: [{ name: "Only me", value: "private", name_localizations: { fr: "Moi seul" } }, { name: "Everyone here (if allowed)", value: "share", name_localizations: { fr: "Tout le monde ici (si permis)" } }] };

export const MESSAGE_MENU = { name: "Convert with AETHRYON", fr: "Convertir avec AETHRYON" } as const;

export function commandsV2(f: Features, scope: "guild" | "global"): CommandJson[] {
  const g = scope === "global";
  const everywhere = g ? { integration_types: [0, 1], contexts: [0, 1, 2] } : {};
  const guildOnly = g ? { integration_types: [0], contexts: [0] } : {};
  const out: CommandJson[] = [];
  if (f.convert) {
    out.push({ name: "convert", type: 1, description: "Convert a YouTube, TikTok or X video to MP4 or MP3", description_localizations: { fr: "Convertir une vidéo YouTube, TikTok ou X en MP4 ou en MP3" },
      options: [url(), fmt, quality, ...(f.files ? [visibility] : [])], ...everywhere });
    out.push({ name: "audio", type: 1, description: "Extract the audio as MP3", description_localizations: { fr: "Extraire le son en MP3" },
      options: [url(), { type: INTEGER, name: "bitrate", description: "MP3 bitrate (kbps)", description_localizations: { fr: "Débit du MP3 (kbit/s)" },
        choices: [{ name: "128", value: 128 }, { name: "192 (recommended)", value: 192, name_localizations: { fr: "192 (recommandé)" } }, { name: "320", value: 320 }] }, ...(f.files ? [visibility] : [])], ...everywhere });
    out.push({ name: MESSAGE_MENU.name, type: 3, name_localizations: { fr: MESSAGE_MENU.fr }, ...everywhere });
    if (f.preview) {
      out.push({ name: "preview", type: 1, description: "Private preview of a video before converting: title, length, sizes", description_localizations: { fr: "Aperçu privé d'une vidéo avant de la convertir : titre, durée, tailles" },
        options: [url()], ...everywhere });
    }
    const time = (name: string, en: string, fr: string, required: boolean): Option => ({ type: STRING, name, description: en, description_localizations: { fr }, required, max_length: 12 });
    if (f.clip) {
      out.push({ name: "clip", type: 1, description: "Cut a part of a video (MP4 up to 3 min, MP3 up to 10 min)", description_localizations: { fr: "Découper un extrait d'une vidéo (MP4 : 3 min au plus, MP3 : 10 min)" },
        options: [url(), time("start", "Start: seconds (75) or minutes:seconds (1:15)", "Début : secondes (75) ou minutes:secondes (1:15)", true),
          time("end", "End: seconds (95) or minutes:seconds (1:35)", "Fin : secondes (95) ou minutes:secondes (1:35)", true), fmt], ...everywhere });
    }
    if (f.gif) {
      out.push({ name: "gif", type: 1, description: "Make an animated GIF from a passage of a video", description_localizations: { fr: "Faire un GIF animé à partir d'un passage d'une vidéo" },
        options: [url(), time("start", "Start: seconds or minutes:seconds (default 0:00)", "Début : secondes ou minutes:secondes (0:00 par défaut)", false),
          { type: INTEGER, name: "duration", description: "Length in seconds (1–30, default 5)", description_localizations: { fr: "Durée en secondes (1 à 30, 5 par défaut)" }, min_value: 1, max_value: 30 }], ...everywhere });
    }
  }
  if (f.link) {
    out.push({ name: "account", type: 1, description: "Your AETHRYON account: link, status, unlink", description_localizations: { fr: "Ton compte AETHRYON : lier, voir, délier" }, ...everywhere,
      options: [
        { type: SUB, name: "link", description: "Link your Discord account to AETHRYON", description_localizations: { fr: "Relier ton compte Discord à AETHRYON" } },
        { type: SUB, name: "status", description: "Your linked account and today's quota", description_localizations: { fr: "Ton compte lié et ton quota du jour" } },
        { type: SUB, name: "unlink", description: "Unlink your Discord account", description_localizations: { fr: "Délier ton compte Discord" } },
      ] });
    out.push({ name: "quota", type: 1, description: "Conversions left today", description_localizations: { fr: "Tes conversions restantes aujourd'hui" }, ...everywhere });
    out.push({ name: "history", type: 1, description: "Your recent conversions", description_localizations: { fr: "Tes dernières conversions" }, ...everywhere,
      options: [{ type: INTEGER, name: "count", description: "How many (1–10)", description_localizations: { fr: "Combien (1 à 10)" }, min_value: 1, max_value: 10 }] });
  }
  if (f.library) {
    out.push({ name: "saved", type: 1, description: "Your saved media library", description_localizations: { fr: "Ta bibliothèque de médias enregistrés" }, ...everywhere,
      options: [
        { type: STRING, name: "search", description: "Search titles and creators", description_localizations: { fr: "Chercher dans les titres et les auteurs" }, max_length: 60, autocomplete: true },
        { type: STRING, name: "platform", description: "Platform", description_localizations: { fr: "Plateforme" }, choices: [{ name: "YouTube", value: "youtube" }, { name: "TikTok", value: "tiktok" }, { name: "X", value: "x" }] },
        { type: STRING, name: "type", description: "Type", description_localizations: { fr: "Type" }, choices: [{ name: "Video", value: "video", name_localizations: { fr: "Vidéo" } }, { name: "Audio", value: "audio", name_localizations: { fr: "Son" } }] },
      ] });
    out.push({ name: "settings", type: 1, description: "Your default format, quality and privacy", description_localizations: { fr: "Tes format, qualité et confidentialité par défaut" }, ...everywhere });
  }
  if (f.guildConfig) {
    out.push({ name: "config", type: 1, description: "Configure AETHRYON for this server", description_localizations: { fr: "Régler AETHRYON pour ce serveur" }, default_member_permissions: "32", ...guildOnly });
  }
  out.push({ name: "status", type: 1, description: "Your conversions in progress and the service status", description_localizations: { fr: "Tes conversions en cours et l'état du service" }, ...everywhere });
  out.push({ name: "help", type: 1, description: "What AETHRYON can do", description_localizations: { fr: "Ce que sait faire AETHRYON" }, ...everywhere });
  return out;
}
