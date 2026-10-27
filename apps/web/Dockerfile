# ytc2-web : SPA (Vite/React) servie par nginx non privilégié + proxy /api vers le service account.
# Pages publiques pré-rendues à la construction (vrai contenu sans JavaScript), coque neutre pour les
# routes de l'application, vraie 404 pour le reste (scripts/prerender.mjs, nginx/default.conf).
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY scripts ./scripts
# nginx/ : lu par scripts/prerender.mjs (chaque route doit être servie par le bon fichier).
COPY nginx ./nginx
COPY src ./src
# Extension navigateur (distribution directe) : latest.json de la release, lu par vite.config.ts si
# EXTENSION_DOWNLOAD=1 (dossier vide sinon ; scripts/fetch-downloads.sh le prépare toujours).
COPY public-downloads/extension ./public-downloads/extension
ARG EXTENSION_DOWNLOAD=0
RUN test "$EXTENSION_DOWNLOAD" = 0 -o "$EXTENSION_DOWNLOAD" = 1 || { echo "EXTENSION_DOWNLOAD doit valoir 0 ou 1" >&2; exit 1; }
# CONTROL_CENTER=0 : build sans le Control Center (site public tant qu'il n'est pas validé) ; code exclu du
# bundle (routes.tsx) et bloc /admin retiré de nginx (étape runtime). Par défaut : inclus (préproduction).
ARG CONTROL_CENTER=1
# INDEXING=1 : ouvre l'indexation (décision du propriétaire, docs/DEPLOIEMENT.md §12) : pages publiques en
# « index, follow » (balise et en-tête), robots.txt ouvert avec le plan du site, /sitemap.xml servi.
# Par défaut 0 : « noindex, nofollow » partout, robots.txt « Disallow: / », /sitemap.xml en 404.
ARG INDEXING=0
RUN test "$CONTROL_CENTER" = 1 -o "$CONTROL_CENTER" = 0 || { echo "CONTROL_CENTER doit valoir 0 ou 1" >&2; exit 1; }
RUN test "$INDEXING" = 1 -o "$INDEXING" = 0 || { echo "INDEXING doit valoir 0 ou 1" >&2; exit 1; }
# Identité : la tête maître seule (VITE_MASCOT=master ; l'exploration C3 « vector » est retirée depuis Égide).
ARG VITE_MASCOT=master
RUN test "$VITE_MASCOT" = master || { echo "VITE_MASCOT : seule la tête maître existe (Égide)" >&2; exit 1; }
# Aperçu seulement : ALLOW_LEGAL_PLACEHOLDERS=1 accepte des informations légales « À compléter » (refusées sinon).
ARG ALLOW_LEGAL_PLACEHOLDERS=0
# Ce que fait réellement le bot Discord en production (src/lib/discord.ts) : décrit tel quel dans /conditions et
# /confidentialite. inactif (défaut) | informations | conversion — à changer à chaque étape du plan de mise en
# production du bot, jamais avant l'étape elle-même.
ARG DISCORD_PHASE=inactif
RUN test "$DISCORD_PHASE" = inactif -o "$DISCORD_PHASE" = informations -o "$DISCORD_PHASE" = conversion -o "$DISCORD_PHASE" = media -o "$DISCORD_PHASE" = media-auto || { echo "DISCORD_PHASE doit valoir inactif, informations, conversion, media ou media-auto" >&2; exit 1; }
# Logos des plateformes (src/lib/logos.ts, docs/MARQUES.md) : neutres (défaut, règle en vigueur) | officiels (vrais logos
# YouTube, TikTok, X, Apple, Chrome : SEULEMENT sur décision explicite du propriétaire ; check-dist le signale).
ARG LOGOS_PLATEFORMES=neutres
RUN test "$LOGOS_PLATEFORMES" = neutres -o "$LOGOS_PLATEFORMES" = officiels || { echo "LOGOS_PLATEFORMES doit valoir neutres ou officiels" >&2; exit 1; }
# Section « Tarifs » (src/lib/offres.ts) : reelles (défaut : l'offre réelle seule, la bêta gratuite) | apercu (V3 : Free
# réel + Plus et Pro PROPOSÉS, « Bientôt », « Me prévenir », aucun paiement — PAIEMENT_OUVERT reste faux).
ARG OFFRES=reelles
RUN test "$OFFRES" = reelles -o "$OFFRES" = apercu -o "$OFFRES" = vente || { echo "OFFRES doit valoir reelles, apercu ou vente" >&2; exit 1; }
# « Premium à vie » (20 € une fois) montrée en option secondaire (1, défaut) ou masquée (0) ; sa vente se ferme côté
# serveur (BILLING_OFFRE_VIE=0).
ARG OFFRE_VIE=1
RUN test "$OFFRE_VIE" = 0 -o "$OFFRE_VIE" = 1 || { echo "OFFRE_VIE doit valoir 0 ou 1" >&2; exit 1; }
RUN ALLOW_LEGAL_PLACEHOLDERS=$ALLOW_LEGAL_PLACEHOLDERS VITE_LEGAL_DRAFT=$ALLOW_LEGAL_PLACEHOLDERS VITE_DISCORD_PHASE=$DISCORD_PHASE VITE_CONTROL_CENTER=$CONTROL_CENTER VITE_MASCOT=$VITE_MASCOT VITE_LOGOS_PLATEFORMES=$LOGOS_PLATEFORMES VITE_OFFRES=$OFFRES VITE_OFFRE_VIE=$OFFRE_VIE INDEXING=$INDEXING EXTENSION_DOWNLOAD=$EXTENSION_DOWNLOAD npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:15c994d10d6d78658721c3bcafff14cb281fba2a4bdf9d5ba92c416a472516e3 AS runtime
# Préproduction par défaut ; en production : ACCOUNT_UPSTREAM=ytc-account:3000, REAL_IP_FROM=<réseau de Traefik>.
# REAL_IP_FROM est OBLIGATOIRE (pas de valeur par défaut) : une valeur fausse ferait partager à tous les
# visiteurs la même IP pour les limites de débit. Préprod : 127.0.0.1/32 ; production : réseau de Traefik.
ARG ACCOUNT_UPSTREAM=ytc2-pp-account:3000
# Cap standalone (anti-bot) sur le réseau interne ytc-cap : nom résolu par Docker ; absent → /cap/* en 502 (rien d'autre).
ARG CAP_UPSTREAM=ytc-cap:3000
ARG REAL_IP_FROM
ARG ROBOTS="noindex, nofollow"
ARG CONTROL_CENTER=1
ARG INDEXING=0
USER root
RUN test -n "$REAL_IP_FROM" || { echo "REAL_IP_FROM manquant (--build-arg REAL_IP_FROM=...)" >&2; exit 1; }
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.conf nginx/html.conf nginx/security-headers-cloud.conf nginx/html-cloud.conf nginx/security-headers-musique.conf nginx/html-musique.conf /etc/nginx/
RUN if [ "$CONTROL_CENTER" = 0 ]; then sed -i '/# >>> control-center/,/# <<< control-center/d' /etc/nginx/conf.d/default.conf \
      && ! grep -q "admin-session" /etc/nginx/conf.d/default.conf; \
    else sed -i '/# >>> sans-control-center/,/# <<< sans-control-center/d' /etc/nginx/conf.d/default.conf \
      && grep -q "admin-session" /etc/nginx/conf.d/default.conf; fi
