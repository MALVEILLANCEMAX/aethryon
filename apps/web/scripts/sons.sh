#!/usr/bin/env bash
# Son du cookie pour la lecture : le MÊME son que public/media/sons/cookie.wav (fichier du propriétaire, jamais modifié),
# encodé en MP3 192 kbit/s, 48 kHz, stéréo (≈ 48 Ko au lieu de 756 Ko). Aucun effet, aucun changement de volume : le
# gain est appliqué à la lecture (src/lib/sons.ts). Sortie reproductible (métadonnées retirées).
#   bash web/scripts/sons.sh
set -euo pipefail
D="$(cd "$(dirname "$0")/.." && pwd)/public/media/sons"
ffmpeg -hide_banner -loglevel error -y -i "$D/cookie.wav" -map_metadata -1 -fflags +bitexact -flags:a +bitexact \
  -c:a libmp3lame -b:a 192k -ar 48000 -ac 2 "$D/cookie.mp3"
ls -l "$D/cookie.mp3"
