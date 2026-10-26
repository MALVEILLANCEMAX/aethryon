#!/usr/bin/env bash
# End-to-end smoke test with curl against a running ytapi.
#
#   ./scripts/smoke_test.sh                         # https://api.malvu.fr/media, TikTok + X only
#   SKIP_YT=0 ./scripts/smoke_test.sh               # + up to 2 YouTube requests (skipped during a pause)
#   BASE_URL=http://127.0.0.1:18081 ./scripts/smoke_test.sh
#
# Token: $API_TOKEN, else API_TOKEN from ./.env, else the first token of ./secrets/tokens. It only
# travels through 0600 temp files (curl -H @file / -K file), never on a command line.
# Heavy calls (/dl, /info, POST /jobs) are spaced by $PAUSE seconds to stay under RATE_LIMIT.
set -uo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="${BASE_URL:-https://api.malvu.fr/media}"
BASE_URL="${BASE_URL%/}"
OUT_DIR="${OUT_DIR:-$(mktemp -d)}"
SKIP_YT="${SKIP_YT:-1}"
PAUSE="${PAUSE:-3.2}"
TT_URL="${TT_URL:-https://www.tiktok.com/@scout2015/video/6718335390845095173}"
X_URL="${X_URL:-https://x.com/historyinmemes/status/1790637656616943991}"
X_GIF_URL="${X_GIF_URL:-https://x.com/GrimboGrim/status/1839019491835129889}"
YT_URL="${YT_URL:-https://www.youtube.com/watch?v=jNQXAC9IVRw}"
mkdir -p "$OUT_DIR"

if [[ -z "${API_TOKEN:-}" && -f "$HERE/.env" ]]; then
    API_TOKEN="$(grep -E '^API_TOKEN=' "$HERE/.env" | head -n1 | cut -d= -f2-)"
fi
if [[ -z "${API_TOKEN:-}" && -r "$HERE/secrets/tokens" ]]; then
    API_TOKEN="$(grep -vE '^\s*(#|$)' "$HERE/secrets/tokens" | head -n1 | awk '{print $2}')"
fi
[[ -n "${API_TOKEN:-}" ]] || { echo "Aucun jeton (API_TOKEN, .env ou secrets/tokens)."; exit 2; }

HDR="$(mktemp)"; CFG="$(mktemp)"; chmod 600 "$HDR" "$CFG"
trap 'rm -f "$HDR" "$CFG"' EXIT
printf 'Authorization: Bearer %s\n' "$API_TOKEN" > "$HDR"

PASS=0; FAIL=0
ok()    { echo "  PASS  $1"; PASS=$((PASS + 1)); }
ko()    { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }
json()  { python3 -c "import sys, json; d = json.load(sys.stdin); print($1)" 2>/dev/null; }
enc()   { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"; }
pause() { sleep "$PAUSE"; }

# req <name> <expected_status> <path?query> <outfile> [extra curl args...]
# Response headers go to $OUT_DIR/last.headers.
req() {
    local name=$1 expected=$2 path=$3 out=$4; shift 4
    local code
    code=$(curl -sS -H @"$HDR" -D "$OUT_DIR/last.headers" -o "$out" -w '%{http_code}' --max-time 600 "$@" "$BASE_URL$path") || code=000
    if [[ "$code" == "$expected" ]]; then ok "$name ($code)"; else ko "$name (reçu $code, attendu $expected) $(head -c 200 "$out" 2>/dev/null)"; fi
}
header() { grep -i "^$1:" "$OUT_DIR/last.headers" | head -n1 | cut -d: -f2- | tr -d ' \r'; }
is_json_error() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if {"error","detail"} <= set(d) else 1)' "$1" 2>/dev/null; }
json_code() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("error",""))' "$1" 2>/dev/null; }

echo "== ytapi smoke test : $BASE_URL (fichiers : $OUT_DIR, YouTube : $([[ $SKIP_YT == 1 ]] && echo ignoré || echo inclus))"