ARG OFFRES=reelles
RUN if [ "$OFFRES" = reelles ]; then sed -i '/# >>> premium/,/# <<< premium/d' /etc/nginx/conf.d/default.conf \
      && ! grep -q "location = /premium" /etc/nginx/conf.d/default.conf; fi
RUN if [ "$INDEXING" = 0 ]; then sed -i '/# >>> indexation/,/# <<< indexation/d' /etc/nginx/conf.d/default.conf \
      && ! grep -q "location = /sitemap.xml" /etc/nginx/conf.d/default.conf; fi
RUN if [ "$INDEXING" = 1 ]; then ROBOTS_PAGES="index, follow"; else ROBOTS_PAGES="$ROBOTS"; fi \
 && sed -i "s|__ACCOUNT_UPSTREAM__|${ACCOUNT_UPSTREAM}|; s|__CAP_UPSTREAM__|${CAP_UPSTREAM}|; s|__REAL_IP_FROM__|${REAL_IP_FROM}|; s|__ROBOTS_PAGES__|${ROBOTS_PAGES}|; s|__ROBOTS__|${ROBOTS}|" /etc/nginx/conf.d/default.conf \
 && ! cat /etc/nginx/conf.d/default.conf /etc/nginx/security-headers.conf /etc/nginx/html.conf /etc/nginx/security-headers-cloud.conf /etc/nginx/html-cloud.conf /etc/nginx/security-headers-musique.conf /etc/nginx/html-musique.conf | grep -v "^\s*#" | grep -q "__" \
 && nginx -t
RUN rm -f /usr/share/nginx/html/50x.html
# Archive des fichiers /assets des versions précédentes (volume ytc-web-assets en production, lecture seule ;
# vide ailleurs) : nginx/default.conf, location @asset_archive.
RUN mkdir -p /usr/share/nginx/archive/assets
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html
COPY --chown=101:101 public-downloads/ /usr/share/nginx/html/downloads/
# Sans publication de l'extension, aucun de ses fichiers n'est servi, même si le dossier n'avait pas été vidé.
ARG EXTENSION_DOWNLOAD=0
RUN if [ "$EXTENSION_DOWNLOAD" != 1 ]; then rm -rf /usr/share/nginx/html/downloads/extension; fi
USER 101
EXPOSE 8080
# Sonde rapprochée : Traefik n'envoie le trafic qu'à un conteneur « healthy » ; avec Docker 20.10 (pas de
# start-interval), la première sonde part après « interval ». Avec 10 s, deploy-web.sh attendait ~11 s un site sain
# à chaque mise en ligne ; avec 2 s, la coupure mesurée par deploy-web.sh est de ~5,5 s (arrêt de l'ancien conteneur
# compris, 2026-10-14, docs/DEPLOIEMENT.md §27). Le site gère cette coupure (src/app/RouteError.tsx).
HEALTHCHECK --interval=2s --timeout=2s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/robots.txt >/dev/null 2>&1 || exit 1
