#!/usr/bin/env bash
# Pile de DÉMONSTRATION jetable de l'extension 1.0.0 (branche integration/extension-v1) : le VRAI ZIP final
# parle à cette pile comme à la production, grâce à un relais TLS local (dx-proxy.mjs) et aux règles de
# résolution du navigateur de test. Rien de la production n'est touché :
# - conteneurs ytc2-dx-{web,account,ytapi} créés par `docker create` : AUCUN label ;
# - réseaux propres ytc2-dx-edge et ytc2-dx-internal (interne, 10.251.60.0/24), volumes neufs ytc2-dx-* ;
# - secrets jetables générés ici (jamais affichés) ; ports publiés sur 127.0.0.1 seulement : 18190 (site), 18191 (ytapi) ;
# - account se croit à https://raccourci.malvu.fr (PUBLIC_URL) et n'autorise que l'extension distribuée
#   (EXTENSION_IDS=necpohicddjeaeaaomaakehcbccapabg) ; ytapi a un FAUX worker (aucune requête vers une plateforme).
# Images à construire d'abord depuis la branche (voir README.md) : ytc2-account:dx, ytc2-ytapi:dx, ytc2-web:dx.
#   bash dx-stack.sh up | down
set -euo pipefail
# Secrets jetables HORS du dépôt (jamais versionnés) : $DX_STATE (défaut /tmp/aethryon-dx).
L=${DX_STATE:-/tmp/aethryon-dx}
mkdir -p "$L" && chmod 700 "$L"
SEC=$L/secrets
P=ytc2-dx
case "${1:-}" in
up)
  umask 077
  mkdir -p "$SEC/account" "$SEC/ytapi"
  rand() { head -c 48 /dev/urandom | base64 | tr -d '\n/+='; }
  [[ -s $SEC/account/better_auth_secret ]] || rand > "$SEC/account/better_auth_secret"
  [[ -s $SEC/account/account_internal_token ]] || rand > "$SEC/account/account_internal_token"
  cp "$SEC/account/account_internal_token" "$SEC/ytapi/account_internal_token"
  [[ -s $SEC/ytapi/tokens ]] || printf 'demo %s\n' "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$SEC/ytapi/tokens"
  chown -R 1000:1000 "$SEC/account" && chmod 700 "$SEC/account" && chmod 400 "$SEC"/account/*
  chown -R 10001:10001 "$SEC/ytapi" && chmod 700 "$SEC/ytapi" && chmod 400 "$SEC"/ytapi/*
  docker network create $P-edge >/dev/null
  docker network create --internal --subnet 10.251.60.0/24 $P-internal >/dev/null
  docker volume create $P-account-data >/dev/null
  docker volume create $P-ytapi-tmp >/dev/null
  docker create --name $P-account --read-only --user 1000:1000 --tmpfs /tmp:size=16m,mode=1777 \
    -v $P-account-data:/data -v "$SEC/account:/run/secrets:ro" \
    -e PUBLIC_URL=https://raccourci.malvu.fr \
    -e BETTER_AUTH_SECRET_FILE=/run/secrets/better_auth_secret -e INTERNAL_TOKEN_FILE=/run/secrets/account_internal_token \
    -e GOOGLE_CLIENT_ID_FILE=/run/secrets/google_client_id -e GOOGLE_CLIENT_SECRET_FILE=/run/secrets/google_client_secret \
    -e DB_PATH=/data/account.sqlite -e BACKUP_DIR=/data/backups \
    -e YTAPI_INTERNAL_URL=http://ytapi-internal:8000 -e API_PUBLIC_URL=https://api.malvu.fr/media \
    -e ICLOUD_SHORTCUT_URL=https://www.icloud.com/shortcuts/e1e2eaadf6c841bd884c9dbe680675d1 -e SHORTCUT_VERSION=3.0 \
    -e FALLBACK_DOWNLOAD=/downloads/AETHRYON.shortcut -e DAILY_CONVERSIONS=10 -e MAX_ACTIVE_JOBS=1 -e MAX_KEYS_PER_USER=2 \
    -e MAX_USERS=50 -e ADMIN_EMAILS=admin@demo.test -e TRUST_PROXY_IP_HEADER=x-real-ip \
    -e INTERNAL_ALLOW_FROM=10.251.60.0/24 -e YTC_ALLOW_TEST_SESSIONS=1 -e USER_KEYS_ACTIVE=1 \
    -e EXTENSION_IDS=necpohicddjeaeaaomaakehcbccapabg \
    --cpus 0.5 --memory 256m --memory-swap 256m --pids-limit 128 --cap-drop ALL --security-opt no-new-privileges:true \
    --network $P-edge ytc2-account:dx >/dev/null
  docker network connect --alias account-internal $P-internal $P-account
  docker create --name $P-ytapi --read-only --tmpfs /tmp:size=64m,mode=1777 \
    --tmpfs /home/app:size=16m,uid=10001,gid=10001,mode=0700 \
    -v $P-ytapi-tmp:/data/tmp -v "$SEC/ytapi:/run/secrets:ro" \
    -e TOKENS_FILE=/run/secrets/tokens -e CACHE_DIR= -e USER_KEYS_ENABLED=true -e ROOT_PATH=/media \
    -e ACCOUNT_INTERNAL_URL=http://account-internal:3001 -e ACCOUNT_INTERNAL_TOKEN_FILE=/run/secrets/account_internal_token \
    -e USER_KEY_CACHE_S=0 -e MAX_FILESIZE_MB=50 -e "FORWARDED_ALLOW_IPS=*" -e INTERNAL_ALLOW_FROM=10.251.60.0/24 \
    -p 127.0.0.1:18191:8000 \
    --cpus 1.0 --memory 512m --memory-swap 512m --pids-limit 128 --cap-drop ALL --security-opt no-new-privileges:true \
    --network $P-edge ytc2-ytapi:dx \
    sh -c 'exec uvicorn preprod_fake:app --host 0.0.0.0 --port 8000 --workers 1 --proxy-headers --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}" --root-path "${ROOT_PATH:-}" --no-access-log --no-server-header --timeout-graceful-shutdown 10' >/dev/null
  # ↑ même --root-path que la production (entrypoint.sh) : l'image de préproduction l'omet dans sa commande.
  docker network connect --alias ytapi-internal $P-internal $P-ytapi
  docker create --name $P-web --read-only --tmpfs /tmp:size=16m,mode=1777 -p 127.0.0.1:18190:8080 \
    --cpus 0.25 --memory 64m --memory-swap 64m --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges:true \
    --network $P-edge ytc2-web:dx >/dev/null
  docker start $P-account $P-ytapi $P-web >/dev/null
  for i in $(seq 1 90); do
    s=$(docker inspect -f '{{.State.Health.Status}}' $P-account $P-ytapi $P-web | tr '\n' ' ')
    [[ $s == "healthy healthy healthy " ]] && { echo "pile dx saine (~${i}s)"; exit 0; }
    sleep 1
  done
  echo "pile dx pas saine : $s" >&2; exit 1 ;;
down)
  docker rm -f $P-web $P-ytapi $P-account >/dev/null 2>&1 || true
  docker network rm $P-internal $P-edge >/dev/null 2>&1 || true
  docker volume rm $P-account-data $P-ytapi-tmp >/dev/null 2>&1 || true
  rm -rf "$SEC"
  echo "pile dx supprimée (conteneurs, réseaux, volumes, secrets)" ;;
*) echo "usage : dx-stack.sh up | down" >&2; exit 2 ;;
esac