echo "-- public, auth, allowlist"
health=$(curl -sS --max-time 15 "$BASE_URL/health")
if [[ "$(echo "$health" | json 'd["status"]')" == "ok" ]]; then
    ok "GET /health -> yt-dlp $(echo "$health" | json 'd["versions"]["yt_dlp"]'), ffmpeg $(echo "$health" | json 'd["versions"]["ffmpeg"]')"
else
    ko "GET /health ($health)"
fi
code=$(curl -sS -o "$OUT_DIR/bad.json" -w '%{http_code}' -H 'Authorization: Bearer mauvais-jeton-de-test' \
    "$BASE_URL/info?url=$(enc "$TT_URL")")
if [[ "$code" == 401 ]] && is_json_error "$OUT_DIR/bad.json"; then ok "mauvais jeton -> 401 JSON de ytapi"; else ko "mauvais jeton -> $code $(cat "$OUT_DIR/bad.json")"; fi
code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/status")
[[ "$code" == 401 ]] && ok "/status sans jeton -> 401" || ko "/status sans jeton -> $code"
req "/status" 200 "/status" "$OUT_DIR/status.json"
echo "        plateformes : $(json 'json.dumps({k: v["state"] for k, v in d["platforms"].items()})' < "$OUT_DIR/status.json") · cookies : $(json 'd["cookies"]["state"]' < "$OUT_DIR/status.json")"
req "domaine interdit -> 400" 400 "/info?url=$(enc 'https://youtube.com.evil.com/watch?v=x')" "$OUT_DIR/evil.json"; pause
req "file:// -> 400" 400 "/info?url=$(enc 'file:///etc/passwd')" "$OUT_DIR/file.json"; pause
code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/docs")
[[ "$code" == 404 ]] && ok "/docs désactivé (404)" || ko "/docs -> $code"

echo "-- TikTok"
req "/info TikTok" 200 "/info?url=$(enc "$TT_URL")" "$OUT_DIR/info.json"; pause
echo "        titre : $(json 'd.get("title")' < "$OUT_DIR/info.json" | head -c 60)"
req "/dl TikTok mp3 192k" 200 "/dl?fmt=mp3&bitrate=192&url=$(enc "$TT_URL")" "$OUT_DIR/tt.mp3"; pause
req "/dl TikTok mp3 (2e fois : cache)" 200 "/dl?fmt=mp3&bitrate=192&url=$(enc "$TT_URL")" "$OUT_DIR/tt2.mp3"
cache=$(header x-cache); [[ "$cache" == hit ]] && ok "cache : X-Cache=hit" || ko "cache : X-Cache=$cache"; pause
req "Range hors fichier -> 416 JSON" 416 "/dl?fmt=mp3&bitrate=192&url=$(enc "$TT_URL")" "$OUT_DIR/range.json" -H 'Range: bytes=999999999-'
code_r=$(json_code "$OUT_DIR/range.json")
[[ "$code_r" == range_not_satisfiable ]] && ok "erreur Range en JSON (range_not_satisfiable)" || ko "erreur Range : '$code_r'"; pause
# Query-string token (what iOS Shortcuts may use), passed through the 0600 curl config file.
token_q=$(printf %s "$API_TOKEN" | python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=""))')
printf 'url = "%s"\n' "$BASE_URL/dl?fmt=mp4&quality=480&url=$(enc "$TT_URL")&token=$token_q" > "$CFG"
code=$(curl -sS -K "$CFG" -o "$OUT_DIR/tt.mp4" -w '%{http_code}' --max-time 600) || code=000
[[ "$code" == 200 ]] && ok "/dl TikTok mp4 avec ?token= (200)" || ko "/dl avec ?token= -> $code"; pause

