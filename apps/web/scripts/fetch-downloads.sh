#!/usr/bin/env bash
# Copie le raccourci signé EXISTANT (jamais régénéré) dans le contexte de build du site,
# après vérification de son empreinte. Lecture seule sur la source.
set -euo pipefail
SRC="${SHORTCUT_DIST:-$(cd "$(dirname "$0")/../../.." && pwd)/shortcuts/ios/dist}"
DST="$(cd "$(dirname "$0")/.." && pwd)/public-downloads"
mkdir -p "$DST"
# Legacy v1 file (« YouTube-Converter.shortcut ») : copied only if present (the public repository ships AETHRYON only).
if [[ -f "$SRC/YouTube-Converter.shortcut" ]]; then
  ( cd "$SRC" && sha256sum --quiet -c YouTube-Converter.shortcut.sha256 )
  install -m 0644 "$SRC/YouTube-Converter.shortcut" "$DST/YouTube-Converter.shortcut"
  head -c 4 "$DST/YouTube-Converter.shortcut" | grep -q AEA1 || { echo "fichier non signé (pas AEA1)" >&2; exit 1; }
  echo "raccourci v1 copié"
fi
[[ -f "$SRC/AETHRYON.shortcut" ]] || { echo "AETHRYON.shortcut absent de $SRC" >&2; exit 1; }
# Version de diagnostic (lien direct, non proposée sur le site) si elle existe.
if [[ -f "$SRC/YouTube-Converter-DEBUG.shortcut" ]]; then
  ( cd "$SRC" && sha256sum --quiet -c YouTube-Converter-DEBUG.shortcut.sha256 )
  install -m 0644 "$SRC/YouTube-Converter-DEBUG.shortcut" "$DST/YouTube-Converter-DEBUG.shortcut"
  echo "version DEBUG copiée (empreinte vérifiée)"
fi
# Raccourci v2 en test (lien direct, non proposé sur le site) tant que l'iPhone ne l'a pas validé.
if [[ -f "$SRC/YouTube-Converter-v2.shortcut" ]]; then
  ( cd "$SRC" && sha256sum --quiet -c YouTube-Converter-v2.shortcut.sha256 )
  install -m 0644 "$SRC/YouTube-Converter-v2.shortcut" "$DST/YouTube-Converter-v2.shortcut"
  head -c 4 "$DST/YouTube-Converter-v2.shortcut" | grep -q AEA1 || { echo "v2 non signé (pas AEA1)" >&2; exit 1; }
  echo "raccourci v2 (test) copié (empreinte vérifiée)"
fi
if [[ -f "$SRC/AETHRYON.shortcut" ]]; then
  ( cd "$SRC" && sha256sum --quiet -c AETHRYON.shortcut.sha256 )
  install -m 0644 "$SRC/AETHRYON.shortcut" "$DST/AETHRYON.shortcut"
  head -c 4 "$DST/AETHRYON.shortcut" | grep -q AEA1 || { echo "AETHRYON non signé (pas AEA1)" >&2; exit 1; }
  echo "raccourci AETHRYON (v3) copié (empreinte vérifiée)"
fi
# Extension navigateur (distribution directe, docs/EXTENSION.md) : copiée SEULEMENT avec EXTENSION_DOWNLOAD=1, depuis
# la release reproductible d'extension/ (archive, SHA256SUMS, latest.json), après vérification des empreintes et de
# la cohérence de latest.json. Sans publication, le dossier est vidé : rien n'est servi (404).
EXT_DST="$DST/extension"
rm -rf "$EXT_DST" && mkdir -p "$EXT_DST"
if [[ "${EXTENSION_DOWNLOAD:-0}" == 1 ]]; then
  EXT_SRC="${EXTENSION_RELEASE_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/extension/release}"
  [[ -f "$EXT_SRC/latest.json" && -f "$EXT_SRC/SHA256SUMS" ]] || { echo "release de l'extension absente ($EXT_SRC) : node extension/scripts/zip.mjs" >&2; exit 1; }
  file="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!/^aethryon-extension-\d+\.\d+\.\d+\.zip$/.test(r.file)||r.file!==`aethryon-extension-${r.version}.zip`) process.exit(2); process.stdout.write(r.file)' "$EXT_SRC/latest.json")" || { echo "latest.json incohérent" >&2; exit 1; }
  ( cd "$EXT_SRC" && grep " ${file}\$\| \*${file}\$" SHA256SUMS | sha256sum --quiet -c - ) || { echo "empreinte de $file différente de SHA256SUMS" >&2; exit 1; }
  sum="$(sha256sum "$EXT_SRC/$file" | cut -d' ' -f1)"
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(r.sha256!==process.argv[2]||r.size!==Number(process.argv[3])) process.exit(2)' "$EXT_SRC/latest.json" "$sum" "$(stat -c %s "$EXT_SRC/$file")" || { echo "latest.json ne correspond pas à l'archive" >&2; exit 1; }
  install -m 0644 "$EXT_SRC/$file" "$EXT_SRC/SHA256SUMS" "$EXT_SRC/latest.json" "$EXT_DST/"
  echo "extension $file copiée (sha256 ${sum:0:16}…)"
