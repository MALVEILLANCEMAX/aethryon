<p align="center"><img src="../../packages/brand/master/variantes/aethryon-discord.svg" width="72" alt=""></p>

<h1 align="center">AETHRYON Discord bot</h1>

<p align="center">
  Convert a video link without leaving the conversation. Private replies by default.<br>
  Node 22 · discord.js 14 · slash commands, user installs and server installs
</p>

<p align="center">
  <a href="https://discord.com/oauth2/authorize?client_id=1558821698734923796&integration_type=1&scope=applications.commands"><img alt="Add to my apps" src="https://img.shields.io/badge/Add%20to%20my%20apps-D4AF7C?style=for-the-badge&labelColor=0F0F10"></a>
  <a href="https://discord.com/oauth2/authorize?client_id=1558821698734923796&integration_type=0&scope=applications.commands+bot&permissions=274878286912"><img alt="Add to a server" src="https://img.shields.io/badge/Add%20to%20a%20server-2A2A2E?style=for-the-badge&labelColor=0F0F10"></a>
</p>

> [!NOTE]
> A screen recording in a real Discord client is not available yet (see [`assets/README.md`](../../assets/README.md)).

## Commands

Command names and descriptions are localised in English and French; replies are in French. Most commands work
everywhere: in servers, in direct messages and in private channels when the app is added to *your* account.

| Command | What it does | Needs |
|---|---|---|
| `/convert url format quality visibility` | Convert a YouTube, TikTok or X video to MP4 or MP3 | linked account |
| `/audio url bitrate` | Extract the audio as MP3 | linked account |
| *Convert with AETHRYON* (message menu) | Convert the link found in a message | linked account |
| `/preview url` | Private preview: title, length, sizes | linked account |
| `/clip url …` | Cut a part of a video (MP4 up to 3 min, MP3 up to 10 min) | linked account |
| `/gif url … duration` | Animated GIF from a passage (1–30 s, default 5) | linked account |
| `/account link` · `status` · `unlink` | Link your Discord account to AETHRYON, see status and quota, unlink | — |
| `/quota` | Conversions left today | linked account |
| `/history count` | Your recent conversions (1–10) | linked account |
| `/saved search platform type` | Your saved media library | linked account |
| `/settings` | Default format, quality and privacy | linked account |
| `/config` | Server settings (requires *Manage Server*) | server admin |
| `/status` | Your conversions in progress and the service status | — |
| `/help` | What AETHRYON can do | — |

Results are private (*only me*) unless you choose *everyone here* and the server allows it. Large files are
delivered through a temporary AETHRYON link instead of an attachment.

## Permissions

- **User install** (*Add to my apps*): commands only, no permission.
- **Server install** (*Add to a server*): `View Channels`, `Send Messages`, `Send Messages in Threads`,
  `Embed Links`, `Attach Files`, `Read Message History`, `Add Reactions`, `Use External Emojis`
  (permission integer `274878286912`). No administrator role. The privileged *Message Content* intent is requested
  only when automatic cards for posted links are enabled (`AUTO_EMBEDS_ENABLED=1`).

## Self-hosting

You need your own Discord application (Developer Portal) and, for linking and conversions, your own AETHRYON
account service and media API.

```bash
cp .env.example .env                 # ids and switches — example values
mkdir -p secrets && printf '%s' "<your bot token>" > secrets/discord_bot_token && chmod 600 secrets/discord_bot_token
npm ci && npm run build
DISCORD_BOT_TOKEN_FILE=secrets/discord_bot_token npm run register    # guild commands on DISCORD_GUILD_ID
DISCORD_BOT_TOKEN_FILE=secrets/discord_bot_token npm start
```

With Docker, use the optional `discord` profile of [`compose.dev.yml`](../../compose.dev.yml) (token in
`.dev/secrets/discord-bot/discord_bot_token`). Never put the token in an environment variable, a commit or a log.

Feature switches are **closed by default** and checked for consistency at start-up (for example `CONVERT_ENABLED=1`
requires `LINK_ENABLED=1`); see [`.env.example`](.env.example). Without `LINK_ENABLED`, the bot answers with honest
information messages only.

Global commands (visible wherever the app is installed) are registered only with
`DISCORD_GLOBAL_OK=1 node dist/register.js --global`. `npm run commands:json` prints the command definitions without
contacting Discord.

## Development

```bash
npm ci
npm run typecheck
npm test            # unit and flow tests with fake Discord and fake AETHRYON services (no network)
```

## Data

The bot keeps no database. It sees the Discord user ID and the command options; account stores the link between a
Discord ID and an AETHRYON account (unlink at any time with `/account unlink`). E-mail addresses are masked in
replies (`a•••@example.com`) and shown only to the account owner.