echo "-- X"
req "/dl X vidéo mp4" 200 "/dl?url=$(enc "$X_URL")" "$OUT_DIR/x.mp4"; pause
req "/dl X GIF -> .gif" 200 "/dl?fmt=gif&gif_width=320&url=$(enc "$X_GIF_URL")" "$OUT_DIR/x.gif"; pause
req "/dl X GIF en mp3 -> 400" 400 "/dl?fmt=mp3&url=$(enc "$X_GIF_URL")" "$OUT_DIR/nogif.json"
code_n=$(json_code "$OUT_DIR/nogif.json")
[[ "$code_n" == no_audio ]] && ok "erreur no_audio" || ko "attendu no_audio, reçu '$code_n'"; pause
if command -v ffprobe >/dev/null; then
    for f in tt.mp3 tt.mp4 x.mp4 x.gif; do
        echo "        $f : $(ffprobe -v error -show_entries stream=codec_name -of csv=p=0 "$OUT_DIR/$f" 2>/dev/null | paste -sd, -)"
    done
fi

echo "-- jobs (POST /jobs?wait=20, comme le Raccourci)"
code=$(curl -sS -H @"$HDR" -H 'Content-Type: application/json' -X POST --max-time 60 -o "$OUT_DIR/job.json" -w '%{http_code}' \
    -d "{\"url\": \"$X_URL\", \"fmt\": \"mp3\", \"bitrate\": \"128\"}" "$BASE_URL/jobs?wait=20") || code=000
job_id=$(json 'd["job_id"]' < "$OUT_DIR/job.json")
if [[ -z "$job_id" || ( "$code" != 200 && "$code" != 202 ) ]]; then
    ko "POST /jobs -> $code $(head -c 200 "$OUT_DIR/job.json") : arrêt des tests jobs"
else
    ok "POST /jobs?wait=20 -> $code, statut $(json 'd["status"]' < "$OUT_DIR/job.json")"
    status=$(json 'd["status"]' < "$OUT_DIR/job.json")
    for _ in $(seq 1 30); do
        [[ "$status" == done || "$status" == error ]] && break
        curl -sS -H @"$HDR" -o "$OUT_DIR/job.json" "$BASE_URL/jobs/$job_id?wait=10"
        status=$(json 'd["status"]' < "$OUT_DIR/job.json")
        echo "        $status $(json 'd["stage"]' < "$OUT_DIR/job.json") $(json 'd["progress"]' < "$OUT_DIR/job.json")%"
    done
    if [[ "$status" == done ]]; then
        ok "job terminé"
        file_url=$(json 'd["file_url"]' < "$OUT_DIR/job.json")
        code=$(curl -sS -H @"$HDR" -o "$OUT_DIR/job.mp3" -w '%{http_code}' "$file_url") || code=000
        [[ "$code" == 200 ]] && ok "GET file_url (200)" || ko "GET file_url -> $code"
    else
        ko "job terminé en '$status' : $(json 'd.get("detail")' < "$OUT_DIR/job.json")"
    fi
    req "DELETE /jobs/{id}" 200 "/jobs/$job_id" "$OUT_DIR/del.json" -X DELETE
    req "job supprimé -> 404" 404 "/jobs/$job_id" "$OUT_DIR/gone.json"
fi

if [[ "$SKIP_YT" != 1 ]]; then
    cooldown=$(json 'd["platforms"]["youtube"]["cooldown_until"] or ""' < "$OUT_DIR/status.json")
    if [[ -n "$cooldown" ]]; then
        echo "-- YouTube ignoré : pause automatique jusqu'à $cooldown (aucune requête envoyée)"
    else
        echo "-- YouTube (au plus 2 requêtes espacées de 30 s ; la 2e seulement si la 1re réussit)"
        pause
        before=$FAIL
        req "/info YouTube" 200 "/info?url=$(enc "$YT_URL")" "$OUT_DIR/yt.json"
        if [[ "$FAIL" == "$before" ]]; then
            sleep 30
            req "/dl YouTube mp3" 200 "/dl?fmt=mp3&url=$(enc "$YT_URL")" "$OUT_DIR/yt.mp3"
        else
            echo "        /info YouTube a échoué : /dl YouTube non tenté"
        fi
    fi
fi

echo "== $PASS réussis, $FAIL échoués"
[[ "$FAIL" == 0 ]]
