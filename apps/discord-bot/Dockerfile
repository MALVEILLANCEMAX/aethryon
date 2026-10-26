# Bot Discord AETHRYON. Aucun secret dans l'image : le token est monté à l'exécution
# (deploy/secrets/discord/discord_bot_token → /run/secrets/discord_bot_token, lecture seule).
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920
ENV NODE_ENV=production \
    DISCORD_BOT_TOKEN_FILE=/run/secrets/discord_bot_token \
    HEARTBEAT_FILE=/tmp/aethryon-discord-heartbeat
WORKDIR /app
COPY --from=build --chown=root:root /app/package.json ./
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/dist ./dist
USER 1000:1000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD ["node", "dist/health.js"]
CMD ["node", "dist/bot.js"]