fi
# AETHRYON pour Premiere Pro (extension CEP + Desktop, Windows) : publié le 2026-10-18 à la demande du propriétaire.
# Installateur copié depuis le paquet contrôlé après vérification de son empreinte (SHA256SUMS du paquet). Absent : 404.
# Optional: folder of a built and checksummed setup package (not part of the repository).
PR_SRC="${PREMIERE_DIST:-/nonexistent}"
PR_DST="$DST/premiere"
# Setup publié (PREMIERE_SETUP) : le défaut reste celui en ligne ; une nouvelle version se publie avec
# PREMIERE_DIST=<paquet> PREMIERE_SETUP=AETHRYON-Setup-<version>.exe (docs/DEPLOIEMENT.md).
PR_FICHIER="${PREMIERE_SETUP:-AETHRYON-Setup-2.0.0-beta.9.exe}"
[[ $PR_FICHIER =~ ^AETHRYON-Setup-[0-9]+\.[0-9]+\.[0-9]+(-beta\.[0-9]+)?\.exe$ ]] || { echo "PREMIERE_SETUP invalide : $PR_FICHIER" >&2; exit 1; }
rm -rf "$PR_DST" && mkdir -p "$PR_DST"
if [[ -f "$PR_SRC/$PR_FICHIER" ]]; then
  ( cd "$PR_SRC" && grep " $PR_FICHIER\$" SHA256SUMS | sha256sum --quiet -c - )
  install -m 0644 "$PR_SRC/$PR_FICHIER" "$PR_DST/$PR_FICHIER"
  ( cd "$PR_SRC" && grep " $PR_FICHIER\$" SHA256SUMS ) > "$PR_DST/SHA256SUMS"
  ( cd "$PR_DST" && sha256sum --quiet -c SHA256SUMS )
  echo "AETHRYON pour Premiere Pro copié, empreinte vérifiée"
fi
# AETHRYON Desktop : annonce de mise à jour (downloads/desktop/latest.json, lue par Paramètres › Mises à jour,
# desktop/noyau/src/maj_desktop.rs). Copiée SEULEMENT avec DESKTOP_MAJ=1, depuis latest-desktop.json du paquet du setup
# (setup/scripts/construire.sh l'écrit), après vérification : schéma exact, nom = setup publié, taille et SHA-256
# identiques au setup copié ET à sa ligne de SHA256SUMS. Le setup n'est PAS recopié : nginx sert
# /downloads/desktop/<setup> depuis premiere/. Sans publication : dossier vide, 404.
DK_DST="$DST/desktop"
rm -rf "$DK_DST" && mkdir -p "$DK_DST"
if [[ "${DESKTOP_MAJ:-0}" == 1 ]]; then
  [[ -f "$PR_DST/$PR_FICHIER" && -f "$PR_SRC/latest-desktop.json" ]] || { echo "DESKTOP_MAJ=1 : $PR_FICHIER ou latest-desktop.json absent de $PR_SRC" >&2; exit 1; }
  python3 -I "$(dirname "$0")/latest-desktop.py" --verifier "$PR_SRC/latest-desktop.json" --setup "$PR_DST/$PR_FICHIER" --sha256sums "$PR_DST/SHA256SUMS"
  install -m 0644 "$PR_SRC/latest-desktop.json" "$DK_DST/latest.json"
  echo "annonce de mise à jour du Desktop copiée (downloads/desktop/latest.json → $PR_FICHIER)"
fi
