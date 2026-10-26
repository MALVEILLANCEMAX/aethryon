# ytc2-account : comptes Google, jetons API personnels, quotas (Node 22, Hono, Better Auth, SQLite).
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS runtime
ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
# /data : base SQLite et sauvegardes (volume nommé ; propriétaire = utilisateur non root du conteneur).
RUN mkdir -p /data/backups && chown -R node:node /data && chmod 700 /data
USER node
EXPOSE 3000 3001 3002
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1
CMD ["node", "dist/main.js"]
